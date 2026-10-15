-- 0120_hq_ai_rpc.sql
-- Phase 3 RPCs (docs/hq-phase-3.md, section 2): ai_status, ai_begin_request, ai_finish_request.
--
-- Each is `security definer`, pins its search_path, checks the caller INSIDE (live staff row, MFA and
-- the ai.use capability; never a JWT claim) and has execute for authenticated only (0121). The two
-- writers are audited with hq_private.audit_write (action ai_begin / ai_finish, entity ai_request);
-- the audit row never copies the question text (it is in hq.ai_requests, readable by audit.read).
-- Errors:
--   42501 permission denied             not active staff, no MFA-satisfying session, or no ai.use
--   55000 Ask Planted is switched off   settings.ai_enabled is not true          (hint ai_disabled)
--   54000 hourly limit reached          ai_hourly_limit requests in the last hour (hint ai_rate_limited)
--   22023 invalid argument              question, status, tools or token counts
--   P0002 ai request not found          no such request, or it is not the caller's
--   23514 already finished              the request was finished before

-- ------------------------------------------------------------------ internal helpers
-- Switched on only when the setting is exactly JSON true; missing or malformed means off.
create function hq_private.ai_enabled() returns boolean
language sql stable security definer set search_path = pg_catalog, public, extensions as $$
  select coalesce((select s.value = 'true'::jsonb from hq.settings s where s.key = 'ai_enabled'), false)
$$;

-- The per-person hourly limit (default 40 when missing or malformed).
create function hq_private.ai_hourly_limit() returns integer
language sql stable security definer set search_path = pg_catalog, public, extensions as $$
  select hq_private.setting_int('ai_hourly_limit', 40)
$$;

-- Requests the person began in the rolling hour ending now (every status counts).
create function hq_private.ai_used_this_hour(p_staff uuid) returns integer
language sql stable security definer set search_path = pg_catalog, public, extensions as $$
  select count(*)::integer from hq.ai_requests r
  where r.staff_id = p_staff and r.asked_at > now() - interval '1 hour'
$$;

-- ------------------------------------------------------------------ ai_status
-- {enabled boolean, hourly_limit integer, remaining integer} for the caller. remaining is
-- greatest(hourly_limit - requests begun in the last hour, 0), computed whether or not it is enabled.
create function hq.ai_status() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_staff uuid := hq_private.require_staff();
  v_limit integer;
begin
  perform hq_private.require_capability('ai.use');
  v_limit := hq_private.ai_hourly_limit();
  return jsonb_build_object(
    'enabled', hq_private.ai_enabled(),
    'hourly_limit', v_limit,
    'remaining', greatest(v_limit - hq_private.ai_used_this_hour(v_staff), 0));
end $$;
comment on function hq.ai_status() is 'ai.use. {enabled, hourly_limit, remaining} for the caller (remaining in the rolling hour).';

-- ------------------------------------------------------------------ ai_begin_request
-- Logs a new request as started and returns its id. Refuses (and stores nothing) when Ask Planted is
-- switched off, when the question is blank or over 2000 characters, or when the caller has already
-- begun ai_hourly_limit requests in the rolling hour. The question is stored trimmed. A per-person
-- advisory lock makes the limit exact under concurrent calls.
create function hq.ai_begin_request(p_question text) returns uuid
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_staff uuid := hq_private.require_staff();
  v_question text := btrim(coalesce(p_question, ''));
  v_limit integer;
  v_id uuid;
