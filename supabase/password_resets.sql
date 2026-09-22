-- ============================================================================
-- PODPAHH — RECUPERAÇÃO DE SENHA (código via WhatsApp da loja)
-- Rode UMA VEZ no SQL Editor do Supabase, DEPOIS do schema.sql.
-- Sem RLS policies: somente service_role (servidor/Vercel) acessa.
-- O código fica legível para o admin reler ao cliente no chat após
-- conferir a identidade. Expira em 15 min, uso único.
-- ============================================================================

create table if not exists public.password_resets (
  id          text primary key,                -- 'RST_<base36><rand>'
  customer_id text not null references public.customers(id) on delete cascade,
  email       text not null,
  code        text not null,                   -- 6 dígitos
  expires_at  timestamptz not null,
  used        boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists idx_resets_owner
  on public.password_resets(customer_id, expires_at desc);
create index if not exists idx_resets_email
  on public.password_resets(email, expires_at desc);

alter table public.password_resets enable row level security;
