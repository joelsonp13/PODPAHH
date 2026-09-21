/* ================================================================
   PODPAHH — Local Database Service (SECURED)
   - Senhas com hash scrypt + salt aleatório (nunca texto puro)
   - Credenciais do admin no banco, nunca no código
   - Migração automática de senhas antigas no primeiro login
   ================================================================ */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_DB_FILE = path.join(__dirname, '..', 'data', 'podpahh_db.json');
let DB_FILE = DEFAULT_DB_FILE;
const SCRYPT_KEYLEN = 64;

// Permite que os testes apontem o banco para um arquivo temporário
function setDbPath(p) {
  DB_FILE = p;
}

/* ---------------- HASH DE SENHAS (scrypt + salt) ---------------- */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN).toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  // Formato novo: "salt:hash" (scrypt)
  if (stored.indexOf(':') !== -1) {
    const parts = stored.split(':');
    if (parts.length !== 2) return false;
    const salt = parts[0];
    const hash = parts[1];
    const check = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN).toString('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
    } catch (e) { return false; }
  }
  // Migração automática: formatos antigos
  // - texto puro
  // - sha256 sem salt (64 hex)
  const plainMatch = password === stored;
  const shaMatch = stored.length === 64 &&
    crypto.createHash('sha256').update(String(password)).digest('hex') === stored;
  return plainMatch || shaMatch;
}

/* ---------------- SESSÕES ADMIN (em memória) ---------------- */
const sessions = new Map(); // token -> expiresAt
const SESSION_TTL = 8 * 60 * 60 * 1000;

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL);
  return token;
}

function verifySession(token) {
  if (!token) return false;
  const expires = sessions.get(token);
  if (!expires) return false;
  if (Date.now() > expires) { sessions.delete(token); return false; }
  return true;
}

function adminLogout(token) {
  sessions.delete(token);
  return { success: true };
}

/* ---------------- SESSÕES DO CLIENTE (em memória) ---------------- */
const customerSessions = new Map(); // token -> {customer_id, expiresAt}
const CUSTOMER_SESSION_TTL = 8 * 60 * 60 * 1000; // 8 horas

function createCustomerSessionToken(customerId) {
  const token = crypto.randomBytes(32).toString('hex');
  customerSessions.set(token, {
    customer_id: customerId,
    expires_at: Date.now() + CUSTOMER_SESSION_TTL
  });
  return token;
}

function verifyCustomerSession(token) {
  if (!token) return false;
  const session = customerSessions.get(token);
  if (!session) return false;
  if (Date.now() > session.expires_at) {
    customerSessions.delete(token);
    return false;
  }
  return true;
}

function getCustomerSession(token) {
  if (!token || typeof token !== 'string') return null;
  const session = customerSessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expires_at) {
    customerSessions.delete(token);
    return null;
  }
  return { customer_id: session.customer_id, expires_at: session.expires_at };
}

function logoutCustomer(token) {
  customerSessions.delete(token);
  return { success: true };
}

/* ---------------- ARQUIVO DO BANCO ---------------- */
function ensureDb() {
  const dir = path.dirname(DB_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    const initial = { customers: [], orders: [], products: [], logs: [], settings: {} };
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf8');
  }
}

function readDb() {
  ensureDb();
  try {
    // stripBOM: PowerShell/Windows às vezes salva com BOM, o que quebra o JSON.parse
    const raw = fs.readFileSync(DB_FILE, 'utf8').replace(/^\uFEFF/, '');
    const data = JSON.parse(raw);
    if (!data.customers) data.customers = [];
    if (!data.orders) data.orders = [];
    if (!data.products) data.products = [];
    if (!data.logs) data.logs = [];
    if (!data.addresses) data.addresses = [];
    if (!data.settings) data.settings = {};
    if (!data.settings.admin) data.settings.admin = null;
    return data;
  } catch (err) {
    // Corrompido? Faz backup em vez de sobrescrever silenciosamente (evita perda de dados)
    try {
      if (fs.existsSync(DB_FILE)) {
        const backup = DB_FILE + '.corrupt_' + Date.now();
        fs.copyFileSync(DB_FILE, backup);
        console.error('[PODPAHH DB] Arquivo corrompido! Backup salvo em:', backup, '| Erro:', err.message);
      }
    } catch (e2) {}
    return { customers: [], orders: [], products: [], logs: [], settings: {} };
  }
}

