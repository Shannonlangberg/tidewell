-- 0114_hq_contractor_access.sql
-- Phase 2 capabilities (docs/hq-phase-2.md, section 2), row level security and table privileges for the
-- contractor tables (same rules as 0106: RLS enabled AND forced, every policy `to authenticated` with a
-- hq_private predicate, helpers inside `(select ...)`), the widened interactions policies, and the
-- private storage bucket contractor-documents with its storage.objects policies (section 6).
--
-- Direct writes granted to authenticated (everything else is select only, written by RPC or trigger):
--   contractors           insert + update of a column whitelist (never status stamps, verified dates,
--                         approval, external_ids or deleted_at; status itself is policed by the 0113 guard)
--   contractor_documents  update (notes)
--   contractor_reviews    update of the review fields, by the person who recorded it (or contractors.approve)

-- ------------------------------------------------------------------ the matrix (section 2)
insert into hq.role_capabilities (role, capability)
select r.role::hq.staff_role, r.capability
from (values
  ('director', 'contractors.read'), ('director', 'contractors.write'), ('director', 'contractors.documents'), ('director', 'contractors.approve'),
  ('administrator', 'contractors.read'), ('administrator', 'contractors.write'), ('administrator', 'contractors.documents'), ('administrator', 'contractors.approve'),
  ('senior_property_manager', 'contractors.read'), ('senior_property_manager', 'contractors.write'), ('senior_property_manager', 'contractors.documents'),
  ('property_manager', 'contractors.read'), ('property_manager', 'contractors.write'), ('property_manager', 'contractors.documents'),
  ('junior_property_manager', 'contractors.read'),
  ('virtual_assistant', 'contractors.read'), ('virtual_assistant', 'contractors.write'), ('virtual_assistant', 'contractors.documents'),
  ('business_development_manager', 'contractors.read'),
  ('read_only', 'contractors.read')
) as r(role, capability)
on conflict do nothing;

-- ------------------------------------------------------------------ RLS
alter table hq.contractors enable row level security;                alter table hq.contractors force row level security;
alter table hq.contractor_vetting_steps enable row level security;   alter table hq.contractor_vetting_steps force row level security;
alter table hq.contractor_documents enable row level security;       alter table hq.contractor_documents force row level security;
alter table hq.contractor_reviews enable row level security;         alter table hq.contractor_reviews force row level security;
alter table hq.contractor_status_history enable row level security;  alter table hq.contractor_status_history force row level security;

-- Contractors: archived rows are visible only to contractors.approve holders (who archive and restore).
create policy contractors_select on hq.contractors for select to authenticated
  using ((select hq_private.has_capability('contractors.read'))
         and (deleted_at is null or (select hq_private.has_capability('contractors.approve'))));
create policy contractors_insert on hq.contractors for insert to authenticated
  with check ((select hq_private.has_capability('contractors.write')));
create policy contractors_update on hq.contractors for update to authenticated
  using ((select hq_private.has_capability('contractors.write')) and deleted_at is null)
  with check ((select hq_private.has_capability('contractors.write')));

-- Children of a contractor the caller can see (the exists runs under the contractors policy).
create policy contractor_vetting_steps_select on hq.contractor_vetting_steps for select to authenticated
  using ((select hq_private.has_capability('contractors.read'))
         and exists (select 1 from hq.contractors c where c.id = contractor_id));

create policy contractor_status_history_select on hq.contractor_status_history for select to authenticated
  using ((select hq_private.has_capability('contractors.read'))
         and exists (select 1 from hq.contractors c where c.id = contractor_id));

-- Documents: contractors.read sees that a document exists (type, expiry, verification); opening the
-- FILE needs contractors.documents (storage.objects policy below). Archived rows: contractors.documents.
create policy contractor_documents_select on hq.contractor_documents for select to authenticated
  using ((select hq_private.has_capability('contractors.read'))
         and (deleted_at is null or (select hq_private.has_capability('contractors.documents')))
         and exists (select 1 from hq.contractors c where c.id = contractor_id));
create policy contractor_documents_update on hq.contractor_documents for update to authenticated
  using ((select hq_private.has_capability('contractors.documents')) and deleted_at is null)
  with check ((select hq_private.has_capability('contractors.documents')));

create policy contractor_reviews_select on hq.contractor_reviews for select to authenticated
  using ((select hq_private.has_capability('contractors.read'))
         and (deleted_at is null or (select hq_private.has_capability('contractors.approve')))
         and exists (select 1 from hq.contractors c where c.id = contractor_id));
