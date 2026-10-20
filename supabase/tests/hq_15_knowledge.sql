-- Planted HQ: the Knowledge base (migrations 0138, 0139).
-- Structure and security, the capability matrix, forged callers (anon, non-staff, aal1, read_only,
-- junior, a writer without approve, a connected app), RLS (what a reader sees vs a writer), no direct
-- writes, append-only versions, THE RULE (an edit creates a draft and readers keep the approved text),
-- approval flipping versions, optimistic concurrency, no-op edits, discard, restore as a draft, the
-- chat-approve switch, review dates on their boundary days, owner and title rules, the starter
-- templates, archive / restore, and the audit trail.
--
-- NOTE: never CALL a function a hint role lacks execute on (see hq_01). Every RPC here is granted to
-- authenticated; anon is refused at the schema.
begin;
\ir hq_fixture.inc
select pg_temp.seed_hq();
select plan(155);

-- the starter templates from 0138, checked before anything else is put out of the way
select is((select count(*) from hq.knowledge_documents where title like '[Template] %(replace me)' and created_by is null), 12::bigint,
  'templates: twelve starter templates exist (one per category, five for brand, voice and vision)');
select is((select count(*) from hq.knowledge_documents where title like '[Template] %(replace me)' and created_by is null and category = 'brand_voice'), 5::bigint,
  'templates: five brand, voice and vision templates');
select is((select count(distinct category) from hq.knowledge_documents where title like '[Template] %(replace me)' and created_by is null), 8::bigint,
  'templates: every one of the eight categories has a template');
select is((select count(*) from hq.knowledge_documents d join hq.knowledge_versions v on v.document_id = d.id
           where d.title like '[Template] %(replace me)' and d.created_by is null
             and (v.body not like '%starter template%' or v.body !~ '\[[A-Z][^]]*\]')), 0::bigint,
  'templates: every template says it is a starter template and holds only bracketed prompts to replace');

-- anything already in this database is put out of the way for the transaction
update hq.knowledge_documents set deleted_at = now() where deleted_at is null;

create temp table zz_r (k text primary key, v jsonb) on commit drop;
grant select, insert on zz_r to public;
create function pg_temp.r(p_k text) returns jsonb language sql stable as $$ select v from zz_r where k = p_k $$;
create function pg_temp.kd(p_k text) returns uuid language sql stable as $$ select (v ->> 'document_id')::uuid from zz_r where k = p_k $$;
create function pg_temp.vstatus(p_doc uuid, p_n integer) returns text language sql stable as $$
  select status::text from hq.knowledge_versions where document_id = p_doc and version = p_n $$;
create function pg_temp.audits(p_id uuid, p_action text) returns bigint language sql stable as $$
  select count(*) from hq.audit_events where entity_type = 'knowledge_document' and entity_id = p_id and action = p_action $$;
-- a connected chat app's session: the person's claims plus a client_id claim
create function pg_temp.become_app(p_key text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.fx(p_key), 'role', 'authenticated', 'aal', 'aal2', 'client_id', 'test-chat-app')::text, true);
  execute 'set local role authenticated';
end $$;

-- ------------------------------------------------------------ structure and security
select has_table('hq', 'knowledge_documents', 'hq.knowledge_documents exists');
select has_table('hq', 'knowledge_versions', 'hq.knowledge_versions exists');
select columns_are('hq', 'knowledge_documents', array['id', 'ref_number', 'title', 'name_key', 'category', 'summary', 'owner_id', 'review_due', 'current_version', 'approved_version', 'status', 'is_template', 'created_at', 'updated_at', 'created_by', 'updated_by', 'deleted_at', 'deleted_by']);
select columns_are('hq', 'knowledge_versions', array['id', 'document_id', 'version', 'title', 'summary', 'body', 'based_on_version', 'status', 'edited_by', 'edited_by_name', 'edited_at', 'via', 'mcp_client_id', 'change_note', 'approved_by', 'approved_by_name', 'approved_at', 'approved_via', 'discarded_by', 'discarded_at']);
select enum_has_labels('hq', 'knowledge_category', array['company_procedure', 'contractor_vetting', 'referral_partner', 'landlord_onboarding', 'staff_policy', 'operational_checklist', 'brand_voice', 'general']);
select enum_has_labels('hq', 'knowledge_status', array['draft', 'approved', 'archived']);
select enum_has_labels('hq', 'knowledge_version_status', array['draft', 'approved', 'superseded', 'discarded']);
select is((select count(*) from pg_class where oid in ('hq.knowledge_documents'::regclass, 'hq.knowledge_versions'::regclass) and relrowsecurity and relforcerowsecurity), 2::bigint, 'RLS is enabled and forced on both knowledge tables');
select policies_are('hq', 'knowledge_documents', array['knowledge_documents_select'], 'knowledge_documents: one select policy, nothing else');
select policies_are('hq', 'knowledge_versions', array['knowledge_versions_select'], 'knowledge_versions: one select policy, nothing else');
select table_privs_are('hq', 'knowledge_documents', 'authenticated', array['SELECT'], 'knowledge_documents: authenticated can only select (written by RPC)');
select table_privs_are('hq', 'knowledge_versions', 'authenticated', array['SELECT'], 'knowledge_versions: authenticated can only select');
select is((select count(*) from unnest(array['knowledge_documents', 'knowledge_versions']) t where has_table_privilege('service_role', 'hq.' || t, 'insert,update,delete,truncate')), 0::bigint, 'service_role cannot write the knowledge tables');
select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid = 'hq.knowledge_overview'::regclass), 'knowledge_overview is security_invoker');
select ok(not has_table_privilege('anon', 'hq.knowledge_overview', 'select') and has_table_privilege('authenticated', 'hq.knowledge_overview', 'select'), 'the overview: authenticated may select, anon may not');

