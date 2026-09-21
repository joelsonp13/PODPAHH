/* ================================================================
   PODPAHH — Supabase Data Layer (serverless / Vercel)
   Espelha server/db.js, mas persiste no Supabase via SERVICE_ROLE.
   NUNCA exponha a service key no frontend. Só Vercel env / .env local.
   Requer: supabase/schema.sql + supabase/sessions.sql aplicados.
   ================================================================ */
'use strict';

const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

let _client = null;
function sb() {
  if (!_client) {
    if (!SUPABASE_URL) throw new Error('Falta SUPABASE_URL');
    if (!SERVICE_KEY) throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY');
    const { createClient } = require('@supabase/supabase-js');
    _client = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
  }
  return _client;
}

const SESSION_TTL = 8 * 60 * 60 * 1000;
const SCRYPT_KEYLEN = 64;

/* ---------------- HASH (mesmo formato do backend local) ---------------- */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN).toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  if (stored.indexOf(':') !== -1) {
    const parts = stored.split(':');
    if (parts.length !== 2) return false;
    const check = crypto.scryptSync(String(password), parts[0], SCRYPT_KEYLEN).toString('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(parts[1], 'hex'), Buffer.from(check, 'hex'));
    } catch (e) { return false; }
  }
  const plainMatch = password === stored;
  const shaMatch = stored.length === 64 &&
    crypto.createHash('sha256').update(String(password)).digest('hex') === stored;
  return plainMatch || shaMatch;
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

/* ---------------- SESSÕES (tabelas Supabase) ---------------- */
async function createAdminSession() {
  const token = crypto.randomBytes(32).toString('hex');
  const { error } = await sb().from('admin_sessions').insert({
    token, expires_at: new Date(Date.now() + SESSION_TTL).toISOString()
  });
  if (error) throw error;
  return token;
}

async function verifyAdminSession(token) {
  if (!token) return false;
  const { data, error } = await sb().from('admin_sessions').select('expires_at').eq('token', token).limit(1);
  if (error || !data || !data.length) return false;
  if (Date.now() > Date.parse(data[0].expires_at)) {
    await sb().from('admin_sessions').delete().eq('token', token);
    return false;
  }
  return true;
}

async function adminLogout(token) {
  if (token) await sb().from('admin_sessions').delete().eq('token', token);
  return { success: true };
}

async function createCustomerSession(customerId) {
  const token = crypto.randomBytes(32).toString('hex');
  const { error } = await sb().from('customer_sessions').insert({
    token, customer_id: customerId, expires_at: new Date(Date.now() + SESSION_TTL).toISOString()
  });
  if (error) throw error;
  return token;
}

async function getCustomerSession(token) {
  if (typeof token !== 'string' || !token) return null;
  const { data, error } = await sb().from('customer_sessions').select('customer_id,expires_at').eq('token', token).limit(1);
  if (error || !data || !data.length) return null;
  if (Date.now() > Date.parse(data[0].expires_at)) {
    await sb().from('customer_sessions').delete().eq('token', token);
    return null;
  }
  return { customer_id: data[0].customer_id, expires_at: data[0].expires_at };
}

async function logoutCustomer(token) {
  if (token) await sb().from('customer_sessions').delete().eq('token', token);
  return { success: true };
}

/* ---------------- ADMIN (settings.admin) ---------------- */
async function getSettingsRow() {
  const { data, error } = await sb().from('settings').select('*').eq('id', true).limit(1);
  if (error) throw error;
  return (data && data[0]) || null;
}

async function ensureAdmin() {
  let row = await getSettingsRow();
  if (!row) {
    const { data, error } = await sb().from('settings').insert({
      id: true, whatsapp: '5547999453628', whatsapp_message: '',
      admin_username: 'admin', admin_pass_hash: hashPassword('podpahh2026')
    }).select().single();
    if (error) throw error;
    return { username: data.admin_username, pass_hash: data.admin_pass_hash };
  }
  if (!row.admin_username) {
    const { data, error } = await sb().from('settings').update({
      admin_username: 'admin', admin_pass_hash: hashPassword('podpahh2026')
    }).eq('id', true).select().single();
    if (error) throw error;
    return { username: data.admin_username, pass_hash: data.admin_pass_hash };
  }
  return { username: row.admin_username, pass_hash: row.admin_pass_hash };
}

