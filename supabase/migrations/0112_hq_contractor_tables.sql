-- 0112_hq_contractor_tables.sql
-- Planted HQ Phase 2 (docs/hq-phase-2.md, section 3): contractor enums, the ABN checksum and the
-- expiry-state rule, the five contractor tables, the two settings, and the Phase 1 table changes
-- (tasks.related_contractor_id, tasks.reminder_key, interactions.contractor_id with the subject check
-- widened, import_batches.kind and contractors_created).
--
-- Conventions as Phase 1 (0102): uuid ids, created_at / updated_at / created_by stamped by the
-- database, soft deletion through deleted_at / deleted_by with every unique index PARTIAL on
-- deleted_at is null, money in integer cents (AUD; unknown is null, never zero), dates in the
-- configured timezone through hq.today(). RLS and grants are stated in 0114.

-- ------------------------------------------------------------------ enums (section 3, exact)
create type hq.contractor_category as enum (
  'plumbing', 'electrical', 'general_maintenance', 'handyman', 'carpentry', 'cleaning', 'carpet_cleaning',
  'gardening', 'landscaping', 'pest_control', 'locksmith', 'painting', 'roofing', 'guttering',
  'air_conditioning', 'appliance_repairs', 'garage_doors', 'glazing', 'tree_services', 'building',
  'emergency_restoration', 'other');
create type hq.contractor_status as enum ('prospect', 'contacted', 'vetting', 'approved', 'preferred', 'suspended', 'inactive');
-- the nine vetting steps, in checklist order
create type hq.vetting_step as enum (
  'identity', 'abn', 'licence', 'insurance', 'service_areas', 'pricing', 'emergency_availability',
  'communication', 'review_and_approve');
create type hq.vetting_step_status as enum ('not_started', 'in_progress', 'done', 'not_applicable');
create type hq.contractor_document_type as enum (
  'licence', 'public_liability_insurance', 'workers_compensation', 'professional_indemnity',
  'abn_confirmation', 'price_list', 'agreement', 'other');
create type hq.document_verification as enum ('pending', 'verified', 'rejected');
create type hq.tenant_feedback as enum ('positive', 'neutral', 'negative', 'none_received');

-- ------------------------------------------------------------------ helpers (pure)
-- The ATO ABN rule: 11 digits, the first 1-9; subtract 1 from the first digit, weight the digits
-- 10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19, and the sum must divide by 89. A checksum only: it does not
-- prove the ABN is registered (no ABR lookup). Used by the contractors CHECK constraint, so the writer
-- needs execute on it (granted to authenticated in 0118, like normalise_name).
create function hq_private.abn_is_valid(p_abn text) returns boolean
language sql immutable parallel safe strict set search_path = pg_catalog as $$
  select case when p_abn ~ '^[1-9][0-9]{10}$' then (
      (substr(p_abn, 1, 1)::integer - 1) * 10
    + substr(p_abn, 2, 1)::integer * 1
    + substr(p_abn, 3, 1)::integer * 3
    + substr(p_abn, 4, 1)::integer * 5
    + substr(p_abn, 5, 1)::integer * 7
    + substr(p_abn, 6, 1)::integer * 9
    + substr(p_abn, 7, 1)::integer * 11
    + substr(p_abn, 8, 1)::integer * 13
    + substr(p_abn, 9, 1)::integer * 15
    + substr(p_abn, 10, 1)::integer * 17
    + substr(p_abn, 11, 1)::integer * 19) % 89 = 0
  else false end
$$;
comment on function hq_private.abn_is_valid(text) is 'ATO modulus-89 ABN checksum on 11 digits (no spaces). Checksum only, not an ABR lookup.';