create temp table zz_rpcs (sig regprocedure primary key) on commit drop;
insert into zz_rpcs values
  ('hq.create_knowledge_document(text, hq.knowledge_category, text, text, uuid, date, text)'),
  ('hq.edit_knowledge_document(uuid, integer, text, text, text, text)'),
  ('hq.approve_knowledge_version(uuid, integer)'),
  ('hq.discard_knowledge_draft(uuid, integer, text)'),
  ('hq.set_knowledge_review(uuid, uuid, date, boolean, hq.knowledge_category, text)'),
  ('hq.restore_knowledge_version(uuid, integer, integer, text)');
select is((select count(*) from zz_rpcs where has_function_privilege('authenticated', sig, 'execute')), 6::bigint, 'authenticated can execute the six knowledge RPCs');
select is((select count(*) from zz_rpcs where has_function_privilege('anon', sig, 'execute') or has_function_privilege('service_role', sig, 'execute')), 0::bigint, 'anon and service_role can execute none of them');
select is((select count(*) from zz_rpcs z join pg_proc p on p.oid = z.sig where p.prosecdef and p.proconfig::text like '%search_path=pg_catalog, public, extensions%'), 6::bigint, 'all six are security definer with a pinned search_path');
select is((select count(*) from pg_proc p where p.pronamespace = 'hq_private'::regnamespace and p.proname like 'knowledge\_%'
            and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))), 0::bigint, 'the knowledge helpers are executable by no API role');
select is((select count(*) from pg_proc p where p.pronamespace = 'hq_private'::regnamespace and p.proname like 'knowledge\_%'), 9::bigint, '... and all nine helpers exist');

-- ------------------------------------------------------------ the capability matrix and the switch
select is((select array_agg(role::text order by role::text) from hq.role_capabilities where capability = 'knowledge.read'),
  array['administrator', 'business_development_manager', 'director', 'junior_property_manager', 'property_manager', 'read_only', 'senior_property_manager', 'virtual_assistant'], 'knowledge.read: every role');
select is((select array_agg(role::text order by role::text) from hq.role_capabilities where capability = 'knowledge.write'),
  array['administrator', 'business_development_manager', 'director', 'property_manager', 'senior_property_manager', 'virtual_assistant'], 'knowledge.write: all but the junior and read-only');
select is((select array_agg(role::text order by role::text) from hq.role_capabilities where capability = 'knowledge.approve'),
  array['administrator', 'director'], 'knowledge.approve: director and administrator only');
select is((select value from hq.settings where key = 'knowledge_chat_approve_enabled'), 'false'::jsonb, 'knowledge_chat_approve_enabled is off by default');
select throws_ok($$update hq.settings set value = '"yes"'::jsonb where key = 'knowledge_chat_approve_enabled'$$, '22023', 'knowledge_chat_approve_enabled must be true or false', 'the switch must be true or false');

-- ------------------------------------------------------------ forged callers
select pg_temp.become_anon();
select throws_ok('select 1 from hq.knowledge_documents', '42501', null, 'anon is denied the documents');
select throws_ok('select 1 from hq.knowledge_overview', '42501', null, 'anon is denied the overview');
select throws_ok($$select hq.create_knowledge_document('x', 'general', 'y')$$, '42501', null, 'anon cannot create a document');
select pg_temp.unbecome();
select pg_temp.become('outsider');
select throws_ok($$select hq.create_knowledge_document('Outsider doc [test]', 'general', 'body')$$, '42501', null, 'a signed-in person who is not staff cannot create');
select pg_temp.unbecome();
select pg_temp.become('dir', 'aal1');
select throws_ok($$select hq.create_knowledge_document('Aal1 doc [test]', 'general', 'body')$$, '42501', null, 'aal1 with require_mfa: create refused');
select pg_temp.unbecome();
select pg_temp.become('jpm');
select throws_ok($$select hq.create_knowledge_document('Junior doc [test]', 'general', 'body')$$, '42501', null, 'junior (knowledge.read only): create refused');
select pg_temp.unbecome();
select pg_temp.become('ro');
select throws_ok($$select hq.create_knowledge_document('Read-only doc [test]', 'general', 'body')$$, '42501', null, 'read-only: create refused');
select pg_temp.unbecome();