async function adminLogin(user, pass) {
  const admin = await ensureAdmin();
  const userOk = String(user || '') === admin.username;
  const passOk = userOk && verifyPassword(pass, admin.pass_hash);
  if (userOk && passOk) return { success: true, token: await createAdminSession() };
  return { success: false, error: 'Usuário ou senha incorretos.' };
}

async function changeAdminPassword(currentPass, newPass) {
  const admin = await ensureAdmin();
  if (!verifyPassword(currentPass, admin.pass_hash)) {
    return { success: false, error: 'Senha atual incorreta.' };
  }
  if (!newPass || String(newPass).length < 8) {
    return { success: false, error: 'A nova senha precisa ter no mínimo 8 caracteres.' };
  }
  const { error } = await sb().from('settings').update({ admin_pass_hash: hashPassword(newPass) }).eq('id', true);
  if (error) return { success: false, error: error.message };
  return { success: true };
}

/* ---------------- CUSTOMERS ---------------- */
function safeCustomer(c) {
  if (!c) return null;
  const { password, ...safe } = c;
  return safe;
}

async function registerCustomer(name, email, password, phone) {
  const mail = String(email || '').toLowerCase().trim();
  if (!mail || !password || String(password).length < 8) {
    return { success: false, status: 400, error: 'E-mail e senha (mín. 8) são obrigatórios.' };
  }
  const digits = normalizePhone(phone);
  if (!digits) return { success: false, status: 400, error: 'WhatsApp é obrigatório. Informe seu número com DDD.' };
  if (!isValidPhone(digits)) {
    return { success: false, status: 400, error: 'Número de WhatsApp inválido. Use o formato (41) 99999-9999.' };
  }
  const existing = await sb().from('customers').select('id').eq('email', mail).limit(1);
  if (existing.error) return { success: false, status: 500, error: existing.error.message };
  if (existing.data.length) return { success: false, status: 400, error: 'Este e-mail já está cadastrado no sistema.' };
  const owner = await sb().from('customers').select('id').eq('phone', digits).limit(1);
  if (owner.error) return { success: false, status: 500, error: owner.error.message };
  if (owner.data.length) return { success: false, status: 400, error: 'Este número de WhatsApp já está cadastrado em outra conta.' };
  const { data, error } = await sb().from('customers').insert({
    id: 'usr_' + Date.now(), name: String(name || '').slice(0, 200),
    email: mail, password: hashPassword(password), phone: digits
  }).select().single();
  if (error) return { success: false, status: 500, error: error.message };
  return { success: true, data: safeCustomer(data) };
}

async function loginCustomer(email, password, phone) {
  const digits = normalizePhone(phone);
  // Telefone OPCIONAL no login (só o cadastro exige). Se informado, valida.
  let phoneCheck = '';
  if (digits) {
    if (!isValidPhone(digits)) {
      return { success: false, status: 400, error: 'Número de WhatsApp inválido. Use o formato (41) 99999-9999.' };
    }
    phoneCheck = digits;
  }
  const mail = String(email || '').trim().toLowerCase();
  const { data, error } = await sb().from('customers').select('*').or(`email.eq.${mail},name.eq.${mail}`).limit(1);
  if (error) return { success: false, status: 500, error: error.message };
  const customer = data && data[0];
  if (!customer) return { success: false, status: 401, error: 'Conta não encontrada. Verifique e-mail/WhatsApp.' };
  if (!verifyPassword(password, customer.password)) {
    return { success: false, status: 401, error: 'Senha incorreta.' };
  }
  // Telefone, se informado no login, precisa bater com o da conta
  if (phoneCheck && customer.phone !== phoneCheck) {
    return { success: false, status: 401, error: 'Este número de WhatsApp não pertence a esta conta. Use o número cadastrado.' };
  }
  if (customer.password.indexOf(':') === -1) {
    await sb().from('customers').update({ password: hashPassword(password) }).eq('id', customer.id);
  }
  const token = await createCustomerSession(customer.id);
  return { success: true, token, data: safeCustomer(customer) };
}

