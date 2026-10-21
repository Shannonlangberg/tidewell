-- Planted HQ: structure and security posture (schemas, exposure, RLS, grants, function ACLs,
-- immutability, normalise_name, enums, columns, indexes). No business behaviour here.
--
-- NOTE: never CALL a function a hint role (anon, authenticated, service_role) lacks execute on: the
-- local Postgres image's supautils permission hint segfaults on "permission denied for function".
-- Function execute is asserted from pg_proc / has_function_privilege. Calls as anon are safe because
-- anon has no usage on schema hq, so the call is refused earlier ("permission denied for schema").
begin;
\ir hq_fixture.inc
select pg_temp.seed_hq();
select plan(188);

-- ------------------------------------------------------------ extensions and schemas
select has_extension('extensions', 'pg_trgm', 'pg_trgm is installed in extensions');
select has_extension('extensions', 'citext', 'citext is installed in extensions');
select has_extension('extensions', 'pgcrypto', 'pgcrypto is installed in extensions');
select has_extension('extensions', 'btree_gist', 'btree_gist is installed in extensions');
select ok(not has_schema_privilege('anon', 'hq', 'usage'), 'anon has no usage on hq (a request with the anon key is denied, not merely empty)');
select ok(has_schema_privilege('authenticated', 'hq', 'usage'), 'authenticated has usage on hq');
select ok(has_schema_privilege('service_role', 'hq', 'usage'), 'service_role has usage on hq');
select ok(not has_schema_privilege('anon', 'hq_private', 'usage'), 'anon has no usage on hq_private');
select ok(not has_schema_privilege('authenticated', 'hq_private', 'usage'), 'authenticated has no usage on hq_private');
select ok(not has_schema_privilege('service_role', 'hq_private', 'usage'), 'service_role has no usage on hq_private');

-- ------------------------------------------------------------ RLS enabled, forced, scoped
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'hq' and c.relkind = 'r'),
  47::bigint, 'hq has 47 tables (13 Phase 1, 5 Phase 2 contractor tables, 1 Phase 3 ai_requests, trades, 3 decisions, 2 portfolio, email_drafts, enquiries, 2 knowledge, 5 meetings, 11 projects, 2 brand resources)');
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'hq' and c.relkind = 'r' and not (c.relrowsecurity and c.relforcerowsecurity)),
  0::bigint, 'RLS is enabled and forced on every hq table');
select is((select count(*) from pg_policies where schemaname = 'hq' and roles <> '{authenticated}'::name[]),
  0::bigint, 'every hq policy is to authenticated only');
select is((select count(*) from pg_policies where schemaname = 'hq' and qual is null and with_check is null),
  0::bigint, 'every hq policy has a predicate');
select is((select count(*) from pg_policies where schemaname = 'hq' and (qual = 'true' or with_check = 'true')),
  0::bigint, 'no hq policy is a bare true');
select is((select count(*) from pg_policies where schemaname = 'hq' and (coalesce(qual, '') || coalesce(with_check, '')) not like '%hq_private.%'),
  0::bigint, 'every hq policy asks the database (a hq_private helper), never a JWT claim');
select is((select count(*) from pg_policies where schemaname = 'hq' and (coalesce(qual, '') || coalesce(with_check, '')) ~* 'jwt|role'' *::|app_metadata|user_metadata'),
  0::bigint, 'no hq policy reads a JWT claim for authorisation');

-- ------------------------------------------------------------ grants
select is((select count(*) from information_schema.role_table_grants where table_schema = 'hq' and grantee = 'anon'),
  0::bigint, 'anon holds no grant on any hq relation');
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'hq' and c.relkind in ('r', 'v') and has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate')),
  0::bigint, 'anon holds no privilege on any hq relation (has_table_privilege)');
select is((select count(*) from information_schema.role_table_grants
            where table_schema = 'hq' and privilege_type = 'TRUNCATE' and grantee in ('anon', 'authenticated', 'service_role')),
  0::bigint, 'no API role holds truncate on any hq table');
select is((select count(*) from information_schema.role_table_grants
            where table_schema = 'hq' and privilege_type = 'DELETE' and grantee in ('anon', 'authenticated', 'service_role')),
  0::bigint, 'no API role holds delete on any hq table');
