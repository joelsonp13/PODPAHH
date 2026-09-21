const { send, getBody, cors, db } = require('../../lib/supa-http');
module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') { cors(res); return res.status(200).end(); }
  if (req.method !== 'POST') return send(res, 405, { success: false, error: 'Método não permitido.' });
  const { username, password } = await getBody(req);
  send(res, 200, await db.adminLogin(username, password));
};
