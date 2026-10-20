-- 0138_hq_knowledge.sql
-- The Knowledge base: company procedures, contractor vetting procedures, referral partner procedures,
-- landlord onboarding guidance, staff policies, operational checklists and how PLANTED. speaks (brand,
-- voice and vision). Each document has a title, a category, a summary, an owner, a review date, a
-- version history and an approval status. Same patterns as the decisions register (0125) and email
-- approval (0132).
--
-- THE RULE THAT PROTECTS THE BUSINESS: APPROVED CONTENT NEVER CHANGES SILENTLY.
--   * Every edit, from HQ or from a connected chat app, creates a NEW VERSION as a DRAFT. A saved
--     version never changes (its words are immutable for every writer, including the table owner).
--   * Readers keep seeing the last APPROVED version until a person with knowledge.approve approves the
--     newer draft in HQ. Approving makes that version the approved one; the previous approved version
--     becomes superseded (kept, readable, restorable as a new draft).
--   * A brand-new document starts as a draft; until its first approval, readers see the draft text,
--     marked "Draft, not yet approved" everywhere (HQ and chat).
--   * The document row's title and summary are the APPROVED ones once a version is approved; the guard
--     below refuses any change to them that does not come with a new approved version.
--   * Approval from a connected chat app is refused unless a director switched on
--     knowledge_chat_approve_enabled (default false), and then still needs knowledge.approve.
--
-- TABLES (schema hq; RLS enabled and forced; the API may only SELECT; every write goes through the
-- security definer RPCs below):
--   knowledge_documents  one row per document, shown as KB-0001 (ref_number). Soft deletion only
--                        (archive_record / restore_record, entity 'knowledge_document'); never deleted.
--   knowledge_versions   one row per saved version (append-only words; only the status moves:
--                        draft -> approved | superseded | discarded, approved -> superseded).
--
-- CAPABILITIES (data, in hq.role_capabilities; an assumption for the owner to confirm):
--   knowledge.read     every role (director, administrator, senior_property_manager, property_manager,
--                      junior_property_manager, business_development_manager, virtual_assistant, read_only)
--   knowledge.write    director, administrator, senior_property_manager, property_manager,
--                      business_development_manager, virtual_assistant (create documents, save drafts,
--                      discard their own draft, restore an older version as a draft, owner/review/category)
--   knowledge.approve  director, administrator (approve a draft, discard anyone's draft, archive, restore)
--
-- WHAT A READER SEES (RLS on knowledge_versions): versions that are or were approved, and the draft of
-- a document that has never been approved. knowledge.write holders also see every draft (the history
-- and the "View draft" page). Archived documents only for knowledge.approve holders.
--
-- RPCs (security definer, search_path pinned, capability and MFA checked inside, audited as entity
-- knowledge_document): create_knowledge_document, edit_knowledge_document, approve_knowledge_version,
-- discard_knowledge_draft, set_knowledge_review, restore_knowledge_version; archive_record /
-- restore_record gain 'knowledge_document'. Function privileges: 0139.
--
-- STARTER TEMPLATES (end of this file): one clearly labelled draft per category, plus five for brand,
-- voice and vision, each titled "[Template] ... (replace me)" with headings and placeholder prompts
-- only. No policy, price, legal or compliance content is invented. A template cannot be approved until
-- someone has replaced its text (the first edit clears is_template).

-- ------------------------------------------------------------------ enums
create type hq.knowledge_category as enum (
  'company_procedure', 'contractor_vetting', 'referral_partner', 'landlord_onboarding', 'staff_policy',
  'operational_checklist', 'brand_voice', 'general');
create type hq.knowledge_status as enum ('draft', 'approved', 'archived');
create type hq.knowledge_version_status as enum ('draft', 'approved', 'superseded', 'discarded');

-- ------------------------------------------------------------------ capabilities (an assumption for the owner to confirm)
insert into hq.role_capabilities (role, capability)
select r.role::hq.staff_role, r.capability
from (values
  ('director', 'knowledge.read'), ('director', 'knowledge.write'), ('director', 'knowledge.approve'),
  ('administrator', 'knowledge.read'), ('administrator', 'knowledge.write'), ('administrator', 'knowledge.approve'),
  ('senior_property_manager', 'knowledge.read'), ('senior_property_manager', 'knowledge.write'),
  ('property_manager', 'knowledge.read'), ('property_manager', 'knowledge.write'),
  ('junior_property_manager', 'knowledge.read'),
  ('business_development_manager', 'knowledge.read'), ('business_development_manager', 'knowledge.write'),
  ('virtual_assistant', 'knowledge.read'), ('virtual_assistant', 'knowledge.write'),
  ('read_only', 'knowledge.read')
) as r(role, capability)
on conflict do nothing;

-- ------------------------------------------------------------------ the chat-approve switch
insert into hq.settings (key, value) values ('knowledge_chat_approve_enabled', 'false'::jsonb) on conflict (key) do nothing;

-- settings_guard (0136) with knowledge_chat_approve_enabled: true or false.
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
  if new.key = 'knowledge_chat_approve_enabled' and jsonb_typeof(new.value) is distinct from 'boolean' then
    raise exception 'knowledge_chat_approve_enabled must be true or false' using errcode = 'invalid_parameter_value';
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

-- ------------------------------------------------------------------ knowledge_documents
create table hq.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  ref_number bigint generated always as identity,
  title text not null,
  name_key text generated always as (hq_private.normalise_name(title)) stored,
  category hq.knowledge_category not null,
  summary text,
  owner_id uuid references hq.staff_profiles (id),
  review_due date,
  current_version integer not null default 1,
  approved_version integer,
  status hq.knowledge_status not null default 'draft',
  is_template boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  constraint knowledge_documents_title_length check (char_length(btrim(title)) between 1 and 200),
  constraint knowledge_documents_summary_length check (summary is null or char_length(summary) <= 500),
  constraint knowledge_documents_versions_sane check (current_version >= 1 and (approved_version is null or approved_version between 1 and current_version)),
  constraint knowledge_documents_status_consistent check (
    status = case when deleted_at is not null then 'archived'::hq.knowledge_status
                  when approved_version is not null then 'approved'::hq.knowledge_status
                  else 'draft'::hq.knowledge_status end),
  constraint knowledge_documents_review_sane check (review_due is null or review_due >= date '2000-01-01')
);
comment on table hq.knowledge_documents is 'The Knowledge base, shown as KB-0001. title and summary are the APPROVED ones (the draft''s until the first approval). current_version is the latest saved version that is not discarded; approved_version is what readers see. Written only by the knowledge RPCs and archive_record / restore_record (entity knowledge_document). Never deleted.';
comment on column hq.knowledge_documents.status is 'Derived and kept consistent by the guard: archived (deleted_at set), approved (an approved version exists), draft (never approved).';
comment on column hq.knowledge_documents.is_template is 'A starter template seeded by migration 0138 that nobody has written yet. Cleared by the first edit; a template cannot be approved.';
create unique index knowledge_documents_ref_number_uq on hq.knowledge_documents (ref_number);
create unique index knowledge_documents_name_key_uq on hq.knowledge_documents (name_key) where deleted_at is null;
create index knowledge_documents_owner_id_idx on hq.knowledge_documents (owner_id);
create index knowledge_documents_category_idx on hq.knowledge_documents (category) where deleted_at is null;
create index knowledge_documents_review_due_idx on hq.knowledge_documents (review_due) where deleted_at is null and review_due is not null;
create index knowledge_documents_title_trgm_idx on hq.knowledge_documents using gin (title extensions.gin_trgm_ops);