select table_privs_are('hq', 'staff_profiles', 'authenticated', array['SELECT'], 'staff_profiles: authenticated can only select (writes go through RPCs)');
select table_privs_are('hq', 'role_capabilities', 'authenticated', array['SELECT'], 'role_capabilities: authenticated can only select');
select table_privs_are('hq', 'audit_events', 'authenticated', array['SELECT'], 'audit_events: authenticated can only select');
select table_privs_are('hq', 'audit_events', 'service_role', array['SELECT'], 'audit_events: service_role can only select');
select table_privs_are('hq', 'opportunity_stage_history', 'authenticated', array['SELECT'], 'opportunity_stage_history: authenticated can only select');
select table_privs_are('hq', 'import_batches', 'authenticated', array['SELECT'], 'import_batches: authenticated can only select');
select is((select count(*) from unnest(array['referrals', 'opportunities', 'interactions', 'staff_profiles', 'audit_events', 'import_batches', 'opportunity_stage_history', 'role_capabilities', 'ai_requests', 'trades', 'decisions', 'decision_history', 'decision_tasks', 'managed_properties', 'property_handover_steps', 'email_drafts', 'enquiries', 'knowledge_documents', 'knowledge_versions', 'meetings', 'meeting_attendees', 'meeting_links', 'meeting_actions', 'meeting_history',
                                 'projects', 'project_milestones', 'project_links', 'project_documents', 'project_activity', 'task_dependencies', 'task_checklist_items',
                                 'task_comments', 'task_activity', 'idempotency_keys', 'bulk_usage', 'brand_resources', 'brand_resource_versions']) t
            where has_table_privilege('authenticated', 'hq.' || t, 'insert')),
  0::bigint, 'authenticated cannot insert directly into the RPC-only tables');
select table_privs_are('hq', 'organisations', 'authenticated', array['SELECT', 'INSERT', 'UPDATE'], 'organisations: select, insert, update (no delete, no truncate)');
select table_privs_are('hq', 'tasks', 'authenticated', array['SELECT', 'INSERT', 'UPDATE'], 'tasks: select, insert, update');
select ok(not has_column_privilege('authenticated', 'hq.opportunities', 'stage', 'update'), 'stage cannot be updated directly (move_opportunity only)');
select ok(not has_column_privilege('authenticated', 'hq.opportunities', 'signed_at', 'update'), 'signed_at cannot be updated directly');
select ok(not has_column_privilege('authenticated', 'hq.opportunities', 'management_reference', 'update'), 'management_reference cannot be updated directly');
select ok(has_column_privilege('authenticated', 'hq.opportunities', 'notes', 'update'), 'opportunity notes can be updated directly');
select ok(not has_column_privilege('authenticated', 'hq.referrals', 'is_attributed', 'update'), 'is_attributed cannot be updated directly (set_attributed_referral only)');
select ok(not has_column_privilege('authenticated', 'hq.referrals', 'opportunity_id', 'update'), 'a referral cannot be moved to another opportunity directly');
select ok(has_column_privilege('authenticated', 'hq.settings', 'value', 'update') and not has_column_privilege('authenticated', 'hq.settings', 'key', 'update'),
  'only a setting''s value is updatable');

-- ------------------------------------------------------------ anon is DENIED, not empty
select pg_temp.become_anon();
select throws_ok(format('select 1 from hq.%I', t), '42501', null, 'anon is denied on hq.' || t)
from unnest(array['pods', 'staff_profiles', 'role_capabilities', 'settings', 'organisations', 'contacts', 'interactions', 'opportunities',
                  'opportunity_stage_history', 'referrals', 'tasks', 'audit_events', 'import_batches',
                  'contact_directory', 'organisation_directory', 'referral_overview', 'partner_performance', 'overdue_followups', 'referral_partner_overview',
                  'decisions', 'decision_history', 'decision_tasks', 'decision_overview', 'managed_properties', 'property_handover_steps', 'portfolio_overview', 'enquiries', 'enquiry_overview',
                  'knowledge_documents', 'knowledge_versions', 'knowledge_overview',
                  'meetings', 'meeting_attendees', 'meeting_links', 'meeting_actions', 'meeting_history', 'meeting_overview', 'open_meeting_actions',
                  'projects', 'project_milestones', 'project_links', 'project_documents', 'project_activity', 'task_dependencies', 'task_checklist_items',
                  'task_comments', 'task_activity', 'idempotency_keys', 'bulk_usage', 'project_overview', 'task_overview', 'project_timeline']) t;
