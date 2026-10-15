-- Planted HQ Phase 2: the status rules. NO PATH sets approved / preferred except approve_contractor
-- (direct update, insert with that status, the table owner, set_contractor_status, document
-- verification, step completion, a forged approval mark, logging a contact, import); approval needs the
-- checklist; a suspended contractor cannot go straight to approved; reinstating needs
-- contractors.approve and returns to vetting; the vetting checklist itself.
begin;
\ir hq_fixture.inc
\ir hq_contractor_fixture.inc
select pg_temp.seed_hq();
select pg_temp.seed_contractors();
select plan(95);

-- ------------------------------------------------------------ creation
select pg_temp.become('va');
select lives_ok($$insert into hq.contractors (business_name, categories, status) values ('Starts Vetting Co', '{roofing}', 'vetting')$$, 'a contractor may be created at vetting');
select throws_ok($$insert into hq.contractors (business_name, categories, status) values ('Starts Approved Co', '{roofing}', 'approved')$$, '42501', null, 'INSERT with status approved is refused');
select throws_ok($$insert into hq.contractors (business_name, categories, status) values ('Starts Preferred Co', '{roofing}', 'preferred')$$, '42501', null, 'INSERT with status preferred is refused');
select throws_ok($$insert into hq.contractors (business_name, categories, status, status_reason) values ('Starts Suspended Co', '{roofing}', 'suspended', 'x')$$, '42501', null, 'INSERT with status suspended is refused');
select pg_temp.unbecome();
select throws_ok($$insert into hq.contractors (business_name, categories, status) values ('Owner Approved Co', '{roofing}', 'approved')$$, '42501', null, 'INSERT with status approved is refused even for the table owner');
select is((select array_agg(coalesce(from_status::text, '-') || '>' || to_status::text) from hq.contractor_status_history h join hq.contractors c on c.id = h.contractor_id where c.business_name = 'Starts Vetting Co'),
  array['->vetting'], 'creation writes one history row');

-- ------------------------------------------------------------ direct status moves among the open statuses
select pg_temp.become('va');
select lives_ok(format($$update hq.contractors set status = 'contacted' where id = %L$$, pg_temp.fx('c_spark')), 'direct: prospect -> contacted');
select lives_ok(format($$update hq.contractors set status = 'vetting' where id = %L$$, pg_temp.fx('c_spark')), 'direct: contacted -> vetting');
select lives_ok(format($$update hq.contractors set status = 'inactive', status_reason = 'Retired' where id = %L$$, pg_temp.fx('c_spark')), 'direct: vetting -> inactive with a reason');
select lives_ok(format($$update hq.contractors set status = 'vetting' where id = %L$$, pg_temp.fx('c_spark')), 'direct: inactive -> vetting');
select pg_temp.unbecome();
select is((select status_reason from hq.contractors where id = pg_temp.fx('c_spark')), null, 'a direct status change that does not restate the reason drops the old one');
select is((select array_agg(coalesce(from_status::text, '-') || '>' || to_status::text order by id) from hq.contractor_status_history where contractor_id = pg_temp.fx('c_spark')),
  array['->prospect', 'prospect>contacted', 'contacted>vetting', 'vetting>inactive', 'inactive>vetting'], 'every status change writes history, in order');
select is((select note from hq.contractor_status_history where contractor_id = pg_temp.fx('c_spark') and to_status = 'inactive'), 'Retired', 'the history row carries the reason');
select is((select changed_by from hq.contractor_status_history where contractor_id = pg_temp.fx('c_spark') and to_status = 'inactive'), pg_temp.fx('va'), 'the history row records who changed it');
select is((select count(*) from hq.audit_events where entity_type = 'contractor' and entity_id = pg_temp.fx('c_spark') and action = 'status_change'), 4::bigint, 'status changes are audited as status_change');

