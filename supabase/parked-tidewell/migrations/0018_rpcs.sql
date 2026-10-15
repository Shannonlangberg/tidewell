-- 0018_rpcs.sql
-- Phase-0 RPCs (section 6): add_member, end_membership, confirm_member, set_approval_threshold,
-- undo_threshold_change, set_contact_preferences. Each is security definer, owned by postgres,
-- search_path pinned, sets app.rpc, checks auth.uid() and role, and calls private.emit_event().
-- Execute is revoked from public and granted to authenticated.

create function private.require_uid() returns uuid
language plpgsql stable security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;
  return v_uid;
end $$;

create function private.require_manager() returns uuid
language plpgsql stable security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_uid uuid := private.require_uid();
begin
  if not private.is_manager() then
    raise exception 'manager only (an active manager membership at aal2)' using errcode = 'insufficient_privilege';
  end if;
  return v_uid;
end $$;

create function private.first_name_of(p_user_id uuid) returns text
language sql stable security definer set search_path = pg_catalog, public, extensions as $$
  select first_name from public.profiles where id = p_user_id
$$;

-- add_member: manager only. Owner and crew rows start active (the manager vouches for a person
-- /api/members has just created); a manager row starts invited and becomes active only when a
-- different manager calls confirm_member().
create function public.add_member(
  p_user_id uuid,
  p_role public.app_role,
  p_owner_account_id uuid default null,
  p_crew_kind public.crew_kind default null,
  p_is_primary_contact boolean default false,
  p_secrets_access public.secrets_access default 'none'
) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_uid uuid;
  v_id uuid;
  v_status public.membership_status;
begin
  perform set_config('app.rpc', 'add_member', true);
  v_uid := private.require_manager();
  if p_role = 'tenant' then
    raise exception 'tenant memberships are reserved for the long-term phase' using errcode = 'feature_not_supported';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id and is_active) then
    raise exception 'no active profile for user %', p_user_id using errcode = 'foreign_key_violation';
  end if;
  if p_role = 'owner' then
    if p_owner_account_id is null or not exists (select 1 from public.owner_accounts where id = p_owner_account_id) then
      raise exception 'an owner membership needs an owner account' using errcode = 'check_violation';
    end if;
  end if;
  if p_role = 'crew' then
    if p_crew_kind is null then
      raise exception 'a crew membership needs a crew_kind' using errcode = 'check_violation';
    end if;
    insert into public.crew_profiles (user_id, crew_kind) values (p_user_id, p_crew_kind)
      on conflict (user_id) do nothing;
  end if;
  v_status := case when p_role = 'manager' then 'invited'::public.membership_status else 'active'::public.membership_status end;

  insert into public.memberships (user_id, role, owner_account_id, crew_kind, status, secrets_access, is_primary_contact, invited_by, invited_at)
  values (
    p_user_id, p_role,
    case when p_role = 'owner' then p_owner_account_id end,
    case when p_role = 'crew' then p_crew_kind end,
    v_status,
    case when p_role = 'owner' then p_secrets_access else 'none' end,
    p_role = 'owner' and p_is_primary_contact,
    v_uid, now()
  )
  returning id into v_id;

  perform private.emit_event(
    'membership', v_id, 'membership.created',
    null, case when p_role = 'owner' then p_owner_account_id end,
    case when p_role = 'owner' then '{owner}'::text[] else '{internal}'::text[] end,
    jsonb_build_object('role', p_role::text, 'first_name', private.first_name_of(p_user_id)),
    'user', v_uid
  );
  if p_role = 'manager' then
    perform private.emit_event('membership', v_id, 'membership.invited', null, null, '{internal}',
      jsonb_build_object('role', 'manager', 'first_name', private.first_name_of(p_user_id)), 'user', v_uid);
  end if;
  perform set_config('app.rpc', '', true);
  return v_id;
end $$;
revoke execute on function public.add_member(uuid, public.app_role, uuid, public.crew_kind, boolean, public.secrets_access) from public, anon;
grant execute on function public.add_member(uuid, public.app_role, uuid, public.crew_kind, boolean, public.secrets_access) to authenticated;

-- end_membership: manager only. Sets ended_at and deletes the person's auth.sessions rows, so the
-- next refresh and the next Realtime renewal fail (3.1). memberships_after_end drops push
-- subscriptions (and, from phase 3, open assignments and queued offers).
create function public.end_membership(p_membership_id uuid) returns void
language plpgsql volatile security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_uid uuid;
  v_row public.memberships;
