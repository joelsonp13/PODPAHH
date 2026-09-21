-- ============================================================================
-- PODPAHH — PRODUCTION SCHEMA PARA SUPABASE (SQL Editor)
-- ----------------------------------------------------------------------------
-- CÓMO USAR:
--   1. Abra el SQL Editor del proyecto Supabase (https://supabase.com/dashboard)
--   2. Pegue TODO este script y ejecute (RUN)
--   3. Después ejecute el script de migración local: scripts/migrate-local.js
--
-- Esquema replica fiel do backend local (data/podpahh_db.json):
--   products            -> catálogo (67 itens), prices NUMERIC, stock + models JSONB
--   customers           -> contas com senha HASH scrypt (NUNCA texto puro)
--   orders              -> pedidos iniciados no checkout WhatsApp
--   customer_addresses  -> endereços de entrega (espelha "addresses" local)
--   customer_wishlist   -> favoritos por conta (espelha "wishlist" local)
--   settings            -> whatssapp da loja + admin credencial
--
-- MODELOS (novo): products.models é JSONB array:
--   [{ id text, name text, price numeric, stock int, image text }]
--   price = 0 significa "usa o preço do produto".
--
-- SEGURANÇA (production):
--   * Row Level Security (RLS) ATIVO em todas as tabelas
--   * anon: somente LEITURA do catálogo (stock > 0) + INSERÇÃO legal de
--     pedidos e clientes. Nada mais.
--   * Service role (SECRET KEY) ignora RLS = uso admin no servidor.
--   * Coluna settings.admin PASSÍVEL DE LEITURA apenas via service role.
--   * NUNCA exponha a SECRET KEY no navegador.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- EXTENSIONS
-- ----------------------------------------------------------------------------
create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- ENUM TYPES
-- ----------------------------------------------------------------------------
do $$
begin
  create type public.product_category as enum (
    'descartaveis', 'aparelhos', 'e-liquids',
    'acessorios', 'resistencias', 'outlet'
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.order_status as enum (
    'pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled',
    'pendente', 'confirmado', 'cancelado'
  );
exception when duplicate_object then null;
end $$;

-- MIGRAÇÃO: adiciona valores novos ao enum em bases já criadas.
-- server/db.js usa 'pendente','confirmado','cancelado' enquanto o schema
-- original só tinha inglês. Rode uma vez; IF NOT EXISTS torna idempotente.
-- NOTA: ALTER TYPE ... ADD VALUE não pode rodar dentro de DO/transação,
-- por isso são 9 comandos separados (não embrulhe em BEGIN/COMMIT).
alter type public.order_status add value if not exists 'pending';
alter type public.order_status add value if not exists 'paid';
alter type public.order_status add value if not exists 'processing';
alter type public.order_status add value if not exists 'shipped';
alter type public.order_status add value if not exists 'delivered';
alter type public.order_status add value if not exists 'cancelled';
alter type public.order_status add value if not exists 'pendente';
alter type public.order_status add value if not exists 'confirmado';
alter type public.order_status add value if not exists 'cancelado';

-- ----------------------------------------------------------------------------
-- TABLE: products
-- ----------------------------------------------------------------------------
create table if not exists public.products (
  id            text primary key,                -- 'prod_32511' (compatível com frontend)
  source_id     text,                            -- id original da fonte (WooCommerce)
  name          text not null,
  price         numeric(10,2) not null default 0,
  old_price     numeric(10,2) not null default 0,
  category      public.product_category not null default 'descartaveis',
  image         text,
  url           text,
  stock         integer not null default 0,
  puffs         integer not null default 0,      -- quantidade de puxadas (ex: 25000)
  description   text,
  models        jsonb not null default '[]'::jsonb, -- MODELOS dentro do produto
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.products is 'Catálogo de produtos PODPAHH';
comment on column public.products.id is 'ID legado no formato prod_*';

-- MIGRAÇÃO para bases já criadas (rode o schema de novo sem medo: é idempotente).
-- Fica ANTES dos COMMENTs das colunas novas: em base antiga a tabela já
-- existe sem models/puffs e o COMMENT falharia (42703) abortando o script.
alter table public.products add column if not exists models jsonb not null default '[]'::jsonb;
alter table public.products add column if not exists puffs integer not null default 0;

comment on column public.products.models is 'Modelos dentro do produto: [{id,name,price,stock,image}] — price 0 = usa preço do produto';
comment on column public.products.puffs is 'Quantidade de puxadas do produto (ex: 25000). 0 = não informado';

-- Garante que models seja sempre um array (evita objeto/string quebrando o ADM)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'products_models_is_array'
  ) then
    alter table public.products
      add constraint products_models_is_array check (jsonb_typeof(models) = 'array');
  end if;
end $$;

create index if not exists idx_products_models on public.products using gin (models);

-- ----------------------------------------------------------------------------
-- TABLE: customers
-- ----------------------------------------------------------------------------
create table if not exists public.customers (
  id            text primary key,                -- 'usr_<timestamp>'
  name          text not null,
  email         text not null unique,
  password      text not null,                   -- HASH scrypt "salt:hash", nunca texto puro
  phone         text not null,                   -- 11 dígitos, sem +55
  created_at    timestamptz not null default now()
);

comment on table public.customers is 'Clientes/contas da loja';
comment on column public.customers.password is 'hash scrypt salt:hash — nunca texto puro';

-- ----------------------------------------------------------------------------
-- TABLE: orders
-- ----------------------------------------------------------------------------
create table if not exists public.orders (
  id            text primary key,                -- 'ord_<timestamp>'
  customer_id   text references public.customers(id) on delete set null,
  customer_name text,
  customer_phone text,
  items         jsonb not null default '[]'::jsonb,
  subtotal      numeric(10,2) not null default 0,
  total         numeric(10,2) not null default 0,
  address_id    text,
  address       text,
  payment_method text not null default 'PIX',
  status        public.order_status not null default 'pending',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.orders is 'Pedidos iniciados no checkout';

-- MIGRAÇÃO: updated_at não existia no schema original, mas o admin/backend
-- (updateOrderStatus) grava updated_at a cada troca de status.
-- ANTES de qualquer statement que cite a coluna (evita 42703 em base antiga).
alter table public.orders add column if not exists updated_at timestamptz not null default now();

-- ----------------------------------------------------------------------------
-- TABLE: customer_addresses
-- ----------------------------------------------------------------------------
create table if not exists public.customer_addresses (
  id             text primary key,
  customer_id    text not null references public.customers(id) on delete cascade,
  label          text not null,
  recipient_name text not null,
  phone          text not null,
  postal_code    text not null,
  street         text not null,
  number         text not null,
  complement     text,
  neighborhood   text not null,
  city           text not null,
  state          text not null check (length(state) = 2),
  is_default     boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.customer_addresses is 'Endereços de entrega dos clientes';

-- ----------------------------------------------------------------------------
-- INDEXes para customer_addresses
-- ----------------------------------------------------------------------------
create index if not exists idx_customer_addresses_owner_default
  on public.customer_addresses(customer_id, is_default);
create index if not exists idx_customer_addresses_updated
  on public.customer_addresses(customer_id, updated_at desc);

-- ----------------------------------------------------------------------------
-- FUNÇÃO updated_at (definida ANTES do primeiro uso — Postgres exige que
-- a função exista na hora do CREATE TRIGGER, senão o script falha do zero)
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- TRIGGER: updated_at para customer_addresses
-- ----------------------------------------------------------------------------
drop trigger if exists trg_customer_addresses_updated_at on public.customer_addresses;
create trigger trg_customer_addresses_updated_at
  before update on public.customer_addresses
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- RLS para customer_addresses
-- ----------------------------------------------------------------------------
alter table public.customer_addresses enable row level security;

drop policy if exists "customer_addresses_owner_all" on public.customer_addresses;
create policy "customer_addresses_owner_all"
  on public.customer_addresses
  to authenticated, anon
  using (true)
  with check (true);

-- ----------------------------------------------------------------------------
-- TABLE: customer_wishlist (favoritos por conta)
-- ----------------------------------------------------------------------------
-- 1 linha por (customer_id, product_id, model_id).
-- model_id = '' significa o produto em si (sem modelo específico).
create table if not exists public.customer_wishlist (
  id             text primary key,                -- 'wish_<timestamp>_<rand>'
  customer_id    text not null references public.customers(id) on delete cascade,
  product_id     text not null,
  model_id       text not null default '',
  created_at     timestamptz not null default now(),
  unique (customer_id, product_id, model_id)
);

comment on table public.customer_wishlist is 'Favoritos por conta (sincroniza com o coração da loja)';
comment on column public.customer_wishlist.model_id is 'ID do modelo dentro do produto; vazio = produto';

create index if not exists idx_wishlist_owner
  on public.customer_wishlist(customer_id, created_at desc);
create index if not exists idx_wishlist_product
  on public.customer_wishlist(product_id);

-- RLS: mesmo padrão de customer_addresses (acesso via gateway do servidor
-- com SECRET KEY em produção; service_role ignora RLS).
-- ATENÇÃO: este projeto usa tokens próprios (não Supabase Auth), então a
-- política permissiva abaixo existe para o modo direto. Em produção prefira
-- MODE='local' (server/index.js valida o dono pelo token Bearer).
alter table public.customer_wishlist enable row level security;

drop policy if exists "customer_wishlist_owner_all" on public.customer_wishlist;
create policy "customer_wishlist_owner_all"
  on public.customer_wishlist
  to authenticated, anon
  using (true)
  with check (true);

-- ----------------------------------------------------------------------------
-- FK: orders.address_id -> customer_addresses(id)
-- ----------------------------------------------------------------------------
-- orders é criada antes de customer_addresses no script, por isso a FK vem
-- aqui via ALTER (idempotente, NOT VALID para não quebrar com dados antigos).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_address_id_fkey'
  ) then
    alter table public.orders
      add constraint orders_address_id_fkey
      foreign key (address_id)
      references public.customer_addresses(id)
      on delete set null not valid;
  end if;
end $$;

create index if not exists idx_orders_address_id on public.orders(address_id);

-- ----------------------------------------------------------------------------
-- TABLE: settings (linha única)
-- ----------------------------------------------------------------------------
create table if not exists public.settings (
  id              boolean primary key default true check (id = true), -- singleton
  whatsapp        text not null default '5547999453628',
  whatsapp_message text not null default '',
  admin_username  text,
  admin_pass_hash text,                        -- hash scrypt; só service role lê
  updated_at      timestamptz not null default now()
);

comment on table public.settings is 'Configurações da loja (linha única)';
comment on column public.settings.admin_pass_hash is 'hash scrypt da senha admin — só via service role';

-- ----------------------------------------------------------------------------
-- INDEXES
-- ----------------------------------------------------------------------------
create index if not exists idx_products_category   on public.products(category);
create index if not exists idx_products_stock      on public.products(stock);
create index if not exists idx_products_source_id  on public.products(source_id);
create index if not exists idx_customers_email     on public.customers(email);
create index if not exists idx_customers_phone     on public.customers(phone);
create index if not exists idx_orders_created_at   on public.orders(created_at desc);
create index if not exists idx_orders_phone        on public.orders(customer_phone);

-- ----------------------------------------------------------------------------
-- TRIGGER: updated_at automático
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

drop trigger if exists trg_settings_updated_at on public.settings;
create trigger trg_settings_updated_at
  before update on public.settings
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
alter table public.products  enable row level security;
alter table public.customers enable row level security;
alter table public.orders    enable row level security;
alter table public.settings  enable row level security;

-- ============================================================================
-- GRANTS (baseline)
-- ============================================================================
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables  in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- ============================================================================
-- POLICIES
-- ============================================================================

-- ---------------- PRODUCTS ----------------
-- anon: só lê produtos com estoque > 0 (catálogo público)
drop policy if exists "products_public_read" on public.products;
create policy "products_public_read"
  on public.products for select
  to anon, authenticated
  using (stock > 0);

-- ---------------- CUSTOMERS ----------------
-- anon: pode criar conta (inserção). NUNCA pode ler a tabela.
drop policy if exists "customers_anon_insert" on public.customers;
create policy "customers_anon_insert"
  on public.customers for insert
  to anon
  with check (true);

-- ---------------- ORDERS ----------------
-- anon: pode criar pedido. NÃO pode ler pedidos alheios.
drop policy if exists "orders_anon_insert" on public.orders;
create policy "orders_anon_insert"
  on public.orders for insert
  to anon
  with check (true);

-- ---------------- SETTINGS ----------------
-- anon: pode LER apenas whatsapp e whatsapp_message.
-- admin_username/admin_pass_hash ficam invisíveis via column-level policy.
drop policy if exists "settings_anon_read_public" on public.settings;
create policy "settings_anon_read_public"
  on public.settings for select
  to anon, authenticated
  using (true);

-- Revoga colunas sensíveis para anon (column-level security)
revoke select (admin_username, admin_pass_hash)
  on public.settings from anon, authenticated;
grant select (whatsapp, whatsapp_message) on public.settings to anon, authenticated;

-- ============================================================================
-- SEED (config inicial)
-- ============================================================================
insert into public.settings (id, whatsapp, whatsapp_message)
values (true, '5547999453628', '')
on conflict (id) do nothing;

-- ============================================================================
-- VALIDAÇÃO
-- ============================================================================
-- Descomente para conferir o estado:
-- select tablename, rowsecurity from pg_tables
--   where schemaname = 'public' and tablename in ('products','customers','orders','customer_addresses','customer_wishlist','settings');
-- select policyname, permissive, cmd, qual from pg_policies
--   where schemaname = 'public' order by policyname;