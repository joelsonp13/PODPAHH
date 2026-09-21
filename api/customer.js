const { send, getBody, cors, requireCustomer, respondDbResult, db } = require('../lib/supa-http');
module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') { cors(res); return res.status(200).end(); }
  const auth = await requireCustomer(req, res);
  if (!auth) return;
  if (req.method === 'GET') {
    try {
      const me = await db.getCustomerById(auth.customerId);
      if (!me) return send(res, 404, { success: false, error: 'Conta não encontrada.' });
      return send(res, 200, { success: true, data: me });
    } catch (e) {
      return send(res, 500, { success: false, error: 'Erro interno.' });
    }
  }
  if (req.method === 'PUT') {
    return respondDbResult(res, await db.updateCustomer(auth.customerId, await getBody(req)));
  }
  return send(res, 405, { success: false, error: 'Método não permitido.' });
};
