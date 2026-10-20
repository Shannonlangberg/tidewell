-- Planted HQ: Projects and richer tasks (migrations 0142-0145), part B: bulk_create_tasks,
-- bulk_update_tasks and the bulk budget.
-- Forged callers (anon, non-staff, aal1, read_only, a junior naming a project, a junior without
-- tasks.write) refused with nothing written and no budget used; size limits (1 and 50 pass, 0 and 51
-- refused); partial success with per-entry plain errors (bad fields, unknown milestone, unknown ref,
-- inactive assignee, invisible dependency, cycles, cascades from failed entries and failed parents);
-- intra-batch dependencies and parents in any order; atomic mode (all or nothing); idempotent replay
-- (same key, same request: the stored result, nothing written, no budget) and the same key with a
-- different request refused; the bulk budget boundaries (6th call passes, 7th refused; 300 items pass,
-- the 301st refused; usage older than an hour no longer counts); one audit event per call and per-row
-- audit, 'Created in bulk' activity, one project activity row per call; bulk updates with the
-- single-update rules (visibility, the assignment rule); RLS on what bulk calls wrote.
--
-- NOTE: never CALL a function a hint role lacks execute on (see hq_01). Every RPC here is granted to
-- authenticated; anon is refused at the schema.
begin;
\ir hq_fixture.inc
select pg_temp.seed_hq();
select plan(122);

update hq.projects set deleted_at = now() where deleted_at is null;
update hq.settings set value = '6'::jsonb where key = 'bulk_calls_per_hour';
update hq.settings set value = '300'::jsonb where key = 'bulk_items_per_hour';

create temp table zz_r (k text primary key, v jsonb) on commit drop;
grant select, insert on zz_r to public;
create function pg_temp.r(p_k text) returns jsonb language sql stable as $$ select v from zz_r where k = p_k $$;
create function pg_temp.pid(p_k text) returns uuid language sql stable as $$ select (v ->> 'project_id')::uuid from zz_r where k = p_k $$;
-- the errors of the failed entry at index p_i of result p_k
create function pg_temp.ferr(p_k text, p_i integer) returns jsonb language sql stable as $$
  select e -> 'errors' from zz_r, jsonb_array_elements(v -> 'failed') e where k = p_k and (e ->> 'index')::integer = p_i $$;
-- the id created for ref p_ref in result p_k
create function pg_temp.cid(p_k text, p_ref text) returns uuid language sql stable as $$
  select (e ->> 'id')::uuid from zz_r, jsonb_array_elements(v -> 'created') e where k = p_k and e ->> 'ref' = p_ref $$;
create function pg_temp.used(p_who text) returns text language sql stable as $$
  select coalesce(sum(calls), 0) || '/' || coalesce(sum(items), 0) from hq.bulk_usage where staff_id = pg_temp.fx(p_who) $$;
create function pg_temp.one(p_title text) returns jsonb language sql immutable as $$ select jsonb_build_array(jsonb_build_object('title', p_title)) $$;
create function pg_temp.many(p_prefix text, p_n integer) returns jsonb language sql immutable as $$
  select jsonb_agg(jsonb_build_object('title', p_prefix || ' ' || g) order by g) from generate_series(1, p_n) g $$;

-- a project with a milestone, and a private task of the director's
select pg_temp.become('dir');
insert into zz_r select 'p', hq.create_project('Bulk launch [test]', p_status => 'active');
insert into zz_r select 'm', hq.create_milestone(pg_temp.pid('p'), 'Licensing');
select pg_temp.unbecome();
insert into hq.tasks (title, assigned_to, created_by) values ('Director private [test]', pg_temp.fx('dir'), pg_temp.fx('dir')) returning id \gset priv_

