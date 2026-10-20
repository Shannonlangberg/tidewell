-- Planted HQ: Projects and richer tasks (migrations 0142-0145), part A. Part B (hq_17b_bulk.sql) covers
-- bulk_create_tasks / bulk_update_tasks and the bulk budget.
-- Structure and security, the capability matrix, forged callers, projects (create, update with
-- optimistic concurrency, status, links, documents), milestones (create, complete with open tasks and
-- force, reopen, reorder), existing tasks untouched and the direct task path, subtask depth / project /
-- self rules, dependencies (self, direct and indirect cycles, the deferred cycle check), blocked
-- computation (also for a reader who cannot see the blocking task), health rules on boundary days,
-- progress (top-level only, cancelled excluded, visibility), my_focus ordering and reasons,
-- overdue_tasks, checklists, comments (edit window), the activity trigger and append-only histories,
-- RLS, archive / restore, and the bulk settings guard.
--
-- NOTE: never CALL a function a hint role lacks execute on (see hq_01). Every RPC here is granted to
-- authenticated; anon is refused at the schema.
begin;
\ir hq_fixture.inc
select pg_temp.seed_hq();
select plan(193);

-- anything already in this database is put out of the way for the transaction
update hq.projects set deleted_at = now() where deleted_at is null;

create temp table zz_r (k text primary key, v jsonb) on commit drop;
grant select, insert on zz_r to public;
create function pg_temp.r(p_k text) returns jsonb language sql stable as $$ select v from zz_r where k = p_k $$;
create function pg_temp.pid(p_k text) returns uuid language sql stable as $$ select (v ->> 'project_id')::uuid from zz_r where k = p_k $$;
create function pg_temp.tid(p_k text) returns uuid language sql stable as $$ select (v ->> 'task_id')::uuid from zz_r where k = p_k $$;
create function pg_temp.mid(p_k text) returns uuid language sql stable as $$ select (v ->> 'milestone_id')::uuid from zz_r where k = p_k $$;
-- a task made by the table owner (a system write): title, assignee, creator, project, due offset from today, status, priority, parent
create function pg_temp.mk_task(p_title text, p_assignee text, p_creator text, p_project uuid default null, p_due integer default null,
                                p_status hq.task_status default 'to_do', p_priority hq.task_priority default 'normal', p_parent uuid default null) returns uuid
language sql as $$
  insert into hq.tasks (title, assigned_to, created_by, project_id, due_date, status, priority, parent_task_id)
  values (p_title, pg_temp.fx(p_assignee), pg_temp.fx(p_creator), p_project, case when p_due is null then null else hq.today() + p_due end, p_status, p_priority, p_parent)
  returning id
$$;
create function pg_temp.health(p_id uuid) returns text language sql stable as $$ select health from hq.project_overview where id = p_id $$;

-- ------------------------------------------------------------ structure and security
select has_table('hq', t, 'hq.' || t || ' exists')
from unnest(array['projects', 'project_milestones', 'project_links', 'project_documents', 'project_activity', 'task_dependencies',
                  'task_checklist_items', 'task_comments', 'task_activity', 'idempotency_keys', 'bulk_usage']) t;
select enum_has_labels('hq', 'project_status', array['planning', 'active', 'on_hold', 'completed', 'cancelled']);
select enum_has_labels('hq', 'milestone_status', array['open', 'done']);
select is((select count(*) from pg_class where relnamespace = 'hq'::regnamespace and relname in ('projects', 'project_milestones', 'project_links', 'project_documents', 'project_activity', 'task_dependencies',
            'task_checklist_items', 'task_comments', 'task_activity', 'idempotency_keys', 'bulk_usage') and relkind = 'r' and relrowsecurity and relforcerowsecurity),
  11::bigint, 'RLS is enabled and forced on the eleven new tables');
select is((select count(*) from pg_policies where schemaname = 'hq' and tablename in ('projects', 'project_milestones', 'project_links', 'project_documents', 'project_activity', 'task_dependencies',
            'task_checklist_items', 'task_comments', 'task_activity', 'idempotency_keys', 'bulk_usage') and cmd = 'SELECT'), 11::bigint, 'one select policy on each new table');
select is((select count(*) from pg_policies where schemaname = 'hq' and tablename in ('projects', 'project_milestones', 'project_links', 'project_documents', 'project_activity', 'task_dependencies',
            'task_checklist_items', 'task_comments', 'task_activity', 'idempotency_keys', 'bulk_usage') and cmd <> 'SELECT'), 0::bigint, '... and no write policy');
select is((select count(*) from pg_policies where schemaname = 'hq' and tablename like 'project%' and qual like '%has_capability(''projects.read''%'), 5::bigint, 'every project policy needs projects.read');
select is((select count(*) from unnest(array['projects', 'project_milestones', 'project_links', 'project_documents', 'project_activity', 'task_dependencies',
            'task_checklist_items', 'task_comments', 'task_activity', 'idempotency_keys', 'bulk_usage']) t
            where has_table_privilege('authenticated', 'hq.' || t, 'select') and not has_table_privilege('authenticated', 'hq.' || t, 'insert,update,delete,truncate')),
  11::bigint, 'authenticated can only select the new tables (written by RPC)');
select is((select count(*) from unnest(array['projects', 'project_milestones', 'project_links', 'project_documents', 'project_activity', 'task_dependencies',
            'task_checklist_items', 'task_comments', 'task_activity', 'idempotency_keys', 'bulk_usage']) t
            where has_table_privilege('service_role', 'hq.' || t, 'insert,update,delete,truncate')), 0::bigint, 'service_role cannot write them');
select ok((select bool_and(reloptions @> array['security_invoker=true']) from pg_class where oid in ('hq.project_overview'::regclass, 'hq.task_overview'::regclass, 'hq.project_timeline'::regclass)),
  'the three views are security_invoker');
select ok(exists (select 1 from pg_constraint where conname = 'tasks_source_known' and pg_get_constraintdef(oid) like '%''project''%' and pg_get_constraintdef(oid) like '%''bulk''%'
                  and pg_get_constraintdef(oid) like '%''meeting''%' and pg_get_constraintdef(oid) like '%''website_enquiry''%'), 'tasks.source keeps every old source and gains project and bulk');
select is((select string_agg(column_name || ':' || is_nullable || ':' || coalesce(column_default, '-'), ',' order by column_name) from information_schema.columns
            where table_schema = 'hq' and table_name = 'tasks' and column_name in ('project_id', 'milestone_id', 'parent_task_id', 'sort_order', 'blocked_reason')),
  'blocked_reason:YES:-,milestone_id:YES:-,parent_task_id:YES:-,project_id:YES:-,sort_order:NO:0', 'the new task columns are nullable (sort_order defaults to 0): existing rows keep their meaning');
