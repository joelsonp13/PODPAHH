const { send, cors, db } = require('../../lib/supa-http');
module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') { cors(res); return res.status(200).end(); }
  if (req.method !== 'GET') return send(res, 405, { success: false, error: 'Método não permitido.' });
  const products = (await db.getProducts())
    .filter(p => p.stock > 0)
    .map(p => ({ id: p.id, source_id: p.source_id, name: p.name, price: p.price, old_price: p.old_price, image: p.image, url: p.url, category: p.category, description: p.description || '', puffs: p.puffs || 0, models: Array.isArray(p.models) ? p.models : [] }));
  send(res, 200, { success: true, data: products });
};
