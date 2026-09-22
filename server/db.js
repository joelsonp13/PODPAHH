/* ================================================================
   PODPAHH — Local Database Service (SECURED)
   - Senhas com hash scrypt + salt aleatório (nunca texto puro)
   - Credenciais do admin no banco, nunca no código
   - Migração automática de senhas antigas no primeiro login
   ================================================================ */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let DB_FILE = path.join(__dirname, '..', 'data', 'podpahh_db.json');

function setDbPath(dbPath) {
  DB_FILE = path.resolve(dbPath);
}

const SCRYPT_KEYLEN = 64;

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

/* ---------------- SESSÕES (ADMIN E CLIENTES SÃO ISOLADAS) ---------------- */
const sessions = new Map(); // token -> expiresAt
const customerSessions = new Map(); // token -> { customer_id, expires_at }
const SESSION_TTL = 8 * 60 * 60 * 1000;
const CUSTOMER_SESSION_TTL = 8 * 60 * 60 * 1000;

// Sessões persistidas em disco: o login sobrevive a reinícios do servidor.
// (/data é bloqueada no HTTP pelo servidor, então os tokens nunca vazam.)
const SESSION_FILE = path.join(__dirname, '..', 'data', 'podpahh_sessions.json');

function saveSessions() {
  try {
    const data = { admin: {}, customer: {} };
    sessions.forEach((expiresAt, token) => { data.admin[token] = expiresAt; });
    customerSessions.forEach((s, token) => { data.customer[token] = s; });
    fs.writeFileSync(SESSION_FILE, JSON.stringify(data), 'utf8');
  } catch (e) { /* disco indisponível: sessões seguem só em RAM */ }
}

function loadSessions() {
  try {
    if (!fs.existsSync(SESSION_FILE)) return;
    const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    const now = Date.now();
    Object.keys((data && data.admin) || {}).forEach((token) => {
      const exp = Number(data.admin[token]);
      if (exp > now) sessions.set(token, exp);
    });
    Object.keys((data && data.customer) || {}).forEach((token) => {
      const s = data.customer[token];
      if (s && s.customer_id && Number(s.expires_at) > now) {
        customerSessions.set(token, { customer_id: s.customer_id, expires_at: Number(s.expires_at) });
      }
    });
  } catch (e) { /* arquivo corrompido: começa sem sessões */ }
}

loadSessions();

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL);
  saveSessions();
  return token;
}

function createCustomerSessionToken(customerId) {
  const token = crypto.randomBytes(32).toString('hex');
  customerSessions.set(token, {
    customer_id: customerId,
    expires_at: Date.now() + CUSTOMER_SESSION_TTL
  });
  saveSessions();
  return token;
}

function verifySession(token) {
  if (!token) return false;
  const expires = sessions.get(token);
  if (!expires) return false;
  if (Date.now() > expires) { sessions.delete(token); saveSessions(); return false; }
  return true;
}

function getCustomerSession(token) {
  if (typeof token !== 'string' || !token) return null;
  const session = customerSessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expires_at) {
    customerSessions.delete(token);
    saveSessions();
    return null;
  }
  return { customer_id: session.customer_id, expires_at: session.expires_at };
}

function verifyCustomerSession(token) {
  return Boolean(getCustomerSession(token));
}

function adminLogout(token) {
  sessions.delete(token);
  saveSessions();
  return { success: true };
}

function logoutCustomer(token) {
  customerSessions.delete(token);
  saveSessions();
  return { success: true };
}

/* ---------------- ARQUIVO DO BANCO ---------------- */
function emptyDb() {
  return {
    customers: [],
    orders: [],
    products: [],
    logs: [],
    addresses: [],
    wishlist: [],
    resets: [],
    settings: {}
  };
}

function ensureDb() {
  const dir = path.dirname(DB_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(emptyDb(), null, 2), 'utf8');
  }
}

function readDb() {
  ensureDb();
  try {
    // stripBOM: PowerShell/Windows às vezes salva com BOM, o que quebra o JSON.parse
    const raw = fs.readFileSync(DB_FILE, 'utf8').replace(/^\uFEFF/, '');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('O arquivo do banco não contém um objeto JSON.');
    }

    // Preserva coleções e campos futuros; apenas normaliza o modelo conhecido.
    if (!Array.isArray(data.customers)) data.customers = [];
    if (!Array.isArray(data.orders)) data.orders = [];
    if (!Array.isArray(data.products)) data.products = [];
    if (!Array.isArray(data.logs)) data.logs = [];
    if (!Array.isArray(data.addresses)) data.addresses = [];
    if (!Array.isArray(data.wishlist)) data.wishlist = [];
    if (!Array.isArray(data.resets)) data.resets = [];
    if (!data.settings || typeof data.settings !== 'object' || Array.isArray(data.settings)) {
      data.settings = {};
    }
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
    return emptyDb();
  }
}

