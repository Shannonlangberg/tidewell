-- 0154_hq_enquiry_auto_reply_not_begun.sql
-- The automatic thank-you (0136) when the website cannot even BEGIN it. The site calls
-- hq.begin_enquiry_auto_reply after storing a new enquiry. When that call errored or timed out (the
-- database busy, the network dropped, or the site deployed before its migration), the site logged it
-- and stopped, so the enquiry kept auto_reply_status 'none' and read exactly like "never tried".
--
--   hq.fail_enquiry_auto_reply(p_enquiry_id, p_error)   service_role ONLY (privileges: 0155). Records
--       that the thank-you could not begin: 'none' -> 'failed' with a short code (begin_timeout; anything
--       else becomes not_begun), audited as System like every other outcome. Any other state is left
--       alone and answered with changed: false. That includes 'sending': begin committed after the site
--       gave up, and the enquiry shows "Thank-you not confirmed". A begin that commits after this finds
--       the enquiry already decided and refuses (already_started), so an enquiry recorded here was never
--       sent to.
--   The status machine (enquiry_auto_reply_guard) also allows none -> failed, for this.
--   hq.begin_enquiry_auto_reply: a not_begun or begin_timeout failure sent nothing, so it no longer
--       counts toward the 24-hour per-address limit or the hourly cap. The other rules are unchanged.

-- ------------------------------------------------------------------ the status machine (0136), none -> failed as well
create or replace function hq_private.enquiry_auto_reply_guard() returns trigger
language plpgsql set search_path = pg_catalog, public, extensions as $$
begin
  if tg_op = 'INSERT' then
    if new.auto_reply_status <> 'none' or new.auto_reply_at is not null or new.auto_reply_message_id is not null
       or new.auto_reply_reason is not null or new.auto_reply_interaction_id is not null then
      raise exception 'a new enquiry has not been answered yet' using errcode = 'check_violation', hint = 'enquiry_auto_reply_new';
    end if;
    return new;
  end if;
  if new.auto_reply_status is not distinct from old.auto_reply_status then
    if new.auto_reply_at is distinct from old.auto_reply_at or new.auto_reply_message_id is distinct from old.auto_reply_message_id
       or new.auto_reply_reason is distinct from old.auto_reply_reason or new.auto_reply_interaction_id is distinct from old.auto_reply_interaction_id then
      raise exception 'the thank-you record cannot be changed' using errcode = 'insufficient_privilege', hint = 'enquiry_auto_reply_fixed';
    end if;
    return new;
  end if;
  if not ((old.auto_reply_status = 'none' and new.auto_reply_status in ('sending', 'skipped', 'failed'))
          or (old.auto_reply_status = 'sending' and new.auto_reply_status in ('sent', 'failed'))) then
    raise exception 'the thank-you cannot go from % to %', old.auto_reply_status, new.auto_reply_status
      using errcode = 'insufficient_privilege', hint = 'enquiry_auto_reply_fixed';
  end if;
  return new;
end $$;

