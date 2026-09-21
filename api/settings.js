const { send, cors, db } = require('../lib/supa-http');
module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') { cors(res); return res.status(200).end(); }
  if (req.method !== 'GET') return send(res, 405, { success: false, error: 'Método não permitido.' });
  send(res, 200, { success: true, data: await db.getSettings() });
};
