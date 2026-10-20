-- Planted HQ: the Business Decisions Register (migrations 0125, 0126).
-- Structure and security, the capability matrix, forged callers (anon, non-staff, aal1, read_only,
-- junior, property manager, a reader without write), RLS select scoping, no direct writes, validation
-- boundaries, status rules (closed statuses, supersede and reverse with notes, no self, no loops),
-- supersede consistency on both decisions, history written exactly once per change and append-only,
-- audit rows, task links only for tasks the linker can see (and counted only for tasks the reader can
-- see), archive / restore, and the overview's shape.
--
-- NOTE: never CALL a function a hint role lacks execute on (see hq_01). Every RPC here is granted to
-- authenticated; anon is refused at the schema.
begin;
\ir hq_fixture.inc
select pg_temp.seed_hq();
select plan(166);

-- anything already in this database is put out of the way for the transaction (targets last)
do $$
begin
  for i in 1..100 loop
    exit when not exists (select 1 from hq.decisions where deleted_at is null);
    update hq.decisions d set deleted_at = now()
    where d.deleted_at is null
      and not exists (select 1 from hq.decisions x where x.superseded_by_id = d.id and x.deleted_at is null);
  end loop;
end $$;

create temp table zz_r (k text primary key, v jsonb) on commit drop;
grant select, insert on zz_r to public;
create function pg_temp.r(p_k text) returns jsonb language sql stable as $$ select v from zz_r where k = p_k $$;
create function pg_temp.did(p_k text) returns uuid language sql stable as $$ select (v ->> 'decision_id')::uuid from zz_r where k = p_k $$;
create function pg_temp.hist(p_id uuid) returns bigint language sql stable as $$ select count(*) from hq.decision_history where decision_id = p_id $$;
create function pg_temp.audits(p_id uuid, p_action text) returns bigint language sql stable as $$
  select count(*) from hq.audit_events where entity_type = 'decision' and entity_id = p_id and action = p_action $$;

with t as (insert into hq.tasks (title, assigned_to, created_by) values ('dec-task-dir', pg_temp.fx('dir'), pg_temp.fx('dir')) returning id) insert into fx select 't_dir', id from t;
with t as (insert into hq.tasks (title, assigned_to, created_by) values ('dec-task-pm', pg_temp.fx('pm'), pg_temp.fx('pm')) returning id) insert into fx select 't_pm', id from t;
with t as (insert into hq.tasks (title, assigned_to, created_by) values ('dec-task-spm', pg_temp.fx('spm'), pg_temp.fx('spm')) returning id) insert into fx select 't_spm', id from t;
with t as (insert into hq.tasks (title, assigned_to, created_by, deleted_at) values ('dec-task-archived', pg_temp.fx('dir'), pg_temp.fx('dir'), now()) returning id) insert into fx select 't_arch', id from t;

-- ------------------------------------------------------------ structure and security
select has_table('hq', 'decisions', 'hq.decisions exists');
select has_table('hq', 'decision_history', 'hq.decision_history exists');
select has_table('hq', 'decision_tasks', 'hq.decision_tasks exists');
select columns_are('hq', 'decisions', array['id', 'ref_number', 'title', 'description', 'rationale', 'category', 'status', 'decision_date', 'decision_maker_id', 'superseded_by_id', 'reversed_note', 'created_at', 'updated_at', 'created_by', 'updated_by', 'deleted_at', 'deleted_by']);
select columns_are('hq', 'decision_history', array['id', 'decision_id', 'changed_by', 'changed_by_name', 'changed_at', 'action', 'summary', 'changes', 'note']);
select columns_are('hq', 'decision_tasks', array['decision_id', 'task_id', 'linked_by', 'linked_at']);
select enum_has_labels('hq', 'decision_category', array['strategy', 'finance', 'people', 'operations', 'partners', 'marketing', 'technology', 'legal_compliance', 'service_offering', 'other']);
select enum_has_labels('hq', 'decision_status', array['proposed', 'decided', 'in_effect', 'superseded', 'reversed']);
select is((select count(*) from pg_class where oid in ('hq.decisions'::regclass, 'hq.decision_history'::regclass, 'hq.decision_tasks'::regclass) and relrowsecurity and relforcerowsecurity), 3::bigint, 'RLS is enabled and forced on the three decision tables');
select policies_are('hq', 'decisions', array['decisions_select'], 'decisions: one select policy, nothing else');
select policies_are('hq', 'decision_history', array['decision_history_select'], 'decision_history: one select policy');
select policies_are('hq', 'decision_tasks', array['decision_tasks_select'], 'decision_tasks: one select policy');
select is((select count(*) from pg_policies where schemaname = 'hq' and tablename in ('decisions', 'decision_history', 'decision_tasks') and qual like '%has_capability(''decisions.read''%'), 3::bigint, 'every decision policy needs decisions.read');
select table_privs_are('hq', 'decisions', 'authenticated', array['SELECT'], 'decisions: authenticated can only select (written by RPC)');
select table_privs_are('hq', 'decision_history', 'authenticated', array['SELECT'], 'decision_history: authenticated can only select');
select table_privs_are('hq', 'decision_tasks', 'authenticated', array['SELECT'], 'decision_tasks: authenticated can only select');
select is((select count(*) from unnest(array['decisions', 'decision_history', 'decision_tasks']) t where has_table_privilege('service_role', 'hq.' || t, 'insert,update,delete,truncate')), 0::bigint, 'service_role cannot write the decision tables');
select ok(not has_table_privilege('anon', 'hq.decisions', 'select') and not has_table_privilege('anon', 'hq.decision_overview', 'select'), 'anon holds nothing on decisions or the overview');
select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid = 'hq.decision_overview'::regclass), 'decision_overview is security_invoker');
select ok(has_table_privilege('authenticated', 'hq.decision_overview', 'select'), 'authenticated can select the overview');

