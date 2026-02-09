const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

exports.handler = async (event, context) => {
    // 1. CORS Başlıkları (Localhost'tan gelen isteklere izin ver)
    const headers = {
        'Access-Control-Allow-Origin': '*', 
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    // 2. Preflight (OPTIONS) İsteğini Karşıla
    // Tarayıcı "Veri gönderebilir miyim?" diye sorar, buna "Evet" demeliyiz.
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: ''
        };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: 'Method Not Allowed' };
    }

    try {
        const payload = JSON.parse(event.body);
        const errors = payload.errors;

        if (!errors || !Array.isArray(errors)) {
             return { statusCode: 400, headers, body: 'Invalid Payload' };
        }

        const rowsToInsert = errors.map(err => ({
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
        }));

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
            body: JSON.stringify({ error: 'Internal Server Error', details: error.message })
        };
    }
};