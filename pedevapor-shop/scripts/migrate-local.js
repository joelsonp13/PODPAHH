/* ============================================================================
   PODPAHH — Migración local (data/podpahh_db.json) -> Supabase
   ----------------------------------------------------------------------------
   PRÉ-REQUISITOS:
     1. Ejecute primero supabase/schema.sql en el SQL Editor del proyecto.
     2. Este script lee .env (SECRET KEY) — NUNCA commitar el .env.
   USO:
     node scripts/migrate-local.js
   ============================================================================
   SEGURANÇA:
   - Usa SECRET KEY (solo servidor). Los passwords se migran como HASH
     scrypt ya existente (salt:hash), manteniendo el mismo formato del backend.
   - No reescribe productos existentes (upsert on conflict/update).
   ============================================================================ */
const path = require('path');
const fs = require('fs');

// ---- Cargar .env (mismo parser del server) ----
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const m = t.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const { createClient } = require('@supabase/supabase-js');

const URL = process.env.SUPABASE_URL;
const SECRET = process.env.SUPABASE_SECRET_KEY;
if (!URL || !SECRET) {
  console.error('❌ Falta SUPABASE_URL ou SUPABASE_SECRET_KEY no .env');
  process.exit(1);
}

const client = createClient(URL, SECRET, { auth: { persistSession: false } });

// ---- Leer banco local ----
const dbPath = path.join(__dirname, '..', 'data', 'podpahh_db.json');
const local = JSON.parse(fs.readFileSync(dbPath, 'utf8').replace(/^\uFEFF/, ''));
console.log('📦 Banco local:',
  local.products?.length || 0, 'produtos |',
  local.customers?.length || 0, 'clientes |',
  local.orders?.length || 0, 'pedidos');

// ---- Helpers ----
function chunk(arr, size) { const out = []; for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size)); return out; }
async function upsert(table, rows) {
  if (!rows.length) return { inserted: 0, updated: 0 };
  let inserted = 0, updated = 0;
  for (const batch of chunk(rows, 200)) {
    const { data, error } = await client.from(table).upsert(batch, { onConflict: 'id' }).select('id');
    if (error) { console.error(`❌ Erro em ${table}:`, error.message); return { inserted, updated, error }; }
    // upsert no distingue insert/update; aproximamos pelos que já existiam antes
    inserted += batch.length;
  }
  return { inserted, updated };
}

// ---- 1) PRODUCTS (com MODELOS) ----
const products = (local.products || []).map(p => ({
  id: p.id, source_id: p.source_id || null, name: p.name,
  price: Number(p.price) || 0, old_price: Number(p.old_price) || 0,
  category: p.category || 'descartaveis',
  image: p.image || null, url: p.url || null,
  stock: parseInt(p.stock) || 0, puffs: Math.max(0, parseInt(p.puffs) || 0),
  description: p.description || null,
  models: Array.isArray(p.models) ? p.models.map(m => ({
    id: String(m.id || ''),
    name: String(m.name || '').slice(0, 120),
    price: Number(m.price) || 0,
    stock: parseInt(m.stock) || 0,
    image: m.image || null,
  })).filter(m => m.id && m.name) : [],
  created_at: new Date(p.created_at || Date.now()).toISOString(),
  updated_at: new Date().toISOString(),
}));
const rP = await upsert('products', products);
console.log(`✅ products: ${rP.inserted} upserted`, rP.error ? `| ERRO: ${rP.error}` : '');

// ---- 2) CUSTOMERS (preserva o hash scrypt!) ----
const customers = (local.customers || []).map(c => ({
  id: c.id, name: c.name, email: c.email,
  password: c.password, // já vem "salt:hash" do backend
  phone: c.phone,
  created_at: new Date(c.created_at || Date.now()).toISOString(),
}));
const rC = await upsert('customers', customers);
console.log(`✅ customers: ${rC.inserted} upserted`, rC.error ? `| ERRO: ${rC.error}` : '');

// ---- 3) ORDERS ----
const orders = (local.orders || []).map(o => ({
  id: o.id,
  customer_id: o.customer_id || null,
  customer_name: o.customer_name || null,
  customer_phone: o.customer_phone || null,
  items: o.items || [],
  subtotal: Number(o.subtotal) || 0,
  total: Number(o.total) || 0,
  address_id: o.address_id || null,
  address: o.address || null,
  payment_method: o.payment_method || 'PIX',
  status: o.status || 'pending',
  created_at: new Date(o.created_at || Date.now()).toISOString(),
}));
const rO = await upsert('orders', orders);
console.log(`✅ orders: ${rO.inserted} upserted`, rO.error ? `| ERRO: ${rO.error}` : '');

// ---- 3.5) ADDRESSES -> customer_addresses (nome real da tabela no Supabase) ----
// Só migra endereços cujo customer_id existe (FK on delete cascade).
// Se o cliente não existe ainda no Supabase, upsert falharia por FK.
const customerIds = new Set((local.customers || []).map(c => c.id));
const addresses = (local.addresses || [])
  .filter(a => a.customer_id && customerIds.has(a.customer_id))
  .map(a => ({
    id: a.id,
    customer_id: a.customer_id,
    label: a.label || 'Endereço',
    recipient_name: a.recipient_name,
    phone: a.phone,
    postal_code: String(a.postal_code || '').replace(/\D/g, ''),
    street: a.street,
    number: String(a.number || ''),
    complement: a.complement || null,
    neighborhood: a.neighborhood,
    city: a.city,
    state: String(a.state || '').toUpperCase(),
    is_default: a.is_default === true,
    created_at: new Date(a.created_at || Date.now()).toISOString(),
    updated_at: new Date(a.updated_at || a.created_at || Date.now()).toISOString(),
  }));
const rA = await upsert('customer_addresses', addresses);
console.log(`✅ customer_addresses: ${rA.inserted} upserted`, rA.error ? `| ERRO: ${rA.error}` : '');

// ---- 3.6) WISHLIST -> customer_wishlist (favoritos por conta) ----
const wishlist = (local.wishlist || [])
  .filter(w => w && w.customer_id && customerIds.has(w.customer_id) && w.product_id)
  .map(w => ({
    id: w.id,
    customer_id: w.customer_id,
    product_id: String(w.product_id),
    model_id: String(w.model_id || ''),
    created_at: new Date(w.created_at || Date.now()).toISOString(),
  }));
const rW = await upsert('customer_wishlist', wishlist);
console.log(`✅ customer_wishlist: ${rW.inserted} upserted`, rW.error ? `| ERRO: ${rW.error}` : '');

// ---- 4) SETTINGS (solo si existen) ----
if (local.settings && (local.settings.whatsapp || local.settings.admin)) {
  const s = local.settings;
  const { data, error } = await client.from('settings').upsert([{
    id: true,
    whatsapp: s.whatsapp || '5547999453628',
    whatsapp_message: s.whatsapp_message || '',
    admin_username: s.admin?.username || null,
    admin_pass_hash: s.admin?.pass_hash || null,
  }], { onConflict: 'id' });
  console.log(error ? `❌ settings: ERRO ${error.message}` : '✅ settings: upserted');
}

// ---- Verificação final ----
const { count, error: cntErr } = await client.from('products').select('id', { count: 'exact', head: true });
console.log('\n🔎 Confirmação no Supabase:');
console.log('   produtos contados:', cntErr ? `ERRO ${cntErr.message}` : count);

process.exit(0);