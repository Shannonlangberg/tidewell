-- 0102_hq_tables_growth.sql
-- Growth, referral, task, audit and import tables (section 4). Conventions: uuid ids, created_at /
-- updated_at, created_by defaulting to the caller (stamped by the 0104 triggers), soft deletion through
-- deleted_at / deleted_by with every unique index PARTIAL on deleted_at is null, money in integer
-- cents (AUD).

create table hq.organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_key text generated always as (hq_private.normalise_name(name)) stored,
  categories hq.partner_category[] not null,
  website text,
  phone text,
  email extensions.citext,
  location text,
  service_region text,
  relationship_owner_id uuid references hq.staff_profiles (id),
  notes text,
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
  constraint organisations_name_not_blank check (btrim(name) <> '' and name_key <> ''),
  constraint organisations_categories_not_empty check (cardinality(categories) >= 1),
  constraint organisations_email_shape check (email is null or email::text ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  constraint organisations_deleted_by_needs_deleted_at check (deleted_by is null or deleted_at is not null)
);
comment on table hq.organisations is 'Partner organisations (agencies, brokers, conveyancers, ...). name_key makes a second spelling of the same name collide.';
create unique index organisations_name_key_uq on hq.organisations (name_key) where deleted_at is null;
create index organisations_name_trgm_idx on hq.organisations using gin (name extensions.gin_trgm_ops);
create index organisations_relationship_owner_id_idx on hq.organisations (relationship_owner_id);
create index organisations_categories_idx on hq.organisations using gin (categories);

create table hq.contacts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references hq.organisations (id),
  full_name text not null,
  name_key text generated always as (hq_private.normalise_name(full_name)) stored,
  position text,
  categories hq.partner_category[] not null default '{}',
  phone text,
  email extensions.citext,
  website text,
  location text,
  service_region text,
  org_contact_role hq.org_contact_role not null default 'secondary',
  relationship_owner_id uuid references hq.staff_profiles (id),
  relationship_status hq.relationship_status not null default 'identified',
  priority hq.priority_level not null default 'medium',
  last_contact_at timestamptz,
  next_follow_up_date date,
  notes text,
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
  constraint contacts_name_not_blank check (btrim(full_name) <> '' and name_key <> ''),
  constraint contacts_email_shape check (email is null or email::text ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  constraint contacts_deleted_by_needs_deleted_at check (deleted_by is null or deleted_at is not null)
);
comment on table hq.contacts is 'People at partner organisations (organisation_id is null for independents).';
create unique index contacts_org_name_key_uq on hq.contacts (organisation_id, name_key) where deleted_at is null and organisation_id is not null;
create unique index contacts_email_uq on hq.contacts (email) where deleted_at is null and email is not null;
create unique index contacts_one_primary_uq on hq.contacts (organisation_id) where deleted_at is null and org_contact_role = 'primary' and organisation_id is not null;
create index contacts_full_name_trgm_idx on hq.contacts using gin (full_name extensions.gin_trgm_ops);
create index contacts_organisation_id_idx on hq.contacts (organisation_id);
create index contacts_relationship_owner_id_idx on hq.contacts (relationship_owner_id);
create index contacts_next_follow_up_date_idx on hq.contacts (next_follow_up_date);
create index contacts_last_contact_at_idx on hq.contacts (last_contact_at);
create index contacts_relationship_status_idx on hq.contacts (relationship_status);