-- ------------------------------------------------------------ create (a writer: the virtual assistant)
select pg_temp.become('va');
insert into zz_r select 'a', hq.create_knowledge_document('  Landlord onboarding checklist [test]  ', 'landlord_onboarding',
  E'# Steps\r\n1. Sign the agreement\r\n2. Book the inspection\r\n', 'How we welcome a landlord.', null, null, null);
select pg_temp.unbecome();
select is(pg_temp.r('a') ->> 'title', 'Landlord onboarding checklist [test]', 'create: the title is trimmed');
select ok(pg_temp.r('a') ->> 'ref' ~ '^KB-[0-9]{4,}$', 'create: the result carries a KB-0001 style ref');
select is(pg_temp.r('a') ->> 'status', 'draft', 'create: a new document is a draft');
select is((pg_temp.r('a') ->> 'version')::int, 1, 'create: version 1');
select is((select owner_id from hq.knowledge_documents where id = pg_temp.kd('a')), pg_temp.fx('va'), 'create: the owner defaults to the creator');
select is((select created_by from hq.knowledge_documents where id = pg_temp.kd('a')), pg_temp.fx('va'), 'create: created_by is the caller');
select is((select body from hq.knowledge_versions where document_id = pg_temp.kd('a') and version = 1), E'# Steps\n1. Sign the agreement\n2. Book the inspection',
  'create: the body keeps its lines (CR LF to LF) and is trimmed');
select is((select change_note || '|' || via || '|' || edited_by_name from hq.knowledge_versions where document_id = pg_temp.kd('a') and version = 1), 'First draft|hq|Val Assistant',
  'create: version 1 records the default note, the channel and who');
select is(pg_temp.audits(pg_temp.kd('a'), 'create'), 1::bigint, 'create: one audit row (entity knowledge_document)');

select pg_temp.become('ro');
select is((select status_label || '|' || reading_is_draft::text || '|' || has_pending_draft::text from hq.knowledge_overview where id = pg_temp.kd('a')), 'Draft|true|true',
  'read-only: a never-approved document reads "Draft" and is flagged as draft text');
select is((select body from hq.knowledge_overview where id = pg_temp.kd('a')), E'# Steps\n1. Sign the agreement\n2. Book the inspection', 'read-only: sees the draft text of a never-approved document');
select pg_temp.unbecome();

-- ------------------------------------------------------------ validation
select pg_temp.become('dir');
select throws_ok($$select hq.create_knowledge_document('   ', 'general', 'body')$$, '22023', 'a document needs a title', 'a blank title is refused');
select throws_ok(format($$select hq.create_knowledge_document(%L, 'general', 'body')$$, repeat('t', 201)), '22023', 'a title is at most 200 characters', 'a 201-character title is refused');
select throws_ok($$select hq.create_knowledge_document('x [test]', null, 'body')$$, '22023', 'choose a category', 'a category is required');
select throws_ok($$select hq.create_knowledge_document('x [test]', 'general', E'  \n ')$$, '22023', 'a document needs some text', 'an empty body is refused');
select throws_ok(format($$select hq.create_knowledge_document('x [test]', 'general', %L)$$, repeat('b', 50001)), '22023', 'the text is at most 50000 characters', 'a 50001-character body is refused');
select throws_ok(format($$select hq.create_knowledge_document('x [test]', 'general', 'b', %L)$$, repeat('s', 501)), '22023', 'a summary is at most 500 characters', 'a 501-character summary is refused');
select throws_ok(format($$select hq.create_knowledge_document('x [test]', 'general', 'b', null, null, null, %L)$$, repeat('n', 301)), '22023', 'a change note is at most 300 characters', 'a 301-character note is refused');
select throws_ok(format($$select hq.create_knowledge_document('x [test]', 'general', 'b', null, %L)$$, pg_temp.fx('outsider')), '22023', 'the owner must be an active member of staff', 'a non-staff owner is refused');
select throws_ok($$select hq.create_knowledge_document('x [test]', 'general', 'b', null, null, hq.today() - 1)$$, '22023', 'a review date is today or later, at most five years ahead', 'a review date in the past is refused');
select throws_ok($$select hq.create_knowledge_document('LANDLORD onboarding checklist, [test]', 'general', 'b')$$, '23514', 'another document already has that title', 'a title already used by a live document is refused (normalised)');
insert into zz_r select 'big', hq.create_knowledge_document(repeat('t', 200), 'general', repeat('b', 50000), repeat('s', 500), null, hq.today() + 1826, repeat('n', 300));
select is((select char_length(title) || '/' || char_length(summary) from hq.knowledge_documents where id = pg_temp.kd('big')), '200/500', 'the boundary lengths (200, 500, 50000, 300, five years) are accepted');
select pg_temp.unbecome();