-- ------------------------------------------------------------ forged callers: refused, nothing written, no budget used
select pg_temp.become_anon();
select throws_ok($$select hq.bulk_create_tasks(pg_temp.one('Forged anon'), 'key-forged-0001')$$, '42501', null, 'anon cannot bulk create');
select pg_temp.unbecome();
select pg_temp.become('outsider');
select throws_ok($$select hq.bulk_create_tasks(pg_temp.one('Forged outsider'), 'key-forged-0001')$$, '42501', null, 'a signed-in person who is not staff cannot bulk create');
select pg_temp.become('dir', 'aal1');
select throws_ok($$select hq.bulk_create_tasks(pg_temp.one('Forged aal1'), 'key-forged-0001')$$, '42501', null, 'a director without MFA (aal1) cannot bulk create');
select pg_temp.become('ro');
select throws_ok($$select hq.bulk_create_tasks(pg_temp.one('Forged ro'), 'key-forged-0001')$$, '42501', null, 'read_only (no tasks.write) cannot bulk create');
select throws_ok(format($$select hq.bulk_update_tasks(jsonb_build_array(jsonb_build_object('id', %L, 'priority', 'low')), 'key-forged-0002')$$, :'priv_id'), '42501', null, 'read_only cannot bulk update');
select pg_temp.become('jpm');
select throws_ok(format($$select hq.bulk_create_tasks(pg_temp.one('Forged junior project'), 'key-forged-0001', %L)$$, pg_temp.pid('p')), '42501', null, 'a junior (no projects.write) cannot bulk create into a project');
select throws_ok(format($$select hq.bulk_create_tasks(jsonb_build_array(jsonb_build_object('title', 'Forged junior entry project', 'project', %L)), 'key-forged-0003')$$, pg_temp.pid('p')), '42501', null, '... nor name a project in an entry');
select pg_temp.unbecome();
delete from hq.role_capabilities where role = 'junior_property_manager' and capability = 'tasks.write';
select pg_temp.become('jpm');
select throws_ok($$select hq.bulk_create_tasks(pg_temp.one('Forged junior no tasks.write'), 'key-forged-0004')$$, '42501', null, 'a junior without tasks.write cannot bulk create');
select pg_temp.unbecome();
insert into hq.role_capabilities (role, capability) values ('junior_property_manager', 'tasks.write');
select is((select count(*) from hq.tasks where title like 'Forged%'), 0::bigint, 'no forged call created a task');
select is((select count(*) from hq.bulk_usage where staff_id in (select id from fx)) + (select count(*) from hq.idempotency_keys where staff_id in (select id from fx)), 0::bigint, 'no forged call used any budget or stored a key');

-- ------------------------------------------------------------ size limits and arguments
select pg_temp.become('dir');
select throws_ok($$select hq.bulk_create_tasks('[]'::jsonb, 'key-size-0001')$$, '22023', 'give at least one entry in tasks', '0 entries are refused');
select throws_ok($$select hq.bulk_create_tasks(pg_temp.many('Too many', 51), 'key-size-0002')$$, '22023', 'at most 50 entries in one call (51 given): split the plan into calls of 50 or fewer', '51 entries are refused');
select throws_ok($$select hq.bulk_create_tasks('{"title": "x"}'::jsonb, 'key-size-0003')$$, '22023', 'tasks must be a list', 'tasks must be a list');
select throws_ok($$select hq.bulk_create_tasks('["x"]'::jsonb, 'key-size-0004')$$, '22023', 'each task must be an object', 'each task must be an object');
select throws_ok($$select hq.bulk_create_tasks(pg_temp.one('Short key'), 'short')$$, '22023', 'an idempotency key is 8 to 80 characters (a fresh UUID per plan is ideal)', 'a key under 8 characters is refused');
select throws_ok($$select hq.bulk_create_tasks(pg_temp.one('No key'), null)$$, '22023', null, 'a missing key is refused');
select throws_ok($$select hq.bulk_create_tasks(pg_temp.one('Gone project'), 'key-size-0005', gen_random_uuid())$$, 'P0002', 'project not found', 'an unknown batch project is not found');
select throws_ok($$select hq.bulk_update_tasks('[]'::jsonb, 'key-size-0006')$$, '22023', 'give at least one entry in updates', '0 updates are refused');
select pg_temp.unbecome();
select is(pg_temp.used('dir'), '0/0', 'refused calls use no budget');

-- ------------------------------------------------------------ one entry
select pg_temp.become('dir');
insert into zz_r select 'one', hq.bulk_create_tasks(pg_temp.one('Single bulk task'), 'key-one-000001', pg_temp.pid('p'));
select pg_temp.unbecome();
select is((pg_temp.r('one') ->> 'created_count') || '|' || (pg_temp.r('one') ->> 'failed_count') || '|' || (pg_temp.r('one') ->> 'duplicate'), '1|0|false', 'one entry: created 1, failed 0, not a duplicate');
select is((select source || '|' || assigned_to || '|' || created_by || '|' || project_id from hq.tasks where title = 'Single bulk task'),
  'bulk|' || pg_temp.fx('dir') || '|' || pg_temp.fx('dir') || '|' || pg_temp.pid('p'), 'source bulk, assigned to the caller by default, in the batch project');
