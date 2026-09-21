/* Helpers HTTP das functions serverless (CORS + body + auth). */
'use strict';

const db = require('./supa-db');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function send(res, status, obj) {
  cors(res);
  res.status(status).json(obj);
}

function bearer(req) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+([^\s]+)$/i);
  return m ? m[1] : null;
}

function getBody(req) {
  return new Promise((resolve) => {
    if (req.body !== undefined) {
      if (typeof req.body === 'string') {
        try { resolve(JSON.parse(req.body || '{}')); } catch (e) { resolve({}); }
      } else if (typeof req.body === 'object' && req.body !== null) {
        resolve(req.body);
      } else { resolve({}); }
      return;
    }
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); } catch (e) { resolve({}); }
    });
  });
}

async function requireAdmin(req, res) {
  const token = bearer(req);
  if (!token || !(await db.verifyAdminSession(token))) {
    send(res, 401, { success: false, error: 'Não autorizado. Faça login como admin.' });
    return null;
  }
  return token;
}

async function requireCustomer(req, res) {
  const token = bearer(req);
  const session = token ? await db.getCustomerSession(token) : null;
  if (!session) {
    send(res, 401, { success: false, error: 'Sessão inválida ou expirada.' });
    return null;
  }
  return { token, customerId: session.customer_id };
}

function respondDbResult(res, result, successStatus = 200) {
  if (!result || result.success === false) {
    return send(res, result.status || 400, { success: false, error: result.error || 'Requisição inválida.' });
  }
  return send(res, successStatus, { success: true, data: result.data });
}

module.exports = { cors, send, bearer, getBody, requireAdmin, requireCustomer, respondDbResult, db };
