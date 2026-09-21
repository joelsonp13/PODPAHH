const { send, getBody, cors, requireAdmin, requireCustomer, subpath, db } = require('../../lib/supa-http');
module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') { cors(res); return res.status(200).end(); }
  const parts = subpath(req, ['api', 'orders']);
  const body = (req.method === 'POST' || req.method === 'PUT') ? await getBody(req) : {};
  // POST /api/orders — cria pedido (público, checkout WhatsApp)
  if (req.method === 'POST' && parts.length === 0) {
    return send(res, 200, await db.saveOrder(body));
  }
  // GET /api/orders/mine — pedidos do cliente logado
  if (req.method === 'GET' && parts.length === 1 && parts[0] === 'mine') {
    const auth = await requireCustomer(req, res);
    if (!auth) return;
    return send(res, 200, { success: true, data: await db.getOrdersByCustomer(auth.customerId) });
  }
  // GET /api/orders — lista tudo (admin)
  if (req.method === 'GET' && parts.length === 0) {
    if (!await requireAdmin(req, res)) return;
    return send(res, 200, { success: true, data: await db.getOrders() });
  }
  // PUT/DELETE /api/orders/:id (admin)
  if (parts.length === 1 && (req.method === 'PUT' || req.method === 'DELETE')) {
    if (!await requireAdmin(req, res)) return;
    if (req.method === 'PUT') return send(res, 200, await db.updateOrderStatus(parts[0], (body || {}).status));
    return send(res, 200, await db.deleteOrder(parts[0]));
  }
  return send(res, 404, { success: false, error: 'Rota não encontrada.' });
};
