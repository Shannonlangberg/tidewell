-- Planted HQ: the command center (migrations 0148-0150). Planning items (capabilities, RLS, the
-- funding-only amount, status by kind, version guard, never deleted, audited), the new task columns
-- (existing rows untouched), set_task_waiting / resolve_task_waiting (the task-update rule, the waiting
-- guard that clears on leaving waiting, history, priority and due date untouched), update_project_task
-- with the new fields (a closed planning item refused, planning.read needed to link), launch gates and the
-- launch_project_id setting.
--
-- NOTE: never CALL a function a hint role lacks execute on (see hq_01). Every RPC here is granted to
-- authenticated; anon is refused at the schema.
begin;
\ir hq_fixture.inc
select pg_temp.seed_hq();
select plan(43);

create temp table zz_r (k text primary key, v jsonb) on commit drop;
grant select, insert on zz_r to public;
create function pg_temp.r(p_k text) returns jsonb language sql stable as $$ select v from zz_r where k = p_k $$;
create function pg_temp.id(p_k text) returns uuid language sql stable as $$ select coalesce(v ->> 'id', v ->> 'task_id', v ->> 'milestone_id', v ->> 'project_id')::uuid from zz_r where k = p_k $$;

-- ------------------------------------------------------------ structure
select has_table('hq', 'planning_items', 'hq.planning_items exists');
select enum_has_labels('hq', 'planning_kind', array['funding', 'dependency', 'context']);
select enum_has_labels('hq', 'planning_status', array['anticipated', 'confirmed', 'received', 'current', 'closed']);
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'hq.planning_items'::regclass), 'RLS is enabled and forced on planning_items');
select ok(has_table_privilege('authenticated', 'hq.planning_items', 'select') and not has_table_privilege('authenticated', 'hq.planning_items', 'insert,update,delete,truncate'), 'authenticated may only select planning_items');
select is((select string_agg(column_name || ':' || is_nullable, ',' order by column_name) from information_schema.columns
            where table_schema = 'hq' and table_name = 'tasks' and column_name in ('waiting_on', 'waiting_since', 'expected_response_date', 'next_follow_up_date', 'planned_for', 'planning_item_id')),
  'expected_response_date:YES,next_follow_up_date:YES,planned_for:YES,planning_item_id:YES,waiting_on:YES,waiting_since:YES', 'the new task columns are all optional: existing tasks keep their meaning');
select is((select column_default from information_schema.columns where table_schema = 'hq' and table_name = 'project_milestones' and column_name = 'launch_gate'), 'false', 'a milestone is not a launch requirement unless marked');
select is((select value from hq.settings where key = 'launch_project_id'), 'null'::jsonb, 'launch_project_id starts empty');
select is((select array_agg(role::text order by role::text) from hq.role_capabilities where capability = 'planning.read'), array['administrator', 'director'], 'planning.read: director and administrator');
select is((select array_agg(role::text) from hq.role_capabilities where capability = 'planning.write'), array['director'], 'planning.write: director only');

-- ------------------------------------------------------------ planning items
select pg_temp.become('pm');
select throws_ok($$select hq.save_planning_item(null, 'funding', 'Forged')$$, '42501', null, 'a property manager cannot record a planning item');
select is((select count(*) from hq.planning_items), 0::bigint, 'and cannot read any');
select pg_temp.become('adm');
select throws_ok($$select hq.save_planning_item(null, 'funding', 'Forged')$$, '42501', null, 'an administrator cannot record one either');
select pg_temp.become('dir');
insert into zz_r select 'fund', hq.save_planning_item(null, 'funding', 'Business funding', 'Anticipated round', 25000, 'within a month');
select is(pg_temp.r('fund') ->> 'status', 'anticipated', 'funding starts anticipated');
select is((pg_temp.r('fund') ->> 'amount_anticipated')::numeric, 25000::numeric, 'the anticipated amount is kept exactly as given');
select is(pg_temp.r('fund') ->> 'expected_by', null, 'no expected date is invented');
select throws_ok($$select hq.save_planning_item(null, 'context', 'Note', null, 10)$$, '23514', null, 'only funding has an amount');
select throws_ok($$select hq.save_planning_item(null, 'context', 'Note', p_status => 'anticipated')$$, '23514', null, 'a context note is current or closed');
insert into zz_r select 'ctx', hq.save_planning_item(null, 'context', 'HQ is nearly finished');
select is(pg_temp.r('ctx') ->> 'status', 'current', 'a context note starts current');
select throws_ok(format($$select hq.save_planning_item(%L, p_status => 'confirmed', p_version => 99)$$, pg_temp.id('fund')), '40001', null, 'an edit made on an older version is refused');
select is((hq.save_planning_item(pg_temp.id('fund'), p_title => 'Business funding')) ->> 'changed', 'false', 'saving the same values changes nothing');
select throws_ok(format($$delete from hq.planning_items where id = %L$$, pg_temp.id('fund')), '42501', null, 'planning items cannot be deleted through the API');
select pg_temp.become('adm');
select is((select count(*) from hq.planning_items where title in ('Business funding', 'HQ is nearly finished')), 2::bigint, 'an administrator reads the planning items');
select pg_temp.unbecome();
select ok(exists (select 1 from hq.audit_events where entity_type = 'planning_item' and entity_id = pg_temp.id('fund')), 'planning items are in the audit trail');

