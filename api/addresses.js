const { send, getBody, cors, requireCustomer, respondDbResult, db } = require('../lib/supa-http');
module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') { cors(res); return res.status(200).end(); }
  const auth = await requireCustomer(req, res);
  if (!auth) return;
  if (req.method === 'GET') {
    return send(res, 200, { success: true, data: await db.listAddresses(auth.customerId) });
  }
  if (req.method === 'POST') {
    return respondDbResult(res, await db.createAddress(auth.customerId, await getBody(req)));
  }
  return send(res, 405, { success: false, error: 'Método não permitido.' });
};
