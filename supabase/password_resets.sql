-- ============================================================================
-- PODPAHH — RECUPERAÇÃO DE SENHA (link por e-mail)
-- Rode UMA VEZ no SQL Editor do Supabase, DEPOIS do schema.sql.
-- Sem RLS policies: somente service_role (servidor/Vercel) acessa.
-- Token secreto de 64 chars, expira em 1 hora, uso único.
-- ============================================================================

create table if not exists public.password_resets (
  id          text primary key,                -- 'rst_<base36><rand>'
  customer_id text not null references public.customers(id) on delete cascade,
  email       text not null,
  token       text not null unique,            -- segredo do link
  expires_at  timestamptz not null,
  used        boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists idx_resets_owner
  on public.password_resets(customer_id, expires_at desc);
create index if not exists idx_resets_email
  on public.password_resets(email, expires_at desc);
create index if not exists idx_resets_token
  on public.password_resets(token);

alter table public.password_resets enable row level security;
