-- 0108_hq_rpc_access.sql
-- Access and people RPCs (design section 5): my_access, can, add_staff, update_staff,
-- deactivate_staff, bootstrap_first_director, plus the internal guards every RPC uses.
--
-- Every RPC here is `security definer`, pins its search_path, checks its capability INSIDE (the
-- database, not the caller's token, decides) and has execute revoked from public and anon in
-- 0111_hq_function_acl.sql. Callers: authenticated (bootstrap_first_director: service_role only).
-- Errors: 42501 permission denied, 22023 invalid argument, P0002 not found, 23505 already exists.

-- ------------------------------------------------------------------ internal guards
create function hq_private.require_capability(p_capability text) returns void
language plpgsql stable security definer set search_path = pg_catalog, public, extensions as $$
begin
  if not hq_private.has_capability(p_capability) then
    raise exception 'permission denied' using errcode = 'insufficient_privilege', detail = 'requires ' || p_capability;
  end if;
end $$;

-- The caller must be active staff in an MFA-satisfying session; returns their id.
create function hq_private.require_staff() returns uuid
language plpgsql stable security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_id uuid := hq_private.current_staff_id();
begin
  if v_id is null or not hq_private.mfa_ok() then
    raise exception 'permission denied' using errcode = 'insufficient_privilege';
  end if;
  return v_id;
end $$;

-- A person an RPC assigns work to must be active staff (a null means unassigned and passes).
create function hq_private.require_active_staff(p_id uuid, p_what text) returns void
language plpgsql stable security definer set search_path = pg_catalog, public, extensions as $$
begin
  if p_id is not null and not exists (
    select 1 from hq.staff_profiles sp where sp.id = p_id and sp.is_active and sp.employment_status = 'active'
  ) then
    raise exception '% must be an active member of staff', p_what using errcode = 'invalid_parameter_value';
  end if;
end $$;

create function hq_private.valid_timezone(p_tz text) returns boolean
language sql stable set search_path = pg_catalog as $$
  select exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_tz)
$$;

-- ------------------------------------------------------------------ my_access, can, today
-- The only HQ function that works before MFA is complete (aal1): it lets the app tell "must complete
-- MFA" from "no access". capabilities is an EMPTY array unless the session satisfies the MFA
-- requirement. Returns null when the caller is not active staff.
create function hq.my_access() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_sp hq.staff_profiles;
  v_caps text[];
begin
  select sp.* into v_sp
  from hq.staff_profiles sp
  where sp.id = (select auth.uid()) and sp.is_active and sp.employment_status = 'active';
  if not found then
    return null;
  end if;
  if hq_private.mfa_ok() then
    select coalesce(array_agg(rc.capability order by rc.capability), '{}'::text[]) into v_caps
    from hq.role_capabilities rc where rc.role = v_sp.role;
  else
    v_caps := '{}'::text[];
  end if;
  return jsonb_build_object(
    'staff_id', v_sp.id,
    'full_name', v_sp.full_name,
    'first_name', v_sp.first_name,
    'role', v_sp.role,
    'timezone', v_sp.timezone,
    'mfa_required', coalesce((select s.value is distinct from 'false'::jsonb from hq.settings s where s.key = 'require_mfa'), true),
    'aal', coalesce(auth.jwt() ->> 'aal', 'aal1'),
    'capabilities', to_jsonb(v_caps)
  );
end $$;
comment on function hq.my_access() is 'The caller''s staff identity and capabilities, or null when not active staff. Callable at aal1; capabilities is empty until the MFA requirement is met.';

-- For the app to decide what to show; the database still enforces on every query.
create function hq.can(p_capability text) returns boolean
language sql stable security definer set search_path = pg_catalog, public, extensions as $$
  select hq_private.has_capability(p_capability)
$$;
comment on function hq.can(text) is 'True when the caller holds the capability now (live staff row, role matrix and MFA).';