select ok((select confdeltype = 'c' from pg_constraint where conname = 'task_activity_task_id_fkey'), 'task history goes only with its task (cascade on a hard delete by the table owner)');

create temp table zz_rpcs (sig regprocedure primary key) on commit drop;
insert into zz_rpcs values
  ('hq.my_focus(integer)'), ('hq.overdue_tasks(text, uuid)'), ('hq.bulk_budget()'), ('hq.consume_bulk_budget(integer, integer)'),
  ('hq.bulk_create_tasks(jsonb, text, uuid, boolean)'), ('hq.bulk_update_tasks(jsonb, text, boolean)'),
  ('hq.create_project_task(text, uuid, uuid, uuid, uuid, date, hq.task_priority, text, hq.task_status, uuid[], text[], integer, text)'),
  ('hq.update_project_task(uuid, jsonb)'), ('hq.complete_task(uuid, text)'), ('hq.add_task_dependency(uuid, uuid)'), ('hq.remove_task_dependency(uuid, uuid)'),
  ('hq.set_task_checklist(uuid, jsonb)'), ('hq.add_task_comment(uuid, text)'), ('hq.edit_task_comment(bigint, text)'),
  ('hq.create_project(text, text, uuid, hq.project_status, hq.task_priority, date, date, text)'),
  ('hq.update_project(uuid, integer, text, text, uuid, hq.project_status, hq.task_priority, date, date, text, text[], text)'),
  ('hq.set_project_status(uuid, hq.project_status, text)'), ('hq.add_project_link(uuid, text, uuid)'), ('hq.remove_project_link(uuid, text, uuid)'),
  ('hq.add_project_document(uuid, text, text)'), ('hq.remove_project_document(uuid, bigint)'),
  ('hq.create_milestone(uuid, text, text, date, integer)'), ('hq.update_milestone(uuid, text, text, date, text[])'),
  ('hq.complete_milestone(uuid, boolean, text)'), ('hq.reopen_milestone(uuid)'), ('hq.reorder_milestones(uuid, uuid[])');
select is((select count(*) from zz_rpcs where has_function_privilege('authenticated', sig, 'execute')), 26::bigint, 'authenticated can execute the 26 project RPCs');
select is((select count(*) from zz_rpcs where has_function_privilege('anon', sig, 'execute') or has_function_privilege('service_role', sig, 'execute')), 0::bigint, 'anon and service_role can execute none of them');
select is((select count(*) from zz_rpcs z join pg_proc p on p.oid = z.sig where p.prosecdef and p.proconfig::text like '%search_path=pg_catalog, public, extensions%'), 26::bigint, 'all 26 are security definer with a pinned search_path');
select is((select count(*) from pg_proc p where p.pronamespace = 'hq_private'::regnamespace
            and p.proname in ('project_guard', 'milestone_guard', 'task_structure_guard', 'task_activity_log', 'task_create_core', 'task_update_core', 'task_dependency_add',
                              'task_entry_errors', 'idempotency_check', 'bulk_used', 'bulk_limits', 'task_lock', 'project_lock', 'task_history_guard')
            and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))), 0::bigint, 'the project helpers are executable by no API role');

-- ------------------------------------------------------------ the capability matrix (an assumption for the owner)
select is((select array_agg(role::text order by role::text) from hq.role_capabilities where capability = 'projects.read'),
  array['administrator', 'business_development_manager', 'director', 'property_manager', 'read_only', 'senior_property_manager', 'virtual_assistant'], 'projects.read: everyone but the junior property manager');
select is((select array_agg(role::text order by role::text) from hq.role_capabilities where capability = 'projects.write'),
  array['administrator', 'business_development_manager', 'director', 'property_manager', 'senior_property_manager', 'virtual_assistant'], 'projects.write: the same without read_only');
select is(jsonb_build_array((select value from hq.settings where key = 'bulk_calls_per_hour'), (select value from hq.settings where key = 'bulk_items_per_hour')), '[6, 300]'::jsonb, 'bulk budget defaults: 6 calls and 300 items an hour');

-- ------------------------------------------------------------ forged callers
select pg_temp.become_anon();
select throws_ok($$select hq.create_project('x')$$, '42501', null, 'anon cannot create a project');
select throws_ok('select 1 from hq.projects', '42501', null, 'anon is denied the projects');
select throws_ok('select 1 from hq.project_overview', '42501', null, 'anon is denied the overview');
select throws_ok('select * from hq.my_focus()', '42501', null, 'anon cannot call my_focus');
select pg_temp.unbecome();
select pg_temp.become('outsider');
select throws_ok($$select hq.create_project('Outsider [test]')$$, '42501', null, 'a signed-in person who is not staff cannot create a project');
select throws_ok('select * from hq.my_focus()', '42501', null, '... nor read my_focus');
select is((select count(*) from hq.projects) + (select count(*) from hq.task_overview) + (select count(*) from hq.project_overview), 0::bigint, '... and reads nothing');
select pg_temp.become('dir', 'aal1');
select throws_ok($$select hq.create_project('aal1 [test]')$$, '42501', null, 'a director without MFA (aal1) cannot create a project');
select pg_temp.become('ro');
select throws_ok($$select hq.create_project('RO [test]')$$, '42501', null, 'read_only cannot create a project');
select pg_temp.become('jpm');
select throws_ok($$select hq.create_project('Junior [test]')$$, '42501', null, 'a junior property manager cannot create a project');
select pg_temp.unbecome();
select is((select count(*) from hq.projects where name like '%[test]%'), 0::bigint, 'no forged call left a project behind');

-- ------------------------------------------------------------ projects
select pg_temp.become('dir');
insert into zz_r select 'p1', hq.create_project('Launch Planted [test]', 'Get Planted Property open for business.', null, 'active', 'urgent', hq.today() - 10, hq.today() + 60, E'## Plan\n- Licence\n- Website');
select pg_temp.unbecome();
select ok((pg_temp.r('p1') ->> 'ref') ~ '^PRJ-\d{4,}$', 'create_project returns a PRJ-0001 style ref');
select is((select owner_id || '|' || created_by || '|' || status || '|' || priority || '|' || version from hq.projects where id = pg_temp.pid('p1')),
  pg_temp.fx('dir') || '|' || pg_temp.fx('dir') || '|active|urgent|1', 'owner defaults to the creator; status, priority, version 1');