create temp table zz_rpcs (sig regprocedure primary key) on commit drop;
insert into zz_rpcs values
  ('hq.create_decision(text, hq.decision_category, date, hq.decision_status, text, text, uuid, text)'),
  ('hq.update_decision(uuid, text, text, text, hq.decision_category, date, hq.decision_status, uuid, uuid, text, timestamptz)'),
  ('hq.supersede_decision(uuid, uuid, text)'), ('hq.link_decision_task(uuid, uuid)'), ('hq.unlink_decision_task(uuid, uuid)');
select is((select count(*) from zz_rpcs where has_function_privilege('authenticated', sig, 'execute')), 5::bigint, 'authenticated can execute the five decision RPCs');
select is((select count(*) from zz_rpcs where has_function_privilege('anon', sig, 'execute') or has_function_privilege('service_role', sig, 'execute')), 0::bigint, 'anon and service_role can execute none of them');
select is((select count(*) from zz_rpcs z join pg_proc p on p.oid = z.sig where p.prosecdef and p.proconfig::text like '%search_path=pg_catalog, public, extensions%'), 5::bigint, 'all five are security definer with a pinned search_path');
select is((select count(*) from pg_proc p where p.pronamespace = 'hq_private'::regnamespace
            and p.proname in ('decision_guard', 'decision_ref', 'decision_json', 'decision_status_label', 'decision_history_write', 'decision_text', 'task_visible_to_caller')
            and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))), 0::bigint, 'the decision helpers are executable by no API role');

-- ------------------------------------------------------------ the capability matrix
select is((select array_agg(role::text order by role::text) from hq.role_capabilities where capability = 'decisions.read'),
  array['administrator', 'business_development_manager', 'director', 'read_only', 'senior_property_manager'], 'decisions.read: director, administrator, senior PM, BDM, read_only');
select is((select array_agg(role::text order by role::text) from hq.role_capabilities where capability = 'decisions.write'),
  array['administrator', 'director'], 'decisions.write: director and administrator only');

-- ------------------------------------------------------------ create (director)
select pg_temp.become('dir');
insert into zz_r select 'a', hq.create_decision('  Long-term residential management first  ', 'strategy', hq.today(), 'decided',
  'Lead with long-term residential management; short-term accommodation is secondary.', 'Focus for year one.', null, 'Agreed at the planning day');
insert into zz_r select 'b', hq.create_decision('Pricing set at 8.8 percent', 'finance', hq.today() - 3, 'in_effect', null, 'Market comparison', pg_temp.fx('dir2'));
insert into zz_r select 'c', hq.create_decision('Trial a newsletter', 'marketing', hq.today() + 7, 'proposed');
insert into zz_r select 'd', hq.create_decision(repeat('t', 200), 'other', null, null, repeat('d', 5000), repeat('r', 5000));
select pg_temp.unbecome();

