-- Planted HQ Phase 2: contractor structure and security posture. Tables, RLS, grants, function ACLs,
-- enums, columns, indexes, settings, the capability matrix (section 2), the private storage bucket and
-- its policies, the ABN checksum, the expiry-state rule on its boundary days, append-only history.
--
-- NOTE: never CALL a function a hint role (anon, authenticated, service_role) lacks execute on (the
-- local image's supautils permission hint segfaults). Execute privilege is read from pg_proc.
begin;
\ir hq_fixture.inc
\ir hq_contractor_fixture.inc
select pg_temp.seed_hq();
select pg_temp.seed_contractors();
select plan(166);

-- ------------------------------------------------------------ tables, RLS, policies
select has_table('hq', t, 'hq.' || t || ' exists')
from unnest(array['contractors', 'contractor_vetting_steps', 'contractor_documents', 'contractor_reviews', 'contractor_status_history']) t;
select is((select count(*) from pg_class c where c.relnamespace = 'hq'::regnamespace and c.relkind = 'r' and c.relname like 'contractor%'
            and c.relrowsecurity and c.relforcerowsecurity), 5::bigint, 'RLS is enabled and forced on the five contractor tables');
select is((select count(*) from pg_policies where schemaname = 'hq' and tablename like 'contractor%' and roles <> '{authenticated}'::name[]),
  0::bigint, 'every contractor policy is to authenticated only');
select is((select count(*) from pg_policies where schemaname = 'hq' and tablename like 'contractor%'
            and (coalesce(qual, '') || coalesce(with_check, '')) not like '%has_capability(''contractors.%'),
  0::bigint, 'every contractor policy asks the database for a contractors capability');
select policies_are('hq', 'contractors', array['contractors_select', 'contractors_insert', 'contractors_update'], 'contractors: select, insert, update policies (no delete)');
select policies_are('hq', 'contractor_vetting_steps', array['contractor_vetting_steps_select'], 'vetting steps: select only (written by RPC)');
select policies_are('hq', 'contractor_documents', array['contractor_documents_select', 'contractor_documents_update'], 'documents: select and update (notes) policies');
select policies_are('hq', 'contractor_reviews', array['contractor_reviews_select', 'contractor_reviews_update'], 'reviews: select and update policies');
select policies_are('hq', 'contractor_status_history', array['contractor_status_history_select'], 'status history: select only');
select ok((select qual from pg_policies where schemaname = 'hq' and tablename = 'interactions' and policyname = 'interactions_select') like '%contractors.read%',
  'interactions_select: a contractor contact is read with contractors.read');

-- ------------------------------------------------------------ table and column privileges
select table_privs_are('hq', 'contractor_vetting_steps', 'authenticated', array['SELECT'], 'vetting steps: authenticated can only select');
select table_privs_are('hq', 'contractor_status_history', 'authenticated', array['SELECT'], 'status history: authenticated can only select');
select table_privs_are('hq', t, 'service_role', array['SELECT'], t || ': service_role can only select')
from unnest(array['contractors', 'contractor_vetting_steps', 'contractor_documents', 'contractor_reviews', 'contractor_status_history']) t;
select is((select count(*) from unnest(array['contractors', 'contractor_vetting_steps', 'contractor_documents', 'contractor_reviews', 'contractor_status_history']) t
            where has_table_privilege('anon', 'hq.' || t, 'select,insert,update,delete,truncate')), 0::bigint, 'anon holds no privilege on any contractor table');
select is((select count(*) from unnest(array['contractor_vetting_steps', 'contractor_documents', 'contractor_reviews', 'contractor_status_history']) t
            where has_table_privilege('authenticated', 'hq.' || t, 'insert')), 0::bigint, 'authenticated cannot insert vetting steps, documents, reviews or history directly');
select is((select count(*) from unnest(array['contractors', 'contractor_vetting_steps', 'contractor_documents', 'contractor_reviews', 'contractor_status_history']) t
            where has_table_privilege('authenticated', 'hq.' || t, 'delete') or has_table_privilege('authenticated', 'hq.' || t, 'truncate')),
  0::bigint, 'authenticated cannot delete or truncate any contractor table');
select ok(not has_column_privilege('authenticated', 'hq.contractors', c, 'update'), 'contractors.' || c || ' cannot be updated directly')
from unnest(array['approved_at', 'approved_by', 'licence_verified_at', 'insurance_verified_at', 'verified_at', 'verified_by', 'external_ids', 'deleted_at', 'deleted_by', 'created_by', 'id']) c;
select ok(not has_column_privilege('authenticated', 'hq.contractors', c, 'insert'), 'contractors.' || c || ' cannot be set on insert')
from unnest(array['approved_at', 'approved_by', 'licence_verified_at', 'insurance_verified_at', 'external_ids', 'deleted_at']) c;
select ok(has_column_privilege('authenticated', 'hq.contractors', c, 'update'), 'contractors.' || c || ' can be updated directly (guarded)')
from unnest(array['business_name', 'status', 'status_reason', 'licence_expires_on', 'insurance_expires_on', 'service_suburbs', 'needs_verification']) c;
select ok(not has_column_privilege('authenticated', 'hq.contractor_documents', c, 'update'), 'contractor_documents.' || c || ' cannot be updated directly')
from unnest(array['verification', 'verified_by', 'verified_at', 'verification_note', 'expires_on', 'document_type', 'storage_path', 'deleted_at']) c;
select ok(has_column_privilege('authenticated', 'hq.contractor_documents', 'notes', 'update'), 'contractor_documents.notes can be updated directly');
select ok(not has_column_privilege('authenticated', 'hq.contractor_reviews', c, 'update'), 'contractor_reviews.' || c || ' cannot be updated directly')
from unnest(array['contractor_id', 'recorded_by', 'deleted_at']) c;
select ok(has_column_privilege('authenticated', 'hq.contractor_reviews', 'work_quality', 'update'), 'contractor_reviews ratings can be updated directly (by their recorder)');

-- ------------------------------------------------------------ views
select is((select count(*) from pg_class c where c.relnamespace = 'hq'::regnamespace and c.relkind = 'v'
            and c.relname in ('contractor_directory', 'contractor_expiry_watch', 'contractor_timeline') and c.reloptions @> array['security_invoker=true']),
  3::bigint, 'the three contractor views are security_invoker');
select ok(pg_get_viewdef(('hq.' || v)::regclass) not like '%audit_events%', v || ' does not read audit_events')
from unnest(array['contractor_directory', 'contractor_expiry_watch', 'contractor_timeline']) v;
select is((select count(*) from unnest(array['contractor_directory', 'contractor_expiry_watch', 'contractor_timeline']) v
            where has_table_privilege('authenticated', 'hq.' || v, 'select') and not has_table_privilege('anon', 'hq.' || v, 'select')),
  3::bigint, 'authenticated (not anon) can select the contractor views');

-- ------------------------------------------------------------ anon is DENIED, not empty
select pg_temp.become_anon();
select throws_ok(format('select 1 from hq.%I', t), '42501', null, 'anon is denied on hq.' || t)
from unnest(array['contractors', 'contractor_vetting_steps', 'contractor_documents', 'contractor_reviews', 'contractor_status_history',
                  'contractor_directory', 'contractor_expiry_watch', 'contractor_timeline']) t;
select throws_ok('select hq.contractor_summary()', '42501', null, 'anon cannot call contractor_summary');
select throws_ok('select hq.create_expiry_tasks()', '42501', null, 'anon cannot call create_expiry_tasks');
select pg_temp.unbecome();

-- ------------------------------------------------------------ function privileges (from pg_proc)
create temp table zz_rpcs (sig regprocedure primary key) on commit drop;
insert into zz_rpcs values
  ('hq.set_vetting_step(uuid, hq.vetting_step, hq.vetting_step_status, text)'),
  ('hq.preview_contractor_approval(uuid)'),
  ('hq.approve_contractor(uuid, boolean, text)'),
  ('hq.set_contractor_status(uuid, hq.contractor_status, text)'),
  ('hq.reinstate_contractor(uuid, text)'),
  ('hq.add_contractor_document(uuid, hq.contractor_document_type, text, text, text, bigint, date, text)'),
  ('hq.verify_contractor_document(uuid, hq.document_verification, date, text, boolean)'),
  ('hq.record_contractor_review(uuid, date, text, integer, integer, integer, integer, hq.tenant_feedback, boolean, text)'),
  ('hq.record_contractor_contact(uuid, hq.interaction_type, timestamptz, text, text, date, boolean, uuid, hq.contractor_status)'),
  ('hq.contractor_summary()'),
  ('hq.create_expiry_tasks()'),
  ('hq.preview_contractor_import(jsonb)'),
  ('hq.apply_contractor_import(jsonb, text, text)');
select is((select count(*) from zz_rpcs), 13::bigint, 'thirteen Phase 2 RPCs exist with the documented signatures');
select is((select count(*) from zz_rpcs where has_function_privilege('authenticated', sig, 'execute')), 13::bigint, 'authenticated can execute all thirteen');
select is((select count(*) from zz_rpcs where has_function_privilege('anon', sig, 'execute')), 0::bigint, 'anon can execute none of them');
select is((select count(*) from zz_rpcs z join pg_proc p on p.oid = z.sig where p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)),
  0::bigint, 'public can execute none of them');
