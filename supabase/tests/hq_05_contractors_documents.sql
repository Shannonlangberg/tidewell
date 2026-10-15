-- Planted HQ Phase 2: documents (register, verify, apply), expiry states on the boundary days, the
-- expiry watch, create_expiry_tasks (twice creates nothing the second time), the rating threshold,
-- job feedback, contractor_summary (with preferred coverage), the brief's directory example, and the
-- timeline.
begin;
\ir hq_fixture.inc
\ir hq_contractor_fixture.inc
select pg_temp.seed_hq();
select pg_temp.seed_contractors();
select plan(90);

create temp table zz (k text primary key, v jsonb) on commit drop;
grant select, insert, update on zz to public;
create function pg_temp.z(p_k text) returns jsonb language sql stable as $$ select v from zz where k = p_k $$;

-- ------------------------------------------------------------ add_contractor_document
select pg_temp.doc_path(pg_temp.fx('c_plumb'), 'Licence-2026.pdf') as p1 \gset
select pg_temp.become('pm');
select throws_ok(format($$select hq.add_contractor_document(%L, 'licence', 'Licence 2026.pdf', %L, 'application/pdf', 2048)$$, pg_temp.fx('c_plumb'), :'p1'),
  'P0002', 'the uploaded file was not found in storage', 'registering a file that was never uploaded is refused');
select pg_temp.unbecome();
select pg_temp.mk_object(:'p1', 2048, 'application/pdf');
select pg_temp.become('pm');
select throws_ok(format($$select hq.add_contractor_document(%L, 'licence', 'Licence 2026.pdf', %L, 'application/pdf', 2047)$$, pg_temp.fx('c_plumb'), :'p1'),
  '22023', 'the stored file size does not match the declared size', 'a declared size that differs from the stored object is refused');
select throws_ok(format($$select hq.add_contractor_document(%L, 'licence', 'Licence 2026.pdf', %L, 'image/png', 2048)$$, pg_temp.fx('c_plumb'), :'p1'),
  '22023', 'the stored file type does not match the declared type', 'a declared type that differs from the stored object is refused');
select throws_ok(format($$select hq.add_contractor_document(%L, 'licence', 'Licence 2026.txt', %L, 'text/plain', 2048)$$, pg_temp.fx('c_plumb'), :'p1'),
  '22023', null, 'only PDF, JPEG and PNG are accepted');
select throws_ok(format($$select hq.add_contractor_document(%L, 'licence', 'Big.pdf', %L, 'application/pdf', 10485761)$$, pg_temp.fx('c_plumb'), :'p1'),
  '22023', null, 'more than 10 MiB is refused');
select throws_ok(format($$select hq.add_contractor_document(%L, 'licence', 'Licence.pdf', 'not/a-path.pdf', 'application/pdf', 2048)$$, pg_temp.fx('c_plumb')),
  '22023', null, 'a malformed storage path is refused');
insert into zz select 'd1', hq.add_contractor_document(pg_temp.fx('c_plumb'), 'licence', 'Licence 2026.pdf', :'p1', 'application/pdf', 2048, hq.today() + 100, 'Front and back');
select throws_ok(format($$select hq.add_contractor_document(%L, 'licence', 'Licence 2026.pdf', %L, 'application/pdf', 2048)$$, pg_temp.fx('c_plumb'), :'p1'),
  '23505', 'that file is already registered', 'the same file cannot be registered twice');
select pg_temp.unbecome();
insert into fx values ('d1', (pg_temp.z('d1') ->> 'document_id')::uuid);
select is(pg_temp.fx('d1')::text, left(split_part(:'p1', '/', 2), 36), 'the document id is the uuid in the storage path');
select is((select verification::text || '|' || uploaded_by::text || '|' || size_bytes || '|' || expires_on::text from hq.contractor_documents where id = pg_temp.fx('d1')),
  'pending|' || pg_temp.fx('pm') || '|2048|' || (hq.today() + 100)::text, 'a new document is pending, uploaded by the caller, with the declared size and expiry');
