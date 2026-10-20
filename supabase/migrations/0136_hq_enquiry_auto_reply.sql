-- 0136_hq_enquiry_auto_reply.sql
-- The automatic thank-you to the person who filled in a website form (docs/hq-setup.md "Website
-- enquiries", "The thank-you email"). After HQ stores a NEW enquiry (not a duplicate), the site sends
-- ONE short, generic, branded acknowledgement to the address the person typed. The address belongs to an
-- unauthenticated member of the public, so the database decides whether it may be sent at all:
--
--   hq.begin_enquiry_auto_reply(p_enquiry_id)   service_role ONLY. Refuses (and records why, as
--       'skipped') unless: the setting enquiry_auto_reply_enabled is true; the enquiry is still 'new'
--       (never spam) and was received in the last hour; its auto reply has never been started (so a
--       duplicate or a replay can never send twice: double-begin is refused); the address passes a
--       basic shape check; no acknowledgement was sent, started or failed to the same address in the
--       last 24 hours (a failure counts: a timeout may still have been delivered); and fewer than 30
--       acknowledgements were attempted across HQ in the last hour. When it
--       may send, it flips the enquiry to 'sending' (the guard) and returns the recipient, the first
--       word of the name (the server applies a strict check before greeting by it), the lead owner's HQ
--       address for Reply-To, and the ENQ ref.
--   hq.finish_enquiry_auto_reply(p_enquiry_id, p_ok, p_message_id, p_error)   service_role ONLY.
--       Only from 'sending'. On success: 'sent', the provider's message id, and a timeline entry on the
--       lead and contact (type email, "Automatic thank-you email sent to the enquirer", system actor) so
--       it shows as a touch point. On failure: 'failed' with a short code. Both audited as System.
--
-- COLUMNS on hq.enquiries: auto_reply_status (none, sending, sent, failed, skipped), auto_reply_at (when
-- it was decided), auto_reply_message_id (sent only), auto_reply_reason (a short code: why skipped or
-- failed), auto_reply_interaction_id (the timeline entry, sent only). The address itself is never copied
-- anywhere new, and no audit event carries it.
--
-- SETTING enquiry_auto_reply_enabled: default true; true or false (settings_guard); changed by
-- settings.admin (directors) through the settings row (RLS), audited by the settings trigger.
--
-- mark_enquiry_spam is replaced so the thank-you's own timeline entry is treated like the enquiry's
-- message: it does not count as "someone worked on this lead", and it is archived with the lead.
-- Privileges: 0137.

-- ------------------------------------------------------------------ the columns
create type hq.enquiry_auto_reply_status as enum ('none', 'sending', 'sent', 'failed', 'skipped');

alter table hq.enquiries
  add column auto_reply_status hq.enquiry_auto_reply_status not null default 'none',
  add column auto_reply_at timestamptz,
  add column auto_reply_message_id text,
  add column auto_reply_reason text,
  add column auto_reply_interaction_id uuid references hq.interactions (id);

alter table hq.enquiries
  add constraint enquiries_auto_reply_at_pair check ((auto_reply_status = 'none') = (auto_reply_at is null)),
  add constraint enquiries_auto_reply_message_shape check (auto_reply_message_id is null
    or (auto_reply_status = 'sent' and auto_reply_message_id ~ '^[A-Za-z0-9._:@=+-]{1,200}$')),
  add constraint enquiries_auto_reply_reason_shape check (auto_reply_reason is null
    or (auto_reply_status in ('skipped', 'failed') and auto_reply_reason ~ '^[a-z0-9_]{1,40}$')),
  add constraint enquiries_auto_reply_interaction_sent check (auto_reply_interaction_id is null or auto_reply_status = 'sent');

comment on column hq.enquiries.auto_reply_status is 'The automatic thank-you to the enquirer: none (not attempted), sending (begun; the guard against a second send), sent, failed, skipped (refused by begin_enquiry_auto_reply; see auto_reply_reason).';
comment on column hq.enquiries.auto_reply_at is 'When the thank-you was begun, then when it was sent, failed or skipped.';
comment on column hq.enquiries.auto_reply_message_id is 'The email provider''s message id for a sent thank-you.';
comment on column hq.enquiries.auto_reply_reason is 'Why the thank-you was skipped (disabled, not_new, too_old, invalid_address, address_limit, hourly_cap) or failed (a provider code).';
comment on column hq.enquiries.auto_reply_interaction_id is 'The timeline entry for a sent thank-you (on the lead and the contact).';

-- Global hourly cap and the 24-hour per-address limit read these.
create index enquiries_auto_reply_at_idx on hq.enquiries (auto_reply_at desc) where auto_reply_status in ('sending', 'sent', 'failed');
create index enquiries_auto_reply_email_idx on hq.enquiries (email, auto_reply_at desc) where auto_reply_status in ('sending', 'sent', 'failed');
create index enquiries_auto_reply_interaction_idx on hq.enquiries (auto_reply_interaction_id);

-- ------------------------------------------------------------------ the auto reply's own status machine (every writer, including the table owner)
--   none -> sending | skipped;  sending -> sent | failed;  sent, failed and skipped are final.
create function hq_private.enquiry_auto_reply_guard() returns trigger
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
  if not ((old.auto_reply_status = 'none' and new.auto_reply_status in ('sending', 'skipped'))
          or (old.auto_reply_status = 'sending' and new.auto_reply_status in ('sent', 'failed'))) then
    raise exception 'the thank-you cannot go from % to %', old.auto_reply_status, new.auto_reply_status
      using errcode = 'insufficient_privilege', hint = 'enquiry_auto_reply_fixed';
  end if;
  return new;
end $$;

create trigger enquiry_auto_reply_guard before insert or update on hq.enquiries
  for each row execute function hq_private.enquiry_auto_reply_guard();

-- ------------------------------------------------------------------ the switch
insert into hq.settings (key, value) values ('enquiry_auto_reply_enabled', 'true'::jsonb) on conflict (key) do nothing;

-- settings_guard (0134) with enquiry_auto_reply_enabled: true or false.
create or replace function hq_private.settings_guard() returns trigger
language plpgsql set search_path = pg_catalog, public, extensions as $$
declare
  v_max integer;
  v_date date;
begin
  if tg_op = 'UPDATE' and new.key is distinct from old.key then
    raise exception 'a setting key cannot change' using errcode = 'insufficient_privilege';
  end if;
  if new.key = 'require_mfa' and jsonb_typeof(new.value) is distinct from 'boolean' then
    raise exception 'require_mfa must be true or false' using errcode = 'invalid_parameter_value';
  end if;
  if new.key = 'ai_enabled' and jsonb_typeof(new.value) is distinct from 'boolean' then
    raise exception 'ai_enabled must be true or false' using errcode = 'invalid_parameter_value';
  end if;
  if new.key = 'email_chat_send_enabled' and jsonb_typeof(new.value) is distinct from 'boolean' then
    raise exception 'email_chat_send_enabled must be true or false' using errcode = 'invalid_parameter_value';
  end if;
  if new.key = 'enquiry_auto_reply_enabled' and jsonb_typeof(new.value) is distinct from 'boolean' then
    raise exception 'enquiry_auto_reply_enabled must be true or false' using errcode = 'invalid_parameter_value';
  end if;
  if new.key = 'timezone' and (
       jsonb_typeof(new.value) is distinct from 'string'
       or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = new.value #>> '{}')) then
    raise exception 'timezone must be an IANA timezone name' using errcode = 'invalid_parameter_value';
  end if;
  if new.key in ('contractor_min_reviews_for_rating', 'contractor_expiry_warning_days', 'ai_hourly_limit', 'goal_managed_properties', 'email_daily_limit') then
    v_max := case new.key when 'contractor_min_reviews_for_rating' then 100 when 'ai_hourly_limit' then 1000
                          when 'goal_managed_properties' then 10000 when 'email_daily_limit' then 200 else 365 end;
    if jsonb_typeof(new.value) is distinct from 'number' or (new.value #>> '{}') !~ '^[0-9]{1,5}$' then
      raise exception '% must be a whole number from 1 to %', new.key, v_max using errcode = 'invalid_parameter_value';
    end if;
    if (new.value #>> '{}')::integer not between 1 and v_max then
      raise exception '% must be a whole number from 1 to %', new.key, v_max using errcode = 'invalid_parameter_value';
    end if;
  end if;
  if new.key = 'goal_date' and jsonb_typeof(new.value) is distinct from 'null' then
    if jsonb_typeof(new.value) is distinct from 'string' or (new.value #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'goal_date must be null or a date (YYYY-MM-DD)' using errcode = 'invalid_parameter_value';
    end if;
    begin
      v_date := (new.value #>> '{}')::date;
    exception when others then
      raise exception 'goal_date must be null or a date (YYYY-MM-DD)' using errcode = 'invalid_parameter_value';
    end;
    if to_char(v_date, 'YYYY-MM-DD') <> (new.value #>> '{}') or v_date not between date '2000-01-01' and date '2100-12-31' then
      raise exception 'goal_date must be null or a date (YYYY-MM-DD)' using errcode = 'invalid_parameter_value';
    end if;
  end if;
  if new.key = 'enquiry_default_owner_id' and jsonb_typeof(new.value) is distinct from 'null' then
    if jsonb_typeof(new.value) is distinct from 'string'
       or (new.value #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or not exists (select 1 from hq.staff_profiles sp
                      where sp.id = (new.value #>> '{}')::uuid and sp.is_active and sp.employment_status = 'active') then
      raise exception 'enquiry_default_owner_id must be null or an active member of staff' using errcode = 'invalid_parameter_value';
    end if;
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;

-- ------------------------------------------------------------------ helpers (no API role may execute them: 0137)
-- A plain, deliverable-looking address: one @, a local part of ordinary characters, a dotted domain with
-- a letters-only top-level label, nothing longer than 254. Stricter than the table's shape check.
create function hq_private.enquiry_ack_address_ok(p_email text) returns boolean
language sql immutable parallel safe set search_path = pg_catalog as $$
  select p_email is not null
     and char_length(p_email) <= 254
     and p_email ~ '^[A-Za-z0-9._%+''-]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}$'
     and p_email !~ '\.\.'
     and p_email !~ '^\.|\.@|@-|-\.|\.-'
$$;

-- Records a refusal: 'skipped' with its reason (only from 'none'), audited as System.
create function hq_private.enquiry_ack_skip(p_e hq.enquiries, p_reason text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
begin
  if p_e.auto_reply_status = 'none' then
    update hq.enquiries set auto_reply_status = 'skipped', auto_reply_at = now(), auto_reply_reason = p_reason
    where id = p_e.id;
    perform hq_private.audit_write('auto_reply_skipped', 'enquiry', p_e.id,
      'Automatic thank-you for website enquiry ' || hq_private.enquiry_ref(p_e.ref_number) || ' not sent (' || p_reason || ')',
      jsonb_build_object('auto_reply_status', jsonb_build_object('from', 'none', 'to', 'skipped'), 'reason', p_reason));
  end if;
  return jsonb_build_object('send', false, 'reason', p_reason, 'ref', hq_private.enquiry_ref(p_e.ref_number));
end $$;

-- ------------------------------------------------------------------ begin_enquiry_auto_reply (the website; service_role only)
create function hq.begin_enquiry_auto_reply(p_enquiry_id uuid) returns jsonb
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
  select count(*) into v_recent from hq.enquiries x
  where x.email = v_e.email and x.id <> v_e.id
    and x.auto_reply_status in ('sending', 'sent', 'failed') and x.auto_reply_at > now() - interval '24 hours';
  if v_recent > 0 then
    return hq_private.enquiry_ack_skip(v_e, 'address_limit');
  end if;

  -- At most 30 attempts across HQ per hour (sent, failed or in flight).
  select count(*) into v_recent from hq.enquiries x
  where x.auto_reply_status in ('sending', 'sent', 'failed') and x.auto_reply_at > now() - interval '1 hour';
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
comment on function hq.begin_enquiry_auto_reply(uuid) is 'service_role ONLY (the website, after storing a new enquiry). Decides whether the automatic thank-you may be sent: setting enquiry_auto_reply_enabled, enquiry still new and received within the hour, never started before, a plain address, none sent, begun or failed to that address in 24 hours, fewer than 30 attempts in the last hour across HQ. Refusals are recorded as skipped (with a reason) and audited. Otherwise flips to sending and returns {send: true, ref, to, first_name, reply_to}; else {send: false, reason, ref}.';

-- ------------------------------------------------------------------ finish_enquiry_auto_reply (the website; service_role only)
create function hq.finish_enquiry_auto_reply(p_enquiry_id uuid, p_ok boolean, p_message_id text default null, p_error text default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_e hq.enquiries;
  v_msg text := nullif(left(btrim(coalesce(p_message_id, '')), 200), '');
  v_err text := lower(nullif(btrim(coalesce(p_error, '')), ''));
  v_interaction uuid;
  v_ref text;
begin
  if current_setting('role', true) in ('anon', 'authenticated') or auth.uid() is not null then
    raise exception 'permission denied' using errcode = 'insufficient_privilege';
  end if;
  if p_ok is null then
    raise exception 'say whether the thank-you was sent' using errcode = 'invalid_parameter_value';
  end if;
  select * into v_e from hq.enquiries e where e.id = p_enquiry_id for update;
  if not found then
    raise exception 'enquiry not found' using errcode = 'no_data_found';
  end if;
  if v_e.auto_reply_status <> 'sending' then
    raise exception 'this thank-you is not being sent' using errcode = 'invalid_parameter_value', hint = 'enquiry_auto_reply_not_sending';
  end if;
  v_ref := hq_private.enquiry_ref(v_e.ref_number);
  if v_msg is not null and v_msg !~ '^[A-Za-z0-9._:@=+-]+$' then
    v_msg := null;
  end if;

  if p_ok then
    if v_e.opportunity_id is not null or v_e.contact_id is not null then
      insert into hq.interactions (opportunity_id, contact_id, interaction_type, occurred_at, summary, staff_id)
      values (v_e.opportunity_id, v_e.contact_id, 'email', now(), 'Automatic thank-you email sent to the enquirer', null)
      returning id into v_interaction;
    end if;
    update hq.enquiries set auto_reply_status = 'sent', auto_reply_at = now(), auto_reply_message_id = v_msg, auto_reply_interaction_id = v_interaction
    where id = v_e.id
    returning * into v_e;
    perform hq_private.audit_write('auto_reply_sent', 'enquiry', v_e.id,
      'Automatic thank-you email sent for website enquiry ' || v_ref,
      jsonb_build_object('auto_reply_status', jsonb_build_object('from', 'sending', 'to', 'sent'), 'interaction_id', v_interaction));
  else
    if v_err is null or v_err !~ '^[a-z0-9_]{1,40}$' then
      v_err := 'provider_error';
    end if;
    update hq.enquiries set auto_reply_status = 'failed', auto_reply_at = now(), auto_reply_reason = v_err
    where id = v_e.id
    returning * into v_e;
    perform hq_private.audit_write('auto_reply_failed', 'enquiry', v_e.id,
      'Automatic thank-you for website enquiry ' || v_ref || ' was not sent (' || v_err || ')',
      jsonb_build_object('auto_reply_status', jsonb_build_object('from', 'sending', 'to', 'failed'), 'reason', v_err));
  end if;
  return jsonb_build_object('ref', v_ref, 'status', v_e.auto_reply_status, 'interaction_id', v_interaction, 'changed', true);
end $$;
comment on function hq.finish_enquiry_auto_reply(uuid, boolean, text, text) is 'service_role ONLY. Records what the email provider said about the automatic thank-you, once (only from sending): sent (message id; a timeline entry of type email on the lead and contact, as System) or failed (a short code). Audited. Returns {ref, status, interaction_id, changed}.';

-- ------------------------------------------------------------------ mark_enquiry_spam (0134) with the thank-you's timeline entry
create or replace function hq.mark_enquiry_spam(p_id uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_caller uuid := hq_private.require_staff();
  v_e hq.enquiries;
  v_note text;
  v_lead boolean := false;
  v_contact boolean := false;
  v_ref text;
begin
  perform hq_private.require_capability('growth.write');
  v_note := hq_private.enquiry_line(p_note, 500, 'the note');
  select * into v_e from hq.enquiries e where e.id = p_id for update;
  if not found then
    raise exception 'enquiry not found' using errcode = 'no_data_found';
  end if;
  v_ref := hq_private.enquiry_ref(v_e.ref_number);
  if v_e.status = 'spam' then
    return jsonb_build_object('enquiry_id', v_e.id, 'ref', v_ref, 'status', v_e.status, 'changed', false, 'lead_archived', false, 'contact_archived', false);
  end if;

  if v_e.created_lead and v_e.opportunity_id is not null and exists (
       select 1 from hq.opportunities o
       where o.id = v_e.opportunity_id and o.deleted_at is null and o.stage = 'introduction_received'
         and not exists (select 1 from hq.opportunity_stage_history h where h.opportunity_id = o.id and h.from_stage is not null)
         and not exists (select 1 from hq.interactions i where i.opportunity_id = o.id and i.deleted_at is null
                           and i.id is distinct from v_e.interaction_id and i.id is distinct from v_e.auto_reply_interaction_id)
         and not exists (select 1 from hq.tasks t where t.related_opportunity_id = o.id and t.deleted_at is null and t.id is distinct from v_e.task_id)
         and not exists (select 1 from hq.tasks t where t.id = v_e.task_id and t.status = 'completed')
         and not exists (select 1 from hq.referrals r where r.opportunity_id = o.id and r.deleted_at is null)
         and not exists (select 1 from hq.email_drafts d where d.opportunity_id = o.id)
         and not exists (select 1 from hq.managed_properties mp where mp.opportunity_id = o.id)
         and not exists (select 1 from hq.enquiries x where x.opportunity_id = o.id and x.id <> v_e.id and x.status <> 'spam')) then
    update hq.tasks set deleted_at = now() where id = v_e.task_id and deleted_at is null;
    update hq.interactions set deleted_at = now() where id in (v_e.interaction_id, v_e.auto_reply_interaction_id) and deleted_at is null;
    update hq.opportunities set deleted_at = now() where id = v_e.opportunity_id;
    v_lead := true;
  end if;

  if v_e.created_contact and v_e.contact_id is not null and exists (
       select 1 from hq.contacts c
       where c.id = v_e.contact_id and c.deleted_at is null and c.needs_verification
         and not exists (select 1 from hq.opportunities o where o.owner_contact_id = c.id and o.deleted_at is null)
         and not exists (select 1 from hq.interactions i where i.contact_id = c.id and i.deleted_at is null)
         and not exists (select 1 from hq.tasks t where t.related_contact_id = c.id and t.deleted_at is null)
         and not exists (select 1 from hq.referrals r where (r.referring_contact_id = c.id or r.receiving_contact_id = c.id) and r.deleted_at is null)
         and not exists (select 1 from hq.email_drafts d where d.recipient_contact_id = c.id)
         and not exists (select 1 from hq.managed_properties mp where mp.owner_contact_id = c.id)
         and not exists (select 1 from hq.enquiries x where x.contact_id = c.id and x.id <> v_e.id and x.status <> 'spam')) then
    update hq.contacts set deleted_at = now() where id = v_e.contact_id;
    v_contact := true;
  end if;

  update hq.enquiries set status = 'spam', spam_marked_by = v_caller, spam_marked_at = now(),
    handled_by = v_caller, handled_at = now(), status_note = coalesce(v_note, status_note)
  where id = v_e.id
  returning * into v_e;

  perform hq_private.audit_write('mark_spam', 'enquiry', v_e.id,
    'Marked website enquiry ' || v_ref || ' as spam' || coalesce(' [' || v_note || ']', ''),
    jsonb_build_object('status', jsonb_build_object('to', 'spam'), 'lead_archived', v_lead, 'contact_archived', v_contact));

  return jsonb_build_object('enquiry_id', v_e.id, 'ref', v_ref, 'status', v_e.status, 'changed', true, 'lead_archived', v_lead, 'contact_archived', v_contact);
end $$;

-- ------------------------------------------------------------------ the list, with the thank-you (columns appended; same rules as 0134)
create or replace view hq.enquiry_overview with (security_invoker = true) as
select
  e.id,
  e.ref_number,
  'ENQ-' || lpad(e.ref_number::text, greatest(4, length(e.ref_number::text)), '0') as ref,
  e.kind,
  e.status,
  e.received_at,
  e.name,
  e.email,
  e.phone,
  e.suburb,
  e.message,
  e.details,
  e.source_page,
  e.opportunity_id,
  case when o.id is not null then 'LEAD-' || lpad(o.display_number::text, greatest(4, length(o.display_number::text)), '0') end as lead_ref,
  o.stage as lead_stage,
  (o.id is not null and o.deleted_at is null) as lead_live,
  o.assigned_to as owner_id,
  asg.full_name as owner_name,
  e.contact_id,
  c.full_name as contact_name,
  c.contact_kind,
  e.task_id,
  e.created_lead,
  e.created_contact,
  e.handled_by,
  hb.full_name as handled_by_name,
  e.handled_at,
  e.spam_marked_by,
  e.spam_marked_at,
  e.status_note,
  e.updated_at,
  e.auto_reply_status,
  e.auto_reply_at,
  e.auto_reply_reason,
  e.interaction_id,
  e.auto_reply_interaction_id
from hq.enquiries e
left join hq.opportunities o on o.id = e.opportunity_id
left join hq.staff_profiles asg on asg.id = o.assigned_to
left join hq.contacts c on c.id = e.contact_id
left join hq.staff_profiles hb on hb.id = e.handled_by;
comment on view hq.enquiry_overview is 'Website enquiries newest first: ENQ ref, kind, status, the submitted fields, the lead (LEAD ref, stage, live), its owner, the contact, who handled it, and the automatic thank-you (status, when, why not). security_invoker: growth.read.';

revoke all on hq.enquiry_overview from public, anon, authenticated, service_role;
grant select on hq.enquiry_overview to authenticated;
