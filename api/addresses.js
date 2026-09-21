const { send, getBody, cors, requireCustomer, respondDbResult, db } = require('../lib/supa-http');
// Rota base explícita: o catch-all [[...slug]] não casa /api/addresses puro.
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
  // PUT/DELETE com ?id= (o catch-all não casa 2 segmentos no path)
  if ((req.method === 'PUT' || req.method === 'DELETE') && req.query.id) {
    if (req.method === 'PUT') {
      return respondDbResult(res, await db.updateAddress(auth.customerId, req.query.id, await getBody(req)));
    }
    return respondDbResult(res, await db.deleteAddress(auth.customerId, req.query.id));
  }
  return send(res, 405, { success: false, error: 'Método não permitido.' });
};