select throws_ok('select hq.my_access()', '42501', null, 'anon cannot call my_access');
select throws_ok('select hq.can(''growth.read'')', '42501', null, 'anon cannot call can');
select throws_ok('select hq.global_search(''alpha'', 5)', '42501', null, 'anon cannot call global_search');
select throws_ok('select hq.growth_summary(null)', '42501', null, 'anon cannot call growth_summary');
select pg_temp.unbecome();

-- ------------------------------------------------------------ function privileges (from pg_proc)
select is((select count(*) from pg_proc where pronamespace = 'hq'::regnamespace), 110::bigint, 'hq holds 109 RPCs (16 Phase 1, 13 Phase 2, 3 Phase 3, 5 trades, 5 decisions, 3 leads, 6 portfolio, 6 email, 4 enquiries, 2 enquiry thank-you, 6 knowledge, 8 meetings, 26 projects, 6 brand resources) plus bootstrap_first_director');
select is((select count(*) from pg_proc p where p.pronamespace in ('hq'::regnamespace, 'hq_private'::regnamespace)
            and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0))),
  0::bigint, 'no hq or hq_private function is executable by public');
select is((select count(*) from pg_proc p where p.pronamespace in ('hq'::regnamespace, 'hq_private'::regnamespace)
            and has_function_privilege('anon', p.oid, 'execute')),
  0::bigint, 'anon can execute no hq or hq_private function');
select is((select count(*) from pg_proc p where p.pronamespace = 'hq'::regnamespace and has_function_privilege('authenticated', p.oid, 'execute')),
  105::bigint, 'authenticated can execute the 105 staff RPCs (every RPC but bootstrap_first_director, submit_enquiry, the two thank-you RPCs and import_brand_resource)');
select ok(not has_function_privilege('authenticated', 'hq.bootstrap_first_director(uuid,text,text,text)', 'execute'), 'authenticated cannot execute bootstrap_first_director');
select ok(not has_function_privilege('authenticated', 'hq.submit_enquiry(hq.enquiry_kind,text,text,text,text,text,jsonb,text,text)', 'execute'), 'authenticated cannot execute submit_enquiry (the website calls it with the secret key)');
select is((select count(*) from pg_proc p where p.pronamespace = 'hq'::regnamespace and has_function_privilege('service_role', p.oid, 'execute')),
  5::bigint, 'service_role can execute exactly five hq functions');
select ok(has_function_privilege('service_role', 'hq.bootstrap_first_director(uuid,text,text,text)', 'execute'), '... bootstrap_first_director');
select ok(has_function_privilege('service_role', 'hq.submit_enquiry(hq.enquiry_kind,text,text,text,text,text,jsonb,text,text)', 'execute'), '... submit_enquiry');
select ok(has_function_privilege('service_role', 'hq.begin_enquiry_auto_reply(uuid)', 'execute')
      and has_function_privilege('service_role', 'hq.finish_enquiry_auto_reply(uuid,boolean,text,text)', 'execute'), '... and begin_enquiry_auto_reply and finish_enquiry_auto_reply');
select ok(not has_function_privilege('authenticated', 'hq.begin_enquiry_auto_reply(uuid)', 'execute')
      and not has_function_privilege('authenticated', 'hq.finish_enquiry_auto_reply(uuid,boolean,text,text)', 'execute'), 'authenticated cannot execute the two thank-you RPCs');
select ok(has_function_privilege('service_role', 'hq.import_brand_resource(uuid,uuid,text,hq.brand_resource_category,text,text,text,text,bigint,text,text[],text,integer,text)', 'execute'), '... and import_brand_resource (the importer script)');
select ok(not has_function_privilege('authenticated', 'hq.import_brand_resource(uuid,uuid,text,hq.brand_resource_category,text,text,text,text,bigint,text,text[],text,integer,text)', 'execute') and not has_function_privilege('anon', 'hq.import_brand_resource(uuid,uuid,text,hq.brand_resource_category,text,text,text,text,bigint,text,text[],text,integer,text)', 'execute'), 'authenticated and anon cannot execute import_brand_resource');
select is((select count(*) from pg_proc p where p.pronamespace = 'hq_private'::regnamespace and has_function_privilege('authenticated', p.oid, 'execute')),
  9::bigint, 'authenticated can execute only the 9 named policy, view, constraint and generated-column helpers in hq_private');