// Atualiza nome + WhatsApp da própria conta (e-mail é imutável).
async function updateCustomer(customerId, input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const name = String(src.name || '').trim().replace(/\s+/g, ' ').slice(0, 200);
  if (name.length < 2) {
    return { success: false, status: 400, error: 'Informe seu nome completo.' };
  }
  const digits = normalizePhone(src.phone);
  if (!digits || !isValidPhone(digits)) {
    return { success: false, status: 400, error: 'WhatsApp inválido. Use (41) 99999-9999.' };
  }
  const me = await sb().from('customers').select('id').eq('id', customerId).limit(1);
  if (me.error) return { success: false, status: 500, error: me.error.message };
  if (!me.data.length) return { success: false, status: 404, error: 'Conta não encontrada.' };
  const owner = await sb().from('customers').select('id').eq('phone', digits).neq('id', customerId).limit(1);
  if (owner.error) return { success: false, status: 500, error: owner.error.message };
  if (owner.data.length) {
    return { success: false, status: 400, error: 'Este WhatsApp já está em outra conta.' };
  }
  const upd = await sb().from('customers').update({ name, phone: digits }).eq('id', customerId).select().single();
  if (upd.error) return { success: false, status: 500, error: upd.error.message };
  return { success: true, data: safeCustomer(upd.data) };
}

async function getCustomerById(customerId) {
  const { data, error } = await sb().from('customers').select('id,name,email,phone,created_at').eq('id', customerId).limit(1);
  if (error) throw error;
  return (data && data[0]) || null;
}

/* ---------------- ENDEREÇOS ---------------- */
const ADDRESS_FIELDS = { label: 80, recipient_name: 100, phone: 20, postal_code: 12, street: 160, number: 20, complement: 80, neighborhood: 120, city: 100, state: 2 };
const ADDRESS_TEXT_FIELDS = [
  ['label', 80, false], ['recipient_name', 100, true], ['street', 160, true],
  ['number', 20, true], ['complement', 80, false], ['neighborhood', 120, true],
  ['city', 100, true], ['state', 2, true]
];

function normalizeText(value, maxLength) {
  const n = String(value ?? '').trim().replace(/\s+/g, ' ');
  return n.length <= maxLength ? n : null;
}

function normalizeAddress(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { success: false, status: 400, error: 'O endereço deve ser um objeto JSON.' };
  }
  const allowed = new Set([...Object.keys(ADDRESS_FIELDS), 'is_default']);
  const extra = Object.keys(input).filter(k => !allowed.has(k));
  if (extra.length) return { success: false, status: 400, error: `Campo(s) extra não permitido(s): ${extra.join(', ')}.` };
  const normalized = {};
  for (const [field, max, required] of ADDRESS_TEXT_FIELDS) {
    const provided = Object.prototype.hasOwnProperty.call(input, field);
    if (provided && typeof input[field] !== 'string') return { success: false, status: 400, error: `O campo ${field} deve ser textual.` };
    const v = normalizeText(provided ? input[field] : '', max);
    if (v === null) return { success: false, status: 400, error: `O campo ${field} excede o limite de ${max} caracteres.` };
    if (required && !v) return { success: false, status: 400, error: `O campo ${field} é obrigatório.` };
    normalized[field] = v;
  }
  const rawPhone = Object.prototype.hasOwnProperty.call(input, 'phone') ? input.phone : '';
  if (typeof rawPhone !== 'string' || !/^[0-9\s()+.-]+$/.test(rawPhone)) {
    return { success: false, status: 400, error: 'O campo phone contém caracteres inválidos.' };
  }
  normalized.phone = normalizePhone(rawPhone);
  if (!normalized.phone || !isValidAddressPhone(normalized.phone)) {
    return { success: false, status: 400, error: 'O campo phone deve conter DDD + número com 10 ou 11 dígitos.' };
  }
  const rawCep = Object.prototype.hasOwnProperty.call(input, 'postal_code') ? input.postal_code : '';
  if (typeof rawCep !== 'string' || !/^[0-9\s-]+$/.test(rawCep)) {
    return { success: false, status: 400, error: 'O campo postal_code contém caracteres inválidos.' };
  }
  normalized.postal_code = normalizePhone(rawCep);
  if (normalized.postal_code.length !== 8) {
    return { success: false, status: 400, error: 'O campo postal_code deve conter exatamente 8 dígitos.' };
  }
  normalized.state = normalized.state.toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized.state)) {
    return { success: false, status: 400, error: 'O campo state deve conter exatamente duas letras.' };
  }
  if (Object.prototype.hasOwnProperty.call(input, 'is_default') && typeof input.is_default !== 'boolean') {
    return { success: false, status: 400, error: 'O campo is_default deve ser booleano.' };
  }
  normalized.is_default = input.is_default === true;
  return { success: true, data: normalized };
}