select is((select count(*) from hq.audit_events where entity_type = 'contractor_document' and entity_id = pg_temp.fx('d1') and action = 'create'), 1::bigint, 'the upload is audited');

-- ------------------------------------------------------------ verify_contractor_document
select pg_temp.become('pm');
select throws_ok(format($$select hq.verify_contractor_document(%L, 'rejected')$$, pg_temp.fx('d1')), '22023', null, 'a rejection needs a note');
select throws_ok(format($$select hq.verify_contractor_document(%L, 'rejected', null, 'Blurry', true)$$, pg_temp.fx('d1')), '22023', null, 'only a verified document can be applied to the contractor');
select is(hq.verify_contractor_document(pg_temp.fx('d1'), 'verified', null, null, true) ->> 'applied_to_contractor', 'true', 'a licence is verified and applied');
select pg_temp.unbecome();
select is((select licence_verified_at::text || '|' || licence_expires_on::text from hq.contractors where id = pg_temp.fx('c_plumb')),
  hq.today()::text || '|' || (hq.today() + 100)::text, 'applying records licence_verified_at (today) and licence_expires_on (the document''s) on the contractor');
select is((select licence_state from hq.contractor_directory where id = pg_temp.fx('c_plumb')), 'current', 'the licence is now current');
select is((select verified_by from hq.contractor_documents where id = pg_temp.fx('d1')), pg_temp.fx('pm'), 'verified_by is the caller');
select is((select count(*) from hq.audit_events where entity_type = 'contractor_document' and entity_id = pg_temp.fx('d1') and action = 'verify'), 1::bigint, 'the verification is audited (verify)');
select is((select count(*) from hq.audit_events where entity_type = 'contractor' and entity_id = pg_temp.fx('c_plumb') and action = 'apply_document'), 1::bigint, 'applying it to the contractor is audited (apply_document)');
select pg_temp.mk_document('d_price', pg_temp.fx('c_plumb'), 'price_list');
select pg_temp.become('pm');
select throws_ok(format($$select hq.verify_contractor_document(%L, 'verified', null, null, true)$$, pg_temp.fx('d_price')), '22023', null, 'a price list cannot be applied to the contractor');
select is(hq.verify_contractor_document(pg_temp.fx('d_price'), 'rejected', null, 'Out of date') ->> 'verification', 'rejected', 'a document can be rejected with a note');
select is(hq.verify_contractor_document(pg_temp.fx('d_price'), 'pending') ->> 'verification', 'pending', '... and reset to pending');
select pg_temp.unbecome();
select ok((select verified_at is null and verified_by is null and verification_note is null from hq.contractor_documents where id = pg_temp.fx('d_price')), 'pending clears the review stamps');
select pg_temp.become('pm');
select is(hq.verify_contractor_document(pg_temp.fx('d_price'), 'verified', hq.today() + 400) ->> 'expires_on', (hq.today() + 400)::text, 'verifying can record the document''s expiry date');
select pg_temp.unbecome();
-- a hand-edited expiry date is no longer the verified one
select pg_temp.become('va');
update hq.contractors set licence_expires_on = hq.today() + 120 where id = pg_temp.fx('c_plumb');
select pg_temp.unbecome();
select is((select coalesce(licence_verified_at::text, 'cleared') || '|' || licence_state from hq.contractor_directory where id = pg_temp.fx('c_plumb')), 'cleared|unverified',
  'editing the licence expiry by hand clears licence_verified_at (the state becomes unverified)');
select throws_ok(format($$update hq.contractor_documents set expires_on = current_date where id = %L$$, pg_temp.fx('d1')), '42501', null,
  'even the table owner cannot re-date a document outside verify_contractor_document');
select throws_ok(format($$update hq.contractor_documents set storage_path = storage_path || 'x' where id = %L$$, pg_temp.fx('d1')), '42501', null,
  'a stored document''s path cannot change');