begin
  perform hq_private.require_capability('ai.use');
  if not hq_private.ai_enabled() then
    raise exception 'Ask Planted is switched off' using errcode = 'object_not_in_prerequisite_state',
      hint = 'ai_disabled', detail = 'a director can switch it on in Settings';
  end if;
  if v_question = '' then
    raise exception 'a question is required' using errcode = 'invalid_parameter_value';
  end if;
  if char_length(v_question) > 2000 then
    raise exception 'a question is at most 2000 characters' using errcode = 'invalid_parameter_value';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('hq.ai_requests:' || v_staff::text, 0));
  v_limit := hq_private.ai_hourly_limit();
  if hq_private.ai_used_this_hour(v_staff) >= v_limit then
    raise exception 'hourly limit reached' using errcode = 'program_limit_exceeded',
      hint = 'ai_rate_limited', detail = format('at most %s questions per hour', v_limit);
  end if;

  insert into hq.ai_requests (staff_id, question) values (v_staff, v_question) returning id into v_id;
  perform hq_private.audit_write('ai_begin', 'ai_request', v_id, 'Asked Planted a question',
    jsonb_build_object('status', jsonb_build_object('to', 'started'), 'question_length', jsonb_build_object('to', char_length(v_question))));
  return v_id;
end $$;
comment on function hq.ai_begin_request(text) is 'ai.use. Logs a started request (question trimmed, 1 to 2000 characters) and returns its id. Raises 55000 when switched off, 54000 over the hourly limit.';

-- ------------------------------------------------------------------ ai_finish_request
-- Finishes the caller's own started request exactly once: final status (answered | refused | error |
-- rate_limited), the tool names used (null = none; at most 64, each ^[a-z][a-z0-9_]{0,63}$; repeats
-- kept in call order), token counts (null = unknown; never negative) and finished_at = now().
-- Works even if Ask Planted was switched off after the request began. Returns nothing.
create function hq.ai_finish_request(
  p_id uuid,
  p_tools text[],
  p_status text,
  p_input_tokens integer,
  p_output_tokens integer
) returns void
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_staff uuid := hq_private.require_staff();
  v_req hq.ai_requests;
  v_tools text[] := coalesce(p_tools, '{}'::text[]);
begin
  perform hq_private.require_capability('ai.use');
  if p_status is null or p_status not in ('answered', 'refused', 'error', 'rate_limited') then
    raise exception 'status must be answered, refused, error or rate_limited' using errcode = 'invalid_parameter_value';
  end if;
  if cardinality(v_tools) > 64 then
    raise exception 'at most 64 tool names' using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from unnest(v_tools) t where t is null or t !~ '^[a-z][a-z0-9_]{0,63}$') then
    raise exception 'each tool name is lower-case letters, digits and underscores' using errcode = 'invalid_parameter_value';
  end if;
  if coalesce(p_input_tokens, 0) < 0 or coalesce(p_output_tokens, 0) < 0 then
    raise exception 'token counts cannot be negative' using errcode = 'invalid_parameter_value';
  end if;

  select r.* into v_req from hq.ai_requests r where r.id = p_id for update;
  if not found or v_req.staff_id is distinct from v_staff then
    raise exception 'ai request not found' using errcode = 'no_data_found';
  end if;
  if v_req.status <> 'started' then
    raise exception 'this request is already finished' using errcode = 'check_violation';
  end if;

  update hq.ai_requests
  set status = p_status, tools_used = v_tools, input_tokens = p_input_tokens, output_tokens = p_output_tokens, finished_at = now()
  where id = p_id;
  perform hq_private.audit_write('ai_finish', 'ai_request', p_id, 'Ask Planted request ' || p_status,
    jsonb_build_object('status', jsonb_build_object('from', 'started', 'to', p_status),
                       'tools_used', jsonb_build_object('to', hq_private.audit_trim(to_jsonb(v_tools))),
                       'input_tokens', jsonb_build_object('to', p_input_tokens),
                       'output_tokens', jsonb_build_object('to', p_output_tokens)));
end $$;
comment on function hq.ai_finish_request(uuid, text[], text, integer, integer) is 'ai.use. Finishes the caller''s own started request once: status, tools used, token counts, finished_at.';

revoke execute on all functions in schema hq_private from public, anon;
revoke execute on all functions in schema hq from public, anon;