select is((select count(*) from hq.audit_events where entity_type = 'project' and entity_id = pg_temp.pid('p1') and action = 'create'), 1::bigint, 'audit: one create project row');
select is((select kind from hq.project_activity where project_id = pg_temp.pid('p1')), 'created', 'project activity: created');
select pg_temp.become('dir');
select throws_ok($$select hq.create_project('  launch planted [TEST] ')$$, '23505', 'a project called "launch planted [TEST]" already exists', 'a name is unique among live projects, ignoring case and spaces');
select throws_ok($$select hq.create_project('Dates [test]', p_start => hq.today(), p_target => hq.today() - 1)$$, '22023', 'the target date cannot be before the start date', 'target before start is refused');
select throws_ok(format($$select hq.create_project('Owner [test]', p_owner => %L)$$, pg_temp.fx('outsider')), '22023', 'the project owner must be an active member of staff', 'the owner must be active staff');
select throws_ok(format($$select hq.update_project(%L, 7, p_name => 'Stale [test]')$$, pg_temp.pid('p1')), '23514', null, 'an edit against an older version is refused (project_stale)');
insert into zz_r select 'p1u', hq.update_project(pg_temp.pid('p1'), 1, p_description => 'Open the doors.', p_owner => pg_temp.fx('pm'), p_note => 'Pat runs it');
select is(pg_temp.r('p1u') -> 'changed_fields', '["description", "owner"]'::jsonb, 'update_project reports exactly what changed');
insert into zz_r select 'p1n', hq.update_project(pg_temp.pid('p1'), 2, p_description => 'Open the doors.');
select is((pg_temp.r('p1n') ->> 'changed')::boolean, false, 'nothing to change: changed false');
insert into zz_r select 'p1s', hq.set_project_status(pg_temp.pid('p1'), 'on_hold', 'Waiting on the licence');
select pg_temp.unbecome();
select is((select version || '|' || status from hq.projects where id = pg_temp.pid('p1')), '3|on_hold', 'status change: version 3, on hold');
select ok((select summary like '%Waiting on the licence%' from hq.audit_events where entity_type = 'project' and entity_id = pg_temp.pid('p1') and action = 'update' order by at desc, id desc limit 1), 'the status note is in the audit row');
select is((select string_agg(kind, ',' order by id) from hq.project_activity where project_id = pg_temp.pid('p1')), 'created,updated,status', 'project activity: created, updated, status');
update hq.projects set status = 'completed' where id = pg_temp.pid('p1');
select ok((select completed_at is not null from hq.projects where id = pg_temp.pid('p1')), 'completed_at follows status completed');
update hq.projects set status = 'active' where id = pg_temp.pid('p1');
select ok((select completed_at is null from hq.projects where id = pg_temp.pid('p1')), '... and clears when it leaves');
select throws_ok(format($$update hq.projects set version = 1 where id = %L$$, pg_temp.pid('p1')), '42501', null, 'a project''s version never goes back');
select throws_ok(format($$delete from hq.projects where id = %L$$, pg_temp.pid('p1')), '42501', null, 'a project is never deleted, even by the table owner');

-- links and documents
select pg_temp.become('pm');
insert into zz_r select 'l1', hq.add_project_link(pg_temp.pid('p1'), 'contact', pg_temp.fx('alice'));
insert into zz_r select 'l2', hq.add_project_link(pg_temp.pid('p1'), 'contact', pg_temp.fx('alice'));
insert into zz_r select 'l3', hq.add_project_link(pg_temp.pid('p1'), 'organisation', pg_temp.fx('alpha'));
select throws_ok(format($$select hq.add_project_link(%L, 'decision', %L)$$, pg_temp.pid('p1'), pg_temp.fx('alpha')), '22023', null, 'a link kind outside contact, organisation, contractor, opportunity is refused');
select throws_ok(format($$select hq.add_project_link(%L, 'contact', gen_random_uuid())$$, pg_temp.pid('p1')), 'P0002', 'linked contact not found', 'a record that does not exist is not found');
select throws_ok(format($$select hq.add_project_document(%L, 'Plan', 'http://example.com/plan')$$, pg_temp.pid('p1')), '22023', null, 'a document link must be https');
insert into zz_r select 'd1', hq.add_project_document(pg_temp.pid('p1'), 'Business plan', 'https://docs.example.com/plan');
select pg_temp.unbecome();
select is((pg_temp.r('l1') ->> 'changed') || (pg_temp.r('l2') ->> 'changed') || (pg_temp.r('l1') ->> 'label'), 'truefalseAlice Anders', 'a link is added once (a repeat is changed false)');
select is((select count(*) from hq.project_links where project_id = pg_temp.pid('p1')), 2::bigint, 'two links: the contact and the organisation');
select throws_ok(format($$insert into hq.project_links (project_id, contact_id, organisation_id) values (%L, %L, %L)$$, pg_temp.pid('p1'), pg_temp.fx('bob'), pg_temp.fx('beta')), '23514', null, 'a link is exactly one record');
select pg_temp.become('pm');
insert into zz_r select 'l4', hq.remove_project_link(pg_temp.pid('p1'), 'organisation', pg_temp.fx('alpha'));
insert into zz_r select 'd2', hq.remove_project_document(pg_temp.pid('p1'), (pg_temp.r('d1') ->> 'document_id')::bigint);
select pg_temp.unbecome();
select is((pg_temp.r('l4') ->> 'changed') || (pg_temp.r('d2') ->> 'changed') || (select count(*) from hq.project_links where project_id = pg_temp.pid('p1'))::text || (select count(*) from hq.project_documents where project_id = pg_temp.pid('p1'))::text,
  'truetrue10', 'a link and a document link are removed');
select pg_temp.become('jpm');
select throws_ok(format($$select hq.add_project_link(%L, 'contact', %L)$$, pg_temp.pid('p1'), pg_temp.fx('alice')), '42501', null, 'a junior cannot link records to a project');
select is((select count(*) from hq.projects) + (select count(*) from hq.project_overview) + (select count(*) from hq.project_milestones), 0::bigint, 'a junior (no projects.read) sees no projects');
select pg_temp.become('ro');
select is((select count(*) from hq.projects where id = pg_temp.pid('p1')) + (select count(*) from hq.project_links where project_id = pg_temp.pid('p1')), 2::bigint, 'read_only sees the project and its link');
select pg_temp.unbecome();