select is((select string_agg(kind || ':' || summary, ',') from hq.task_activity where task_id = (select id from hq.tasks where title = 'Single bulk task')), 'created:Created in bulk', 'activity: Created in bulk');
select is((select count(*) from hq.audit_events where action = 'bulk_create' and entity_type = 'task_batch' and actor_id = pg_temp.fx('dir')), 1::bigint, 'one audit event for the call');
select is((select changes ->> 'entries' || '/' || (changes ->> 'created') || '/' || (changes ? 'key_hash')::text from hq.audit_events where action = 'bulk_create' and actor_id = pg_temp.fx('dir')), '1/1/true',
  '... with the counts and a hash of the key');
select is((select count(*) from hq.audit_events where entity_type = 'task' and action = 'create' and entity_id = (select id from hq.tasks where title = 'Single bulk task')), 1::bigint, '... plus the normal per-row task audit');
select is((select string_agg(kind, ',') from hq.project_activity where project_id = pg_temp.pid('p') and kind in ('bulk_created', 'task_created')), 'bulk_created', 'ONE project activity row for the call (no per-task rows)');
select is(pg_temp.used('dir'), '1/1', 'the call used 1 call and 1 item of the budget');

-- ------------------------------------------------------------ fifty entries: a chain of dependencies sent in reverse order, with subtasks
select pg_temp.become('dir');
insert into zz_r select 'fifty', hq.bulk_create_tasks(
  (select jsonb_agg(jsonb_build_object('ref', 'r' || g, 'title', 'Chain ' || g)
                    || case when g > 1 then jsonb_build_object('depends_on', jsonb_build_array('r' || (g - 1))) else '{}'::jsonb end
                    || case when g between 2 and 4 then jsonb_build_object('parent_ref', 'r1') else '{}'::jsonb end
                    order by g desc) from generate_series(1, 50) g),
  'key-fifty-00001', pg_temp.pid('p'));
select pg_temp.unbecome();
select is((pg_temp.r('fifty') ->> 'created_count') || '|' || (pg_temp.r('fifty') ->> 'failed_count'), '50|0', '50 entries: all created in one call');
select is((select count(*) from hq.task_dependencies d join hq.tasks t on t.id = d.task_id where t.title like 'Chain %'), 49::bigint, '49 dependencies between the batch''s own tasks');
select is((select count(*) from hq.tasks where parent_task_id = pg_temp.cid('fifty', 'r1')), 3::bigint, 'three subtasks of r1 by parent_ref');
select is((select d.depends_on_task_id from hq.task_dependencies d where d.task_id = pg_temp.cid('fifty', 'r50')), pg_temp.cid('fifty', 'r49'), 'r50 waits for r49');
select is((select string_agg(is_blocked::text, ',' order by title) from hq.task_overview where id in (pg_temp.cid('fifty', 'r1'), pg_temp.cid('fifty', 'r50'))), 'false,true', 'r1 is free, r50 is blocked');
select is((select (e ->> 'index') || ':' || (e ->> 'ref') from jsonb_array_elements(pg_temp.r('fifty') -> 'created') e where e ->> 'ref' = 'r50'), '0:r50', 'created entries report their index and ref');
select is(pg_temp.used('dir'), '2/51', 'budget: 2 calls, 51 items');