async function listAddresses(customerId) {
  const { data, error } = await sb().from('customer_addresses').select('*').eq('customer_id', customerId).order('updated_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function createAddress(customerId, input) {
  const v = normalizeAddress(input);
  if (!v.success) return v;
  const cust = await sb().from('customers').select('id').eq('id', customerId).limit(1);
  if (cust.error) return { success: false, status: 500, error: cust.error.message };
  if (!cust.data.length) return { success: false, status: 404, error: 'Cliente não encontrado.' };
  if (v.data.is_default) {
    await sb().from('customer_addresses').update({ is_default: false }).eq('customer_id', customerId);
  }
  const addr = {
    id: `addr_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`,
    customer_id: customerId, ...v.data
  };
  const { data, error } = await sb().from('customer_addresses').insert(addr).select().single();
  if (error) return { success: false, status: 500, error: error.message };
  return { success: true, data };
}

async function updateAddress(customerId, addressId, input) {
  const v = normalizeAddress(input);
  if (!v.success) return v;
  const cur = await sb().from('customer_addresses').select('*').eq('id', addressId).limit(1);
  if (cur.error) return { success: false, status: 500, error: cur.error.message };
  if (!cur.data.length) return { success: false, status: 404, error: 'Endereço não encontrado.' };
  if (cur.data[0].customer_id !== customerId) {
    return { success: false, status: 403, error: 'Endereço não pertence a este cliente.' };
  }
  const merged = {
    ...v.data,
    is_default: Object.prototype.hasOwnProperty.call(input, 'is_default') ? v.data.is_default : cur.data[0].is_default === true
  };
  if (merged.is_default) {
    await sb().from('customer_addresses').update({ is_default: false }).eq('customer_id', customerId).neq('id', addressId);
  }
  const { data, error } = await sb().from('customer_addresses').update(merged).eq('id', addressId).select().single();
  if (error) return { success: false, status: 500, error: error.message };
  return { success: true, data };
}

async function deleteAddress(customerId, addressId) {
  const cur = await sb().from('customer_addresses').select('customer_id,is_default,created_at').eq('id', addressId).limit(1);
  if (cur.error) return { success: false, status: 500, error: cur.error.message };
  if (!cur.data.length) return { success: false, status: 404, error: 'Endereço não encontrado.' };
  if (cur.data[0].customer_id !== customerId) {
    return { success: false, status: 403, error: 'Endereço não pertence a este cliente.' };
  }
  const wasDefault = cur.data[0].is_default === true;
  const del = await sb().from('customer_addresses').delete().eq('id', addressId);
  if (del.error) return { success: false, status: 500, error: del.error.message };
  if (wasDefault) {
    const rest = await sb().from('customer_addresses').select('id').eq('customer_id', customerId).order('created_at', { ascending: true }).limit(1);
    if (!rest.error && rest.data.length) {
      await sb().from('customer_addresses').update({ is_default: true }).eq('id', rest.data[0].id);
    }
  }
  return { success: true };
}

/* ---------------- WISHLIST ---------------- */
function normalizeWishInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { success: false, status: 400, error: 'Dados do favorito inválidos.' };
  }
  const productId = String(input.product_id || '').slice(0, 120);
  if (!productId) return { success: false, status: 400, error: 'product_id é obrigatório.' };
  return { success: true, data: { product_id: productId, model_id: String(input.model_id || '').slice(0, 120) } };
}

