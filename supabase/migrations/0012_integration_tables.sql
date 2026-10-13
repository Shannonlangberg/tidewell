-- 0012_integration_tables.sql
-- webhook_receipts, integration_sync, rate_limits (3.3) and invoice_seq (3.1).

create table public.webhook_receipts (
  id bigint generated always as identity primary key,
  provider text not null,
  external_event_id text not null,
  event_type text,
  verified_by public.webhook_verification not null default 'none',
  path_token_ok boolean,
  status text not null default 'received' check (status in ('received', 'processed', 'ignored', 'failed')),
  payload jsonb,
  outbox_id bigint references public.outbox (id),
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  retain_until date not null default (current_date + 90),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint webhook_receipts_unique unique (provider, external_event_id)
);
comment on table public.webhook_receipts is 'Idempotency and forensics for every inbound webhook. Every webhook is a hint: verified_by = none is ignored and writes nothing else.';
create index webhook_receipts_retention_idx on public.webhook_receipts (retain_until);
create trigger webhook_receipts_set_updated_at before update on public.webhook_receipts for each row execute function private.set_updated_at();
alter table public.webhook_receipts enable row level security;
alter table public.webhook_receipts force row level security;

create table public.integration_sync (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  entity_type text not null,
  entity_id uuid not null,
  external_id text,
  direction text not null default 'outbound' check (direction in ('outbound', 'inbound')),
  status text not null default 'pending' check (status in ('pending', 'ok', 'error')),
  last_synced_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_sync_unique unique (provider, entity_type, entity_id)
);
comment on table public.integration_sync is 'Mirror of Tidewell rows to external ids so adapters stay stateless.';
create trigger integration_sync_set_updated_at before update on public.integration_sync for each row execute function private.set_updated_at();
alter table public.integration_sync enable row level security;
alter table public.integration_sync force row level security;

create table public.rate_limits (
  key text primary key check (key ~ '^(ip|email):'),
  tokens integer not null check (tokens >= 0),
  refilled_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.rate_limits is 'Token buckets for unauthenticated routes: ip:{addr} and email:{sha256}. Read and written only by the secret key from /api/enquiry.';
create trigger rate_limits_set_updated_at before update on public.rate_limits for each row execute function private.set_updated_at();
alter table public.rate_limits enable row level security;
alter table public.rate_limits force row level security;

-- invoice_seq: TW-000001 numbering; callable only from the issue RPC (phase 7). usage and select
-- are revoked from the API roles (3.1); the default ACL would otherwise have granted them.
create sequence public.invoice_seq as bigint start with 1 increment by 1;
revoke all on sequence public.invoice_seq from public, anon, authenticated, service_role;
