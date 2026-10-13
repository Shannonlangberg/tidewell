-- Definer views: the role each view serves gets zero rows or an error from the base table, and the
-- view exposes only what the design lists.
begin;
\ir fixture.inc
select pg_temp.seed_world();
select plan(16);

-- anon: the two public views, nothing else
set local role anon;
select lives_ok('select * from public.org_settings_public', 'anon: reads org_settings_public');
select is((select count(*) from public.fee_schedules_public where effective_from = date '2026-10-01'), 1::bigint, 'anon: reads the published fee schedule');
select is((select total_fee_inc_gst_bps from public.fee_schedules_public where effective_from = date '2026-10-01'), 1980, 'anon: sees the 19.8% total');
select throws_ok('select * from public.org_settings', '42501', null, 'anon: base org_settings refused');
select throws_ok('select * from public.fee_schedules', '42501', null, 'anon: base fee_schedules refused');
select throws_ok('select * from public.profiles_directory', '42501', null, 'anon: profiles_directory refused');
select throws_ok('select * from public.owner_accounts', '42501', null, 'anon: owner_accounts refused');
reset role;

-- fee_schedules_public never carries created_by
select hasnt_column('public', 'fee_schedules_public', 'created_by', 'fee_schedules_public: no created_by');
select hasnt_column('public', 'profiles_directory', 'email', 'profiles_directory: no email');
select hasnt_column('public', 'profiles_directory', 'phone_e164', 'profiles_directory: no phone');

-- an owner: zero rows from the base tables, the views work
select pg_temp.login(pg_temp.fx('jane'));
set local role authenticated;
select is((select count(*) from public.org_settings), 0::bigint, 'owner: base org_settings gives zero rows');
select is((select count(*) from public.org_settings_public), 1::bigint, 'owner: org_settings_public gives the row');
select ok((select count(*) from public.fee_schedules_public) >= 1, 'owner: fee_schedules_public gives rows');
select results_eq(
  'select first_name from public.profiles_directory where id in (select id from fx) order by first_name',
  $$values ('Court'), ('Jane'), ('Rob'), ('Sam')$$,
  'owner: directory lists managers, self and the co-owner, never another account''s owner or the cleaner');
reset role;

-- a cleaner sees managers and self only
select pg_temp.login(pg_temp.fx('kel'));
set local role authenticated;
select results_eq(
  'select first_name from public.profiles_directory where id in (select id from fx) order by first_name',
  $$values ('Court'), ('Kel'), ('Sam')$$,
  'cleaner: directory lists managers and self');
reset role;
select pg_temp.logout();

-- no session: nothing
set local role authenticated;
select is((select count(*) from public.profiles_directory), 0::bigint, 'no session: directory is empty');
reset role;

select * from finish();
rollback;
