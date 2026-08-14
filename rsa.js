// ============================================
// RSA 签名工具（服务端用私钥签名）
// ============================================
const crypto = require('crypto');

// 从环境变量读取私钥（Vercel 部署时配置）
function getPrivateKey() {
    const key = process.env.PRIVATE_KEY;
    if (!key) throw new Error('PRIVATE_KEY 环境变量未配置');
    // Vercel 环境变量中的换行符可能被转义，还原
    return key.replace(/\\n/g, '\n');
}

// 对激活码数据签名
// payload 格式：plan|devices|expires_at|code_id
function signLicense(plan, devices, expiresAt, codeId) {
    const payload = [plan, devices, expiresAt, codeId].join('|');
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(payload);
    sign.end();
    return sign.sign(getPrivateKey(), 'base64');
}

// 生成随机激活码标识符：4 组 × 4 字符，去除易混淆字符（0/O/1/I/L）
const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 31 个字符
function generateCodeId() {
    let parts = [];
    for (let g = 0; g < 4; g++) {
        let part = '';
        for (let i = 0; i < 4; i++) {
            part += CHARSET[Math.floor(Math.random() * CHARSET.length)];
        }
        parts.push(part);
    }
    return parts.join('-');
}

// 套餐天数映射
const PLAN_DAYS = {
    monthly: 30,
    quarterly: 90,
    halfyear: 180,
    yearly: 365,
    trial: 7
};

// 套餐中文名
const PLAN_NAMES = {
    monthly: '月卡',
    quarterly: '季卡',
    halfyear: '半年卡',
    yearly: '年卡',
    trial: '试用'
};

module.exports = { signLicense, generateCodeId, PLAN_DAYS, PLAN_NAMES };
