const { send, getBody, cors, requireAdmin, db } = require('../lib/supa-http');
// Rota base explícita: o catch-all [[...slug]] não casa /api/orders puro.
module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') { cors(res); return res.status(200).end(); }
  if (req.method === 'POST') {
    return send(res, 200, await db.saveOrder(await getBody(req)));
  }
  if (req.method === 'GET') {
    if (!await requireAdmin(req, res)) return;
    return send(res, 200, { success: true, data: await db.getOrders() });
  }
  // PUT/DELETE com ?id= (o catch-all não casa 2 segmentos no path)
  if ((req.method === 'PUT' || req.method === 'DELETE') && req.query.id) {
    if (!await requireAdmin(req, res)) return;
    if (req.method === 'PUT') {
      const body = await getBody(req);
      return send(res, 200, await db.updateOrderStatus(req.query.id, (body || {}).status));
    }
    return send(res, 200, await db.deleteOrder(req.query.id));
  }
  return send(res, 405, { success: false, error: 'Método não permitido.' });
};
