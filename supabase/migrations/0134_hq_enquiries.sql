-- 0134_hq_enquiries.sql
-- Website enquiries into Planted HQ (docs/hq-setup.md "Website enquiries"). The public site's two forms
-- (rental appraisal, contact) are validated by the site's Server Actions, which then call
-- hq.submit_enquiry with the secret key (lib/hq/enquiry-intake.ts, the ONLY caller). One call stores the
-- enquiry and, in the same transaction, makes it work in HQ: a landlord contact (or the existing contact
-- with that email), an open lead with an owner, a next action and a follow-up date of today, a message on
-- the lead's timeline, and a follow-up task for the owner due today.
--
-- TABLE (schema hq; RLS enabled and forced; readable with growth.read; NO API role may write it: every
-- write goes through the security definer RPCs below, as with hq.email_drafts):
--   enquiries   one row per submission, shown as ENQ-0001 (ref_number). Never deleted. The submitted
--               fields never change after the insert (guard trigger); only the status and its stamps do.
--
-- PRIVACY: the client IP is never stored. The site sends a salted SHA-256 of it (ip_hash, 64 hex), used
-- only for the hourly rate limit. The message is stored once here and copied to the lead's notes and its
-- timeline entry (that is where staff work on it). The enquiry's own audit events record that it arrived
-- and what it was linked to, never the message (the usual row audit of the new lead, contact and timeline
-- entry keeps its standard 500-character excerpt, as for any lead).
--
-- submit_enquiry RULES (database-enforced)
--   * every field is validated and length-capped (name 200, email 254, phone 40, suburb 120,
--     message 5000, details: a flat object of at most 30 short text/number/boolean values,
--     source_page 200, ip_hash 64 hex);
--   * dedupe: the same email with the same submission (kind, message and details) within 10 minutes
--     returns the enquiry already stored ({duplicate: true}); nothing else is created;
--   * rate limits: at most 5 per ip_hash per hour and 5 per email per hour (program_limit_exceeded,
--     hint enquiry_rate_limited);
--   * the contact: the live contact that already uses the email is LINKED and never changed (a partner
--     contact keeps every field and stays a partner); otherwise a landlord contact is created
--     (needs_verification, source 'website enquiry');
--   * the lead: when that contact (or that email) already has an OPEN live lead, the enquiry is attached
--     to it (a message on its timeline, its last activity) instead of a second lead; otherwise a new open
--     lead (source website_enquiry, stage introduction_received, next action 'Reply to the website
--     enquiry', due today in the configured timezone) owned by the setting enquiry_default_owner_id when
--     that is an active member of staff, else the earliest-created active director;
--   * one follow-up task for the owner, due today: 'Reply to website enquiry ENQ-0001';
--   * an audit event with the system actor (auth.uid() is null for the secret key: actor 'System').
--
-- RPCs (security definer, search_path pinned; privileges in 0135):
--   submit_enquiry     service_role ONLY (never anon or authenticated; refused inside as well)
--   mark_enquiry_spam  growth.write: status spam; archives the lead and the contact this enquiry
--                      created when nothing else has been done with them
--   set_enquiry_status growth.write: new | in_progress | archived (spam only through mark_enquiry_spam)
--   set_enquiry_owner  settings.admin (directors): who gets website enquiries (null = earliest director)
-- VIEW enquiry_overview (security_invoker): the list, with the lead, its owner and the contact.

-- ------------------------------------------------------------------ enums
create type hq.enquiry_kind as enum ('appraisal', 'contact');
create type hq.enquiry_status as enum ('new', 'in_progress', 'spam', 'archived');

-- ------------------------------------------------------------------ tasks may come from an enquiry
alter table hq.tasks drop constraint tasks_source_known;
alter table hq.tasks add constraint tasks_source_known check (source in ('manual', 'interaction', 'ai_draft', 'website_enquiry'));

-- ------------------------------------------------------------------ the table
create table hq.enquiries (
  id uuid primary key default gen_random_uuid(),
  ref_number bigint generated always as identity,
  kind hq.enquiry_kind not null,
  received_at timestamptz not null default now(),
  name text not null,
  email extensions.citext not null,
  phone text,
  suburb text,
  message text,
  details jsonb not null default '{}'::jsonb,
  source_page text,
  ip_hash text,
  submission_hash text not null,
  status hq.enquiry_status not null default 'new',
  opportunity_id uuid references hq.opportunities (id),
  contact_id uuid references hq.contacts (id),
  task_id uuid references hq.tasks (id),
  interaction_id uuid references hq.interactions (id),
  created_lead boolean not null default false,
  created_contact boolean not null default false,
  handled_by uuid references hq.staff_profiles (id),
  handled_at timestamptz,
  spam_marked_by uuid references hq.staff_profiles (id),
  spam_marked_at timestamptz,
  status_note text,
  updated_at timestamptz not null default now(),
  constraint enquiries_name_line check (char_length(btrim(name)) between 1 and 200 and name !~ '[[:cntrl:]]'),
  constraint enquiries_email_shape check (char_length(email::text) <= 254 and email::text ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  constraint enquiries_phone_line check (phone is null or (char_length(phone) between 1 and 40 and phone !~ '[[:cntrl:]]')),
  constraint enquiries_suburb_line check (suburb is null or (char_length(suburb) between 1 and 120 and suburb !~ '[[:cntrl:]]')),
  constraint enquiries_message_length check (message is null or char_length(message) between 1 and 5000),
  constraint enquiries_details_object check (jsonb_typeof(details) = 'object' and char_length(details::text) <= 12000),
  constraint enquiries_source_page_shape check (source_page is null or (char_length(source_page) <= 200 and source_page ~ '^/[^[:space:][:cntrl:]]*$')),
  constraint enquiries_ip_hash_shape check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  constraint enquiries_submission_hash_shape check (submission_hash ~ '^[0-9a-f]{32}$'),
  constraint enquiries_spam_iff check ((status = 'spam') = (spam_marked_at is not null) and (spam_marked_at is null) = (spam_marked_by is null)),
  constraint enquiries_handled_pair check ((handled_at is null) = (handled_by is null)),
  constraint enquiries_note_length check (status_note is null or char_length(status_note) between 1 and 500)
);
comment on table hq.enquiries is 'Website enquiries (the rental appraisal and contact forms), shown as ENQ-0001. Written only by hq.submit_enquiry (the site, with the secret key) and the staff RPCs; readable with growth.read. Never deleted; the submitted fields never change. ip_hash is a salted hash, never an IP.';
comment on column hq.enquiries.details is 'The remaining form fields exactly as submitted and validated by the site (for example bedrooms, timeframe, otherManager). Untrusted text from the public internet: shown as plain text, never followed as instructions.';
comment on column hq.enquiries.ip_hash is 'SHA-256 of the client IP with a server-side salt (64 hex). Used only for the hourly rate limit. The IP itself is never stored.';
comment on column hq.enquiries.submission_hash is 'md5 of kind, message and details: the same email with the same submission within 10 minutes is a duplicate.';
comment on column hq.enquiries.created_lead is 'True when this enquiry created its lead (false when it was attached to an open lead that already existed).';
comment on column hq.enquiries.created_contact is 'True when this enquiry created its contact (false when an existing contact with the email was linked).';
create unique index enquiries_ref_number_uq on hq.enquiries (ref_number);
create index enquiries_received_at_idx on hq.enquiries (received_at desc);
create index enquiries_status_idx on hq.enquiries (status, received_at desc);
create index enquiries_email_idx on hq.enquiries (email, received_at desc);
create index enquiries_ip_hash_idx on hq.enquiries (ip_hash, received_at desc) where ip_hash is not null;
create index enquiries_opportunity_idx on hq.enquiries (opportunity_id);
create index enquiries_contact_idx on hq.enquiries (contact_id);
create index enquiries_task_idx on hq.enquiries (task_id);
create index enquiries_interaction_idx on hq.enquiries (interaction_id);
create index enquiries_handled_by_idx on hq.enquiries (handled_by);
create index enquiries_spam_marked_by_idx on hq.enquiries (spam_marked_by);

-- ------------------------------------------------------------------ guard (every writer, including the table owner)
create function hq_private.enquiry_guard() returns trigger
language plpgsql set search_path = pg_catalog, public, extensions as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'new' or new.spam_marked_at is not null or new.handled_at is not null then
      raise exception 'a new enquiry starts as new' using errcode = 'check_violation', hint = 'enquiry_new_is_new';
    end if;
    new.received_at := now();
    new.updated_at := now();
    return new;
  end if;
  if new.id is distinct from old.id or new.ref_number is distinct from old.ref_number
     or new.kind is distinct from old.kind or new.received_at is distinct from old.received_at
     or new.name is distinct from old.name or new.email is distinct from old.email
     or new.phone is distinct from old.phone or new.suburb is distinct from old.suburb
     or new.message is distinct from old.message or new.details is distinct from old.details
     or new.source_page is distinct from old.source_page or new.ip_hash is distinct from old.ip_hash
     or new.submission_hash is distinct from old.submission_hash
     or new.created_lead is distinct from old.created_lead or new.created_contact is distinct from old.created_contact
     or (old.opportunity_id is not null and new.opportunity_id is distinct from old.opportunity_id)
     or (old.contact_id is not null and new.contact_id is distinct from old.contact_id)
     or (old.task_id is not null and new.task_id is distinct from old.task_id)
     or (old.interaction_id is not null and new.interaction_id is distinct from old.interaction_id) then
    raise exception 'what a person submitted on the website cannot be changed' using errcode = 'insufficient_privilege', hint = 'enquiry_fixed_fields';
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger enquiry_guard before insert or update on hq.enquiries for each row execute function hq_private.enquiry_guard();
create trigger no_delete before delete on hq.enquiries for each row execute function hq_private.raise_immutable();
create trigger no_truncate before truncate on hq.enquiries for each statement execute function hq_private.raise_immutable();

alter table hq.enquiries enable row level security;
alter table hq.enquiries force row level security;

create policy enquiries_select on hq.enquiries for select to authenticated
  using ((select hq_private.has_capability('growth.read')));

revoke all on hq.enquiries from public, anon, authenticated, service_role;
grant select on hq.enquiries to authenticated;

-- ------------------------------------------------------------------ settings: who gets website enquiries
insert into hq.settings (key, value) values ('enquiry_default_owner_id', 'null'::jsonb) on conflict (key) do nothing;

-- settings_guard (0132) with enquiry_default_owner_id: JSON null, or the id of an active member of staff.
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

-- ------------------------------------------------------------------ helpers (no API role may execute them: 0135)
create function hq_private.enquiry_owner_ok(p_id uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public, extensions as $$
  select exists (select 1 from hq.staff_profiles sp where sp.id = p_id and sp.is_active and sp.employment_status = 'active')
$$;

create function hq_private.enquiry_ref(p_n bigint) returns text
language sql immutable parallel safe set search_path = pg_catalog as $$
  select 'ENQ-' || lpad(p_n::text, greatest(4, length(p_n::text)), '0')
$$;

-- One line of text from the form: control characters become spaces, runs of spaces collapse, blank = null,
-- longer than p_max is refused (22023 with a plain message).
create function hq_private.enquiry_line(p_value text, p_max integer, p_what text) returns text
language plpgsql immutable set search_path = pg_catalog as $$
declare
  v text := nullif(btrim(regexp_replace(regexp_replace(coalesce(p_value, ''), '[[:cntrl:]]', ' ', 'g'), ' {2,}', ' ', 'g')), '');
begin
  if v is not null and char_length(v) > p_max then
    raise exception '% is at most % characters', p_what, p_max using errcode = 'invalid_parameter_value', hint = 'enquiry_invalid';
  end if;
  return v;
end $$;

-- The message: line endings normalised, control characters other than newline and tab removed, trimmed,
-- blank = null, at most 5000 characters.
create function hq_private.enquiry_message(p_value text) returns text
language plpgsql immutable set search_path = pg_catalog as $$
declare
  v text := nullif(btrim(regexp_replace(regexp_replace(coalesce(p_value, ''), E'\r\n?', E'\n', 'g'), E'[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]', '', 'g'), E' \t\n'), '');
begin
  if v is not null and char_length(v) > 5000 then
    raise exception 'the message is at most 5000 characters' using errcode = 'invalid_parameter_value', hint = 'enquiry_invalid';
  end if;
  return v;
end $$;

-- The remaining form fields: a flat object of at most 30 entries; keys are short identifiers; values are
-- text (one line, at most 300 characters), numbers or true/false. Blank text values are dropped.
create function hq_private.enquiry_details(p_value jsonb) returns jsonb
language plpgsql immutable set search_path = pg_catalog as $$
declare
  v_out jsonb := '{}'::jsonb;
  v_key text;
  v_val jsonb;
  v_text text;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return v_out;
  end if;
  if jsonb_typeof(p_value) <> 'object' then
    raise exception 'the form details must be an object' using errcode = 'invalid_parameter_value', hint = 'enquiry_invalid';
  end if;
  if (select count(*) from jsonb_object_keys(p_value)) > 30 then
    raise exception 'the form details hold at most 30 fields' using errcode = 'invalid_parameter_value', hint = 'enquiry_invalid';
  end if;
  for v_key, v_val in select e.key, e.value from jsonb_each(p_value) e loop
    if v_key !~ '^[A-Za-z][A-Za-z0-9_]{0,39}$' then
      raise exception 'a form field name is not recognised' using errcode = 'invalid_parameter_value', hint = 'enquiry_invalid';
    end if;
    case jsonb_typeof(v_val)
      when 'string' then
        v_text := hq_private.enquiry_line(v_val #>> '{}', 300, 'a form field');
        if v_text is not null then v_out := v_out || jsonb_build_object(v_key, v_text); end if;
      when 'number', 'boolean' then
        v_out := v_out || jsonb_build_object(v_key, v_val);
      when 'null' then
        null;
      else
        raise exception 'a form field must be text, a number or true/false' using errcode = 'invalid_parameter_value', hint = 'enquiry_invalid';
    end case;
  end loop;
  return v_out;
end $$;

create function hq_private.enquiry_json(p_e hq.enquiries, p_duplicate boolean) returns jsonb
language sql stable set search_path = pg_catalog, public, extensions as $$
  select jsonb_build_object(
    'enquiry_id', p_e.id, 'ref', hq_private.enquiry_ref(p_e.ref_number), 'kind', p_e.kind, 'status', p_e.status,
    'opportunity_id', p_e.opportunity_id, 'contact_id', p_e.contact_id, 'task_id', p_e.task_id,
    'created_lead', p_e.created_lead, 'created_contact', p_e.created_contact, 'duplicate', p_duplicate)
$$;

-- ------------------------------------------------------------------ submit_enquiry (the website; service_role only)
create function hq.submit_enquiry(
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
      next_action, next_action_due, notes, owner_contact_id, last_activity_at)
    values (
      v_name, v_phone, v_email, v_suburb, v_address, 'website_enquiry', v_owner,
      'Reply to the website enquiry', v_today,
      left('Website enquiry ' || v_ref || ' (' || v_label || ').' || coalesce(E'\n\n' || v_message, ''), 2000),
      v_contact, now())
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
comment on function hq.submit_enquiry(hq.enquiry_kind, text, text, text, text, text, jsonb, text, text) is 'service_role ONLY (the website, lib/hq/enquiry-intake.ts). Validates and caps every field, dedupes (same email + same submission within 10 minutes returns the stored enquiry), rate-limits (5 per ip_hash and 5 per email per hour: 54000 hint enquiry_rate_limited), links the live contact with the email (never changed) or creates a landlord contact, attaches to an open lead for that contact or creates one (website_enquiry, introduction_received, owner = setting enquiry_default_owner_id or the earliest active director, next action Reply to the website enquiry, due today), adds a message on the timeline and a task due today, audited as System. Returns {enquiry_id, ref, kind, status, opportunity_id, contact_id, task_id, created_lead, created_contact, duplicate}.';

-- ------------------------------------------------------------------ mark_enquiry_spam (growth.write)
-- Marks the enquiry as spam and tidies up after it: the lead and the contact THIS enquiry created are
-- archived when nothing else has happened to them (the lead is still at its first stage with no other
-- activity, task, referral, email, property or enquiry; the contact is still unverified with no other lead,
-- activity, task, referral, email or enquiry). Its own timeline entry and open task go with them.
-- Anything someone has worked on is kept. Returns {enquiry_id, ref, status, changed, lead_archived, contact_archived}.
create function hq.mark_enquiry_spam(p_id uuid, p_note text default null) returns jsonb
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
         and not exists (select 1 from hq.interactions i where i.opportunity_id = o.id and i.deleted_at is null and i.id is distinct from v_e.interaction_id)
         and not exists (select 1 from hq.tasks t where t.related_opportunity_id = o.id and t.deleted_at is null and t.id is distinct from v_e.task_id)
         and not exists (select 1 from hq.tasks t where t.id = v_e.task_id and t.status = 'completed')
         and not exists (select 1 from hq.referrals r where r.opportunity_id = o.id and r.deleted_at is null)
         and not exists (select 1 from hq.email_drafts d where d.opportunity_id = o.id)
         and not exists (select 1 from hq.managed_properties mp where mp.opportunity_id = o.id)
         and not exists (select 1 from hq.enquiries x where x.opportunity_id = o.id and x.id <> v_e.id and x.status <> 'spam')) then
    update hq.tasks set deleted_at = now() where id = v_e.task_id and deleted_at is null;
    update hq.interactions set deleted_at = now() where id = v_e.interaction_id and deleted_at is null;
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
comment on function hq.mark_enquiry_spam(uuid, text) is 'growth.write. Marks a website enquiry as spam (stamped with the caller) and archives the lead and contact it created when nothing else was done with them (its own timeline entry and open task with them). Idempotent. Audited. Returns {enquiry_id, ref, status, changed, lead_archived, contact_archived}.';

-- ------------------------------------------------------------------ set_enquiry_status (growth.write)
-- new | in_progress | archived. Spam is set only by mark_enquiry_spam; moving a spam enquiry back
-- clears the spam stamp (a lead it archived stays archived: restore it from the lead's page).
create function hq.set_enquiry_status(p_id uuid, p_status hq.enquiry_status, p_note text default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_caller uuid := hq_private.require_staff();
  v_e hq.enquiries;
  v_old hq.enquiry_status;
  v_note text;
  v_ref text;
begin
  perform hq_private.require_capability('growth.write');
  if p_status is null then
    raise exception 'choose a status' using errcode = 'invalid_parameter_value';
  end if;
  if p_status = 'spam' then
    raise exception 'use mark_enquiry_spam to mark an enquiry as spam' using errcode = 'invalid_parameter_value', hint = 'use_mark_enquiry_spam';
  end if;
  v_note := hq_private.enquiry_line(p_note, 500, 'the note');
  select * into v_e from hq.enquiries e where e.id = p_id for update;
  if not found then
    raise exception 'enquiry not found' using errcode = 'no_data_found';
  end if;
  v_ref := hq_private.enquiry_ref(v_e.ref_number);
  v_old := v_e.status;
  if v_old = p_status and v_note is null then
    return jsonb_build_object('enquiry_id', v_e.id, 'ref', v_ref, 'status', v_e.status, 'changed', false);
  end if;

  update hq.enquiries set status = p_status,
    spam_marked_by = null, spam_marked_at = null,
    handled_by = case when p_status = 'new' then null else v_caller end,
    handled_at = case when p_status = 'new' then null else now() end,
    status_note = coalesce(v_note, status_note)
  where id = v_e.id
  returning * into v_e;

  perform hq_private.audit_write('status_change', 'enquiry', v_e.id,
    'Website enquiry ' || v_ref || ': ' || v_old::text || ' to ' || p_status::text || coalesce(' [' || v_note || ']', ''),
    jsonb_build_object('status', jsonb_build_object('from', v_old, 'to', p_status)));

  return jsonb_build_object('enquiry_id', v_e.id, 'ref', v_ref, 'status', v_e.status, 'changed', true);
end $$;
comment on function hq.set_enquiry_status(uuid, hq.enquiry_status, text) is 'growth.write. Sets a website enquiry to new, in_progress or archived (spam only through mark_enquiry_spam; leaving spam clears the stamp). Stamps who handled it. Audited. Returns {enquiry_id, ref, status, changed}.';

-- ------------------------------------------------------------------ set_enquiry_owner (settings.admin)
create function hq.set_enquiry_owner(p_staff uuid default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_cur jsonb;
  v_new jsonb := case when p_staff is null then 'null'::jsonb else to_jsonb(p_staff::text) end;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('settings.admin');
  if p_staff is not null and not hq_private.enquiry_owner_ok(p_staff) then
    raise exception 'the person who gets website enquiries must be an active member of staff' using errcode = 'invalid_parameter_value';
  end if;
  select s.value into v_cur from hq.settings s where s.key = 'enquiry_default_owner_id' for update;
  if not found then
    insert into hq.settings (key, value) values ('enquiry_default_owner_id', v_new);
    return jsonb_build_object('owner', p_staff, 'changed', true);
  end if;
  if v_cur is not distinct from v_new then
    return jsonb_build_object('owner', p_staff, 'changed', false);
  end if;
  update hq.settings set value = v_new where key = 'enquiry_default_owner_id';
  return jsonb_build_object('owner', p_staff, 'changed', true);
end $$;
comment on function hq.set_enquiry_owner(uuid) is 'settings.admin (directors). Who gets website enquiries: an active member of staff, or null for the earliest-created active director. Audited by the settings trigger. Returns {owner, changed}.';

-- ------------------------------------------------------------------ the list
create view hq.enquiry_overview with (security_invoker = true) as
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
  e.updated_at
from hq.enquiries e
left join hq.opportunities o on o.id = e.opportunity_id
left join hq.staff_profiles asg on asg.id = o.assigned_to
left join hq.contacts c on c.id = e.contact_id
left join hq.staff_profiles hb on hb.id = e.handled_by;
comment on view hq.enquiry_overview is 'Website enquiries newest first: ENQ ref, kind, status, the submitted fields, the lead (LEAD ref, stage, live), its owner, the contact and who handled it. security_invoker: growth.read.';

revoke all on hq.enquiry_overview from public, anon, authenticated, service_role;
grant select on hq.enquiry_overview to authenticated;