select is(pg_temp.r('a') ->> 'title', 'Long-term residential management first', 'create: the title is trimmed');
select ok(pg_temp.r('a') ->> 'ref' ~ '^DEC-[0-9]{4,}$', 'create: the result carries a DEC-0001 style ref');
select is((pg_temp.r('a') ->> 'changed')::boolean, true, 'create: changed');
select is((select decision_maker_id from hq.decisions where id = pg_temp.did('a')), pg_temp.fx('dir'), 'create: the decision maker defaults to the caller');
select is((select decision_maker_id from hq.decisions where id = pg_temp.did('b')), pg_temp.fx('dir2'), 'create: another active member of staff can be the decision maker');
select is((select created_by from hq.decisions where id = pg_temp.did('a')), pg_temp.fx('dir'), 'create: created_by is the caller');
select is((select status::text from hq.decisions where id = pg_temp.did('d')), 'decided', 'create: status defaults to decided');
select is((select decision_date from hq.decisions where id = pg_temp.did('d')), hq.today(), 'create: the date defaults to today');
select is((select decision_date from hq.decisions where id = pg_temp.did('c')), hq.today() + 7, 'create: 7 days ahead is allowed');
select is((select char_length(title) || '/' || char_length(description) || '/' || char_length(rationale) from hq.decisions where id = pg_temp.did('d')), '200/5000/5000', 'create: the boundary lengths (200, 5000, 5000) are accepted');
select is(pg_temp.hist(pg_temp.did('a')), 1::bigint, 'create: exactly one history row');
select is((select action || '|' || note || '|' || changed_by_name from hq.decision_history where decision_id = pg_temp.did('a')), 'create|Agreed at the planning day|Dana Director', 'create: the history row records the action, note and who');
select is(pg_temp.audits(pg_temp.did('a'), 'create'), 1::bigint, 'create: one audit row (entity decision)');
select ok((select summary from hq.audit_events where entity_type = 'decision' and entity_id = pg_temp.did('a') and action = 'create') like 'Create decision: DEC-% Long-term residential management first [Agreed at the planning day]', 'create: the audit summary names the ref, title and note');

-- ------------------------------------------------------------ validation
select pg_temp.become('dir');
select throws_ok($$select hq.create_decision('   ', 'strategy')$$, '22023', 'a decision needs a title', 'a blank title is refused');
select throws_ok(format($$select hq.create_decision(%L, 'strategy')$$, repeat('t', 201)), '22023', 'a title is at most 200 characters', 'a 201-character title is refused');
select throws_ok(format($$select hq.create_decision('x', 'strategy', null, null, %L)$$, repeat('d', 5001)), '22023', 'a description is at most 5000 characters', 'a 5001-character description is refused');
select throws_ok(format($$select hq.create_decision('x', 'strategy', null, null, null, %L)$$, repeat('r', 5001)), '22023', 'a rationale is at most 5000 characters', 'a 5001-character rationale is refused');
select throws_ok(format($$select hq.create_decision('x', 'strategy', null, null, null, null, null, %L)$$, repeat('n', 1001)), '22023', 'a note is at most 1000 characters', 'a 1001-character note is refused');
select throws_ok($$select hq.create_decision('x', 'strategy', hq.today() + 8)$$, '22023', 'a decision date can be at most 7 days ahead', 'a date 8 days ahead is refused');
select throws_ok($$select hq.create_decision('x', 'strategy', date '1989-12-31')$$, '22023', null, 'a date before 1990 is refused');
select throws_ok($$select hq.create_decision('x', null)$$, '22023', 'choose a category', 'a category is required');
select throws_ok($$select hq.create_decision('x', 'strategy', null, 'superseded')$$, '22023', null, 'a new decision cannot start superseded');
select throws_ok($$select hq.create_decision('x', 'strategy', null, 'reversed')$$, '22023', null, 'a new decision cannot start reversed');
select throws_ok(format($$select hq.create_decision('x', 'strategy', null, null, null, null, %L)$$, pg_temp.fx('outsider')), '22023', 'the decision maker must be an active member of staff', 'a non-staff decision maker is refused');
select pg_temp.unbecome();
update hq.staff_profiles set is_active = false where id = pg_temp.fx('va');
select pg_temp.become('dir');
select throws_ok(format($$select hq.create_decision('x', 'strategy', null, null, null, null, %L)$$, pg_temp.fx('va')), '22023', 'the decision maker must be an active member of staff', 'an inactive decision maker is refused');
select throws_ok(format($$select hq.update_decision(%L, p_decision_maker => %L)$$, pg_temp.did('a'), pg_temp.fx('va')), '22023', null, 'changing the decision maker to an inactive person is refused');
select pg_temp.unbecome();
update hq.staff_profiles set is_active = true where id = pg_temp.fx('va');
-- a decision maker who leaves stays on the decisions they made
update hq.staff_profiles set is_active = false where id = pg_temp.fx('dir2');
select pg_temp.become('dir');
insert into zz_r select 'b_edit', hq.update_decision(pg_temp.did('b'), p_rationale => 'Market comparison of four agencies');
select pg_temp.unbecome();
update hq.staff_profiles set is_active = true where id = pg_temp.fx('dir2');
select is((pg_temp.r('b_edit') ->> 'changed')::boolean, true, 'a decision whose maker has since left can still be edited (the maker is kept)');
select is((select count(*) from hq.decisions where title = 'x'), 0::bigint, 'every refused create wrote nothing');