-- ------------------------------------------------------------ the checklist (set_vetting_step)
select pg_temp.become('va');
select is(hq.set_vetting_step(pg_temp.fx('c_plumb'), 'identity', 'done', 'Licence photo ID sighted') ->> 'changed', 'true', 'set_vetting_step: marks a step done');
select is(hq.set_vetting_step(pg_temp.fx('c_plumb'), 'identity', 'done', 'Licence photo ID sighted') ->> 'changed', 'false', 'set_vetting_step: the same call again changes nothing (idempotent)');
select throws_ok(format($$select hq.set_vetting_step(%L, 'licence', 'not_applicable')$$, pg_temp.fx('c_plumb')), '22023', null, 'not_applicable without a note is refused');
select throws_ok(format($$select hq.set_vetting_step(%L, 'licence', 'not_applicable', '   ')$$, pg_temp.fx('c_plumb')), '22023', null, 'a blank note is not a note');
select is(hq.set_vetting_step(pg_temp.fx('c_plumb'), 'licence', 'not_applicable', 'Trade needs no licence') ->> 'status', 'not_applicable', 'not_applicable with a note is accepted');
select throws_ok(format($$select hq.set_vetting_step(%L, 'review_and_approve', 'done')$$, pg_temp.fx('c_plumb')), '22023', null, 'STEP COMPLETION: set_vetting_step refuses the final step (only approval completes it)');
select is((hq.set_vetting_step(pg_temp.fx('c_plumb'), 'abn', 'in_progress') ->> 'completed_at'), null, 'in_progress carries no completion stamp');
select pg_temp.unbecome();
select is((select completed_by from hq.contractor_vetting_steps where contractor_id = pg_temp.fx('c_plumb') and step = 'identity'), pg_temp.fx('va'), 'completed_by is the caller');
select ok((select completed_at is not null from hq.contractor_vetting_steps where contractor_id = pg_temp.fx('c_plumb') and step = 'identity'), 'completed_at is stamped');
select pg_temp.become('va');
select is(hq.set_vetting_step(pg_temp.fx('c_plumb'), 'identity', 'in_progress', 'Rechecking') ->> 'completed_by', null, 'leaving done clears the completion stamp');
select is((hq.set_vetting_step(pg_temp.fx('c_plumb'), 'identity', 'done', null) ->> 'vetting_done_count')::int, 2, 'the response reports the done count (identity and licence)');
select pg_temp.unbecome();
select is((select count(*) from hq.audit_events where entity_type = 'contractor_vetting_step' and entity_id = pg_temp.fx('c_plumb')), 5::bigint,
  'each step change is audited against the contractor (the idempotent repeat is not)');
select throws_ok(format($$update hq.contractor_vetting_steps set status = 'done' where contractor_id = %L and step = 'review_and_approve'$$, pg_temp.fx('c_plumb')),
  '42501', null, 'STEP COMPLETION: even the table owner cannot complete review_and_approve outside approve_contractor');

-- ------------------------------------------------------------ approval is refused while the checklist is incomplete
select pg_temp.become('dir');
select throws_ok(format($$select hq.approve_contractor(%L, false, 'Looks good')$$, pg_temp.fx('c_plumb')), '23514', 'the vetting checklist is not complete', 'APPROVAL with an incomplete checklist is refused');
select is((hq.preview_contractor_approval(pg_temp.fx('c_plumb')) -> 'missing_steps'), '["abn", "insurance", "service_areas", "pricing", "emergency_availability", "communication"]'::jsonb,
  'the preview lists the unfinished steps, in checklist order');
select is((hq.preview_contractor_approval(pg_temp.fx('c_plumb')) ->> 'can_approve'), 'false', 'the preview says it cannot be approved yet');
select pg_temp.unbecome();

-- complete the rest of the checklist as a virtual assistant: the status does not move
select pg_temp.become('va');
select pg_temp.complete_checklist(pg_temp.fx('c_plumb'));
select pg_temp.unbecome();
select is((select status::text from hq.contractors where id = pg_temp.fx('c_plumb')), 'prospect', 'STEP COMPLETION: finishing all eight steps does not change the status');
select is((select vetting_done_count from hq.contractor_directory where id = pg_temp.fx('c_plumb')), 8::bigint, 'the directory shows 8 of 9 done');