select is((select count(*) from zz_rpcs where has_function_privilege('service_role', sig, 'execute')), 0::bigint, 'service_role can execute none of them');
select is((select count(*) from zz_rpcs z join pg_proc p on p.oid = z.sig where p.prosecdef), 13::bigint, 'all thirteen are security definer');
select is((select count(*) from zz_rpcs z join pg_proc p on p.oid = z.sig where p.proconfig::text like '%search_path=pg_catalog, public, extensions%'),
  13::bigint, 'all thirteen pin search_path');
select ok(not (select prosecdef from pg_proc where oid = 'hq.global_search(text, integer)'::regprocedure), 'global_search stays security invoker (RLS decides what it finds)');
select ok(has_function_privilege('authenticated', 'hq_private.abn_is_valid(text)', 'execute'), 'authenticated can execute abn_is_valid (the contractors CHECK constraint runs as the writer)');
select ok(has_function_privilege('authenticated', 'hq_private.expiry_state(date, boolean, boolean, date, integer)', 'execute'), 'authenticated can execute expiry_state (the views run as the reader)');
select is((select count(*) from pg_proc p where p.pronamespace = 'hq_private'::regnamespace
            and p.proname in ('contractor_guard', 'contractor_after_write', 'vetting_step_guard', 'contractor_document_guard', 'contractor_import_plan',
                              'contractor_approval_warnings', 'contractor_missing_steps', 'setting_int', 'task_reminder_guard', 'contractor_review_guard')
            and has_function_privilege('authenticated', p.oid, 'execute')), 0::bigint, 'the contractor trigger and RPC helpers are not executable by authenticated');
