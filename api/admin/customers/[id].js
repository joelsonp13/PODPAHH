const { send, cors, requireAdmin, db } = require('../../../lib/supa-http');
module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') { cors(res); return res.status(200).end(); }
  if (req.method !== 'DELETE') return send(res, 405, { success: false, error: 'Método não permitido.' });
  if (!await requireAdmin(req, res)) return;
  send(res, 200, await db.deleteCustomer(req.query.id));
};