-- The ONE expiry rule for a licence, an insurance and a document (section 4). days = expires_on - today.
--   no expiry date      'not_recorded' when nothing at all is recorded, else 'unverified' (never current)
--   days < 0            'expired'        (valid THROUGH the expiry date: on the day itself it is not expired)
--   0 <= days <= W      'expiring_soon'  (W = settings.contractor_expiry_warning_days; inclusive both ends)
--   days > W            'current' when verified, else 'unverified'
-- Expired and expiring_soon do not depend on verification: a recorded date in the past is always a flag.
create function hq_private.expiry_state(
  p_expires_on date, p_verified boolean, p_recorded boolean, p_today date, p_warning_days integer
) returns text
language sql immutable parallel safe set search_path = pg_catalog as $$
  select case
    when p_expires_on is null then
      case when coalesce(p_recorded, false) or coalesce(p_verified, false) then 'unverified' else 'not_recorded' end
    when p_expires_on < p_today then 'expired'
    when p_expires_on <= p_today + coalesce(p_warning_days, 30) then 'expiring_soon'
    when coalesce(p_verified, false) then 'current'
    else 'unverified'
  end
$$;
comment on function hq_private.expiry_state(date, boolean, boolean, date, integer) is 'not_recorded | unverified | current | expiring_soon | expired. Expired when expires_on < today; expiring_soon when today <= expires_on <= today + warning days; current only when verified and beyond the window.';