-- ------------------------------------------------------------ waiting
select pg_temp.become('dir');
insert into zz_r select 'train', hq.create_project_task('Enrol in training', p_priority => 'high', p_due_date => hq.today() + 20);
insert into zz_r select 'ailo', hq.create_project_task('Ailo demo follow-up');
select throws_ok(format($$select hq.set_task_waiting(%L)$$, pg_temp.id('train')), '22023', null, 'waiting needs to say on what');
insert into zz_r select 'w1', hq.set_task_waiting(pg_temp.id('train'), p_planning_item => pg_temp.id('fund'), p_note => 'Waiting on the funding');
select is((select status::text || ':' || planning_item_id::text from hq.tasks where id = pg_temp.id('train')), 'waiting:' || pg_temp.id('fund')::text, 'set_task_waiting: status waiting, linked to the funding');
select is((select priority::text || ':' || due_date::text from hq.tasks where id = pg_temp.id('train')), 'high:' || (hq.today() + 20)::text, '... priority and due date untouched');
select ok(exists (select 1 from hq.task_activity where task_id = pg_temp.id('train') and kind = 'waiting' and summary like 'Waiting on Business funding%'), '... and the history says what it waits on');
select ok(exists (select 1 from hq.task_comments where task_id = pg_temp.id('train') and body = 'Waiting on the funding'), '... and the note is a comment');
select hq.set_task_waiting(pg_temp.id('ailo'), 'Ailo to reply', p_expected => hq.today() + 3, p_follow_up => hq.today() + 2);
select pg_temp.become('pm');
select throws_ok(format($$select hq.set_task_waiting(%L, 'forged')$$, pg_temp.id('ailo')), 'P0002', null, 'a property manager cannot touch a task they cannot see');
select pg_temp.become('dir');
insert into zz_r select 'res', hq.resolve_task_waiting(pg_temp.id('ailo'), 'in_progress', 'Ailo called back');
select is((select status::text || ':' || coalesce(waiting_on, '-') || ':' || coalesce(expected_response_date::text, '-') from hq.tasks where id = pg_temp.id('ailo')), 'in_progress:-:-', 'resolve_task_waiting: in progress, the wait cleared');
select is((select next_follow_up_date from hq.tasks where id = pg_temp.id('ailo')), hq.today() + 2, '... the follow-up date is kept');
select is(pg_temp.r('res') ->> 'was_waiting_on', 'Ailo to reply', '... and it says what it was waiting on');
select throws_ok(format($$select hq.resolve_task_waiting(%L)$$, pg_temp.id('ailo')), '22023', null, 'a task that is not waiting is refused');
-- leaving waiting by any path (the board, the task form) clears the wait
update hq.tasks set status = 'to_do' where id = pg_temp.id('train');
select is((select coalesce(planning_item_id::text, '-') from hq.tasks where id = pg_temp.id('train')), '-', 'leaving waiting by a direct status change clears the planning link');
select ok(exists (select 1 from hq.task_activity where task_id = pg_temp.id('train') and kind = 'waiting' and summary like 'No longer waiting on Business funding%'), '... and the history says so');

-- ------------------------------------------------------------ update_project_task with the new fields
select is((hq.update_project_task(pg_temp.id('train'), jsonb_build_object('planned_for', (hq.today() + 5)::text))) -> 'changed_fields', '["planned_for"]'::jsonb, 'planned_for changes alone');
select is((select due_date from hq.tasks where id = pg_temp.id('train')), hq.today() + 20, '... the due date stays');
select hq.save_planning_item(pg_temp.id('fund'), p_status => 'received');
select throws_ok(format($$select hq.update_project_task(%L, jsonb_build_object('planning_item', %L))$$, pg_temp.id('train'), pg_temp.id('fund')), 'P0002', null, 'nothing can wait on funding that has been received');

-- ------------------------------------------------------------ launch
insert into zz_r select 'prj', hq.create_project('Business launch [test]');
insert into zz_r select 'm1', hq.create_milestone(pg_temp.id('prj'), 'Registered');
select is((hq.set_milestone_launch_gate(pg_temp.id('m1'), true)) ->> 'launch_gate', 'true', 'a milestone can be marked required to open');
select ok(exists (select 1 from hq.project_activity where project_id = pg_temp.id('prj') and kind = 'milestone_launch_gate'), '... recorded on the project');
update hq.settings set value = to_jsonb(pg_temp.id('prj')::text) where key = 'launch_project_id';
select is((select value #>> '{}' from hq.settings where key = 'launch_project_id'), pg_temp.id('prj')::text, 'a director sets the launch project');
select throws_ok($$update hq.settings set value = '"00000000-0000-0000-0000-000000000000"'::jsonb where key = 'launch_project_id'$$, '22023', null, 'the launch project must be a live project');

select * from finish();
rollback;