select is((select count(*) from pg_proc p where p.pronamespace = 'hq_private'::regnamespace
            and p.proname in ('contractor_guard', 'vetting_step_guard', 'contractor_document_guard', 'task_reminder_guard') and p.prosecdef),
  0::bigint, 'the guard triggers are NOT security definer (current_user must be the real writer)');

-- ------------------------------------------------------------ enums (section 3, exact)
select is((select array_agg(slug order by sort_order, slug) from hq.trades), array['plumbing', 'electrical', 'general_maintenance', 'handyman', 'carpentry', 'cleaning', 'carpet_cleaning', 'gardening', 'landscaping', 'pest_control', 'locksmith', 'painting', 'roofing', 'guttering', 'air_conditioning', 'appliance_repairs', 'garage_doors', 'glazing', 'tree_services', 'building', 'emergency_restoration', 'other'], 'the 22 former contractor_category values are the seeded trades, in the same order (the enum itself is gone)');
select enum_has_labels('hq', 'contractor_status', array['prospect', 'contacted', 'vetting', 'approved', 'preferred', 'suspended', 'inactive']);
select enum_has_labels('hq', 'vetting_step', array['identity', 'abn', 'licence', 'insurance', 'service_areas', 'pricing', 'emergency_availability', 'communication', 'review_and_approve']);
select enum_has_labels('hq', 'vetting_step_status', array['not_started', 'in_progress', 'done', 'not_applicable']);
select enum_has_labels('hq', 'contractor_document_type', array['licence', 'public_liability_insurance', 'workers_compensation', 'professional_indemnity', 'abn_confirmation', 'price_list', 'agreement', 'other']);
select enum_has_labels('hq', 'document_verification', array['pending', 'verified', 'rejected']);
select enum_has_labels('hq', 'tenant_feedback', array['positive', 'neutral', 'negative', 'none_received']);