-- ------------------------------------------------------------------ contractors
create table hq.contractors (
  id uuid primary key default gen_random_uuid(),
  business_name text not null,
  name_key text generated always as (hq_private.normalise_name(business_name)) stored,
  primary_contact_name text,
  phone text,
  email extensions.citext,
  website text,
  abn text,
  categories hq.contractor_category[] not null,
  service_suburbs text[] not null default '{}',
  service_regions text[] not null default '{}',
  emergency_available boolean,
  business_hours text,
  hourly_rate_cents bigint,
  callout_fee_cents bigint,
  after_hours_fee_cents bigint,
  minimum_charge_cents bigint,
  invoice_terms text,
  licence_details text,
  licence_verified_at date,
  licence_expires_on date,
  insurance_details text,
  insurance_verified_at date,
  insurance_expires_on date,
  status hq.contractor_status not null default 'prospect',
  status_reason text,
  approved_at timestamptz,
  approved_by uuid,
  relationship_owner_id uuid references hq.staff_profiles (id),
  internal_notes text,
  last_job_date date,
  source text,
  needs_verification boolean not null default false,
  verified_at timestamptz,
  verified_by uuid,
  external_ids jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  deleted_at timestamptz,
  deleted_by uuid,
  constraint contractors_business_name_not_blank check (btrim(business_name) <> '' and name_key <> ''),
  constraint contractors_categories_not_empty check (cardinality(categories) >= 1),
  constraint contractors_email_shape check (email is null or email::text ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  constraint contractors_abn_valid check (abn is null or hq_private.abn_is_valid(abn)),
  constraint contractors_rates_not_negative check (
    coalesce(hourly_rate_cents, 0) >= 0 and coalesce(callout_fee_cents, 0) >= 0
    and coalesce(after_hours_fee_cents, 0) >= 0 and coalesce(minimum_charge_cents, 0) >= 0),
  -- approved_at / approved_by are set by hq.approve_contractor and exist exactly while the contractor is cleared
  constraint contractors_approval_iff_cleared check (
    (status in ('approved', 'preferred')) = (approved_at is not null and approved_by is not null)
    and (approved_at is null) = (approved_by is null)),
  constraint contractors_suspended_needs_reason check (status <> 'suspended' or (status_reason is not null and btrim(status_reason) <> '')),
  constraint contractors_deleted_by_needs_deleted_at check (deleted_by is null or deleted_at is not null)
);
comment on table hq.contractors is 'Maintenance contractors: who they are, what they cover, whether they are cleared (approved / preferred, set only by hq.approve_contractor), and their paperwork dates. No stored rating (see contractor_directory).';
comment on column hq.contractors.abn is '11 digits, no spaces (spaces are stripped on write), ATO checksum-validated.';
comment on column hq.contractors.emergency_available is 'null means unknown, never false by default.';
comment on column hq.contractors.licence_verified_at is 'Set only by hq.verify_contractor_document (apply_to_contractor). Cleared when licence_expires_on is edited directly.';
comment on column hq.contractors.insurance_verified_at is 'Set only by hq.verify_contractor_document (apply_to_contractor). Cleared when insurance_expires_on is edited directly.';
comment on column hq.contractors.external_ids is 'Reserved for a later integration (Ailo). Not writable by the API.';
create unique index contractors_name_key_uq on hq.contractors (name_key) where deleted_at is null;
create unique index contractors_abn_uq on hq.contractors (abn) where deleted_at is null and abn is not null;
create index contractors_business_name_trgm_idx on hq.contractors using gin (business_name extensions.gin_trgm_ops);
create index contractors_categories_idx on hq.contractors using gin (categories);
create index contractors_service_suburbs_idx on hq.contractors using gin (service_suburbs);
create index contractors_status_idx on hq.contractors (status);
create index contractors_relationship_owner_id_idx on hq.contractors (relationship_owner_id);

-- ------------------------------------------------------------------ vetting steps (nine per contractor, created by trigger)
create table hq.contractor_vetting_steps (
  contractor_id uuid not null references hq.contractors (id),
  step hq.vetting_step not null,
  status hq.vetting_step_status not null default 'not_started',
  note text,
  completed_by uuid,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (contractor_id, step),
  constraint contractor_vetting_steps_completed_iff_status check ((status in ('done', 'not_applicable')) = (completed_at is not null)),
  constraint contractor_vetting_steps_not_applicable_needs_note check (status <> 'not_applicable' or (note is not null and btrim(note) <> ''))
);
comment on table hq.contractor_vetting_steps is 'The nine-step checklist, one row per step, created when the contractor is created. Written through hq.set_vetting_step; review_and_approve only by hq.approve_contractor.';

-- ------------------------------------------------------------------ documents (files live in the private bucket contractor-documents)
create table hq.contractor_documents (
  id uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references hq.contractors (id),
  document_type hq.contractor_document_type not null,
  file_name text not null,
  storage_path text not null,
  mime_type text not null,
  size_bytes bigint not null,
  uploaded_by uuid default auth.uid(),
  uploaded_at timestamptz not null default now(),
  verification hq.document_verification not null default 'pending',
  verified_by uuid,
  verified_at timestamptz,
  verification_note text,
  expires_on date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  deleted_at timestamptz,
  deleted_by uuid,
  constraint contractor_documents_storage_path_key unique (storage_path),
  constraint contractor_documents_file_name_not_blank check (btrim(file_name) <> '' and char_length(file_name) <= 255),
  constraint contractor_documents_mime_allowed check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  constraint contractor_documents_size_allowed check (size_bytes > 0 and size_bytes <= 10485760),
  -- <contractor_id>/<document id>-<sanitised file name>: the object belongs to this contractor and this row
  constraint contractor_documents_path_shape check (
    storage_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9._-]{1,120}$'
    and split_part(storage_path, '/', 1) = contractor_id::text
    and left(split_part(storage_path, '/', 2), 36) = id::text),
  -- reviewed (verified or rejected) iff stamped; a rejection says why
  constraint contractor_documents_reviewed_iff_stamped check ((verification = 'pending') = (verified_at is null)),
  constraint contractor_documents_rejected_needs_note check (verification <> 'rejected' or (verification_note is not null and btrim(verification_note) <> '')),
  constraint contractor_documents_deleted_by_needs_deleted_at check (deleted_by is null or deleted_at is not null)
);
comment on table hq.contractor_documents is 'Licences, insurance and other paperwork. Registered by hq.add_contractor_document after a direct upload to the private bucket; verified only by hq.verify_contractor_document. Archiving soft-deletes the row; the stored object is retained. Not scanned for malware.';
create index contractor_documents_contractor_id_idx on hq.contractor_documents (contractor_id, uploaded_at desc);
create index contractor_documents_expires_on_idx on hq.contractor_documents (expires_on) where deleted_at is null;

