-- 0009_dd_mandates.sql
-- dd_mandates: written only by the collector webhook (after a re-fetch) and create_mandate_link() (3.3).

create table public.dd_mandates (
  id uuid primary key default gen_random_uuid(),
  owner_account_id uuid not null references public.owner_accounts (id),
  collector public.collector not null,
  external_customer_id text not null,
  external_mandate_id text,
  status public.mandate_status not null default 'pending',
  account_mask text,
  authorised_at timestamptz,
  authorised_via text not null default 'hosted_form',
  cancelled_at timestamptz,
  cancel_reason text,
  last_webhook_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.dd_mandates is 'Direct-debit mandates. Writes come from the secret key only: the collector webhook after a re-fetch of the mandate, and create_mandate_link().';
create unique index dd_mandates_one_live_per_account on public.dd_mandates (owner_account_id) where status in ('pending', 'active');
create unique index dd_mandates_external_idx on public.dd_mandates (collector, external_mandate_id) where external_mandate_id is not null;
create trigger dd_mandates_set_updated_at before update on public.dd_mandates for each row execute function private.set_updated_at();
alter table public.dd_mandates enable row level security;
alter table public.dd_mandates force row level security;
