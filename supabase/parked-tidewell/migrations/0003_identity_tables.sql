-- 0003_identity_tables.sql
-- Organisation and identity (3.3): profiles, org_settings, fee_schedules, owner_accounts,
-- owner_account_notes, memberships. Policies come in 0014_policies.sql once the helpers exist;
-- RLS is enabled and forced here so no table is ever reachable before its policies land.

-- profiles: one per auth user; never the source of role.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (btrim(full_name) <> ''),
  first_name text not null check (btrim(first_name) <> ''),
  initials text generated always as (private.initials(full_name, first_name)) stored,
  email citext unique,
  phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  phone_verified_at timestamptz,
  sms_opt_out_at timestamptz,
  email_bounced_at timestamptz,
  timezone text,
  is_active boolean not null default true,
  mfa_enrolled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.profiles is 'One row per auth user, mirrored from auth.users by trigger. Never the source of role (memberships is).';
create trigger profiles_set_updated_at before update on public.profiles for each row execute function private.set_updated_at();
alter table public.profiles enable row level security;
alter table public.profiles force row level security;

-- Mirror auth.users into profiles. Names come from user_metadata; /api/members must pass
-- full_name and first_name or user creation aborts (3.3).
create function private.on_auth_user_created() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_full text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '');
  v_first text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'first_name', '')), '');
begin
  if v_full is null or v_first is null then
    raise exception 'auth user % needs user_metadata.full_name and user_metadata.first_name', new.id
      using errcode = 'not_null_violation';
  end if;
  insert into public.profiles (id, full_name, first_name, email, phone_e164, phone_verified_at)
  values (new.id, v_full, v_first, nullif(new.email, '')::citext,
          case when new.phone ~ '^\+[1-9][0-9]{6,14}$' then new.phone else null end,
          case when new.phone ~ '^\+[1-9][0-9]{6,14}$' then new.phone_confirmed_at else null end);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.on_auth_user_created();

create function private.on_auth_user_updated() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = nullif(new.email, '')::citext where id = new.id;
  end if;
  if new.last_sign_in_at is distinct from old.last_sign_in_at and new.last_sign_in_at is not null then
    update public.memberships set accepted_at = new.last_sign_in_at
      where user_id = new.id and status = 'active' and accepted_at is null;
  end if;
  return new;
end $$;
create trigger on_auth_user_updated after update of email, last_sign_in_at on auth.users
  for each row execute function private.on_auth_user_updated();

