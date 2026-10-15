-- 0101_hq_tables_people.sql
-- People and configuration tables (section 4): pods, staff_profiles, role_capabilities, settings.
-- Every table gets RLS enabled and forced in 0106; policies and grants are stated there.

create table hq.pods (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  region text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  constraint pods_name_key unique (name),
  constraint pods_name_not_blank check (btrim(name) <> '')
);
comment on table hq.pods is 'Teams of staff (for example by region). Deactivated, never deleted.';

-- id = auth.users.id. `restrict`, never cascade: the history of who did what must survive a login being removed.
create table hq.staff_profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  full_name text not null,
  first_name text not null,
  email extensions.citext not null,
  role hq.staff_role not null,
  pod_id uuid references hq.pods (id),
  employment_status hq.employment_status not null default 'active',
  start_date date,
  responsibilities text,
  timezone text not null default 'Australia/Adelaide',
  dashboard_widgets text[],
  is_active boolean not null default true,
  invited_by uuid references hq.staff_profiles (id),
  invited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  constraint staff_profiles_email_key unique (email),
  constraint staff_profiles_names_not_blank check (btrim(full_name) <> '' and btrim(first_name) <> '')
);
comment on table hq.staff_profiles is 'One row per person who may use HQ. Written only through the add_staff, update_staff, deactivate_staff and bootstrap_first_director RPCs. Access = is_active and employment_status = active, read live by hq_private.has_capability().';
comment on column hq.staff_profiles.dashboard_widgets is 'null means the role default.';
create index staff_profiles_pod_id_idx on hq.staff_profiles (pod_id);
create index staff_profiles_invited_by_idx on hq.staff_profiles (invited_by);
create index staff_profiles_role_idx on hq.staff_profiles (role) where is_active;

-- The capability matrix. A changed matrix or a new role is a data change, not a code change.
create table hq.role_capabilities (
  role hq.staff_role not null,
  capability text not null,
  primary key (role, capability),
  constraint role_capabilities_capability_not_blank check (btrim(capability) <> '')
);
comment on table hq.role_capabilities is 'Which capability strings each staff role holds. Reference data seeded in 0103; changed by migration, never by the API.';

create table hq.settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
comment on table hq.settings is 'Organisation-wide HQ settings: require_mfa (boolean) and timezone (IANA name).';