-- ------------------------------------------------------------ no direct writes; versions are append-only
select pg_temp.become('dir');
select throws_ok($$insert into hq.knowledge_documents (title, category) values ('Direct [test]', 'general')$$, '42501', null, 'a director cannot insert a document directly');
select throws_ok(format($$update hq.knowledge_versions set body = 'changed' where document_id = %L$$, pg_temp.kd('a')), '42501', null, 'a director cannot update a version directly');
select throws_ok(format($$delete from hq.knowledge_versions where document_id = %L$$, pg_temp.kd('a')), '42501', null, 'a director cannot delete a version');
select pg_temp.unbecome();
select throws_ok(format($$update hq.knowledge_versions set body = 'changed' where document_id = %L and version = 1$$, pg_temp.kd('a')), '42501', 'a saved version never changes: save a new version instead', 'append-only: even the table owner cannot change a version''s words');
select throws_ok(format($$delete from hq.knowledge_versions where document_id = %L$$, pg_temp.kd('a')), '42501', null, 'append-only: even the table owner cannot delete a version');
select throws_ok($$truncate hq.knowledge_versions$$, '42501', null, 'append-only: truncate raises');
select throws_ok(format($$delete from hq.knowledge_documents where id = %L$$, pg_temp.kd('a')), '42501', null, 'a document is never deleted');
select throws_ok(format($$update hq.knowledge_versions set status = 'approved' where document_id = %L and version = 1$$, pg_temp.kd('a')), '23514', null, 'a version cannot be marked approved without the approval');

-- ------------------------------------------------------------ edit: a new draft each time
select pg_temp.become('va');
insert into zz_r select 'e2', hq.edit_knowledge_document(pg_temp.kd('a'), 1, 'Added the keys step', null, null,
  E'# Steps\n1. Sign the agreement\n2. Book the inspection\n3. Collect the keys');
select pg_temp.unbecome();
select is((pg_temp.r('e2') ->> 'version')::int, 2, 'edit: saves version 2');
select is(pg_temp.r('e2') -> 'changed_fields', '["body"]'::jsonb, 'edit: says which parts changed');
select is(pg_temp.vstatus(pg_temp.kd('a'), 1) || '|' || pg_temp.vstatus(pg_temp.kd('a'), 2), 'superseded|draft', 'edit: the earlier draft is superseded, the new one is the draft');
select is((select based_on_version from hq.knowledge_versions where document_id = pg_temp.kd('a') and version = 2), 1, 'edit: records which version it was based on');
select pg_temp.become('ro');
select is((select count(*) from hq.knowledge_versions where document_id = pg_temp.kd('a')), 1::bigint, 'read-only: of a never-approved document, sees only the current draft (not the replaced one)');
select pg_temp.unbecome();

-- approve version 2 (the director)
select pg_temp.become('pm');
select throws_ok(format($$select hq.approve_knowledge_version(%L, 2)$$, pg_temp.kd('a')), '42501', null, 'a property manager (writer, not approver) cannot approve');
select pg_temp.unbecome();
select pg_temp.become('dir');
select throws_ok(format($$select hq.approve_knowledge_version(%L, 1)$$, pg_temp.kd('a')), '23514', 'only the latest draft can be approved; version 1 is superseded', 'only the latest draft can be approved');
insert into zz_r select 'ap2', hq.approve_knowledge_version(pg_temp.kd('a'), 2);
select pg_temp.unbecome();
select is((select status::text || '|' || approved_version || '|' || current_version from hq.knowledge_documents where id = pg_temp.kd('a')), 'approved|2|2', 'approve: the document is approved at version 2');
select is((select approved_by || '|' || approved_via from hq.knowledge_versions where document_id = pg_temp.kd('a') and version = 2), pg_temp.fx('dir') || '|hq', 'approve: who approved, through HQ');
select is(pg_temp.audits(pg_temp.kd('a'), 'approve'), 1::bigint, 'approve: one audit row (action approve)');

-- THE RULE: an edit after approval creates a draft; readers keep the approved text
select pg_temp.become('va');
insert into zz_r select 'e3', hq.edit_knowledge_document(pg_temp.kd('a'), 2, 'Changed the order', 'Landlord onboarding [test]', null,
  E'# Steps\n1. Book the inspection\n2. Sign the agreement\n3. Collect the keys');
select pg_temp.unbecome();
select is((select title from hq.knowledge_documents where id = pg_temp.kd('a')), 'Landlord onboarding checklist [test]', 'THE RULE: the approved title is unchanged by an edit');
select pg_temp.become('ro');
select is((select body from hq.knowledge_overview where id = pg_temp.kd('a')), E'# Steps\n1. Sign the agreement\n2. Book the inspection\n3. Collect the keys',
  'THE RULE: a reader still gets the approved body after an edit');
