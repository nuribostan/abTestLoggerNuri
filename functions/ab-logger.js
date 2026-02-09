const { createClient } = require('@supabase/supabase-js');

// Ortam değişkenlerinden anahtarları alacağız (Netlify panelinden eklenecek)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // DİKKAT: Service Role Key kullanılacak

const supabase = createClient(supabaseUrl, supabaseKey);

exports.handler = async (event, context) => {
    // 1. CORS Ayarları (Çok Önemli! Başka sitelerden istek geleceği için)
    const headers = {
        'Access-Control-Allow-Origin': '*', // Güvenlik için ilerde sadece kendi domainlerini yazarsın
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    // Preflight (OPTIONS) isteğini karşıla
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: 'Method Not Allowed' };
    }

    try {
        // 2. Gelen veriyi al
        const payload = JSON.parse(event.body);
        const errors = payload.errors; // Kütüphanemiz { errors: [] } yolluyor

        if (!errors || !Array.isArray(errors)) {
             return { statusCode: 400, headers, body: 'Invalid Payload' };
        }

        // 3. Veriyi Supabase'e yazmak için hazırla
        const rowsToInsert = errors.map(err => ({
            test_id: err.test_id,
            variation: err.variation,
            test_version: err.test_version,
            error_type: err.type, // JS kütüphanesindeki isimle eşleşmeli
            severity: err.severity,
            message: err.message,
            stack_trace: err.stack_trace,
            meta: err.meta,
            context: err.context,
            session_id: err.session_id,
            // timestamp JS'den geliyor ama biz DB'nin created_at'ini kullansak daha iyi,
            // yine de log zamanını meta'ya ekleyebiliriz.
        }));

        // 4. Supabase'e toplu insert
        const { data, error } = await supabase
            .from('error_logs')
            .insert(rowsToInsert);

        if (error) throw error;

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ message: 'Logged successfully' })
        };

    } catch (error) {
        console.error('Function Error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Internal Server Error' })
        };
    }
};