-- ------------------------------------------------------------------ knowledge_versions (append-only words)
create table hq.knowledge_versions (
  id bigint generated always as identity primary key,
  document_id uuid not null references hq.knowledge_documents (id),
  version integer not null,
  title text not null,
  summary text,
  body text not null,
  based_on_version integer,
  status hq.knowledge_version_status not null default 'draft',
  edited_by uuid references hq.staff_profiles (id),
  edited_by_name text,
  edited_at timestamptz not null default now(),
  via text not null default 'hq',
  mcp_client_id text,
  change_note text,
  approved_by uuid references hq.staff_profiles (id),
  approved_by_name text,
  approved_at timestamptz,
  approved_via text,
  discarded_by uuid references hq.staff_profiles (id),
  discarded_at timestamptz,
  constraint knowledge_versions_version_positive check (version >= 1),
  constraint knowledge_versions_title_length check (char_length(btrim(title)) between 1 and 200),
  constraint knowledge_versions_summary_length check (summary is null or char_length(summary) <= 500),
  constraint knowledge_versions_body_length check (char_length(btrim(body)) between 1 and 50000),
  constraint knowledge_versions_note_length check (change_note is null or char_length(change_note) <= 300),
  constraint knowledge_versions_via_known check (via in ('hq', 'mcp')),
  constraint knowledge_versions_client_iff_mcp check ((via = 'mcp') = (mcp_client_id is not null)),
  constraint knowledge_versions_client_length check (mcp_client_id is null or char_length(mcp_client_id) between 1 and 200),
  constraint knowledge_versions_approved_via_known check (approved_via is null or approved_via in ('hq', 'mcp')),
  constraint knowledge_versions_approval_pair check ((approved_at is null) = (approved_via is null) and (approved_at is null or approved_by is not null)),
  constraint knowledge_versions_approved_has_approval check (status not in ('approved') or approved_at is not null),
  constraint knowledge_versions_draft_unapproved check (status not in ('draft', 'discarded') or approved_at is null),
  constraint knowledge_versions_discarded_iff check ((status = 'discarded') = (discarded_at is not null))
);
comment on table hq.knowledge_versions is 'Every saved version of a knowledge document. The words (title, summary, body), who saved it, when, through what (hq or mcp) and the change note never change. Only the status moves: draft -> approved | superseded (a newer draft replaced it) | discarded; approved -> superseded (a newer version was approved).';
create unique index knowledge_versions_doc_version_uq on hq.knowledge_versions (document_id, version);
create unique index knowledge_versions_one_draft_uq on hq.knowledge_versions (document_id) where status = 'draft';
create unique index knowledge_versions_one_approved_uq on hq.knowledge_versions (document_id) where status = 'approved';
create index knowledge_versions_edited_by_idx on hq.knowledge_versions (edited_by);
create index knowledge_versions_approved_by_idx on hq.knowledge_versions (approved_by);
create index knowledge_versions_discarded_by_idx on hq.knowledge_versions (discarded_by);
create index knowledge_versions_status_idx on hq.knowledge_versions (status, edited_at desc);
create index knowledge_versions_body_trgm_idx on hq.knowledge_versions using gin (body extensions.gin_trgm_ops);

-- ------------------------------------------------------------------ guards (every writer, including the table owner)
create function hq_private.knowledge_document_guard() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
begin
  new.title := btrim(new.title);
  new.summary := nullif(btrim(coalesce(new.summary, '')), '');
  if tg_op = 'UPDATE' then
    if new.ref_number is distinct from old.ref_number then
      raise exception 'a document''s number cannot change' using errcode = 'insufficient_privilege';
    end if;
    if new.is_template and not old.is_template then
      raise exception 'a document cannot become a template again' using errcode = 'insufficient_privilege';
    end if;
    if old.approved_version is not null and new.approved_version is null then
      raise exception 'an approved document cannot become unapproved' using errcode = 'insufficient_privilege';
    end if;
    -- approved wording changes only together with a newly approved version
    if old.approved_version is not null and new.approved_version is not distinct from old.approved_version
       and (new.title, new.summary) is distinct from (old.title, old.summary) then
      raise exception 'approved wording changes only by approving a new version'
        using errcode = 'insufficient_privilege', hint = 'knowledge_approved_is_fixed';
    end if;
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  else
    new.updated_by := null;
  end if;
  if new.owner_id is not null and (tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id) then
    if not exists (select 1 from hq.staff_profiles sp where sp.id = new.owner_id and sp.is_active and sp.employment_status = 'active') then
      raise exception 'the owner must be an active member of staff' using errcode = 'invalid_parameter_value';
    end if;
  end if;
  new.status := case when new.deleted_at is not null then 'archived'::hq.knowledge_status
                     when new.approved_version is not null then 'approved'::hq.knowledge_status
                     else 'draft'::hq.knowledge_status end;
  return new;
end $$;

create function hq_private.knowledge_version_guard() returns trigger
language plpgsql set search_path = pg_catalog, public, extensions as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.approved_by is not null or new.approved_at is not null or new.approved_via is not null
       or new.discarded_by is not null or new.discarded_at is not null then
      raise exception 'a new version starts as a draft' using errcode = 'check_violation', hint = 'knowledge_new_is_draft';
    end if;
    new.edited_at := now();
    return new;
  end if;
  if (new.id, new.document_id, new.version, new.title, new.summary, new.body, new.based_on_version, new.edited_by, new.edited_by_name,
      new.edited_at, new.via, new.mcp_client_id, new.change_note)
     is distinct from
     (old.id, old.document_id, old.version, old.title, old.summary, old.body, old.based_on_version, old.edited_by, old.edited_by_name,
      old.edited_at, old.via, old.mcp_client_id, old.change_note) then
    raise exception 'a saved version never changes: save a new version instead'
      using errcode = 'insufficient_privilege', hint = 'knowledge_version_immutable';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'draft' and new.status in ('approved', 'superseded', 'discarded'))
    or (old.status = 'approved' and new.status = 'superseded')) then
    raise exception 'a version cannot go from % to %', old.status, new.status using errcode = 'check_violation', hint = 'knowledge_bad_transition';
  end if;
  if (new.approved_by, new.approved_by_name, new.approved_at, new.approved_via) is distinct from (old.approved_by, old.approved_by_name, old.approved_at, old.approved_via)
     and not (old.status = 'draft' and new.status = 'approved') then
    raise exception 'an approval is recorded once, when a draft is approved' using errcode = 'insufficient_privilege', hint = 'knowledge_approval_fixed';
  end if;
  if (new.discarded_by, new.discarded_at) is distinct from (old.discarded_by, old.discarded_at)
     and not (old.status = 'draft' and new.status = 'discarded') then
    raise exception 'a discard is recorded once, when a draft is discarded' using errcode = 'insufficient_privilege', hint = 'knowledge_discard_fixed';
  end if;
  return new;