select is((select status_label || '|' || reading_is_draft::text || '|' || reading_version from hq.knowledge_overview where id = pg_temp.kd('a')), 'Approved, newer draft waiting|false|2',
  'THE RULE: the status says a newer draft is waiting');
select is((select count(*) from hq.knowledge_versions where document_id = pg_temp.kd('a') and version = 3), 0::bigint, 'read-only cannot see the pending draft');
select pg_temp.unbecome();
select pg_temp.become('jpm');
select is((select body from hq.knowledge_overview where id = pg_temp.kd('a')), E'# Steps\n1. Sign the agreement\n2. Book the inspection\n3. Collect the keys', 'junior: reads the approved body');
select is((select count(*) from hq.knowledge_versions where document_id = pg_temp.kd('a') and version = 3), 0::bigint, 'junior cannot see the pending draft');
select pg_temp.unbecome();
select pg_temp.become('pm');
select is((select title from hq.knowledge_versions where document_id = pg_temp.kd('a') and version = 3), 'Landlord onboarding [test]', 'a writer sees the pending draft');
-- concurrency: the property manager opened version 2, the assistant saved 3 since
select throws_ok(format($$select hq.edit_knowledge_document(%L, 2, 'Late edit', null, null, 'something else')$$, pg_temp.kd('a')), '23514',
  'this document was changed by someone else since you opened it; reload it and edit again', 'concurrency: an edit based on an old version is refused');
select throws_ok(format($$select hq.edit_knowledge_document(%L, null, 'No base', null, null, 'something else')$$, pg_temp.kd('a')), '23514', null, 'concurrency: an edit with no base version is refused');
select pg_temp.unbecome();
select pg_temp.become('va');
select throws_ok(format($$select hq.edit_knowledge_document(%L, 3, 'Same again', 'Landlord onboarding [test]', null, %L)$$, pg_temp.kd('a'), E'# Steps\n1. Book the inspection\n2. Sign the agreement\n3. Collect the keys'),
  '22023', 'nothing changed: the text is the same as version 3', 'a no-change edit is refused');
select throws_ok(format($$select hq.edit_knowledge_document(%L, 3, '   ', null, null, 'x')$$, pg_temp.kd('a')), '22023', 'say what changed in a short change note', 'an edit needs a change note');
select pg_temp.unbecome();
select is((select count(*) from hq.knowledge_versions where document_id = pg_temp.kd('a')), 3::bigint, 'refused edits saved nothing');
-- the approved wording on the document row is protected for every writer
select throws_ok(format($$update hq.knowledge_documents set title = 'Silently changed' where id = %L$$, pg_temp.kd('a')), '42501', 'approved wording changes only by approving a new version',
  'THE RULE: even the table owner cannot change the approved title without approving a version');

-- approve version 3: version 2 is superseded (kept, still readable as previously approved)
select pg_temp.become('adm');
insert into zz_r select 'ap3', hq.approve_knowledge_version(pg_temp.kd('a'), 3);
select pg_temp.unbecome();
select is(pg_temp.vstatus(pg_temp.kd('a'), 2) || '|' || pg_temp.vstatus(pg_temp.kd('a'), 3), 'superseded|approved', 'approve: the previous approved version is superseded, the new one approved');
select is((select approved_at is not null from hq.knowledge_versions where document_id = pg_temp.kd('a') and version = 2), true, 'approve: the superseded version keeps its approval record');
select is((pg_temp.r('ap3') ->> 'previous_approved_version')::int, 2, 'approve: reports the version it replaced');
select is((select title from hq.knowledge_documents where id = pg_temp.kd('a')), 'Landlord onboarding [test]', 'approve: the document takes the approved title');
select pg_temp.become('ro');
select is((select body from hq.knowledge_overview where id = pg_temp.kd('a')), E'# Steps\n1. Book the inspection\n2. Sign the agreement\n3. Collect the keys', 'read-only: now reads version 3');
select is((select array_agg(version order by version) from hq.knowledge_versions where document_id = pg_temp.kd('a')), array[2, 3], 'read-only: sees the approved and previously approved versions only');
select pg_temp.unbecome();

