-- Planted HQ Phase 2: who may do what with contractors. Forged callers (a signed-in person with no
-- staff row, an aal1 session under require_mfa, read_only, a junior property manager, a business
-- development manager), document files versus document rows, wrong-id forgeries, and the roles that
-- may write, upload and approve.
begin;
\ir hq_fixture.inc
\ir hq_contractor_fixture.inc
select pg_temp.seed_hq();
select pg_temp.seed_contractors();
select plan(93);

-- a registered licence for c_plumb: the stored object and its row (system write)
select pg_temp.mk_document('doc1', pg_temp.fx('c_plumb'), 'licence', hq.today() + 200);

create function pg_temp.contractor_rows() returns bigint
language sql as $$
  select (select count(*) from hq.contractors) + (select count(*) from hq.contractor_vetting_steps) + (select count(*) from hq.contractor_documents)
       + (select count(*) from hq.contractor_reviews) + (select count(*) from hq.contractor_status_history) + (select count(*) from hq.contractor_directory)
       + (select count(*) from hq.contractor_expiry_watch) + (select count(*) from hq.contractor_timeline)
$$;
create function pg_temp.files_visible() returns bigint
language sql as $$ select count(*) from storage.objects where bucket_id = 'contractor-documents' $$;

-- every write RPC, called with plausible arguments; returns the SQL text for throws_ok
create function pg_temp.write_calls() returns table (label text, call text)
language sql as $$
  select * from (values
    ('set_vetting_step', format($f$select hq.set_vetting_step(%L, 'identity', 'done')$f$, pg_temp.fx('c_plumb'))),
    ('approve_contractor', format($f$select hq.approve_contractor(%L, false, 'ok')$f$, pg_temp.fx('c_plumb'))),
    ('set_contractor_status', format($f$select hq.set_contractor_status(%L, 'contacted')$f$, pg_temp.fx('c_plumb'))),
    ('reinstate_contractor', format($f$select hq.reinstate_contractor(%L, 'ok')$f$, pg_temp.fx('c_plumb'))),
    ('add_contractor_document', format($f$select hq.add_contractor_document(%L, 'licence', 'x.pdf', %L, 'application/pdf', 1000)$f$, pg_temp.fx('c_plumb'), pg_temp.doc_path(pg_temp.fx('c_plumb')))),
    ('verify_contractor_document', format($f$select hq.verify_contractor_document(%L, 'verified')$f$, pg_temp.fx('doc1'))),
    ('record_contractor_review', format($f$select hq.record_contractor_review(%L, p_work_quality := 4)$f$, pg_temp.fx('c_plumb'))),
    ('record_contractor_contact', format($f$select hq.record_contractor_contact(%L, 'phone_call', null, 'Called')$f$, pg_temp.fx('c_plumb'))),
    ('create_expiry_tasks', $f$select hq.create_expiry_tasks()$f$),
    ('preview_contractor_import', $f$select hq.preview_contractor_import('[{"business_name": "X", "categories": ["other"]}]'::jsonb)$f$),
    ('apply_contractor_import', $f$select hq.apply_contractor_import('[{"business_name": "X", "categories": ["other"]}]'::jsonb, 'x')$f$),
    ('archive_record contractor', format($f$select hq.archive_record('contractor', %L)$f$, pg_temp.fx('c_plumb'))),
    ('restore_record contractor', format($f$select hq.restore_record('contractor', %L)$f$, pg_temp.fx('c_plumb')))
  ) v(label, call)
$$;

-- ------------------------------------------------------------ a signed-in person with no HQ profile
select pg_temp.become('outsider');
select is(pg_temp.contractor_rows(), 0::bigint, 'non-staff: every contractor table and view returns zero rows');
select is(pg_temp.files_visible(), 0::bigint, 'non-staff: no document file is visible');
select is(hq.global_search('plumbing', 5) -> 'contractors', '[]'::jsonb, 'non-staff: global_search finds no contractor');
select throws_ok($$insert into hq.contractors (business_name, categories) values ('Outsider Co', '{other}')$$, '42501', null, 'non-staff cannot insert a contractor');
select throws_ok(w.call, '42501', null, 'non-staff cannot ' || w.label) from pg_temp.write_calls() w;
select throws_ok(format($$select hq.preview_contractor_approval(%L)$$, pg_temp.fx('c_plumb')), '42501', null, 'non-staff cannot preview_contractor_approval');
select throws_ok($$select hq.contractor_summary()$$, '42501', null, 'non-staff cannot contractor_summary');
select throws_ok(format($$insert into storage.objects (bucket_id, name, metadata) values ('contractor-documents', %L, '{}')$$, pg_temp.doc_path(pg_temp.fx('c_plumb'))),
  '42501', null, 'non-staff cannot upload a file');
