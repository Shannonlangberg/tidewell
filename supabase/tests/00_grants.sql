-- Phase 0: privileges the design asserts (3.1, section 10).
begin;
\ir fixture.inc
select plan(22);

select ok(not has_schema_privilege('authenticated', 'private', 'usage'), 'authenticated has no usage on private');
select ok(not has_schema_privilege('anon', 'private', 'usage'), 'anon has no usage on private');
select ok(not has_schema_privilege('service_role', 'private', 'usage'), 'service_role has no usage on private');
select ok(has_schema_privilege('supabase_auth_admin', 'private', 'usage'), 'supabase_auth_admin has usage on private (token hook)');

select ok(not has_sequence_privilege('authenticated', 'public.invoice_seq', 'usage'), 'authenticated has no usage on invoice_seq');
select ok(not has_sequence_privilege('authenticated', 'public.invoice_seq', 'select'), 'authenticated has no select on invoice_seq');
select ok(not has_sequence_privilege('anon', 'public.invoice_seq', 'usage'), 'anon has no usage on invoice_seq');
select ok(not has_sequence_privilege('anon', 'public.invoice_seq', 'select'), 'anon has no select on invoice_seq');

-- truncate is never granted on a public table to an API role
select is(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public' and privilege_type = 'TRUNCATE' and grantee in ('anon', 'authenticated', 'service_role')),
  0::bigint, 'no API role holds truncate on any public table');

-- and the default ACL keeps it that way for tables created later
create table public.zz_probe (id int);
select is(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'zz_probe' and privilege_type = 'TRUNCATE' and grantee in ('anon', 'authenticated', 'service_role')),
  0::bigint, 'default privileges give no truncate on a new table');
select is(
  (select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'zz_probe' and grantee = 'anon'),
  0::bigint, 'default privileges give anon nothing on a new table');

-- anon never holds a grant on a base table
select is(
  (select count(*) from information_schema.role_table_grants g join pg_tables t on t.schemaname = g.table_schema and t.tablename = g.table_name
    where g.table_schema = 'public' and g.grantee = 'anon'),
  0::bigint, 'anon has no grant on any public base table');

-- state tables: select only
select table_privs_are('public', 'events', 'authenticated', array['SELECT'], 'events: authenticated select only');
select table_privs_are('public', 'events', 'service_role', array['SELECT'], 'events: service_role select only');
select table_privs_are('public', 'outbox', 'authenticated', array['SELECT'], 'outbox: authenticated select only');
select table_privs_are('public', 'outbox', 'service_role', array['SELECT'], 'outbox: service_role select only');

-- the secret key cannot truncate events
set local role service_role;
select throws_ok('truncate public.events', '42501', null, 'service_role cannot truncate events');
reset role;

-- the hook's grants and the API roles' lack of them
select ok(has_function_privilege('supabase_auth_admin', 'private.custom_access_token_hook(jsonb)', 'execute'), 'supabase_auth_admin executes the token hook');
select ok(not has_function_privilege('authenticated', 'private.custom_access_token_hook(jsonb)', 'execute'), 'authenticated cannot execute the token hook');
select ok(not has_function_privilege('anon', 'private.custom_access_token_hook(jsonb)', 'execute'), 'anon cannot execute the token hook');
select ok(has_table_privilege('supabase_auth_admin', 'public.memberships', 'select'), 'supabase_auth_admin selects memberships');
select ok(not has_function_privilege('authenticated', 'private.emit_event(text,uuid,text,uuid,uuid,text[],jsonb,text,uuid,text)', 'execute'), 'authenticated cannot execute emit_event');

select * from finish();
rollback;