-- The prospective management. The pipeline stage lives here, not on the referral (design D7).
create table hq.opportunities (
  id uuid primary key default gen_random_uuid(),
  display_number bigint generated always as identity,
  prospect_name text not null,
  prospect_phone text,
  prospect_email extensions.citext,
  property_suburb text,
  property_address text,
  stage hq.opportunity_stage not null default 'introduction_received',
  stage_changed_at timestamptz not null default now(),
  estimated_annual_value_cents bigint,
  assigned_to uuid references hq.staff_profiles (id),
  signed_at timestamptz,
  management_reference text,
  lost_reason text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  deleted_at timestamptz,
  deleted_by uuid,
  constraint opportunities_prospect_not_blank check (btrim(prospect_name) <> ''),
  constraint opportunities_value_not_negative check (estimated_annual_value_cents is null or estimated_annual_value_cents >= 0),
  constraint opportunities_signed_iff_stage check ((stage = 'management_signed') = (signed_at is not null)),
  constraint opportunities_lost_reason_only_when_lost check (lost_reason is null or stage = 'lost'),
  constraint opportunities_lost_needs_reason check (stage <> 'lost' or (lost_reason is not null and btrim(lost_reason) <> '')),
  constraint opportunities_reference_not_blank check (management_reference is null or btrim(management_reference) <> ''),
  constraint opportunities_deleted_by_needs_deleted_at check (deleted_by is null or deleted_at is not null)
);
comment on table hq.opportunities is 'A prospective property management. A signed management is a property of the opportunity, so it is counted once (design D7).';
create unique index opportunities_display_number_uq on hq.opportunities (display_number);
create unique index opportunities_management_reference_uq on hq.opportunities (management_reference) where management_reference is not null and deleted_at is null;
create index opportunities_stage_idx on hq.opportunities (stage);
create index opportunities_assigned_to_idx on hq.opportunities (assigned_to);
create index opportunities_prospect_name_trgm_idx on hq.opportunities using gin (prospect_name extensions.gin_trgm_ops);

create table hq.opportunity_stage_history (
  id bigint generated always as identity primary key,
  opportunity_id uuid not null references hq.opportunities (id),
  from_stage hq.opportunity_stage,
  to_stage hq.opportunity_stage not null,
  changed_by uuid,
  changed_at timestamptz not null default now(),
  note text
);
comment on table hq.opportunity_stage_history is 'Append-only. Written by trigger when an opportunity is created or its stage changes.';
create index opportunity_stage_history_opportunity_id_idx on hq.opportunity_stage_history (opportunity_id, changed_at);
create index opportunity_stage_history_to_stage_idx on hq.opportunity_stage_history (to_stage);

create table hq.referrals (
  id uuid primary key default gen_random_uuid(),
  ref_number bigint generated always as identity,
  direction hq.referral_direction not null,
  referring_contact_id uuid references hq.contacts (id),
  referring_organisation_id uuid references hq.organisations (id),
  receiving_contact_id uuid references hq.contacts (id),
  receiving_organisation_id uuid references hq.organisations (id),
  opportunity_id uuid references hq.opportunities (id),
  referral_date date not null,
  assigned_to uuid references hq.staff_profiles (id),
  is_attributed boolean not null default false,
  sent_outcome hq.sent_referral_outcome,
  prospect_name text,
  prospect_phone text,
  prospect_email extensions.citext,
  property_suburb text,
  property_address text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  deleted_at timestamptz,
  deleted_by uuid,
  constraint referrals_received_shape check (
    direction <> 'received'
    or (opportunity_id is not null and (referring_contact_id is not null or referring_organisation_id is not null))),
  constraint referrals_sent_shape check (
    direction <> 'sent'
    or (opportunity_id is null and not is_attributed
        and (receiving_contact_id is not null or receiving_organisation_id is not null))),
  constraint referrals_outcome_iff_sent check ((direction = 'sent') = (sent_outcome is not null)),
  constraint referrals_deleted_by_needs_deleted_at check (deleted_by is null or deleted_at is not null)
);
comment on table hq.referrals is 'An introduction: who introduced whom, when, in which direction. ref_number is shown as REF-0001. One opportunity may have several received referrals but exactly one attributed.';
create unique index referrals_ref_number_uq on hq.referrals (ref_number);
-- Exactly one attributed referral per opportunity: this index is the double-counting guarantee.
create unique index referrals_one_attributed_uq on hq.referrals (opportunity_id) where is_attributed and deleted_at is null;
create index referrals_referring_organisation_id_idx on hq.referrals (referring_organisation_id);
create index referrals_referring_contact_id_idx on hq.referrals (referring_contact_id);
create index referrals_receiving_organisation_id_idx on hq.referrals (receiving_organisation_id);
create index referrals_receiving_contact_id_idx on hq.referrals (receiving_contact_id);
create index referrals_opportunity_id_idx on hq.referrals (opportunity_id);
create index referrals_assigned_to_idx on hq.referrals (assigned_to);
create index referrals_referral_date_idx on hq.referrals (referral_date);