-- ------------------------------------------------------------ columns (section 3, exact; plus bookkeeping)
select columns_are('hq', 'contractors', array['id', 'business_name', 'name_key', 'primary_contact_name', 'phone', 'email', 'website', 'abn', 'categories',
  'service_suburbs', 'service_regions', 'emergency_available', 'business_hours', 'hourly_rate_cents', 'callout_fee_cents', 'after_hours_fee_cents',
  'minimum_charge_cents', 'invoice_terms', 'licence_details', 'licence_verified_at', 'licence_expires_on', 'insurance_details', 'insurance_verified_at',
  'insurance_expires_on', 'status', 'status_reason', 'approved_at', 'approved_by', 'relationship_owner_id', 'internal_notes', 'last_job_date', 'source',
  'needs_verification', 'verified_at', 'verified_by', 'external_ids', 'created_at', 'updated_at', 'created_by', 'deleted_at', 'deleted_by']);
select columns_are('hq', 'contractor_vetting_steps', array['contractor_id', 'step', 'status', 'note', 'completed_by', 'completed_at', 'updated_at']);
select columns_are('hq', 'contractor_documents', array['id', 'contractor_id', 'document_type', 'file_name', 'storage_path', 'mime_type', 'size_bytes', 'uploaded_by',
  'uploaded_at', 'verification', 'verified_by', 'verified_at', 'verification_note', 'expires_on', 'notes', 'created_at', 'updated_at', 'created_by', 'deleted_at', 'deleted_by']);
select columns_are('hq', 'contractor_reviews', array['id', 'contractor_id', 'job_date', 'job_reference', 'response_time', 'communication', 'work_quality',
  'invoice_accuracy', 'tenant_feedback', 'rework_required', 'notes', 'recorded_by', 'created_at', 'updated_at', 'created_by', 'deleted_at', 'deleted_by']);
select columns_are('hq', 'contractor_status_history', array['id', 'contractor_id', 'from_status', 'to_status', 'changed_by', 'changed_at', 'note']);
select col_is_null('hq', 'contractors', 'emergency_available', 'emergency_available is nullable (null = unknown)');
select col_hasnt_default('hq', 'contractors', 'emergency_available', 'emergency_available has no default (never false by assumption)');
select is((select count(*) from information_schema.columns where table_schema = 'hq' and table_name = 'contractors'
            and column_name in ('hourly_rate_cents', 'callout_fee_cents', 'after_hours_fee_cents', 'minimum_charge_cents') and is_nullable = 'YES' and column_default is null),
  4::bigint, 'the four money columns are nullable with no default (unknown is not zero)');
select col_type_is('hq', 'contractors', 'categories', 'text[]', 'categories is text[] of trade slugs (hq.trades.slug)');

-- ------------------------------------------------------------ indexes
select is((select count(*) from pg_indexes where schemaname = 'hq'
            and indexname in ('contractors_name_key_uq', 'contractors_abn_uq') and indexdef like 'CREATE UNIQUE INDEX%' and indexdef like '%deleted_at IS NULL%'),
  2::bigint, 'unique name_key and unique abn are partial on deleted_at is null');
select ok((select indexdef from pg_indexes where schemaname = 'hq' and indexname = 'tasks_reminder_key_open_uq') ~ 'UNIQUE.*reminder_key.*deleted_at IS NULL.*completed',
  'one OPEN reminder task per key: a partial unique index');
