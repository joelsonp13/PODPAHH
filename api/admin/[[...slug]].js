const fs = require('fs');
const path = require('path');
const { send, getBody, cors, bearer, requireAdmin, db } = require('../../lib/supa-http');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') { cors(res); return res.status(200).end(); }
  const parts = req.query.slug ? (Array.isArray(req.query.slug) ? req.query.slug : [req.query.slug]) : [];
  const r0 = parts[0], r1 = parts[1];
  const body = (req.method === 'POST' || req.method === 'PUT') ? await getBody(req) : {};

  // ---- login/logout (sem auth) ----
  if (r0 === 'login' && req.method === 'POST') {
    return send(res, 200, await db.adminLogin(body.username, body.password));
  }
  if (r0 === 'logout' && req.method === 'POST') {
    return send(res, 200, await db.adminLogout(bearer(req)));
  }

  // ---- restante exige admin ----
  if (!await requireAdmin(req, res)) return;

  if (r0 === 'change-password' && req.method === 'POST') {
    return send(res, 200, await db.changeAdminPassword(body.current_password, body.new_password));
  }
  if (r0 === 'stats' && req.method === 'GET') {
    const products = await db.getProducts();
    const customers = await db.getCustomers();
    const orders = await db.getOrders();
    const discounted = products.filter(p => p.old_price && p.old_price > p.price);
    return send(res, 200, { success: true, data: {
      totalProducts: products.length, totalCustomers: customers.length,
      totalOrders: orders.length, totalDiscounted: discounted.length
    } });
  }
  if (r0 === 'settings' && req.method === 'POST') {
    return send(res, 200, await db.saveSettings(body));
  }
  if (r0 === 'products' && !r1 && req.method === 'GET') {
    return send(res, 200, { success: true, data: await db.getProducts() });
  }
  if (r0 === 'products' && !r1 && req.method === 'POST') {
    return send(res, 200, await db.saveProduct(body));
  }
  if (r0 === 'products' && r1 && req.method === 'DELETE') {
    return send(res, 200, await db.deleteProduct(r1));
  }
  if (r0 === 'customers' && !r1 && req.method === 'GET') {
    return send(res, 200, { success: true, data: await db.getCustomers() });
  }
  if (r0 === 'customers' && r1 && req.method === 'DELETE') {
    return send(res, 200, await db.deleteCustomer(r1));
  }
  if (r0 === 'import-catalog' && req.method === 'POST') {
    let catalogData = body.catalog;
    if (!catalogData) {
      try {
        const content = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'podpahh-catalog.js'), 'utf8');
        const match = content.match(/window\.PODPAHH_CATALOG\s*=\s*(\{.*?\});/s);
        if (match) catalogData = JSON.parse(match[1]);
      } catch (e) { /* sem arquivo: exige body.catalog */ }
    }
    if (catalogData) return send(res, 200, await db.importCatalog(catalogData));
    return send(res, 400, { success: false, error: 'Nenhum catálogo encontrado.' });
  }
  if (r0 === 'supabase-health' && req.method === 'GET') {
    try {
      const { createClient } = require('@supabase/supabase-js');
      const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY, {
        auth: { autoRefreshToken: false, persistSession: false }
      });
      const { error } = await client.from('products').select('id', { count: 'exact', head: true });
      if (error) return send(res, 200, { success: true, data: { url: process.env.SUPABASE_URL, reachable: false, error: error.message } });
      return send(res, 200, { success: true, data: { url: process.env.SUPABASE_URL, reachable: true } });
    } catch (err) {
      return send(res, 200, { success: false, error: err.message });
    }
  }
  return send(res, 404, { success: false, error: 'Rota não encontrada.' });
};