select is((select array_agg(p.proname::text order by p.proname) from pg_proc p where p.pronamespace = 'hq_private'::regnamespace and has_function_privilege('authenticated', p.oid, 'execute')),
  array['abn_is_valid', 'current_staff_id', 'expiry_state', 'has_capability', 'is_staff', 'mfa_ok', 'normalise_name', 'staff_role', 'staff_session'],
  '... and they are the capability helpers, normalise_name, abn_is_valid and expiry_state');
select is((select count(*) from pg_proc p where p.pronamespace = 'hq_private'::regnamespace and has_function_privilege('service_role', p.oid, 'execute')),
  1::bigint, 'service_role can execute only normalise_name in hq_private');
select is((select count(*) from pg_proc p where p.pronamespace = 'hq'::regnamespace and p.prosecdef), 109::bigint, 'every hq function but one is security definer');
select ok(not (select prosecdef from pg_proc where pronamespace = 'hq'::regnamespace and proname = 'global_search'), 'global_search is security invoker, so RLS decides what it returns');
select is((select count(*) from pg_proc p where p.pronamespace in ('hq'::regnamespace, 'hq_private'::regnamespace)
            and not coalesce(p.proconfig::text, '') ~ 'search_path=(pg_catalog|"?pg_catalog, public, extensions)'),
  0::bigint, 'every hq and hq_private function pins its search_path');
select is((select count(*) from pg_proc p where p.pronamespace = 'hq'::regnamespace and not coalesce(p.proconfig::text, '') like '%search_path=pg_catalog, public, extensions%'),
  0::bigint, 'every hq function pins search_path to pg_catalog, public, extensions');

-- ------------------------------------------------------------ hq_private is unusable by the API roles
select pg_temp.become('dir');
select throws_ok('select hq_private.has_capability(''growth.read'')', '42501', null, 'authenticated cannot call a hq_private helper (no schema usage)');
select throws_ok('select hq_private.normalise_name(''x'')', '42501', null, 'authenticated cannot name hq_private.normalise_name');
select pg_temp.unbecome();

-- ------------------------------------------------------------ views
select is((select count(*) from pg_class c where c.relnamespace = 'hq'::regnamespace and c.relkind = 'v'), 21::bigint, 'hq has twenty-one views (five Phase 1, three Phase 2, referral_partner_overview, decision_overview, opportunity_overview, overdue_opportunities, portfolio_overview, enquiry_overview, knowledge_overview, meeting_overview, open_meeting_actions, project_overview, task_overview, project_timeline, brand_resource_overview)');
select is((select count(*) from pg_class c where c.relnamespace = 'hq'::regnamespace and c.relkind = 'v' and c.reloptions @> array['security_invoker=true']),
  21::bigint, 'every view is security_invoker');
select is((select count(*) from pg_class c where c.relnamespace = 'hq'::regnamespace and c.relkind = 'v' and has_table_privilege('authenticated', c.oid, 'select')),
  21::bigint, 'authenticated can select every view');