-- ------------------------------------------------------------------ staff
-- add_staff does NOT create the sign-in: the Auth user is created first (lib/hq/staff-admin.ts, secret
-- key, Auth admin API) and this verifies a user with that id and email exists, then adds the profile.
-- Only a director may create a director.
create function hq.add_staff(
  p_user_id uuid,
  p_email text,
  p_full_name text,
  p_role hq.staff_role,
  p_pod uuid default null,
  p_first_name text default null,
  p_start_date date default null,
  p_responsibilities text default null,
  p_timezone text default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_full text := btrim(coalesce(p_full_name, ''));
  v_first text;
  v_tz text;
begin
  perform hq_private.require_capability('people.admin');
  if p_role = 'director' and hq_private.staff_role() is distinct from 'director'::hq.staff_role then
    raise exception 'only a director can create a director' using errcode = 'insufficient_privilege';
  end if;
  if p_user_id is null or v_email = '' or v_full = '' or p_role is null then
    raise exception 'user, email, full name and role are required' using errcode = 'invalid_parameter_value';
  end if;
  v_first := coalesce(nullif(btrim(coalesce(p_first_name, '')), ''), split_part(v_full, ' ', 1));
  if not exists (select 1 from auth.users u where u.id = p_user_id and lower(u.email) = v_email) then
    raise exception 'no sign-in exists for that user and email; create the sign-in first' using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from hq.staff_profiles sp where sp.id = p_user_id or sp.email = v_email::extensions.citext) then
    raise exception 'that person already has an HQ profile' using errcode = 'unique_violation';
  end if;
  if p_pod is not null and not exists (select 1 from hq.pods p where p.id = p_pod and p.is_active) then
    raise exception 'pod not found or inactive' using errcode = 'invalid_parameter_value';
  end if;
  v_tz := coalesce(nullif(btrim(coalesce(p_timezone, '')), ''),
                   (select s.value #>> '{}' from hq.settings s where s.key = 'timezone'),
                   'Australia/Adelaide');
  if not hq_private.valid_timezone(v_tz) then
    raise exception 'unknown timezone' using errcode = 'invalid_parameter_value';
  end if;

  perform hq_private.audit_context('invite', null);
  insert into hq.staff_profiles (id, email, full_name, first_name, role, pod_id, start_date, responsibilities, timezone, invited_by, invited_at)
  values (p_user_id, v_email, v_full, v_first, p_role, p_pod, p_start_date, nullif(btrim(coalesce(p_responsibilities, '')), ''), v_tz, auth.uid(), now());
  perform hq_private.audit_context();

  return jsonb_build_object('staff_id', p_user_id, 'email', v_email, 'role', p_role);
end $$;
comment on function hq.add_staff(uuid, text, text, hq.staff_role, uuid, text, date, text, text) is 'people.admin. Adds the HQ profile for an existing Auth user (verified by id and email). Only a director may create a director.';

-- update_staff: a null argument leaves the field unchanged; p_clear_pod and p_reset_widgets set the
-- pod to none and the dashboard widgets back to the role default. Anyone may change their OWN
-- timezone and dashboard widgets; everything else needs people.admin, and a director may be changed
-- only by a director. Nobody changes their own role or employment status.
create function hq.update_staff(
  p_staff_id uuid,
  p_full_name text default null,
  p_first_name text default null,
  p_role hq.staff_role default null,
  p_pod uuid default null,
  p_clear_pod boolean default false,
  p_employment_status hq.employment_status default null,
  p_start_date date default null,
  p_responsibilities text default null,
  p_timezone text default null,
  p_dashboard_widgets text[] default null,
  p_reset_widgets boolean default false,
  p_is_active boolean default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_caller uuid := hq_private.require_staff();
  v_caller_role hq.staff_role := hq_private.staff_role();
  v_target hq.staff_profiles;
  v_self boolean := (p_staff_id = v_caller);
  v_admin boolean := hq_private.has_capability('people.admin');
  v_tz text := nullif(btrim(coalesce(p_timezone, '')), '');
  v_other_fields boolean;
begin
  select sp.* into v_target from hq.staff_profiles sp where sp.id = p_staff_id for update;
  if not found then
    raise exception 'staff member not found' using errcode = 'no_data_found';
  end if;

  v_other_fields := p_full_name is not null or p_first_name is not null or p_role is not null or p_pod is not null
    or p_clear_pod or p_employment_status is not null or p_start_date is not null or p_responsibilities is not null
    or p_is_active is not null;

  if v_other_fields and not v_admin then
    raise exception 'permission denied' using errcode = 'insufficient_privilege', detail = 'requires people.admin';
  end if;
  if not v_admin and not v_self then
    raise exception 'permission denied' using errcode = 'insufficient_privilege';
  end if;
  if v_target.role = 'director' and v_caller_role is distinct from 'director'::hq.staff_role then
    raise exception 'only a director can change a director' using errcode = 'insufficient_privilege';
  end if;
  if p_role = 'director' and v_caller_role is distinct from 'director'::hq.staff_role then
    raise exception 'only a director can make someone a director' using errcode = 'insufficient_privilege';
  end if;
  if v_self and (p_role is not null or p_employment_status is not null or p_is_active is not null) then
    raise exception 'you cannot change your own role or employment status; ask another administrator' using errcode = 'insufficient_privilege';
  end if;
  if v_tz is not null and not hq_private.valid_timezone(v_tz) then
    raise exception 'unknown timezone' using errcode = 'invalid_parameter_value';
  end if;
  if p_pod is not null and not exists (select 1 from hq.pods p where p.id = p_pod and p.is_active) then
    raise exception 'pod not found or inactive' using errcode = 'invalid_parameter_value';
  end if;

  update hq.staff_profiles set
    full_name = coalesce(nullif(btrim(coalesce(p_full_name, '')), ''), full_name),
    first_name = coalesce(nullif(btrim(coalesce(p_first_name, '')), ''), first_name),
    role = coalesce(p_role, role),
    pod_id = case when p_clear_pod then null else coalesce(p_pod, pod_id) end,
    employment_status = coalesce(p_employment_status, employment_status),
    start_date = coalesce(p_start_date, start_date),
    responsibilities = coalesce(nullif(btrim(coalesce(p_responsibilities, '')), ''), responsibilities),
    timezone = coalesce(v_tz, timezone),
    dashboard_widgets = case when p_reset_widgets then null else coalesce(p_dashboard_widgets, dashboard_widgets) end,
    is_active = coalesce(p_is_active, case p_employment_status when 'ended' then false when 'active' then true else is_active end)
  where id = p_staff_id;

  return jsonb_build_object('staff_id', p_staff_id);
end $$;
comment on function hq.update_staff(uuid, text, text, hq.staff_role, uuid, boolean, hq.employment_status, date, text, text, text[], boolean, boolean) is 'people.admin (anyone for their own timezone and dashboard widgets). Null leaves a field unchanged. A director may be changed only by a director.';

create function hq.deactivate_staff(p_staff_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_target hq.staff_profiles;
begin
  perform hq_private.require_capability('people.admin');
  select sp.* into v_target from hq.staff_profiles sp where sp.id = p_staff_id for update;
  if not found then
    raise exception 'staff member not found' using errcode = 'no_data_found';
  end if;
  if p_staff_id = auth.uid() then
    raise exception 'you cannot deactivate yourself; ask another administrator' using errcode = 'insufficient_privilege';
  end if;
  if v_target.role = 'director' and hq_private.staff_role() is distinct from 'director'::hq.staff_role then
    raise exception 'only a director can deactivate a director' using errcode = 'insufficient_privilege';
  end if;
  if v_target.is_active or v_target.employment_status <> 'ended' then
    perform hq_private.audit_context('deactivate', left(p_reason, 200));
    -- the last-director trigger refuses when this would leave HQ with no active director
    update hq.staff_profiles set is_active = false, employment_status = 'ended' where id = p_staff_id;
    perform hq_private.audit_context();
  end if;
  return jsonb_build_object('staff_id', p_staff_id, 'is_active', false);
end $$;
comment on function hq.deactivate_staff(uuid, text) is 'people.admin. Ends access at once (the live staff row is read on every query). History is kept. A director only by a director; never the last active director.';

-- The first director. Callable only by the secret key (service_role), once: it refuses if ANY staff
-- profile exists. Run it from a script, after creating the Auth user.
create function hq.bootstrap_first_director(p_user_id uuid, p_email text, p_full_name text, p_first_name text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_full text := btrim(coalesce(p_full_name, ''));
  v_first text := btrim(coalesce(p_first_name, ''));
begin
  perform pg_advisory_xact_lock(hashtextextended('hq.bootstrap', 0));
  if exists (select 1 from hq.staff_profiles) then
    raise exception 'HQ already has staff; the first director can be created only once';
  end if;
  if p_user_id is null or v_email = '' or v_full = '' or v_first = '' then
    raise exception 'user, email, full name and first name are required' using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id and lower(u.email) = v_email) then
    raise exception 'no sign-in exists for that user and email' using errcode = 'invalid_parameter_value';
  end if;
  perform hq_private.audit_context('bootstrap', null);
  insert into hq.staff_profiles (id, email, full_name, first_name, role)
  values (p_user_id, v_email, v_full, v_first, 'director');
  perform hq_private.audit_context();
  return jsonb_build_object('staff_id', p_user_id, 'role', 'director');
end $$;
comment on function hq.bootstrap_first_director(uuid, text, text, text) is 'service_role only. Creates the first director; refuses when any staff profile exists.';