-- milestones
select pg_temp.become('pm');
insert into zz_r select 'm1', hq.create_milestone(pg_temp.pid('p1'), 'Licensing', 'Get the licence', hq.today() + 10);
insert into zz_r select 'm2', hq.create_milestone(pg_temp.pid('p1'), 'Website', null, hq.today() + 20);
insert into zz_r select 'm3', hq.create_milestone(pg_temp.pid('p1'), 'Launch day');
select throws_ok(format($$select hq.create_milestone(%L, ' licensing ')$$, pg_temp.pid('p1')), '23505', null, 'a milestone name is unique in its project (ignoring case)');
select pg_temp.unbecome();
select is((select string_agg(name || ':' || sort_order, ',' order by sort_order) from hq.project_milestones where project_id = pg_temp.pid('p1')), 'Licensing:0,Website:1,Launch day:2', 'milestones are ordered as they were added');
select pg_temp.become('pm');
select throws_ok(format($$select hq.reorder_milestones(%L, array[%L]::uuid[])$$, pg_temp.pid('p1'), pg_temp.mid('m2')), '22023', null, 'a reorder must list every milestone once');
insert into zz_r select 'mo', hq.reorder_milestones(pg_temp.pid('p1'), array[pg_temp.mid('m2'), pg_temp.mid('m1'), pg_temp.mid('m3')]);
insert into zz_r select 'mu', hq.update_milestone(pg_temp.mid('m3'), p_due => hq.today() + 30);
select pg_temp.unbecome();
select is((select string_agg(name, ',' order by sort_order) from hq.project_milestones where project_id = pg_temp.pid('p1')), 'Website,Licensing,Launch day', 'reorder_milestones sets the new order');
select is((select due_date from hq.project_milestones where id = pg_temp.mid('m3')), hq.today() + 30, 'update_milestone sets the due date');

-- ------------------------------------------------------------ existing tasks and the direct task path keep working
select pg_temp.become('pm');
select lives_ok($$insert into hq.tasks (title, assigned_to, related_contact_id) values ('Legacy task [test]', pg_temp.fx('pm'), pg_temp.fx('alice'))$$, 'the existing direct task insert still works');
select lives_ok($$update hq.tasks set status = 'in_progress', due_date = hq.today() + 2 where title = 'Legacy task [test]'$$, 'the existing direct task update still works');
select pg_temp.unbecome();
select is((select coalesce(project_id::text, '-') || '|' || coalesce(milestone_id::text, '-') || '|' || coalesce(parent_task_id::text, '-') || '|' || sort_order || '|' || source || '|' || related_contact_id
           from hq.tasks where title = 'Legacy task [test]'), '-|-|-|0|manual|' || pg_temp.fx('alice'), 'a task made the old way has no project, milestone or parent, sort 0, source manual, its link kept');
select is((select string_agg(kind || ':' || summary, ' / ' order by id) from hq.task_activity where task_id = (select id from hq.tasks where title = 'Legacy task [test]')),
  'created:Created / status:Status to do to in progress, due date ' || to_char(hq.today() + 2, 'YYYY-MM-DD'), 'the activity trigger records direct writes too (created; status and due date)');
select pg_temp.become('pm');
select lives_ok(format($$insert into hq.tasks (title, assigned_to, project_id) values ('Direct project task [test]', pg_temp.fx('pm'), %L)$$, pg_temp.pid('p1')), 'a projects.write holder may put a task in a project directly');
select pg_temp.become('jpm');
select throws_ok(format($$insert into hq.tasks (title, assigned_to, project_id) values ('Junior project task [test]', pg_temp.fx('jpm'), %L)$$, pg_temp.pid('p1')), '42501', 'putting a task in a project needs projects.write', 'a junior cannot put a task in a project directly');
select lives_ok($$insert into hq.tasks (title, assigned_to) values ('Junior own task [test]', pg_temp.fx('jpm'))$$, 'a junior still creates ordinary tasks');
select pg_temp.unbecome();

-- ------------------------------------------------------------ project tasks, subtasks
select pg_temp.become('pm');
insert into zz_r select 't1', hq.create_project_task('Enrol in the licence course [test]', pg_temp.pid('p1'), pg_temp.mid('m1'), p_priority => 'high', p_due_date => hq.today() + 5,
  p_checklist => array['Find the course', 'Pay the fee']);
insert into zz_r select 's1', hq.create_project_task('Book the exam [test]', p_parent => pg_temp.tid('t1'));
insert into zz_r select 't2', hq.create_project_task('Lodge the licence application [test]', pg_temp.pid('p1'), pg_temp.mid('m1'), p_depends_on => array[pg_temp.tid('t1')]);
insert into zz_r select 'p2', hq.create_project('Second project [test]');
insert into zz_r select 'm9', hq.create_milestone(pg_temp.pid('p2'), 'Other milestone');
select pg_temp.unbecome();
select is((select source || '|' || project_id || '|' || milestone_id || '|' || created_by from hq.tasks where id = pg_temp.tid('t1')),
  'project|' || pg_temp.pid('p1') || '|' || pg_temp.mid('m1') || '|' || pg_temp.fx('pm'), 'create_project_task: source project, in the project and milestone, created by the caller');
select is((select project_id from hq.tasks where id = pg_temp.tid('s1')), pg_temp.pid('p1'), 'a subtask takes its parent''s project');
select is((select count(*) from hq.task_checklist_items where task_id = pg_temp.tid('t1')), 2::bigint, 'the checklist was created with the task');
select pg_temp.become('pm');
select throws_ok(format($$select hq.create_project_task('Deep [test]', p_parent => %L)$$, pg_temp.tid('s1')), '22023', 'subtasks go one level deep: that task is already a subtask', 'a subtask of a subtask is refused');
select throws_ok(format($$select hq.update_project_task(%L, jsonb_build_object('parent', %L))$$, pg_temp.tid('t1'), pg_temp.tid('t2')), '22023', 'subtasks go one level deep: this task has subtasks of its own', 'a task with subtasks cannot become a subtask');
select throws_ok(format($$select hq.update_project_task(%L, jsonb_build_object('parent', %L))$$, pg_temp.tid('t2'), pg_temp.tid('t2')), '22023', null, 'a task cannot be its own parent');
select throws_ok(format($$select hq.create_project_task('Wrong project [test]', %L, p_parent => %L)$$, pg_temp.pid('p2'), pg_temp.tid('t1')), '22023', 'a subtask must be in the same project as its parent', 'a subtask in another project than its parent is refused');
select throws_ok(format($$select hq.create_project_task('Wrong milestone [test]', %L, %L)$$, pg_temp.pid('p1'), pg_temp.mid('m9')), 'P0002', null, 'a milestone of another project is refused');
select throws_ok(format($$select hq.update_project_task(%L, jsonb_build_object('project', %L))$$, pg_temp.tid('t1'), pg_temp.pid('p2')), '22023', null, 'a parent cannot move to another project and leave its subtasks behind');
select pg_temp.unbecome();
select throws_ok(format($$update hq.tasks set milestone_id = %L where id = %L$$, pg_temp.mid('m9'), pg_temp.tid('t2')), '22023', 'that milestone belongs to another project', 'the milestone rule holds for every writer, even the table owner');
select throws_ok(format($$update hq.tasks set parent_task_id = %L where id = %L$$, pg_temp.tid('s1'), pg_temp.tid('t2')), '22023', null, 'the depth rule holds for every writer');

