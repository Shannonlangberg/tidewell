-- 0132_hq_email.sql
-- Branded email drafting and approved sending (docs/hq-setup.md "Email"). A person drafts an email to
-- ONE person HQ already holds an address for (a live contact with an email, or an active member of
-- staff); a person with email.send approves it in HQ; the server sends it through the email provider
-- (SendGrid in production, a fake provider in development) between begin_email_send and
-- finish_email_send. The draft's status machine makes a double send impossible.
--
-- TABLE (schema hq; RLS enabled and forced; the API may only SELECT; every write goes through the
-- security definer RPCs below, as with hq.ai_requests and hq.decisions):
--   email_drafts   one row per email, shown as EML-0001 (ref_number). Never deleted (discarded instead).
--
-- RECIPIENT RULES (RPC-enforced; the guard trigger keeps them fixed):
--   * exactly ONE recipient: a live contact (with growth.read) that has an email, or an active member
--     of staff (with people.read). There is no free-typed address anywhere, no cc and no bcc;
--   * to_email and to_name are copied from the record when the draft is made and never change;
--   * at send (begin_email_send) and at approval the record is read again: archived, deactivated, or an
--     address that is no longer the one copied, and the send is refused (discard and redraft).
--
-- STATUS MACHINE (enforced by the guard for every writer, including the table owner):
--   draft -> approved | sending (chat-send mode only) | discarded
--   approved -> sending | discarded
--   sending -> sent | failed | discarded (only when stuck for 15 minutes, in discard_email_draft)
--   failed -> approved (a NEW approval is the only retry) | discarded
--   sent and discarded are closed. Subject, body and template change only while the draft is a draft.
--
-- CAPABILITIES (data, in hq.role_capabilities; an assumption for the owner to confirm):
--   email.draft  director, administrator, senior_property_manager, property_manager,
--                business_development_manager, virtual_assistant
--   email.send   director, administrator, business_development_manager
--
-- SETTINGS (settings.admin = directors):
--   email_daily_limit        sends per person per day (the business timezone's calendar day), 1..200, default 20
--   email_chat_send_enabled  default false. When true, a connected chat app may send an UNAPPROVED draft
--                            that the same person created through that same app in the last 30 minutes
--                            (still record-held addresses only, still within the daily limit).
--
-- CONNECTED APPS: a request from a chat app carries a `client_id` claim (Supabase puts it only in
-- tokens issued to an OAuth app; see docs/hq-mcp.md). The database reads the CHANNEL from the token,
-- never from an argument: a draft made with such a token is created_via 'mcp'; approve_email_draft
-- refuses such a token (approval is a person's tap in HQ); begin_email_send's p_via must match it.
--
-- RPCs (security definer, search_path pinned, capability and MFA checked inside, audited):
--   create_email_draft, update_email_draft, discard_email_draft, approve_email_draft,
--   begin_email_send, finish_email_send.  Function privileges: 0133.

-- ------------------------------------------------------------------ enums
create type hq.email_template as enum ('thank_you', 'follow_up', 'introduction', 'general');
create type hq.email_status as enum ('draft', 'approved', 'sending', 'sent', 'failed', 'discarded');

-- ------------------------------------------------------------------ capabilities
insert into hq.role_capabilities (role, capability)
select r.role::hq.staff_role, r.capability
from (values
  ('director', 'email.draft'), ('director', 'email.send'),
  ('administrator', 'email.draft'), ('administrator', 'email.send'),
  ('senior_property_manager', 'email.draft'),
  ('property_manager', 'email.draft'),
  ('business_development_manager', 'email.draft'), ('business_development_manager', 'email.send'),
  ('virtual_assistant', 'email.draft')
) as r(role, capability)
on conflict do nothing;

-- ------------------------------------------------------------------ settings
insert into hq.settings (key, value) values
  ('email_daily_limit', '20'::jsonb),
  ('email_chat_send_enabled', 'false'::jsonb)
on conflict (key) do nothing;

-- settings_guard (0129) with the two email keys: email_chat_send_enabled is true or false;
-- email_daily_limit is a whole number from 1 to 200.
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
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;

-- ------------------------------------------------------------------ email_drafts
create table hq.email_drafts (
  id uuid primary key default gen_random_uuid(),
  ref_number bigint generated always as identity,
  created_by uuid not null references hq.staff_profiles (id),
  created_via text not null default 'hq',
  mcp_client_id text,
  recipient_contact_id uuid references hq.contacts (id),
  recipient_staff_id uuid references hq.staff_profiles (id),
  to_email extensions.citext not null,
  to_name text not null,
  subject text not null,
  body_text text not null,
  template hq.email_template not null default 'general',
  reply_to_email extensions.citext not null,
  status hq.email_status not null default 'draft',
  approved_by uuid references hq.staff_profiles (id),
  approved_at timestamptz,
  send_started_at timestamptz,
  sent_by uuid references hq.staff_profiles (id),
  send_via text,
  sent_at timestamptz,
  provider_message_id text,
  error_code text,
  interaction_id uuid references hq.interactions (id),
  opportunity_id uuid references hq.opportunities (id),
  discarded_at timestamptz,
  discarded_by uuid references hq.staff_profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_drafts_one_recipient check (num_nonnulls(recipient_contact_id, recipient_staff_id) = 1),
  constraint email_drafts_via_known check (created_via in ('hq', 'mcp')),
  constraint email_drafts_client_iff_mcp check ((created_via = 'mcp') = (mcp_client_id is not null)),
  constraint email_drafts_client_length check (mcp_client_id is null or char_length(mcp_client_id) between 1 and 200),
  constraint email_drafts_to_email_shape check (char_length(to_email::text) <= 254 and to_email::text ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  constraint email_drafts_reply_to_shape check (char_length(reply_to_email::text) <= 254 and reply_to_email::text ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  constraint email_drafts_to_name_line check (char_length(btrim(to_name)) between 1 and 200 and to_name !~ '[[:cntrl:]]'),
  constraint email_drafts_subject_line check (char_length(btrim(subject)) between 1 and 200 and subject !~ '[[:cntrl:]]'),
  constraint email_drafts_body_length check (char_length(btrim(body_text)) between 1 and 8000),
  constraint email_drafts_approved_has_approver check (status <> 'approved' or (approved_by is not null and approved_at is not null)),
  constraint email_drafts_sending_has_sender check (status not in ('sending', 'sent', 'failed') or (send_started_at is not null and sent_by is not null and send_via is not null)),
  constraint email_drafts_send_via_known check (send_via is null or send_via in ('hq', 'chat')),
  constraint email_drafts_sent_iff_sent_at check ((status = 'sent') = (sent_at is not null)),
  constraint email_drafts_discarded_iff check ((status = 'discarded') = (discarded_at is not null)),
  constraint email_drafts_message_id_shape check (provider_message_id is null or (char_length(provider_message_id) <= 200 and provider_message_id ~ '^[A-Za-z0-9._:@=+-]+$')),
  constraint email_drafts_error_code_shape check (error_code is null or error_code ~ '^[a-z0-9_]{1,40}$'),
  constraint email_drafts_interaction_only_when_sent check (interaction_id is null or status = 'sent')
);
comment on table hq.email_drafts is 'Branded emails drafted in HQ or by a connected chat app, shown as EML-0001. One recipient HQ holds an address for; approved in HQ; sent between begin_email_send and finish_email_send. Written only by the email RPCs; never deleted.';
comment on column hq.email_drafts.to_email is 'Copied from the contact or staff record when drafted; re-checked against the record at approval and at send.';
comment on column hq.email_drafts.created_via is 'hq (a browser session) or mcp (a token issued to a connected chat app: the token carried a client_id claim).';
comment on column hq.email_drafts.error_code is 'A short code for a failed send (for example provider_rejected, timeout). Never an address or a provider message.';
create unique index email_drafts_ref_number_uq on hq.email_drafts (ref_number);
create index email_drafts_created_by_idx on hq.email_drafts (created_by, created_at desc);
create index email_drafts_status_idx on hq.email_drafts (status, updated_at desc);
create index email_drafts_sent_by_idx on hq.email_drafts (sent_by, send_started_at desc);
create index email_drafts_contact_idx on hq.email_drafts (recipient_contact_id);
create index email_drafts_staff_idx on hq.email_drafts (recipient_staff_id);
create index email_drafts_approved_by_idx on hq.email_drafts (approved_by);
create index email_drafts_discarded_by_idx on hq.email_drafts (discarded_by);
create index email_drafts_interaction_idx on hq.email_drafts (interaction_id);
create index email_drafts_opportunity_idx on hq.email_drafts (opportunity_id);

-- ------------------------------------------------------------------ guard (every writer, including the table owner)
create function hq_private.email_draft_guard() returns trigger
language plpgsql set search_path = pg_catalog, public, extensions as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.approved_by is not null or new.send_started_at is not null or new.sent_at is not null
       or new.interaction_id is not null or new.discarded_at is not null then
      raise exception 'a new email starts as a draft' using errcode = 'check_violation', hint = 'email_new_is_draft';
    end if;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  -- who it is from, who it is to, and how it was made never change
  if new.id is distinct from old.id or new.ref_number is distinct from old.ref_number
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at
     or new.created_via is distinct from old.created_via or new.mcp_client_id is distinct from old.mcp_client_id
     or new.recipient_contact_id is distinct from old.recipient_contact_id or new.recipient_staff_id is distinct from old.recipient_staff_id
     or new.to_email is distinct from old.to_email or new.to_name is distinct from old.to_name
     or new.reply_to_email is distinct from old.reply_to_email or new.opportunity_id is distinct from old.opportunity_id then
    raise exception 'the sender and recipient of an email cannot change: discard it and draft a new one'
      using errcode = 'insufficient_privilege', hint = 'email_fixed_fields';
  end if;

  if old.status in ('sent', 'discarded') then
    raise exception 'this email is % and can no longer change', old.status using errcode = 'check_violation', hint = 'email_closed';
  end if;

  if new.status is distinct from old.status and not (
       (old.status = 'draft' and new.status in ('approved', 'sending', 'discarded'))
    or (old.status = 'approved' and new.status in ('sending', 'discarded'))
    or (old.status = 'sending' and new.status in ('sent', 'failed', 'discarded'))
    or (old.status = 'failed' and new.status in ('approved', 'discarded'))
  ) then
    raise exception 'an email cannot go from % to %', old.status, new.status using errcode = 'check_violation', hint = 'email_bad_transition';
  end if;

  if (new.subject, new.body_text, new.template) is distinct from (old.subject, old.body_text, old.template)
     and not (old.status = 'draft' and new.status = 'draft') then
    raise exception 'only a draft can be edited' using errcode = 'check_violation', hint = 'email_not_draft';
  end if;

  if new.interaction_id is distinct from old.interaction_id and not (old.interaction_id is null and new.status = 'sent' and old.status = 'sending') then
    raise exception 'the timeline entry is set once, when the email is sent' using errcode = 'check_violation', hint = 'email_interaction_fixed';
  end if;

  new.updated_at := now();
  return new;
end $$;

create trigger email_draft_guard before insert or update on hq.email_drafts for each row execute function hq_private.email_draft_guard();
create trigger no_delete before delete on hq.email_drafts for each row execute function hq_private.raise_immutable();
create trigger no_truncate before truncate on hq.email_drafts for each statement execute function hq_private.raise_immutable();

-- ------------------------------------------------------------------ access
alter table hq.email_drafts enable row level security;
alter table hq.email_drafts force row level security;

-- A person sees the emails they drafted; audit.read holders (directors, administrators) see everyone's.
-- No insert, update or delete policy: the RPCs write as the owner.
create policy email_drafts_select on hq.email_drafts for select to authenticated
  using ((select hq_private.has_capability('audit.read'))
         or (created_by = (select auth.uid()) and (select hq_private.staff_session())));

revoke all on hq.email_drafts from public, anon, authenticated, service_role;
grant select on hq.email_drafts to authenticated, service_role;

-- ------------------------------------------------------------------ helpers (not executable by any API role: 0133)
create function hq_private.email_ref(p_n bigint) returns text
language sql immutable set search_path = pg_catalog as $$
  select 'EML-' || lpad(p_n::text, greatest(4, length(p_n::text)), '0')
$$;

-- True when the request came from a connected chat app (its token carries a client_id claim).
create function hq_private.email_app_client() returns text
language sql stable set search_path = pg_catalog, public, extensions as $$
  select nullif(left(btrim(coalesce(auth.jwt() ->> 'client_id', '')), 200), '')
$$;

create function hq_private.email_json(p_d hq.email_drafts) returns jsonb
language sql stable set search_path = pg_catalog, public, extensions as $$
  select jsonb_build_object(
    'draft_id', p_d.id, 'ref', hq_private.email_ref(p_d.ref_number), 'status', p_d.status,
    'to_name', p_d.to_name, 'to_email', p_d.to_email::text, 'subject', p_d.subject, 'template', p_d.template,
    'created_via', p_d.created_via, 'created_at', p_d.created_at, 'updated_at', p_d.updated_at,
    'recipient_contact_id', p_d.recipient_contact_id, 'recipient_staff_id', p_d.recipient_staff_id)
$$;

-- One line of text (subject): control characters become spaces, runs of spaces collapse.
create function hq_private.email_line(p_value text, p_max integer, p_what text) returns text
language plpgsql immutable set search_path = pg_catalog as $$
declare
  v text := nullif(btrim(regexp_replace(regexp_replace(coalesce(p_value, ''), '[[:cntrl:]]', ' ', 'g'), ' {2,}', ' ', 'g')), '');
begin
  if v is not null and char_length(v) > p_max then
    raise exception '% is at most % characters', p_what, p_max using errcode = 'invalid_parameter_value';
  end if;
  return v;
end $$;

-- The body: plain text, line breaks kept (CR LF -> LF), other control characters out, trimmed.
create function hq_private.email_body(p_value text) returns text
language plpgsql immutable set search_path = pg_catalog as $$
declare
  v text := nullif(btrim(regexp_replace(regexp_replace(coalesce(p_value, ''), E'\r\n?', E'\n', 'g'), E'[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]', '', 'g'), E' \t\n'), '');
begin
  if v is not null and char_length(v) > 8000 then
    raise exception 'the message is at most 8000 characters' using errcode = 'invalid_parameter_value';
  end if;
  return v;
end $$;

-- Null when the recipient record still holds exactly the address the draft copied; otherwise why not.
create function hq_private.email_recipient_problem(p_d hq.email_drafts) returns text
language plpgsql stable security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_email extensions.citext;
begin
  if p_d.recipient_contact_id is not null then
    select c.email into v_email from hq.contacts c where c.id = p_d.recipient_contact_id and c.deleted_at is null;
    if not found then return 'the contact has been archived'; end if;
  else
    select sp.email into v_email from hq.staff_profiles sp
    where sp.id = p_d.recipient_staff_id and sp.is_active and sp.employment_status = 'active';
    if not found then return 'that member of staff is no longer active'; end if;
  end if;
  if v_email is null or btrim(v_email::text) = '' then return 'the record no longer has an email address'; end if;
  if v_email <> p_d.to_email then return 'the email address on the record has changed since this was drafted'; end if;
  return null;
end $$;

-- The draft, locked, if the caller may act on it: their own, or (p_any) anyone's when they hold audit.read.
-- Someone else's draft the caller cannot see is "not found", exactly as RLS would answer.
create function hq_private.email_lock(p_id uuid, p_caller uuid, p_any boolean) returns hq.email_drafts
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_d hq.email_drafts;
begin
  select * into v_d from hq.email_drafts d where d.id = p_id for update;
  if not found or (v_d.created_by <> p_caller and not (p_any and hq_private.has_capability('audit.read'))) then
    if found and hq_private.has_capability('audit.read') then
      raise exception 'only the person who drafted this email can do that' using errcode = 'insufficient_privilege', hint = 'email_not_yours';
    end if;
    raise exception 'email draft not found' using errcode = 'no_data_found';
  end if;
  return v_d;
end $$;

-- ------------------------------------------------------------------ create_email_draft
create function hq.create_email_draft(
  p_template hq.email_template,
  p_subject text,
  p_body text,
  p_contact uuid default null,
  p_staff uuid default null,
  p_opportunity uuid default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_caller uuid := hq_private.require_staff();
  v_client text := hq_private.email_app_client();
  v_subject text;
  v_body text;
  v_to_email extensions.citext;
  v_to_name text;
  v_reply extensions.citext;
  v_recent integer;
  v_d hq.email_drafts;
begin
  perform hq_private.require_capability('email.draft');
  if num_nonnulls(p_contact, p_staff) <> 1 then
    raise exception 'an email goes to exactly one person: a contact or a member of staff' using errcode = 'invalid_parameter_value', hint = 'email_one_recipient';
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

  if p_contact is not null then
    perform hq_private.require_capability('growth.read');
    select c.email, c.full_name into v_to_email, v_to_name from hq.contacts c where c.id = p_contact and c.deleted_at is null;
    if not found then
      raise exception 'that contact could not be found' using errcode = 'no_data_found';
    end if;
  else
    perform hq_private.require_capability('people.read');
    select sp.email, sp.full_name into v_to_email, v_to_name from hq.staff_profiles sp
    where sp.id = p_staff and sp.is_active and sp.employment_status = 'active';
    if not found then
      raise exception 'that member of staff could not be found or is not active' using errcode = 'no_data_found';
    end if;
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

  insert into hq.email_drafts (created_by, created_via, mcp_client_id, recipient_contact_id, recipient_staff_id,
                               to_email, to_name, subject, body_text, template, reply_to_email, opportunity_id)
  values (v_caller, case when v_client is null then 'hq' else 'mcp' end, v_client, p_contact, p_staff,
          v_to_email, v_to_name, v_subject, v_body, p_template, v_reply, p_opportunity)
  returning * into v_d;

  perform hq_private.audit_write('create', 'email_draft', v_d.id,
    'Drafted email ' || hq_private.email_ref(v_d.ref_number) || ' to ' || v_d.to_name || case when v_client is null then '' else ' (through a connected app)' end,
    jsonb_build_object('status', jsonb_build_object('to', 'draft'), 'created_via', jsonb_build_object('to', v_d.created_via)));
  return hq_private.email_json(v_d) || jsonb_build_object('changed', true);
end $$;

-- ------------------------------------------------------------------ update_email_draft (own, only while a draft)
create function hq.update_email_draft(
  p_id uuid,
  p_subject text default null,
  p_body text default null,
  p_template hq.email_template default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_caller uuid := hq_private.require_staff();
  v_d hq.email_drafts;
  v_subject text;
  v_body text;
  v_fields text[] := '{}';
begin
  perform hq_private.require_capability('email.draft');
  v_d := hq_private.email_lock(p_id, v_caller, false);
  if v_d.status <> 'draft' then
    raise exception 'only a draft waiting for approval can be edited; this email is %', v_d.status using errcode = 'invalid_parameter_value', hint = 'email_not_draft';
  end if;
  if p_subject is not null then
    v_subject := hq_private.email_line(p_subject, 200, 'the subject');
    if v_subject is null then raise exception 'an email needs a subject' using errcode = 'invalid_parameter_value'; end if;
    if v_subject is distinct from v_d.subject then v_fields := v_fields || 'subject'::text; end if;
  end if;
  if p_body is not null then
    v_body := hq_private.email_body(p_body);
    if v_body is null then raise exception 'an email needs a message' using errcode = 'invalid_parameter_value'; end if;
    if v_body is distinct from v_d.body_text then v_fields := v_fields || 'body'::text; end if;
  end if;
  if p_template is not null and p_template is distinct from v_d.template then v_fields := v_fields || 'template'::text; end if;

  if cardinality(v_fields) = 0 then
    return hq_private.email_json(v_d) || jsonb_build_object('changed', false, 'changed_fields', '[]'::jsonb);
  end if;

  update hq.email_drafts set
    subject = coalesce(v_subject, subject),
    body_text = coalesce(v_body, body_text),
    template = coalesce(p_template, template)
  where id = v_d.id
  returning * into v_d;

  perform hq_private.audit_write('update', 'email_draft', v_d.id,
    'Edited email ' || hq_private.email_ref(v_d.ref_number) || ' (' || array_to_string(v_fields, ', ') || ')',
    jsonb_build_object('fields', to_jsonb(v_fields)));
  return hq_private.email_json(v_d) || jsonb_build_object('changed', true, 'changed_fields', to_jsonb(v_fields));
end $$;

-- ------------------------------------------------------------------ discard_email_draft (own, or a director)
create function hq.discard_email_draft(p_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_caller uuid := hq_private.require_staff();
  v_director boolean := hq_private.staff_role() = 'director';
  v_d hq.email_drafts;
  v_reason text := hq_private.email_line(p_reason, 300, 'the reason');
begin
  if not v_director then
    perform hq_private.require_capability('email.draft');
  end if;
  v_d := hq_private.email_lock(p_id, v_caller, v_director);
  if v_d.status in ('sent', 'discarded') then
    raise exception 'this email is already % and cannot be discarded', v_d.status using errcode = 'invalid_parameter_value', hint = 'email_closed';
  end if;
  if v_d.status = 'sending' and v_d.send_started_at > now() - interval '15 minutes' then
    raise exception 'this email is being sent right now; wait a few minutes' using errcode = 'invalid_parameter_value', hint = 'email_sending';
  end if;

  update hq.email_drafts set status = 'discarded', discarded_at = now(), discarded_by = v_caller
  where id = v_d.id
  returning * into v_d;

  perform hq_private.audit_write('discard', 'email_draft', v_d.id,
    'Discarded email ' || hq_private.email_ref(v_d.ref_number) || ' to ' || v_d.to_name || coalesce(' [' || v_reason || ']', ''),
    jsonb_build_object('status', jsonb_build_object('to', 'discarded')));
  return hq_private.email_json(v_d) || jsonb_build_object('changed', true);
end $$;

-- ------------------------------------------------------------------ approve_email_draft (email.send, in HQ only)
-- The person approving is the human check, so the creator MAY approve their own draft (when their role
-- holds email.send). Approval is refused from a connected chat app: it is always a tap in HQ.
create function hq.approve_email_draft(p_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_caller uuid := hq_private.require_staff();
  v_d hq.email_drafts;
  v_problem text;
begin
  perform hq_private.require_capability('email.send');
  if hq_private.email_app_client() is not null then
    raise exception 'an email is approved in HQ, not through a connected app' using errcode = 'insufficient_privilege', hint = 'email_approve_in_hq';
  end if;
  v_d := hq_private.email_lock(p_id, v_caller, true);
  if v_d.status not in ('draft', 'failed') then
    raise exception 'only a draft (or a failed send) can be approved; this email is %', v_d.status using errcode = 'invalid_parameter_value', hint = 'email_not_approvable';
  end if;
  v_problem := hq_private.email_recipient_problem(v_d);
  if v_problem is not null then
    raise exception 'not approved: %. Discard it and draft a new one', v_problem using errcode = 'invalid_parameter_value', hint = 'email_recipient_changed';
  end if;

  update hq.email_drafts set status = 'approved', approved_by = v_caller, approved_at = now(), error_code = null
  where id = v_d.id
  returning * into v_d;

  perform hq_private.audit_write('approve', 'email_draft', v_d.id,
    'Approved email ' || hq_private.email_ref(v_d.ref_number) || ' to ' || v_d.to_name,
    jsonb_build_object('status', jsonb_build_object('to', 'approved')));
  return hq_private.email_json(v_d) || jsonb_build_object('changed', true);
end $$;

-- ------------------------------------------------------------------ begin_email_send
-- Flips one draft to 'sending' and hands back exactly what the server needs to send it. Only one call
-- can win: the row is locked, and a draft already sending or sent is refused, so the provider is called
-- at most once per approval however often this is retried.
create function hq.begin_email_send(p_id uuid, p_via text) returns jsonb
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

-- ------------------------------------------------------------------ finish_email_send
-- Records what the provider said, once: sent (with its message id, a timeline entry on the contact and
-- the contact's last-contact date) or failed (a short code). Only the person who began the send can
-- finish it, and only while it is sending. A failed email is retried only by a new approval.
create function hq.finish_email_send(p_id uuid, p_ok boolean, p_message_id text default null, p_error text default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_caller uuid := hq_private.require_staff();
  v_d hq.email_drafts;
  v_interaction uuid;
  v_msg text := nullif(left(btrim(coalesce(p_message_id, '')), 200), '');
  v_err text := lower(nullif(btrim(coalesce(p_error, '')), ''));
begin
  if p_ok is null then
    raise exception 'say whether the email was sent' using errcode = 'invalid_parameter_value';
  end if;
  select * into v_d from hq.email_drafts d where d.id = p_id for update;
  if not found or (v_d.created_by <> v_caller and v_d.sent_by is distinct from v_caller and not hq_private.has_capability('audit.read')) then
    raise exception 'email draft not found' using errcode = 'no_data_found';
  end if;
  if v_d.status <> 'sending' or v_d.sent_by is distinct from v_caller then
    raise exception 'this email is not being sent by you' using errcode = 'invalid_parameter_value', hint = 'email_not_sending';
  end if;
  if v_msg is not null and v_msg !~ '^[A-Za-z0-9._:@=+-]+$' then
    v_msg := null;
  end if;

  if p_ok then
    if v_d.recipient_contact_id is not null then
      insert into hq.interactions (contact_id, interaction_type, occurred_at, summary, staff_id, opportunity_id)
      values (v_d.recipient_contact_id, 'email', now(), left('Email sent: ' || v_d.subject, 300), v_d.created_by, v_d.opportunity_id)
      returning id into v_interaction;
      update hq.contacts set last_contact_at = greatest(coalesce(last_contact_at, now()), now())
      where id = v_d.recipient_contact_id;
    end if;
    update hq.email_drafts set status = 'sent', sent_at = now(), provider_message_id = v_msg, interaction_id = v_interaction
    where id = v_d.id
    returning * into v_d;
    perform hq_private.audit_write('sent', 'email_draft', v_d.id,
      'Sent email ' || hq_private.email_ref(v_d.ref_number) || ' to ' || v_d.to_name,
      jsonb_build_object('status', jsonb_build_object('from', 'sending', 'to', 'sent')));
  else
    if v_err is null or v_err !~ '^[a-z0-9_]{1,40}$' then
      v_err := 'provider_error';
    end if;
    update hq.email_drafts set status = 'failed', error_code = v_err
    where id = v_d.id
    returning * into v_d;
    perform hq_private.audit_write('send_failed', 'email_draft', v_d.id,
      'Email ' || hq_private.email_ref(v_d.ref_number) || ' to ' || v_d.to_name || ' was not sent (' || v_err || ')',
      jsonb_build_object('status', jsonb_build_object('from', 'sending', 'to', 'failed'), 'error_code', jsonb_build_object('to', v_err)));
  end if;
  return hq_private.email_json(v_d) || jsonb_build_object('changed', true, 'interaction_id', v_interaction, 'sent_at', v_d.sent_at, 'error_code', v_d.error_code);
end $$;
