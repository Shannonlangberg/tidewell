-- Planted HQ: hq.bootstrap_first_director (the secret key's only HQ write). Runs before any other hq
-- test so the staff table is empty on a fresh `supabase db reset`; if the database already holds
-- staff (a developer's data) the success path is skipped and the refusal is still proved.
--
-- NOTE: never CALL a function a hint role (anon, authenticated, service_role) lacks execute on: the
-- local Postgres image's supautils permission hint segfaults on "permission denied for function".
-- Execute privilege is asserted with has_function_privilege instead.
begin;
\ir hq_fixture.inc
select count(*) > 0 as has_staff from hq.staff_profiles \gset
select plan(7);

select pg_temp.mk_user('first@hq.test', 'Fiona First', 'Fiona') as first_user \gset
select pg_temp.mk_user('second@hq.test', 'Sean Second', 'Sean') as second_user \gset

select ok(not has_function_privilege('authenticated', 'hq.bootstrap_first_director(uuid,text,text,text)', 'execute'), 'authenticated cannot execute bootstrap_first_director');
select ok(not has_function_privilege('anon', 'hq.bootstrap_first_director(uuid,text,text,text)', 'execute'), 'anon cannot execute bootstrap_first_director');
select ok(has_function_privilege('service_role', 'hq.bootstrap_first_director(uuid,text,text,text)', 'execute'), 'service_role can execute bootstrap_first_director');

\if :has_staff
  select skip('this database already has staff profiles (the success path needs an empty table)', 3);
\else
  set local role service_role;
  select lives_ok($$select hq.bootstrap_first_director('$$ || :'first_user' || $$', 'first@hq.test', 'Fiona First', 'Fiona')$$,
    'service_role bootstraps the first director');
  reset role;
  select is((select role::text from hq.staff_profiles where id = :'first_user'::uuid), 'director', 'the first staff member is a director');
  select is((select count(*) from hq.audit_events where action = 'bootstrap' and entity_id = :'first_user'::uuid and actor_id is null and actor_name = 'System'),
    1::bigint, 'the bootstrap is audited as a system action');
\endif

-- once any staff profile exists, a second call is refused (even by service_role)
set local role service_role;
select throws_ok($$select hq.bootstrap_first_director('$$ || :'second_user' || $$', 'second@hq.test', 'Sean Second', 'Sean')$$,
  'P0001', 'HQ already has staff; the first director can be created only once', 'a second bootstrap is refused');
reset role;

select * from finish();
rollback;
