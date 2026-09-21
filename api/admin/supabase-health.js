const { send, cors, requireAdmin } = require('../../lib/supa-http');
module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') { cors(res); return res.status(200).end(); }
  if (req.method !== 'GET') return send(res, 405, { success: false, error: 'Método não permitido.' });
  if (!await requireAdmin(req, res)) return;
  try {
    const { createClient } = require('@supabase/supabase-js');
    const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const { data, error } = await client.from('products').select('id', { count: 'exact', head: true });
    if (error) return send(res, 200, { success: true, data: { url: process.env.SUPABASE_URL, reachable: false, error: error.message } });
    send(res, 200, { success: true, data: { url: process.env.SUPABASE_URL, reachable: true, products: data } });
  } catch (err) {
    send(res, 200, { success: false, error: err.message });
  }
};