-- ------------------------------------------------------------ forged callers
select pg_temp.become_anon();
select throws_ok('select 1 from hq.decisions', '42501', null, 'anon is denied on hq.decisions');
select throws_ok('select 1 from hq.decision_overview', '42501', null, 'anon is denied on the overview');
select throws_ok($$select hq.create_decision('Anon', 'other')$$, '42501', null, 'anon cannot create a decision');
select pg_temp.unbecome();

select pg_temp.become('outsider');
select is((select count(*) from hq.decisions) + (select count(*) from hq.decision_history) + (select count(*) from hq.decision_tasks) + (select count(*) from hq.decision_overview), 0::bigint, 'non-staff: reads nothing');
select throws_ok($$select hq.create_decision('Outsider', 'other')$$, '42501', null, 'non-staff cannot create a decision');
select throws_ok(format($$select hq.update_decision(%L, 'Hacked')$$, pg_temp.did('a')), '42501', null, 'non-staff cannot update a decision');
select pg_temp.unbecome();

select pg_temp.become('dir', 'aal1');
select is((select count(*) from hq.decisions), 0::bigint, 'aal1 under require_mfa: reads no decision');
select throws_ok($$select hq.create_decision('Aal1', 'other')$$, '42501', null, 'aal1 under require_mfa: cannot create a decision');
select pg_temp.unbecome();

select pg_temp.become('ro');
select is((select count(*) from hq.decisions), 4::bigint, 'read_only reads every live decision');
select is((select count(*) from hq.decision_history where decision_id = pg_temp.did('a')), 1::bigint, 'read_only reads the history');
select throws_ok($$select hq.create_decision('Ro', 'other')$$, '42501', null, 'read_only cannot create a decision');
select throws_ok(format($$select hq.update_decision(%L, 'Ro edit')$$, pg_temp.did('a')), '42501', null, 'read_only cannot update a decision');
select throws_ok(format($$select hq.supersede_decision(%L, %L, 'ro')$$, pg_temp.did('a'), pg_temp.did('b')), '42501', null, 'read_only cannot supersede');
select throws_ok(format($$select hq.link_decision_task(%L, %L)$$, pg_temp.did('a'), pg_temp.fx('t_dir')), '42501', null, 'read_only cannot link a task');
select throws_ok(format($$select hq.archive_record('decision', %L)$$, pg_temp.did('a')), '42501', null, 'read_only cannot archive a decision');
select throws_ok(format($$insert into hq.decisions (title, category, decision_date, decision_maker_id) values ('forged', 'other', current_date, %L)$$, pg_temp.fx('ro')), '42501', null, 'read_only cannot insert a decision directly');
select pg_temp.unbecome();

select pg_temp.become('jpm');
select is((select count(*) from hq.decisions) + (select count(*) from hq.decision_history) + (select count(*) from hq.decision_overview), 0::bigint, 'junior (no decisions.read): reads nothing');
select throws_ok($$select hq.create_decision('Junior', 'other')$$, '42501', null, 'junior cannot create a decision');
select pg_temp.unbecome();

select pg_temp.become('pm');
select is((select count(*) from hq.decisions), 0::bigint, 'property manager (no decisions.read): reads nothing');
select throws_ok($$select hq.create_decision('Pm', 'other')$$, '42501', null, 'property manager cannot create a decision');
select pg_temp.unbecome();

select pg_temp.become('spm');
select is((select count(*) from hq.decision_overview where deleted_at is null), 4::bigint, 'senior PM reads the register');
select throws_ok($$select hq.create_decision('Spm', 'other')$$, '42501', null, 'senior PM (decisions.read only) cannot create a decision');
select throws_ok(format($$select hq.update_decision(%L, p_status => 'reversed', p_note => 'no')$$, pg_temp.did('a')), '42501', null, 'senior PM cannot reverse a decision');
select pg_temp.unbecome();

select pg_temp.become('bdm');
select is((select count(*) from hq.decisions), 4::bigint, 'BDM reads the register');
select throws_ok($$select hq.create_decision('Bdm', 'other')$$, '42501', null, 'BDM cannot create a decision');
select pg_temp.unbecome();

select pg_temp.become('va');
select is((select count(*) from hq.decisions), 0::bigint, 'virtual assistant (no decisions.read): reads nothing');
select pg_temp.unbecome();

select pg_temp.become('adm');
insert into zz_r select 'e', hq.create_decision('Administrator records a decision', 'operations');
select pg_temp.unbecome();
select is((select created_by from hq.decisions where id = pg_temp.did('e')), pg_temp.fx('adm'), 'an administrator can record a decision');