create policy contractor_reviews_update on hq.contractor_reviews for update to authenticated
  using ((select hq_private.has_capability('contractors.write')) and deleted_at is null
         and (recorded_by = (select auth.uid()) or (select hq_private.has_capability('contractors.approve'))))
  with check ((select hq_private.has_capability('contractors.write')));

-- Interactions (0106 widened): a contractor contact is read with contractors.read and edited with
-- contractors.write (its author, or a contractors.approve holder); partner interactions are unchanged.
drop policy interactions_select on hq.interactions;
drop policy interactions_update on hq.interactions;
create policy interactions_select on hq.interactions for select to authenticated
  using ((deleted_at is null or (select hq_private.has_capability('growth.delete')))
         and ((contractor_id is null and (select hq_private.has_capability('growth.read')))
              or (contractor_id is not null and (select hq_private.has_capability('contractors.read')))));
create policy interactions_update on hq.interactions for update to authenticated
  using ((deleted_at is null or (select hq_private.has_capability('growth.delete')))
         and ((contractor_id is null and (select hq_private.has_capability('growth.write'))
               and (staff_id = (select auth.uid()) or (select hq_private.has_capability('growth.delete'))))
              or (contractor_id is not null and (select hq_private.has_capability('contractors.write'))
               and (staff_id = (select auth.uid()) or (select hq_private.has_capability('contractors.approve'))))))
  with check ((contractor_id is null and (select hq_private.has_capability('growth.write')))
              or (contractor_id is not null and (select hq_private.has_capability('contractors.write'))));

-- ------------------------------------------------------------------ table privileges
revoke all on hq.contractors, hq.contractor_vetting_steps, hq.contractor_documents, hq.contractor_reviews, hq.contractor_status_history
  from public, anon, authenticated, service_role;

grant select on hq.contractors, hq.contractor_vetting_steps, hq.contractor_documents, hq.contractor_reviews, hq.contractor_status_history
  to authenticated, service_role;

grant insert (business_name, primary_contact_name, phone, email, website, abn, categories, service_suburbs, service_regions,
              emergency_available, business_hours, hourly_rate_cents, callout_fee_cents, after_hours_fee_cents, minimum_charge_cents,
              invoice_terms, licence_details, licence_expires_on, insurance_details, insurance_expires_on, status, status_reason,
              relationship_owner_id, internal_notes, last_job_date, source, needs_verification)
  on hq.contractors to authenticated;
grant update (business_name, primary_contact_name, phone, email, website, abn, categories, service_suburbs, service_regions,
              emergency_available, business_hours, hourly_rate_cents, callout_fee_cents, after_hours_fee_cents, minimum_charge_cents,
              invoice_terms, licence_details, licence_expires_on, insurance_details, insurance_expires_on, status, status_reason,
              relationship_owner_id, internal_notes, last_job_date, source, needs_verification)
  on hq.contractors to authenticated;
grant update (notes) on hq.contractor_documents to authenticated;
grant update (job_date, job_reference, response_time, communication, work_quality, invoice_accuracy, tenant_feedback, rework_required, notes)
  on hq.contractor_reviews to authenticated;

-- ------------------------------------------------------------------ storage: the private bucket (section 6)
-- Created here, not only in config.toml, so every project gets the same bucket. Private: no public
-- URL works; files are read through short-lived signed URLs created with the person's own session.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contractor-documents', 'contractor-documents', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Objects: staff holding contractors.documents may read and add files under
-- <contractor_id>/<document uuid>-<sanitised file name> for a contractor they can see (new files: a
-- live contractor). No update or delete policy exists, so nobody can overwrite or remove a file through
-- the API (no upsert); archiving a document is a soft delete of its row and the object is retained.
-- No policy for anon.
create policy hq_contractor_documents_select on storage.objects for select to authenticated
  using (
    bucket_id = 'contractor-documents'
    and (select hq_private.has_capability('contractors.documents'))
    and objects.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9._-]{1,120}$'
    and exists (select 1 from hq.contractors c where c.id::text = split_part(objects.name, '/', 1))
  );
create policy hq_contractor_documents_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'contractor-documents'
    and (select hq_private.has_capability('contractors.documents'))
    and objects.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9._-]{1,120}$'
    and exists (select 1 from hq.contractors c where c.id::text = split_part(objects.name, '/', 1) and c.deleted_at is null)
  );