end $$;

create trigger row_stamp before insert or update on hq.knowledge_documents for each row execute function hq_private.row_stamp();
create trigger soft_delete_guard before insert or update on hq.knowledge_documents for each row execute function hq_private.soft_delete_guard();
create trigger knowledge_document_guard before insert or update on hq.knowledge_documents for each row execute function hq_private.knowledge_document_guard();
create trigger no_delete before delete on hq.knowledge_documents for each row execute function hq_private.raise_immutable();
create trigger no_truncate before truncate on hq.knowledge_documents for each statement execute function hq_private.raise_immutable();
create trigger audit after insert or update or delete on hq.knowledge_documents for each row execute function hq_private.audit_row('knowledge_document');

create trigger knowledge_version_guard before insert or update on hq.knowledge_versions for each row execute function hq_private.knowledge_version_guard();
create trigger no_delete before delete on hq.knowledge_versions for each row execute function hq_private.raise_immutable();
create trigger no_truncate before truncate on hq.knowledge_versions for each statement execute function hq_private.raise_immutable();

-- ------------------------------------------------------------------ access
alter table hq.knowledge_documents enable row level security;  alter table hq.knowledge_documents force row level security;
alter table hq.knowledge_versions enable row level security;   alter table hq.knowledge_versions force row level security;

-- Readers see live documents; archived ones only knowledge.approve holders (who can restore them).
create policy knowledge_documents_select on hq.knowledge_documents for select to authenticated
  using ((select hq_private.has_capability('knowledge.read'))
         and (deleted_at is null or (select hq_private.has_capability('knowledge.approve'))));
