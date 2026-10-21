-- 0146_hq_email_new_recipient.sql
-- Email to someone HQ does not hold yet (docs/hq-mcp.md section 9; supersedes the "no free-typed address"
-- rule of 0132). A person may TYPE an address and a name when they draft an email; the address becomes
-- an HQ CONTACT first and the draft then runs exactly as before (it points at that contact record, the
-- address is re-checked at approval and at send, and the send writes the contact's timeline entry).
-- Every safety property of 0132 is kept:
--   * exactly ONE recipient: a contact, a member of staff, or one typed address (no cc, no bcc);
--   * typing an address needs email.draft AND growth.write (director, administrator, business
--     development manager, virtual assistant). A property manager keeps emailing existing contacts only;
--   * the address is trimmed, lower-cased and shape-checked (254 characters at most, no whitespace or
--     control characters); the name is required (1 to 200 characters, no control characters);
--   * an active contact that already uses the address is reused (never a duplicate); an active member
--     of staff who uses it takes the staff path; otherwise a contact is created in the same transaction
--     (contact_kind other, source 'email draft', needs_verification TRUE) and the contact's creation is
--     audited as well as the draft;
--   * at most 10 NEW contacts per person per hour this way, in addition to the 30 drafts per hour;
--   * approval is still only a person's tap in HQ (approve_email_draft refuses a connected-app token);
--   * CHAT SENDING (the director setting email_chat_send_enabled) now also refuses an unapproved draft
--     whose contact still has needs_verification = true: the address is new, so a person must approve it
--     in HQ. The same rule covers every contact flagged needs_verification (imported research contacts,
--     website enquiries), not only ones created here. A person clears the flag with Mark as verified on
--     the contact page (hq_private.verification_guard stamps verified_at / verified_by); once cleared,
--     chat sending works as before. An email a person has APPROVED in HQ is unaffected.
--
-- One signature surface for HQ and the chat tools: create_email_draft gains p_to_email and p_to_name
-- (appended, so every existing call keeps working). Postgres cannot add parameters to a function in
-- place, so the old signature is dropped and re-created; 0147 states the privileges again.
-- begin_email_send is replaced with the same signature (privileges kept) to add the unverified-contact
-- refusal. No table changes, no new helper functions.

drop function hq.create_email_draft(hq.email_template, text, text, uuid, uuid, uuid);

create function hq.create_email_draft(
  p_template hq.email_template,
  p_subject text,
  p_body text,
  p_contact uuid default null,
  p_staff uuid default null,
  p_opportunity uuid default null,
  p_to_email text default null,
  p_to_name text default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_caller uuid := hq_private.require_staff();
  v_client text := hq_private.email_app_client();
  v_subject text;
  v_body text;
  v_contact uuid := p_contact;
  v_staff uuid := p_staff;
  v_typed boolean := p_to_email is not null;
  v_addr text;
  v_name text;
  v_create boolean := false;
  v_to_email extensions.citext;
  v_to_name text;
  v_reply extensions.citext;
  v_recent integer;
  v_new_contacts integer;
  v_d hq.email_drafts;
begin
  perform hq_private.require_capability('email.draft');
  if num_nonnulls(p_contact, p_staff, p_to_email) <> 1 or (p_to_name is not null and not v_typed) then
    raise exception 'an email goes to exactly one person: a contact, a member of staff or one typed address' using errcode = 'invalid_parameter_value', hint = 'email_one_recipient';
  end if;
  if p_template is null then
    raise exception 'choose a template' using errcode = 'invalid_parameter_value';
  end if;
  v_subject := hq_private.email_line(p_subject, 200, 'the subject');
  if v_subject is null then
    raise exception 'an email needs a subject' using errcode = 'invalid_parameter_value';
  end if;
  v_body := hq_private.email_body(p_body);
  if v_body is null then
    raise exception 'an email needs a message' using errcode = 'invalid_parameter_value';
  end if;

  if v_typed then
    -- A typed address adds a person to Contacts, so it needs growth.write as well as email.draft.
    if not hq_private.has_capability('growth.write') then
      raise exception 'your role can email people HQ already holds; adding someone new to Contacts needs permission to edit contacts' using errcode = 'insufficient_privilege', hint = 'email_new_needs_growth_write';
    end if;
    v_addr := lower(btrim(p_to_email, E' \t\r\n'));
    if v_addr = '' or char_length(v_addr) > 254 or v_addr ~ '[[:cntrl:]]' or v_addr !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      raise exception 'that does not look like an email address: check it and try again' using errcode = 'invalid_parameter_value', hint = 'email_bad_address';
    end if;
    v_name := btrim(coalesce(p_to_name, ''));
    if v_name = '' then
      raise exception 'add the name of the person you are emailing' using errcode = 'invalid_parameter_value', hint = 'email_name_required';
    end if;
    if char_length(v_name) > 200 then
      raise exception 'the name is at most 200 characters' using errcode = 'invalid_parameter_value', hint = 'email_bad_name';
    end if;
    if v_name ~ '[[:cntrl:]]' or hq_private.normalise_name(v_name) = '' then
      raise exception 'the name must be a plain name on one line' using errcode = 'invalid_parameter_value', hint = 'email_bad_name';
    end if;

    -- One writer per address, so two people typing it at once cannot make two contacts.
    perform pg_advisory_xact_lock(hashtextextended('hq.email_contact:' || v_addr, 0));
    select c.id into v_contact from hq.contacts c where c.deleted_at is null and c.email = v_addr::extensions.citext;
    if not found then
      select sp.id into v_staff from hq.staff_profiles sp
      where sp.email = v_addr::extensions.citext and sp.is_active and sp.employment_status = 'active';
      v_create := v_staff is null;
    end if;
  end if;

  if v_contact is not null then
    perform hq_private.require_capability('growth.read');
    select c.email, c.full_name into v_to_email, v_to_name from hq.contacts c where c.id = v_contact and c.deleted_at is null;
    if not found then
      raise exception 'that contact could not be found' using errcode = 'no_data_found';
    end if;
  elsif v_staff is not null then
    perform hq_private.require_capability('people.read');
    select sp.email, sp.full_name into v_to_email, v_to_name from hq.staff_profiles sp
    where sp.id = v_staff and sp.is_active and sp.employment_status = 'active';
    if not found then
      raise exception 'that member of staff could not be found or is not active' using errcode = 'no_data_found';
    end if;
  else
    v_to_email := v_addr;
    v_to_name := v_name;
  end if;
  if v_to_email is null or btrim(v_to_email::text) = '' then
    raise exception 'there is no email address on record for this person; add it to their record first' using errcode = 'invalid_parameter_value', hint = 'email_no_address';
  end if;
  v_to_name := left(btrim(regexp_replace(v_to_name, '[[:cntrl:]]', ' ', 'g')), 200);

  if p_opportunity is not null then
    perform hq_private.require_capability('growth.read');
    if not exists (select 1 from hq.opportunities o where o.id = p_opportunity and o.deleted_at is null) then
      raise exception 'that lead could not be found' using errcode = 'no_data_found';
    end if;
  end if;

  select sp.email into v_reply from hq.staff_profiles sp where sp.id = v_caller;

  -- at most 30 drafts per person in any hour (a safety bound, not a business figure)
  perform pg_advisory_xact_lock(hashtextextended('hq.email_draft:' || v_caller::text, 0));
  select count(*) into v_recent from hq.email_drafts d where d.created_by = v_caller and d.created_at > now() - interval '1 hour';
  if v_recent >= 30 then
    raise exception 'at most 30 email drafts per hour' using errcode = 'program_limit_exceeded', hint = 'email_draft_rate_limited';
  end if;

  if v_create then
    -- at most 10 new contacts per person in any hour this way (also a safety bound)
    select count(*) into v_new_contacts from hq.contacts c
    where c.created_by = v_caller and c.source = 'email draft' and c.created_at > now() - interval '1 hour';
    if v_new_contacts >= 10 then
      raise exception 'at most 10 new people per hour can be added by emailing them' using errcode = 'program_limit_exceeded', hint = 'email_new_contact_rate_limited';
    end if;
    -- the contact's own audit row (the audit trigger) carries the reason
    perform hq_private.audit_context('create', 'added from an email draft');
    insert into hq.contacts (full_name, email, contact_kind, source, needs_verification, created_by)
    values (v_name, v_addr, 'other', 'email draft', true, v_caller)
    returning id into v_contact;
    perform hq_private.audit_context(null, null);
  end if;

  insert into hq.email_drafts (created_by, created_via, mcp_client_id, recipient_contact_id, recipient_staff_id,
                               to_email, to_name, subject, body_text, template, reply_to_email, opportunity_id)
  values (v_caller, case when v_client is null then 'hq' else 'mcp' end, v_client, v_contact, v_staff,
          v_to_email, v_to_name, v_subject, v_body, p_template, v_reply, p_opportunity)
  returning * into v_d;

  perform hq_private.audit_write('create', 'email_draft', v_d.id,
    'Drafted email ' || hq_private.email_ref(v_d.ref_number) || ' to ' || v_d.to_name
      || case when v_create then ' (a new contact)' else '' end
      || case when v_client is null then '' else ' (through a connected app)' end,
    jsonb_build_object('status', jsonb_build_object('to', 'draft'), 'created_via', jsonb_build_object('to', v_d.created_via))
      || case when v_create then jsonb_build_object('new_contact', jsonb_build_object('to', true)) else '{}'::jsonb end);
  return hq_private.email_json(v_d) || jsonb_build_object('changed', true, 'new_contact', v_create, 'contact_id', v_d.recipient_contact_id);
end $$;

-- ------------------------------------------------------------------ begin_email_send
-- 0132's function, whole, with ONE addition: an UNAPPROVED draft may not be sent from chat while its
-- contact is still flagged needs_verification (email_contact_unverified). Everything else is unchanged.
create or replace function hq.begin_email_send(p_id uuid, p_via text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_caller uuid := hq_private.require_staff();
  v_client text := hq_private.email_app_client();
  v_d hq.email_drafts;
  v_problem text;
  v_limit integer;
  v_used integer;
  v_tz text;
  v_day_start timestamptz;
  v_chat_mode boolean;
  v_sender record;
begin
  perform hq_private.require_capability('email.send');
  if p_via is null or p_via not in ('hq', 'chat') then
    raise exception 'send through hq or chat' using errcode = 'invalid_parameter_value';
  end if;
  if (p_via = 'chat') <> (v_client is not null) then
    raise exception 'that send channel does not match this session' using errcode = 'insufficient_privilege', hint = 'email_wrong_channel';
  end if;

  v_d := hq_private.email_lock(p_id, v_caller, true);
  if v_d.status in ('sending', 'sent') then
    raise exception 'this email is already %', v_d.status using errcode = 'invalid_parameter_value', hint = 'email_already_sent';
  end if;
  if v_d.status in ('discarded', 'failed') then
    raise exception 'this email is %; %', v_d.status,
      case when v_d.status = 'failed' then 'approve it again in HQ to retry' else 'draft a new one' end
      using errcode = 'invalid_parameter_value', hint = 'email_not_sendable';
  end if;
  -- the caller must be the person who drafted it or the person who approved it
  if v_caller <> v_d.created_by and v_caller is distinct from v_d.approved_by then
    raise exception 'only the person who drafted or approved this email can send it' using errcode = 'insufficient_privilege', hint = 'email_not_yours';
  end if;
  if v_d.status = 'draft' then
    v_chat_mode := coalesce((select s.value = 'true'::jsonb from hq.settings s where s.key = 'email_chat_send_enabled'), false);
    if not (p_via = 'chat' and v_chat_mode and v_d.created_via = 'mcp' and v_d.created_by = v_caller
            and v_d.mcp_client_id = v_client and v_d.created_at > now() - interval '30 minutes') then
      raise exception 'this email has not been approved: open it in HQ and tap Approve and send' using errcode = 'insufficient_privilege', hint = 'email_not_approved';
    end if;
    -- a new or unchecked address is approved by a person in HQ, never sent from chat on a yes
    if v_d.recipient_contact_id is not null
       and exists (select 1 from hq.contacts c where c.id = v_d.recipient_contact_id and c.needs_verification) then
      raise exception 'this address is new to HQ and has not been checked yet: open the email in HQ and tap Approve and send' using errcode = 'insufficient_privilege', hint = 'email_contact_unverified';
    end if;
  end if;

  v_problem := hq_private.email_recipient_problem(v_d);
  if v_problem is not null then
    raise exception 'not sent: %. Discard it and draft a new one', v_problem using errcode = 'invalid_parameter_value', hint = 'email_recipient_changed';
  end if;

  -- the daily limit: sends started by this person since midnight in the business timezone
  perform pg_advisory_xact_lock(hashtextextended('hq.email_send:' || v_caller::text, 0));
  v_limit := coalesce((select case when jsonb_typeof(s.value) = 'number' then (s.value #>> '{}')::integer end from hq.settings s where s.key = 'email_daily_limit'), 20);
  v_tz := coalesce((select s.value #>> '{}' from hq.settings s where s.key = 'timezone'), 'Australia/Adelaide');
  v_day_start := (hq.today()::timestamp) at time zone v_tz;
  select count(*) into v_used from hq.email_drafts d
  where d.sent_by = v_caller and d.send_started_at >= v_day_start and d.status in ('sending', 'sent', 'failed');
  if v_used >= v_limit then
    raise exception 'daily email limit reached (% per person per day)', v_limit using errcode = 'program_limit_exceeded', hint = 'email_daily_limit';
  end if;

  update hq.email_drafts set status = 'sending', send_started_at = now(), sent_by = v_caller, send_via = p_via, error_code = null
  where id = v_d.id
  returning * into v_d;

  select sp.full_name, sp.first_name, sp.role into v_sender from hq.staff_profiles sp where sp.id = v_d.created_by;

  perform hq_private.audit_write('send_start', 'email_draft', v_d.id,
    'Sending email ' || hq_private.email_ref(v_d.ref_number) || ' to ' || v_d.to_name || case when p_via = 'chat' then ' (from a connected app)' else '' end,
    jsonb_build_object('status', jsonb_build_object('to', 'sending'), 'via', jsonb_build_object('to', p_via)));

  return hq_private.email_json(v_d) || jsonb_build_object(
    'body_text', v_d.body_text,
    'reply_to_email', v_d.reply_to_email::text,
    'sender_name', v_sender.full_name,
    'sender_first_name', v_sender.first_name,
    'sender_role', v_sender.role,
    'via', p_via,
    'sent_today', v_used + 1,
    'daily_limit', v_limit);
end $$;

notify pgrst, 'reload schema';