-- ------------------------------------------------------------ partial success: per-entry errors and cascades
select pg_temp.become('pm');
insert into zz_r select 'part', hq.bulk_create_tasks(jsonb_build_array(
  jsonb_build_object('ref', 'A', 'title', 'B-A'),
  jsonb_build_object('ref', 'B', 'title', 'B-B', 'priority', 'very high'),
  jsonb_build_object('ref', 'C', 'title', 'B-C', 'depends_on', jsonb_build_array('B')),
  jsonb_build_object('ref', 'D', 'title', 'B-D', 'parent_ref', 'A'),
  jsonb_build_object('ref', 'E', 'title', 'B-E', 'depends_on', jsonb_build_array('A'), 'milestone', ' licensing '),
  jsonb_build_object('ref', 'F', 'title', 'B-F', 'milestone', 'Nope'),
  jsonb_build_object('ref', 'G', 'title', 'B-G', 'depends_on', jsonb_build_array('ghost')),
  jsonb_build_object('ref', 'H', 'title', 'B-H', 'assignee', pg_temp.fx('outsider')),
  jsonb_build_object('ref', 'I', 'title', 'B-I', 'depends_on', jsonb_build_array(:'priv_id')),
  jsonb_build_object('ref', 'J', 'title', 'B-J', 'depends_on', jsonb_build_array('K'), 'assignee', pg_temp.fx('va'), 'due_date', (hq.today() + 7)::text),
  jsonb_build_object('ref', 'K', 'title', 'B-K', 'checklist', jsonb_build_array('one', 'two')),
  jsonb_build_object('ref', 'M', 'title', 'B-M', 'depends_on', jsonb_build_array('N')),
  jsonb_build_object('ref', 'N', 'title', 'B-N', 'depends_on', jsonb_build_array('M')),
  jsonb_build_object('ref', 'O', 'title', 'B-O', 'depends_on', jsonb_build_array('M')),
  jsonb_build_object('title', ''),
  jsonb_build_object('ref', 'Q', 'title', 'B-Q', 'due', 'tomorrow'),
  jsonb_build_object('ref', 'S', 'title', 'B-S', 'parent_ref', 'B')),
  'key-partial-0001', pg_temp.pid('p'));
select pg_temp.unbecome();
select is((pg_temp.r('part') ->> 'created_count') || '|' || (pg_temp.r('part') ->> 'failed_count') || '|' || (pg_temp.r('part') ->> 'rolled_back'), '5|12|false', 'partial: 5 created, 12 failed, nothing rolled back');
select is((select array_agg(e ->> 'ref' order by (e ->> 'index')::integer) from jsonb_array_elements(pg_temp.r('part') -> 'created') e), array['A', 'D', 'E', 'J', 'K'], 'the valid entries were created (J after K although sent first)');
select is(pg_temp.ferr('part', 1), '["priority is low, normal, high or urgent"]'::jsonb, 'B: a bad priority, in plain words');
select is(pg_temp.ferr('part', 2), '["depends on B, which failed"]'::jsonb, 'C: depends on a failed entry');
select is(pg_temp.ferr('part', 5), '["there is no milestone \"Nope\" in this project"]'::jsonb, 'F: an unknown milestone');
select is(pg_temp.ferr('part', 6), '["depends_on \"ghost\" is not a task in this batch or an existing task id"]'::jsonb, 'G: an unknown ref');
select is(pg_temp.ferr('part', 7), '["the person a task is assigned to must be an active member of staff"]'::jsonb, 'H: an assignee who is not active staff');
select is(pg_temp.ferr('part', 8), '["the task it depends on was not found"]'::jsonb, 'I: a dependency the caller cannot see is not found');
select is(pg_temp.ferr('part', 11), '["M is part of a dependency cycle inside this batch"]'::jsonb, 'M: a cycle inside the batch');
select is(pg_temp.ferr('part', 12), '["N is part of a dependency cycle inside this batch"]'::jsonb, 'N: the other end of the cycle');
select is(pg_temp.ferr('part', 13), '["depends on M, which failed"]'::jsonb, 'O: depends on an entry of the cycle');
select is(pg_temp.ferr('part', 14), '["a task needs a title"]'::jsonb, 'an entry without a title');
select is(pg_temp.ferr('part', 15), '["unknown field \"due\""]'::jsonb, 'an unknown field is named');
select is(pg_temp.ferr('part', 16), '["its parent B failed"]'::jsonb, 'S: a subtask of a failed entry');
select is((select (e -> 'ref') from jsonb_array_elements(pg_temp.r('part') -> 'failed') e where (e ->> 'index')::integer = 14), 'null'::jsonb, 'an entry without a ref reports ref null');
select is((select parent_task_id from hq.tasks where title = 'B-D'), pg_temp.cid('part', 'A'), 'D is a subtask of A');
select is((select m.name from hq.tasks t join hq.project_milestones m on m.id = t.milestone_id where t.title = 'B-E'), 'Licensing', 'E found its milestone by name (case and spaces ignored)');
select is((select d.depends_on_task_id from hq.task_dependencies d where d.task_id = pg_temp.cid('part', 'J')), pg_temp.cid('part', 'K'), 'J waits for K');
select is((select assigned_to || '|' || due_date || '|' || created_by from hq.tasks where title = 'B-J'), pg_temp.fx('va') || '|' || (hq.today() + 7) || '|' || pg_temp.fx('pm'), 'J is assigned as given, created by the caller');
select is((select count(*) from hq.task_checklist_items c join hq.tasks t on t.id = c.task_id where t.title = 'B-K'), 2::bigint, 'K has its checklist');
select is((select count(*) from hq.tasks where title in ('B-B', 'B-C', 'B-F', 'B-G', 'B-H', 'B-I', 'B-M', 'B-N', 'B-O', 'B-Q', 'B-S')), 0::bigint, 'nothing of a failed entry was written');
select is((select count(*) from hq.task_activity a join hq.tasks t on t.id = a.task_id where t.title like 'B-%' and a.kind = 'created' and a.summary = 'Created in bulk'), 5::bigint, 'each created task has its Created in bulk row');
select is((select detail ->> 'count' from hq.project_activity where project_id = pg_temp.pid('p') and kind = 'bulk_created' and actor_id = pg_temp.fx('pm')), '5', 'one project activity row: 5 tasks created in bulk');
select is((select changes ->> 'created' || '/' || (changes ->> 'failed') from hq.audit_events where action = 'bulk_create' and actor_id = pg_temp.fx('pm')), '5/12', 'the audit event carries the counts');
select is(pg_temp.used('pm'), '1/17', 'budget: 1 call, 17 items (every entry counts)');