function writeDb(data) {
  ensureDb();
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

/* ---------------- ADMIN ----------------
   Credenciais ficam no banco (settings.admin), NUNCA no código.
   No 1º boot cria "admin / podpahh2026" — troque no painel. */
function getAdmin() {
  const db = readDb();
  if (!db.settings.admin) {
    db.settings.admin = {
      username: 'admin',
      pass_hash: hashPassword('podpahh2026')
    };
    writeDb(db);
  }
  return db.settings.admin;
}

function adminLogin(user, pass) {
  const admin = getAdmin();
  const userOk = String(user || '') === admin.username;
  const passOk = userOk && verifyPassword(pass, admin.pass_hash);
  if (userOk && passOk) {
    return { success: true, token: createSession() };
  }
  return { success: false, error: 'Usuário ou senha incorretos.' };
}

function changeAdminPassword(currentPass, newPass) {
  const admin = getAdmin();
  if (!verifyPassword(currentPass, admin.pass_hash)) {
    return { success: false, error: 'Senha atual incorreta.' };
  }
  if (!newPass || String(newPass).length < 8) {
    return { success: false, error: 'A nova senha precisa ter no mínimo 8 caracteres.' };
  }
  const db = readDb();
  db.settings.admin.pass_hash = hashPassword(newPass);
  writeDb(db);
  return { success: true };
}

/* ---------------- TELEFONE ---------------- */
function normalizePhone(phone) {
  if (!phone) return '';
  let digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length > 11) digits = digits.slice(2);
  return digits;
}

function isValidPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length !== 11) return false;
  const ddd = parseInt(digits.substring(0, 2), 10);
  if (ddd < 11 || ddd > 99) return false;
  if (digits[2] !== '9') return false;
  return true;
}

/* ---------------- CUSTOMERS ---------------- */
function registerCustomer(name, email, password, phone) {
  const db = readDb();
  const existing = db.customers.find(c => c.email.toLowerCase() === String(email || '').toLowerCase());
  if (existing) return { success: false, error: 'Este e-mail já está cadastrado no sistema.' };

  // Telefone é OBRIGATÓRIO no cadastro
  const digits = normalizePhone(phone);
  if (!digits) return { success: false, error: 'WhatsApp é obrigatório. Informe seu número com DDD.' };
  if (!isValidPhone(digits)) {
    return { success: false, error: 'Número de WhatsApp inválido. Use o formato (41) 99999-9999 (celular, começando com 9).' };
  }
  const phoneOwner = db.customers.find(c => c.phone === digits);
  if (phoneOwner) return { success: false, error: 'Este número de WhatsApp já está cadastrado em outra conta.' };

  const newCustomer = {
    id: 'usr_' + Date.now(),
    name: name,
    email: String(email).toLowerCase(),
    password: hashPassword(password), // nunca texto puro
    phone: digits,
    created_at: new Date().toISOString()
  };
  db.customers.push(newCustomer);
  writeDb(db);
  const { password: _, ...safeCustomer } = newCustomer;
  return { success: true, data: safeCustomer };
}

function loginCustomer(email, password, phone) {
  const db = readDb();
  const digits = normalizePhone(phone);

  // Telefone é OBRIGATÓRIO no login
  if (!digits) return { success: false, error: 'Informe seu número de WhatsApp com DDD para entrar.' };
  if (!isValidPhone(digits)) {
    return { success: false, error: 'Número de WhatsApp inválido. Use o formato (41) 99999-9999.' };
  }

  const customer = db.customers.find(c =>
    c.email.toLowerCase() === String(email || '').toLowerCase() ||
    (c.name || '').toLowerCase() === String(email || '').toLowerCase()
  );
  if (!customer) return { success: false, error: 'Conta não encontrada. Verifique e-mail/WhatsApp.' };
  if (!verifyPassword(password, customer.password)) {
    return { success: false, error: 'Senha incorreta.' };
  }

  // Telefone precisa bater com o da conta
  if (customer.phone !== digits) {
    return { success: false, error: 'Este número de WhatsApp não pertence a esta conta. Use o número cadastrado.' };
  }

  // Migração automática: se a senha ainda está em formato antigo, converte para hash
  if (customer.password.indexOf(':') === -1) {
    customer.password = hashPassword(password);
    writeDb(db);
  }

  const { password: _, ...safeCustomer } = customer;
  const token = createCustomerSessionToken(customer.id);
  return { success: true, token, data: safeCustomer };
}

