/* ================================================================
   PODPAHH — Local Backend Server (SECURED ADMIN ENDPOINTS)
   Todas as rotas /api/admin/* exigem login + token Bearer válido.
   ================================================================ */
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Carrega variáveis de ambiente do .env — SECRET KEY fica aqui
// dotenv instalado: usa path explícito para rodar de qualquer diretório.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const db = require('./db');
// Helpers Supabase (clientes server/public + diagnóstico). Opcional se não usar.
const supabase = require('./supabase');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '15mb' }));

/* ---------------- BLOQUEIO DE PASTAS SENSÍVEIS ----------------
   O express.static serve tudo, incluindo o banco JSON (com senhas!)
   e o código do servidor. Estas rotas precisam vir ANTES do static. */
app.use((req, res, next) => {
  const blocked = ['/data', '/server', '/node_modules', '/.vscode'];
  if (blocked.some(b => req.path === b || req.path.startsWith(b + '/'))) {
    return res.status(403).send('Forbidden');
  }
  next();
});

app.use(express.static(path.join(__dirname, '..')));
app.use('/pedevapor-shop', express.static(path.join(__dirname, '..', 'pedevapor-shop')));

// Página inicial agora é a descartáveis (index antigo apagado).
// Qualquer acesso à raiz ou ao index antigo cai na descartáveis.
app.get(['/', '/pedevapor-shop', '/pedevapor-shop/', '/pedevapor-shop/index.html', '/index.html'], (req, res) => {
  res.redirect('/pedevapor-shop/pages/categoria-produto/descartaveis.html');
});

/* ---------------- MIDDLEWARES DE AUTENTICAÇÃO ---------------- */
function extractBearerToken(req) {
  const authorization = req.headers.authorization || '';
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  return match ? match[1] : null;
}

// Bloqueia qualquer rota /api/admin/* sem token Bearer válido.
function requireAdmin(req, res, next) {
  const token = extractBearerToken(req);
  if (!token || !db.verifySession(token)) {
    return res.status(401).json({ success: false, error: 'Não autorizado. Faça login como admin.' });
  }
  next();
}

// Rotas de cliente: o token de sessão é separado do token administrativo.
function requireCustomer(req, res, next) {
  const token = extractBearerToken(req);
  const session = token ? db.getCustomerSession(token) : null;
  if (!session) {
    return res.status(401).json({ success: false, error: 'Sessão inválida ou expirada.' });
  }
  req.customerToken = token;
  req.customerId = session.customer_id;
  next();
}

function respondDbResult(res, result, successStatus = 200) {
  if (!result || result.success === false) {
    return res.status(result.status || 400).json({
      success: false,
      error: result.error || 'Requisição inválida.'
    });
  }
  return res.status(successStatus).json({ success: true, data: result.data });
}

// Rate limit simples de tentativas de login (5 tentativas / 10 min por IP)
const loginAttempts = new Map(); // ip -> { count, resetAt }
function loginRateLimit(req, res, next) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  let entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + 10 * 60 * 1000 };
    loginAttempts.set(ip, entry);
  }
  if (entry.count >= 5) {
    return res.status(429).json({ success: false, error: 'Muitas tentativas. Aguarde 10 minutos.' });
  }
  entry.count++;
  next();
}

// ---------- LOGIN / LOGOUT DO ADMIN ----------
app.post('/api/admin/login', loginRateLimit, (req, res) => {
  const { username, password } = req.body || {};
  res.json(db.adminLogin(username, password));
});

app.post('/api/admin/logout', (req, res) => {
  const token = extractBearerToken(req);
  res.json(db.adminLogout(token));
});

// Trocar a senha do admin (exige estar logado como admin)
app.post('/api/admin/change-password', requireAdmin, (req, res) => {
  const { current_password, new_password } = req.body || {};
  res.json(db.changeAdminPassword(current_password, new_password));
});

// ---------- ROTAS PÚBLICAS (LOJA DOS USUÁRIOS) ----------
app.post('/api/auth/register', (req, res) => {
  const { name, email, password, phone } = req.body || {};
  const result = db.registerCustomer(name, email, password, phone);
  res.status(result.status || 200).json(result);
});

app.post('/api/auth/login', loginRateLimit, (req, res) => {
  const { email, password, phone } = req.body || {};
  const result = db.loginCustomer(email, password, phone);
  res.status(result.status || 200).json(result);
});

app.post('/api/auth/logout', requireCustomer, (req, res) => {
  db.logoutCustomer(req.customerToken);
  res.json({ success: true });
});

// Configurações da loja (número do WhatsApp do checkout)
app.get('/api/settings', (req, res) => {
  res.json({ success: true, data: db.getSettings() });
});

app.post('/api/admin/settings', requireAdmin, (req, res) => {
  res.json(db.saveSettings(req.body || {}));
});

// Catálogo público: só nome/preço/imagem/estoque>0 + modelos (sem dados sensíveis)
app.get('/api/public/products', (req, res) => {
  const products = db.getProducts()
    .filter(p => p.stock > 0)
    .map(p => ({ id: p.id, source_id: p.source_id, name: p.name, price: p.price, old_price: p.old_price, image: p.image, url: p.url, category: p.category, description: p.description || '', puffs: p.puffs || 0, models: Array.isArray(p.models) ? p.models : [] }));
  res.json({ success: true, data: products });
});