-- ------------------------------------------------------------ dependencies and blocked
select is((select is_blocked::text || '|' || dependency_count || '|' || open_dependency_count from hq.task_overview where id = pg_temp.tid('t2')), 'true|1|1', 't2 waits for t1 and is blocked');
select is((select blocking_count from hq.task_overview where id = pg_temp.tid('t1')), 1::bigint, 't1 blocks one task');
select pg_temp.become('pm');
select throws_ok(format($$select hq.add_task_dependency(%L, %L)$$, pg_temp.tid('t1'), pg_temp.tid('t1')), '22023', 'a task cannot depend on itself', 'no self-dependency');
select throws_ok(format($$select hq.add_task_dependency(%L, %L)$$, pg_temp.tid('t1'), pg_temp.tid('t2')), '23514', null, 'a direct cycle is refused');
insert into zz_r select 't3', hq.create_project_task('Open the bank account [test]', pg_temp.pid('p1'), p_depends_on => array[pg_temp.tid('t2')]);
select throws_ok(format($$select hq.add_task_dependency(%L, %L)$$, pg_temp.tid('t1'), pg_temp.tid('t3')), '23514', null, 'an indirect cycle (t1 -> t3 -> t2 -> t1) is refused');
insert into zz_r select 'dep1', hq.add_task_dependency(pg_temp.tid('t3'), pg_temp.tid('t2'));
select throws_ok(format($$insert into hq.task_dependencies (task_id, depends_on_task_id) values (%L, %L)$$, pg_temp.tid('t1'), pg_temp.tid('t3')), '42501', null, 'a dependency cannot be written directly');
select pg_temp.unbecome();
select is((pg_temp.r('dep1') ->> 'changed')::boolean, false, 'a repeated dependency is changed false');
set constraints all immediate;
select throws_ok(format($$insert into hq.task_dependencies (task_id, depends_on_task_id) values (%L, %L)$$, pg_temp.tid('t1'), pg_temp.tid('t3')), '23514', null, 'the cycle constraint trigger refuses a cycle written by the table owner');
set constraints all deferred;
select pg_temp.become('pm');
insert into zz_r select 'c1', hq.complete_task(pg_temp.tid('t1'), 'Enrolled today');
select pg_temp.unbecome();
select is((select is_blocked from hq.task_overview where id = pg_temp.tid('t2')), false, 'completing t1 unblocks t2');
select is((select is_blocked from hq.task_overview where id = pg_temp.tid('t3')), true, '... but t3 still waits for t2');
select ok((select summary = 'Completion note: Enrolled today' from hq.task_activity where task_id = pg_temp.tid('t1') and kind = 'note'), 'the completion note is in the activity');
update hq.tasks set status = 'to_do' where id = pg_temp.tid('t1');
select is((select is_blocked from hq.task_overview where id = pg_temp.tid('t2')), true, 'reopening t1 blocks t2 again');
update hq.tasks set status = 'cancelled' where id = pg_temp.tid('t1');
select is((select is_blocked from hq.task_overview where id = pg_temp.tid('t2')), false, 'a cancelled dependency does not block');
update hq.tasks set status = 'to_do' where id = pg_temp.tid('t1');
-- blocked is right for a reader who cannot see the blocking task
select pg_temp.mk_task('Director private [test]', 'dir', 'dir') as x \gset priv_
select pg_temp.mk_task('Junior waits [test]', 'jpm', 'jpm') as x \gset jw_
insert into hq.task_dependencies (task_id, depends_on_task_id) values (:'jw_x', :'priv_x');
select pg_temp.become('jpm');
select is((select is_blocked::text || '|' || open_dependency_count from hq.task_overview where id = :'jw_x'), 'true|1', 'a junior sees their task is blocked by a task they cannot see');
select is((select count(*) from hq.tasks where id = :'priv_x'), 0::bigint, '... without seeing the blocking task');
select pg_temp.become('pm');
insert into zz_r select 'rd', hq.remove_task_dependency(pg_temp.tid('t2'), pg_temp.tid('t1'));
select pg_temp.unbecome();
select is((pg_temp.r('rd') ->> 'changed') || '|' || (pg_temp.r('rd') ->> 'blocked'), 'true|false', 'remove_task_dependency: removed, no longer blocked');
select ok((select count(*) = 1 from hq.task_activity where task_id = pg_temp.tid('t2') and kind = 'dependency_removed'), 'the removal is in the activity');
select pg_temp.become('pm');
select lives_ok(format($$select hq.add_task_dependency(%L, %L)$$, pg_temp.tid('t2'), pg_temp.tid('t1')), 'the dependency can be added back');
select pg_temp.become('jpm');
select throws_ok(format($$select hq.add_task_dependency(%L, %L)$$, pg_temp.tid('t2'), pg_temp.tid('t1')), 'P0002', 'task not found', 'a task the caller cannot update is not found');
select throws_ok(format($$select hq.add_task_dependency(%L, %L)$$, :'jw_x', pg_temp.tid('t1')), 'P0002', 'the task it depends on was not found', 'a dependency on a task the caller cannot see is not found');
select pg_temp.unbecome();

