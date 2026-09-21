const { send, cors, requireAdmin, db } = require('../../lib/supa-http');
module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') { cors(res); return res.status(200).end(); }
  if (req.method !== 'GET') return send(res, 405, { success: false, error: 'Método não permitido.' });
  if (!await requireAdmin(req, res)) return;
  const products = await db.getProducts();
  const customers = await db.getCustomers();
  const orders = await db.getOrders();
  const discounted = products.filter(p => p.old_price && p.old_price > p.price);
  send(res, 200, { success: true, data: {
    totalProducts: products.length, totalCustomers: customers.length,
    totalOrders: orders.length, totalDiscounted: discounted.length
  } });
};