-- ------------------------------------------------------------ no direct writes (even for a director)
select pg_temp.become('dir');
select throws_ok(format($$insert into hq.decisions (title, category, decision_date, decision_maker_id) values ('direct', 'other', current_date, %L)$$, pg_temp.fx('dir')), '42501', null, 'a director cannot insert a decision directly');
select throws_ok(format($$update hq.decisions set title = 'direct' where id = %L$$, pg_temp.did('a')), '42501', null, 'a director cannot update a decision directly');
select throws_ok(format($$delete from hq.decisions where id = %L$$, pg_temp.did('a')), '42501', null, 'a director cannot delete a decision');
select throws_ok(format($$insert into hq.decision_history (decision_id, action, summary) values (%L, 'update', 'forged')$$, pg_temp.did('a')), '42501', null, 'a director cannot write history directly');
select throws_ok(format($$insert into hq.decision_tasks (decision_id, task_id) values (%L, %L)$$, pg_temp.did('a'), pg_temp.fx('t_dir')), '42501', null, 'a director cannot link a task directly');
select pg_temp.unbecome();
select throws_ok(format($$delete from hq.decisions where id = %L$$, pg_temp.did('a')), '42501', null, 'a decision cannot be deleted even by the table owner');

-- ------------------------------------------------------------ update: fields, no-ops, history, audit
select pg_temp.become('dir');
insert into zz_r select 'a_t', hq.update_decision(pg_temp.did('a'), p_title => 'Long-term residential management comes first', p_note => 'Clearer wording');
insert into zz_r select 'a_same', hq.update_decision(pg_temp.did('a'), p_title => 'Long-term residential management comes first');
insert into zz_r select 'a_none', hq.update_decision(pg_temp.did('a'));
insert into zz_r select 'a_clear', hq.update_decision(pg_temp.did('a'), p_description => '');
insert into zz_r select 'a_status', hq.update_decision(pg_temp.did('a'), p_status => 'in_effect');
select throws_ok(format($$select hq.update_decision(%L, p_title => '')$$, pg_temp.did('a')), '22023', 'a decision needs a title', 'an update cannot blank the title');
select throws_ok(format($$select hq.update_decision(%L, p_decision_date => hq.today() + 8)$$, pg_temp.did('a')), '22023', null, 'an update cannot move the date more than 7 days ahead');
select throws_ok(format($$select hq.update_decision(%L, p_title => 'Stale', p_expected_updated_at => %L)$$, pg_temp.did('a'), '2001-01-01 00:00:00+00'), '23514', null, 'an update made from a stale copy is refused');
select throws_ok(format($$select hq.update_decision(%L, 'x')$$, gen_random_uuid()), 'P0002', null, 'an unknown decision is not found');
select pg_temp.unbecome();

select is((pg_temp.r('a_same') ->> 'changed')::boolean, false, 'the same title again: changed false');
select is((pg_temp.r('a_none') ->> 'changed')::boolean, false, 'an update with nothing in it: changed false');
select is((select description from hq.decisions where id = pg_temp.did('a')), null, 'an empty description clears it');
select is(pg_temp.hist(pg_temp.did('a')), 4::bigint, 'history: create + title + description + status, and nothing for the two no-ops');
select is((select changes from hq.decision_history where decision_id = pg_temp.did('a') and action = 'update' and note = 'Clearer wording'),
  '{"title": {"from": "Long-term residential management first", "to": "Long-term residential management comes first"}}'::jsonb, 'history: the title change records from and to');
select is((select summary from hq.decision_history where decision_id = pg_temp.did('a') and action = 'status_change'), 'Status changed from Decided to In effect', 'history: a status change in plain words');
select is(pg_temp.audits(pg_temp.did('a'), 'update'), 2::bigint, 'audit: one update row per real change (title, description)');
select is(pg_temp.audits(pg_temp.did('a'), 'status_change'), 1::bigint, 'audit: the status change is its own action');
select is((pg_temp.r('a_status') -> 'changed_fields'), '["status"]'::jsonb, 'the result lists what changed');