-- ------------------------------------------------------------ every forged path to approved / preferred is refused
select pg_temp.become('va');
select throws_ok(format($$update hq.contractors set status = 'approved' where id = %L$$, pg_temp.fx('c_plumb')), '42501', null, 'DIRECT UPDATE to approved is refused');
select throws_ok(format($$update hq.contractors set status = 'preferred' where id = %L$$, pg_temp.fx('c_plumb')), '42501', null, 'DIRECT UPDATE to preferred is refused');
select throws_ok(format($$select hq.set_contractor_status(%L, 'approved', 'x')$$, pg_temp.fx('c_plumb')), '42501', null, 'set_contractor_status refuses approved');
select throws_ok(format($$select hq.set_contractor_status(%L, 'preferred', 'x')$$, pg_temp.fx('c_plumb')), '42501', null, 'set_contractor_status refuses preferred');
select throws_ok(format($$select hq.record_contractor_contact(%L, 'phone_call', null, 'Called', p_new_status := 'approved')$$, pg_temp.fx('c_plumb')), '22023', null, 'LOGGING A CONTACT cannot approve');
-- a forged approval mark does not help an API role (the guard also tests current_user)
select set_config('hq.contractor_approval', pg_temp.fx('c_plumb')::text, true);
select throws_ok(format($$update hq.contractors set status = 'approved' where id = %L$$, pg_temp.fx('c_plumb')), '42501', null, 'a FORGED approval mark does not let an API role approve');
select set_config('hq.contractor_approval', '', true);
select pg_temp.unbecome();
select throws_ok(format($$update hq.contractors set status = 'approved', approved_at = now(), approved_by = %L where id = %L$$, pg_temp.fx('dir'), pg_temp.fx('c_plumb')),
  '42501', null, 'the TABLE OWNER (migration, secret key, scripts) cannot set approved either');
-- document verification never approves
select pg_temp.mk_document('ins1', pg_temp.fx('c_plumb'), 'public_liability_insurance', hq.today() + 200);
select pg_temp.become('pm');
select is(hq.verify_contractor_document(pg_temp.fx('ins1'), 'verified', null, 'Certificate of currency', true) ->> 'applied_to_contractor', 'true', 'a verified insurance document is applied to the contractor');
select pg_temp.unbecome();
select is((select status::text from hq.contractors where id = pg_temp.fx('c_plumb')), 'prospect', 'DOCUMENT VERIFICATION does not change the status');
select is((select status::text from hq.contractor_vetting_steps where contractor_id = pg_temp.fx('c_plumb') and step = 'review_and_approve'), 'not_started', 'the final step is still not started');
-- an import never approves
select pg_temp.become('dir');
select is((hq.preview_contractor_import('[{"business_name": "Imported Approved Co", "categories": ["plumbing"], "status": "approved"}]'::jsonb) -> 'rows' -> 0 ->> 'classification'), 'invalid',
  'IMPORT: a row with status approved is invalid');
select throws_ok($$select hq.apply_contractor_import('[{"business_name": "Imported Approved Co", "categories": ["plumbing"], "status": "approved"}]'::jsonb, 'forged')$$,
  '22023', null, 'IMPORT: a file with status approved is refused whole');
select pg_temp.unbecome();
select is((select count(*) from hq.contractors where business_name = 'Imported Approved Co'), 0::bigint, 'IMPORT: nothing was created');

-- ------------------------------------------------------------ approve_contractor
select pg_temp.become('dir');
select throws_ok(format($$select hq.approve_contractor(%L, false, '  ')$$, pg_temp.fx('c_plumb')), '22023', 'an approval needs a note', 'an approval needs a note');
select is((hq.preview_contractor_approval(pg_temp.fx('c_plumb')) ->> 'can_approve'), 'true', 'with the checklist complete the preview says it can be approved');
select is((select array_agg(w ->> 'code') from jsonb_array_elements(hq.preview_contractor_approval(pg_temp.fx('c_plumb')) -> 'warnings') w), array['rates_unknown'],
  'preview warnings: verified insurance and suburbs are on file, only rates are unknown');