select ok((select indexdef from pg_indexes where schemaname = 'hq' and indexname = 'contractors_business_name_trgm_idx') ~ 'gin_trgm_ops', 'business_name has a trigram index');
select is((select count(*) from pg_constraint c
            where c.contype = 'f' and c.connamespace = 'hq'::regnamespace
              and not exists (select 1 from pg_index i
                              where i.indrelid = c.conrelid
                                and (string_to_array(i.indkey::text, ' ')::int2[])[1:array_length(c.conkey, 1)] = c.conkey)),
  0::bigint, 'every foreign key (including the Phase 2 ones) has an index on its leading column(s)');

-- ------------------------------------------------------------ settings
select is((select value from hq.settings where key = 'contractor_min_reviews_for_rating'), '3'::jsonb, 'setting contractor_min_reviews_for_rating = 3');
select is((select value from hq.settings where key = 'contractor_expiry_warning_days'), '30'::jsonb, 'setting contractor_expiry_warning_days = 30');
select throws_ok($$update hq.settings set value = '0'::jsonb where key = 'contractor_min_reviews_for_rating'$$, '22023', null, 'the rating threshold must be at least 1');
select throws_ok($$update hq.settings set value = '"three"'::jsonb where key = 'contractor_min_reviews_for_rating'$$, '22023', null, 'the rating threshold must be a number');
select throws_ok($$update hq.settings set value = '2.5'::jsonb where key = 'contractor_expiry_warning_days'$$, '22023', null, 'the warning window must be a whole number');
select throws_ok($$update hq.settings set value = '400'::jsonb where key = 'contractor_expiry_warning_days'$$, '22023', null, 'the warning window is at most 365 days');
select lives_ok($$update hq.settings set value = '14'::jsonb where key = 'contractor_expiry_warning_days'$$, 'a valid warning window is accepted');
update hq.settings set value = '30'::jsonb where key = 'contractor_expiry_warning_days';

-- ------------------------------------------------------------ the capability matrix (section 2, exact)
create function pg_temp.ccaps(p_role text) returns text[] language sql as $$
  select coalesce(array_agg(capability order by capability), '{}') from hq.role_capabilities where role = p_role::hq.staff_role and capability like 'contractors.%' $$;
select is(pg_temp.ccaps('director'), array['contractors.approve', 'contractors.documents', 'contractors.read', 'contractors.write'], 'director: all four contractor capabilities');
select is(pg_temp.ccaps('administrator'), array['contractors.approve', 'contractors.documents', 'contractors.read', 'contractors.write'], 'administrator: all four');
select is(pg_temp.ccaps('senior_property_manager'), array['contractors.documents', 'contractors.read', 'contractors.write'], 'senior property manager: read, write, documents');
select is(pg_temp.ccaps('property_manager'), array['contractors.documents', 'contractors.read', 'contractors.write'], 'property manager: read, write, documents');
select is(pg_temp.ccaps('junior_property_manager'), array['contractors.read'], 'junior property manager: read');
select is(pg_temp.ccaps('virtual_assistant'), array['contractors.documents', 'contractors.read', 'contractors.write'], 'virtual assistant: read, write, documents');
select is(pg_temp.ccaps('business_development_manager'), array['contractors.read'], 'business development manager: read');
select is(pg_temp.ccaps('read_only'), array['contractors.read'], 'read-only: read');
select pg_temp.become('va');
select is(hq.can('contractors.write'), true, 'can(): a virtual assistant holds contractors.write');
select is(hq.can('contractors.approve'), false, 'can(): a virtual assistant does not hold contractors.approve');
select pg_temp.unbecome();

-- ------------------------------------------------------------ the storage bucket (section 6)
select is((select row(public, file_size_limit, allowed_mime_types)::text from storage.buckets where id = 'contractor-documents'),
  row(false, 10485760::bigint, array['application/pdf', 'image/jpeg', 'image/png'])::text, 'bucket contractor-documents: private, 10 MiB, pdf / jpeg / png only');
