-- Realtime: audience-split private topics. An owner's select on realtime.messages for
-- property:{id}:crew returns nothing; :owner and user:{id} work; no browser can insert.
begin;
\ir fixture.inc
select pg_temp.seed_world();
select plan(10);

-- the seed emitted an owner-audience event for property A, so the router already sent to
-- property:{A}:owner and managers; add a crew message and a user message by hand (as postgres).
select realtime.send('{}'::jsonb, 'refresh', 'property:' || pg_temp.fx('prop_a')::text || ':crew', true);
select realtime.send('{}'::jsonb, 'refresh', 'user:' || pg_temp.fx('jane')::text, true);
select realtime.send('{}'::jsonb, 'refresh', 'user:' || pg_temp.fx('mia')::text, true);
select ok((select count(*) from realtime.messages where topic = 'property:' || pg_temp.fx('prop_a')::text || ':crew') >= 1, 'setup: a crew message exists for property A');

select pg_temp.login(pg_temp.fx('jane'));
set local role authenticated;
select set_config('realtime.topic', 'property:' || pg_temp.fx('prop_a')::text || ':crew', true);
select is_empty('select * from realtime.messages where topic = current_setting(''realtime.topic'')', 'owner: property:{id}:crew returns nothing');
select set_config('realtime.topic', 'property:' || pg_temp.fx('prop_a')::text || ':owner', true);
select isnt_empty('select * from realtime.messages where topic = current_setting(''realtime.topic'')', 'owner: property:{id}:owner is readable');
select set_config('realtime.topic', 'property:' || pg_temp.fx('prop_b')::text || ':owner', true);
select is_empty('select * from realtime.messages where topic = current_setting(''realtime.topic'')', 'owner: another account''s property topic returns nothing');
select set_config('realtime.topic', 'managers', true);
select is_empty('select * from realtime.messages where topic = current_setting(''realtime.topic'')', 'owner: managers topic returns nothing');
select set_config('realtime.topic', 'user:' || pg_temp.fx('jane')::text, true);
select isnt_empty('select * from realtime.messages where topic = current_setting(''realtime.topic'')', 'owner: own user topic is readable');
select set_config('realtime.topic', 'user:' || pg_temp.fx('mia')::text, true);
select is_empty('select * from realtime.messages where topic = current_setting(''realtime.topic'')', 'owner: another user topic returns nothing');
select throws_ok($$insert into realtime.messages (topic, extension, payload, event, private) values ('managers', 'broadcast', '{}', 'refresh', true)$$, '42501', null, 'owner: cannot insert into realtime.messages (no insert policy)');
reset role;

select pg_temp.login(pg_temp.fx('court'), 'aal2');
set local role authenticated;
select set_config('realtime.topic', 'managers', true);
select isnt_empty('select * from realtime.messages where topic = current_setting(''realtime.topic'')', 'manager at aal2: managers topic is readable');
reset role;
select pg_temp.login(pg_temp.fx('court'), 'aal1');
set local role authenticated;
select set_config('realtime.topic', 'managers', true);
select is_empty('select * from realtime.messages where topic = current_setting(''realtime.topic'')', 'manager at aal1: managers topic returns nothing');
reset role;
select pg_temp.logout();

select * from finish();
rollback;