create table hq.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  assigned_to uuid references hq.staff_profiles (id),
  due_date date,
  priority hq.task_priority not null default 'normal',
  status hq.task_status not null default 'to_do',
  related_contact_id uuid references hq.contacts (id),
  related_organisation_id uuid references hq.organisations (id),
  related_referral_id uuid references hq.referrals (id),
  related_opportunity_id uuid references hq.opportunities (id),
  source text not null default 'manual',
  completed_at timestamptz,
  completed_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  deleted_at timestamptz,
  deleted_by uuid,
  constraint tasks_title_not_blank check (btrim(title) <> ''),
  constraint tasks_source_known check (source in ('manual', 'interaction', 'ai_draft')),
  constraint tasks_completed_iff_status check ((status = 'completed') = (completed_at is not null)),
  constraint tasks_deleted_by_needs_deleted_at check (deleted_by is null or deleted_at is not null)
);
comment on table hq.tasks is 'Work for staff. Visible to its assignee, its creator and anyone holding tasks.read_all. Phase 2 adds related_contractor_id.';
create index tasks_title_trgm_idx on hq.tasks using gin (title extensions.gin_trgm_ops);
create index tasks_assignee_status_due_idx on hq.tasks (assigned_to, status, due_date);
create index tasks_created_by_idx on hq.tasks (created_by);
create index tasks_related_contact_id_idx on hq.tasks (related_contact_id);
create index tasks_related_organisation_id_idx on hq.tasks (related_organisation_id);
create index tasks_related_referral_id_idx on hq.tasks (related_referral_id);
create index tasks_related_opportunity_id_idx on hq.tasks (related_opportunity_id);

create table hq.interactions (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references hq.contacts (id),
  organisation_id uuid references hq.organisations (id),
  interaction_type hq.interaction_type not null,
  occurred_at timestamptz not null default now(),
  summary text not null,
  staff_id uuid references hq.staff_profiles (id) default auth.uid(),
  next_action text,
  follow_up_date date,
  task_id uuid references hq.tasks (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  deleted_at timestamptz,
  deleted_by uuid,
  constraint interactions_needs_contact_or_organisation check (contact_id is not null or organisation_id is not null),
  constraint interactions_summary_not_blank check (btrim(summary) <> ''),
  constraint interactions_deleted_by_needs_deleted_at check (deleted_by is null or deleted_at is not null)
);
comment on table hq.interactions is 'Calls, meetings, emails and notes with a contact or organisation. Created through hq.record_interaction().';
create index interactions_contact_id_idx on hq.interactions (contact_id, occurred_at desc);
create index interactions_organisation_id_idx on hq.interactions (organisation_id, occurred_at desc);
create index interactions_staff_id_idx on hq.interactions (staff_id);
create index interactions_task_id_idx on hq.interactions (task_id);

create table hq.audit_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  actor_name text,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  summary text,
  changes jsonb not null default '{}'::jsonb
);
comment on table hq.audit_events is 'Append-only for every role (immutability trigger). actor_id is null for system actions. changes is a small diff and never carries a free-text body beyond a short excerpt.';
create index audit_events_at_idx on hq.audit_events (at desc);
create index audit_events_entity_idx on hq.audit_events (entity_type, entity_id, at desc);
create index audit_events_actor_id_idx on hq.audit_events (actor_id, at desc);

create table hq.import_batches (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  file_name text,
  row_count integer not null default 0,
  organisations_created integer not null default 0,
  contacts_created integer not null default 0,
  duplicates_skipped integer not null default 0,
  flagged integer not null default 0,
  applied_by uuid,
  applied_at timestamptz not null default now()
);
comment on table hq.import_batches is 'One row per applied partner import. Written only by hq.apply_partner_import().';
create index import_batches_applied_by_idx on hq.import_batches (applied_by);
create index import_batches_applied_at_idx on hq.import_batches (applied_at desc);