begin
  perform set_config('app.rpc', 'end_membership', true);
  v_uid := private.require_manager();
  select * into v_row from public.memberships where id = p_membership_id for update;
  if v_row.id is null then
    raise exception 'membership % not found', p_membership_id using errcode = 'no_data_found';
  end if;
  if v_row.status = 'ended' then
    raise exception 'membership % already ended', p_membership_id using errcode = 'check_violation';
  end if;
  if v_row.role = 'manager' and v_row.status = 'active'
     and (select count(*) from public.memberships where role = 'manager' and status = 'active') <= 1 then
    raise exception 'refusing to end the last active manager membership' using errcode = 'check_violation';
  end if;
  update public.memberships set status = 'ended', ended_at = now(), is_primary_contact = false where id = p_membership_id;
  delete from auth.sessions where user_id = v_row.user_id;
  perform private.emit_event(
    'membership', v_row.id, 'membership.ended',
    null, v_row.owner_account_id,
    case when v_row.role = 'owner' then '{owner}'::text[] else '{internal}'::text[] end,
    jsonb_build_object('role', v_row.role::text, 'first_name', private.first_name_of(v_row.user_id)),
    'user', v_uid
  );
  perform set_config('app.rpc', '', true);
end $$;
revoke execute on function public.end_membership(uuid) from public, anon;
grant execute on function public.end_membership(uuid) to authenticated;

-- confirm_member: a different manager activates an invited manager row (two-person rule).
create function public.confirm_member(p_membership_id uuid) returns void
language plpgsql volatile security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_uid uuid;
  v_row public.memberships;
begin
  perform set_config('app.rpc', 'confirm_member', true);
  v_uid := private.require_manager();
  select * into v_row from public.memberships where id = p_membership_id for update;
  if v_row.id is null then
    raise exception 'membership % not found', p_membership_id using errcode = 'no_data_found';
  end if;
  if v_row.role <> 'manager' or v_row.status <> 'invited' then
    raise exception 'confirm_member() applies to an invited manager membership' using errcode = 'check_violation';
  end if;
  if v_row.user_id = v_uid then
    raise exception 'a manager cannot confirm their own membership' using errcode = 'insufficient_privilege';
  end if;
  update public.memberships
    set status = 'active', confirmed_by = v_uid, confirmed_at = now()
    where id = p_membership_id;
  perform private.emit_event('membership', v_row.id, 'membership.confirmed', null, null, '{internal}',
    jsonb_build_object('role', 'manager', 'first_name', private.first_name_of(v_row.user_id)), 'user', v_uid);
  perform set_config('app.rpc', '', true);
end $$;
revoke execute on function public.confirm_member(uuid) from public, anon;
grant execute on function public.confirm_member(uuid) to authenticated;

-- Apply pending threshold increases whose 24 hours have passed. Called by set_approval_threshold()
-- before it acts and, from phase 4, by cron. Returns the number applied.
create function private.apply_pending_thresholds(p_owner_account_id uuid default null) returns integer
language plpgsql volatile security definer set search_path = pg_catalog, public, extensions as $$
declare
  r record;
  v_n integer := 0;
begin
  for r in
    select id, approval_threshold_cents, threshold_pending_cents
    from public.owner_accounts
    where threshold_pending_until is not null and threshold_pending_until <= now()
      and (p_owner_account_id is null or id = p_owner_account_id)
    for update
  loop
    update public.owner_accounts
      set approval_threshold_cents = r.threshold_pending_cents, threshold_pending_cents = null, threshold_pending_until = null
      where id = r.id;
    perform private.emit_event('owner_account', r.id, 'threshold.changed', null, r.id, '{owner}',
      jsonb_build_object('previous_threshold_cents', r.approval_threshold_cents, 'threshold_cents', r.threshold_pending_cents, 'applied_by', 'timer'),
      'system', null);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- set_approval_threshold: an active owner member of the account (or a manager). A decrease, or any
-- change by the primary contact or a manager, applies at once. An increase by a non-primary member
-- waits 24 hours (threshold_pending_*) while every member is told and any may undo it (v1.1).
create function public.set_approval_threshold(p_owner_account_id uuid, p_threshold_cents integer) returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_uid uuid;
  v_mgr boolean;
  v_member boolean;
  v_primary boolean;
  v_acct public.owner_accounts;
  v_until timestamptz;