-- org_settings: the single row; nulls are unconfirmed and hidden (v1.1: minus default_notice_days,
-- plus licence, privacy versions, emergency cap, tidewell_may_claim, pass_on_dishonour_fee).
create table public.org_settings (
  id boolean primary key default true check (id),
  legal_name text,
  abn text check (abn is null or abn ~ '^[0-9]{11}$'),
  from_email citext,
  reply_to_email citext,
  published_phone_e164 text check (published_phone_e164 is null or published_phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  published_url text,
  gst_registered boolean,
  onboarding_open boolean not null default false,
  long_term_enabled boolean not null default false,
  owners_may_download_photos boolean not null default true,
  disclosure_set_version text not null default '2026-10',
  privacy_policy_version text,
  collection_notice_version text,
  land_agent_licence_number text,
  licensee_user_id uuid references public.profiles (id),
  sla_minutes integer not null default 60 check (sla_minutes > 0),
  hours_start time not null default '08:00',
  hours_end time not null default '22:00',
  quiet_start time not null default '22:00',
  quiet_end time not null default '08:00',
  timezone text not null default 'Australia/Adelaide',
  voice_ring_user_ids uuid[] not null default '{}',
  on_call_voice_enabled boolean not null default false,
  default_supplier_invoice_addressee public.invoice_addressee not null default 'owner',
  collector public.collector not null default 'manual',
  pay_run_weekday smallint not null default 5 check (pay_run_weekday between 0 and 6),
  photo_retention_months integer not null default 24,
  guest_pii_retention_months integer not null default 12,
  stay_link_days_before integer not null default 3,
  emergency_override_cap_cents integer not null default 0 check (emergency_override_cap_cents >= 0),
  tidewell_may_claim boolean not null default false,
  pass_on_dishonour_fee boolean not null default false,
  updated_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.org_settings is 'Single row. Nulls are unconfirmed business facts and stay hidden. gst_registered must be true before any issue_* RPC runs.';
comment on column public.org_settings.default_supplier_invoice_addressee is 'Disclosed to owners as repairs_billing.';
create trigger org_settings_set_updated_at before update on public.org_settings for each row execute function private.set_updated_at();
alter table public.org_settings enable row level security;
alter table public.org_settings force row level security;

-- fee_schedules: published prices as rows; a change is a new row only new agreements point at.
create table public.fee_schedules (
  id uuid primary key default gen_random_uuid(),
  effective_from date not null unique,
  management_fee_bps integer not null default 1800 check (management_fee_bps between 0 and 10000),
  gst_bps integer not null default 1000 check (gst_bps between 0 and 10000),
  total_fee_inc_gst_bps integer generated always as (management_fee_bps + (management_fee_bps * gst_bps) / 10000) stored,
  setup_fee_min_inc_gst_cents integer not null default 300000 check (setup_fee_min_inc_gst_cents >= 0),
  setup_fee_max_inc_gst_cents integer not null default 500000,
  fee_base text not null default 'accommodation_cents',
  revenue_recognition public.revenue_recognition not null default 'check_in',
  cleaning_model public.cleaning_model not null default 'recharge',
  clean_charge_basis public.clean_charge_basis not null default 'pay_plus_super',
  owner_stay_clean_at_cost boolean not null default true,
  cancellation_payout_fee_bps integer not null default 0 check (cancellation_payout_fee_bps between 0 and 10000),
  default_notice_days integer not null default 30 check (default_notice_days >= 0),
  fee_definition text not null check (btrim(fee_definition) <> ''),
  passthrough_definition text not null check (btrim(passthrough_definition) <> ''),
  published_url text,
  published_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  constraint fee_schedules_setup_band check (setup_fee_max_inc_gst_cents >= setup_fee_min_inc_gst_cents)
);
comment on table public.fee_schedules is 'Published prices as rows. Never updated or deleted: a change is a new row that only new agreements point at. total_fee_inc_gst_bps (1980 for 18% + GST) is shown wherever the fee appears.';
alter table public.fee_schedules enable row level security;
alter table public.fee_schedules force row level security;

-- owner_accounts: the billing party; co-owners share one; may own several homes.
create table public.owner_accounts (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (btrim(display_name) <> ''),
  legal_name text,
  abn text check (abn is null or abn ~ '^[0-9]{11}$'),
  gst_registered boolean,
  billing_email citext not null,
  billing_address jsonb,
  approval_threshold_cents integer not null default 15000 check (approval_threshold_cents >= 0),
  threshold_pending_cents integer check (threshold_pending_cents is null or threshold_pending_cents >= 0),
  threshold_pending_until timestamptz,
  engagement_type public.engagement_type not null default 'managed',
  pm_user_id uuid references public.profiles (id),
  contact_method public.contact_method not null default 'phone',
  contact_cadence public.contact_cadence not null default 'monthly',
  prefs text[] not null default '{}',
  credit_balance_cents bigint not null default 0,
  xero_contact_id text,
  created_from_lead_id uuid, -- fk added in 0004 once leads exists (3.6)
  started_at date,
  ended_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint owner_accounts_threshold_pending_pair check ((threshold_pending_cents is null) = (threshold_pending_until is null))
);
comment on column public.owner_accounts.approval_threshold_cents is 'Inclusive of GST. A quote at or under it auto-approves once per item.';
comment on column public.owner_accounts.threshold_pending_cents is 'An increase by a non-primary member waits 24 hours (threshold_pending_until) while every member is told and any may undo it.';
create trigger owner_accounts_set_updated_at before update on public.owner_accounts for each row execute function private.set_updated_at();
create index owner_accounts_pm_user_id_idx on public.owner_accounts (pm_user_id);
create index owner_accounts_threshold_pending_idx on public.owner_accounts (threshold_pending_until) where threshold_pending_until is not null;
alter table public.owner_accounts enable row level security;
alter table public.owner_accounts force row level security;

-- owner_account_notes: the manager-only side of the customer (moved out of owner_accounts in v1.1).
create table public.owner_account_notes (
  owner_account_id uuid primary key references public.owner_accounts (id) on delete cascade,
  notes text,
  relationship_level public.level not null default 'green',
  billing_blocked boolean not null default false,
  billing_blocked_reason text,
  last_human_contact_at timestamptz,
  updated_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint owner_account_notes_blocked_reason check (not billing_blocked or billing_blocked_reason is not null)
);
comment on table public.owner_account_notes is 'Manager-only notes about the customer. Never readable by an owner; last_human_contact_at is maintained by a trigger on interactions (phase 8+).';
create trigger owner_account_notes_set_updated_at before update on public.owner_account_notes for each row execute function private.set_updated_at();
alter table public.owner_account_notes enable row level security;
alter table public.owner_account_notes force row level security;

-- memberships: who may act as what. property_id is reserved for tenants (fk added in 0004).
create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.app_role not null,
  owner_account_id uuid references public.owner_accounts (id) on delete cascade,
  property_id uuid, -- fk added in 0004 once properties exists (3.6)
  crew_kind public.crew_kind,
  status public.membership_status not null default 'invited',
  secrets_access public.secrets_access not null default 'none',
  is_primary_contact boolean not null default false,
  invited_by uuid references public.profiles (id),
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  ended_at timestamptz,
  confirmed_by uuid references public.profiles (id),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint memberships_owner_needs_account check (role <> 'owner' or owner_account_id is not null),
  constraint memberships_crew_needs_kind check (role <> 'crew' or crew_kind is not null),
  constraint memberships_manager_is_global check (role <> 'manager' or (owner_account_id is null and property_id is null and crew_kind is null)),
  constraint memberships_primary_is_owner check (not is_primary_contact or role = 'owner'),
  constraint memberships_ended_has_ended_at check ((status = 'ended') = (ended_at is not null)),
  constraint memberships_unique_grant unique nulls not distinct (user_id, role, owner_account_id, property_id)
);
comment on table public.memberships is 'Who may act as what. RLS helpers read this live, so revocation is immediate; JWT claims only route the UI.';
create unique index memberships_one_primary_contact_per_account
  on public.memberships (owner_account_id)
  where is_primary_contact and status in ('invited', 'active');
create index memberships_user_status_idx on public.memberships (user_id, status);
create index memberships_account_idx on public.memberships (owner_account_id) where owner_account_id is not null;
create index memberships_role_status_idx on public.memberships (role, status);
create trigger memberships_set_updated_at before update on public.memberships for each row execute function private.set_updated_at();
alter table public.memberships enable row level security;
alter table public.memberships force row level security;

-- Two-person rule for managers (3.3): nobody grants themselves a manager row, and a manager row
-- becomes active only through confirm_member() by a different manager. Rows written with no
-- session (dashboard, seed, bootstrap) are exempt: the founders are created there.
create function private.memberships_guard() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_uid uuid := auth.uid();
begin
  if new.role = 'manager' and v_uid is not null then
    if new.user_id = v_uid and (tg_op = 'INSERT' or old.role <> 'manager' or old.user_id <> new.user_id) then
      raise exception 'a manager cannot grant themselves a manager membership' using errcode = 'insufficient_privilege';
    end if;
    if new.status = 'active' and (tg_op = 'INSERT' or old.status <> 'active') then
      if coalesce(current_setting('app.rpc', true), '') <> 'confirm_member'
         or new.confirmed_by is null or new.confirmed_by = new.user_id or new.confirmed_by <> v_uid then
        raise exception 'a manager membership is activated only by confirm_member() from a different manager'
          using errcode = 'insufficient_privilege';
      end if;
    end if;
  end if;
  if tg_op = 'UPDATE' and old.status = 'ended' and new.status <> 'ended' then
    raise exception 'an ended membership is never reactivated; add a new one' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger memberships_guard before insert or update on public.memberships
  for each row execute function private.memberships_guard();