-- ------------------------------------------------------------ append-only: update, delete and truncate raise for every role
select hq_private.audit_write('test', 'probe', null, 'a probe row', '{}'::jsonb);
select throws_ok($$update hq.audit_events set summary = 'changed'$$, '42501', null, 'audit_events: update raises even as postgres');
select throws_ok($$delete from hq.audit_events$$, '42501', null, 'audit_events: delete raises even as postgres');
select throws_ok($$truncate hq.audit_events$$, '42501', null, 'audit_events: truncate raises even as postgres');
insert into hq.opportunities (prospect_name, assigned_to) values ('Probe Prospect', pg_temp.fx('dir'));
select throws_ok($$update hq.opportunity_stage_history set note = 'changed'$$, '42501', null, 'opportunity_stage_history: update raises even as postgres');
select throws_ok($$delete from hq.opportunity_stage_history$$, '42501', null, 'opportunity_stage_history: delete raises even as postgres');
select throws_ok($$truncate hq.opportunity_stage_history$$, '42501', null, 'opportunity_stage_history: truncate raises even as postgres');
select pg_temp.become_service();
select throws_ok($$update hq.audit_events set summary = 'changed'$$, '42501', null, 'audit_events: update refused for service_role');
select throws_ok($$delete from hq.audit_events$$, '42501', null, 'audit_events: delete refused for service_role');
select throws_ok($$truncate hq.audit_events$$, '42501', null, 'audit_events: truncate refused for service_role');
select throws_ok($$truncate hq.organisations$$, '42501', null, 'organisations: truncate refused for service_role');
select pg_temp.unbecome();
select pg_temp.become('dir');
select throws_ok($$truncate hq.organisations$$, '42501', null, 'organisations: truncate refused for a director');
select throws_ok($$delete from hq.organisations$$, '42501', null, 'organisations: delete refused for a director (soft deletion only)');
select throws_ok($$delete from hq.audit_events$$, '42501', null, 'audit_events: delete refused for a director');
select pg_temp.unbecome();

-- ------------------------------------------------------------ normalise_name
select is(hq_private.normalise_name('The Loan Arranger'), 'loan arranger', 'normalise_name: leading The removed');
select is(hq_private.normalise_name('The Loan Arranger'), hq_private.normalise_name('loan arranger'), 'normalise_name: The Loan Arranger = loan arranger');
select is(hq_private.normalise_name('Smith & Co Pty Ltd'), 'smith and co', 'normalise_name: & becomes and, Pty Ltd removed');
select is(hq_private.normalise_name('  Foo,   Bar!  '), 'foo bar', 'normalise_name: punctuation stripped, whitespace collapsed');
select is(hq_private.normalise_name('Mildwaters Byrth Limited'), 'mildwaters byrth', 'normalise_name: trailing Limited removed');
select is(hq_private.normalise_name('Fintegra Pty. Ltd.'), 'fintegra', 'normalise_name: Pty. Ltd. removed');
select is(hq_private.normalise_name('a.s lending co.'), 'as lending co', 'normalise_name: a.s lending co.');
select is(hq_private.normalise_name('You & Me Property Partners'), 'you and me property partners', 'normalise_name: ampersand inside a name');
select is(hq_private.normalise_name('The'), 'the', 'normalise_name: never strips a name down to nothing');
select is(hq_private.normalise_name('Acme Inc'), 'acme', 'normalise_name: trailing Inc removed');
select is((select provolatile::text from pg_proc where oid = 'hq_private.normalise_name(text)'::regprocedure), 'i', 'normalise_name is IMMUTABLE');
select is((select name_key from hq.organisations where id = pg_temp.fx('alpha')), 'alpha realty', 'organisations.name_key is generated from normalise_name');

-- ------------------------------------------------------------ enums (section 4, exact)
select enum_has_labels('hq', 'staff_role', array['director', 'administrator', 'senior_property_manager', 'property_manager', 'junior_property_manager', 'business_development_manager', 'virtual_assistant', 'read_only']);
select enum_has_labels('hq', 'employment_status', array['active', 'on_leave', 'ended']);
select enum_has_labels('hq', 'partner_category', array['real_estate_sales', 'mortgage_broker', 'conveyancer', 'lawyer', 'accountant', 'bank_lending', 'buyers_agent', 'property_developer', 'builder', 'financial_adviser', 'other']);
select enum_has_labels('hq', 'relationship_status', array['identified', 'contacted', 'meeting_booked', 'met', 'active_relationship', 'referring_partner', 'inactive']);
select enum_has_labels('hq', 'priority_level', array['high', 'medium', 'low']);
select enum_has_labels('hq', 'org_contact_role', array['primary', 'secondary', 'other']);
select enum_has_labels('hq', 'interaction_type', array['phone_call', 'coffee_meeting', 'office_meeting', 'email', 'message', 'note']);
select enum_has_labels('hq', 'referral_direction', array['received', 'sent']);
select enum_has_labels('hq', 'opportunity_stage', array['introduction_received', 'contacted', 'qualified', 'appraisal_requested', 'appraisal_completed', 'proposal_sent', 'management_signed', 'lost']);
select enum_has_labels('hq', 'sent_referral_outcome', array['sent', 'acknowledged', 'converted', 'no_outcome']);
select enum_has_labels('hq', 'task_status', array['to_do', 'in_progress', 'waiting', 'completed', 'cancelled']);
select enum_has_labels('hq', 'task_priority', array['low', 'normal', 'high', 'urgent']);
select enum_has_labels('hq', 'lead_source', array['website_enquiry', 'referral_partner', 'own_marketing', 'direct_approach', 'other']);
select enum_has_labels('hq', 'lost_reason', array['price', 'chose_another_manager', 'self_managing', 'not_ready', 'unresponsive', 'out_of_area', 'other']);
select enum_has_labels('hq', 'contact_kind', array['partner', 'landlord', 'other']);
select ok(not has_column_privilege('authenticated', 'hq.opportunities', 'source', 'update'), 'a lead''s source cannot be updated directly (update_opportunity only)');
select ok(not has_column_privilege('authenticated', 'hq.opportunities', 'next_action', 'update'), 'a lead''s next action cannot be updated directly (update_opportunity / log_opportunity_activity only)');
select ok(not has_column_privilege('authenticated', 'hq.opportunities', 'lost_reason_code', 'update'), 'a lead''s lost reason code moves only with the stage (move_opportunity)');