-- ------------------------------------------------------------------ begin_enquiry_auto_reply (0136) with the limits above
create or replace function hq.begin_enquiry_auto_reply(p_enquiry_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_e hq.enquiries;
  v_enabled jsonb;
  v_recent integer;
  v_reply_to text;
  v_first text;
begin
  -- Defence in depth: EXECUTE is granted to service_role only (0137). A person's session never gets here.
  if current_setting('role', true) in ('anon', 'authenticated') or auth.uid() is not null then
    raise exception 'permission denied' using errcode = 'insufficient_privilege';
  end if;
  if p_enquiry_id is null then
    raise exception 'say which enquiry' using errcode = 'invalid_parameter_value';
  end if;

  -- One decision at a time across HQ, so the hourly cap and the per-address limit cannot be raced.
  perform pg_advisory_xact_lock(hashtextextended('hq.enquiry-auto-reply', 0));

  select * into v_e from hq.enquiries e where e.id = p_enquiry_id for update;
  if not found then
    raise exception 'enquiry not found' using errcode = 'no_data_found';
  end if;

  -- Started (or decided) once only: a duplicate submission, a replay or a second call never sends again.
  if v_e.auto_reply_status <> 'none' then
    return jsonb_build_object('send', false, 'reason', 'already_started', 'ref', hq_private.enquiry_ref(v_e.ref_number));
  end if;

  select s.value into v_enabled from hq.settings s where s.key = 'enquiry_auto_reply_enabled';
  if v_enabled is distinct from 'true'::jsonb and v_enabled is not null then
    return hq_private.enquiry_ack_skip(v_e, 'disabled');
  end if;
  if v_e.status <> 'new' then
    return hq_private.enquiry_ack_skip(v_e, 'not_new');
  end if;
  if v_e.received_at < now() - interval '1 hour' then
    return hq_private.enquiry_ack_skip(v_e, 'too_old');
  end if;
  if not hq_private.enquiry_ack_address_ok(v_e.email::text) then
    return hq_private.enquiry_ack_skip(v_e, 'invalid_address');
  end if;

  -- At most one thank-you per address per 24 hours: sent, begun and not finished, or failed (a timeout
  -- may still have been delivered, so a failure is not retried for that address within the day).
  -- A thank-you that never began (not_begun, begin_timeout: 0154) sent nothing, so it does not count.
  select count(*) into v_recent from hq.enquiries x
  where x.email = v_e.email and x.id <> v_e.id
    and x.auto_reply_status in ('sending', 'sent', 'failed') and x.auto_reply_at > now() - interval '24 hours'
    and x.auto_reply_reason is distinct from 'not_begun' and x.auto_reply_reason is distinct from 'begin_timeout';
  if v_recent > 0 then
    return hq_private.enquiry_ack_skip(v_e, 'address_limit');
  end if;

  -- At most 30 attempts across HQ per hour (sent, failed or in flight).
  select count(*) into v_recent from hq.enquiries x
  where x.auto_reply_status in ('sending', 'sent', 'failed') and x.auto_reply_at > now() - interval '1 hour'
    and x.auto_reply_reason is distinct from 'not_begun' and x.auto_reply_reason is distinct from 'begin_timeout';
  if v_recent >= 30 then
    return hq_private.enquiry_ack_skip(v_e, 'hourly_cap');
  end if;

  update hq.enquiries set auto_reply_status = 'sending', auto_reply_at = now()
  where id = v_e.id
  returning * into v_e;

  -- Reply-To: the lead owner's HQ address while they are active staff (else the server uses the From address).
  select sp.email::text into v_reply_to
  from hq.opportunities o join hq.staff_profiles sp on sp.id = o.assigned_to
  where o.id = v_e.opportunity_id and sp.is_active and sp.employment_status = 'active';

  v_first := left(split_part(btrim(v_e.name), ' ', 1), 41);

  return jsonb_build_object(
    'send', true,
    'ref', hq_private.enquiry_ref(v_e.ref_number),
    'to', v_e.email::text,
    'first_name', nullif(v_first, ''),
    'reply_to', v_reply_to);
end $$;
comment on function hq.begin_enquiry_auto_reply(uuid) is 'service_role ONLY (the website, after storing a new enquiry). Decides whether the automatic thank-you may be sent: setting enquiry_auto_reply_enabled, enquiry still new and received within the hour, never started before, a plain address, none sent, begun or failed to that address in 24 hours, fewer than 30 attempts in the last hour across HQ (a thank-you that never began, not_begun or begin_timeout, counts for neither). Refusals are recorded as skipped (with a reason) and audited. Otherwise flips to sending and returns {send: true, ref, to, first_name, reply_to}; else {send: false, reason, ref}.';

-- ------------------------------------------------------------------ fail_enquiry_auto_reply (the website; service_role only)
create function hq.fail_enquiry_auto_reply(p_enquiry_id uuid, p_error text default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_e hq.enquiries;
  v_err text := lower(nullif(btrim(coalesce(p_error, '')), ''));
  v_ref text;
begin
  if current_setting('role', true) in ('anon', 'authenticated') or auth.uid() is not null then
    raise exception 'permission denied' using errcode = 'insufficient_privilege';
  end if;
  if p_enquiry_id is null then
    raise exception 'say which enquiry' using errcode = 'invalid_parameter_value';
  end if;
  select * into v_e from hq.enquiries e where e.id = p_enquiry_id for update;
  if not found then
    raise exception 'enquiry not found' using errcode = 'no_data_found';
  end if;
  v_ref := hq_private.enquiry_ref(v_e.ref_number);
  if v_e.auto_reply_status <> 'none' then
    return jsonb_build_object('ref', v_ref, 'status', v_e.auto_reply_status, 'changed', false);
  end if;
  if v_err is distinct from 'begin_timeout' then
    v_err := 'not_begun';
  end if;

  update hq.enquiries set auto_reply_status = 'failed', auto_reply_at = now(), auto_reply_reason = v_err
  where id = v_e.id
  returning * into v_e;
  perform hq_private.audit_write('auto_reply_failed', 'enquiry', v_e.id,
    'Automatic thank-you for website enquiry ' || v_ref || ' was not sent (' || v_err || ')',
    jsonb_build_object('auto_reply_status', jsonb_build_object('from', 'none', 'to', 'failed'), 'reason', v_err));
  return jsonb_build_object('ref', v_ref, 'status', v_e.auto_reply_status, 'changed', true);
end $$;
comment on function hq.fail_enquiry_auto_reply(uuid, text) is 'service_role ONLY (the website, when begin_enquiry_auto_reply errored or timed out). Records that the automatic thank-you could not begin: none -> failed with not_begun or begin_timeout, audited as System. Any other state is left alone. Returns {ref, status, changed}.';