-- ------------------------------------------------------------ health rules on boundary days
select pg_temp.become('dir');
insert into zz_r select 'h', hq.create_project('Health [test]', p_status => 'active', p_target => hq.today() + 40);
select pg_temp.unbecome();
select is(pg_temp.health(pg_temp.pid('h')), 'on_track', 'no tasks, far target: on_track');
select pg_temp.mk_task('H overdue [test]', 'pm', 'dir', pg_temp.pid('h'), -7) as x \gset ho_
select is(pg_temp.health(pg_temp.pid('h')), 'at_risk', 'a task exactly 7 days overdue: at_risk');
select is((select health_reasons from hq.project_overview where id = pg_temp.pid('h')), array['1 task is overdue'], '... with the reason');
update hq.tasks set due_date = hq.today() - 8 where id = :'ho_x';
select is(pg_temp.health(pg_temp.pid('h')), 'off_track', 'a task 8 days overdue: off_track');
select is((select health_reasons from hq.project_overview where id = pg_temp.pid('h')), array['A task is 8 days overdue'], '... with the reason');
select is((select max_overdue_days || '|' || overdue_count from hq.project_overview where id = pg_temp.pid('h')), '8|1', 'max_overdue_days and overdue_count');
update hq.tasks set status = 'cancelled' where id = :'ho_x';
select is(pg_temp.health(pg_temp.pid('h')), 'on_track', 'a cancelled overdue task does not count');
update hq.tasks set due_date = hq.today(), status = 'to_do' where id = :'ho_x';
select is(pg_temp.health(pg_temp.pid('h')), 'on_track', 'due today is not overdue');
select pg_temp.become('dir');
insert into zz_r select 'hm', hq.create_milestone(pg_temp.pid('h'), 'Due today', null, hq.today());
select pg_temp.unbecome();
select is(pg_temp.health(pg_temp.pid('h')), 'on_track', 'an open milestone due today is not overdue');
update hq.project_milestones set due_date = hq.today() - 1 where id = pg_temp.mid('hm');
select is(pg_temp.health(pg_temp.pid('h')), 'off_track', 'an open milestone due yesterday: off_track');
update hq.project_milestones set status = 'done' where id = pg_temp.mid('hm');
select is(pg_temp.health(pg_temp.pid('h')), 'on_track', 'a done milestone in the past does not count');
-- target within 14 days and progress below 60%: 2 of 5 top-level done (40%), then 3 of 5 (60%)
update hq.tasks set status = 'completed' where id = :'ho_x';
select pg_temp.mk_task('H2 [test]', 'pm', 'dir', pg_temp.pid('h'), null, 'completed');
select pg_temp.mk_task('H3 [test]', 'pm', 'dir', pg_temp.pid('h')) as x \gset h3_
select pg_temp.mk_task('H4 [test]', 'pm', 'dir', pg_temp.pid('h'));
select pg_temp.mk_task('H5 [test]', 'pm', 'dir', pg_temp.pid('h'));
select pg_temp.mk_task('H sub [test]', 'pm', 'dir', pg_temp.pid('h'), null, 'completed', 'normal', :'h3_x');
update hq.projects set target_date = hq.today() + 15 where id = pg_temp.pid('h');
select is((select progress_done || '/' || progress_total || '=' || progress_pct from hq.project_overview where id = pg_temp.pid('h')), '2/5=40', 'progress counts top-level tasks only (the done subtask is not counted)');
select is(pg_temp.health(pg_temp.pid('h')), 'on_track', 'target in 15 days with 40%: on_track');
update hq.projects set target_date = hq.today() + 14 where id = pg_temp.pid('h');
select is(pg_temp.health(pg_temp.pid('h')), 'at_risk', 'target in 14 days with 40%: at_risk');
select is((select health_reasons from hq.project_overview where id = pg_temp.pid('h')), array['The target date is in 14 days and progress is 40%'], '... with the reason');
update hq.tasks set status = 'completed' where id = :'h3_x';
select is(pg_temp.health(pg_temp.pid('h')), 'on_track', 'target in 14 days with exactly 60%: on_track');
select pg_temp.mk_task('H6 cancelled [test]', 'pm', 'dir', pg_temp.pid('h'), null, 'cancelled');
select is((select progress_done || '/' || progress_total from hq.project_overview where id = pg_temp.pid('h')), '3/5', 'cancelled tasks are left out of progress');
update hq.projects set target_date = hq.today() - 1 where id = pg_temp.pid('h');
select is(pg_temp.health(pg_temp.pid('h')), 'off_track', 'a target date in the past: off_track');
update hq.projects set status = 'on_hold' where id = pg_temp.pid('h');
select is(pg_temp.health(pg_temp.pid('h')), 'on_hold', 'on hold wins over every rule');
update hq.projects set status = 'completed' where id = pg_temp.pid('h');
select is(pg_temp.health(pg_temp.pid('h')), 'done', 'completed: done');
update hq.projects set status = 'cancelled' where id = pg_temp.pid('h');
select is(pg_temp.health(pg_temp.pid('h')), 'done', 'cancelled: done');
update hq.projects set status = 'planning', target_date = hq.today() + 100 where id = pg_temp.pid('h');
select is(pg_temp.health(pg_temp.pid('h')), 'on_track', 'a planning project is judged like an active one');

-- ------------------------------------------------------------ progress respects visibility
select pg_temp.mk_task('V dir private [test]', 'dir', 'dir', pg_temp.pid('h'));
select pg_temp.become('dir');
select is((select task_count from hq.project_overview where id = pg_temp.pid('h')), 8::bigint, 'a director (tasks.read_all) counts every task in the project');
select pg_temp.become('pm');
select is((select task_count from hq.project_overview where id = pg_temp.pid('h')), 7::bigint, 'a property manager counts only the tasks they can see (not the director''s private one)');
select is((select progress_done || '/' || progress_total from hq.project_overview where id = pg_temp.pid('h')), '3/5', '... and their progress uses only those');
select pg_temp.become('bdm');
select is((select progress_done || '/' || progress_total from hq.project_overview where id = pg_temp.pid('h')), '3/6', 'a business development manager (tasks.read_all) sees the private task in the progress');
select pg_temp.become('va');
select is((select task_count from hq.project_overview where id = pg_temp.pid('h')), 0::bigint, 'a virtual assistant with no task in it sees the project but counts nothing');
select pg_temp.unbecome();

-- ------------------------------------------------------------ my_focus ordering
update hq.tasks set deleted_at = now() where assigned_to = pg_temp.fx('va') and deleted_at is null;
select pg_temp.become('dir');
insert into zz_r select 'pu', hq.create_project('Urgent project [test]', p_priority => 'urgent');
select pg_temp.unbecome();
select pg_temp.mk_task('F-a overdue 3 normal', 'va', 'dir', null, -3);
select pg_temp.mk_task('F-z overdue 1 low', 'va', 'dir', null, -1, 'to_do', 'low');
select pg_temp.mk_task('F-d urgent due in 5', 'va', 'dir', null, 5, 'in_progress', 'urgent');
select pg_temp.mk_task('F-b urgent no due', 'va', 'dir', null, null, 'to_do', 'urgent');
select pg_temp.mk_task('F-c high due today', 'va', 'dir', null, 0, 'to_do', 'high') as x \gset fc_
select pg_temp.mk_task('F-e blocked urgent', 'va', 'dir', null, -9, 'to_do', 'urgent') as x \gset fe_
insert into hq.task_dependencies (task_id, depends_on_task_id) values (:'fe_x', :'fc_x');
select pg_temp.mk_task('F-f parent with open subtask', 'va', 'dir', pg_temp.pid('pu'), -5, 'to_do', 'urgent') as x \gset ff_
select pg_temp.mk_task('F-i normal tomorrow urgent project', 'va', 'dir', pg_temp.pid('pu'), 1);
select pg_temp.mk_task('F-j normal tomorrow no project', 'va', 'dir', null, 1);
select pg_temp.mk_task('F-g low subtask', 'va', 'dir', pg_temp.pid('pu'), null, 'to_do', 'low', :'ff_x');
select pg_temp.mk_task('F-k low no due', 'va', 'dir', null, null, 'to_do', 'low');
select pg_temp.mk_task('F-h completed', 'va', 'dir', null, -2, 'completed', 'urgent');
select pg_temp.mk_task('F-w waiting', 'va', 'dir', null, 3, 'waiting', 'normal');
update hq.tasks set created_at = now() - interval '1 day' where title = 'F-g low subtask';
select pg_temp.become('va');
select is((select array_agg(title order by rank) from hq.my_focus(20)),
  array['F-a overdue 3 normal', 'F-z overdue 1 low', 'F-d urgent due in 5', 'F-b urgent no due', 'F-c high due today', 'F-i normal tomorrow urgent project',
        'F-j normal tomorrow no project', 'F-w waiting', 'F-g low subtask', 'F-k low no due'],
  'my_focus: overdue first, then priority, due date (nulls last), project priority, oldest; blocked, completed and parents with open subtasks left out');