-- ------------------------------------------------------------ expiry states on the boundary days (directory, W = 30)
create function pg_temp.mk_ins(p_key text, p_expires date, p_verified boolean, p_details text default null) returns void
language plpgsql as $$
declare v uuid := pg_temp.mk_contractor(p_key, 'Expiry ' || p_key || ' Co', '{handyman}');
begin
  update hq.contractors set insurance_expires_on = p_expires, insurance_details = p_details,
         insurance_verified_at = case when p_verified then hq.today() - 200 end
  where id = v;
end $$;
select pg_temp.mk_ins('e_exp', hq.today() - 1, true);
select pg_temp.mk_ins('e_today', hq.today(), true);
select pg_temp.mk_ins('e_w', hq.today() + 30, true);
select pg_temp.mk_ins('e_w1', hq.today() + 31, true);
select pg_temp.mk_ins('e_w1u', hq.today() + 31, false);
select pg_temp.mk_ins('e_none', null, false);
select pg_temp.mk_ins('e_details', null, false, 'Policy details supplied, no expiry yet');
select pg_temp.mk_ins('e_vnodate', null, true);
create function pg_temp.ins(p_key text) returns text language sql stable as $$
  select insurance_state || '|' || coalesce(insurance_days_remaining::text, '-') from hq.contractor_directory where id = pg_temp.fx(p_key) $$;
select pg_temp.become('jpm');
select is(pg_temp.ins('e_exp'), 'expired|-1', 'insurance expired yesterday: expired, -1 days');
select is(pg_temp.ins('e_today'), 'expiring_soon|0', 'insurance expiring today: expiring_soon, 0 days (valid through its date)');
select is(pg_temp.ins('e_w'), 'expiring_soon|30', 'insurance expiring in exactly 30 days: expiring_soon (window inclusive)');
select is(pg_temp.ins('e_w1'), 'current|31', 'insurance expiring in 31 days and verified: current');
select is(pg_temp.ins('e_w1u'), 'unverified|31', 'insurance expiring in 31 days but not verified: unverified');
select is(pg_temp.ins('e_none'), 'not_recorded|-', 'nothing recorded: not_recorded');
select is(pg_temp.ins('e_details'), 'unverified|-', 'details but no expiry date: unverified, never current');
select is(pg_temp.ins('e_vnodate'), 'unverified|-', 'verified but no expiry date: unverified, never current');
select pg_temp.unbecome();
update hq.settings set value = '10'::jsonb where key = 'contractor_expiry_warning_days';
select pg_temp.become('jpm');
select is(pg_temp.ins('e_w'), 'current|30', 'with a 10-day window, 30 days ahead is current: the window follows the setting');
select is(pg_temp.ins('e_today'), 'expiring_soon|0', '... and today is still expiring_soon');
select pg_temp.unbecome();
update hq.settings set value = '30'::jsonb where key = 'contractor_expiry_warning_days';

-- ------------------------------------------------------------ contractor_expiry_watch
select pg_temp.mk_document('w_doc', pg_temp.fx('e_w1'), 'workers_compensation', hq.today() + 5);
select pg_temp.mk_document('w_rej', pg_temp.fx('e_w1'), 'professional_indemnity', hq.today() + 5);
select pg_temp.become('pm');
select hq.verify_contractor_document(pg_temp.fx('w_rej'), 'rejected', null, 'Wrong business');
select pg_temp.unbecome();
select pg_temp.mk_document('w_old', pg_temp.fx('e_w1'), 'licence', hq.today() + 3);
select pg_temp.mk_document('w_new', pg_temp.fx('e_w1'), 'licence', hq.today() + 300);
select pg_temp.mk_ins('e_inactive', hq.today() - 5, true);
update hq.contractors set status = 'inactive' where id = pg_temp.fx('e_inactive');
select pg_temp.mk_ins('e_archived', hq.today() - 5, true);
update hq.contractors set deleted_at = now() where id = pg_temp.fx('e_archived');
create function pg_temp.watch(p_key text) returns text[] language sql stable as $$
  select coalesce(array_agg(kind || ':' || state || ':' || days_remaining order by kind, item_key), '{}') from hq.contractor_expiry_watch where contractor_id = pg_temp.fx(p_key) $$;
