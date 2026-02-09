const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

exports.handler = async (event, context) => {
    // CORS
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

        for (const err of errors) {
            // Marka bilgisini al (Yoksa 'Genel' yap)
            const brand = err.brand || 'Genel';
            
            // Hash'e markayı da ekle: Marka değişirse hata farklı sayılır
            const uniqueString = `${brand}|${err.test_id}|${err.variation}|${err.type}|${err.message}`;
            const errorHash = crypto.createHash('md5').update(uniqueString).digest('hex');

            const { data: existingErr } = await supabase
                .from('error_logs')
                .select('id, occurrences')
                .eq('error_hash', errorHash)
                .single();

            if (existingErr) {
                await supabase
                    .from('error_logs')
                    .update({ 
                        occurrences: existingErr.occurrences + 1,
                        last_seen_at: new Date().toISOString(),
                        context: err.context 
                    })
                    .eq('id', existingErr.id);
            } else {
                await supabase
                    .from('error_logs')
                    .insert({
                        brand: brand, // <--- Veritabanına yaz
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
                        error_hash: errorHash,
                        occurrences: 1,
                        last_seen_at: new Date().toISOString()
                    });
            }
        }

        return { statusCode: 200, headers, body: JSON.stringify({ message: 'Processed' }) };

    } catch (error) {
        console.error('Function Error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal Server Error' }) };
    }
};