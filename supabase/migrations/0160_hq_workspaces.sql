-- 0160_hq_workspaces.sql
-- Workspaces, Phase 1 (docs/hq-workspaces.md): the person's own default workspace, and what a call
-- achieved. Function privileges are in 0161.
--
-- STAFF PROFILES: workspace (null = the role's default). A workspace is a PREFERENCE: it decides what Today
--   shows first and the order of the navigation. It never grants anything; capabilities and row level
--   security are unchanged. Set only by the person themself, through hq.set_my_workspace.
--
-- INTERACTIONS (new, optional; every existing row keeps its values):
--   outcome            what a phone call came to: spoke, left_message, no_answer, wrong_number. Only on a
--                      phone call.
--   callback_promised  we told them we would call back by the follow-up date. Needs that date.
--   record_interaction and log_opportunity_activity take both (and record_interaction can clear the
--   contact's follow-up when the person says no further follow-up is needed). Both are re-created with the
--   new parameters at the end, so every existing caller (named parameters) keeps working.
--
-- WEBSITE ENQUIRIES: a rental appraisal request now starts its NEW lead at appraisal_requested (the contact
--   form still starts at introduction_received). Leads that already exist are not touched, and an enquiry
--   that attaches to an open lead never moves its stage.

-- ------------------------------------------------------------------ workspace
create type hq.workspace as enum ('grow', 'deliver', 'support', 'overview');

alter table hq.staff_profiles add column workspace hq.workspace;
comment on column hq.staff_profiles.workspace is 'The person''s own default workspace on Today (grow, deliver, support, overview); null = the role''s default. A preference only: it never grants access. Set with hq.set_my_workspace.';

create function hq.set_my_workspace(p_workspace hq.workspace default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_caller uuid := hq_private.require_staff();
begin
  update hq.staff_profiles set workspace = p_workspace where id = v_caller;
  return jsonb_build_object('staff_id', v_caller, 'workspace', p_workspace);
end $$;
comment on function hq.set_my_workspace(hq.workspace) is 'Any member of staff, for themself only. Saves (or with null, clears back to the role''s default) the workspace Today opens in. A preference, never a permission.';

-- ------------------------------------------------------------------ call outcome
create type hq.call_outcome as enum ('spoke', 'left_message', 'no_answer', 'wrong_number');

alter table hq.interactions
  add column outcome hq.call_outcome,
  add column callback_promised boolean not null default false;
alter table hq.interactions
  add constraint interactions_outcome_call_ck check (outcome is null or interaction_type = 'phone_call'),
  add constraint interactions_callback_date_ck check (not callback_promised or follow_up_date is not null);
comment on column hq.interactions.outcome is 'What a phone call came to (spoke, left_message, no_answer, wrong_number). Phone calls only; null when not recorded.';
comment on column hq.interactions.callback_promised is 'We promised to call them back by follow_up_date. Needs that date. The BDM''s Today lists these first once the date arrives.';

-- ------------------------------------------------------------------ record_interaction (replaces 0109)
-- As 0109, plus p_outcome, p_callback_promised and p_clear_follow_up (no further follow-up: the contact's
-- next_follow_up_date is cleared instead of kept).
drop function hq.record_interaction(uuid, uuid, hq.interaction_type, timestamptz, text, text, date, boolean, uuid, hq.relationship_status);
create function hq.record_interaction(
  p_contact uuid default null,
  p_organisation uuid default null,
  p_type hq.interaction_type default null,
  p_occurred_at timestamptz default null,
  p_summary text default null,
  p_next_action text default null,
  p_follow_up_date date default null,
  p_create_task boolean default false,
  p_task_assignee uuid default null,
  p_new_status hq.relationship_status default null,
  p_outcome hq.call_outcome default null,
  p_callback_promised boolean default false,
  p_clear_follow_up boolean default false
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_caller uuid := hq_private.require_staff();
  v_contact hq.contacts;
  v_org uuid := p_organisation;
  v_org_name text;
  v_when timestamptz := coalesce(p_occurred_at, now());
  v_summary text := btrim(coalesce(p_summary, ''));
  v_interaction uuid;
  v_task uuid;
  v_assignee uuid := coalesce(p_task_assignee, v_caller);
  v_title text;
begin
  perform hq_private.require_capability('growth.write');
  if coalesce(p_create_task, false) then
    perform hq_private.require_capability('tasks.write');
    perform hq_private.require_active_staff(v_assignee, 'the task assignee');
  end if;
  if p_type is null then
    raise exception 'an interaction type is required' using errcode = 'invalid_parameter_value';
  end if;
  if v_summary = '' then
    raise exception 'a summary is required' using errcode = 'invalid_parameter_value';
  end if;
  if p_contact is null and p_organisation is null then
    raise exception 'a contact or an organisation is required' using errcode = 'invalid_parameter_value';
  end if;
  if p_new_status is not null and p_contact is null then
    raise exception 'a relationship status change needs a contact' using errcode = 'invalid_parameter_value';
  end if;
  if v_when > now() + interval '1 hour' then
    raise exception 'an interaction cannot have occurred in the future' using errcode = 'invalid_parameter_value';
  end if;
  if p_outcome is not null and p_type <> 'phone_call' then
    raise exception 'an outcome belongs to a phone call' using errcode = 'invalid_parameter_value';
  end if;
  if coalesce(p_callback_promised, false) and p_follow_up_date is null then
    raise exception 'a promised callback needs a follow-up date' using errcode = 'invalid_parameter_value';
  end if;
  if coalesce(p_clear_follow_up, false) and p_follow_up_date is not null then
    raise exception 'choose a follow-up date or no further follow-up, not both' using errcode = 'invalid_parameter_value';
  end if;

  if p_contact is not null then
    select c.* into v_contact from hq.contacts c where c.id = p_contact and c.deleted_at is null for update;
    if not found then
      raise exception 'contact not found' using errcode = 'no_data_found';
    end if;
    if v_org is null then
      v_org := v_contact.organisation_id;
    elsif v_contact.organisation_id is not null and v_contact.organisation_id <> v_org then
      raise exception 'the contact does not belong to that organisation' using errcode = 'invalid_parameter_value';
    end if;
  end if;
  if v_org is not null then
    select o.name into v_org_name from hq.organisations o where o.id = v_org and o.deleted_at is null;
    if not found then
      raise exception 'organisation not found' using errcode = 'no_data_found';
    end if;
  end if;

  insert into hq.interactions (contact_id, organisation_id, interaction_type, occurred_at, summary, staff_id, next_action, follow_up_date, outcome, callback_promised)
  values (p_contact, v_org, p_type, v_when, v_summary, v_caller, nullif(btrim(coalesce(p_next_action, '')), ''), p_follow_up_date, p_outcome, coalesce(p_callback_promised, false))
  returning id into v_interaction;

  if coalesce(p_create_task, false) then
    v_title := left(coalesce(nullif(btrim(coalesce(p_next_action, '')), ''), 'Follow up with ' || coalesce(v_contact.full_name, v_org_name)), 200);
    insert into hq.tasks (title, assigned_to, due_date, related_contact_id, related_organisation_id, source)
    values (v_title, v_assignee, p_follow_up_date, p_contact, v_org, 'interaction')
    returning id into v_task;
    perform hq_private.audit_context('skip');
    update hq.interactions set task_id = v_task where id = v_interaction;
    perform hq_private.audit_context();
  end if;

  if p_contact is not null then
    update hq.contacts set
      last_contact_at = greatest(coalesce(last_contact_at, v_when), v_when),
      next_follow_up_date = case when coalesce(p_clear_follow_up, false) then null else coalesce(p_follow_up_date, next_follow_up_date) end,
      relationship_status = coalesce(p_new_status, relationship_status)
    where id = p_contact;
  end if;

  return jsonb_build_object('interaction_id', v_interaction, 'task_id', v_task);
end $$;
comment on function hq.record_interaction(uuid, uuid, hq.interaction_type, timestamptz, text, text, date, boolean, uuid, hq.relationship_status, hq.call_outcome, boolean, boolean) is 'growth.write (+ tasks.write when creating a task). One transaction: interaction (with a phone call''s outcome and a promised callback, which needs a follow-up date), contact last_contact_at / next_follow_up_date (cleared with p_clear_follow_up), optional task, optional status change. Returns {interaction_id, task_id}.';

-- ------------------------------------------------------------------ log_opportunity_activity (replaces 0127)
-- As 0127, plus p_outcome and p_callback_promised (which needs the follow-up date).
drop function hq.log_opportunity_activity(uuid, hq.interaction_type, timestamptz, text, text, date, boolean, uuid);
create function hq.log_opportunity_activity(
  p_opportunity uuid,
  p_type hq.interaction_type default null,
  p_occurred_at timestamptz default null,
  p_summary text default null,
  p_next_action text default null,
  p_next_action_due date default null,
  p_create_task boolean default false,
  p_task_assignee uuid default null,
  p_outcome hq.call_outcome default null,
  p_callback_promised boolean default false
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_caller uuid := hq_private.require_staff();
  v_today date;
  v_o hq.opportunities;
  v_when timestamptz := coalesce(p_occurred_at, now());
  v_summary text;
  v_action text;
  v_assignee uuid := coalesce(p_task_assignee, v_caller);
  v_interaction uuid;
  v_task uuid;
  v_contact uuid;
begin
  perform hq_private.require_capability('growth.write');
  if coalesce(p_create_task, false) then
    perform hq_private.require_capability('tasks.write');
    perform hq_private.require_active_staff(v_assignee, 'the task assignee');
  end if;
  v_today := hq.today();
  if p_type is null then
    raise exception 'an interaction type is required' using errcode = 'invalid_parameter_value';
  end if;
  v_summary := hq_private.lead_text(p_summary, 4000, 'the summary');
  if v_summary is null then
    raise exception 'a summary is required' using errcode = 'invalid_parameter_value';
  end if;
  v_action := hq_private.lead_text(p_next_action, 300, 'the next action');
  if v_when > now() + interval '1 hour' then
    raise exception 'an interaction cannot have occurred in the future' using errcode = 'invalid_parameter_value';
  end if;
  if p_next_action_due is not null and (p_next_action_due < v_today or p_next_action_due > v_today + 730) then
    raise exception 'the follow-up date must be from today to two years ahead' using errcode = 'invalid_parameter_value';
  end if;
  if p_outcome is not null and p_type <> 'phone_call' then
    raise exception 'an outcome belongs to a phone call' using errcode = 'invalid_parameter_value';
  end if;
  if coalesce(p_callback_promised, false) and p_next_action_due is null then
    raise exception 'a promised callback needs a follow-up date' using errcode = 'invalid_parameter_value';
  end if;

  select o.* into v_o from hq.opportunities o where o.id = p_opportunity and o.deleted_at is null for update;
  if not found then
    raise exception 'opportunity not found' using errcode = 'no_data_found';
  end if;
  select c.id into v_contact from hq.contacts c where c.id = v_o.owner_contact_id and c.deleted_at is null;

  insert into hq.interactions (opportunity_id, contact_id, interaction_type, occurred_at, summary, staff_id, next_action, follow_up_date, outcome, callback_promised)
  values (v_o.id, v_contact, p_type, v_when, v_summary, v_caller, v_action, p_next_action_due, p_outcome, coalesce(p_callback_promised, false))
  returning id into v_interaction;

  if coalesce(p_create_task, false) then
    insert into hq.tasks (title, assigned_to, due_date, related_opportunity_id, related_contact_id, source)
    values (left(coalesce(v_action, 'Follow up with ' || v_o.prospect_name), 200), v_assignee, coalesce(p_next_action_due, v_o.next_action_due),
            v_o.id, v_contact, 'interaction')
    returning id into v_task;
    perform hq_private.audit_context('skip');
    update hq.interactions set task_id = v_task where id = v_interaction;
    perform hq_private.audit_context();
  end if;

  update hq.opportunities set
    last_activity_at = greatest(coalesce(last_activity_at, v_when), v_when),
    next_action = coalesce(v_action, next_action),
    next_action_due = coalesce(p_next_action_due, next_action_due)
  where id = v_o.id
  returning * into v_o;

  if v_contact is not null then
    update hq.contacts set last_contact_at = greatest(coalesce(last_contact_at, v_when), v_when) where id = v_contact;
  end if;

  return jsonb_build_object('interaction_id', v_interaction, 'task_id', v_task, 'opportunity_id', v_o.id,
    'next_action', v_o.next_action, 'next_action_due', v_o.next_action_due, 'last_activity_at', v_o.last_activity_at);
end $$;
comment on function hq.log_opportunity_activity(uuid, hq.interaction_type, timestamptz, text, text, date, boolean, uuid, hq.call_outcome, boolean) is 'growth.write (+ tasks.write for a task). One transaction: logs a call (with its outcome and a promised callback, which needs the follow-up date), meeting, email, message or note on a live lead (interactions.opportunity_id, and the landlord contact), sets the lead''s last activity and, when given, its next action and follow-up date (today to 2 years ahead), the contact''s last_contact_at, and an optional follow-up task linked to the lead. Returns {interaction_id, task_id, opportunity_id, next_action, next_action_due, last_activity_at}.';

-- ------------------------------------------------------------------ submit_enquiry (replaces 0134)
-- Unchanged from 0134 except the new lead's stage: appraisal_requested for the appraisal form.
create or replace function hq.submit_enquiry(
  p_kind hq.enquiry_kind,
  p_name text,
  p_email text,
  p_phone text default null,
  p_suburb text default null,
  p_message text default null,
  p_details jsonb default null,
  p_source_page text default null,
  p_ip_hash text default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_name text;
  v_email text;
  v_phone text;
  v_suburb text;
  v_message text;
  v_details jsonb;
  v_page text;
  v_ip text;
  v_hash text;
  v_today date;
  v_owner uuid;
  v_setting jsonb;
  v_contact uuid;
  v_created_contact boolean := false;
  v_opp hq.opportunities;
  v_created_lead boolean := false;
  v_e hq.enquiries;
  v_ref text;
  v_label text;
  v_address text;
  v_summary text;
  v_interaction uuid;
  v_task uuid;
  v_recent integer;
begin
  -- Defence in depth: EXECUTE is granted to service_role only (0135). A person's session never gets here.
  if current_setting('role', true) in ('anon', 'authenticated') or auth.uid() is not null then
    raise exception 'permission denied' using errcode = 'insufficient_privilege';
  end if;

  if p_kind is null then
    raise exception 'say which form this came from' using errcode = 'invalid_parameter_value', hint = 'enquiry_invalid';
  end if;
  v_name := hq_private.enquiry_line(p_name, 200, 'a name');
  if v_name is null then
    raise exception 'an enquiry needs the person''s name' using errcode = 'invalid_parameter_value', hint = 'enquiry_invalid';
  end if;
  v_email := lower(hq_private.enquiry_line(p_email, 254, 'an email address'));
  if v_email is null then
    raise exception 'an enquiry needs an email address' using errcode = 'invalid_parameter_value', hint = 'enquiry_invalid';
  end if;
  v_phone := hq_private.enquiry_line(p_phone, 40, 'a phone number');
  begin
    perform hq_private.lead_check_contact_details(v_phone, v_email);
  exception when invalid_parameter_value then
    raise exception 'the phone number or email address is not valid' using errcode = 'invalid_parameter_value', hint = 'enquiry_invalid';
  end;
  v_suburb := hq_private.enquiry_line(p_suburb, 120, 'a suburb');
  v_message := hq_private.enquiry_message(p_message);
  if p_kind = 'contact' and v_message is null then
    raise exception 'a contact enquiry needs a message' using errcode = 'invalid_parameter_value', hint = 'enquiry_invalid';
  end if;
  v_details := hq_private.enquiry_details(p_details);
  v_page := hq_private.enquiry_line(p_source_page, 200, 'the page');
  if v_page is not null and v_page !~ '^/[^[:space:][:cntrl:]]*$' then
    raise exception 'the page must be a path on the site' using errcode = 'invalid_parameter_value', hint = 'enquiry_invalid';
  end if;
  v_ip := nullif(lower(btrim(coalesce(p_ip_hash, ''))), '');
  if v_ip is not null and v_ip !~ '^[0-9a-f]{64}$' then
    raise exception 'the client fingerprint must be a hash' using errcode = 'invalid_parameter_value', hint = 'enquiry_invalid';
  end if;
  v_hash := md5(p_kind::text || E'\x1f' || coalesce(v_message, '') || E'\x1f' || v_details::text);

  -- One submission at a time per email and per fingerprint, so a double tap cannot slip past the dedupe
  -- or the limits.
  perform pg_advisory_xact_lock(hashtextextended('hq.enquiry:' || v_email, 0));
  if v_ip is not null then
    perform pg_advisory_xact_lock(hashtextextended('hq.enquiry-ip:' || v_ip, 0));
  end if;

  -- The same submission again within 10 minutes (a double tap, a back-and-resubmit): the one already stored.
  select * into v_e from hq.enquiries e
  where e.email = v_email and e.submission_hash = v_hash and e.received_at > now() - interval '10 minutes'
  order by e.received_at desc limit 1;
  if found then
    return hq_private.enquiry_json(v_e, true);
  end if;

  select count(*) into v_recent from hq.enquiries e where e.email = v_email and e.received_at > now() - interval '1 hour';
  if v_recent >= 5 then
    raise exception 'too many enquiries from this email address in the last hour' using errcode = 'program_limit_exceeded', hint = 'enquiry_rate_limited';
  end if;
  if v_ip is not null then
    select count(*) into v_recent from hq.enquiries e where e.ip_hash = v_ip and e.received_at > now() - interval '1 hour';
    if v_recent >= 5 then
      raise exception 'too many enquiries from this connection in the last hour' using errcode = 'program_limit_exceeded', hint = 'enquiry_rate_limited';
    end if;
  end if;

  v_today := hq.today();

  -- Who gets it: the setting, when it names an active member of staff; else the earliest active director.
  select s.value into v_setting from hq.settings s where s.key = 'enquiry_default_owner_id';
  if jsonb_typeof(v_setting) = 'string' and (v_setting #>> '{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and hq_private.enquiry_owner_ok((v_setting #>> '{}')::uuid) then
    v_owner := (v_setting #>> '{}')::uuid;
  end if;
  if v_owner is null then
    select sp.id into v_owner from hq.staff_profiles sp
    where sp.role = 'director' and sp.is_active and sp.employment_status = 'active'
    order by sp.created_at, sp.id limit 1;
  end if;
  if v_owner is null then
    raise exception 'HQ has no active director to receive the enquiry' using errcode = 'object_not_in_prerequisite_state', hint = 'enquiry_no_owner';
  end if;

  -- The contact: the live contact already using this email (any kind; linked, never changed), else a new
  -- landlord contact to verify.
  select c.id into v_contact from hq.contacts c where c.deleted_at is null and c.email = v_email limit 1;
  if v_contact is null then
    insert into hq.contacts (full_name, phone, email, location, contact_kind, categories, relationship_owner_id, needs_verification, source)
    values (v_name, v_phone, v_email, v_suburb, 'landlord', '{}', v_owner, true, 'website enquiry')
    returning id into v_contact;
    v_created_contact := true;
  end if;

  -- An open live lead for this contact (or this email) takes the enquiry; else a new lead.
  select o.* into v_opp from hq.opportunities o
  where o.deleted_at is null and o.stage not in ('management_signed', 'lost')
    and (o.owner_contact_id = v_contact or o.prospect_email = v_email)
  order by o.created_at desc limit 1
  for update;

  -- the enquiry row first, for its number
  insert into hq.enquiries (kind, name, email, phone, suburb, message, details, source_page, ip_hash, submission_hash, contact_id, created_contact, created_lead)
  values (p_kind, v_name, v_email, v_phone, v_suburb, v_message, v_details, v_page, v_ip, v_hash, v_contact, v_created_contact, v_opp.id is null)
  returning * into v_e;
  v_ref := hq_private.enquiry_ref(v_e.ref_number);
  v_label := case p_kind when 'appraisal' then 'rental appraisal request' else 'contact form' end;

  if v_opp.id is null then
    v_address := hq_private.enquiry_line(v_details ->> 'address', 300, 'an address');
    insert into hq.opportunities (
      prospect_name, prospect_phone, prospect_email, property_suburb, property_address, source, assigned_to,
      next_action, next_action_due, notes, owner_contact_id, last_activity_at, stage)
    values (
      v_name, v_phone, v_email, v_suburb, v_address, 'website_enquiry', v_owner,
      'Reply to the website enquiry', v_today,
      left('Website enquiry ' || v_ref || ' (' || v_label || ').' || coalesce(E'\n\n' || v_message, ''), 2000),
      v_contact, now(),
      -- 0160: a rental appraisal request is already a request for an appraisal
      case when p_kind = 'appraisal' then 'appraisal_requested'::hq.opportunity_stage else 'introduction_received'::hq.opportunity_stage end)
    returning * into v_opp;
    v_created_lead := true;
  else
    -- the lead's owner takes the follow-up, while they are still active staff
    if v_opp.assigned_to is not null and hq_private.enquiry_owner_ok(v_opp.assigned_to) then
      v_owner := v_opp.assigned_to;
    end if;
    update hq.opportunities set last_activity_at = greatest(coalesce(last_activity_at, now()), now()) where id = v_opp.id
    returning * into v_opp;
  end if;

  -- the message on the lead's timeline (and the contact's)
  v_summary := 'Website enquiry ' || v_ref || ' (' || v_label || ')'
    || case when v_created_lead then '' else ', added to this open lead' end || '.'
    || coalesce(E'\n\n' || left(v_message, 3800) || case when char_length(v_message) > 3800 then ' [continued in the enquiry]' else '' end, '');
  insert into hq.interactions (opportunity_id, contact_id, interaction_type, occurred_at, summary, staff_id)
  values (v_opp.id, v_contact, 'message', now(), v_summary, null)
  returning id into v_interaction;

  -- one follow-up task for the owner, due today
  insert into hq.tasks (title, description, assigned_to, due_date, priority, related_opportunity_id, related_contact_id, source)
  values ('Reply to website enquiry ' || v_ref,
          'A ' || v_label || ' arrived from the website. Open the enquiry in HQ to read it and reply.',
          v_owner, v_today, 'normal', v_opp.id, v_contact, 'website_enquiry')
  returning id into v_task;

  update hq.enquiries set opportunity_id = v_opp.id, task_id = v_task, interaction_id = v_interaction
  where id = v_e.id
  returning * into v_e;

  perform hq_private.audit_write('enquiry_received', 'enquiry', v_e.id,
    'Website enquiry ' || v_ref || ' received (' || p_kind::text || ')'
      || case when v_created_lead then ': new lead ' || hq_private.lead_ref(v_opp.display_number) else ': added to open lead ' || hq_private.lead_ref(v_opp.display_number) end,
    jsonb_build_object('kind', p_kind, 'opportunity_id', v_opp.id, 'contact_id', v_contact, 'task_id', v_task,
                       'created_lead', v_created_lead, 'created_contact', v_created_contact, 'owner', v_owner));

  return hq_private.enquiry_json(v_e, false);
end $$;
comment on function hq.submit_enquiry(hq.enquiry_kind, text, text, text, text, text, jsonb, text, text) is 'service_role ONLY (the website, lib/hq/enquiry-intake.ts). Validates and caps every field, dedupes (same email + same submission within 10 minutes returns the stored enquiry), rate-limits (5 per ip_hash and 5 per email per hour: 54000 hint enquiry_rate_limited), links the live contact with the email (never changed) or creates a landlord contact, attaches to an open lead for that contact or creates one (website_enquiry; stage appraisal_requested for the appraisal form, introduction_received for the contact form; owner = setting enquiry_default_owner_id or the earliest active director, next action Reply to the website enquiry, due today), adds a message on the timeline and a task due today, audited as System. Returns {enquiry_id, ref, kind, status, opportunity_id, contact_id, task_id, created_lead, created_contact, duplicate}.';