select pg_temp.become('jpm');
select is(pg_temp.watch('e_exp'), array['insurance:expired:-1'], 'watch: an expired insurance is listed');
select is(pg_temp.watch('e_today'), array['insurance:expiring_soon:0'], 'watch: insurance expiring today is listed');
select is(pg_temp.watch('e_w'), array['insurance:expiring_soon:30'], 'watch: insurance 30 days out is listed');
select is(pg_temp.watch('e_w1'), array['document:expiring_soon:5'], 'watch: 31 days out is not listed; a workers compensation document 5 days out is (rejected and superseded documents are not)');
select is(pg_temp.watch('e_inactive'), '{}'::text[], 'watch: an inactive contractor is excluded');
select is(pg_temp.watch('e_archived'), '{}'::text[], 'watch: an archived contractor is excluded');
select is((select document_type::text || '|' || file_name || '|' || item_key from hq.contractor_expiry_watch where document_id = pg_temp.fx('w_doc')),
  'workers_compensation|doc.pdf|document:' || pg_temp.fx('w_doc'), 'watch: a document row carries its type, file name and item key');
select pg_temp.unbecome();

-- ------------------------------------------------------------ create_expiry_tasks: idempotent
update hq.contractors set relationship_owner_id = pg_temp.fx('pm') where id = pg_temp.fx('e_exp');
select count(*) as watch_n from hq.contractor_expiry_watch \gset
select pg_temp.become('jpm');
select throws_ok($$select hq.create_expiry_tasks()$$, '42501', null, 'a junior (no contractors.write) cannot create expiry tasks');
select pg_temp.become('va');
insert into zz select 't1', hq.create_expiry_tasks();
insert into zz select 't2', hq.create_expiry_tasks();
select pg_temp.unbecome();
select is((pg_temp.z('t1') ->> 'created')::int, :watch_n, 'the first run creates one task per watch row');
select is((pg_temp.z('t1') ->> 'skipped')::int, 0, '... and skips none');
select is(pg_temp.z('t2') - 'task_ids', jsonb_build_object('created', 0, 'skipped', :watch_n, 'items', :watch_n), 'the SECOND run creates nothing (every item already has an open task)');
select is((select title || '|' || assigned_to::text || '|' || priority::text || '|' || due_date::text || '|' || related_contractor_id::text || '|' || reminder_key
           from hq.tasks where reminder_key = 'contractor-expiry:' || pg_temp.fx('e_exp') || ':insurance'),
  'Insurance expired ' || to_char(hq.today() - 1, 'FMDD Mon YYYY') || ': Expiry e_exp Co|' || pg_temp.fx('pm') || '|high|' || hq.today()::text || '|' || pg_temp.fx('e_exp')
    || '|contractor-expiry:' || pg_temp.fx('e_exp') || ':insurance',
  'an expired item: assigned to the relationship owner, high priority, due today, related to the contractor');
select is((select assigned_to::text || '|' || priority::text || '|' || due_date::text from hq.tasks where reminder_key = 'contractor-expiry:' || pg_temp.fx('e_w') || ':insurance'),
  pg_temp.fx('va') || '|normal|' || (hq.today() + 30)::text, 'an expiring item with no owner: assigned to the caller, normal priority, due on the expiry date');
select is((select count(*) from hq.audit_events where action = 'expiry_tasks' and actor_id = pg_temp.fx('va')), 1::bigint, 'the run that created tasks is audited once');
select pg_temp.become('pm');
update hq.tasks set status = 'completed' where reminder_key = 'contractor-expiry:' || pg_temp.fx('e_exp') || ':insurance';
select is((hq.create_expiry_tasks() ->> 'created')::int, 1, 'once the reminder is completed and the item is still expired, a new reminder can be created');
select is((hq.create_expiry_tasks() ->> 'created')::int, 0, '... and only one');
select pg_temp.unbecome();
select pg_temp.become('va');
insert into hq.tasks (title, reminder_key) values ('Forged reminder', 'contractor-expiry:' || pg_temp.fx('e_w') || ':licence');
update hq.tasks set reminder_key = null where reminder_key = 'contractor-expiry:' || pg_temp.fx('e_w') || ':insurance';
select pg_temp.unbecome();
select is((select reminder_key from hq.tasks where title = 'Forged reminder'), null, 'a person cannot set reminder_key on a task');
select is((select count(*) from hq.tasks where reminder_key = 'contractor-expiry:' || pg_temp.fx('e_w') || ':insurance'), 1::bigint, 'a person cannot clear a reminder_key either');

