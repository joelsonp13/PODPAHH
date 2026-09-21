const { send, getBody, cors, requireCustomer, respondDbResult, db } = require('../../lib/supa-http');
module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') { cors(res); return res.status(200).end(); }
  if (req.method !== 'POST') return send(res, 405, { success: false, error: 'Método não permitido.' });
  const auth = await requireCustomer(req, res);
  if (!auth) return;
  respondDbResult(res, await db.toggleWishlist(auth.customerId, await getBody(req)));
};
