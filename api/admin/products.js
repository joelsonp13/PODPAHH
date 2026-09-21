const { send, getBody, cors, requireAdmin, db } = require('../../lib/supa-http');
module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') { cors(res); return res.status(200).end(); }
  if (!await requireAdmin(req, res)) return;
  if (req.method === 'GET') {
    return send(res, 200, { success: true, data: await db.getProducts() });
  }
  if (req.method === 'POST') {
    return send(res, 200, await db.saveProduct(await getBody(req)));
  }
  return send(res, 405, { success: false, error: 'Método não permitido.' });
};