-- ------------------------------------------------------------ job feedback and the rating threshold (3)
create function pg_temp.rating(p_key text) returns text language sql stable as $$
  select review_count || '|' || rated_review_count || '|' || rating_threshold || '|' || coalesce(rating::text, 'null') from hq.contractor_directory where id = pg_temp.fx(p_key) $$;
select pg_temp.become('va');
select throws_ok(format($$select hq.record_contractor_review(%L, p_work_quality := 6)$$, pg_temp.fx('c_spark')), '22023', null, 'a rating above 5 is refused');
select throws_ok(format($$select hq.record_contractor_review(%L, p_work_quality := 0)$$, pg_temp.fx('c_spark')), '22023', null, 'a rating below 1 is refused');
select throws_ok(format($$select hq.record_contractor_review(%L, p_notes := '  ')$$, pg_temp.fx('c_spark')), '22023', null, 'feedback needs at least one rating or a note');
select throws_ok(format($$select hq.record_contractor_review(%L, hq.today() + 1, p_work_quality := 3)$$, pg_temp.fx('c_spark')), '22023', null, 'a job date in the future is refused');
select is(pg_temp.rating('c_spark'), '0|0|3|null', 'no feedback: rating null (threshold 3)');
insert into zz select 'r1', hq.record_contractor_review(pg_temp.fx('c_spark'), hq.today() - 20, 'Job 1001 hot water', p_work_quality := 4, p_communication := 5,
  p_tenant_feedback := 'positive', p_rework_required := false);
select is(pg_temp.rating('c_spark'), '1|1|3|null', 'one rated review: rating null');
select hq.record_contractor_review(pg_temp.fx('c_spark'), hq.today() - 10, p_notes := 'Left the site tidy');
select is(pg_temp.rating('c_spark'), '2|1|3|null', 'a notes-only review counts as feedback but not toward the rating');
select hq.record_contractor_review(pg_temp.fx('c_spark'), hq.today() - 5, p_response_time := 3);
select is(pg_temp.rating('c_spark'), '3|2|3|null', 'two rated reviews: BELOW the threshold, rating is null');
select hq.record_contractor_review(pg_temp.fx('c_spark'), hq.today() - 30, p_response_time := 5, p_communication := 5, p_work_quality := 5, p_invoice_accuracy := 5);
select is(pg_temp.rating('c_spark'), '4|3|3|4.2', 'three rated reviews: AT the threshold, the rating appears (mean of 4.5, 3 and 5 = 4.2)');
select is((select rating_response_time || '|' || rating_communication || '|' || rating_work_quality || '|' || rating_invoice_accuracy from hq.contractor_directory where id = pg_temp.fx('c_spark')),
  '4.0|5.0|4.5|5.0', 'the per-dimension means (each over the reviews that rated it)');