-- ------------------------------------------------------------ columns (section 4, exact; plus created/updated bookkeeping)
select columns_are('hq', 'pods', array['id', 'name', 'region', 'is_active', 'created_at', 'updated_at', 'created_by']);
select columns_are('hq', 'staff_profiles', array['id', 'full_name', 'first_name', 'email', 'role', 'pod_id', 'employment_status', 'start_date', 'responsibilities', 'timezone', 'dashboard_widgets', 'is_active', 'invited_by', 'invited_at', 'created_at', 'updated_at', 'created_by']);
select columns_are('hq', 'role_capabilities', array['role', 'capability']);
select columns_are('hq', 'settings', array['key', 'value', 'updated_by', 'updated_at']);
select columns_are('hq', 'organisations', array['id', 'name', 'name_key', 'categories', 'website', 'phone', 'email', 'location', 'service_region', 'relationship_owner_id', 'notes', 'source', 'needs_verification', 'verified_at', 'verified_by', 'external_ids', 'created_at', 'updated_at', 'created_by', 'deleted_at', 'deleted_by']);
select columns_are('hq', 'contacts', array['id', 'organisation_id', 'full_name', 'name_key', 'position', 'categories', 'phone', 'email', 'website', 'location', 'service_region', 'org_contact_role', 'relationship_owner_id', 'relationship_status', 'priority', 'last_contact_at', 'next_follow_up_date', 'notes', 'source', 'needs_verification', 'verified_at', 'verified_by', 'external_ids', 'created_at', 'updated_at', 'created_by', 'deleted_at', 'deleted_by', 'contact_kind']);
select columns_are('hq', 'interactions', array['id', 'contact_id', 'organisation_id', 'contractor_id', 'interaction_type', 'occurred_at', 'summary', 'staff_id', 'next_action', 'follow_up_date', 'task_id', 'created_at', 'updated_at', 'created_by', 'deleted_at', 'deleted_by', 'opportunity_id']);
select columns_are('hq', 'opportunities', array['id', 'display_number', 'prospect_name', 'prospect_phone', 'prospect_email', 'property_suburb', 'property_address', 'stage', 'stage_changed_at', 'estimated_annual_value_cents', 'assigned_to', 'signed_at', 'management_reference', 'lost_reason', 'notes', 'created_at', 'updated_at', 'created_by', 'deleted_at', 'deleted_by', 'source', 'next_action', 'next_action_due', 'expected_close_date', 'owner_contact_id', 'lost_reason_code', 'last_activity_at']);
select columns_are('hq', 'opportunity_stage_history', array['id', 'opportunity_id', 'from_stage', 'to_stage', 'changed_by', 'changed_at', 'note']);
select columns_are('hq', 'referrals', array['id', 'ref_number', 'direction', 'referring_contact_id', 'referring_organisation_id', 'receiving_contact_id', 'receiving_organisation_id', 'opportunity_id', 'referral_date', 'assigned_to', 'is_attributed', 'sent_outcome', 'prospect_name', 'prospect_phone', 'prospect_email', 'property_suburb', 'property_address', 'notes', 'created_at', 'updated_at', 'created_by', 'deleted_at', 'deleted_by']);
select columns_are('hq', 'tasks', array['id', 'title', 'description', 'assigned_to', 'due_date', 'priority', 'status', 'related_contact_id', 'related_organisation_id', 'related_referral_id', 'related_opportunity_id', 'related_contractor_id', 'reminder_key', 'source', 'completed_at', 'completed_by', 'created_at', 'updated_at', 'created_by', 'deleted_at', 'deleted_by',
                                'project_id', 'milestone_id', 'parent_task_id', 'sort_order', 'blocked_reason']);
