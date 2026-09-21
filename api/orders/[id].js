const { send, getBody, cors, requireAdmin, db } = require('../../lib/supa-http');
module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') { cors(res); return res.status(200).end(); }
  if (!await requireAdmin(req, res)) return;
  const id = req.query.id;
  if (req.method === 'PUT') {
    const body = await getBody(req);
    return send(res, 200, await db.updateOrderStatus(id, (body || {}).status));
  }
  if (req.method === 'DELETE') {
    return send(res, 200, await db.deleteOrder(id));
  }
  return send(res, 405, { success: false, error: 'Método não permitido.' });
};