select is((select array_agg(policyname::text || ':' || cmd || ':' || array_to_string(roles, ',') order by policyname) from pg_policies
            where schemaname = 'storage' and tablename = 'objects' and (coalesce(qual, '') || coalesce(with_check, '')) like '%contractor-documents%'),
  array['hq_contractor_documents_insert:INSERT:authenticated', 'hq_contractor_documents_select:SELECT:authenticated'],
  'storage.objects: exactly a select and an insert policy for the bucket, both to authenticated');
select is((select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and cmd in ('UPDATE', 'DELETE', 'ALL')),
  0::bigint, 'no storage.objects policy allows update or delete (nothing can be overwritten or removed through the API)');
select ok((select bool_and(coalesce(qual, '') || coalesce(with_check, '') like '%has_capability(''contractors.documents''%') from pg_policies
           where schemaname = 'storage' and tablename = 'objects' and policyname like 'hq_contractor_documents_%'),
  'both storage policies require contractors.documents');
select pg_temp.mk_object(pg_temp.doc_path(pg_temp.fx('c_plumb')));
select pg_temp.become_anon();
select is((select count(*) from storage.objects where bucket_id = 'contractor-documents'), 0::bigint, 'anon reads no object of the bucket (one exists)');
select is((select count(*) from storage.buckets where id = 'contractor-documents'), 0::bigint, 'anon cannot even see the bucket');
select throws_ok(format($$insert into storage.objects (bucket_id, name, metadata) values ('contractor-documents', %L, '{"size": 1, "mimetype": "application/pdf"}')$$,
  pg_temp.doc_path(pg_temp.fx('c_plumb'))), '42501', null, 'anon cannot add an object to the bucket');
update storage.objects set metadata = '{}'::jsonb where bucket_id = 'contractor-documents';
select pg_temp.unbecome();
select is((select count(*) from storage.objects where bucket_id = 'contractor-documents' and metadata = '{}'::jsonb), 0::bigint, 'anon cannot change an object');

