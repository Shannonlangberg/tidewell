-- 0008_agreements.sql
-- agreements and disclosure_acknowledgements (3.3).

create table public.agreements (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id),
  owner_account_id uuid not null references public.owner_accounts (id),
  template_version text not null,
  engagement_type public.engagement_type not null default 'managed',
  fee_schedule_id uuid not null references public.fee_schedules (id),
  setup_fee_cents integer check (setup_fee_cents is null or setup_fee_cents >= 0),
  start_date date,
  notice_days integer check (notice_days is null or notice_days >= 0),
  signature_method public.signature_method not null default 'in_app_click',
  esign_external_id text,
  document_id uuid references public.documents (id),
  signed_by_owner_user_id uuid references public.profiles (id),
  owner_signed_at timestamptz,
  signed_by_tidewell_user_id uuid references public.profiles (id),
  tidewell_signed_at timestamptz,
  status public.agreement_status not null default 'draft',
  earliest_exit_date date,
  terminated_at timestamptz,
  disclosure_set_version text,
  licence_snapshot jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.agreements is 'fee_schedule_id is the row every invoice under the agreement follows, never the latest row. notice_days defaults from the schedule.';
create unique index agreements_one_open_per_property on public.agreements (property_id) where status in ('draft', 'sent', 'signed');
create index agreements_account_idx on public.agreements (owner_account_id);
create trigger agreements_set_updated_at before update on public.agreements for each row execute function private.set_updated_at();
create trigger agreements_setup_fee_band before insert or update of setup_fee_cents, fee_schedule_id on public.agreements
  for each row execute function private.check_setup_fee_band();

create function private.agreements_defaults() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
begin
  if new.notice_days is null then
    select default_notice_days into new.notice_days from public.fee_schedules where id = new.fee_schedule_id;
  end if;
  if new.disclosure_set_version is null then
    select disclosure_set_version into new.disclosure_set_version from public.org_settings where id;
  end if;
  return new;
end $$;
create trigger agreements_defaults before insert on public.agreements for each row execute function private.agreements_defaults();
alter table public.agreements enable row level security;
alter table public.agreements force row level security;

create table public.disclosure_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references public.agreements (id) on delete cascade,
  key text not null check (btrim(key) <> ''),
  version text not null,
  acknowledged_by_user_id uuid not null references public.profiles (id),
  acknowledged_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint disclosure_acknowledgements_unique unique (agreement_id, key)
);
comment on table public.disclosure_acknowledgements is 'Append-only. Written by sign_agreement() (phase 1) for every key in private.disclosure_keys(version).';
create trigger disclosure_acknowledgements_immutable before update or delete on public.disclosure_acknowledgements
  for each row execute function private.raise_immutable();
alter table public.disclosure_acknowledgements enable row level security;
alter table public.disclosure_acknowledgements force row level security;

-- The disclosure keys an agreement must carry for a given disclosure set version (3.3).
create function private.disclosure_keys(p_version text) returns text[]
language sql immutable parallel safe set search_path = pg_catalog as $$
  select array[
    'airbnb_host_only_fee', 'vrbo_ical_only', 'fee_gst_not_recoverable', 'fee_definition', 'cleaning_recharge',
    'repairs_billing', 'no_cohost_payout_to_tidewell', 'direct_bookings_paid_to_owner', 'notice_period',
    'stay_link_via_platform', 'automated_decisions', 'overseas_processors', 'planning_tourist_accommodation',
    'council_rates_may_change', 'sa_str_register_coming', 'no_other_channel_manager', 'data_location',
    'photo_retention', 'stays_60_nights'
  ]::text[]
$$;