select is((select array_agg(title order by rank) from hq.my_focus()), array['F-a overdue 3 normal', 'F-z overdue 1 low', 'F-d urgent due in 5'], 'my_focus() gives the top three');
select is((select array_agg(why order by rank) from hq.my_focus(5)),
  array['Overdue by 3 days', 'Overdue by 1 day', 'Due in 5 days; Urgent', 'Urgent', 'Due today; High priority; Unblocks 1 task'], 'my_focus explains why');
select is((select why from hq.my_focus(20) where title = 'F-k low no due'), 'Next up', '... and says "Next up" when nothing stands out');
select is((select project_ref is not null and project_name = 'Urgent project [test]' from hq.my_focus(20) where title = 'F-i normal tomorrow urgent project'), true, 'my_focus names the project');
select is((select count(*) from hq.my_focus(0)), 1::bigint, 'a limit below 1 gives one');
select pg_temp.unbecome();
select pg_temp.mk_task('J focus in project', 'jpm', 'dir', pg_temp.pid('pu'), 0);
select pg_temp.become('jpm');
select is((select coalesce(project_name, '-') || coalesce(project_ref, '-') from hq.my_focus(20) where title = 'J focus in project'), '--', 'my_focus hides project names from someone without projects.read');

-- ------------------------------------------------------------ overdue_tasks
select pg_temp.become('va');
select is((select array_agg(title order by overdue_days desc) from hq.overdue_tasks()), array['F-e blocked urgent', 'F-f parent with open subtask', 'F-a overdue 3 normal', 'F-z overdue 1 low'], 'overdue_tasks(mine): every overdue open task of the caller, most overdue first');
select is((select is_blocked from hq.overdue_tasks() where title = 'F-e blocked urgent'), true, '... flagging the blocked one');
select is((select count(*) from hq.overdue_tasks('all', pg_temp.pid('pu'))), 1::bigint, 'overdue_tasks for one project');
select throws_ok($$select * from hq.overdue_tasks('everyone')$$, '22023', 'scope is mine or all', 'an unknown scope is refused');
select pg_temp.become('jpm');
select throws_ok(format($$select * from hq.overdue_tasks('all', %L)$$, pg_temp.pid('pu')), '42501', null, 'a junior cannot filter overdue tasks by project');
select pg_temp.unbecome();

-- ------------------------------------------------------------ checklists
select pg_temp.become('pm');
insert into zz_r select 'ck1', hq.set_task_checklist(pg_temp.tid('t2'), jsonb_build_array('Print the form', jsonb_build_object('text', 'Sign it', 'done', true), 'Post it'));
select pg_temp.unbecome();
select is((pg_temp.r('ck1') ->> 'total') || '/' || (pg_temp.r('ck1') ->> 'done'), '3/1', 'set_task_checklist: three items, one done');
select ok((select done_by = pg_temp.fx('pm') and done_at is not null from hq.task_checklist_items where task_id = pg_temp.tid('t2') and text = 'Sign it'), 'a done item is stamped with who and when');
create temp table zz_ck on commit drop as select done_at from hq.task_checklist_items where task_id = pg_temp.tid('t2') and text = 'Sign it';
grant select on zz_ck to public;
select pg_temp.become('pm');
insert into zz_r select 'ck2', hq.set_task_checklist(pg_temp.tid('t2'), jsonb_build_array(
  jsonb_build_object('id', (select id from hq.task_checklist_items where task_id = pg_temp.tid('t2') and text = 'Sign it'), 'text', 'Sign it'), 'Scan it'));
select throws_ok(format($$select hq.set_task_checklist(%L, (select jsonb_agg('item ' || g) from generate_series(1, 51) g))$$, pg_temp.tid('t2')), '22023', null, 'more than 50 items is refused');
select throws_ok(format($$select hq.set_task_checklist(%L, '["", "x"]'::jsonb)$$, pg_temp.tid('t2')), '22023', 'a checklist item needs text', 'a blank item is refused');
select pg_temp.become('jpm');
select throws_ok(format($$select hq.set_task_checklist(%L, '["x"]'::jsonb)$$, pg_temp.tid('t2')), 'P0002', 'task not found', 'a checklist on a task the caller cannot update: not found');
select pg_temp.unbecome();
select is((select string_agg(text || ':' || done, ',' order by sort_order) from hq.task_checklist_items where task_id = pg_temp.tid('t2')), 'Sign it:true,Scan it:false', 'items not listed are removed; kept items keep their state, in the new order');
select is((select done_at from hq.task_checklist_items where task_id = pg_temp.tid('t2') and text = 'Sign it'), (select done_at from zz_ck), '... and their done stamp');
select is((select count(*) from hq.task_activity where task_id = pg_temp.tid('t2') and kind = 'checklist'), 2::bigint, 'each checklist change is in the activity');

-- ------------------------------------------------------------ comments
select pg_temp.become('pm');
insert into zz_r select 'cm1', hq.add_task_comment(pg_temp.tid('t2'), 'Form is at the post office.');
select throws_ok(format($$select hq.add_task_comment(%L, '   ')$$, pg_temp.tid('t2')), '22023', 'a comment needs text', 'a blank comment is refused');
select throws_ok(format($$select hq.add_task_comment(%L, 'x')$$, :'priv_x'), 'P0002', 'task not found', 'a comment on a task the caller cannot see: not found');
insert into zz_r select 'cm2', hq.edit_task_comment((pg_temp.r('cm1') ->> 'comment_id')::bigint, 'Form is at the post office in Kadina.');
select pg_temp.become('va');
select throws_ok(format($$select hq.edit_task_comment(%s, 'hijack')$$, pg_temp.r('cm1') ->> 'comment_id'), 'P0002', null, 'someone who cannot see the task cannot edit its comment');
select pg_temp.become('bdm');
select throws_ok(format($$select hq.edit_task_comment(%s, 'not mine')$$, pg_temp.r('cm1') ->> 'comment_id'), '42501', null, 'someone else (not a director) cannot edit a comment');
select pg_temp.unbecome();
select ok((select edited_at is not null and body = 'Form is at the post office in Kadina.' from hq.task_comments where id = (pg_temp.r('cm1') ->> 'comment_id')::bigint), 'the author edits their comment; edited_at is stamped');
alter table hq.task_comments disable trigger task_comment_guard;
update hq.task_comments set created_at = now() - interval '61 minutes' where id = (pg_temp.r('cm1') ->> 'comment_id')::bigint;
alter table hq.task_comments enable trigger task_comment_guard;
select pg_temp.become('pm');
select throws_ok(format($$select hq.edit_task_comment(%s, 'too late')$$, pg_temp.r('cm1') ->> 'comment_id'), '42501', 'a comment can be edited by its author within 60 minutes of posting, or by a director', 'after 60 minutes the author cannot edit');
select pg_temp.become('dir');
select lives_ok(format($$select hq.edit_task_comment(%s, 'Corrected by the director.')$$, pg_temp.r('cm1') ->> 'comment_id'), 'a director can edit a comment at any time');
select pg_temp.become('jpm');
select is((select count(*) from hq.task_comments where task_id = pg_temp.tid('t2')) + (select count(*) from hq.task_activity where task_id = pg_temp.tid('t2')), 0::bigint, 'comments and activity of a task the reader cannot see are hidden');
select pg_temp.unbecome();
select throws_ok(format($$delete from hq.task_comments where id = %s$$, pg_temp.r('cm1') ->> 'comment_id'), '42501', null, 'a comment is never deleted, even by the table owner');