select columns_are('hq', 'audit_events', array['id', 'at', 'actor_id', 'actor_name', 'action', 'entity_type', 'entity_id', 'summary', 'changes']);
select columns_are('hq', 'import_batches', array['id', 'kind', 'source', 'file_name', 'row_count', 'organisations_created', 'contacts_created', 'contractors_created', 'duplicates_skipped', 'flagged', 'applied_by', 'applied_at']);

-- ------------------------------------------------------------ indexes
select is((select count(*) from pg_indexes where schemaname = 'hq'
            and indexname in ('organisations_name_trgm_idx', 'contacts_full_name_trgm_idx', 'opportunities_prospect_name_trgm_idx', 'tasks_title_trgm_idx')
            and indexdef ~ 'USING gin .*gin_trgm_ops'),
  4::bigint, 'trigram GIN indexes on organisations.name, contacts.full_name, opportunities.prospect_name, tasks.title');
select has_index('hq', 'contacts', 'contacts_next_follow_up_date_idx', array['next_follow_up_date']);
select has_index('hq', 'contacts', 'contacts_last_contact_at_idx', array['last_contact_at']);
select has_index('hq', 'tasks', 'tasks_assignee_status_due_idx', array['assigned_to', 'status', 'due_date']);
select has_index('hq', 'referrals', 'referrals_referring_organisation_id_idx', array['referring_organisation_id']);
select has_index('hq', 'referrals', 'referrals_opportunity_id_idx', array['opportunity_id']);
select has_index('hq', 'opportunities', 'opportunities_stage_idx', array['stage']);
select is((select count(*) from pg_constraint c
            where c.contype = 'f' and c.connamespace = 'hq'::regnamespace
              and not exists (select 1 from pg_index i
                              where i.indrelid = c.conrelid
                                and (string_to_array(i.indkey::text, ' ')::int2[])[1:array_length(c.conkey, 1)] = c.conkey)),
  0::bigint, 'every foreign key has an index on its leading column(s)');
select is((select count(*) from pg_indexes where schemaname = 'hq'
            and indexname in ('organisations_name_key_uq', 'contacts_org_name_key_uq', 'contacts_email_uq', 'contacts_one_primary_uq', 'opportunities_management_reference_uq')
            and indexdef like 'CREATE UNIQUE INDEX%' and indexdef like '%deleted_at IS NULL%'),
  5::bigint, 'the unique indexes are partial on deleted_at is null');
select is((select count(*) from pg_indexes where schemaname = 'hq' and indexname = 'referrals_one_attributed_uq' and indexdef like '%is_attributed%' and indexdef like '%deleted_at IS NULL%'),
  1::bigint, 'one attributed referral per opportunity is a partial unique index');

-- ------------------------------------------------------------ seeded reference data
select is((select count(*) from hq.role_capabilities), 144::bigint, 'role_capabilities holds the 41 rows of the section 4 matrix plus the 20 Phase 2 contractor rows, the 7 Phase 3 ai.use rows, the 7 decisions rows, the 9 portfolio rows, the 9 email rows, the 16 knowledge rows, the 12 meetings rows, the 13 projects rows and the 10 resources rows');
select is((select count(*) from hq.settings where key in ('require_mfa', 'timezone')), 2::bigint, 'settings holds require_mfa and timezone');
select is((select value from hq.settings where key = 'timezone'), '"Australia/Adelaide"'::jsonb, 'settings.timezone is "Australia/Adelaide"');
select is(hq.today(), (now() at time zone 'Australia/Adelaide')::date, 'hq.today() is today in Australia/Adelaide');

select * from finish();
rollback;