-- ------------------------------------------------------------ discard
select pg_temp.become('va');
insert into zz_r select 'e4', hq.edit_knowledge_document(pg_temp.kd('a'), 3, 'Try a summary', null, 'A short summary [test]', null);
select pg_temp.unbecome();
select pg_temp.become('pm');
select throws_ok(format($$select hq.discard_knowledge_draft(%L, 4)$$, pg_temp.kd('a')), '42501', 'only the person who wrote this draft, or an approver, can discard it', 'a writer cannot discard someone else''s draft');
select pg_temp.unbecome();
select pg_temp.become('va');
select throws_ok(format($$select hq.discard_knowledge_draft(%L, 3)$$, pg_temp.kd('a')), '23514', null, 'an approved version cannot be discarded');
insert into zz_r select 'd4', hq.discard_knowledge_draft(pg_temp.kd('a'), 4, 'Not needed');
select pg_temp.unbecome();
select is(pg_temp.vstatus(pg_temp.kd('a'), 4), 'discarded', 'discard: the draft is kept as discarded');
select is((select current_version || '|' || approved_version || '|' || status from hq.knowledge_documents where id = pg_temp.kd('a')), '3|3|approved', 'discard: the document is back on its approved version');
select is((select status_label from hq.knowledge_overview where id = pg_temp.kd('a')), 'Approved', 'discard: no draft is waiting any more');
select is(pg_temp.audits(pg_temp.kd('a'), 'discard_draft'), 1::bigint, 'discard: one audit row');
select pg_temp.become('dir');
insert into zz_r select 'b', hq.create_knowledge_document('Plumber vetting [test]', 'contractor_vetting', 'Check the licence.');
select throws_ok(format($$select hq.discard_knowledge_draft(%L, 1)$$, pg_temp.kd('b')), '23514', null, 'a never-approved document''s only draft cannot be discarded (edit or archive it)');
select pg_temp.unbecome();

-- ------------------------------------------------------------ restore an older version as a new draft
select pg_temp.become('va');
insert into zz_r select 'rs', hq.restore_knowledge_version(pg_temp.kd('a'), 2, 3);
select throws_ok(format($$select hq.restore_knowledge_version(%L, 2, 3)$$, pg_temp.kd('a')), '23514', null, 'restore: refused when the base version is stale');
select pg_temp.unbecome();
select is((pg_temp.r('rs') ->> 'version')::int || '|' || (pg_temp.r('rs') ->> 'restored_from'), '5|2', 'restore: version 5 copies version 2');
select is((select body from hq.knowledge_versions where document_id = pg_temp.kd('a') and version = 5), (select body from hq.knowledge_versions where document_id = pg_temp.kd('a') and version = 2), 'restore: the text is version 2''s');
select is((select change_note from hq.knowledge_versions where document_id = pg_temp.kd('a') and version = 5), 'Restored from version 2', 'restore: a default change note');
select is((select approved_version from hq.knowledge_documents where id = pg_temp.kd('a')), 3, 'restore: nothing approved changes until someone approves');
select pg_temp.become('dir');
insert into zz_r select 'd5', hq.discard_knowledge_draft(pg_temp.kd('a'), 5);
select throws_ok(format($$select hq.restore_knowledge_version(%L, 3, 3)$$, pg_temp.kd('a')), '22023', null, 'restore: the same text as the current version is refused');
select pg_temp.unbecome();
select is(pg_temp.vstatus(pg_temp.kd('a'), 5), 'discarded', 'an approver may discard someone else''s draft');

-- ------------------------------------------------------------ a connected chat app
select pg_temp.become_app('dir');
insert into zz_r select 'e6', hq.edit_knowledge_document(pg_temp.kd('a'), 3, 'Edited from chat', null, null, E'# Steps\n1. Book the inspection\n2. Sign the agreement\n3. Collect the keys\n4. Confirm the owner has an Ailo invitation');
select throws_ok(format($$select hq.approve_knowledge_version(%L, 6)$$, pg_temp.kd('a')), '42501', 'a knowledge document is approved in HQ, not through a connected app', 'chat: approving is refused while the switch is off');
select pg_temp.unbecome();
select is((select via || '|' || mcp_client_id || '|' || status from hq.knowledge_versions where document_id = pg_temp.kd('a') and version = 6), 'mcp|test-chat-app|draft', 'chat: an edit from a connected app is a draft marked as made through it');
select is((select approved_version from hq.knowledge_documents where id = pg_temp.kd('a')), 3, 'chat: the approved version is untouched');
update hq.settings set value = 'true'::jsonb where key = 'knowledge_chat_approve_enabled';
select pg_temp.become_app('pm');
select throws_ok(format($$select hq.approve_knowledge_version(%L, 6)$$, pg_temp.kd('a')), '42501', null, 'chat, switch on: a writer without knowledge.approve is still refused');
select pg_temp.unbecome();
select pg_temp.become_app('dir');
insert into zz_r select 'ap6', hq.approve_knowledge_version(pg_temp.kd('a'), 6);
select pg_temp.unbecome();
select is((select approved_via from hq.knowledge_versions where document_id = pg_temp.kd('a') and version = 6), 'mcp', 'chat, switch on: an approver may approve; recorded as through the app');
select ok((select summary from hq.audit_events where entity_type = 'knowledge_document' and entity_id = pg_temp.kd('a') and action = 'approve' order by id desc limit 1) like '%(through a connected app)%', 'chat: the audit says the approval came through a connected app');
update hq.settings set value = 'false'::jsonb where key = 'knowledge_chat_approve_enabled';

