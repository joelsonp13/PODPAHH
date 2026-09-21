const { send, getBody, cors, db } = require('../../lib/supa-http');
// Rate limit best-effort por instância (serverless não compartilha RAM).
const attempts = new Map();
module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') { cors(res); return res.status(200).end(); }
  if (req.method !== 'POST') return send(res, 405, { success: false, error: 'Método não permitido.' });
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const now = Date.now();
  let e = attempts.get(ip);
  if (!e || now > e.resetAt) { e = { count: 0, resetAt: now + 10 * 60 * 1000 }; attempts.set(ip, e); }
  if (e.count >= 10) return send(res, 429, { success: false, error: 'Muitas tentativas. Aguarde 10 minutos.' });
  e.count++;
  const { email, password, phone } = await getBody(req);
  const result = await db.loginCustomer(email, password, phone);
  send(res, result.status || 200, result);
};