-- ------------------------------------------------------------ supersede
select pg_temp.become('dir');
select throws_ok(format($$select hq.supersede_decision(%L, %L, 'self')$$, pg_temp.did('b'), pg_temp.did('b')), '22023', 'a decision cannot supersede itself', 'a decision cannot supersede itself');
select throws_ok(format($$select hq.update_decision(%L, p_status => 'superseded', p_note => 'no target')$$, pg_temp.did('b')), '22023', 'say which decision supersedes this one', 'superseded without a target is refused');
select throws_ok(format($$select hq.supersede_decision(%L, %L, '   ')$$, pg_temp.did('b'), pg_temp.did('d')), '22023', 'a note is required to supersede a decision', 'superseding needs a note');
select throws_ok(format($$select hq.supersede_decision(%L, %L, 'gone')$$, pg_temp.did('b'), gen_random_uuid()), 'P0002', null, 'an unknown superseding decision is not found');
select throws_ok(format($$select hq.update_decision(%L, p_status => 'decided', p_superseded_by => %L)$$, pg_temp.did('b'), pg_temp.did('d')), '22023', null, 'a superseding decision with another status is refused');
insert into zz_r select 'b_sup', hq.supersede_decision(pg_temp.did('b'), pg_temp.did('d'), 'Pricing changed');
insert into zz_r select 'b_sup2', hq.supersede_decision(pg_temp.did('b'), pg_temp.did('d'), 'Pricing changed');
select throws_ok(format($$select hq.supersede_decision(%L, %L, 'again')$$, pg_temp.did('b'), pg_temp.did('e')), '23514', null, 'a superseded decision cannot be superseded by another (closed)');
select throws_ok(format($$select hq.update_decision(%L, p_status => 'decided')$$, pg_temp.did('b')), '23514', null, 'a superseded decision cannot be reopened (closed)');
select throws_ok(format($$select hq.supersede_decision(%L, %L, 'by a superseded one')$$, pg_temp.did('e'), pg_temp.did('b')), '23514', null, 'the superseding decision must be in force (not itself superseded)');
select pg_temp.unbecome();

select is((select status::text || '|' || superseded_by_id::text from hq.decisions where id = pg_temp.did('b')), 'superseded|' || pg_temp.did('d'), 'supersede: status superseded and the target set together');
select is((select status::text from hq.decisions where id = pg_temp.did('d')), 'decided', 'supersede: the superseding decision keeps its status');
select is((pg_temp.r('b_sup2') ->> 'changed')::boolean, false, 'supersede again by the same decision: changed false');
select is((select count(*) from hq.decision_history where decision_id = pg_temp.did('b') and action = 'supersede'), 1::bigint, 'history: exactly one supersede row on the old decision');
select is((select count(*) from hq.decision_history where decision_id = pg_temp.did('d') and action = 'supersedes'), 1::bigint, 'history: exactly one supersedes row on the new decision');
select is((select summary from hq.decision_history where decision_id = pg_temp.did('b') and action = 'supersede'), 'Superseded by ' || (pg_temp.r('d') ->> 'ref'), 'history: the supersede summary names the new ref');
select is((select note from hq.decision_history where decision_id = pg_temp.did('d') and action = 'supersedes'), 'Pricing changed', 'history: the note is kept on both decisions');
select is(pg_temp.audits(pg_temp.did('b'), 'supersede'), 1::bigint, 'audit: one supersede row');
select is((select superseded_by_ref || '|' || superseded_by_title from hq.decision_overview where id = pg_temp.did('b')), (pg_temp.r('d') ->> 'ref') || '|' || repeat('t', 200), 'overview: superseded_by ref and title');

-- the database itself, for every writer
select throws_ok(format($$update hq.decisions set status = 'superseded' where id = %L$$, pg_temp.did('c')), '23514', null, 'superseded without a target breaks a constraint (table owner)');
select throws_ok(format($$update hq.decisions set status = 'decided', superseded_by_id = %L where id = %L$$, pg_temp.did('c'), pg_temp.did('c')), '23514', null, 'a self-reference breaks a constraint (table owner)');
select throws_ok(format($$update hq.decisions set status = 'superseded', superseded_by_id = %L where id = %L$$, pg_temp.did('b'), pg_temp.did('d')), '23514', 'that would make a loop of decisions superseding each other', 'a supersession loop is refused (table owner)');
select throws_ok(format($$update hq.decisions set status = 'reversed' where id = %L$$, pg_temp.did('c')), '23514', null, 'reversed without a note breaks a constraint (table owner)');

-- ------------------------------------------------------------ reverse
select pg_temp.become('dir');
select throws_ok(format($$select hq.update_decision(%L, p_status => 'reversed')$$, pg_temp.did('c')), '22023', 'a note is required to reverse a decision', 'reversing needs a note');
insert into zz_r select 'c_rev', hq.update_decision(pg_temp.did('c'), p_status => 'reversed', p_note => 'Not worth the time this year');
select throws_ok(format($$select hq.update_decision(%L, p_status => 'proposed')$$, pg_temp.did('c')), '23514', null, 'a reversed decision cannot be reopened (closed)');
insert into zz_r select 'c_edit', hq.update_decision(pg_temp.did('c'), p_rationale => 'Kept for the record');
select pg_temp.unbecome();
select is((select status::text || '|' || reversed_note from hq.decisions where id = pg_temp.did('c')), 'reversed|Not worth the time this year', 'reverse: status reversed with the note kept');
select is((select count(*) from hq.decision_history where decision_id = pg_temp.did('c') and action = 'reverse' and summary = 'Reversed' and note = 'Not worth the time this year'), 1::bigint, 'history: one reverse row with the note');
select is(pg_temp.audits(pg_temp.did('c'), 'reverse'), 1::bigint, 'audit: one reverse row');
select is((pg_temp.r('c_edit') ->> 'changed')::boolean, true, 'a closed decision''s wording can still be corrected (its status cannot)');