function writeDb(data) {
  ensureDb();
  const persisted = data && typeof data === 'object' && !Array.isArray(data) ? data : emptyDb();
  // A coleção pode faltar em bancos antigos; criá-la sem descartar o restante.
  if (!Array.isArray(persisted.addresses)) persisted.addresses = [];
  if (!Array.isArray(persisted.wishlist)) persisted.wishlist = [];
  if (!Array.isArray(persisted.resets)) persisted.resets = [];
  fs.writeFileSync(DB_FILE, JSON.stringify(persisted, null, 2), 'utf8');
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

function isValidAddressPhone(phone) {
  const digits = normalizePhone(phone);
  if (digits.length !== 10 && digits.length !== 11) return false;
  const ddd = parseInt(digits.substring(0, 2), 10);
  if (ddd < 11 || ddd > 99) return false;
  if (digits.length === 11 && digits[2] !== '9') return false;
  return true;
}

/* ---------------- CUSTOMERS ---------------- */
function safeCustomer(customer) {
  if (!customer) return null;
  const { password, ...safe } = customer;
  return safe;
}

async function registerCustomer(name, email, password, phone) {
  const db = readDb();
  const existing = db.customers.find(c => c.email.toLowerCase() === String(email || '').toLowerCase());
  if (existing) return { success: false, status: 400, error: 'Este e-mail já está cadastrado no sistema.' };

  // Telefone é OBRIGATÓRIO no cadastro
  const digits = normalizePhone(phone);
  if (!digits) return { success: false, status: 400, error: 'WhatsApp é obrigatório. Informe seu número com DDD.' };
  if (!isValidPhone(digits)) {
    return { success: false, status: 400, error: 'Número de WhatsApp inválido. Use o formato (41) 99999-9999 (celular, começando com 9).' };
  }
  const phoneOwner = db.customers.find(c => c.phone === digits);
  if (phoneOwner) return { success: false, status: 400, error: 'Este número de WhatsApp já está cadastrado em outra conta.' };

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
  // Espelha no Supabase Auth (best-effort): habilita recovery por e-mail.
  try {
    await ensureAuthUserSafe(newCustomer, password);
  } catch (e) { /* sem Supabase configurado: segue só local */ }
  return { success: true, data: safeCustomer(newCustomer) };
}

// Mirror no Auth sem nunca quebrar o cadastro (falta de env, offline etc.)
async function ensureAuthUserSafe(customer, rawPassword) {
  try {
    const admin = supaAdmin();
    const { error } = await admin.auth.admin.createUser({
      email: customer.email,
      password: String(rawPassword),
      email_confirm: true,
      user_metadata: { name: customer.name, customer_id: customer.id }
    });
    if (error && !/already|registered|exists/i.test(String(error.message || ''))) throw error;
  } catch (e) {
    throw e;
  }
}

function loginCustomer(email, password, phone) {
  return createCustomerSession(email, password, phone);
}

// Atualiza nome + WhatsApp da própria conta (e-mail é imutável).
function updateCustomer(customerId, input) {
  if (!isValidCustomerId(customerId)) {
    return { success: false, status: 400, error: 'Cliente inválido.' };
  }
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const name = String(src.name || '').trim().replace(/\s+/g, ' ').slice(0, 200);
  if (name.length < 2) {
    return { success: false, status: 400, error: 'Informe seu nome completo.' };
  }
  const digits = normalizePhone(src.phone);
  if (!digits || !isValidPhone(digits)) {
    return { success: false, status: 400, error: 'WhatsApp inválido. Use (41) 99999-9999.' };
  }
  const db = readDb();
  const me = db.customers.find(c => c && c.id === customerId);
  if (!me) return { success: false, status: 404, error: 'Conta não encontrada.' };
  const owner = db.customers.find(c => c && c.id !== customerId && c.phone === digits);
  if (owner) {
    return { success: false, status: 400, error: 'Este WhatsApp já está em outra conta.' };
  }
  me.name = name;
  me.phone = digits;
  writeDb(db);
  return { success: true, data: safeCustomer(me) };
}function createCustomerSession(email, password, phone) {
  const db = readDb();
  const digits = normalizePhone(phone);

  // Telefone OPCIONAL no login (só o cadastro exige). Se informado, valida.
  let phoneCheck = '';
  if (digits) {
    if (!isValidPhone(digits)) {
      return { success: false, status: 400, error: 'Número de WhatsApp inválido. Use o formato (41) 99999-9999.' };
    }
    phoneCheck = digits;
  }

  const normalizedEmail = String(email || '').trim().toLowerCase();
  const customer = db.customers.find(c =>
    String(c.email || '').toLowerCase() === normalizedEmail ||
    String(c.name || '').toLowerCase() === normalizedEmail
  );
  if (!customer) return { success: false, status: 401, error: 'Conta não encontrada. Verifique e-mail/WhatsApp.' };
  if (!verifyPassword(password, customer.password)) {
    return { success: false, status: 401, error: 'Senha incorreta.' };
  }

  // Telefone, se informado no login, precisa bater com o da conta
  if (phoneCheck && customer.phone !== phoneCheck) {
    return { success: false, status: 401, error: 'Este número de WhatsApp não pertence a esta conta. Use o número cadastrado.' };
  }

  // Migração automática: se a senha ainda está em formato antigo, converte para hash
  if (customer.password.indexOf(':') === -1) {
    customer.password = hashPassword(password);
    writeDb(db);
  }

  const token = createCustomerSessionToken(customer.id);
  return { success: true, token, data: safeCustomer(customer) };
}

/* ---------------- ENDEREÇOS ---------------- */
const ADDRESS_FIELDS = Object.freeze({
  label: 80,
  recipient_name: 100,
  phone: 20,
  postal_code: 12,
  street: 160,
  number: 20,
  complement: 80,
  neighborhood: 120,
  city: 100,
  state: 2
});

const ADDRESS_TEXT_FIELDS = [
  ['label', ADDRESS_FIELDS.label, false],
  ['recipient_name', ADDRESS_FIELDS.recipient_name, true],
  ['street', ADDRESS_FIELDS.street, true],
  ['number', ADDRESS_FIELDS.number, true],
  ['complement', ADDRESS_FIELDS.complement, false],
  ['neighborhood', ADDRESS_FIELDS.neighborhood, true],
  ['city', ADDRESS_FIELDS.city, true],
  ['state', ADDRESS_FIELDS.state, true]
];

function normalizeText(value, maxLength) {
  const normalized = String(value ?? '').trim().replace(/\s+/g, ' ');
  return normalized.length <= maxLength ? normalized : null;
}

function addressValidationError(error) {
  return { success: false, status: 400, error };
}

function normalizeAddress(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return addressValidationError('O endereço deve ser um objeto JSON.');
  }

  const allowedFields = new Set([...Object.keys(ADDRESS_FIELDS), 'is_default']);
  const extraFields = Object.keys(input).filter(key => !allowedFields.has(key));
  if (extraFields.length > 0) {
    return addressValidationError(`Campo(s) extra não permitido(s): ${extraFields.join(', ')}.`);
  }

  const normalized = {};
  for (const [field, maxLength, required] of ADDRESS_TEXT_FIELDS) {
    const provided = Object.prototype.hasOwnProperty.call(input, field);
    if (provided && typeof input[field] !== 'string') {
      return addressValidationError(`O campo ${field} deve ser textual.`);
    }
    const value = provided ? input[field] : '';
    const normalizedValue = normalizeText(value, maxLength);
    if (normalizedValue === null) {
      return addressValidationError(`O campo ${field} excede o limite de ${maxLength} caracteres.`);
    }
    if (required && !normalizedValue) {
      return addressValidationError(`O campo ${field} é obrigatório.`);
    }
    normalized[field] = normalizedValue;
  }

  const rawPhone = Object.prototype.hasOwnProperty.call(input, 'phone') ? input.phone : '';
  if (typeof rawPhone !== 'string') {
    return addressValidationError('O campo phone deve ser textual.');
  }
  if (!/^[0-9\s()+.-]+$/.test(rawPhone)) {
    return addressValidationError('O campo phone contém caracteres inválidos.');
  }
  normalized.phone = normalizePhone(rawPhone);
  if (!normalized.phone || !isValidAddressPhone(normalized.phone)) {
    return addressValidationError('O campo phone deve conter DDD + número com 10 ou 11 dígitos.');
  }

  const rawPostalCode = Object.prototype.hasOwnProperty.call(input, 'postal_code') ? input.postal_code : '';
  if (typeof rawPostalCode !== 'string') {
    return addressValidationError('O campo postal_code deve ser textual.');
  }
  if (!/^[0-9\s-]+$/.test(rawPostalCode)) {
    return addressValidationError('O campo postal_code contém caracteres inválidos.');
  }
  normalized.postal_code = normalizePhone(rawPostalCode);
  if (normalized.postal_code.length !== 8) {
    return addressValidationError('O campo postal_code deve conter exatamente 8 dígitos.');
  }

  normalized.state = normalized.state.toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized.state)) {
    return addressValidationError('O campo state deve conter exatamente duas letras.');
  }

  if (Object.prototype.hasOwnProperty.call(input, 'is_default') && typeof input.is_default !== 'boolean') {
    return addressValidationError('O campo is_default deve ser booleano.');
  }
  normalized.is_default = input.is_default === true;
  return { success: true, data: normalized };
}