select pg_temp.keep('a1', hq.approve_contractor(pg_temp.fx('c_plumb'), false, 'Vetted by phone and documents'));
insert into fx values ('a1_dummy', gen_random_uuid());
select pg_temp.unbecome();
select is((select status::text || '|' || approved_by::text from hq.contractors where id = pg_temp.fx('c_plumb')), 'approved|' || pg_temp.fx('dir'), 'APPROVED by approve_contractor, approved_by = the director');
select ok((select approved_at > now() - interval '1 minute' from hq.contractors where id = pg_temp.fx('c_plumb')), 'approved_at is stamped');
select is((select status::text || '|' || completed_by::text || '|' || note from hq.contractor_vetting_steps where contractor_id = pg_temp.fx('c_plumb') and step = 'review_and_approve'),
  'done|' || pg_temp.fx('dir') || '|Vetted by phone and documents', 'approval completes review_and_approve with the note');
select is((select note from hq.contractor_status_history where contractor_id = pg_temp.fx('c_plumb') and to_status = 'approved'), 'Vetted by phone and documents', 'the history row carries the approval note');
select is((select count(*) from hq.audit_events where entity_type = 'contractor' and entity_id = pg_temp.fx('c_plumb') and action = 'approve' and actor_id = pg_temp.fx('dir') and summary like '%Vetted by phone%'),
  1::bigint, 'the approval is audited (action approve, with the note)');
select is((select vetting_done_count from hq.contractor_directory where id = pg_temp.fx('c_plumb')), 9::bigint, 'the directory shows 9 of 9');
select pg_temp.become('dir');
select is(hq.approve_contractor(pg_temp.fx('c_plumb'), false, 'Again') ->> 'changed', 'false', 'approving an approved contractor again changes nothing');
select is((hq.approve_contractor(pg_temp.fx('c_plumb'), false, 'Again') -> 'warnings' -> 0 ->> 'code'), 'rates_unknown', 'approve_contractor returns the warnings');
select is(hq.approve_contractor(pg_temp.fx('c_plumb'), true, 'Reliable and quick') ->> 'status', 'preferred', 'make_preferred moves approved to preferred');
select pg_temp.unbecome();
select is((select count(*) from hq.audit_events where entity_type = 'contractor' and entity_id = pg_temp.fx('c_plumb') and action = 'prefer'), 1::bigint, 'preferring is audited (action prefer)');
select pg_temp.become('va');
select throws_ok(format($$update hq.contractors set status = 'vetting' where id = %L$$, pg_temp.fx('c_plumb')), '42501', null, 'a direct update cannot move a preferred contractor (set_contractor_status only)');
select pg_temp.unbecome();
update hq.contractors set approved_at = null, approved_by = null where id = pg_temp.fx('c_plumb');
select ok((select approved_at is not null and approved_by = pg_temp.fx('dir') from hq.contractors where id = pg_temp.fx('c_plumb')), 'approved_at / approved_by of a cleared contractor cannot be removed or rewritten (the guard keeps them, even against the owner)');

-- ------------------------------------------------------------ suspension and reinstatement
select pg_temp.become('va');
select throws_ok(format($$select hq.set_contractor_status(%L, 'suspended')$$, pg_temp.fx('c_plumb')), '22023', null, 'suspending needs a note');
select is(hq.set_contractor_status(pg_temp.fx('c_plumb'), 'suspended', 'Tenant complaint under review') ->> 'previous_status', 'preferred', 'a virtual assistant (contractors.write) can suspend at once');
select pg_temp.unbecome();
select is((select status::text || '|' || status_reason || '|' || coalesce(approved_at::text, 'none') from hq.contractors where id = pg_temp.fx('c_plumb')),
  'suspended|Tenant complaint under review|none', 'suspended: the reason is kept and the approval stamps are cleared');