async function listWishlist(customerId) {
  const { data, error } = await sb().from('customer_wishlist')
    .select('id,product_id,model_id,created_at').eq('customer_id', customerId).order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function addWishlist(customerId, input) {
  const n = normalizeWishInput(input);
  if (!n.success) return n;
  const cust = await sb().from('customers').select('id').eq('id', customerId).limit(1);
  if (cust.error) return { success: false, status: 500, error: cust.error.message };
  if (!cust.data.length) return { success: false, status: 404, error: 'Cliente não encontrado.' };
  const ex = await sb().from('customer_wishlist').select('*')
    .eq('customer_id', customerId).eq('product_id', n.data.product_id).eq('model_id', n.data.model_id).limit(1);
  if (ex.error) return { success: false, status: 500, error: ex.error.message };
  if (ex.data.length) {
    const w = ex.data[0];
    return { success: true, data: { id: w.id, product_id: w.product_id, model_id: w.model_id || '', created_at: w.created_at }, wished: true };
  }
  const item = {
    id: 'wish_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex'),
    customer_id: customerId, product_id: n.data.product_id, model_id: n.data.model_id
  };
  const ins = await sb().from('customer_wishlist').insert(item).select().single();
  if (ins.error) return { success: false, status: 500, error: ins.error.message };
  return { success: true, data: { id: ins.data.id, product_id: ins.data.product_id, model_id: ins.data.model_id, created_at: ins.data.created_at }, wished: true };
}

async function removeWishlist(customerId, input) {
  const n = normalizeWishInput(input);
  if (!n.success) return n;
  const del = await sb().from('customer_wishlist').delete()
    .eq('customer_id', customerId).eq('product_id', n.data.product_id).eq('model_id', n.data.model_id);
  if (del.error) return { success: false, status: 500, error: del.error.message };
  return { success: true, wished: false };
}

async function toggleWishlist(customerId, input) {
  const n = normalizeWishInput(input);
  if (!n.success) return n;
  const ex = await sb().from('customer_wishlist').select('id')
    .eq('customer_id', customerId).eq('product_id', n.data.product_id).eq('model_id', n.data.model_id).limit(1);
  if (ex.error) return { success: false, status: 500, error: ex.error.message };
  return ex.data.length ? removeWishlist(customerId, input) : addWishlist(customerId, input);
}

/* ---------------- ORDERS ---------------- */
// Validação dura do pedido (igual ao backend local): sem itens, sem
// nome/WhatsApp válido ou sem endereço, o pedido NÃO é salvo.
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

async function saveOrder(orderData) {
  const src = orderData && typeof orderData === 'object' && !Array.isArray(orderData) ? orderData : {};
  const v = validateOrderInput(src);
  if (!v.success) return v;
  const order = {
    id: 'ord_' + Date.now(),
    ...v.data,
    status: 'pendente',
    payment_method: String(src.payment_method || 'PIX').slice(0, 20)
  };
  delete order.created_at; delete order.updated_at;
  if (typeof src.customer_id === 'string' && src.customer_id) order.customer_id = src.customer_id;
  if (typeof src.address_id === 'string' && src.address_id) order.address_id = src.address_id;
  const { data, error } = await sb().from('orders').insert(order).select().single();
  if (error) return { success: false, error: error.message };
  return { success: true, data };
}