select pg_temp.unbecome();

-- ------------------------------------------------------------ aal1 under require_mfa
select pg_temp.become('dir', 'aal1');
select is(pg_temp.contractor_rows(), 0::bigint, 'aal1 with require_mfa: no contractor data is readable');
select is(pg_temp.files_visible(), 0::bigint, 'aal1 with require_mfa: no file is visible');
select throws_ok($$insert into hq.contractors (business_name, categories) values ('Aal1 Co', '{other}')$$, '42501', null, 'aal1 with require_mfa: no writes');
select throws_ok(format($$select hq.approve_contractor(%L, false, 'ok')$$, pg_temp.fx('c_plumb')), '42501', null, 'aal1 with require_mfa: a director cannot approve');
select pg_temp.unbecome();

-- ------------------------------------------------------------ read_only: read, never write
select pg_temp.become('ro');
select is((select count(*) from hq.contractors where id in (pg_temp.fx('c_plumb'), pg_temp.fx('c_spark'))), 2::bigint, 'read_only can read contractors');
select is((select document_type::text || '|' || verification::text from hq.contractor_documents where id = pg_temp.fx('doc1')), 'licence|pending',
  'read_only sees that a document exists (type and verification status)');
select is(pg_temp.files_visible(), 0::bigint, 'read_only cannot read the document FILE (no contractors.documents)');
select throws_ok($$insert into hq.contractors (business_name, categories) values ('RO Co', '{other}')$$, '42501', null, 'read_only cannot insert a contractor');
update hq.contractors set business_name = 'Renamed by read_only' where id = pg_temp.fx('c_plumb');
select throws_ok(w.call, '42501', null, 'read_only cannot ' || w.label) from pg_temp.write_calls() w;
select throws_ok(format($$insert into storage.objects (bucket_id, name, metadata) values ('contractor-documents', %L, '{}')$$, pg_temp.doc_path(pg_temp.fx('c_plumb'))),
  '42501', null, 'read_only cannot upload a file');
select ok((hq.contractor_summary() ->> 'total')::int >= 2, 'read_only can read the contractor summary');
select ok((hq.preview_contractor_approval(pg_temp.fx('c_plumb')) -> 'blocked_by') ? 'not_permitted', 'read_only: the approval preview says not_permitted');
select pg_temp.unbecome();
select is((select business_name from hq.contractors where id = pg_temp.fx('c_plumb')), 'Test Plumbing Co', 'read_only update changed nothing (RLS filtered the row)');

-- ------------------------------------------------------------ junior property manager: read only
select pg_temp.become('jpm');
select is((select count(*) from hq.contractor_directory where id in (pg_temp.fx('c_plumb'), pg_temp.fx('c_spark'))), 2::bigint, 'junior can read the contractor directory');
select is((select count(*) from hq.contractor_documents where id = pg_temp.fx('doc1')), 1::bigint, 'junior sees the document row');
select is(pg_temp.files_visible(), 0::bigint, 'junior cannot read the document file');
select throws_ok($$insert into hq.contractors (business_name, categories) values ('Junior Co', '{other}')$$, '42501', null, 'junior cannot create a contractor');
select throws_ok(format($$select hq.set_vetting_step(%L, 'identity', 'done')$$, pg_temp.fx('c_plumb')), '42501', null, 'junior cannot set a vetting step');
select throws_ok(format($$select hq.record_contractor_review(%L, p_work_quality := 5)$$, pg_temp.fx('c_plumb')), '42501', null, 'junior cannot record feedback');
select throws_ok(format($$select hq.set_contractor_status(%L, 'suspended', 'no')$$, pg_temp.fx('c_plumb')), '42501', null, 'junior cannot suspend');
update hq.contractors set status = 'contacted' where id = pg_temp.fx('c_plumb');
update hq.contractor_documents set notes = 'junior note' where id = pg_temp.fx('doc1');
select is(hq.global_search('Test Plumbing') -> 'contractors' -> 0 ->> 'title', 'Test Plumbing Co', 'junior finds contractors in search (contractors.read)');
select pg_temp.unbecome();
select is((select status::text from hq.contractors where id = pg_temp.fx('c_plumb')), 'prospect', 'junior status update changed nothing');
select is((select notes from hq.contractor_documents where id = pg_temp.fx('doc1')), null, 'junior document update changed nothing');

