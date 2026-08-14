// ============================================
// Supabase 客户端（服务端用 service_role key）
// ============================================
const { createClient } = require('@supabase/supabase-js');

let _client = null;

function getSupabase() {
    if (_client) return _client;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL 或 SUPABASE_SERVICE_KEY 未配置');
    _client = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false }
    });
    return _client;
}

module.exports = { getSupabase };