async function getOrders() {
  const { data, error } = await sb().from('orders').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function getOrdersByCustomer(customerId) {
  const { data, error } = await sb().from('orders').select('*').eq('customer_id', customerId).order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function updateOrderStatus(id, status) {
  const allowed = ['pendente', 'confirmado', 'cancelado', 'pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled'];
  if (!allowed.includes(status)) return { success: false, status: 400, error: 'Status inválido.' };
  const { data, error } = await sb().from('orders').update({ status }).eq('id', String(id)).select();
  if (error) return { success: false, status: 500, error: error.message };
  if (!data.length) return { success: false, status: 404, error: 'Pedido não encontrado.' };
  return { success: true, data: data[0] };
}

async function deleteOrder(id) {
  const del = await sb().from('orders').delete().eq('id', String(id));
  if (del.error) return { success: false, status: 500, error: del.error.message };
  if (del.count === 0) return { success: false, status: 404, error: 'Pedido não encontrado.' };
  return { success: true };
}

async function getCustomers() {
  const { data, error } = await sb().from('customers').select('id,name,email,phone,created_at').order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function deleteCustomer(id) {
  const sid = String(id);
  await sb().from('customer_sessions').delete().eq('customer_id', sid);
  const del = await sb().from('customers').delete().eq('id', sid);
  if (del.error) return { success: false, status: 500, error: del.error.message };
  return { success: true };
}

/* ---------------- PRODUCTS + MODELS ---------------- */
function sanitizeImageUrl(v) {
  if (typeof v !== 'string' || !v) return '';
  if (v.indexOf('data:') !== 0) return v;
  const comma = v.indexOf(',');
  const b64 = comma >= 0 ? v.slice(comma + 1) : '';
  if (!b64 || b64.length % 4 !== 0 || v.length > 12000000) return '';
  return v;
}

function normalizeModels(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const name = String(raw.name || '').trim().slice(0, 120);
    if (!name) continue;
    let mid = typeof raw.id === 'string' && raw.id ? raw.id : 'mod_' + Date.now() + '_' + out.length + '_' + Math.random().toString(36).slice(2, 7);
    if (seen.has(mid)) mid = mid + '_' + out.length;
    seen.add(mid);
    let price = raw.price === '' || raw.price === null || raw.price === undefined ? 0 : parseFloat(raw.price);
    if (isNaN(price) || price < 0) price = 0;
    let stock = raw.stock === '' || raw.stock === null || raw.stock === undefined ? 0 : parseInt(raw.stock);
    if (isNaN(stock) || stock < 0) stock = 0;
    let image = sanitizeImageUrl(typeof raw.image === 'string' ? raw.image : '');
    if (image && image.indexOf('data:') !== 0 && image.indexOf('http') !== 0) {
      image = image.replace(/^(\.\.\/)+/, '');
    }
    out.push({ id: mid, name, price: Math.round(price * 100) / 100, stock, image });
    if (out.length >= 100) break;
  }
  return out;
}

function cleanPrice(v) {
  let n = parseFloat(v);
  if (isNaN(n) || n < 0) n = 0;
  return Math.round(n * 100) / 100;
}

function cleanUrl(v) {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, 500);
}

function normProduct(p) {
  if (p && !Array.isArray(p.models)) p.models = [];
  if (p && (typeof p.puffs !== 'number' || p.puffs < 0)) p.puffs = 0;
  return p;
}

async function getProducts() {
  const { data, error } = await sb().from('products').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(normProduct);
}

async function saveProduct(productData) {
  const pd = productData || {};
  const basePrice = cleanPrice(pd.price);
  let oldPrice = cleanPrice(pd.old_price);
  if (!(oldPrice > basePrice)) oldPrice = 0;
  const models = normalizeModels(pd.models);
  if (pd.id) {
    const cur = await sb().from('products').select('*').eq('id', pd.id).limit(1);
    if (cur.error) return { success: false, error: cur.error.message };
    if (cur.data.length) {
      const prev = cur.data[0];
      const row = {
        name: String(pd.name || prev.name || 'Produto').slice(0, 200),
        price: basePrice, old_price: oldPrice,
        category: pd.category || prev.category || 'descartaveis',
        image: sanitizeImageUrl(pd.image),
        url: Object.prototype.hasOwnProperty.call(pd, 'url') ? cleanUrl(pd.url) : (prev.url || ''),
        source_id: Object.prototype.hasOwnProperty.call(pd, 'source_id') ? cleanUrl(pd.source_id) : (prev.source_id || ''),
        stock: Math.max(0, parseInt(pd.stock) || 0),
        puffs: Math.max(0, parseInt(pd.puffs) || 0),
        description: typeof pd.description === 'string' ? pd.description.slice(0, 2000) : (prev.description || ''),
        models
      };
      const upd = await sb().from('products').update(row).eq('id', pd.id).select().single();
      if (upd.error) return { success: false, error: upd.error.message };
      return { success: true, data: normProduct(upd.data) };
    }
  }
  const row = {
    id: 'prod_' + Date.now(),
    source_id: cleanUrl(pd.source_id),
    name: String(pd.name || 'Novo Produto').slice(0, 200),
    price: basePrice, old_price: oldPrice,
    category: pd.category || 'descartaveis',
    image: sanitizeImageUrl(pd.image),
    url: cleanUrl(pd.url),
    stock: Math.max(0, parseInt(pd.stock) || 10),
    puffs: Math.max(0, parseInt(pd.puffs) || 0),
    description: typeof pd.description === 'string' ? pd.description.slice(0, 2000) : '',
    models
  };
  const ins = await sb().from('products').insert(row).select().single();
  if (ins.error) return { success: false, error: ins.error.message };
  return { success: true, data: normProduct(ins.data) };
}

async function deleteProduct(id) {
  const del = await sb().from('products').delete().eq('id', String(id));
  if (del.error) return { success: false, error: del.error.message };
  return { success: true };
}

async function importCatalog(catalogObj) {
  if (!catalogObj || typeof catalogObj !== 'object') {
    return { success: false, error: 'Nenhum catálogo encontrado.' };
  }
  const existing = await sb().from('products').select('name');
  if (existing.error) return { success: false, error: existing.error.message };
  const names = new Set((existing.data || []).map(p => String(p.name || '').toLowerCase()));
  const rows = [];
  let n = 0;
  for (const key in catalogObj) {
    const item = catalogObj[key] || {};
    if (!item.name || names.has(String(item.name).toLowerCase())) continue;
    names.add(String(item.name).toLowerCase());
    rows.push({
      id: 'prod_scraped_' + Date.now() + '_' + (n++),
      name: String(item.name).slice(0, 200),
      price: cleanPrice(item.price), old_price: 0,
      category: 'descartaveis', image: item.img || item.image || '',
      stock: 50, puffs: 0,
      description: item.brand ? 'Marca: ' + String(item.brand).slice(0, 500) : '',
      models: []
    });
  }
  if (rows.length) {
    const ins = await sb().from('products').insert(rows);
    if (ins.error) return { success: false, error: ins.error.message };
  }
  return { success: true, imported: rows.length };
}

/* ---------------- SETTINGS ---------------- */
async function getSettings() {
  const row = await getSettingsRow();
  return {
    whatsapp: (row && row.whatsapp) || '5547999453628',
    whatsapp_message: (row && row.whatsapp_message) || ''
  };
}

async function saveSettings(settings) {
  const s = settings || {};
  const patch = {};
  if (s.whatsapp !== undefined) {
    // Armazena SEMPRE com 55 (wa.me exige DDI)
    let digits = String(s.whatsapp).replace(/\D/g, '');
    if (digits.startsWith('55') && digits.length > 11) digits = digits.slice(2);
    if (digits.length !== 11 && digits.length !== 10) {
      return { success: false, error: 'Número inválido. Use DDD + número (ex: 45 99999-9999).' };
    }
    patch.whatsapp = '55' + digits;
  }
  if (s.whatsapp_message !== undefined) {
    patch.whatsapp_message = String(s.whatsapp_message || '').slice(0, 500);
  }
  await ensureAdmin();
  const { error } = await sb().from('settings').update(patch).eq('id', true);
  if (error) return { success: false, error: error.message };
  return { success: true, data: await getSettings() };
}

module.exports = {
  adminLogin, adminLogout, verifyAdminSession, changeAdminPassword,
  registerCustomer, loginCustomer, getCustomerSession, logoutCustomer,
  updateCustomer, getCustomerById,
  listAddresses, createAddress, updateAddress, deleteAddress, normalizeAddress,
  listWishlist, addWishlist, removeWishlist, toggleWishlist,
  saveOrder, getOrders, getOrdersByCustomer, updateOrderStatus, deleteOrder,
  getCustomers, deleteCustomer,
  getProducts, saveProduct, deleteProduct, importCatalog,
  getSettings, saveSettings
};
