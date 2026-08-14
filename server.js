// ============================================
// 激活服务器（Render 版，Express 单服务）
// 路由：
//   POST /api/activate            用户激活
//   GET  /api/admin?action=list   管理后台-列表
//   POST /api/admin?action=generate 管理后台-生成激活码
//   GET  /api/admin?action=devices  管理后台-设备列表
//   POST /api/admin?action=unbind   管理后台-解绑
//   POST /api/admin?action=revoke   管理后台-撤销
//   GET  /admin                    管理后台页面
// ============================================
const express = require('express');
const path = require('path');
const { getSupabase } = require('./lib/supabase');
const { signLicense, generateCodeId, PLAN_DAYS, PLAN_NAMES } = require('./lib/rsa');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
    next();
});

// ---- 管理后台页面 ----
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ---- 用户激活接口 ----
app.post('/api/activate', async (req, res) => {
    const { license_code, device_key, device_info } = req.body || {};
    if (!license_code || !device_key) {
        res.status(400).json({ ok: false, reason: '缺少激活码或设备指纹' });
        return;
    }
    const codeId = String(license_code).toUpperCase().replace(/\s/g, '');
    try {
        const supabase = getSupabase();
        const { data: license, error: lerr } = await supabase.from('licenses').select('*').eq('code_id', codeId).single();
        if (lerr || !license) { res.json({ ok: false, reason: '激活码无效' }); return; }
        if (license.status === 'revoked') { res.json({ ok: false, reason: '激活码已被撤销' }); return; }
        const now = new Date();
        if (now > new Date(license.expires_at)) { res.json({ ok: false, reason: '激活码已过期' }); return; }

        const { data: existing } = await supabase.from('activations').select('*').eq('code_id', codeId);
        const alreadyBound = (existing || []).find(a => a.device_key === device_key);
        if (alreadyBound) {
            await supabase.from('activations').update({ last_seen: new Date().toISOString(), device_info: device_info || alreadyBound.device_info }).eq('id', alreadyBound.id);
        } else {
            const boundCount = (existing || []).length;
            if (boundCount >= license.devices) {
                res.json({ ok: false, reason: '已达设备上限（' + license.devices + ' 台），请联系卖家解绑旧设备' });
                return;
            }
            await supabase.from('activations').insert({
                code_id: codeId, device_key, device_info: device_info || '',
                activated_at: new Date().toISOString(), last_seen: new Date().toISOString()
            });
        }
        res.json({
            ok: true, plan: license.plan, devices: license.devices,
            expires_at: license.expires_at, code_id: license.code_id, signature: license.signature
        });
    } catch (e) {
        console.error('[activate] error:', e);
        res.status(500).json({ ok: false, reason: '服务器错误：' + e.message });
    }
});

// ---- 管理后台 API ----
function checkPassword(req) {
    const pw = req.query.password || (req.body && req.body.password);
    return pw && pw === process.env.ADMIN_PASSWORD;
}

app.all('/api/admin', async (req, res) => {
    const action = req.query.action;
    if (!action) { res.status(400).json({ ok: false, reason: '缺少 action 参数' }); return; }
    if (!checkPassword(req)) { res.status(401).json({ ok: false, reason: '管理密码错误' }); return; }

    try {
        const supabase = getSupabase();

        if (action === 'generate' && req.method === 'POST') {
            const { plan, devices, note, customDays } = req.body || {};
            if (!plan || !PLAN_DAYS[plan]) { res.status(400).json({ ok: false, reason: '套餐无效' }); return; }
            const dev = Math.min(20, Math.max(1, parseInt(devices) || 2));
            const days = customDays ? parseInt(customDays) : PLAN_DAYS[plan];
            const expiresAt = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
            let codeId;
            for (let i = 0; i < 5; i++) {
                codeId = generateCodeId();
                const { data: exist } = await supabase.from('licenses').select('id').eq('code_id', codeId).maybeSingle();
                if (!exist) break;
                codeId = null;
            }
            if (!codeId) { res.status(500).json({ ok: false, reason: '生成失败，重试' }); return; }
            const signature = signLicense(plan, dev, expiresAt, codeId);
            const { error } = await supabase.from('licenses').insert({ code_id: codeId, plan, devices: dev, expires_at: expiresAt, signature, note: note || '', status: 'active' });
            if (error) { res.status(500).json({ ok: false, reason: error.message }); return; }
            res.json({ ok: true, code_id: codeId, plan, plan_name: PLAN_NAMES[plan], devices: dev, expires_at: expiresAt, created_at: new Date().toISOString() });
            return;
        }

        if (action === 'list' && req.method === 'GET') {
            const { data, error } = await supabase.from('licenses').select('*').order('created_at', { ascending: false });
            if (error) { res.status(500).json({ ok: false, reason: error.message }); return; }
            const { data: acts } = await supabase.from('activations').select('code_id');
            const countMap = {};
            (acts || []).forEach(a => { countMap[a.code_id] = (countMap[a.code_id] || 0) + 1; });
            res.json({ ok: true, list: (data || []).map(l => ({
                code_id: l.code_id, plan: l.plan, plan_name: PLAN_NAMES[l.plan] || l.plan,
                devices: l.devices, expires_at: l.expires_at, created_at: l.created_at,
                note: l.note, status: l.status, activation_count: countMap[l.code_id] || 0
            })) });
            return;
        }

        if (action === 'devices' && req.method === 'GET') {
            const codeId = req.query.code_id;
            if (!codeId) { res.status(400).json({ ok: false, reason: '缺少 code_id' }); return; }
            const { data, error } = await supabase.from('activations').select('*').eq('code_id', codeId).order('activated_at', { ascending: true });
            if (error) { res.status(500).json({ ok: false, reason: error.message }); return; }
            res.json({ ok: true, devices: data || [] });
            return;
        }

        if (action === 'unbind' && req.method === 'POST') {
            const { code_id, device_key } = req.body || {};
            if (!code_id || !device_key) { res.status(400).json({ ok: false, reason: '缺少参数' }); return; }
            const { error } = await supabase.from('activations').delete().eq('code_id', code_id).eq('device_key', device_key);
            if (error) { res.status(500).json({ ok: false, reason: error.message }); return; }
            res.json({ ok: true });
            return;
        }

        if (action === 'revoke' && req.method === 'POST') {
            const { code_id } = req.body || {};
            if (!code_id) { res.status(400).json({ ok: false, reason: '缺少 code_id' }); return; }
            const { error } = await supabase.from('licenses').update({ status: 'revoked' }).eq('code_id', code_id);
            if (error) { res.status(500).json({ ok: false, reason: error.message }); return; }
            res.json({ ok: true });
            return;
        }

        res.status(400).json({ ok: false, reason: '未知 action' });
    } catch (e) {
        console.error('[admin] error:', e);
        res.status(500).json({ ok: false, reason: '服务器错误：' + e.message });
    }
});

// 健康检查
app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('License server running on port ' + PORT));