-- ------------------------------------------------------------ history is append-only, for every role
select throws_ok($$update hq.decision_history set summary = 'changed'$$, '42501', null, 'decision_history: update raises even as postgres');
select throws_ok($$delete from hq.decision_history$$, '42501', null, 'decision_history: delete raises even as postgres');
select throws_ok($$truncate hq.decision_history$$, '42501', null, 'decision_history: truncate raises even as postgres');
select throws_ok($$truncate hq.decisions cascade$$, '42501', null, 'decisions: truncate (even with cascade) raises as postgres');
select throws_ok($$truncate hq.decision_tasks$$, '42501', null, 'decision_tasks: truncate raises as postgres');

-- ------------------------------------------------------------ task links
select pg_temp.become('dir');
insert into zz_r select 'l1', hq.link_decision_task(pg_temp.did('a'), pg_temp.fx('t_dir'));
insert into zz_r select 'l1b', hq.link_decision_task(pg_temp.did('a'), pg_temp.fx('t_dir'));
insert into zz_r select 'l2', hq.link_decision_task(pg_temp.did('a'), pg_temp.fx('t_pm'));
select throws_ok(format($$select hq.link_decision_task(%L, %L)$$, pg_temp.did('a'), pg_temp.fx('t_arch')), 'P0002', 'task not found', 'an archived task cannot be linked');
select throws_ok(format($$select hq.link_decision_task(%L, %L)$$, pg_temp.did('a'), gen_random_uuid()), 'P0002', 'task not found', 'an unknown task cannot be linked');
select pg_temp.unbecome();
select is((pg_temp.r('l1') ->> 'changed')::boolean, true, 'link: changed');
select is((pg_temp.r('l1b') ->> 'changed')::boolean, false, 'link again: changed false');
select is((select count(*) from hq.decision_tasks where decision_id = pg_temp.did('a')), 2::bigint, 'two tasks linked');
select throws_ok(format($$update hq.decision_tasks set linked_by = null where decision_id = %L$$, pg_temp.did('a')), '42501', null, 'decision_tasks: a link is never edited');
select is((select count(*) from hq.decision_history where decision_id = pg_temp.did('a') and action = 'link_task'), 2::bigint, 'history: one row per new link');
select is(pg_temp.audits(pg_temp.did('a'), 'link_task'), 2::bigint, 'audit: one row per new link');

-- a writer who cannot see every task may link only the tasks they can see (granted for this test only)
insert into hq.role_capabilities values ('property_manager', 'decisions.read'), ('property_manager', 'decisions.write'), ('junior_property_manager', 'decisions.read');
select pg_temp.become('pm');
select throws_ok(format($$select hq.link_decision_task(%L, %L)$$, pg_temp.did('d'), pg_temp.fx('t_spm')), 'P0002', 'task not found', 'a task the linker cannot see cannot be linked (not found, no hint)');
insert into zz_r select 'l3', hq.link_decision_task(pg_temp.did('d'), pg_temp.fx('t_pm'));
select is((select linked_task_count from hq.decision_overview where id = pg_temp.did('a')), 1::bigint, 'overview: the linked task count includes only tasks the reader can see');
select pg_temp.unbecome();
select is((pg_temp.r('l3') ->> 'changed')::boolean, true, 'a writer can link a task they can see');
select pg_temp.become('jpm');
select is((select linked_task_count from hq.decision_overview where id = pg_temp.did('a')), 0::bigint, 'overview: a reader who sees none of the linked tasks counts 0');
select is((select count(*) from hq.decision_tasks where decision_id = pg_temp.did('a')), 2::bigint, '... while the link rows themselves are visible to any reader of the decision');
select pg_temp.unbecome();
delete from hq.role_capabilities where (role, capability) in (('property_manager', 'decisions.read'), ('property_manager', 'decisions.write'), ('junior_property_manager', 'decisions.read'));
select pg_temp.become('ro');
select is((select linked_task_count || '/' || open_linked_task_count from hq.decision_overview where id = pg_temp.did('a')), '2/2', 'overview: read_only (tasks.read_all) counts both linked tasks, both open');
select pg_temp.unbecome();

