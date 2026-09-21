const { send, getBody, cors, requireCustomer, respondDbResult, subpath, db } = require('../../lib/supa-http');
module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') { cors(res); return res.status(200).end(); }
  const auth = await requireCustomer(req, res);
  if (!auth) return;
  const parts = subpath(req, ['api', 'addresses']);
  const body = (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') ? await getBody(req) : {};
  if (parts.length === 0 && req.method === 'GET') {
    return send(res, 200, { success: true, data: await db.listAddresses(auth.customerId) });
  }
  if (parts.length === 0 && req.method === 'POST') {
    return respondDbResult(res, await db.createAddress(auth.customerId, body));
  }
  if (parts.length === 1 && req.method === 'PUT') {
    return respondDbResult(res, await db.updateAddress(auth.customerId, parts[0], body));
  }
  if (parts.length === 1 && req.method === 'DELETE') {
    return respondDbResult(res, await db.deleteAddress(auth.customerId, parts[0]));
  }
  return send(res, 404, { success: false, error: 'Rota não encontrada.' });
};
