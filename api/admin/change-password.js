const { send, getBody, cors, requireAdmin, db } = require('../../lib/supa-http');
module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') { cors(res); return res.status(200).end(); }
  if (req.method !== 'POST') return send(res, 405, { success: false, error: 'Método não permitido.' });
  if (!await requireAdmin(req, res)) return;
  const { current_password, new_password } = await getBody(req);
  send(res, 200, await db.changeAdminPassword(current_password, new_password));
};
