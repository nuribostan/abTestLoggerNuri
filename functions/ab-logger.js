const { createClient } = require('@supabase/supabase-js');
// Hash oluşturmak için crypto kütüphanesini kullanacağız (Node.js'te gömülü gelir)
const crypto = require('crypto');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

exports.handler = async (event, context) => {
    // --- CORS AYARLARI ---
    const origin = event.headers.origin || event.headers.Origin || '*';
    const headers = {
        'Access-Control-Allow-Origin': origin, 
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Credentials': 'true'
    };

    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method Not Allowed' };

    try {
        const payload = JSON.parse(event.body);
        const errors = payload.errors;

        if (!errors || !Array.isArray(errors)) return { statusCode: 400, headers, body: 'Invalid Payload' };

        // --- DEDUPLICATION MANTIĞI ---
        for (const err of errors) {
            
            // 1. Benzersiz bir Parmak İzi (Hash) oluştur
            // Test ID + Varyasyon + Hata Tipi + Hata Mesajı aynıysa bu "AYNI HATA"dır.
            const uniqueString = `${err.test_id}|${err.variation}|${err.type}|${err.message}`;
            const errorHash = crypto.createHash('md5').update(uniqueString).digest('hex');

            // 2. Bu hash veritabanında var mı kontrol et?
            const { data: existingErr } = await supabase
                .from('error_logs')
                .select('id, occurrences')
                .eq('error_hash', errorHash)
                .single();

            if (existingErr) {
                // A) VARSA: Sadece sayacı artır ve tarihi güncelle (Yeni satır ekleme!)
                await supabase
                    .from('error_logs')
                    .update({ 
                        occurrences: existingErr.occurrences + 1,
                        last_seen_at: new Date().toISOString(),
                        // Son kullanıcının cihaz bilgisini de güncelleyebiliriz
                        context: err.context 
                    })
                    .eq('id', existingErr.id);
            } else {
                // B) YOKSA: Yeni kayıt oluştur
                await supabase
                    .from('error_logs')
                    .insert({
                        test_id: err.test_id,
                        variation: err.variation,
                        test_version: err.test_version,
                        error_type: err.type,
                        severity: err.severity,
                        message: err.message,
                        stack_trace: err.stack_trace,
                        meta: err.meta,
                        context: err.context,
                        session_id: err.session_id,
                        error_hash: errorHash,  // Hash'i de kaydet
                        occurrences: 1,         // İlk kez görüldü
                        last_seen_at: new Date().toISOString()
                    });
            }
        }

        return { statusCode: 200, headers, body: JSON.stringify({ message: 'Processed successfully' }) };

    } catch (error) {
        console.error('Function Error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal Server Error' }) };
    }
};