-- ------------------------------------------------------------ append-only activity
select throws_ok($$update hq.task_activity set summary = 'changed'$$, '42501', null, 'task_activity: update raises even as postgres');
select throws_ok($$delete from hq.task_activity$$, '42501', null, 'task_activity: delete raises even as postgres');
select throws_ok($$update hq.project_activity set summary = 'changed'$$, '42501', null, 'project_activity: update raises even as postgres');
select throws_ok($$delete from hq.project_activity$$, '42501', null, 'project_activity: delete raises even as postgres');
select pg_temp.become('pm');
select is((select count(*) from hq.project_activity where project_id = pg_temp.pid('p1') and kind in ('task_created', 'milestone_added', 'linked', 'document_added')) >= 8, true, 'project activity records tasks, milestones, links and documents');
select pg_temp.unbecome();
select is((select count(*) from hq.task_activity where task_id = pg_temp.tid('t1') and kind = 'completed'), 1::bigint, 'completing a task writes a completed activity row');

-- ------------------------------------------------------------ task_overview and the timeline
select pg_temp.become('pm');
select is((select project_name || '|' || milestone_name || '|' || subtask_count || '|' || checklist_total || '|' || checklist_done || '|' || assignee_name from hq.task_overview where id = pg_temp.tid('t1')),
  'Launch Planted [test]|Licensing|1|2|0|Pat Manager', 'task_overview: project, milestone, subtasks, checklist and assignee');
select is((select parent_title from hq.task_overview where id = pg_temp.tid('s1')), 'Enrol in the licence course [test]', 'task_overview: a subtask names its parent');
select is((select count(*) filter (where kind = 'milestone') || '|' || count(*) filter (where kind = 'task') from hq.project_timeline where project_id = pg_temp.pid('p1')), '3|1',
  'project_timeline: every milestone and each dated task');
select is((select depends_on from hq.project_timeline where project_id = pg_temp.pid('p1') and kind = 'task'), '{}'::uuid[], 'the dated task (t1) waits for nothing');
select pg_temp.unbecome();

-- ------------------------------------------------------------ archive and restore
select pg_temp.become('ro');
select throws_ok(format($$select hq.archive_record('project', %L)$$, pg_temp.pid('p2')), '42501', null, 'read_only cannot archive a project');
select pg_temp.become('pm');
insert into zz_r select 'a1', hq.archive_record('project', pg_temp.pid('p2'), 'Merged into the launch');
insert into zz_r select 'a2', hq.archive_record('project', pg_temp.pid('p2'));
select is((select count(*) from hq.projects where id = pg_temp.pid('p2')), 1::bigint, 'a projects.write holder still sees the archived project');
select pg_temp.become('ro');
select is((select count(*) from hq.projects where id = pg_temp.pid('p2')), 0::bigint, 'read_only no longer sees it');
select pg_temp.unbecome();
select is((pg_temp.r('a1') ->> 'changed') || (pg_temp.r('a2') ->> 'changed'), 'truefalse', 'archive_record project: archived once');
select is((select count(*) from hq.audit_events where entity_type = 'project' and entity_id = pg_temp.pid('p2') and action = 'archive' and summary like '%Merged into the launch%'), 1::bigint, 'the archive is audited with its reason');
select pg_temp.become('dir');
insert into zz_r select 'p2b', hq.create_project('second project [TEST]');
select throws_ok(format($$select hq.restore_record('project', %L)$$, pg_temp.pid('p2')), '23505', null, 'a restore is refused while a live project has taken the name');
select lives_ok(format($$select hq.archive_record('project', %L)$$, pg_temp.pid('p2b')), 'the newer project is archived');
insert into zz_r select 'a3', hq.restore_record('project', pg_temp.pid('p2'));
select pg_temp.unbecome();
select is((select deleted_at is null from hq.projects where id = pg_temp.pid('p2')), true, 'restore_record project brings it back');
select is((select string_agg(kind, ',' order by id) from hq.project_activity where project_id = pg_temp.pid('p2') and kind in ('archived', 'restored')), 'archived,restored', 'archive and restore are in the project activity');

-- ------------------------------------------------------------ the bulk settings guard
select throws_ok($$update hq.settings set value = '0'::jsonb where key = 'bulk_calls_per_hour'$$, '22023', 'bulk_calls_per_hour must be a whole number from 1 to 60', 'bulk_calls_per_hour 0 is refused');
select throws_ok($$update hq.settings set value = '61'::jsonb where key = 'bulk_calls_per_hour'$$, '22023', 'bulk_calls_per_hour must be a whole number from 1 to 60', 'bulk_calls_per_hour 61 is refused');
select lives_ok($$update hq.settings set value = '60'::jsonb where key = 'bulk_calls_per_hour'$$, 'bulk_calls_per_hour 60 is allowed');
select throws_ok($$update hq.settings set value = '2001'::jsonb where key = 'bulk_items_per_hour'$$, '22023', 'bulk_items_per_hour must be a whole number from 1 to 2000', 'bulk_items_per_hour 2001 is refused');
select throws_ok($$update hq.settings set value = '"lots"'::jsonb where key = 'bulk_items_per_hour'$$, '22023', null, 'bulk_items_per_hour must be a number');
select lives_ok($$update hq.settings set value = '2000'::jsonb where key = 'bulk_items_per_hour'$$, 'bulk_items_per_hour 2000 is allowed');
select pg_temp.become('adm');
update hq.settings set value = '1'::jsonb where key = 'bulk_calls_per_hour';
select pg_temp.unbecome();
select is((select value from hq.settings where key = 'bulk_calls_per_hour'), '60'::jsonb, 'an administrator cannot change the bulk budget (settings.admin is a director capability)');

select * from finish();
rollback;