-- ------------------------------------------------------------ atomic: all or nothing
select pg_temp.become('pm');
insert into zz_r select 'at1', hq.bulk_create_tasks(jsonb_build_array(
  jsonb_build_object('ref', 'x', 'title', 'AT good'), jsonb_build_object('ref', 'y', 'title', 'AT bad', 'status', 'finished'),
  jsonb_build_object('ref', 'z', 'title', 'AT child', 'parent_ref', 'x')), 'key-atomic-0001', p_atomic => true);
select pg_temp.unbecome();
select is((pg_temp.r('at1') ->> 'created_count') || '|' || (pg_temp.r('at1') ->> 'failed_count') || '|' || (pg_temp.r('at1') ->> 'rolled_back') || '|' || (pg_temp.r('at1') ->> 'atomic'), '0|1|true|true', 'atomic with one bad entry: nothing created, rolled back');
select is(pg_temp.ferr('at1', 1), '["status is to_do, in_progress, waiting, completed or cancelled"]'::jsonb, '... failed lists the bad entry with its error');
select is((select count(*) from hq.tasks where title like 'AT %'), 0::bigint, '... and no task was written');
select is((select count(*) from hq.audit_events where action = 'bulk_create' and actor_id = pg_temp.fx('pm') and (changes ->> 'rolled_back')::boolean), 1::bigint, 'the rolled-back call is still audited');
select is(pg_temp.used('pm'), '2/20', 'an atomic call that rolled back still used its budget');
select pg_temp.become('pm');
insert into zz_r select 'at2', hq.bulk_create_tasks(jsonb_build_array(
  jsonb_build_object('ref', 'x', 'title', 'AT2 good'), jsonb_build_object('ref', 'z', 'title', 'AT2 child', 'parent_ref', 'x')), 'key-atomic-0002', p_atomic => true);
select pg_temp.unbecome();
select is((pg_temp.r('at2') ->> 'created_count') || '|' || (pg_temp.r('at2') ->> 'rolled_back'), '2|false', 'atomic with every entry valid: all created');

-- ------------------------------------------------------------ idempotency
select pg_temp.become('pm');
insert into zz_r select 'rep', hq.bulk_create_tasks(jsonb_build_array(
  jsonb_build_object('ref', 'x', 'title', 'AT2 good'), jsonb_build_object('ref', 'z', 'title', 'AT2 child', 'parent_ref', 'x')), 'key-atomic-0002', p_atomic => true);
select pg_temp.unbecome();
select is((pg_temp.r('rep') ->> 'duplicate')::boolean, true, 'a replay with the same key and request says duplicate');
select is(pg_temp.r('rep') - 'duplicate', pg_temp.r('at2') - 'duplicate', '... and returns the original result');
select is((select count(*) from hq.tasks where title = 'AT2 good'), 1::bigint, '... creating nothing');
select is(pg_temp.used('pm'), '3/22', '... using no budget');
select is((select count(*) from hq.audit_events where action = 'bulk_create' and actor_id = pg_temp.fx('pm')), 3::bigint, '... and writing no audit event');
select pg_temp.become('pm');
select throws_ok($$select hq.bulk_create_tasks(pg_temp.one('Different plan'), 'key-atomic-0002')$$, '22023',
  'that idempotency key was already used for a different request: use a new key for a new plan', 'the same key with a different request is refused');