-- Versions of a document the reader can see (the subquery runs under the reader's RLS): writers see
-- every version; readers see versions that are or were approved, and the draft of a never-approved document.
create policy knowledge_versions_select on hq.knowledge_versions for select to authenticated
  using ((select hq_private.has_capability('knowledge.read'))
         and exists (select 1 from hq.knowledge_documents d where d.id = document_id
                       and ((select hq_private.has_capability('knowledge.write'))
                            or knowledge_versions.approved_at is not null
                            or (knowledge_versions.status = 'draft' and d.approved_version is null))));

revoke all on hq.knowledge_documents, hq.knowledge_versions from public, anon, authenticated, service_role;
grant select on hq.knowledge_documents, hq.knowledge_versions to authenticated, service_role;

-- ------------------------------------------------------------------ the overview (list, search, detail)
-- security_invoker: the reader's RLS applies to every table it reads. `body` is the READING text: the
-- approved version's, or the draft's when the document has never been approved (reading_is_draft).
-- A pending draft's own text is read from knowledge_versions (writers only, by RLS).
create view hq.knowledge_overview with (security_invoker = true) as
select
  d.id,
  d.ref_number,
  'KB-' || lpad(d.ref_number::text, greatest(4, length(d.ref_number::text)), '0') as ref,
  d.title,
  d.category,
  d.summary,
  d.status,
  case when d.deleted_at is not null then 'Archived'
       when d.approved_version is null then 'Draft'
       when d.current_version > d.approved_version then 'Approved, newer draft waiting'
       else 'Approved' end as status_label,
  d.owner_id,
  o.full_name as owner_name,
  d.approved_version,
  d.current_version,
  (d.approved_version is null or d.current_version > d.approved_version) as has_pending_draft,
  coalesce(d.approved_version, d.current_version) as reading_version,
  (d.approved_version is null) as reading_is_draft,
  rv.body,
  rv.approved_at,
  rv.approved_by_name,
  d.review_due,
  (d.review_due is not null and d.review_due < hq.today()) as review_overdue,
  case when d.review_due is null then null
       when d.review_due < hq.today() then 'overdue'
       when d.review_due <= hq.today() + 30 then 'due_soon' end as review_state,
  d.is_template,
  d.created_by,
  d.created_at,
  d.updated_at,
  d.deleted_at
from hq.knowledge_documents d
left join hq.staff_profiles o on o.id = d.owner_id
left join hq.knowledge_versions rv on rv.document_id = d.id and rv.version = coalesce(d.approved_version, d.current_version);
comment on view hq.knowledge_overview is 'One row per knowledge document the reader can see: KB-0001 ref, status label (Approved | Draft | Approved, newer draft waiting | Archived), owner name, the reading body (approved, or the draft while never approved: reading_is_draft), review_due with review_overdue (before today) and review_state (overdue | due_soon within 30 days). Filter deleted_at is null for the live list.';
revoke all on hq.knowledge_overview from public, anon, authenticated, service_role;
grant select on hq.knowledge_overview to authenticated;

-- ------------------------------------------------------------------ RPC helpers (not granted to any API role: 0139)
create function hq_private.knowledge_ref(p_n bigint) returns text
language sql immutable parallel safe set search_path = pg_catalog as $$
  select 'KB-' || lpad(p_n::text, greatest(4, length(p_n::text)), '0')
$$;

create function hq_private.knowledge_json(p_d hq.knowledge_documents) returns jsonb
language sql stable set search_path = pg_catalog, public, extensions as $$
  select jsonb_build_object(
    'document_id', p_d.id, 'ref', hq_private.knowledge_ref(p_d.ref_number), 'ref_number', p_d.ref_number,
    'title', p_d.title, 'category', p_d.category, 'status', p_d.status, 'summary', p_d.summary,
    'current_version', p_d.current_version, 'approved_version', p_d.approved_version,
    'has_pending_draft', (p_d.approved_version is null or p_d.current_version > p_d.approved_version),
    'owner_id', p_d.owner_id, 'review_due', p_d.review_due, 'is_template', p_d.is_template, 'updated_at', p_d.updated_at)
$$;

-- One line a person typed (title, summary, note): control characters become spaces, runs collapse, trimmed, bounded.
create function hq_private.knowledge_line(p_value text, p_max integer, p_what text) returns text
language plpgsql immutable set search_path = pg_catalog as $$
declare
  v text := nullif(btrim(regexp_replace(regexp_replace(coalesce(p_value, ''), '[[:cntrl:]]', ' ', 'g'), ' {2,}', ' ', 'g')), '');
begin
  if v is not null and char_length(v) > p_max then
    raise exception '% is at most % characters', p_what, p_max using errcode = 'invalid_parameter_value';
  end if;
  return v;
end $$;

-- The text of a document: plain text with a small markdown subset, line breaks kept (CR LF -> LF),
-- tabs kept, other control characters out, trimmed, at most 50000 characters.
create function hq_private.knowledge_body(p_value text) returns text
language plpgsql immutable set search_path = pg_catalog as $$
declare
  v text := nullif(btrim(regexp_replace(regexp_replace(coalesce(p_value, ''), E'\r\n?', E'\n', 'g'), E'[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]', '', 'g'), E' \t\n'), '');
begin
  if v is not null and char_length(v) > 50000 then
    raise exception 'the text is at most 50000 characters' using errcode = 'invalid_parameter_value';
  end if;
  return v;
end $$;

-- A review date someone sets: today or later, at most five years ahead.
create function hq_private.knowledge_review_check(p_date date) returns void
language plpgsql stable security definer set search_path = pg_catalog, public, extensions as $$
begin
  if p_date is not null and (p_date < hq.today() or p_date > hq.today() + 1826) then
    raise exception 'a review date is today or later, at most five years ahead' using errcode = 'invalid_parameter_value';
  end if;
end $$;

-- The document locked for a change, if live; anything else is "not found".
create function hq_private.knowledge_lock(p_id uuid) returns hq.knowledge_documents
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_d hq.knowledge_documents;
begin
  select * into v_d from hq.knowledge_documents d where d.id = p_id and d.deleted_at is null for update;
  if not found then
    raise exception 'document not found' using errcode = 'no_data_found';
  end if;
  return v_d;
end $$;

-- Saves a NEW draft version (the next number) and points the document at it. A pending draft it
-- replaces becomes superseded. While the document has never been approved, its title and summary follow
-- the draft; once approved they stay the approved ones until the next approval.
create function hq_private.knowledge_save_draft(
  p_doc hq.knowledge_documents, p_title text, p_summary text, p_body text, p_note text, p_action text
) returns hq.knowledge_documents
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_actor uuid := auth.uid();
  v_client text := hq_private.email_app_client();
  v_next integer;
  v_d hq.knowledge_documents;
begin
  if exists (select 1 from hq.knowledge_documents x
             where x.deleted_at is null and x.id <> p_doc.id and x.name_key = hq_private.normalise_name(p_title)) then
    raise exception 'another document already has that title' using errcode = 'check_violation', hint = 'knowledge_title_taken';
  end if;
  select coalesce(max(v.version), 0) + 1 into v_next from hq.knowledge_versions v where v.document_id = p_doc.id;
  update hq.knowledge_versions set status = 'superseded' where document_id = p_doc.id and status = 'draft';
  insert into hq.knowledge_versions (document_id, version, title, summary, body, based_on_version, edited_by, edited_by_name, via, mcp_client_id, change_note)
  values (p_doc.id, v_next, p_title, p_summary, p_body, p_doc.current_version, v_actor,
          coalesce((select sp.full_name from hq.staff_profiles sp where sp.id = v_actor), case when v_actor is null then 'System' end),
          case when v_client is null then 'hq' else 'mcp' end, v_client, p_note);
  perform hq_private.audit_context(p_action, left(p_note, 200));
  update hq.knowledge_documents d set
    current_version = v_next,
    is_template = false,
    title = case when d.approved_version is null then p_title else d.title end,
    summary = case when d.approved_version is null then p_summary else d.summary end
  where d.id = p_doc.id
  returning * into v_d;
  perform hq_private.audit_context();
  return v_d;
end $$;

-- ------------------------------------------------------------------ create_knowledge_document
create function hq.create_knowledge_document(
  p_title text,
  p_category hq.knowledge_category,
  p_body text,
  p_summary text default null,
  p_owner uuid default null,
  p_review_due date default null,
  p_change_note text default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_caller uuid := hq_private.require_staff();
  v_client text := hq_private.email_app_client();
  v_title text;
  v_summary text;
  v_body text;
  v_note text;
  v_d hq.knowledge_documents;
begin
  perform hq_private.require_capability('knowledge.write');
  v_title := hq_private.knowledge_line(p_title, 200, 'a title');
  if v_title is null then
    raise exception 'a document needs a title' using errcode = 'invalid_parameter_value';
  end if;
  if p_category is null then
    raise exception 'choose a category' using errcode = 'invalid_parameter_value';
  end if;
  v_summary := hq_private.knowledge_line(p_summary, 500, 'a summary');
  v_body := hq_private.knowledge_body(p_body);
  if v_body is null then
    raise exception 'a document needs some text' using errcode = 'invalid_parameter_value';
  end if;
  v_note := coalesce(hq_private.knowledge_line(p_change_note, 300, 'a change note'), 'First draft');
  perform hq_private.require_active_staff(coalesce(p_owner, v_caller), 'the owner');
  perform hq_private.knowledge_review_check(p_review_due);
  if exists (select 1 from hq.knowledge_documents x where x.deleted_at is null and x.name_key = hq_private.normalise_name(v_title)) then
    raise exception 'another document already has that title' using errcode = 'check_violation', hint = 'knowledge_title_taken';
  end if;

  perform hq_private.audit_context(null, left(v_note, 200));
  insert into hq.knowledge_documents (title, category, summary, owner_id, review_due, current_version)
  values (v_title, p_category, v_summary, coalesce(p_owner, v_caller), p_review_due, 1)
  returning * into v_d;
  perform hq_private.audit_context();
  insert into hq.knowledge_versions (document_id, version, title, summary, body, edited_by, edited_by_name, via, mcp_client_id, change_note)
  values (v_d.id, 1, v_d.title, v_d.summary, v_body, v_caller, (select sp.full_name from hq.staff_profiles sp where sp.id = v_caller),
          case when v_client is null then 'hq' else 'mcp' end, v_client, v_note);
  return hq_private.knowledge_json(v_d) || jsonb_build_object('version', 1, 'changed', true);
end $$;
comment on function hq.create_knowledge_document(text, hq.knowledge_category, text, text, uuid, date, text) is 'knowledge.write. Creates a document as a DRAFT (version 1): title 1-200 (unique among live documents), category, body 1-50000, summary up to 500, owner (default the caller; active staff), review date (today to five years ahead), change note up to 300 (default First draft). Audited. Returns the document json plus {version, changed}.';

-- ------------------------------------------------------------------ edit_knowledge_document
-- Saves the next version as a DRAFT. Never changes an approved version. p_base_version is the version
-- the editor started from (the document's current_version when they opened it): anything else means
-- someone else saved, approved-and-edited or discarded meanwhile, and the edit is refused. A null
-- argument keeps that part as it is in the version being edited; an empty summary clears it. An edit
-- that changes nothing is refused.
create function hq.edit_knowledge_document(
  p_document uuid,
  p_base_version integer,
  p_change_note text,
  p_title text default null,
  p_summary text default null,
  p_body text default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_d hq.knowledge_documents;
  v_cur hq.knowledge_versions;
  v_title text;
  v_summary text;
  v_body text;
  v_note text;
  v_fields text[] := '{}';
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('knowledge.write');
  v_note := hq_private.knowledge_line(p_change_note, 300, 'a change note');
  if v_note is null then
    raise exception 'say what changed in a short change note' using errcode = 'invalid_parameter_value';
  end if;
  v_d := hq_private.knowledge_lock(p_document);
  if p_base_version is null or p_base_version <> v_d.current_version then
    raise exception 'this document was changed by someone else since you opened it; reload it and edit again'
      using errcode = 'check_violation', hint = 'knowledge_stale';
  end if;
  select * into v_cur from hq.knowledge_versions v where v.document_id = v_d.id and v.version = v_d.current_version;

  v_title := v_cur.title;
  if p_title is not null then
    v_title := hq_private.knowledge_line(p_title, 200, 'a title');
    if v_title is null then
      raise exception 'a document needs a title' using errcode = 'invalid_parameter_value';
    end if;
  end if;
  v_summary := case when p_summary is null then v_cur.summary else hq_private.knowledge_line(p_summary, 500, 'a summary') end;
  v_body := v_cur.body;
  if p_body is not null then
    v_body := hq_private.knowledge_body(p_body);
    if v_body is null then
      raise exception 'a document needs some text' using errcode = 'invalid_parameter_value';
    end if;
  end if;
  if v_title is distinct from v_cur.title then v_fields := v_fields || 'title'::text; end if;
  if v_summary is distinct from v_cur.summary then v_fields := v_fields || 'summary'::text; end if;
  if v_body is distinct from v_cur.body then v_fields := v_fields || 'body'::text; end if;
  if cardinality(v_fields) = 0 then
    raise exception 'nothing changed: the text is the same as version %', v_cur.version
      using errcode = 'invalid_parameter_value', hint = 'knowledge_no_change';
  end if;

  v_d := hq_private.knowledge_save_draft(v_d, v_title, v_summary, v_body, v_note, 'edit');
  return hq_private.knowledge_json(v_d) || jsonb_build_object('version', v_d.current_version, 'based_on_version', v_cur.version,
    'changed', true, 'changed_fields', to_jsonb(v_fields));
end $$;
comment on function hq.edit_knowledge_document(uuid, integer, text, text, text, text) is 'knowledge.write. Saves the next version as a DRAFT (approved content is never changed): p_base_version must be the document''s current_version (else 23514 knowledge_stale), a change note is required (1-300), null keeps a part, an empty summary clears it, no change is refused (22023 knowledge_no_change). A pending draft it replaces becomes superseded. Audited (action edit). Returns the document json plus {version, based_on_version, changed, changed_fields}.';

-- ------------------------------------------------------------------ approve_knowledge_version
-- knowledge.approve, the latest draft only. From a connected chat app only while a director has
-- switched knowledge_chat_approve_enabled on. The person approving is the human check, so an approver
-- may approve a draft they wrote. A starter template that nobody has written cannot be approved.
create function hq.approve_knowledge_version(p_document uuid, p_version integer) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_caller uuid := hq_private.require_staff();
  v_client text := hq_private.email_app_client();
  v_d hq.knowledge_documents;
  v_v hq.knowledge_versions;
  v_prev integer;
begin
  perform hq_private.require_capability('knowledge.approve');
  if v_client is not null and not coalesce((select s.value = 'true'::jsonb from hq.settings s where s.key = 'knowledge_chat_approve_enabled'), false) then
    raise exception 'a knowledge document is approved in HQ, not through a connected app' using errcode = 'insufficient_privilege', hint = 'knowledge_approve_in_hq';
  end if;
  v_d := hq_private.knowledge_lock(p_document);
  select * into v_v from hq.knowledge_versions v where v.document_id = v_d.id and v.version = p_version for update;
  if not found then
    raise exception 'that version was not found' using errcode = 'no_data_found';
  end if;
  if v_v.status <> 'draft' or v_v.version <> v_d.current_version then
    raise exception 'only the latest draft can be approved; version % is %', v_v.version, v_v.status
      using errcode = 'check_violation', hint = 'knowledge_not_latest_draft';
  end if;
  if v_d.is_template then
    raise exception 'this is a starter template: replace its text with your own before approving it'
      using errcode = 'check_violation', hint = 'knowledge_template';
  end if;
  if exists (select 1 from hq.knowledge_documents x
             where x.deleted_at is null and x.id <> v_d.id and x.name_key = hq_private.normalise_name(v_v.title)) then
    raise exception 'another document already has that title' using errcode = 'check_violation', hint = 'knowledge_title_taken';
  end if;

  v_prev := v_d.approved_version;
  update hq.knowledge_versions set status = 'superseded' where document_id = v_d.id and status = 'approved';
  update hq.knowledge_versions set status = 'approved', approved_by = v_caller,
    approved_by_name = (select sp.full_name from hq.staff_profiles sp where sp.id = v_caller),
    approved_at = now(), approved_via = case when v_client is null then 'hq' else 'mcp' end
  where id = v_v.id;
  perform hq_private.audit_context('approve', 'Version ' || v_v.version || case when v_client is null then '' else ' (through a connected app)' end);
  update hq.knowledge_documents d set approved_version = v_v.version, title = v_v.title, summary = v_v.summary
  where d.id = v_d.id
  returning * into v_d;
  perform hq_private.audit_context();
  return hq_private.knowledge_json(v_d) || jsonb_build_object('version', v_v.version, 'previous_approved_version', v_prev,
    'approved_via', case when v_client is null then 'hq' else 'mcp' end, 'changed', true);
end $$;
comment on function hq.approve_knowledge_version(uuid, integer) is 'knowledge.approve. Approves the latest draft (p_version must be current_version and a draft; else 23514 knowledge_not_latest_draft): it becomes the approved version, the previous approved version becomes superseded, the document takes its title and summary. Refused from a connected app (client_id claim) unless the setting knowledge_chat_approve_enabled is true (42501 knowledge_approve_in_hq); refused for an unwritten starter template (knowledge_template). Audited (action approve).';

-- ------------------------------------------------------------------ discard_knowledge_draft
create function hq.discard_knowledge_draft(p_document uuid, p_version integer, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_caller uuid := hq_private.require_staff();
  v_approver boolean := hq_private.has_capability('knowledge.approve');
  v_d hq.knowledge_documents;
  v_v hq.knowledge_versions;
  v_reason text := hq_private.knowledge_line(p_reason, 300, 'the reason');
begin
  if not v_approver then
    perform hq_private.require_capability('knowledge.write');
  end if;
  v_d := hq_private.knowledge_lock(p_document);
  select * into v_v from hq.knowledge_versions v where v.document_id = v_d.id and v.version = p_version for update;
  if not found then
    raise exception 'that version was not found' using errcode = 'no_data_found';
  end if;
  if v_v.status <> 'draft' or v_v.version <> v_d.current_version then
    raise exception 'only the latest draft can be discarded; version % is %', v_v.version, v_v.status
      using errcode = 'check_violation', hint = 'knowledge_not_latest_draft';
  end if;
  if v_d.approved_version is null then
    raise exception 'this document has never been approved, so there is nothing to go back to: edit it, or archive it'
      using errcode = 'check_violation', hint = 'knowledge_discard_first_draft';
  end if;
  if v_v.edited_by is distinct from v_caller and not v_approver then
    raise exception 'only the person who wrote this draft, or an approver, can discard it'
      using errcode = 'insufficient_privilege', hint = 'knowledge_not_yours';
  end if;

  update hq.knowledge_versions set status = 'discarded', discarded_by = v_caller, discarded_at = now() where id = v_v.id;
  perform hq_private.audit_context('discard_draft', coalesce('Version ' || v_v.version || ': ' || v_reason, 'Version ' || v_v.version));
  update hq.knowledge_documents d set current_version = d.approved_version where d.id = v_d.id returning * into v_d;
  perform hq_private.audit_context();
  return hq_private.knowledge_json(v_d) || jsonb_build_object('version', v_v.version, 'changed', true);
end $$;
comment on function hq.discard_knowledge_draft(uuid, integer, text) is 'knowledge.write (own draft) or knowledge.approve (any). Discards the latest draft of an approved document (kept as discarded, never deleted); the document goes back to its approved version. Refused for a never-approved document (knowledge_discard_first_draft: edit or archive it). Audited (action discard_draft).';

-- ------------------------------------------------------------------ set_knowledge_review (owner, review date, category)
-- Who owns the document, when it should next be reviewed, and its category: filing details, not the
-- approved words, so they change directly (audited) without a new version.
create function hq.set_knowledge_review(
  p_document uuid,
  p_owner uuid default null,
  p_review_due date default null,
  p_clear_review boolean default false,
  p_category hq.knowledge_category default null,
  p_change_note text default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_d hq.knowledge_documents;
  v_owner uuid;
  v_review date;
  v_category hq.knowledge_category;
  v_fields text[] := '{}';
  v_note text := hq_private.knowledge_line(p_change_note, 300, 'a change note');
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('knowledge.write');
  v_d := hq_private.knowledge_lock(p_document);
  v_owner := coalesce(p_owner, v_d.owner_id);
  v_review := case when coalesce(p_clear_review, false) then null else coalesce(p_review_due, v_d.review_due) end;
  v_category := coalesce(p_category, v_d.category);
  if v_owner is distinct from v_d.owner_id then
    perform hq_private.require_active_staff(v_owner, 'the owner');
    v_fields := v_fields || 'owner'::text;
  end if;
  if v_review is distinct from v_d.review_due then
    perform hq_private.knowledge_review_check(v_review);
    v_fields := v_fields || 'review_due'::text;
  end if;
  if v_category is distinct from v_d.category then v_fields := v_fields || 'category'::text; end if;
  if cardinality(v_fields) = 0 then
    return hq_private.knowledge_json(v_d) || jsonb_build_object('changed', false, 'changed_fields', '[]'::jsonb);
  end if;
  perform hq_private.audit_context(null, left(v_note, 200));
  update hq.knowledge_documents d set owner_id = v_owner, review_due = v_review, category = v_category
  where d.id = v_d.id
  returning * into v_d;
  perform hq_private.audit_context();
  return hq_private.knowledge_json(v_d) || jsonb_build_object('changed', true, 'changed_fields', to_jsonb(v_fields));
end $$;
comment on function hq.set_knowledge_review(uuid, uuid, date, boolean, hq.knowledge_category, text) is 'knowledge.write. Changes the owner (active staff), the review date (today to five years ahead; p_clear_review removes it) and the category of a live document, directly (filing details, not the approved words). An optional change note (up to 300) goes into the audit row. Nothing to change: {changed: false}. Audited (action update).';

-- ------------------------------------------------------------------ restore_knowledge_version (as a new draft)
create function hq.restore_knowledge_version(p_document uuid, p_version integer, p_base_version integer, p_change_note text default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_d hq.knowledge_documents;
  v_src hq.knowledge_versions;
  v_cur hq.knowledge_versions;
  v_note text;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('knowledge.write');
  v_note := coalesce(hq_private.knowledge_line(p_change_note, 300, 'a change note'), 'Restored from version ' || p_version);
  v_d := hq_private.knowledge_lock(p_document);
  if p_base_version is null or p_base_version <> v_d.current_version then
    raise exception 'this document was changed by someone else since you opened it; reload it and try again'
      using errcode = 'check_violation', hint = 'knowledge_stale';
  end if;
  select * into v_src from hq.knowledge_versions v where v.document_id = v_d.id and v.version = p_version;
  if not found then
    raise exception 'that version was not found' using errcode = 'no_data_found';
  end if;
  select * into v_cur from hq.knowledge_versions v where v.document_id = v_d.id and v.version = v_d.current_version;
  if (v_src.title, v_src.summary, v_src.body) is not distinct from (v_cur.title, v_cur.summary, v_cur.body) then
    raise exception 'nothing changed: version % has the same text as the current version %', v_src.version, v_cur.version
      using errcode = 'invalid_parameter_value', hint = 'knowledge_no_change';
  end if;
  v_d := hq_private.knowledge_save_draft(v_d, v_src.title, v_src.summary, v_src.body, v_note, 'restore_version');
  return hq_private.knowledge_json(v_d) || jsonb_build_object('version', v_d.current_version, 'restored_from', v_src.version, 'changed', true);
end $$;
comment on function hq.restore_knowledge_version(uuid, integer, integer, text) is 'knowledge.write. Copies an older version into a NEW draft (the next version; nothing approved changes until someone approves it). p_base_version as in edit_knowledge_document. Same text as the current version: refused (knowledge_no_change). Audited (action restore_version).';

-- ------------------------------------------------------------------ archive_record / restore_record (0130 extended with 'knowledge_document')
create or replace function hq.archive_record(p_entity text, p_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_table text;
  v_caller uuid := hq_private.require_staff();
  v_deleted timestamptz;
  v_allowed boolean;
  v_needs text;
  v_ref hq.referrals;
  v_n integer;
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 200);
begin
  v_table := case p_entity
    when 'organisation' then 'organisations' when 'contact' then 'contacts' when 'referral' then 'referrals'
    when 'task' then 'tasks' when 'opportunity' then 'opportunities' when 'interaction' then 'interactions'
    when 'contractor' then 'contractors' when 'contractor_document' then 'contractor_documents'
    when 'contractor_review' then 'contractor_reviews' when 'decision' then 'decisions'
    when 'managed_property' then 'managed_properties' when 'knowledge_document' then 'knowledge_documents' end;
  if v_table is null then
    raise exception 'unknown entity %; expected organisation, contact, referral, task, opportunity, interaction, contractor, contractor_document, contractor_review, decision, managed_property or knowledge_document', p_entity
      using errcode = 'invalid_parameter_value';
  end if;
  if p_entity = 'contractor' then
    v_needs := 'contractors.approve';
    v_allowed := hq_private.has_capability('contractors.approve');
  elsif p_entity = 'contractor_document' then
    v_needs := 'contractors.documents';
    v_allowed := hq_private.has_capability('contractors.documents');
  elsif p_entity = 'contractor_review' then
    v_needs := 'contractors.approve';
    v_allowed := hq_private.has_capability('contractors.approve')
      or (hq_private.has_capability('contractors.write')
          and exists (select 1 from hq.contractor_reviews r where r.id = p_id and r.recorded_by = v_caller));
  elsif p_entity = 'decision' then
    v_needs := 'decisions.write';
    v_allowed := hq_private.has_capability('decisions.write');
  elsif p_entity = 'managed_property' then
    v_needs := 'portfolio.write';
    v_allowed := hq_private.has_capability('portfolio.write');
  elsif p_entity = 'knowledge_document' then
    v_needs := 'knowledge.approve';
    v_allowed := hq_private.has_capability('knowledge.approve');
  else
    v_needs := 'growth.delete';
    v_allowed := hq_private.has_capability('growth.delete');
    if not v_allowed and p_entity = 'task' and hq_private.has_capability('tasks.write') then
      v_allowed := exists (
        select 1 from hq.tasks t
        where t.id = p_id and (t.assigned_to = v_caller or t.created_by = v_caller or hq_private.has_capability('tasks.read_all')));
    end if;
  end if;
  if not v_allowed then
    raise exception 'permission denied' using errcode = 'insufficient_privilege', detail = 'requires ' || v_needs;
  end if;

  execute format('select deleted_at from hq.%I where id = $1 for update', v_table) into v_deleted using p_id;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception '% not found', p_entity using errcode = 'no_data_found';
  end if;
  if v_deleted is not null then
    return jsonb_build_object('entity', p_entity, 'id', p_id, 'archived', true, 'changed', false);
  end if;

  if p_entity = 'referral' then
    select r.* into v_ref from hq.referrals r where r.id = p_id;
    if v_ref.is_attributed and exists (
      select 1 from hq.referrals r
      where r.opportunity_id = v_ref.opportunity_id and r.id <> v_ref.id and r.direction = 'received' and r.deleted_at is null
    ) then
      raise exception 'this referral is the attributed source; move attribution to another referral first' using errcode = 'check_violation';
    end if;
  end if;

  perform hq_private.audit_context(null, v_reason);
  execute format('update hq.%I set deleted_at = now() where id = $1', v_table) using p_id;
  perform hq_private.audit_context();
  if p_entity = 'decision' then
    perform hq_private.decision_history_write(p_id, 'archive', 'Archived', '{}'::jsonb, v_reason);
  end if;
  return jsonb_build_object('entity', p_entity, 'id', p_id, 'archived', true, 'changed', true);
end $$;
comment on function hq.archive_record(text, uuid, text) is 'Soft-deletes organisation, contact, referral, task, opportunity, interaction (growth.delete; a task also by its assignee or creator holding tasks.write; an opportunity that is a live managed property is refused), contractor (contractors.approve), contractor_document (contractors.documents), contractor_review (contractors.approve, or its recorder with contractors.write), decision (decisions.write; refused while a live decision is superseded by it; recorded in its history), managed_property (portfolio.write), knowledge_document (knowledge.approve).';

create or replace function hq.restore_record(p_entity text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_table text;
  v_deleted timestamptz;
  v_n integer;
begin
  perform hq_private.require_staff();
  v_table := case p_entity
    when 'organisation' then 'organisations' when 'contact' then 'contacts' when 'referral' then 'referrals'
    when 'task' then 'tasks' when 'opportunity' then 'opportunities' when 'interaction' then 'interactions'
    when 'contractor' then 'contractors' when 'contractor_document' then 'contractor_documents'
    when 'contractor_review' then 'contractor_reviews' when 'decision' then 'decisions'
    when 'managed_property' then 'managed_properties' when 'knowledge_document' then 'knowledge_documents' end;
  if v_table is null then
    raise exception 'unknown entity %; expected organisation, contact, referral, task, opportunity, interaction, contractor, contractor_document, contractor_review, decision, managed_property or knowledge_document', p_entity
      using errcode = 'invalid_parameter_value';
  end if;
  perform hq_private.require_capability(case p_entity
    when 'contractor' then 'contractors.approve'
    when 'contractor_document' then 'contractors.documents'
    when 'contractor_review' then 'contractors.approve'
    when 'decision' then 'decisions.write'
    when 'managed_property' then 'portfolio.write'
    when 'knowledge_document' then 'knowledge.approve'
    else 'growth.delete' end);
  execute format('select deleted_at from hq.%I where id = $1 for update', v_table) into v_deleted using p_id;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception '% not found', p_entity using errcode = 'no_data_found';
  end if;
  if v_deleted is null then
    return jsonb_build_object('entity', p_entity, 'id', p_id, 'archived', false, 'changed', false);
  end if;

  perform hq_private.audit_context();
  if p_entity = 'referral' then
    -- take credit back only if the opportunity has no attributed referral now
    update hq.referrals r set
      deleted_at = null,
      is_attributed = (r.direction = 'received' and not exists (
        select 1 from hq.referrals o where o.opportunity_id = r.opportunity_id and o.id <> r.id and o.is_attributed and o.deleted_at is null))
    where r.id = p_id;
  else
    -- a unique name, email, ABN, primary contact, address, Ailo reference or knowledge title that was
    -- taken meanwhile fails the restore (23505); a decision superseded by an archived decision is
    -- refused (restore that one first); a managed property whose opportunity is no longer signed and
    -- live is refused (23514)
    execute format('update hq.%I set deleted_at = null where id = $1', v_table) using p_id;
  end if;
  if p_entity = 'decision' then
    perform hq_private.decision_history_write(p_id, 'restore', 'Restored');
  end if;
  return jsonb_build_object('entity', p_entity, 'id', p_id, 'archived', false, 'changed', true);
end $$;
comment on function hq.restore_record(text, uuid) is 'Restores a soft-deleted record: growth.delete for the Phase 1 entities, contractors.approve for contractor and contractor_review, contractors.documents for contractor_document, decisions.write for decision, portfolio.write for managed_property (refused when its opportunity is no longer signed and live), knowledge.approve for knowledge_document (refused when another live document took its title). A restored referral takes attribution back only when the opportunity has none.';

-- ------------------------------------------------------------------ starter templates (no invented content)
-- One draft per category, plus five for brand, voice and vision. Headings and placeholder prompts only:
-- every line in square brackets is a question for the owner to answer in her own words. They are
-- marked is_template, so they cannot be approved until someone has replaced the text, and they are not
-- counted as "waiting for approval". Created by the system (no owner yet); anyone with knowledge.write
-- can take one over, and anyone with knowledge.approve can archive the ones that are not wanted.
do $$
declare
  v_generic constant text := E'This is a starter template. Replace every line in square brackets with your own words, then save it. Nothing in it is a PLANTED. policy yet.\n\n'
    || E'## Purpose\n[Why this exists, in one or two sentences.]\n\n'
    || E'## Who this is for\n[Which roles use it, and when.]\n\n'
    || E'## Steps\n1. [First step]\n2. [Next step]\n3. [Add or remove steps as needed]\n\n'
    || E'## Checklist\n- [ ] [Something to confirm before finishing]\n- [ ] [Another check]\n\n'
    || E'## Owner\n[The person who keeps this up to date.]\n\n'
    || E'## Review date\n[When this should next be checked.]';
  v_intro constant text := E'This is a starter template. Replace every line in square brackets with your own words, then save it. Nothing in it is PLANTED.''s voice yet.\n\n';
  r record;
  v_id uuid;
begin
  for r in select * from (values
    (1,  '[Template] Company procedure (replace me)', 'company_procedure'::hq.knowledge_category, 'How to write a company procedure.', v_generic),
    (2,  '[Template] Contractor vetting procedure (replace me)', 'contractor_vetting'::hq.knowledge_category, 'How to write a contractor vetting procedure.', v_generic),
    (3,  '[Template] Referral partner procedure (replace me)', 'referral_partner'::hq.knowledge_category, 'How to write a referral partner procedure.', v_generic),
    (4,  '[Template] Landlord onboarding guidance (replace me)', 'landlord_onboarding'::hq.knowledge_category, 'How to write landlord onboarding guidance.', v_generic),
    (5,  '[Template] Staff policy (replace me)', 'staff_policy'::hq.knowledge_category, 'How to write a staff policy.', v_generic),
    (6,  '[Template] Operational checklist (replace me)', 'operational_checklist'::hq.knowledge_category, 'How to write an operational checklist.', v_generic),
    (7,  '[Template] General note (replace me)', 'general'::hq.knowledge_category, 'How to write a general knowledge note.', v_generic),
    (8,  '[Template] Voice and tone (replace me)', 'brand_voice'::hq.knowledge_category, 'How PLANTED. sounds: a template to fill in.',
         v_intro || E'## How we sound\n[Three to five words that describe our voice.]\n\n'
                 || E'## We are\n- [A quality of our voice, and what it looks like in a sentence]\n- [Another]\n\n'
                 || E'## We are not\n- [Something we never sound like]\n- [Another]\n\n'
                 || E'## Tone by situation\n- [A first conversation with a landlord: how we sound]\n- [A tenant problem: how we sound]\n- [A partner thank-you: how we sound]\n\n'
                 || E'## Before and after\n[An example sentence written the wrong way, then the same sentence in our voice.]'),
    (9,  '[Template] Vision, mission and values (replace me)', 'brand_voice'::hq.knowledge_category, 'Why PLANTED. exists and what it stands for: a template to fill in.',
         v_intro || E'## Vision\n[Where we want PLANTED. to be, in one or two sentences.]\n\n'
                 || E'## Mission\n[What we do every day to get there.]\n\n'
                 || E'## Values\n- [A value, and what it means in practice]\n- [Another value]\n- [Another value]\n\n'
                 || E'## What this means for a landlord\n[In plain words, what a landlord can expect from us because of these values.]'),
    (10, '[Template] Words we use and words we avoid (replace me)', 'brand_voice'::hq.knowledge_category, 'Our preferred words and the ones we avoid: a template to fill in.',
         v_intro || E'## Words we use\n- [A word or phrase we like, and why]\n- [Another]\n\n'
                 || E'## Words we avoid\n- [A word or phrase we do not use, and what we say instead]\n- [Another]\n\n'
                 || E'## How we write names, places and numbers\n[For example how we write the business name, suburbs, dates and prices.]'),
    (11, '[Template] How we write emails (replace me)', 'brand_voice'::hq.knowledge_category, 'How a PLANTED. email reads: a template to fill in.',
         v_intro || E'## Greeting\n[How we open an email, for example by first name.]\n\n'
                 || E'## Length and structure\n[How long an email should be, and the order things go in.]\n\n'
                 || E'## Closing line\n[How we end an email before the signature. HQ adds the signature and footer itself.]\n\n'
                 || E'## Things we never put in an email\n- [For example a promise we cannot keep]\n- [Another]\n\n'
                 || E'## Example\n[A short example email in our voice.]'),
    (12, '[Template] Our key messages (replace me)', 'brand_voice'::hq.knowledge_category, 'What we want people to remember about PLANTED.: a template to fill in.',
         v_intro || E'## Who we are in one sentence\n[One sentence anyone at PLANTED. could say.]\n\n'
                 || E'## What we offer\n[In plain words, what we do for a landlord.]\n\n'
                 || E'## What makes us different\n- [A difference we can stand behind]\n- [Another]\n\n'
                 || E'## What we never say or promise\n- [Something we do not claim]\n- [Another]')
  ) as t(n, title, category, summary, body) order by n loop
    insert into hq.knowledge_documents (title, category, summary, current_version, is_template)
    values (r.title, r.category, r.summary, 1, true)
    returning id into v_id;
    insert into hq.knowledge_versions (document_id, version, title, summary, body, edited_by_name, change_note)
    values (v_id, 1, r.title, r.summary, r.body, 'Planted HQ (starter template)', 'Starter template');
  end loop;
end $$;

revoke execute on all functions in schema hq_private from public, anon;
revoke execute on all functions in schema hq from public, anon;