select pg_temp.unbecome();
select is((select last_job_date from hq.contractors where id = pg_temp.fx('c_spark')), hq.today() - 5, 'last_job_date follows the latest job date recorded (an older job does not move it back)');
update hq.settings set value = '4'::jsonb where key = 'contractor_min_reviews_for_rating';
select pg_temp.become('jpm');
select is(pg_temp.rating('c_spark'), '4|3|4|null', 'raising the threshold to 4 hides the rating again');
select pg_temp.unbecome();
update hq.settings set value = '3'::jsonb where key = 'contractor_min_reviews_for_rating';
insert into fx values ('r1', (pg_temp.z('r1') ->> 'review_id')::uuid);
select pg_temp.become('pm');
update hq.contractor_reviews set work_quality = 1 where id = pg_temp.fx('r1');
select throws_ok(format($$select hq.archive_record('contractor_review', %L)$$, pg_temp.fx('r1')), '42501', null, 'another writer cannot archive someone else''s review');
select pg_temp.become('va');
select lives_ok(format($$update hq.contractor_reviews set notes = 'Hot water unit replaced' where id = %L$$, pg_temp.fx('r1')), 'the recorder can edit their review');
select lives_ok(format($$select hq.archive_record('contractor_review', %L, 'logged against the wrong job')$$, pg_temp.fx('r1')), 'the recorder can archive their review');
select pg_temp.unbecome();
select is((select work_quality from hq.contractor_reviews where id = pg_temp.fx('r1')), 4::smallint, 'another writer''s direct edit changed nothing');
select is(pg_temp.rating('c_spark'), '3|2|3|null', 'an archived review no longer counts: back below the threshold');

-- ------------------------------------------------------------ timeline (built from the tables, readable without audit.read)
select pg_temp.become('va');
select hq.record_contractor_contact(pg_temp.fx('c_plumb'), 'phone_call', now() - interval '5 minutes', 'Asked about after-hours call-outs');
select hq.set_vetting_step(pg_temp.fx('c_plumb'), 'communication', 'done', 'Answers the phone');
select hq.record_contractor_review(pg_temp.fx('c_plumb'), p_work_quality := 4);
select pg_temp.unbecome();
select pg_temp.become('jpm');
select is((select array_agg(distinct kind order by kind) from hq.contractor_timeline where contractor_id = pg_temp.fx('c_plumb')),
  array['contact', 'document_uploaded', 'document_verified', 'review', 'status_change', 'vetting_step'],
  'the timeline holds status changes, steps, uploads, verifications, feedback and contacts (read by a junior, who has no audit.read)');
select is((select count(*) from hq.audit_events), 0::bigint, '... while the junior reads no audit row at all');
select ok((select bool_and(a.occurred_at >= b.occurred_at) from
            (select occurred_at, row_number() over () as n from hq.contractor_timeline where contractor_id = pg_temp.fx('c_plumb')) a
            join (select occurred_at, row_number() over () as n from hq.contractor_timeline where contractor_id = pg_temp.fx('c_plumb')) b on b.n = a.n + 1),
  'the timeline is newest first');
select is((select count(*) - count(distinct event_key) from hq.contractor_timeline), 0::bigint, 'event_key is unique');
select is((select actor_name || '|' || summary || '|' || detail from hq.contractor_timeline where contractor_id = pg_temp.fx('c_plumb') and kind = 'contact'),
  'Val Assistant|Phone Call logged|Asked about after-hours call-outs', 'a contact entry names who logged it and what was said');
select pg_temp.unbecome();
select pg_temp.become('outsider');
select is((select count(*) from hq.contractor_timeline), 0::bigint, 'a person with no staff row reads no timeline');
select pg_temp.unbecome();