-- ------------------------------------------------------------------ reviews (job feedback)
create table hq.contractor_reviews (
  id uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references hq.contractors (id),
  job_date date,
  job_reference text,
  response_time smallint,
  communication smallint,
  work_quality smallint,
  invoice_accuracy smallint,
  tenant_feedback hq.tenant_feedback,
  rework_required boolean,
  notes text,
  recorded_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  deleted_at timestamptz,
  deleted_by uuid,
  constraint contractor_reviews_ratings_range check (
    (response_time is null or response_time between 1 and 5) and (communication is null or communication between 1 and 5)
    and (work_quality is null or work_quality between 1 and 5) and (invoice_accuracy is null or invoice_accuracy between 1 and 5)),
  constraint contractor_reviews_has_content check (
    response_time is not null or communication is not null or work_quality is not null or invoice_accuracy is not null
    or (notes is not null and btrim(notes) <> '')),
  constraint contractor_reviews_deleted_by_needs_deleted_at check (deleted_by is null or deleted_at is not null)
);
comment on table hq.contractor_reviews is 'Feedback on one job. Each rating (1 to 5) is optional; at least one rating or a note. job_reference is free text typed by staff (HQ never reads Ailo).';
create index contractor_reviews_contractor_id_idx on hq.contractor_reviews (contractor_id, created_at desc);

-- ------------------------------------------------------------------ status history (append-only, written by trigger)
create table hq.contractor_status_history (
  id bigint generated always as identity primary key,
  contractor_id uuid not null references hq.contractors (id),
  from_status hq.contractor_status,
  to_status hq.contractor_status not null,
  changed_by uuid,
  changed_at timestamptz not null default now(),
  note text
);
comment on table hq.contractor_status_history is 'Append-only. Written by trigger when a contractor is created or its status changes (mirrors opportunity_stage_history).';
create index contractor_status_history_contractor_id_idx on hq.contractor_status_history (contractor_id, changed_at);

-- ------------------------------------------------------------------ settings
insert into hq.settings (key, value) values
  ('contractor_min_reviews_for_rating', '3'::jsonb),
  ('contractor_expiry_warning_days', '30'::jsonb)
on conflict (key) do nothing;

-- ------------------------------------------------------------------ Phase 1 tables
-- tasks: the related contractor, and the reminder key that makes create_expiry_tasks idempotent (one
-- OPEN task per contractor expiry item). reminder_key is written only by hq.create_expiry_tasks.
alter table hq.tasks add column related_contractor_id uuid references hq.contractors (id);
alter table hq.tasks add column reminder_key text;
alter table hq.tasks add constraint tasks_reminder_key_shape check (
  reminder_key is null
  or reminder_key ~ '^contractor-expiry:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(licence|insurance|document:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$');
create index tasks_related_contractor_id_idx on hq.tasks (related_contractor_id);
create unique index tasks_reminder_key_open_uq on hq.tasks (reminder_key)
  where reminder_key is not null and deleted_at is null and status not in ('completed', 'cancelled');
comment on column hq.tasks.reminder_key is 'Set only by hq.create_expiry_tasks: contractor-expiry:<contractor id>:licence|insurance|document:<document id>. At most one open task per key.';

-- interactions: a logged contact with a contractor. A contractor interaction names only the contractor.
alter table hq.interactions add column contractor_id uuid references hq.contractors (id);
alter table hq.interactions drop constraint interactions_needs_contact_or_organisation;
alter table hq.interactions add constraint interactions_needs_subject check (contact_id is not null or organisation_id is not null or contractor_id is not null);
alter table hq.interactions add constraint interactions_contractor_alone check (contractor_id is null or (contact_id is null and organisation_id is null));
create index interactions_contractor_id_idx on hq.interactions (contractor_id, occurred_at desc);
comment on table hq.interactions is 'Calls, meetings, emails and notes with a contact or organisation (hq.record_interaction) or with a contractor (hq.record_contractor_contact).';

-- import_batches: which import, and how many contractors it created.
alter table hq.import_batches add column kind text not null default 'partner';
alter table hq.import_batches add column contractors_created integer not null default 0;
alter table hq.import_batches add constraint import_batches_kind_known check (kind in ('partner', 'contractor'));
comment on table hq.import_batches is 'One row per applied import: kind partner (hq.apply_partner_import) or contractor (hq.apply_contractor_import).';

revoke execute on all functions in schema hq_private from public, anon;