begin
  perform set_config('app.rpc', 'set_approval_threshold', true);
  v_uid := private.require_uid();
  if p_threshold_cents is null or p_threshold_cents < 0 then
    raise exception 'threshold must be zero or more cents' using errcode = 'check_violation';
  end if;
  v_mgr := private.is_manager();
  v_member := p_owner_account_id = any (private.my_active_owner_account_ids());
  if not (v_mgr or v_member) then
    raise exception 'only an active owner member of the account or a manager may set the threshold' using errcode = 'insufficient_privilege';
  end if;
  perform private.apply_pending_thresholds(p_owner_account_id);
  select * into v_acct from public.owner_accounts where id = p_owner_account_id for update;
  if v_acct.id is null then
    raise exception 'owner account % not found', p_owner_account_id using errcode = 'no_data_found';
  end if;
  v_primary := exists (
    select 1 from public.memberships m
    where m.owner_account_id = p_owner_account_id and m.user_id = v_uid and m.role = 'owner' and m.status = 'active' and m.is_primary_contact
  );
  if v_mgr or v_primary or p_threshold_cents <= v_acct.approval_threshold_cents then
    update public.owner_accounts
      set approval_threshold_cents = p_threshold_cents, threshold_pending_cents = null, threshold_pending_until = null
      where id = p_owner_account_id;
    perform private.emit_event('owner_account', p_owner_account_id, 'threshold.changed', null, p_owner_account_id, '{owner}',
      jsonb_build_object('previous_threshold_cents', v_acct.approval_threshold_cents, 'threshold_cents', p_threshold_cents,
                         'changed_by_first_name', private.first_name_of(v_uid), 'applied_by', case when v_mgr then 'manager' else 'member' end),
      'user', v_uid);
    perform set_config('app.rpc', '', true);
    return jsonb_build_object('applied', true, 'threshold_cents', p_threshold_cents);
  end if;
  v_until := now() + interval '24 hours';
  update public.owner_accounts
    set threshold_pending_cents = p_threshold_cents, threshold_pending_until = v_until
    where id = p_owner_account_id;
  perform private.emit_event('owner_account', p_owner_account_id, 'threshold.change_pending', null, p_owner_account_id, '{owner}',
    jsonb_build_object('previous_threshold_cents', v_acct.approval_threshold_cents, 'threshold_cents', p_threshold_cents,
                       'pending_until', v_until, 'changed_by_first_name', private.first_name_of(v_uid)),
    'user', v_uid);
  perform set_config('app.rpc', '', true);
  return jsonb_build_object('applied', false, 'threshold_cents', p_threshold_cents, 'pending_until', v_until);
end $$;
revoke execute on function public.set_approval_threshold(uuid, integer) from public, anon;
grant execute on function public.set_approval_threshold(uuid, integer) to authenticated;

-- undo_threshold_change: any active member of the account (or a manager) inside the 24-hour window.
create function public.undo_threshold_change(p_owner_account_id uuid) returns void
language plpgsql volatile security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_uid uuid;
  v_acct public.owner_accounts;
begin
  perform set_config('app.rpc', 'undo_threshold_change', true);
  v_uid := private.require_uid();
  if not (private.is_manager() or p_owner_account_id = any (private.my_active_owner_account_ids())) then
    raise exception 'only an active owner member of the account or a manager may undo a threshold change' using errcode = 'insufficient_privilege';
  end if;
  select * into v_acct from public.owner_accounts where id = p_owner_account_id for update;
  if v_acct.id is null then
    raise exception 'owner account % not found', p_owner_account_id using errcode = 'no_data_found';
  end if;
  if v_acct.threshold_pending_until is null or v_acct.threshold_pending_until <= now() then
    raise exception 'no threshold change is waiting on this account' using errcode = 'check_violation';
  end if;
  update public.owner_accounts set threshold_pending_cents = null, threshold_pending_until = null where id = p_owner_account_id;
  perform private.emit_event('owner_account', p_owner_account_id, 'threshold.change_undone', null, p_owner_account_id, '{owner}',
    jsonb_build_object('threshold_cents', v_acct.approval_threshold_cents, 'undone_threshold_cents', v_acct.threshold_pending_cents,
                       'undone_by_first_name', private.first_name_of(v_uid)),
    'user', v_uid);
  perform set_config('app.rpc', '', true);
end $$;
revoke execute on function public.undo_threshold_change(uuid) from public, anon;
grant execute on function public.undo_threshold_change(uuid) to authenticated;

-- set_contact_preferences: an active owner member of the account (or a manager). Null arguments
-- leave the column alone.
create function public.set_contact_preferences(
  p_owner_account_id uuid,
  p_contact_method public.contact_method default null,
  p_contact_cadence public.contact_cadence default null,
  p_prefs text[] default null
) returns void
language plpgsql volatile security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_uid uuid;
begin
  perform set_config('app.rpc', 'set_contact_preferences', true);
  v_uid := private.require_uid();
  if not (private.is_manager() or p_owner_account_id = any (private.my_active_owner_account_ids())) then
    raise exception 'only an active owner member of the account or a manager may set contact preferences' using errcode = 'insufficient_privilege';
  end if;
  if p_prefs is not null then
    perform private.lint_secret_text(array_to_string(p_prefs, ' '));
  end if;
  update public.owner_accounts
    set contact_method = coalesce(p_contact_method, contact_method),
        contact_cadence = coalesce(p_contact_cadence, contact_cadence),
        prefs = coalesce(p_prefs, prefs)
    where id = p_owner_account_id;
  if not found then
    raise exception 'owner account % not found', p_owner_account_id using errcode = 'no_data_found';
  end if;
  perform private.emit_event('owner_account', p_owner_account_id, 'owner_account.preferences_changed', null, p_owner_account_id, '{internal}',
    jsonb_build_object('contact_method', p_contact_method, 'contact_cadence', p_contact_cadence, 'prefs', to_jsonb(p_prefs)),
    'user', v_uid);
  perform set_config('app.rpc', '', true);
end $$;
revoke execute on function public.set_contact_preferences(uuid, public.contact_method, public.contact_cadence, text[]) from public, anon;
grant execute on function public.set_contact_preferences(uuid, public.contact_method, public.contact_cadence, text[]) to authenticated;
