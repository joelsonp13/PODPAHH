const { send, getBody, cors, db } = require('../../lib/supa-http');
module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') { cors(res); return res.status(200).end(); }
  if (req.method !== 'POST') return send(res, 405, { success: false, error: 'Método não permitido.' });
  const { name, email, password, phone } = await getBody(req);
  const result = await db.registerCustomer(name, email, password, phone);
  send(res, result.status || 200, result);
};