-- ------------------------------------------------------------ owner, review date, category
select pg_temp.become('jpm');
select throws_ok(format($$select hq.set_knowledge_review(%L, null, hq.today())$$, pg_temp.kd('a')), '42501', null, 'junior: cannot set the review date');
select pg_temp.unbecome();
select pg_temp.become('pm');
insert into zz_r select 'rv', hq.set_knowledge_review(pg_temp.kd('a'), pg_temp.fx('spm'), hq.today(), false, 'company_procedure');
select throws_ok(format($$select hq.set_knowledge_review(%L, null, hq.today() - 1)$$, pg_temp.kd('a')), '22023', null, 'review: yesterday is refused');
select throws_ok(format($$select hq.set_knowledge_review(%L, null, hq.today() + 1827)$$, pg_temp.kd('a')), '22023', null, 'review: more than five years ahead is refused');
select throws_ok(format($$select hq.set_knowledge_review(%L, %L)$$, pg_temp.kd('a'), pg_temp.fx('outsider')), '22023', 'the owner must be an active member of staff', 'review: a non-staff owner is refused');
select is((hq.set_knowledge_review(pg_temp.kd('a'), pg_temp.fx('spm')) ->> 'changed')::boolean, false, 'review: nothing to change is reported, nothing written');
select pg_temp.unbecome();
select is(pg_temp.r('rv') -> 'changed_fields', '["owner", "review_due", "category"]'::jsonb, 'review: owner, review date and category changed together');
select is((select approved_version || '|' || title from hq.knowledge_documents where id = pg_temp.kd('a')), '6|Landlord onboarding [test]', 'review: the approved words are not touched');
select pg_temp.become('ro');
select is((select coalesce(review_state, '-') || '|' || review_overdue::text || '|' || owner_name from hq.knowledge_overview where id = pg_temp.kd('a')), 'due_soon|false|Sam Senior', 'review boundary: due today is due, not overdue; the owner''s name is shown');
select pg_temp.unbecome();
update hq.knowledge_documents set review_due = hq.today() - 1 where id = pg_temp.kd('a');
select is((select review_state || '|' || review_overdue::text from hq.knowledge_overview where id = pg_temp.kd('a')), 'overdue|true', 'review boundary: yesterday is overdue');
update hq.knowledge_documents set review_due = hq.today() + 30 where id = pg_temp.kd('a');
select is((select review_state || '|' || review_overdue::text from hq.knowledge_overview where id = pg_temp.kd('a')), 'due_soon|false', 'review boundary: 30 days ahead is due soon');
update hq.knowledge_documents set review_due = hq.today() + 31 where id = pg_temp.kd('a');
select is((select coalesce(review_state, 'none') || '|' || review_overdue::text from hq.knowledge_overview where id = pg_temp.kd('a')), 'none|false', 'review boundary: 31 days ahead is not yet due');
select pg_temp.become('pm');
select is((hq.set_knowledge_review(pg_temp.kd('a'), null, null, true) -> 'changed_fields'), '["review_due"]'::jsonb, 'review: the date can be cleared');
select pg_temp.unbecome();
update hq.staff_profiles set is_active = false where id = pg_temp.fx('bdm');
select pg_temp.become('pm');
select throws_ok(format($$select hq.set_knowledge_review(%L, %L)$$, pg_temp.kd('a'), pg_temp.fx('bdm')), '22023', 'the owner must be an active member of staff', 'review: an inactive owner is refused');
select pg_temp.unbecome();
update hq.staff_profiles set is_active = true where id = pg_temp.fx('bdm');

-- ------------------------------------------------------------ titles stay unique among live documents
select pg_temp.become('dir');
select throws_ok(format($$select hq.edit_knowledge_document(%L, 1, 'Rename', 'Landlord Onboarding [TEST]')$$, pg_temp.kd('b')), '23514', 'another document already has that title', 'edit: a title another live document holds is refused');
select pg_temp.unbecome();

-- ------------------------------------------------------------ templates cannot be approved until written
create temp table zz_t on commit drop as select id from hq.knowledge_documents where is_template and title = '[Template] Voice and tone (replace me)' limit 1;
grant select on zz_t to public;
update hq.knowledge_documents set deleted_at = null where id = (select id from zz_t);
select pg_temp.become('dir');
select throws_ok(format($$select hq.approve_knowledge_version(%L, (select current_version from hq.knowledge_documents where id = %L))$$, (select id from zz_t), (select id from zz_t)),
  '23514', 'this is a starter template: replace its text with your own before approving it', 'a starter template cannot be approved');
insert into zz_r select 'tw', hq.edit_knowledge_document((select id from zz_t), (select current_version from hq.knowledge_documents where id = (select id from zz_t)),
  'Written our voice', 'Voice and tone [test]', '', 'We sound like ourselves. [test]');
