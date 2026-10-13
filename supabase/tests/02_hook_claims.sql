-- The Custom Access Token hook's claims, private.is_manager() and the aal2 requirement, and the
-- password-verification hook.
begin;
\ir fixture.inc
select pg_temp.seed_world();
select plan(16);

-- owner-only user
select is(
  (private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.fx('jane'), 'claims', jsonb_build_object('sub', pg_temp.fx('jane'), 'role', 'authenticated'))) -> 'claims'),
  jsonb_build_object('sub', pg_temp.fx('jane'), 'role', 'authenticated',
                     'app_roles', '["owner"]'::jsonb, 'is_manager', false, 'crew_kind', null, 'owner_account_ids', jsonb_build_array(pg_temp.fx('acct_a'))),
  'hook: owner gets app_roles [owner], is_manager false, crew_kind null, owner_account_ids [A]');

-- manager plus owner
insert into public.memberships (user_id, role, owner_account_id, status) values (pg_temp.fx('court'), 'owner', pg_temp.fx('acct_b'), 'active');
select is(
  (private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.fx('court'), 'claims', '{}'::jsonb)) -> 'claims'),
  jsonb_build_object('app_roles', '["manager","owner"]'::jsonb, 'is_manager', true, 'crew_kind', null, 'owner_account_ids', jsonb_build_array(pg_temp.fx('acct_b'))),
  'hook: manager plus owner gets both roles, is_manager true, the account id');

-- cleaner
select is(
  (private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.fx('kel'), 'claims', '{}'::jsonb)) -> 'claims'),
  jsonb_build_object('app_roles', '["crew"]'::jsonb, 'is_manager', false, 'crew_kind', 'cleaner', 'owner_account_ids', '[]'::jsonb),
  'hook: cleaner gets crew_kind cleaner and no accounts');

-- invited manager: no active membership yet, so empty claims
select is(
  (private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.fx('newmgr'), 'claims', '{}'::jsonb)) -> 'claims'),
  jsonb_build_object('app_roles', '[]'::jsonb, 'is_manager', false, 'crew_kind', null, 'owner_account_ids', '[]'::jsonb),
  'hook: an invited manager carries no roles');

-- ended membership drops out of the claims at once
update public.memberships set status = 'ended', ended_at = now() where user_id = pg_temp.fx('kel');
select is(
  (private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.fx('kel'), 'claims', '{}'::jsonb)) -> 'claims' -> 'app_roles'),
  '[]'::jsonb, 'hook: an ended membership is gone from app_roles');

-- a read_only owner (the 90 days after a property closes) keeps the owner claim so the UI can route them
update public.memberships set status = 'read_only' where user_id = pg_temp.fx('jane') and role = 'owner';
select is(
  (private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.fx('jane'), 'claims', '{}'::jsonb)) -> 'claims'),
  jsonb_build_object('app_roles', '["owner"]'::jsonb, 'is_manager', false, 'crew_kind', null, 'owner_account_ids', jsonb_build_array(pg_temp.fx('acct_a'))),
  'hook: a read_only owner still carries the owner role and account');
update public.memberships set status = 'active' where user_id = pg_temp.fx('jane') and role = 'owner';

-- the hook keeps the other claims intact
select is(
  (private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.fx('jane'), 'claims', jsonb_build_object('aal', 'aal1', 'exp', 123))) -> 'claims' ->> 'aal'),
  'aal1', 'hook: existing claims are preserved');

-- the password hook rejects every sign-in
select is((private.password_verification_hook(jsonb_build_object('user_id', pg_temp.fx('jane'), 'valid', true)) ->> 'decision'), 'reject', 'password hook: rejects a valid password');
select is((private.password_verification_hook(jsonb_build_object('user_id', pg_temp.fx('jane'), 'valid', false)) ->> 'decision'), 'reject', 'password hook: rejects an invalid password');

-- is_manager(): membership AND aal2
select pg_temp.login(pg_temp.fx('court'), null);
set local role authenticated;
select is(pg_temp.is_manager(), false, 'is_manager: false with no aal claim');
reset role;
select pg_temp.login(pg_temp.fx('court'), 'aal1');
set local role authenticated;
select is(pg_temp.is_manager(), false, 'is_manager: false at aal1');
reset role;
select pg_temp.login(pg_temp.fx('court'), 'aal2');
set local role authenticated;
select is(pg_temp.is_manager(), true, 'is_manager: true at aal2 with an active manager membership');
reset role;
select pg_temp.login(pg_temp.fx('newmgr'), 'aal2');
set local role authenticated;
select is(pg_temp.is_manager(), false, 'is_manager: false for an invited manager even at aal2');
reset role;
select pg_temp.login(pg_temp.fx('jane'), 'aal2');
set local role authenticated;
select is(pg_temp.is_manager(), false, 'is_manager: false for an owner at aal2');
select is(pg_temp.my_owner_account_ids(), array[pg_temp.fx('acct_a')], 'my_owner_account_ids: the owner''s account');
select throws_ok('select private.is_manager()', '42501', null, 'authenticated cannot name a private helper directly');
reset role;
select pg_temp.logout();

select * from finish();
rollback;