-- ------------------------------------------------------------ contractor_summary and preferred coverage (a clean slate)
update hq.contractor_documents set deleted_at = now() where deleted_at is null;
update hq.contractors set deleted_at = now() where deleted_at is null;
select pg_temp.mk_contractor('s1', 'Summary Plumbing One', '{plumbing}');
select pg_temp.mk_contractor('s2', 'Summary Plumbing And Electrical', '{plumbing,electrical}');
select pg_temp.mk_contractor('s3', 'Summary Vetting Co', '{painting}');
select pg_temp.mk_contractor('s4', 'Summary Contacted Started', '{cleaning}');
select pg_temp.mk_contractor('s5', 'Summary Contacted Idle', '{cleaning}');
select pg_temp.mk_contractor('s6', 'Summary Suspended', '{roofing}');
select pg_temp.mk_contractor('s7', 'Summary Prospect', '{other}');
update hq.contractors set service_suburbs = '{Kadina,Moonta}' where id = pg_temp.fx('s1');
update hq.contractors set service_suburbs = '{Wallaroo}' where id = pg_temp.fx('s2');
update hq.contractors set status = 'vetting' where id = pg_temp.fx('s3');
update hq.contractors set status = 'contacted' where id in (pg_temp.fx('s4'), pg_temp.fx('s5'));
update hq.contractors set status = 'suspended', status_reason = 'Under review' where id = pg_temp.fx('s6');
select pg_temp.become('dir');
select pg_temp.complete_checklist(pg_temp.fx('s1'));
select pg_temp.complete_checklist(pg_temp.fx('s2'));
select hq.approve_contractor(pg_temp.fx('s1'), false, 'Vetted');
select hq.approve_contractor(pg_temp.fx('s2'), true, 'Vetted and reliable');
select hq.set_vetting_step(pg_temp.fx('s4'), 'identity', 'in_progress');
select pg_temp.unbecome();
update hq.contractors set insurance_expires_on = hq.today() - 3, insurance_verified_at = hq.today() - 300 where id = pg_temp.fx('s1');
select pg_temp.become('ro');
insert into zz select 'sum', hq.contractor_summary();
select pg_temp.unbecome();
select is(pg_temp.z('sum') -> 'by_status', '{"prospect": 1, "contacted": 2, "vetting": 1, "approved": 1, "preferred": 1, "suspended": 1, "inactive": 0}'::jsonb,
  'summary: counts by status (every status, zero included)');
select is((pg_temp.z('sum') ->> 'total')::int, 7, 'summary: total live contractors');
select is((pg_temp.z('sum') ->> 'awaiting_vetting')::int, 2, 'summary: awaiting vetting = vetting plus contacted with a step under way (not the idle one)');
select is((pg_temp.z('sum') ->> 'expired')::int || '|' || (pg_temp.z('sum') ->> 'contractors_with_expired_items') || '|' || (pg_temp.z('sum') ->> 'cleared_with_expired_items'), '1|1|1',
  'summary: one expired item, on an APPROVED contractor (flagged, status unchanged)');
select is((select status::text from hq.contractors where id = pg_temp.fx('s1')), 'approved', 'an expired insurance never changes the status by itself');
select is((select e from jsonb_array_elements(pg_temp.z('sum') -> 'preferred_coverage') e where e ->> 'category' = 'plumbing'),
  '{"category": "plumbing", "label": "Plumbing", "approved": 1, "preferred": 1, "total": 2}'::jsonb, 'coverage: plumbing has one approved and one preferred');
select is((select e from jsonb_array_elements(pg_temp.z('sum') -> 'preferred_coverage') e where e ->> 'category' = 'electrical'),
  '{"category": "electrical", "label": "Electrical", "approved": 0, "preferred": 1, "total": 1}'::jsonb, 'coverage: electrical has one preferred');
select is(jsonb_array_length(pg_temp.z('sum') -> 'preferred_coverage'), 22, 'coverage lists all 22 (active) trades');
select ok((pg_temp.z('sum') -> 'trades_without_cover') ? 'locksmith' and (pg_temp.z('sum') -> 'trades_without_cover') ? 'painting', 'trades with no approved contractor are named (locksmith, painting ...)');
select ok(not ((pg_temp.z('sum') -> 'trades_without_cover') ? 'plumbing') and not ((pg_temp.z('sum') -> 'trades_without_cover') ? 'other'), '... not plumbing (covered) and never "other"');
select is(jsonb_array_length(pg_temp.z('sum') -> 'trades_without_cover'), 19, '19 trades without cover (22 categories, less other, plumbing and electrical)');

-- the brief's example: approved plumbers who service Moonta
select pg_temp.become('jpm');
select is((select array_agg(business_name order by business_name) from hq.contractor_directory
           where status in ('approved', 'preferred') and 'plumbing' = any (categories) and 'moonta' = any (service_suburb_keys)),
  array['Summary Plumbing One'], 'directory: approved plumbers who service Moonta (case-insensitive suburb keys)');
select is((select insurance_state from hq.contractor_directory where id = pg_temp.fx('s1')), 'expired', 'the directory flags the approved plumber''s expired insurance');
select pg_temp.unbecome();

select * from finish();
rollback;