select pg_temp.become('dir');
insert into zz_r select 'u1', hq.unlink_decision_task(pg_temp.did('a'), pg_temp.fx('t_pm'));
insert into zz_r select 'u1b', hq.unlink_decision_task(pg_temp.did('a'), pg_temp.fx('t_pm'));
select pg_temp.unbecome();
select is((pg_temp.r('u1') ->> 'changed')::boolean || '/' || (pg_temp.r('u1b') ->> 'changed')::boolean, 'true/false', 'unlink: changed, then changed false');
select is((select count(*) from hq.decision_history where decision_id = pg_temp.did('a') and action = 'unlink_task'), 1::bigint, 'history: one unlink row');
select is(pg_temp.audits(pg_temp.did('a'), 'unlink_task'), 1::bigint, 'audit: one unlink row');

-- ------------------------------------------------------------ archive and restore
select pg_temp.become('dir');
select throws_ok(format($$select hq.archive_record('decision', %L)$$, pg_temp.did('d')), '23514', null, 'a decision that a live decision is superseded by cannot be archived');
insert into zz_r select 'arch_b', hq.archive_record('decision', pg_temp.did('b'), 'Recorded twice');
insert into zz_r select 'arch_d', hq.archive_record('decision', pg_temp.did('d'));
select throws_ok(format($$select hq.update_decision(%L, 'Edit archived')$$, pg_temp.did('d')), 'P0002', null, 'an archived decision cannot be edited');
select throws_ok(format($$select hq.restore_record('decision', %L)$$, pg_temp.did('b')), '23514', null, 'restoring a decision whose superseding decision is archived is refused');
select is((select count(*) from hq.decisions where id in (pg_temp.did('b'), pg_temp.did('d'))), 2::bigint, 'a writer still sees archived decisions (to restore them)');
select pg_temp.unbecome();
select pg_temp.become('ro');
select is((select count(*) from hq.decisions where id in (pg_temp.did('b'), pg_temp.did('d'))), 0::bigint, 'a reader does not see archived decisions');
select is((select count(*) from hq.decision_history where decision_id = pg_temp.did('b')), 0::bigint, '... nor their history');
select pg_temp.unbecome();
select pg_temp.become('dir');
insert into zz_r select 'rest_d', hq.restore_record('decision', pg_temp.did('d'));
insert into zz_r select 'rest_b', hq.restore_record('decision', pg_temp.did('b'));
select pg_temp.unbecome();
select is((select count(*) from hq.decisions where id in (pg_temp.did('b'), pg_temp.did('d')) and deleted_at is null and deleted_by is null), 2::bigint, 'restored in order (the target first), deleted_by cleared');
select is((select count(*) from hq.decision_history where decision_id = pg_temp.did('b') and action in ('archive', 'restore')), 2::bigint, 'history: archive and restore rows');
select is((select note from hq.decision_history where decision_id = pg_temp.did('b') and action = 'archive'), 'Recorded twice', 'history: the archive reason is kept');
select is(pg_temp.audits(pg_temp.did('b'), 'archive') + pg_temp.audits(pg_temp.did('b'), 'restore'), 2::bigint, 'audit: archive and restore rows');

-- ------------------------------------------------------------ the overview (list and search shape)
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'hq' and table_name = 'decision_overview'),
  array['id', 'ref_number', 'ref', 'title', 'description', 'rationale', 'category', 'status', 'decision_date', 'decision_maker_id', 'decision_maker_name',
        'superseded_by_id', 'superseded_by_ref', 'superseded_by_title', 'reversed_note', 'linked_task_count', 'open_linked_task_count', 'created_by', 'created_at', 'updated_at', 'deleted_at'],
  'overview: the documented columns, in order');
select pg_temp.become('bdm');
select is((select ref = pg_temp.r('a') ->> 'ref' and decision_maker_name = 'Dana Director' and category = 'strategy' and status = 'in_effect' from hq.decision_overview where id = pg_temp.did('a')), true, 'overview: ref, decision maker name, category and status');
select is((select array_agg(ref order by ref) from hq.decision_overview where deleted_at is null and (title ilike '%pricing%' or description ilike '%pricing%' or rationale ilike '%pricing%')), array[pg_temp.r('b') ->> 'ref'], 'search: a word in the title finds the decision');
select is((select count(*) from hq.decision_overview where deleted_at is null and (title ilike '%year one%' or description ilike '%year one%' or rationale ilike '%year one%')), 1::bigint, 'search: a word in the rationale finds the decision');
select pg_temp.unbecome();
select is(hq_private.decision_ref(7), 'DEC-0007', 'decision_ref pads to four digits');
select is(hq_private.decision_ref(123456), 'DEC-123456', 'decision_ref never truncates a long number');

select * from finish();
rollback;