/* ---------------- ORDERS ---------------- */
function saveOrder(orderData) {
  const db = readDb();

  // Endereço de entrega é OBRIGATÓRIO: pedido não pode ser salvo sem um.
  // Aceita o snapshot texto (address) OU o id de endereço cadastrado (address_id).
  const hasAddressId = orderData && orderData.address_id && String(orderData.address_id).trim();
  const hasAddressText = orderData && orderData.address && String(orderData.address).trim();
  if (!hasAddressId && !hasAddressText) {
    return { success: false, status: 400, error: 'Endereço de entrega obrigatório. Adicione um endereço antes de finalizar o pedido.' };
  }

  const order = { id: 'ord_' + Date.now(), ...orderData, created_at: new Date().toISOString() };
  db.orders.unshift(order);
  writeDb(db);
  return { success: true, data: order };
}

function getOrders() { return readDb().orders || []; }
function getCustomers() { return (readDb().customers || []).map(({ password, ...r }) => r); }
function getProducts() { return readDb().products || []; }

/* ---------------- PRODUCTS ---------------- */
function saveProduct(productData) {
  const db = readDb();
  if (!db.products) db.products = [];

  if (productData.id) {
    const index = db.products.findIndex(p => p.id === productData.id);
    if (index >= 0) {
      db.products[index] = {
        ...db.products[index],
        name: productData.name,
        price: parseFloat(productData.price) || 0,
        old_price: productData.old_price ? parseFloat(productData.old_price) : 0,
        category: productData.category,
        image: productData.image,
        stock: parseInt(productData.stock) || 0,
        description: productData.description,
        updated_at: new Date().toISOString()
      };
      writeDb(db);
      return { success: true, data: db.products[index] };
    }
  }

  const newProduct = {
    id: 'prod_' + Date.now(),
    name: productData.name || 'Novo Produto',
    price: parseFloat(productData.price) || 0,
    old_price: productData.old_price ? parseFloat(productData.old_price) : 0,
    category: productData.category || 'descartaveis',
    image: productData.image || '',
    stock: parseInt(productData.stock) || 10,
    description: productData.description || '',
    created_at: new Date().toISOString()
  };
  db.products.push(newProduct);
  writeDb(db);
  return { success: true, data: newProduct };
}

function deleteProduct(id) {
  const db = readDb();
  if (!db.products) return { success: false, error: 'Nenhum produto.' };
  db.products = db.products.filter(p => p.id !== id);
  writeDb(db);
  return { success: true };
}

function importCatalog(catalogObj) {
  const db = readDb();
  if (!db.products) db.products = [];
  let count = 0;
  for (let key in catalogObj) {
    let item = catalogObj[key];
    let exists = db.products.find(p => p.name.toLowerCase() === item.name.toLowerCase());
    if (!exists) {
      db.products.push({
        id: 'prod_scraped_' + Date.now() + '_' + count,
        name: item.name,
        price: parseFloat(item.price) || 0,
        old_price: 0,
        category: 'descartaveis',
        image: item.img || '',
        stock: 50,
        description: item.brand ? 'Marca: ' + item.brand : '',
        created_at: new Date().toISOString()
      });
      count++;
    }
  }
  writeDb(db);
  return { success: true, imported: count };
}

/* ---------------- ADDRESSES (catálogo de endereços do cliente) ---------------- */
function findCustomerById(db, customerId) {
  return (db.customers || []).find(c => c.id === customerId);
}