app.post('/api/orders', (req, res) => {
  res.json(db.saveOrder(req.body));
});

// Pedidos do próprio cliente logado (Minha Conta) — só os dele.
app.get('/api/orders/mine', requireCustomer, (req, res) => {
  res.json({ success: true, data: db.getOrdersByCustomer(req.customerId) });
});

app.get('/api/orders', requireAdmin, (req, res) => {
  res.json({ success: true, data: db.getOrders() });
});

app.put('/api/orders/:id', requireAdmin, (req, res) => {
  res.json(db.updateOrderStatus(req.params.id, (req.body || {}).status));
});

app.delete('/api/orders/:id', requireAdmin, (req, res) => {
  res.json(db.deleteOrder(req.params.id));
});

// ---------- ENDEREÇOS DE CLIENTE (PROTEGIDOS) ----------
app.get('/api/addresses', requireCustomer, (req, res) => {
  res.json({ success: true, data: db.listAddresses(req.customerId) });
});

app.post('/api/addresses', requireCustomer, (req, res) => {
  respondDbResult(res, db.createAddress(req.customerId, req.body || {}));
});

app.put('/api/addresses/:id', requireCustomer, (req, res) => {
  respondDbResult(res, db.updateAddress(req.customerId, req.params.id, req.body || {}));
});

app.delete('/api/addresses/:id', requireCustomer, (req, res) => {
  respondDbResult(res, db.deleteAddress(req.customerId, req.params.id));
});

// ---------- FAVORITOS DO CLIENTE (WISHLIST POR CONTA) ----------
app.get('/api/wishlist', requireCustomer, (req, res) => {
  res.json({ success: true, data: db.listWishlist(req.customerId) });
});

app.post('/api/wishlist', requireCustomer, (req, res) => {
  respondDbResult(res, db.addWishlist(req.customerId, req.body || {}));
});

app.post('/api/wishlist/toggle', requireCustomer, (req, res) => {
  respondDbResult(res, db.toggleWishlist(req.customerId, req.body || {}));
});

app.delete('/api/wishlist', requireCustomer, (req, res) => {
  respondDbResult(res, db.removeWishlist(req.customerId, req.body || {}));
});

// ---------- ROTAS ADMIN (PROTEGIDAS) ----------
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const products = db.getProducts();
  const customers = db.getCustomers();
  const orders = db.getOrders();
  const discounted = products.filter(p => p.old_price && p.old_price > p.price);
  res.json({
    success: true,
    data: {
      totalProducts: products.length,
      totalCustomers: customers.length,
      totalOrders: orders.length,
      totalDiscounted: discounted.length
    }
  });
});

app.get('/api/admin/customers', requireAdmin, (req, res) => {
  res.json({ success: true, data: db.getCustomers() });
});

app.delete('/api/admin/customers/:id', requireAdmin, (req, res) => {
  res.json(db.deleteCustomer(req.params.id));
});

app.get('/api/admin/products', requireAdmin, (req, res) => {
  res.json({ success: true, data: db.getProducts() });
});

app.post('/api/admin/products', requireAdmin, (req, res) => {
  res.json(db.saveProduct(req.body));
});

app.delete('/api/admin/products/:id', requireAdmin, (req, res) => {
  res.json(db.deleteProduct(req.params.id));
});

app.post('/api/admin/import-catalog', requireAdmin, (req, res) => {
  const catalogPath = path.join(__dirname, '..', 'js', 'podpahh-catalog.js');
  let catalogData = req.body.catalog;
  if (!catalogData && fs.existsSync(catalogPath)) {
    try {
      const content = fs.readFileSync(catalogPath, 'utf8');
      const match = content.match(/window\.PODPAHH_CATALOG\s*=\s*(\{.*?\});/s);
      if (match) catalogData = JSON.parse(match[1]);
    } catch (e) {}
  }
  if (catalogData) return res.json(db.importCatalog(catalogData));
  res.status(400).json({ success: false, error: 'Nenhum catálogo encontrado.' });
});

/* ---------------- DIAGNÓSTICO SUPABASE ---------------- */
// EXIGE auth admin: expõe apenas estado de conexão, nunca chaves.
app.get('/api/admin/supabase-health', requireAdmin, async (req, res) => {
  try {
    const diag = await supabase.diagnose();
    res.json({ success: true, data: diag });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const isBadRequest = err.type === 'entity.parse.failed' || (err instanceof SyntaxError && err.status === 400);
  if (!isBadRequest) {
    console.error('[PODPAHH Server] Erro interno sem dados da requisição:', err.message);
  }
  res.status(isBadRequest ? 400 : 500).json({
    success: false,
    error: isBadRequest ? 'JSON inválido.' : 'Erro interno do servidor.'
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[PODPAHH Server] Rodando em http://localhost:${PORT}`);
    console.log(`[PODPAHH Admin] Painel: http://localhost:${PORT}/pages/admin.html`);
    console.log('[PODPAHH Admin] Login admin protegido ativo.');
    console.log('[PODPAHH Supabase] Client helpers carregados:', !!(supabase && supabase.createServerClient));
  });
}

module.exports = app;

