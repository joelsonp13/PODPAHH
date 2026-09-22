const { send, getBody, cors, bearer, subpath, db } = require('../../lib/supa-http');
const attempts = new Map();
module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') { cors(res); return res.status(200).end(); }
  if (req.method !== 'POST') return send(res, 405, { success: false, error: 'Método não permitido.' });
  const slug = subpath(req, ['api', 'auth'])[0];
  const body = await getBody(req);
  if (slug === 'register') {
    const result = await db.registerCustomer(body.name, body.email, body.password, body.phone);
    return send(res, result.status || 200, result);
  }
  if (slug === 'login') {
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    const now = Date.now();
    let e = attempts.get(ip);
    if (!e || now > e.resetAt) { e = { count: 0, resetAt: now + 10 * 60 * 1000 }; attempts.set(ip, e); }
    if (e.count >= 10) return send(res, 429, { success: false, error: 'Muitas tentativas. Aguarde 10 minutos.' });
    e.count++;
    const result = await db.loginCustomer(body.email, body.password, body.phone);
    return send(res, result.status || 200, result);
  }
  if (slug === 'logout') {
    await db.logoutCustomer(bearer(req));
    return send(res, 200, { success: true });
  }
  if (slug === 'forgot') {
    const result = await db.requestPasswordReset(body.email);
    return send(res, result.status || 200, result);
  }
  if (slug === 'reset') {
    const result = await db.resetPasswordByToken(body.token, body.new_password);
    return send(res, result.status || 200, result);
  }
  return send(res, 404, { success: false, error: 'Rota não encontrada.' });
};
