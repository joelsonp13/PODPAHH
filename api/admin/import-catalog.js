const fs = require('fs');
const path = require('path');
const { send, getBody, cors, requireAdmin, db } = require('../../lib/supa-http');
module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') { cors(res); return res.status(200).end(); }
  if (req.method !== 'POST') return send(res, 405, { success: false, error: 'Método não permitido.' });
  if (!await requireAdmin(req, res)) return;
  const body = await getBody(req);
  let catalogData = body.catalog;
  if (!catalogData) {
    try {
      const content = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'podpahh-catalog.js'), 'utf8');
      const match = content.match(/window\.PODPAHH_CATALOG\s*=\s*(\{.*?\});/s);
      if (match) catalogData = JSON.parse(match[1]);
    } catch (e) { /* sem arquivo: exige body.catalog */ }
  }
  if (catalogData) return send(res, 200, await db.importCatalog(catalogData));
  send(res, 400, { success: false, error: 'Nenhum catálogo encontrado.' });
};