select pg_temp.unbecome();
select is((select is_template::text || '|' || title from hq.knowledge_documents where id = (select id from zz_t)), 'false|Voice and tone [test]', 'the first edit turns a template into an ordinary draft (title follows the draft while never approved)');
select throws_ok(format($$update hq.knowledge_documents set is_template = true where id = %L$$, (select id from zz_t)), '42501', null, 'a document never becomes a template again');

-- ------------------------------------------------------------ archive and restore
select pg_temp.become('pm');
select throws_ok(format($$select hq.archive_record('knowledge_document', %L)$$, pg_temp.kd('b')), '42501', null, 'a property manager cannot archive a document');
select pg_temp.unbecome();
select pg_temp.become('dir');
select is((hq.archive_record('knowledge_document', pg_temp.kd('b'), 'test') ->> 'changed')::boolean, true, 'a director archives a document');
select is((select status::text from hq.knowledge_documents where id = pg_temp.kd('b')), 'archived', 'archive: the status follows');
select is((select count(*) from hq.knowledge_overview where id = pg_temp.kd('b')), 1::bigint, 'archive: an approver still sees it (to restore it)');
select throws_ok(format($$select hq.edit_knowledge_document(%L, 1, 'x', null, null, 'y')$$, pg_temp.kd('b')), 'P0002', 'document not found', 'archive: an archived document cannot be edited');
select pg_temp.unbecome();
select pg_temp.become('va');
select is((select count(*) from hq.knowledge_overview where id = pg_temp.kd('b')), 0::bigint, 'archive: a writer no longer sees it');
select is((select count(*) from hq.knowledge_versions where document_id = pg_temp.kd('b')), 0::bigint, 'archive: nor its versions');
select pg_temp.unbecome();
select pg_temp.become('dir');
select is((hq.restore_record('knowledge_document', pg_temp.kd('b')) ->> 'changed')::boolean, true, 'a director restores it');
select pg_temp.unbecome();
select is((select status::text from hq.knowledge_documents where id = pg_temp.kd('b')), 'draft', 'restore: back to draft (never approved)');
select is(pg_temp.audits(pg_temp.kd('b'), 'archive') || '|' || pg_temp.audits(pg_temp.kd('b'), 'restore'), '1|1', 'archive and restore are audited');

-- ------------------------------------------------------------ RLS: who reads what
select pg_temp.become('outsider');
select is((select count(*) from hq.knowledge_documents), 0::bigint, 'non-staff: no documents');
select is((select count(*) from hq.knowledge_versions), 0::bigint, 'non-staff: no versions');
select pg_temp.unbecome();
select pg_temp.become('dir', 'aal1');
select is((select count(*) from hq.knowledge_overview), 0::bigint, 'aal1 with require_mfa: no documents');
select pg_temp.unbecome();
select pg_temp.become('jpm');
select is((select count(*) from hq.knowledge_overview where id in (pg_temp.kd('a'), pg_temp.kd('b'))), 2::bigint, 'junior: reads live documents');
select is((select array_agg(version order by version) from hq.knowledge_versions where document_id = pg_temp.kd('a')), array[2, 3, 6], 'junior: sees only the approved and previously approved versions of A');
select pg_temp.unbecome();
select pg_temp.become('va');
select is((select count(*) from hq.knowledge_versions where document_id = pg_temp.kd('a')), 6::bigint, 'writer: sees every version of A, discarded included');
select pg_temp.unbecome();

-- ------------------------------------------------------------ the audit trail
select is(pg_temp.audits(pg_temp.kd('a'), 'edit'), 4::bigint, 'audit: one edit row per saved draft (versions 2, 3, 4, 6)');
select is(pg_temp.audits(pg_temp.kd('a'), 'approve'), 3::bigint, 'audit: one approve row per approval (2, 3, 6)');
select is(pg_temp.audits(pg_temp.kd('a'), 'discard_draft'), 2::bigint, 'audit: two discards');
select is(pg_temp.audits(pg_temp.kd('a'), 'restore_version'), 1::bigint, 'audit: one restore as draft');
select is((select count(*) from hq.audit_events where entity_type = 'knowledge_document' and entity_id = pg_temp.kd('a') and action = 'update' and actor_id = pg_temp.fx('pm')), 2::bigint, 'audit: two review / owner / category changes by the property manager (a no-change call writes none)');
select ok((select summary from hq.audit_events where entity_type = 'knowledge_document' and entity_id = pg_temp.kd('a') and action = 'edit' order by id limit 1) like 'Edit knowledge_document: % [Added the keys step]', 'audit: the summary names the document and the change note');
select is((select actor_id from hq.audit_events where entity_type = 'knowledge_document' and entity_id = pg_temp.kd('a') and action = 'create'), pg_temp.fx('va'), 'audit: the actor is the person');

select * from finish();
rollback;
