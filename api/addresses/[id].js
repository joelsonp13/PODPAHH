const { send, getBody, cors, requireCustomer, respondDbResult, db } = require('../../lib/supa-http');
module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') { cors(res); return res.status(200).end(); }
  const auth = await requireCustomer(req, res);
  if (!auth) return;
  const id = req.query.id;
  if (req.method === 'PUT') {
    return respondDbResult(res, await db.updateAddress(auth.customerId, id, await getBody(req)));
  }
  if (req.method === 'DELETE') {
    return respondDbResult(res, await db.deleteAddress(auth.customerId, id));
  }
  return send(res, 405, { success: false, error: 'Método não permitido.' });
};
