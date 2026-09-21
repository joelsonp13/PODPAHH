-- ============================================================================
-- PODPAHH — SESSÕES (tokens próprios, sem Supabase Auth)
-- Rode UMA VEZ no SQL Editor do Supabase, DEPOIS do schema.sql.
-- Sem RLS policies: somente service_role (servidor/Vercel) acessa.
-- ============================================================================

create table if not exists public.customer_sessions (
  token       text primary key,
  customer_id text not null references public.customers(id) on delete cascade,
  expires_at  timestamptz not null
);

create table if not exists public.admin_sessions (
  token      text primary key,
  expires_at timestamptz not null
);

create index if not exists idx_customer_sessions_owner
  on public.customer_sessions(customer_id, expires_at desc);

alter table public.customer_sessions enable row level security;
alter table public.admin_sessions enable row level security;

-- Limpeza periódica (opcional): apaga tokens expirados.
-- delete from public.customer_sessions where expires_at < now();
-- delete from public.admin_sessions where expires_at < now();