select is((select status::text from hq.contractor_vetting_steps where contractor_id = pg_temp.fx('c_plumb') and step = 'review_and_approve'), 'not_started', 'leaving approved reopens the final step');
select is((select count(*) from hq.audit_events where entity_type = 'contractor' and entity_id = pg_temp.fx('c_plumb') and action = 'suspend' and summary like '%Tenant complaint%'), 1::bigint, 'the suspension is audited with its reason');
select pg_temp.become('dir');
select throws_ok(format($$select hq.approve_contractor(%L, false, 'Back on')$$, pg_temp.fx('c_plumb')), '23514', null, 'a SUSPENDED contractor cannot go straight to approved');
select throws_ok(format($$select hq.approve_contractor(%L, true, 'Back on')$$, pg_temp.fx('c_plumb')), '23514', null, '... nor straight to preferred');
select is((hq.preview_contractor_approval(pg_temp.fx('c_plumb')) -> 'blocked_by'), '["suspended"]'::jsonb, 'the preview says it is blocked by the suspension');
select throws_ok(format($$select hq.set_contractor_status(%L, 'vetting')$$, pg_temp.fx('c_plumb')), '42501', null, 'set_contractor_status cannot lift a suspension (even for a director)');
select throws_ok(format($$select hq.set_contractor_status(%L, 'inactive')$$, pg_temp.fx('c_plumb')), '42501', null, 'set_contractor_status cannot move a suspended contractor to inactive (no back door)');
select pg_temp.become('va');
select throws_ok(format($$update hq.contractors set status = 'vetting' where id = %L$$, pg_temp.fx('c_plumb')), '42501', null, 'a direct update cannot lift a suspension');
select throws_ok(format($$select hq.reinstate_contractor(%L, 'Resolved')$$, pg_temp.fx('c_plumb')), '42501', null, 'reinstating needs contractors.approve');
select pg_temp.unbecome();
select throws_ok(format($$update hq.contractors set status = 'vetting' where id = %L$$, pg_temp.fx('c_plumb')), '42501', null, 'the table owner cannot lift a suspension outside reinstate_contractor');
select pg_temp.become('dir');
select throws_ok(format($$select hq.reinstate_contractor(%L, 'x')$$, pg_temp.fx('c_spark')), '22023', null, 'only a suspended contractor can be reinstated');
select is(hq.reinstate_contractor(pg_temp.fx('c_plumb'), 'Complaint resolved') ->> 'status', 'vetting', 'reinstate_contractor returns it to VETTING, never approved');
select pg_temp.unbecome();
select is((select status::text || '|' || status_reason from hq.contractors where id = pg_temp.fx('c_plumb')), 'vetting|Complaint resolved', 'reinstated: vetting, with the note as the reason');
select is((select count(*) from hq.audit_events where entity_type = 'contractor' and entity_id = pg_temp.fx('c_plumb') and action = 'reinstate'), 1::bigint, 'the reinstatement is audited');
select pg_temp.become('dir');
select is(hq.approve_contractor(pg_temp.fx('c_plumb'), false, 'Approved again after review') ->> 'status', 'approved', 'after reinstatement it can be approved again (a separate decision)');
select pg_temp.unbecome();
select is((select array_agg(coalesce(from_status::text, '-') || '>' || to_status::text order by id) from hq.contractor_status_history where contractor_id = pg_temp.fx('c_plumb')),
  array['->prospect', 'prospect>approved', 'approved>preferred', 'preferred>suspended', 'suspended>vetting', 'vetting>approved'], 'the full history of the contractor, in order');