select throws_ok($$select hq.bulk_create_tasks(jsonb_build_array(jsonb_build_object('ref', 'x', 'title', 'AT2 good'), jsonb_build_object('ref', 'z', 'title', 'AT2 child', 'parent_ref', 'x')), 'key-atomic-0002', p_atomic => false)$$, '22023',
  null, '... also when only the atomic flag differs');
select pg_temp.become('adm');
insert into zz_r select 'adm1', hq.bulk_create_tasks(pg_temp.one('Admin own plan'), 'key-atomic-0002');
select pg_temp.unbecome();
select is((pg_temp.r('adm1') ->> 'created_count')::integer, 1, 'keys belong to one person: another person may use the same key');
alter table hq.idempotency_keys disable trigger append_only;
update hq.idempotency_keys set created_at = now() - interval '49 hours' where staff_id = pg_temp.fx('pm') and key = 'key-atomic-0002';
alter table hq.idempotency_keys enable trigger append_only;
select pg_temp.become('pm');
insert into zz_r select 'exp', hq.bulk_create_tasks(pg_temp.one('After expiry'), 'key-atomic-0002');
select pg_temp.unbecome();
select is((pg_temp.r('exp') ->> 'created_count')::integer, 1, 'a key older than 48 hours has expired and can be used again');

-- ------------------------------------------------------------ the bulk budget: calls
select pg_temp.become('spm');
select lives_ok($$select hq.bulk_create_tasks(pg_temp.one('Budget 1'), 'key-budget-0001')$$, 'call 1 of 6');
select lives_ok($$select hq.bulk_create_tasks(pg_temp.one('Budget 2'), 'key-budget-0002')$$, 'call 2 of 6');
select lives_ok($$select hq.bulk_create_tasks(pg_temp.one('Budget 3'), 'key-budget-0003')$$, 'call 3 of 6');
select lives_ok($$select hq.bulk_create_tasks(pg_temp.one('Budget 4'), 'key-budget-0004')$$, 'call 4 of 6');
select lives_ok($$select hq.bulk_create_tasks(pg_temp.one('Budget 5'), 'key-budget-0005')$$, 'call 5 of 6');
select lives_ok($$select hq.bulk_create_tasks(pg_temp.one('Budget 6'), 'key-budget-0006')$$, 'the 6th call in the hour passes');
select throws_ok($$select hq.bulk_create_tasks(pg_temp.one('Budget 7'), 'key-budget-0007')$$, '54000', 'bulk limit reached: at most 6 bulk calls per hour; try again later', 'the 7th call in the hour is refused (54000)');
select is((select (hq.bulk_budget() ->> 'calls_remaining')::integer), 0, 'bulk_budget: no calls remaining');
select pg_temp.unbecome();
select is((select count(*) from hq.tasks where title = 'Budget 7') + (select count(*) from hq.idempotency_keys where key = 'key-budget-0007'), 0::bigint, 'the refused call wrote nothing');
create temp table zz_hint (h text) on commit drop;
grant select, insert on zz_hint to public;
select pg_temp.become('spm');
do $$ begin perform hq.bulk_create_tasks(pg_temp.one('Budget 7b'), 'key-budget-0008');
exception when others then declare v text; begin get stacked diagnostics v = pg_exception_hint; insert into zz_hint values (v); end; end $$;
select pg_temp.unbecome();
select is((select h from zz_hint), 'bulk_rate_limited', 'the refusal carries the hint bulk_rate_limited');
alter table hq.bulk_usage disable trigger append_only;
update hq.bulk_usage set at = now() - interval '61 minutes' where staff_id = pg_temp.fx('spm');
alter table hq.bulk_usage enable trigger append_only;
select pg_temp.become('spm');
select lives_ok($$select hq.bulk_create_tasks(pg_temp.one('Budget next hour'), 'key-budget-0009')$$, 'calls older than an hour no longer count (rolling hour)');
select throws_ok($$select hq.consume_bulk_budget(0, 0)$$, '22023', null, 'consume_bulk_budget refuses nothing to consume');
select throws_ok($$select hq.consume_bulk_budget(61, 1)$$, '22023', null, 'consume_bulk_budget refuses more than 60 calls');
select pg_temp.unbecome();

