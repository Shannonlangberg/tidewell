-- 0013_helpers.sql
-- The `private` RLS helpers (3.1) and private.emit_event(). Every helper is security definer
-- stable, owned by postgres, search_path pinned, and reads memberships live so revocation is
-- immediate: no JWT claim is trusted for authorisation. Helpers that policies and view bodies
-- call are granted to `authenticated` by name; nothing else in `private` is executable by the API roles.

-- Manager: an active manager membership AND a session at aal2 (TOTP verified). The aal claim is
-- read from the JWT via auth.jwt(); a session without the claim (or at aal1) is never a manager.
create function private.is_manager() returns boolean
language sql stable security definer set search_path = pg_catalog, public, extensions as $$
  select coalesce((auth.jwt() ->> 'aal') = 'aal2', false)
     and exists (
       select 1 from public.memberships m
       where m.user_id = (select auth.uid()) and m.role = 'manager' and m.status = 'active'
     )
$$;

-- Owner of a property for reads: active or read_only owner membership on the account that owns it.
create function private.is_owner_of(p_property_id uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public, extensions as $$
  select exists (
    select 1
    from public.properties p
    join public.memberships m on m.owner_account_id = p.owner_account_id
    where p.id = p_property_id
      and m.user_id = (select auth.uid())
      and m.role = 'owner'
      and m.status in ('active', 'read_only')
  )
$$;

-- Owner of a property for writes: active only (every write RPC uses this).
create function private.is_active_owner_of(p_property_id uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public, extensions as $$
  select exists (
    select 1
    from public.properties p
    join public.memberships m on m.owner_account_id = p.owner_account_id
    where p.id = p_property_id
      and m.user_id = (select auth.uid())
      and m.role = 'owner'
      and m.status = 'active'
  )
$$;

-- Accounts the caller may read (active or read_only owner memberships).
create function private.my_owner_account_ids() returns uuid[]
language sql stable security definer set search_path = pg_catalog, public, extensions as $$
  select coalesce(array_agg(distinct m.owner_account_id), '{}'::uuid[])
  from public.memberships m
  where m.user_id = (select auth.uid()) and m.role = 'owner' and m.status in ('active', 'read_only')
$$;

-- Accounts the caller may write (active owner memberships only).
create function private.my_active_owner_account_ids() returns uuid[]
language sql stable security definer set search_path = pg_catalog, public, extensions as $$
  select coalesce(array_agg(distinct m.owner_account_id), '{}'::uuid[])
  from public.memberships m
  where m.user_id = (select auth.uid()) and m.role = 'owner' and m.status = 'active'
$$;

-- The caller's active roles as text (for the notification_rules scoping predicate).
create function private.my_roles() returns text[]
language sql stable security definer set search_path = pg_catalog, public, extensions as $$
  select coalesce(array_agg(distinct m.role::text), '{}'::text[])
  from public.memberships m
  where m.user_id = (select auth.uid()) and m.status = 'active'
$$;

-- Crew at a property: an active crew membership plus an offered or accepted assignment on a
-- non-cancelled job at the property whose window lies within now - 14 days to now + 30 days.
-- PHASE 0 STUB: jobs and job_assignments do not exist yet, so this returns false for everyone.
-- Phase 3 replaces the body with the real predicate; the signature and grants stay.
create function private.crew_at(p_property_id uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public, extensions as $$
  select false
$$;
comment on function private.crew_at(uuid) is 'Phase 0 stub (always false). Phase 3 replaces the body: active crew membership plus an offered/accepted assignment on a non-cancelled job at the property within now-14d..now+30d.';

-- Crew on a job: an active crew membership plus an offered or accepted assignment on the job.
-- PHASE 0 STUB: returns false until phase 3 creates jobs and job_assignments.
create function private.can_see_job(p_job_id uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public, extensions as $$
  select false
$$;
comment on function private.can_see_job(uuid) is 'Phase 0 stub (always false). Phase 3 replaces the body: active crew membership plus an offered/accepted assignment on the job.';

-- Two people share a property when they are owner members of the same account (either status that
-- reads), or (phase 3) co-assignees on an open job. Used by profiles_directory.
create function private.shares_property(p_other_user_id uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public, extensions as $$
  select exists (
    select 1
    from public.memberships mine
    join public.memberships theirs on theirs.owner_account_id = mine.owner_account_id
    where mine.user_id = (select auth.uid())
      and mine.role = 'owner' and mine.status in ('active', 'read_only')
      and theirs.user_id = p_other_user_id
      and theirs.role = 'owner' and theirs.status in ('active', 'read_only')
      and theirs.user_id <> mine.user_id
  )
$$;

-- Parse a realtime topic `property:{uuid}:{suffix}`; null unless it matches exactly.
create function private.topic_property_id(p_topic text, p_suffix text) returns uuid
language sql immutable parallel safe set search_path = pg_catalog as $$
  select case
    when p_topic ~ ('^property:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}:' || p_suffix || '$')
      then split_part(p_topic, ':', 2)::uuid
    else null
  end
$$;

grant execute on function
  private.is_manager(),
  private.is_owner_of(uuid),
  private.is_active_owner_of(uuid),
  private.my_owner_account_ids(),
  private.my_active_owner_account_ids(),
  private.my_roles(),
  private.crew_at(uuid),
  private.can_see_job(uuid),
  private.shares_property(uuid),
  private.topic_property_id(text, text)
to authenticated;

-- Quiet hours (spec 2) in the organisation's timezone.
create function private.in_quiet_hours(p_at timestamptz default now()) returns boolean
language sql stable security definer set search_path = pg_catalog, public, extensions as $$
  select case
    when o.quiet_start > o.quiet_end
      then (p_at at time zone o.timezone)::time >= o.quiet_start or (p_at at time zone o.timezone)::time < o.quiet_end
    else (p_at at time zone o.timezone)::time >= o.quiet_start and (p_at at time zone o.timezone)::time < o.quiet_end
  end
  from public.org_settings o
  where o.id
$$;

create function private.next_quiet_end(p_at timestamptz default now()) returns timestamptz
language plpgsql stable security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_tz text;
  v_end time;
  v_local_date date;
  v_candidate timestamptz;
begin
  select timezone, quiet_end into v_tz, v_end from public.org_settings where id;
  if v_tz is null then
    return p_at;
  end if;
  v_local_date := (p_at at time zone v_tz)::date;
  v_candidate := (v_local_date + v_end) at time zone v_tz;
  if v_candidate <= p_at then
    v_candidate := ((v_local_date + 1) + v_end) at time zone v_tz;
  end if;
  return v_candidate;
end $$;

-- Payload keys allowed on a non-internal event, per type (3.3 events: whitelisted per type for
-- non-internal audiences; never email, phone, ABN, body, threshold (crew), another party's figures
-- or reveal actors). Later phases extend the case list for their types.
create function private.event_payload_keys(p_type text) returns text[]
language sql immutable parallel safe set search_path = pg_catalog as $$
  select case p_type
    when 'threshold.change_pending' then array['threshold_cents', 'previous_threshold_cents', 'pending_until', 'changed_by_first_name']
    when 'threshold.changed' then array['threshold_cents', 'previous_threshold_cents', 'changed_by_first_name', 'applied_by']
    when 'threshold.change_undone' then array['threshold_cents', 'undone_threshold_cents', 'undone_by_first_name']
    when 'membership.created' then array['role', 'first_name']
    when 'membership.confirmed' then array['role', 'first_name']
    when 'membership.ended' then array['role', 'first_name']
    when 'owner_account.created' then array['display_name']
    when 'property.created' then array['name', 'town']
    when 'property.step_done' then array['step_key', 'phase']
    when 'property.step_waived' then array['step_key', 'phase', 'waived_by_first_name']
    when 'property.went_live' then array['name', 'live_at', 'earliest_exit_date']
    when 'agreement.sent' then array['template_version', 'start_date']
    when 'agreement.signed' then array['template_version', 'signed_by_first_name', 'owner_signed_at']
    when 'dd_mandate.pending' then array['collector']
    when 'dd_mandate.active' then array['collector', 'account_mask']
    when 'dd_mandate.cancelled' then array['collector']
    when 'dd_mandate.failed' then array['collector']
    when 'offboarding.notice_given' then array['effective_date', 'undo_until', 'requested_by_first_name', 'reason']
    when 'offboarding.undo_window' then array['effective_date', 'undo_until', 'requested_by_first_name']
    when 'offboarding.cancelled' then array['cancelled_by_first_name']
    else array[]::text[]
  end
$$;

-- Keys never allowed outside the internal audience, whatever the type.
create function private.event_payload_denied(p_key text, p_audience text[]) returns boolean
language sql immutable parallel safe set search_path = pg_catalog as $$
  select lower(p_key) ~ '(email|phone|abn|body|^ip$|user_agent|actor|secret|password|token|door_code|wifi|bank|address)'
      or (p_audience @> '{crew}' and lower(p_key) ~ '(threshold|cents|amount|fee|rate|pay)')
$$;

-- private.emit_event(): the only writer of public.events. Validates the type against the closed
-- catalogue, forces the internal-only types to the internal audience, whitelists payload keys for
-- non-internal audiences, runs the secret lint over free-text payload values, and inserts the row.
-- The events_route trigger (0016) then routes it into outbox and realtime.
create function private.emit_event(
  p_entity_type text,
  p_entity_id uuid,
  p_type text,
  p_property_id uuid default null,
  p_owner_account_id uuid default null,
  p_audience text[] default '{internal}',
  p_payload jsonb default '{}'::jsonb,
  p_actor_kind text default null,
  p_actor_user_id uuid default null,
  p_correlation_id text default null
) returns bigint
language plpgsql volatile security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_audience text[] := coalesce(p_audience, '{internal}');
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_actor_kind text := p_actor_kind;
  v_actor_user_id uuid := p_actor_user_id;
  v_allowed text[];
  v_key text;
  v_val jsonb;
  v_id bigint;
begin
  if not (p_type = any (private.event_types())) then
    raise exception 'unknown event type %', p_type using errcode = 'check_violation';
  end if;
  if p_type = any (private.internal_only_event_types()) then
    v_audience := '{internal}';
  end if;
  if v_actor_user_id is null and v_actor_kind is null and auth.uid() is not null then
    v_actor_user_id := auth.uid();
    v_actor_kind := 'user';
  end if;
  v_actor_kind := coalesce(v_actor_kind, case when v_actor_user_id is not null then 'user' else 'system' end);

  if not (v_audience <@ array['internal']::text[]) then
    v_allowed := private.event_payload_keys(p_type);
    for v_key, v_val in select key, value from jsonb_each(v_payload) loop
      if private.event_payload_denied(v_key, v_audience) or not (v_key = any (v_allowed)) then
        raise exception 'payload key "%" is not whitelisted for event % with audience %', v_key, p_type, v_audience
          using errcode = 'check_violation';
      end if;
      if jsonb_typeof(v_val) = 'string'
         and v_key !~ '_(at|until|date|id|cents|bps)$'
         and v_key not in ('role', 'status', 'kind', 'type', 'outcome', 'href', 'phase', 'step_key', 'collector', 'reason', 'applied_by') then
        perform private.lint_secret_text(v_val #>> '{}');
      end if;
    end loop;
  end if;

  insert into public.events (entity_type, entity_id, type, property_id, owner_account_id, actor_kind, actor_user_id, audience, payload, correlation_id)
  values (p_entity_type, p_entity_id, p_type, p_property_id, p_owner_account_id, v_actor_kind, v_actor_user_id, v_audience, v_payload, p_correlation_id)
  returning id into v_id;
  return v_id;
end $$;
