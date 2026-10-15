-- 0103_hq_capabilities.sql
-- The capability model (D3, D4, D5): the seeded matrix and settings, and the helpers every policy
-- and RPC calls. Reference data is seeded here because every environment needs it.
--
-- NEVER trust a JWT claim for a role or a capability. The helpers read the caller's LIVE
-- hq.staff_profiles row (active, employment_status active) joined to hq.role_capabilities, so a
-- deactivated person loses access on their next query, whatever their token still says. The one
-- claim read is `aal` (the authentication assurance level), which only ever REMOVES access.

-- Settings: require_mfa = true means every HQ query needs an aal2 session. The local dev seed
-- (supabase/seed.sql is Tidewell's; HQ's local switch is a plain update) may turn it off; hosted keeps it on.
insert into hq.settings (key, value) values
  ('require_mfa', 'true'::jsonb),
  ('timezone', '"Australia/Adelaide"'::jsonb)
on conflict (key) do nothing;

-- The matrix (section 4). director holds everything; administrator everything but settings.admin.
insert into hq.role_capabilities (role, capability)
select r.role::hq.staff_role, r.capability
from (values
  ('director', 'growth.read'), ('director', 'growth.write'), ('director', 'growth.delete'),
  ('director', 'tasks.read_all'), ('director', 'tasks.write'), ('director', 'people.read'),
  ('director', 'people.admin'), ('director', 'audit.read'), ('director', 'import.run'),
  ('director', 'settings.admin'),

  ('administrator', 'growth.read'), ('administrator', 'growth.write'), ('administrator', 'growth.delete'),
  ('administrator', 'tasks.read_all'), ('administrator', 'tasks.write'), ('administrator', 'people.read'),
  ('administrator', 'people.admin'), ('administrator', 'audit.read'), ('administrator', 'import.run'),

  ('business_development_manager', 'growth.read'), ('business_development_manager', 'growth.write'),
  ('business_development_manager', 'tasks.read_all'), ('business_development_manager', 'tasks.write'),
  ('business_development_manager', 'people.read'), ('business_development_manager', 'import.run'),

  ('senior_property_manager', 'growth.read'), ('senior_property_manager', 'tasks.read_all'),
  ('senior_property_manager', 'tasks.write'), ('senior_property_manager', 'people.read'),

  ('property_manager', 'growth.read'), ('property_manager', 'tasks.write'), ('property_manager', 'people.read'),

  ('junior_property_manager', 'tasks.write'), ('junior_property_manager', 'people.read'),

  ('virtual_assistant', 'growth.read'), ('virtual_assistant', 'growth.write'),
  ('virtual_assistant', 'tasks.write'), ('virtual_assistant', 'people.read'),

  ('read_only', 'growth.read'), ('read_only', 'tasks.read_all'), ('read_only', 'people.read')
) as r(role, capability)
on conflict do nothing;

-- The caller's staff id, or null when the caller is not an active member of staff. This is identity
-- only (no MFA test) so my_access() can tell "complete MFA" from "no access".
create or replace function hq_private.current_staff_id() returns uuid
language sql stable security definer set search_path = pg_catalog, public, extensions as $$
  select sp.id
  from hq.staff_profiles sp
  where sp.id = (select auth.uid())
    and sp.is_active
    and sp.employment_status = 'active'
$$;

create or replace function hq_private.is_staff() returns boolean
language sql stable security definer set search_path = pg_catalog, public, extensions as $$
  select hq_private.current_staff_id() is not null
$$;

-- The caller's live role, or null when not active staff.
create or replace function hq_private.staff_role() returns hq.staff_role
language sql stable security definer set search_path = pg_catalog, public, extensions as $$
  select sp.role
  from hq.staff_profiles sp
  where sp.id = (select auth.uid())
    and sp.is_active
    and sp.employment_status = 'active'
$$;

-- MFA satisfied: settings.require_mfa is JSON false, or the session is aal2. A missing or malformed
-- setting means MFA is required. An absent aal claim is never aal2.
create or replace function hq_private.mfa_ok() returns boolean
language sql stable security definer set search_path = pg_catalog, public, extensions as $$
  select
    not coalesce((select s.value is distinct from 'false'::jsonb from hq.settings s where s.key = 'require_mfa'), true)
    or coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

-- Active staff AND an MFA-satisfying session: the gate for data that is not capability-specific.
create or replace function hq_private.staff_session() returns boolean
language sql stable security definer set search_path = pg_catalog, public, extensions as $$
  select hq_private.is_staff() and hq_private.mfa_ok()
$$;

-- The capability test used by every policy and RPC: live staff row + role matrix + MFA.
create or replace function hq_private.has_capability(p_capability text) returns boolean
language sql stable security definer set search_path = pg_catalog, public, extensions as $$
  select hq_private.mfa_ok()
     and exists (
       select 1
       from hq.staff_profiles sp
       join hq.role_capabilities rc on rc.role = sp.role
       where sp.id = (select auth.uid())
         and sp.is_active
         and sp.employment_status = 'active'
         and rc.capability = p_capability
     )
$$;

-- The configured timezone (settings.timezone), never hard-coded in a query.
create or replace function hq.today() returns date
language sql stable security definer set search_path = pg_catalog, public, extensions as $$
  select (now() at time zone coalesce((select s.value #>> '{}' from hq.settings s where s.key = 'timezone'), 'Australia/Adelaide'))::date
$$;
comment on function hq.today() is 'Today in the configured timezone (hq.settings.timezone, Australia/Adelaide by default).';