-- ------------------------------------------------------------ the bulk budget: items
update hq.settings set value = '60'::jsonb where key = 'bulk_calls_per_hour';
select pg_temp.become('bdm');
select lives_ok($$select hq.bulk_create_tasks(pg_temp.many('Items a', 50), 'key-items-0001')$$, 'items 1-50');
select lives_ok($$select hq.bulk_create_tasks(pg_temp.many('Items b', 50), 'key-items-0002')$$, 'items 51-100');
select lives_ok($$select hq.bulk_create_tasks(pg_temp.many('Items c', 50), 'key-items-0003')$$, 'items 101-150');
select lives_ok($$select hq.bulk_create_tasks(pg_temp.many('Items d', 50), 'key-items-0004')$$, 'items 151-200');
select lives_ok($$select hq.bulk_create_tasks(pg_temp.many('Items e', 50), 'key-items-0005')$$, 'items 201-250');
select lives_ok($$select hq.bulk_create_tasks(pg_temp.many('Items f', 50), 'key-items-0006')$$, 'items 251-300: exactly 300 items in the hour pass');
select throws_ok($$select hq.bulk_create_tasks(pg_temp.one('Items 301'), 'key-items-0007')$$, '54000', 'bulk limit reached: at most 300 tasks per hour through bulk calls (300 used); try again later or send fewer', 'the 301st item in the hour is refused');
select is(hq.bulk_budget() - 'calls_per_hour', '{"calls_used": 6, "items_used": 300, "items_per_hour": 300, "calls_remaining": 54, "items_remaining": 0}'::jsonb, 'bulk_budget reports the use');
select pg_temp.unbecome();
select is((select count(*) from hq.tasks where title like 'Items %' and source = 'bulk' and created_by = pg_temp.fx('bdm')), 300::bigint, '300 tasks were created, not 301');

-- ------------------------------------------------------------ bulk_update_tasks
insert into hq.tasks (title, assigned_to, created_by) values ('U1', pg_temp.fx('va'), pg_temp.fx('dir')) returning id \gset u1_
insert into hq.tasks (title, assigned_to, created_by) values ('U2', pg_temp.fx('va'), pg_temp.fx('va')) returning id \gset u2_
select pg_temp.become('va');
insert into zz_r select 'up', hq.bulk_update_tasks(jsonb_build_array(
  jsonb_build_object('id', :'u1_id', 'status', 'in_progress', 'due_date', (hq.today() + 3)::text, 'comment', 'Started on it'),
  jsonb_build_object('id', :'u2_id', 'complete', true),
  jsonb_build_object('id', :'priv_id', 'priority', 'high'),
  jsonb_build_object('id', :'u1_id', 'assignee', pg_temp.fx('pm')),
  jsonb_build_object('id', :'u2_id', 'assignee', pg_temp.fx('pm')),
  jsonb_build_object('id', :'u1_id', 'add_dependency', :'u2_id'),
  jsonb_build_object('id', 'not-a-uuid'),
  jsonb_build_object('id', :'u1_id', 'title', ''),
  jsonb_build_object('id', :'u1_id', 'priority', 'urgent', 'bogus', 1)),
  'key-update-0001');