-- leaving approved through set_contractor_status
select pg_temp.become('pm');
select is(hq.set_contractor_status(pg_temp.fx('c_plumb'), 'vetting', 'Re-checking insurance') ->> 'status', 'vetting', 'set_contractor_status moves an approved contractor back to vetting');
select is(hq.set_contractor_status(pg_temp.fx('c_plumb'), 'vetting') ->> 'changed', 'false', 'the same status again changes nothing');
select pg_temp.unbecome();
select is((select approved_at from hq.contractors where id = pg_temp.fx('c_plumb')), null, 'leaving approved clears approved_at');

-- inactive cannot be approved directly; direct suspension needs a reason
select pg_temp.become('va');
select lives_ok(format($$update hq.contractors set status = 'inactive' where id = %L$$, pg_temp.fx('c_spark')), 'direct: vetting -> inactive');
select pg_temp.become('dir');
select pg_temp.complete_checklist(pg_temp.fx('c_spark'));
select throws_ok(format($$select hq.approve_contractor(%L, false, 'x')$$, pg_temp.fx('c_spark')), '23514', null, 'an inactive contractor must go back to vetting before approval');
select pg_temp.become('va');
select lives_ok(format($$update hq.contractors set status = 'vetting' where id = %L$$, pg_temp.fx('c_spark')), 'direct: inactive -> vetting');
select throws_ok(format($$update hq.contractors set status = 'suspended' where id = %L$$, pg_temp.fx('c_spark')), '23514', null, 'a direct suspension without a reason is refused');
select lives_ok(format($$update hq.contractors set status = 'suspended', status_reason = 'Unpaid invoice dispute' where id = %L$$, pg_temp.fx('c_spark')), 'a direct suspension with a reason is allowed');
select pg_temp.unbecome();

-- ------------------------------------------------------------ record_contractor_contact
create temp table zz_contact (k text primary key, v jsonb) on commit drop;
grant select, insert on zz_contact to public;
select pg_temp.mk_contractor('c_new', 'Fresh Prospect Co', '{painting}');
select pg_temp.become('va');
insert into zz_contact select 'c1', hq.record_contractor_contact(pg_temp.fx('c_new'), 'phone_call', now() - interval '1 hour', 'Introduced Planted; asked for insurance',
  'Send the vetting checklist', hq.today() + 3, true, null, 'contacted');
select pg_temp.unbecome();
select is((select v ->> 'status' || '|' || (v ->> 'status_changed') from zz_contact where k = 'c1'), 'contacted|true', 'logging a contact moves a prospect to contacted');
select is((select interaction_type::text || '|' || staff_id::text || '|' || coalesce(contact_id::text, '-') from hq.interactions where id = (select (v ->> 'interaction_id')::uuid from zz_contact where k = 'c1')),
  'phone_call|' || pg_temp.fx('va') || '|-', 'the contact is logged in interactions against the contractor only');
select is((select title || '|' || related_contractor_id::text || '|' || source || '|' || due_date::text from hq.tasks where id = (select (v ->> 'task_id')::uuid from zz_contact where k = 'c1')),
  'Send the vetting checklist|' || pg_temp.fx('c_new') || '|interaction|' || (hq.today() + 3)::text, 'the follow-up task is related to the contractor');
select is((select last_contacted_at from hq.contractor_directory where id = pg_temp.fx('c_new')), now() - interval '1 hour', 'the directory shows last_contacted_at');
select pg_temp.become('va');
select is(hq.record_contractor_contact(pg_temp.fx('c_plumb'), 'email', null, 'Asked for the new certificate', p_new_status := 'contacted') ->> 'status_changed', 'false',
  'logging a contact never moves a contractor that is past prospect');
select pg_temp.unbecome();
select is((select status::text from hq.contractors where id = pg_temp.fx('c_plumb')), 'vetting', '... it stays at vetting');
select throws_ok(format($$insert into hq.interactions (contractor_id, contact_id, interaction_type, summary) values (%L, %L, 'note', 'Mixed')$$, pg_temp.fx('c_new'), pg_temp.fx('alice')),
  '23514', null, 'an interaction names a contractor alone, not a contractor and a contact');

select * from finish();
rollback;