-- ------------------------------------------------------------ business development manager: import.run but not contractors.write
select pg_temp.become('bdm');
select throws_ok($$select hq.preview_contractor_import('[{"business_name": "X", "categories": ["other"]}]'::jsonb)$$, '42501', null, 'import.run alone cannot preview a contractor import');
select throws_ok($$select hq.apply_contractor_import('[{"business_name": "X", "categories": ["other"]}]'::jsonb, 'x')$$, '42501', null, 'import.run alone cannot apply a contractor import');
select is(pg_temp.files_visible(), 0::bigint, 'a business development manager cannot read document files');
select pg_temp.unbecome();
select pg_temp.become('va');
select throws_ok($$select hq.preview_contractor_import('[{"business_name": "X", "categories": ["other"]}]'::jsonb)$$, '42501', null, 'contractors.write alone (no import.run) cannot preview a contractor import');
select pg_temp.unbecome();

-- ------------------------------------------------------------ contractors.documents: files
select pg_temp.become('pm');
select is(pg_temp.files_visible(), 1::bigint, 'a property manager (contractors.documents) can read the file');
select lives_ok(format($$insert into storage.objects (bucket_id, name, metadata) values ('contractor-documents', %L, '{"size": 5, "mimetype": "application/pdf"}')$$,
  pg_temp.doc_path(pg_temp.fx('c_spark'), 'insurance.pdf')), 'a property manager can upload a file under a live contractor');
select throws_ok(format($$insert into storage.objects (bucket_id, name, metadata) values ('contractor-documents', %L, '{}')$$, pg_temp.doc_path(gen_random_uuid())),
  '42501', null, 'a file under a contractor that does not exist is refused');
select throws_ok(format($$insert into storage.objects (bucket_id, name, metadata) values ('contractor-documents', %L, '{}')$$, pg_temp.fx('c_plumb') || '/notes.pdf'),
  '42501', null, 'a file whose name is not <contractor>/<uuid>-<name> is refused');
select throws_ok(format($$insert into storage.objects (bucket_id, name, metadata) values ('contractor-documents', %L, '{}')$$, pg_temp.doc_path(pg_temp.fx('c_plumb'), 'bad name.pdf')),
  '42501', null, 'an unsanitised file name (a space) is refused');
select throws_ok(format($$insert into storage.objects (bucket_id, name, metadata) values ('other-bucket', %L, '{}')$$, pg_temp.doc_path(pg_temp.fx('c_plumb'))),
  '42501', null, 'the policy does not open any other bucket');
update storage.objects set metadata = '{"size": 1}'::jsonb where bucket_id = 'contractor-documents';
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects where bucket_id = 'contractor-documents';
select set_config('storage.allow_delete_query', 'false', true);
select pg_temp.unbecome();
select is((select count(*) from storage.objects where bucket_id = 'contractor-documents'
            and (name like pg_temp.fx('c_plumb') || '/%' or name like pg_temp.fx('c_spark') || '/%')), 2::bigint,
  'nobody can delete a file through the API (no delete policy): both objects remain');
select is((select count(*) from storage.objects where bucket_id = 'contractor-documents' and metadata = '{"size": 1}'::jsonb), 0::bigint, 'nobody can overwrite a file (no update policy)');
-- archiving the contractor hides its files from everyone but the approvers who can still see the contractor
select pg_temp.become('dir');
select lives_ok(format($$select hq.archive_record('contractor', %L, 'test')$$, pg_temp.fx('c_spark')), 'a director archives a contractor');
select pg_temp.become('pm');
select is((select count(*) from storage.objects where bucket_id = 'contractor-documents' and name like pg_temp.fx('c_spark') || '/%'), 0::bigint, 'files of an archived contractor are hidden from a property manager');
select throws_ok(format($$insert into storage.objects (bucket_id, name, metadata) values ('contractor-documents', %L, '{}')$$, pg_temp.doc_path(pg_temp.fx('c_spark'))),
  '42501', null, 'no new file can be added under an archived contractor');
select pg_temp.become('dir');
select is((select count(*) from storage.objects where bucket_id = 'contractor-documents' and name like pg_temp.fx('c_spark') || '/%'), 1::bigint, 'a director (who can see archived contractors) still reads its file');
select lives_ok(format($$select hq.restore_record('contractor', %L)$$, pg_temp.fx('c_spark')), 'a director restores it');
select pg_temp.unbecome();