function createAddress(customerId, addr) {
  const db = readDb();
  if (!findCustomerById(db, customerId)) {
    return { success: false, status: 404, error: 'Cliente não encontrado.' };
  }
  if (!addr || typeof addr !== 'object') {
    return { success: false, status: 400, error: 'Dados do endereço obrigatórios.' };
  }

  // Campos obrigatórios
  const required = ['recipient_name', 'phone', 'postal_code', 'street', 'number', 'neighborhood', 'city', 'state'];
  for (let field of required) {
    if (!addr[field] || !String(addr[field]).trim()) {
      return { success: false, status: 400, error: 'Campo obrigatório ausente: ' + field };
    }
  }

  // CEP: 8 dígitos após remover pontuação
  const cep = String(addr.postal_code).replace(/\D/g, '');
  if (cep.length !== 8) {
    return { success: false, status: 400, error: 'CEP inválido. Use 8 dígitos (ex: 80000-000).' };
  }

  // UF: 2 letras
  if (!/^[A-Za-z]{2}$/.test(String(addr.state))) {
    return { success: false, status: 400, error: 'UF inválida. Use 2 letras (ex: PR).' };
  }

  const newAddress = {
    id: 'addr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    customer_id: customerId,
    label: String(addr.label || '').trim() || 'Endereço',
    recipient_name: String(addr.recipient_name).trim(),
    phone: normalizePhone(addr.phone) || String(addr.phone).trim(),
    postal_code: cep,
    street: String(addr.street).trim(),
    number: String(addr.number).trim(),
    complement: String(addr.complement || '').trim(),
    neighborhood: String(addr.neighborhood).trim(),
    city: String(addr.city).trim(),
    state: String(addr.state).toUpperCase(),
    is_default: addr.is_default === true || addr.is_default === 'true',
    created_at: new Date().toISOString()
  };

  if (!Array.isArray(db.addresses)) db.addresses = [];

  // Se marcar como padrão, desmarca os outros do mesmo cliente
  if (newAddress.is_default) {
    db.addresses.forEach(a => {
      if (a.customer_id === customerId) a.is_default = false;
    });
  } else if (!db.addresses.some(a => a.customer_id === customerId)) {
    // Primeiro endereço do cliente vira padrão automaticamente
    newAddress.is_default = true;
  }

  db.addresses.push(newAddress);
  writeDb(db);
  return { success: true, data: newAddress };
}

function listAddresses(customerId) {
  const db = readDb();
  return (db.addresses || [])
    .filter(a => a.customer_id === customerId)
    .sort((a, b) => (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0));
}

function getAddress(customerId, addressId) {
  const db = readDb();
  const addr = (db.addresses || []).find(a => a.id === addressId);
  if (!addr) return { success: false, status: 404, error: 'Endereço não encontrado.' };
  // Isolamento por proprietário: cliente só acessa endereço próprio
  if (addr.customer_id !== customerId) {
    return { success: false, forbidden: true, status: 403, error: 'Este endereço não pertence a este cliente.' };
  }
  return { success: true, data: addr };
}

function deleteAddress(customerId, addressId) {
  const db = readDb();
  const addr = (db.addresses || []).find(a => a.id === addressId);
  if (!addr) return { success: false, status: 404, error: 'Endereço não encontrado.' };
  if (addr.customer_id !== customerId) {
    return { success: false, forbidden: true, status: 403, error: 'Este endereço não pertence a este cliente.' };
  }
  db.addresses = db.addresses.filter(a => a.id !== addressId);
  // Se removido o padrão, promove o primeiro restante
  if (addr.is_default) {
    const remaining = db.addresses.filter(a => a.customer_id === customerId);
    if (remaining.length) remaining[0].is_default = true;
  }
  writeDb(db);
  return { success: true };
}

/* ---------------- CONFIGURAÇÕES (WhatsApp da loja) ---------------- */
function getSettings() {
  const db = readDb();
  return {
    whatsapp: db.settings.whatsapp || '5547999453628',
    whatsapp_message: db.settings.whatsapp_message || ''
  };
}

function saveSettings(settings) {
  const db = readDb();
  if (!db.settings) db.settings = {};
  if (settings.whatsapp !== undefined) {
    let digits = String(settings.whatsapp).replace(/\D/g, '');
    if (digits.startsWith('55') && digits.length > 11) digits = digits.slice(2);
    if (digits.length !== 11 && digits.length !== 10) {
      return { success: false, error: 'Número inválido. Use DDD + número (ex: 45 99999-9999).' };
    }
    db.settings.whatsapp = digits;
  }
  if (settings.whatsapp_message !== undefined) {
    db.settings.whatsapp_message = String(settings.whatsapp_message || '').slice(0, 500);
  }
  writeDb(db);
  return { success: true, data: getSettings() };
}

module.exports = {
  setDbPath,

  adminLogin,
  adminLogout,
  verifySession,
  changeAdminPassword,

  registerCustomer,
  loginCustomer,
  verifyCustomerSession,
  getCustomerSession,
  logoutCustomer,

  createAddress,
  listAddresses,
  getAddress,
  deleteAddress,

  saveOrder,
  getOrders,
  getCustomers,
  getProducts,

  saveProduct,
  deleteProduct,
  importCatalog,

  getSettings,
  saveSettings
};