-- ------------------------------------------------------------ ABN checksum (the ATO modulus-89 rule)
-- 51 824 753 556 is the example the ATO publishes for its check-digit algorithm (a test value, not a contractor's).
select is(hq_private.abn_is_valid('51824753556'), true, 'abn_is_valid: a known valid ABN passes');
select is(hq_private.abn_is_valid('51824753557'), false, 'abn_is_valid: a one-digit change fails');
select is(hq_private.abn_is_valid('61824753556'), false, 'abn_is_valid: a change to the first digit fails');
select is(hq_private.abn_is_valid('5182475355'), false, 'abn_is_valid: ten digits fail');
select is(hq_private.abn_is_valid('01300000000'), false, 'abn_is_valid: a leading zero fails (ABNs start 1-9)');
select is(hq_private.abn_is_valid('5182475355a'), false, 'abn_is_valid: a letter fails (and does not raise)');
select pg_temp.become('va');
select lives_ok($$insert into hq.contractors (business_name, categories, abn) values ('Abn Valid Co', '{other}', '51 824 753 556')$$, 'a contractor with a valid ABN (typed with spaces) is accepted');
select pg_temp.unbecome();
select is((select abn from hq.contractors where business_name = 'Abn Valid Co'), '51824753556', 'the ABN is stored as digits only');
select pg_temp.become('va');
select throws_ok($$insert into hq.contractors (business_name, categories, abn) values ('Abn Off By One Co', '{other}', '51824753557')$$, '23514', null, 'a one-digit change is refused by the database (contractors_abn_valid)');
select throws_ok($$insert into hq.contractors (business_name, categories, abn) values ('Abn Short Co', '{other}', '5182475355')$$, '23514', null, 'ten digits are refused');
select throws_ok($$insert into hq.contractors (business_name, categories, abn) values ('Abn Twice Co', '{other}', '51824753556')$$, '23505', null, 'the same ABN on two live contractors is refused');
select throws_ok($$update hq.contractors set abn = '51-824-753-556' where business_name = 'Abn Valid Co'$$, '23514', null, 'punctuation other than spaces is refused');
select pg_temp.unbecome();

-- ------------------------------------------------------------ the expiry rule on its boundary days (W = 30)
select is(hq_private.expiry_state(date '2026-01-09', true, true, date '2026-01-10', 30), 'expired', 'expiry: the day after the expiry date is expired');
select is(hq_private.expiry_state(date '2026-01-10', true, true, date '2026-01-10', 30), 'expiring_soon', 'expiry: ON the expiry date it is not yet expired (expiring_soon)');
select is(hq_private.expiry_state(date '2026-02-09', true, true, date '2026-01-10', 30), 'expiring_soon', 'expiry: exactly W days ahead is expiring_soon (inclusive)');
select is(hq_private.expiry_state(date '2026-02-10', true, true, date '2026-01-10', 30), 'current', 'expiry: W + 1 days ahead and verified is current');
select is(hq_private.expiry_state(date '2026-02-10', false, true, date '2026-01-10', 30), 'unverified', 'expiry: W + 1 days ahead but unverified is unverified');
select is(hq_private.expiry_state(date '2026-01-09', false, true, date '2026-01-10', 30), 'expired', 'expiry: an unverified date in the past is still expired');
select is(hq_private.expiry_state(null, false, false, date '2026-01-10', 30), 'not_recorded', 'expiry: nothing recorded is not_recorded');
select is(hq_private.expiry_state(null, false, true, date '2026-01-10', 30), 'unverified', 'expiry: details but no expiry date is unverified');
select is(hq_private.expiry_state(null, true, false, date '2026-01-10', 30), 'unverified', 'expiry: verified but no expiry date is unverified, never current');
select is(hq_private.expiry_state(date '2026-01-20', true, true, date '2026-01-10', 7), 'current', 'expiry: the window follows the setting (10 days ahead with W = 7 is current)');

-- ------------------------------------------------------------ creation: nine steps and history; history is append-only
select is((select array_agg(step::text || ':' || status::text order by step) from hq.contractor_vetting_steps where contractor_id = pg_temp.fx('c_plumb')),
  array['identity:not_started', 'abn:not_started', 'licence:not_started', 'insurance:not_started', 'service_areas:not_started', 'pricing:not_started',
        'emergency_availability:not_started', 'communication:not_started', 'review_and_approve:not_started'],
  'a new contractor gets the nine vetting steps, not_started, in checklist order');
select is((select array_agg(coalesce(from_status::text, '-') || '>' || to_status::text) from hq.contractor_status_history where contractor_id = pg_temp.fx('c_plumb')),
  array['->prospect'], 'a new contractor gets one history row (to prospect)');
select throws_ok($$update hq.contractor_status_history set note = 'changed'$$, '42501', null, 'status history: update raises even as postgres');
select throws_ok($$delete from hq.contractor_status_history$$, '42501', null, 'status history: delete raises even as postgres');
select throws_ok($$truncate hq.contractor_status_history$$, '42501', null, 'status history: truncate raises even as postgres');
select is((select name_key from hq.contractors where id = pg_temp.fx('c_plumb')), 'test plumbing co', 'contractors.name_key is generated from normalise_name');
select pg_temp.become('va');
select throws_ok($$insert into hq.contractors (business_name, categories) values ('The Test Plumbing Co Pty Ltd', '{plumbing}')$$, '23505', null, 'a second spelling of the same business name is refused');
select throws_ok($$insert into hq.contractors (business_name, categories) values ('No Trade Co', '{}')$$, '23514', null, 'a contractor needs at least one category');
select throws_ok($$insert into hq.contractors (business_name, categories, hourly_rate_cents) values ('Negative Co', '{other}', -1)$$, '23514', null, 'a negative rate is refused');
select lives_ok($$insert into hq.contractors (business_name, categories, service_suburbs) values ('Suburb Tidy Co', '{other}', array['  Moonta ', 'moonta', '', 'Wallaroo   Bay'])$$, 'suburbs are accepted as typed');
select pg_temp.unbecome();
select is((select service_suburbs from hq.contractors where business_name = 'Suburb Tidy Co'), array['Moonta', 'Wallaroo Bay'], 'suburbs are trimmed, blanks and case-insensitive repeats dropped');

select * from finish();
rollback;