-- ------------------------------------------------------------ who may write, upload, approve
select pg_temp.become('va');
select lives_ok($$insert into hq.contractors (business_name, categories) values ('Va Created Co', '{handyman}')$$, 'a virtual assistant can create a contractor');
select lives_ok(format($$select hq.set_vetting_step(%L, 'identity', 'in_progress')$$, pg_temp.fx('c_plumb')), 'a virtual assistant can work the checklist');
select throws_ok(format($$select hq.approve_contractor(%L, false, 'ok')$$, pg_temp.fx('c_plumb')), '42501', null, 'a virtual assistant cannot approve');
select throws_ok(format($$select hq.archive_record('contractor', %L)$$, pg_temp.fx('c_plumb')), '42501', null, 'a virtual assistant cannot archive a contractor');
select throws_ok($$insert into hq.contractors (business_name, categories, approved_at) values ('Forged Approval Co', '{other}', now())$$, '42501', null, 'approved_at cannot be named in an insert (column privilege)');
select throws_ok(format($$update hq.contractors set insurance_verified_at = current_date where id = %L$$, pg_temp.fx('c_plumb')), '42501', null, 'insurance_verified_at cannot be written directly');
select throws_ok(format($$update hq.contractor_vetting_steps set status = 'done' where contractor_id = %L$$, pg_temp.fx('c_plumb')), '42501', null, 'vetting steps cannot be written directly');
select throws_ok(format($$update hq.contractor_documents set verification = 'verified' where id = %L$$, pg_temp.fx('doc1')), '42501', null, 'a document cannot be verified by a direct update');
select lives_ok(format($$update hq.contractor_documents set notes = 'Front page only' where id = %L$$, pg_temp.fx('doc1')), 'a document''s notes can be edited directly');
select pg_temp.unbecome();
select is((select created_by from hq.contractors where business_name = 'Va Created Co'), pg_temp.fx('va'), 'created_by is stamped by the database');
select is((select notes from hq.contractor_documents where id = pg_temp.fx('doc1')), 'Front page only', 'the document note was saved');
select pg_temp.become('spm');
select lives_ok(format($$select hq.set_vetting_step(%L, 'abn', 'done')$$, pg_temp.fx('c_plumb')), 'a senior property manager can work the checklist');
select throws_ok(format($$select hq.reinstate_contractor(%L, 'ok')$$, pg_temp.fx('c_plumb')), '42501', null, 'a senior property manager cannot reinstate (contractors.approve)');
select pg_temp.become('adm');
select ok((hq.preview_contractor_approval(pg_temp.fx('c_plumb')) -> 'blocked_by') ? 'checklist_incomplete'
          and not ((hq.preview_contractor_approval(pg_temp.fx('c_plumb')) -> 'blocked_by') ? 'not_permitted'), 'an administrator may approve (only the checklist blocks)');
select pg_temp.unbecome();

-- ------------------------------------------------------------ wrong ids
select pg_temp.become('dir');
select throws_ok($$select hq.set_vetting_step(gen_random_uuid(), 'identity', 'done')$$, 'P0002', null, 'set_vetting_step: an unknown contractor is reported');
select throws_ok($$select hq.approve_contractor(gen_random_uuid(), false, 'ok')$$, 'P0002', null, 'approve_contractor: an unknown contractor is reported');
select throws_ok($$select hq.verify_contractor_document(gen_random_uuid(), 'verified')$$, 'P0002', null, 'verify_contractor_document: an unknown document is reported');
select throws_ok($$select hq.record_contractor_review(gen_random_uuid(), p_work_quality := 3)$$, 'P0002', null, 'record_contractor_review: an unknown contractor is reported');
select throws_ok(format($$select hq.add_contractor_document(%L, 'licence', 'x.pdf', %L, 'application/pdf', 1000)$$, pg_temp.fx('c_spark'), pg_temp.doc_path(pg_temp.fx('c_plumb'))),
  '22023', null, 'add_contractor_document: a path under ANOTHER contractor is refused');
select pg_temp.unbecome();
-- a deactivated director loses everything at once
update hq.staff_profiles set is_active = false where id = pg_temp.fx('dir2');
select pg_temp.become('dir2');
select is(pg_temp.contractor_rows(), 0::bigint, 'a deactivated person reads no contractor data');
select throws_ok(format($$select hq.approve_contractor(%L, false, 'ok')$$, pg_temp.fx('c_plumb')), '42501', null, 'a deactivated director cannot approve');
select pg_temp.unbecome();

select * from finish();
rollback;