function isValidCustomerId(customerId) {
  return typeof customerId === 'string' && customerId.length > 0;
}

function safeAddress(address) {
  if (!address || typeof address !== 'object') return null;
  const { password, token, customer, ...safe } = address;
  return safe;
}

function listAddresses(customerId) {
  if (!isValidCustomerId(customerId)) return [];
  const db = readDb();
  return db.addresses
    .filter(address => address && address.customer_id === customerId)
    .map(safeAddress)
    .filter(Boolean);
}

function getAddress(customerId, addressId) {
  if (!isValidCustomerId(customerId) || typeof addressId !== 'string' || !addressId) return null;
  const address = readDb().addresses.find(item => item && item.id === addressId);
  if (!address) return null;
  if (address.customer_id !== customerId) return { forbidden: true };
  return safeAddress(address);
}

function createAddress(customerId, input) {
  if (!isValidCustomerId(customerId)) {
    return { success: false, status: 400, error: 'Cliente inválido.' };
  }
  const validation = normalizeAddress(input);
  if (!validation.success) return validation;

  const db = readDb();
  if (!db.customers.some(customer => customer && customer.id === customerId)) {
    return { success: false, status: 404, error: 'Cliente não encontrado.' };
  }

  let id;
  do {
    id = `addr_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
  } while (db.addresses.some(address => address.id === id));

  const now = new Date().toISOString();
  const address = {
    id,
    customer_id: customerId,
    ...validation.data,
    is_default: validation.data.is_default,
    created_at: now,
    updated_at: now
  };

  if (address.is_default) {
    for (const existing of db.addresses) {
      if (existing.customer_id === customerId) existing.is_default = false;
    }
  }
  db.addresses.push(address);
  writeDb(db);
  return { success: true, data: safeAddress(address) };
}

function updateAddress(customerId, addressId, input) {
  if (!isValidCustomerId(customerId) || typeof addressId !== 'string' || !addressId) {
    return { success: false, status: 400, error: 'Identificadores inválidos.' };
  }
  const validation = normalizeAddress(input);
  if (!validation.success) return validation;

  const db = readDb();
  const index = db.addresses.findIndex(address => address && address.id === addressId);
  if (index < 0) return { success: false, status: 404, error: 'Endereço não encontrado.' };
  const current = db.addresses[index];
  if (current.customer_id !== customerId) {
    return { success: false, status: 403, error: 'Endereço não pertence a este cliente.' };
  }

  const merged = {
    ...current,
    ...validation.data,
    is_default: Object.prototype.hasOwnProperty.call(input, 'is_default')
      ? validation.data.is_default
      : current.is_default === true,
    updated_at: new Date().toISOString()
  };

  if (merged.is_default) {
    for (const existing of db.addresses) {
      if (existing.customer_id === customerId && existing.id !== addressId) {
        existing.is_default = false;
      }
    }
  }
  db.addresses[index] = merged;
  writeDb(db);
  return { success: true, data: safeAddress(merged) };
}

function promoteOldestDefault(db, customerId, now) {
  const remaining = db.addresses.filter(address => address && address.customer_id === customerId);
  for (const address of remaining) address.is_default = false;
  if (remaining.length === 0) return;
  remaining.sort((a, b) => {
    const aTime = Date.parse(a.created_at);
    const bTime = Date.parse(b.created_at);
    if (Number.isFinite(aTime) && Number.isFinite(bTime)) return aTime - bTime;
    if (Number.isFinite(aTime)) return -1;
    if (Number.isFinite(bTime)) return 1;
    return 0;
  });
  remaining[0].is_default = true;
  remaining[0].updated_at = now;
}

function deleteAddress(customerId, addressId) {
  if (!isValidCustomerId(customerId) || typeof addressId !== 'string' || !addressId) {
    return { success: false, status: 400, error: 'Identificadores inválidos.' };
  }
  const db = readDb();
  const index = db.addresses.findIndex(address => address && address.id === addressId);
  if (index < 0) return { success: false, status: 404, error: 'Endereço não encontrado.' };
  const current = db.addresses[index];
  if (current.customer_id !== customerId) {
    return { success: false, status: 403, error: 'Endereço não pertence a este cliente.' };
  }

  const wasDefault = current.is_default === true;
  db.addresses.splice(index, 1);
  if (wasDefault) {
    promoteOldestDefault(db, customerId, new Date().toISOString());
  }
  writeDb(db);
  return { success: true };
}

/* ---------------- PASSWORD RESET (e-mail do Supabase Auth) ----------------
   Contas vivem em public.customers, mas são ESPELHADAS em auth.users para
   usar o sistema de e-mail do Supabase (recovery):
   1. forgot: garante auth.user (createUser c/ senha aleatória se faltar) e
      dispara supabase.auth.resetPasswordForEmail (redirect p/ minha-conta).
   2. Cliente clica no link -> sessão PASSWORD_RECOVERY no navegador.
   3. resetSupabase: frontend manda o access_token; servidor confere o dono
      via auth.getUser, atualiza o hash local + senha do auth, derruba
      sessões antigas e devolve sessão própria. */
let _supaAdmin = null;
let _supaAnon = null;
function supaEnv() {
  return {
    url: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY,
    anonKey: process.env.SUPABASE_ANON_KEY
  };
}
function supaAdmin() {
  if (!_supaAdmin) {
    const { url, serviceKey } = supaEnv();
    if (!url || !serviceKey) throw new Error('Supabase não configurado (SUPABASE_URL / SERVICE_ROLE).');
    _supaAdmin = require('@supabase/supabase-js').createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
  }
  return _supaAdmin;
}
function supaAnon() {
  if (!_supaAnon) {
    const { url, anonKey } = supaEnv();
    if (!url || !anonKey) throw new Error('Supabase não configurado (SUPABASE_URL / ANON).');
    _supaAnon = require('@supabase/supabase-js').createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
  }
  return _supaAnon;
}
function recoveryRedirect() {
  const base = String(process.env.APP_URL || 'https://podpahh.vercel.app').replace(/\/+$/, '');
  return base + '/pedevapor-shop/pages/minha-conta.html';
}

// Garante entrada em auth.users (idempotente). Senha aleatória: o login
// continua pelo hash local; o auth serve só p/ e-mails de recovery.
async function ensureAuthUser(customer) {
  const admin = supaAdmin();
  const { data, error } = await admin.auth.admin.createUser({
    email: customer.email,
    password: crypto.randomBytes(24).toString('hex'),
    email_confirm: true,
    user_metadata: { name: customer.name, customer_id: customer.id }
  });
  if (!error) return data.user;
  const msg = String((error && error.message) || '');
  if (/already|registered|exists/i.test(msg)) return null; // já existe: ok
  throw new Error(msg || 'Falha ao espelhar conta no Auth.');
}

async function requestPasswordReset(email) {
  const mail = String(email || '').trim().toLowerCase();
  if (!mail || mail.indexOf('@') === -1) {
    return { success: false, status: 400, error: 'Informe um e-mail válido.' };
  }
  const db = readDb();
  const customer = db.customers.find(c => String(c.email || '').toLowerCase() === mail);
  // Anti-enumeração: resposta genérica sempre.
  if (!customer) return { success: true, data: { emailed: false } };
  try {
    await ensureAuthUser(customer);
    const { error } = await supaAnon().auth.resetPasswordForEmail(customer.email, {
      redirectTo: recoveryRedirect()
    });
    if (error) return { success: false, status: 502, error: 'Não foi possível enviar o e-mail. Tente mais tarde.' };
    return { success: true, data: { emailed: true } };
  } catch (err) {
    return { success: false, status: 502, error: err.message || 'Provedor de e-mail indisponível.' };
  }
}

// Troca via sessão de recovery do Supabase: prova = access_token válido.
async function resetPasswordSupabase(supaToken, newPass) {
  if (!newPass || String(newPass).length < 8) {
    return { success: false, status: 400, error: 'A nova senha precisa ter no mínimo 8 caracteres.' };
  }
  if (!supaToken) return { success: false, status: 400, error: 'Sessão de recuperação inválida.' };
  let authUser;
  try {
    const { data, error } = await supaAdmin().auth.getUser(String(supaToken));
    if (error || !data || !data.user) {
      return { success: false, status: 401, error: 'Link inválido ou expirado. Gere um novo.' };
    }
    authUser = data.user;
  } catch (err) {
    return { success: false, status: 401, error: 'Link inválido ou expirado. Gere um novo.' };
  }
  const mail = String(authUser.email || '').toLowerCase();
  const db = readDb();
  const customer = db.customers.find(c => String(c.email || '').toLowerCase() === mail);
  if (!customer) return { success: false, status: 404, error: 'Conta não encontrada.' };
  customer.password = hashPassword(newPass);
  writeDb(db);
  // Sincroniza a senha no Auth também (próximos recoveries/logins diretos)
  try {
    await supaAdmin().auth.admin.updateUserById(authUser.id, { password: String(newPass) });
  } catch (e) { /* hash local é a fonte da verdade do login */ }
  // Derruba sessões próprias antigas
  customerSessions.forEach((s, t) => {
    if (String(s.customer_id) === String(customer.id)) customerSessions.delete(t);
  });
  saveSessions();
  const token = createCustomerSessionToken(customer.id);
  return { success: true, token, data: safeCustomer(customer) };
}

// Compat antiga (Resend): removida — mantido só para não quebrar imports.
async function resetPassword() {
  return { success: false, status: 410, error: 'Fluxo antigo desativado. Use o link do e-mail.' };
}
async function resetPasswordByToken() {
  return resetPassword();
}

function listResets() { return []; }
function revokeReset() { return { success: false, status: 404, error: 'Recurso desativado.' }; }

/* ---------------- WISHLIST (FAVORITOS POR CONTA) ----------------
   Item: { id, customer_id, product_id, model_id ('': produto), created_at }
   Unicidade: 1 linha por (customer_id, product_id, model_id). */
function normalizeWishInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { success: false, status: 400, error: 'Dados do favorito inválidos.' };
  }
  const productId = String(input.product_id || '').slice(0, 120);
  if (!productId) {
    return { success: false, status: 400, error: 'product_id é obrigatório.' };
  }
  const modelId = String(input.model_id || '').slice(0, 120);
  return { success: true, data: { product_id: productId, model_id: modelId } };
}

function listWishlist(customerId) {
  if (!isValidCustomerId(customerId)) return [];
  const db = readDb();
  if (!Array.isArray(db.wishlist)) return [];
  return db.wishlist
    .filter(w => w && w.customer_id === customerId)
    .map(w => ({ id: w.id, product_id: w.product_id, model_id: w.model_id || '', created_at: w.created_at }));
}

function addWishlist(customerId, input) {
  if (!isValidCustomerId(customerId)) {
    return { success: false, status: 400, error: 'Cliente inválido.' };
  }
  const norm = normalizeWishInput(input);
  if (!norm.success) return norm;
  const db = readDb();
  if (!Array.isArray(db.wishlist)) db.wishlist = [];
  if (!db.customers.some(c => c && c.id === customerId)) {
    return { success: false, status: 404, error: 'Cliente não encontrado.' };
  }
  const exists = db.wishlist.find(w =>
    w && w.customer_id === customerId &&
    w.product_id === norm.data.product_id &&
    (w.model_id || '') === norm.data.model_id
  );
  if (exists) {
    return { success: true, data: { id: exists.id, product_id: exists.product_id, model_id: exists.model_id || '', created_at: exists.created_at }, wished: true };
  }
  const item = {
    id: 'wish_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex'),
    customer_id: customerId,
    product_id: norm.data.product_id,
    model_id: norm.data.model_id,
    created_at: new Date().toISOString()
  };
  db.wishlist.push(item);
  writeDb(db);
  return { success: true, data: { id: item.id, product_id: item.product_id, model_id: item.model_id, created_at: item.created_at }, wished: true };
}

function removeWishlist(customerId, input) {
  if (!isValidCustomerId(customerId)) {
    return { success: false, status: 400, error: 'Cliente inválido.' };
  }
  const norm = normalizeWishInput(input);
  if (!norm.success) return norm;
  const db = readDb();
  if (!Array.isArray(db.wishlist)) db.wishlist = [];
  const before = db.wishlist.length;
  db.wishlist = db.wishlist.filter(w =>
    !(w && w.customer_id === customerId &&
      w.product_id === norm.data.product_id &&
      (w.model_id || '') === norm.data.model_id)
  );
  if (db.wishlist.length !== before) writeDb(db);
  return { success: true, wished: false };
}

function toggleWishlist(customerId, input) {
  if (!isValidCustomerId(customerId)) {
    return { success: false, status: 400, error: 'Cliente inválido.' };
  }
  const norm = normalizeWishInput(input);
  if (!norm.success) return norm;
  const db = readDb();
  if (!Array.isArray(db.wishlist)) db.wishlist = [];
  const exists = db.wishlist.some(w =>
    w && w.customer_id === customerId &&
    w.product_id === norm.data.product_id &&
    (w.model_id || '') === norm.data.model_id
  );
  return exists ? removeWishlist(customerId, input) : addWishlist(customerId, input);
}

/* ---------------- ORDERS ---------------- */
// Validação dura do pedido: sem itens, sem nome/WhatsApp válido ou sem
// endereço, o pedido NÃO é salvo (nem local, nem WhatsApp avulso).
function validateOrderInput(source) {
  const fail = (error) => ({ success: false, status: 400, error });
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return fail('Dados do pedido inválidos.');
  }
  const items = (Array.isArray(source.items) ? source.items : []).filter(
    i => i && typeof i === 'object' && Number(i.qty) > 0 && String(i.name || '').trim()
  );
  if (!items.length) return fail('O pedido precisa de ao menos 1 item.');
  const total = Number(source.total);
  if (!(total > 0)) return fail('Total do pedido inválido.');
  const customer_name = String(source.customer_name || '').trim().slice(0, 200);
  if (!customer_name) return fail('Nome do cliente é obrigatório.');
  const customer_phone = normalizePhone(source.customer_phone);
  if (!customer_phone || !isValidAddressPhone(customer_phone)) {
    return fail('WhatsApp do cliente inválido (DDD + número).');
  }
  let addressText = '';
  if (typeof source.address === 'string') {
    addressText = source.address.trim();
  } else if (source.address && typeof source.address === 'object') {
    const a = source.address;
    addressText = [
      (a.street || '') + (a.number ? ', ' + a.number : ''),
      a.neighborhood || '', ((a.city || '') + (a.state ? '/' + a.state : '')),
      a.postal_code ? 'CEP ' + a.postal_code : ''
    ].filter(s => String(s).trim()).join(' — ');
  }
  if (!addressText) return fail('Endereço de entrega é obrigatório.');
  return {
    success: true,
    data: {
      items: items.map(i => ({
        id: String(i.id || '').slice(0, 120),
        name: String(i.name).trim().slice(0, 200),
        price: Math.max(0, Number(i.price) || 0),
        qty: Math.min(99, Math.max(1, parseInt(i.qty) || 1))
      })),
      subtotal: Number(source.subtotal) > 0 ? Number(source.subtotal) : total,
      total,
      customer_name,
      customer_phone,
      address: addressText.slice(0, 1000)
    }
  };
}

function saveOrder(orderData) {
  const db = readDb();
  const source = orderData && typeof orderData === 'object' && !Array.isArray(orderData) ? orderData : {};
  const v = validateOrderInput(source);
  if (!v.success) return v;
  const order = {
    id: 'ord_' + Date.now(),
    ...v.data,
    status: 'pendente',
    payment_method: String(source.payment_method || 'PIX').slice(0, 20),
    created_at: new Date().toISOString()
  };
  if (typeof source.customer_id === 'string' && source.customer_id) {
    order.customer_id = source.customer_id;
  }
  if (typeof source.address_id === 'string' && source.address_id) {
    order.address_id = source.address_id;
  }
  db.orders.unshift(order);
  writeDb(db);
  return { success: true, data: order };
}

function getOrders() { return readDb().orders || []; }

function getOrdersByCustomer(customerId) {
  if (!isValidCustomerId(customerId)) return [];
  return (readDb().orders || []).filter(o => o && String(o.customer_id) === String(customerId));
}

function updateOrderStatus(id, status) {
  // Bilíngue PT+EN para bater com o enum public.order_status do Supabase
  // (schema.sql) e com o painel admin. PT é o usado na UI.
  const allowed = ['pendente', 'confirmado', 'cancelado',
    'pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled'];
  if (!allowed.includes(status)) return { success: false, status: 400, error: 'Status inválido.' };
  const db = readDb();
  const order = (db.orders || []).find(o => String(o.id) === String(id));
  if (!order) return { success: false, status: 404, error: 'Pedido não encontrado.' };
  order.status = status;
  order.updated_at = new Date().toISOString();
  writeDb(db);
  return { success: true, data: order };
}

function deleteOrder(id) {
  const db = readDb();
  const before = (db.orders || []).length;
  db.orders = (db.orders || []).filter(o => String(o.id) !== String(id));
  if (db.orders.length === before) return { success: false, status: 404, error: 'Pedido não encontrado.' };
  writeDb(db);
  return { success: true };
}
function getCustomers() { return (readDb().customers || []).map(safeCustomer).filter(Boolean); }

function deleteCustomer(id) {
  const db = readDb();
  const before = (db.customers || []).length;
  db.customers = (db.customers || []).filter(c => String(c.id) !== String(id));
  if (db.customers.length === before) return { success: false, status: 404, error: 'Conta não encontrada.' };
  // limpa endereços e favoritos da conta
  db.addresses = (db.addresses || []).filter(a => String(a.customer_id) !== String(id));
  if (Array.isArray(db.wishlist)) db.wishlist = db.wishlist.filter(w => String(w.customer_id) !== String(id));
  // derruba sessões ativas dessa conta
  customerSessions.forEach((s, token) => {
    if (String(s.customer_id) === String(id)) customerSessions.delete(token);
  });
  saveSessions();
  writeDb(db);
  return { success: true };
}
function getProducts() {
  const list = readDb().products || [];
  // garante models: [] e puffs: 0 em produtos antigos
  for (const p of list) {
    if (!Array.isArray(p.models)) p.models = [];
    if (typeof p.puffs !== 'number' || p.puffs < 0) p.puffs = 0;
  }
  return list;
}

/* ---------------- PRODUCTS + MODELS ----------------
   Produto pode ter MODELOS dentro (ex: Black Sheep 25K -> Morango Kiwi, Menta, Uva...).
   Modelo: { id, name, price (0 = usa preço do produto), stock, image } */
/* data URL íntegra e enxuta (rejeita >2.5MB: protege o banco de timeouts) */
function sanitizeImageUrl(v) {
  if (typeof v !== 'string' || !v) return '';
  if (v.indexOf('data:') !== 0) return v;
  const comma = v.indexOf(',');
  const b64 = comma >= 0 ? v.slice(comma + 1) : '';
  if (!b64 || b64.length % 4 !== 0 || v.length > 2500000) return '';
  return v;
}

function normalizeModels(input, fallbackPrice) {
  if (!Array.isArray(input)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const name = String(raw.name || '').trim().slice(0, 120);
    if (!name) continue;
    let id = typeof raw.id === 'string' && raw.id ? raw.id : 'mod_' + Date.now() + '_' + out.length + '_' + Math.random().toString(36).slice(2, 7);
    if (seen.has(id)) id = id + '_' + out.length;
    seen.add(id);
    let price = raw.price === '' || raw.price === null || raw.price === undefined ? 0 : parseFloat(raw.price);
    if (isNaN(price) || price < 0) price = 0;
    let stock = raw.stock === '' || raw.stock === null || raw.stock === undefined ? 0 : parseInt(raw.stock);
    if (isNaN(stock) || stock < 0) stock = 0;
    let image = sanitizeImageUrl(typeof raw.image === 'string' ? raw.image : '');
    // normaliza caminho relativo: sempre raiz (assets/...) como o produto
    if (image && image.indexOf('data:') !== 0 && image.indexOf('http') !== 0) {
      image = image.replace(/^(\.\.\/)+/, '');
    }
    out.push({ id, name, price, stock, image });
    if (out.length >= 100) break;
  }
  return out;
}

function saveProduct(productData) {
  const db = readDb();
  if (!db.products) db.products = [];

  // Normaliza entrada do painel admin (evita preço negativo e preserva url/source_id)
  function cleanPrice(v) {
    let n = parseFloat(v);
    if (isNaN(n) || n < 0) n = 0;
    return Math.round(n * 100) / 100;
  }
  function cleanUrl(v) {
    if (typeof v !== 'string') return '';
    return v.trim().slice(0, 500);
  }

  if (productData.id) {
    const index = db.products.findIndex(p => p.id === productData.id);
    if (index >= 0) {
      const prev = db.products[index] || {};
      const basePrice = cleanPrice(productData.price);
      let oldPrice = cleanPrice(productData.old_price);
      // old_price só faz sentido como "preço original" acima do atual
      if (!(oldPrice > basePrice)) oldPrice = 0;
      db.products[index] = {
        ...db.products[index],
        name: String(productData.name || prev.name || 'Produto').slice(0, 200),
        price: basePrice,
        old_price: oldPrice,
        category: productData.category || prev.category || 'descartaveis',
        image: sanitizeImageUrl(productData.image),
        url: Object.prototype.hasOwnProperty.call(productData, 'url') ? cleanUrl(productData.url) : (prev.url || ''),
        source_id: Object.prototype.hasOwnProperty.call(productData, 'source_id') ? cleanUrl(productData.source_id) : (prev.source_id || ''),
        stock: Math.max(0, parseInt(productData.stock) || 0),
        puffs: Math.max(0, parseInt(productData.puffs) || 0),
        description: typeof productData.description === 'string' ? productData.description.slice(0, 2000) : (prev.description || ''),
        models: normalizeModels(productData.models, basePrice),
        updated_at: new Date().toISOString()
      };
      writeDb(db);
      return { success: true, data: db.products[index] };
    }
  }

  const basePrice = cleanPrice(productData.price);
  let oldPrice = cleanPrice(productData.old_price);
  if (!(oldPrice > basePrice)) oldPrice = 0;
  const newProduct = {
    id: 'prod_' + Date.now(),
    source_id: cleanUrl(productData.source_id),
    name: String(productData.name || 'Novo Produto').slice(0, 200),
    price: basePrice,
    old_price: oldPrice,
    category: productData.category || 'descartaveis',
    image: sanitizeImageUrl(productData.image),
    url: cleanUrl(productData.url),
    stock: Math.max(0, parseInt(productData.stock) || 10),
    puffs: Math.max(0, parseInt(productData.puffs) || 0),
    description: typeof productData.description === 'string' ? productData.description.slice(0, 2000) : '',
    models: normalizeModels(productData.models, basePrice),
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
        puffs: 0,
        description: item.brand ? 'Marca: ' + item.brand : '',
        models: [],
        created_at: new Date().toISOString()
      });
      count++;
    }
  }
  writeDb(db);
  return { success: true, imported: count };
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
    // Aceita com ou sem +55; armazena SEMPRE com 55 (wa.me exige DDI).
    if (digits.startsWith('55') && digits.length > 11) digits = digits.slice(2);
    if (digits.length !== 11 && digits.length !== 10) {
      return { success: false, error: 'Número inválido. Use DDD + número (ex: 45 99999-9999).' };
    }
    db.settings.whatsapp = '55' + digits;
  }
  if (settings.whatsapp_message !== undefined) {
    db.settings.whatsapp_message = String(settings.whatsapp_message || '').slice(0, 500);
  }
  writeDb(db);
  return { success: true, data: getSettings() };
}

module.exports = {
  adminLogin,
  adminLogout,
  verifySession,
  changeAdminPassword,

  registerCustomer,
  loginCustomer,
  updateCustomer,
  requestPasswordReset,
  resetPassword,
  resetPasswordSupabase,
  listResets,
  revokeReset,
  createCustomerSession,
  verifyCustomerSession,
  getCustomerSession,
  logoutCustomer,
  CUSTOMER_SESSION_TTL,

  readDb,
  writeDb,
  setDbPath,
  listAddresses,
  getAddress,
  createAddress,
  updateAddress,
  deleteAddress,
  normalizeAddress,

  listWishlist,
  addWishlist,
  removeWishlist,
  toggleWishlist,

  saveOrder,
  getOrders,
  getOrdersByCustomer,
  updateOrderStatus,
  deleteOrder,
  getCustomers,
  deleteCustomer,
  getProducts,

  saveProduct,
  deleteProduct,
  importCatalog,

  getSettings,
  saveSettings
};