select pg_temp.unbecome();
select is((pg_temp.r('up') ->> 'updated_count') || '|' || (pg_temp.r('up') ->> 'failed_count'), '4|5', 'bulk update: 4 updated, 5 failed');
select is((select e -> 'changed' from jsonb_array_elements(pg_temp.r('up') -> 'updated') e where (e ->> 'index')::integer = 0), '["status", "due_date", "comment"]'::jsonb, 'each updated entry lists what changed');
select is(pg_temp.ferr('up', 2), '["task not found"]'::jsonb, 'a task the caller cannot see: not found');
select is(pg_temp.ferr('up', 3), '["only the person who created this task, or someone who can see everyone''s tasks, can give it to someone else"]'::jsonb, 'the existing assignment rule applies');
select is(pg_temp.ferr('up', 6), '["the task id is not a valid id"]'::jsonb, 'a bad id is refused in plain words');
select is(pg_temp.ferr('up', 7), '["a task needs a title"]'::jsonb, 'a blank title is refused');
select is(pg_temp.ferr('up', 8), '["unknown field \"bogus\""]'::jsonb, 'an unknown field is refused');
select is((select status || '|' || due_date || '|' || priority || '|' || assigned_to from hq.tasks where id = :'u1_id'), 'in_progress|' || (hq.today() + 3) || '|normal|' || pg_temp.fx('va'), 'U1 changed as asked and nothing else');
select is((select status || '|' || assigned_to from hq.tasks where id = :'u2_id'), 'completed|' || pg_temp.fx('pm'), 'U2 completed and handed to Pat (va created it)');
select is((select depends_on_open from hq.task_dependencies where task_id = :'u1_id' and depends_on_task_id = :'u2_id'), false, 'U1 waits for U2, which is done (so U1 is not blocked)');
select is((select priority from hq.tasks where id = :'priv_id'), 'normal'::hq.task_priority, 'the private task is untouched');
select is((select body from hq.task_comments where task_id = :'u1_id'), 'Started on it', 'the comment was added');
select is((select count(*) from hq.task_activity where task_id = :'u1_id' and kind in ('status', 'dependency_added', 'comment')), 3::bigint, 'activity rows for the status change, the dependency and the comment');
select is((select count(*) from hq.audit_events where action = 'bulk_update' and actor_id = pg_temp.fx('va')), 1::bigint, 'one bulk_update audit event');
select pg_temp.become('va');
insert into zz_r select 'up2', hq.bulk_update_tasks(jsonb_build_array(
  jsonb_build_object('id', :'u1_id', 'priority', 'low'), jsonb_build_object('id', :'priv_id', 'priority', 'low')), 'key-update-0002', true);
insert into zz_r select 'up3', hq.bulk_update_tasks(jsonb_build_array(
  jsonb_build_object('id', :'u1_id', 'priority', 'low'), jsonb_build_object('id', :'priv_id', 'priority', 'low')), 'key-update-0002', true);
select pg_temp.unbecome();
select is((pg_temp.r('up2') ->> 'updated_count') || '|' || (pg_temp.r('up2') ->> 'rolled_back'), '0|true', 'an atomic bulk update with one failure changes nothing');
select is((select priority from hq.tasks where id = :'u1_id'), 'normal'::hq.task_priority, '... U1 keeps its priority');
select is((pg_temp.r('up3') ->> 'duplicate')::boolean, true, 'a bulk update replay is a duplicate');
select is(pg_temp.used('va'), '2/11', 'bulk updates use the budget too (items = entries)');

-- ------------------------------------------------------------ RLS on what bulk calls wrote
select pg_temp.become('jpm');
select is((select count(*) from hq.tasks where title like 'B-%') + (select count(*) from hq.task_dependencies d join hq.tasks t on t.id = d.task_id where t.title like 'Chain %'), 0::bigint,
  'a junior sees none of the bulk tasks of others, nor their dependencies');
select is((select count(*) from hq.idempotency_keys) + (select count(*) from hq.bulk_usage), 0::bigint, 'a junior sees no one else''s keys or usage');
select throws_ok($$insert into hq.idempotency_keys (staff_id, key, scope, request_hash, result) values (pg_temp.fx('jpm'), 'key-forged-9999', 'bulk_create_tasks', repeat('a', 64), '{}')$$, '42501', null, 'idempotency keys cannot be written directly');
select throws_ok($$insert into hq.bulk_usage (staff_id, calls, items) values (pg_temp.fx('jpm'), 0, 0)$$, '42501', null, 'bulk usage cannot be written directly');
select pg_temp.become('pm');
select is((select count(*) from hq.idempotency_keys where staff_id <> pg_temp.fx('pm')) + (select count(*) from hq.bulk_usage where staff_id <> pg_temp.fx('pm')), 0::bigint, 'a person reads only their own keys and usage');
select is((select count(*) from hq.idempotency_keys), 3::bigint, '... all of their own: three stored results (the expired key was purged when it was used again)');
select pg_temp.become('va');
select is((select count(*) from hq.tasks where title in ('B-A', 'B-D', 'B-E', 'B-K')), 0::bigint, 'a virtual assistant does not see Pat''s bulk tasks ...');
select is((select count(*) from hq.tasks where title = 'B-J'), 1::bigint, '... except the one assigned to them');
select pg_temp.unbecome();

select * from finish();
rollback;
