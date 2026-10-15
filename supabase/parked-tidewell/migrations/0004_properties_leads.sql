-- 0004_properties_leads.sql
-- properties and leads (3.3), then the circular references that 3.6 defers to the second table:
-- memberships.property_id, owner_accounts.created_from_lead_id, properties.source_lead_id.

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  owner_account_id uuid not null references public.owner_accounts (id),
  slug text unique check (slug is null or slug ~ '^[a-z0-9][a-z0-9-]*$'),
  name text not null check (btrim(name) <> ''),
  address_line2 text,
  town text not null check (btrim(town) <> ''),
  postcode text,
  kind public.property_kind not null default 'short_stay',
  engagement_type public.engagement_type not null default 'managed',
  status public.property_status not null default 'onboarding',
  sleeps integer check (sleeps is null or sleeps > 0),
  bedrooms integer check (bedrooms is null or bedrooms >= 0),
  bathrooms integer check (bathrooms is null or bathrooms >= 0),
  timezone text not null default 'Australia/Adelaide',
  default_check_in_time time not null default '15:00',
  default_check_out_time time not null default '10:00',
  default_ready_by_time time not null default '14:00',
  code_release_time time not null default '14:00',
  checkout_grace_minutes integer not null default 120 check (checkout_grace_minutes >= 0),
  crew_code_lead_minutes integer not null default 60 check (crew_code_lead_minutes >= 0),
  crew_code_lag_minutes integer not null default 120 check (crew_code_lag_minutes >= 0),
  turnover_minutes integer not null default 180 check (turnover_minutes > 0),
  refresh_after_days integer not null default 14 check (refresh_after_days > 0),
  default_cleaner_id uuid references public.profiles (id),
  clean_pay_cents integer check (clean_pay_cents is null or clean_pay_cents >= 0),
  helper_pay_cents integer check (helper_pay_cents is null or helper_pay_cents >= 0),
  owner_stay_clean_charge_cents integer check (owner_stay_clean_charge_cents is null or owner_stay_clean_charge_cents >= 0),
  qa_every_clean boolean not null default false,
  photo_retention_months integer not null default 24 check (photo_retention_months > 0),
  wifi_ssid text,
  entry_notes text,
  fact_sheet_version integer not null default 1,
  hospitable_property_id text unique,
  rate_floor_cents integer,
  rate_ceiling_cents integer,
  planning_status text not null default 'unknown' check (planning_status in ('unknown', 'owner_advised', 'approved', 'not_required', 'pending')),
  council_rating_category text not null default 'unknown' check (council_rating_category in ('unknown', 'residential', 'commercial')),
  str_register_number text,
  compliance_updated_at timestamptz,
  live_at timestamptz,
  billing_start_date date,
  offboarding_started_at timestamptz,
  closed_at timestamptz,
  handed_over_at timestamptz,
  ownership_changed_at timestamptz,
  source_lead_id uuid, -- fk added below once leads exists
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint properties_rate_band check (rate_floor_cents is null or rate_ceiling_cents is null or rate_ceiling_cents >= rate_floor_cents)
);
comment on table public.properties is 'One home. Status moves only through go_live, start_offboarding, close_property and cancel_offboarding (phase 1); entry_notes only through set_property_notes() with the secret lint.';
create index properties_owner_account_idx on public.properties (owner_account_id);
create index properties_status_idx on public.properties (status);
create trigger properties_set_updated_at before update on public.properties for each row execute function private.set_updated_at();
alter table public.properties enable row level security;
alter table public.properties force row level security;

-- Status guard: the status column changes only inside the named RPCs (phase 1 creates them).
create trigger properties_status_guard before update of status on public.properties
  for each row when (old.status is distinct from new.status)
  execute function private.rpc_guard('go_live', 'start_offboarding', 'close_property', 'cancel_offboarding', 'convert_lead');

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  source public.lead_source not null default 'website',
  stage public.lead_stage not null default 'new',
  name text not null check (btrim(name) <> ''),
  email citext,
  phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  suburb text,
  bedrooms integer check (bedrooms is null or bedrooms >= 0),
  message text,
  netlify_submission_id text unique,
  ip inet,
  user_agent text,
  turnstile_ok boolean,
  ack_sent_at timestamptz,
  thread_id uuid, -- fk added in the phase-6 migration that creates threads (3.6)
  first_reply_at timestamptz,
  assigned_manager_user_id uuid references public.profiles (id),
  next_action_at timestamptz,
  walkthrough_at timestamptz,
  address_line1 text,
  address_line2 text,
  town text,
  current_letting public.current_letting,
  airbnb_connected_elsewhere boolean,
  interest public.engagement_type,
  engagement_type public.engagement_type,
  fee_schedule_id uuid references public.fee_schedules (id),
  setup_fee_cents integer check (setup_fee_cents is null or setup_fee_cents >= 0),
  lost_reason public.lead_lost_reason,
  lost_note text,
  lost_at timestamptz,
  parked_reason text,
  parked_at timestamptz,
  marketing_consent_at timestamptz,
  converted_owner_account_id uuid references public.owner_accounts (id),
  converted_property_id uuid references public.properties (id),
  deidentified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leads_lost_needs_reason check (stage <> 'lost' or lost_reason is not null),
  constraint leads_parked_needs_reason check (stage <> 'parked' or parked_reason is not null),
  constraint leads_setup_fee_needs_schedule check (setup_fee_cents is null or fee_schedule_id is not null)
);
comment on table public.leads is 'One row per verified enquiry (phase 1 route handler) or manager-entered lead. Stages move only through move_lead(). netlify_submission_id is accepted only from a JWS-verified payload.';
create index leads_stage_idx on public.leads (stage);
create index leads_email_idx on public.leads (email);
create index leads_created_at_idx on public.leads (created_at desc);
create trigger leads_set_updated_at before update on public.leads for each row execute function private.set_updated_at();
create trigger leads_stage_guard before update of stage on public.leads
  for each row when (old.stage is distinct from new.stage)
  execute function private.rpc_guard('move_lead', 'convert_lead');
alter table public.leads enable row level security;
alter table public.leads force row level security;

-- A setup fee on a lead or an agreement must sit inside its fee schedule's published band (3.3).
create function private.check_setup_fee_band() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_min integer;
  v_max integer;
begin
  if new.setup_fee_cents is null then
    return new;
  end if;
  select setup_fee_min_inc_gst_cents, setup_fee_max_inc_gst_cents into v_min, v_max
    from public.fee_schedules where id = new.fee_schedule_id;
  if v_min is null then
    raise exception 'setup_fee_cents needs a fee_schedule_id' using errcode = 'check_violation';
  end if;
  if new.setup_fee_cents < v_min or new.setup_fee_cents > v_max then
    raise exception 'setup_fee_cents % is outside the published band % to % (inc GST)', new.setup_fee_cents, v_min, v_max
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger leads_setup_fee_band before insert or update of setup_fee_cents, fee_schedule_id on public.leads
  for each row execute function private.check_setup_fee_band();

-- Deferred circular references (3.6)
alter table public.memberships
  add constraint memberships_property_id_fkey foreign key (property_id) references public.properties (id) on delete cascade;
create index memberships_property_idx on public.memberships (property_id) where property_id is not null;
alter table public.owner_accounts
  add constraint owner_accounts_created_from_lead_id_fkey foreign key (created_from_lead_id) references public.leads (id);
alter table public.properties
  add constraint properties_source_lead_id_fkey foreign key (source_lead_id) references public.leads (id);
