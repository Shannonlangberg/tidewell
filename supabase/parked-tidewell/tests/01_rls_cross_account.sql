-- Phase 0 acceptance: seeded with two owner accounts, a cross-account negative select on every
-- phase-0 table; a cleaner cannot select owner_accounts; an owner cannot read owner_account_notes;
-- `select * from outbox` is empty for every client role; managers (aal2) see both accounts.
begin;
\ir fixture.inc
select pg_temp.seed_world();
select plan(57);

-- ---------------------------------------------------------------- Jane: owner of account A (primary)
select pg_temp.login(pg_temp.fx('jane'));
set local role authenticated;

select is((select count(*) from public.profiles where id = pg_temp.fx('mia')), 0::bigint, 'owner: profiles of account B hidden');
select is((select count(*) from public.profiles where id = pg_temp.fx('jane')), 1::bigint, 'owner: own profile visible');
select is((select count(*) from public.profiles where id = pg_temp.fx('rob')), 0::bigint, 'owner: co-owner base profile hidden (names come from profiles_directory)');
select is((select count(*) from public.org_settings), 0::bigint, 'owner: org_settings base table hidden');
select is((select count(*) from public.fee_schedules), 0::bigint, 'owner: fee_schedules base table hidden');
select is((select count(*) from public.owner_accounts where id = pg_temp.fx('acct_b')), 0::bigint, 'owner: account B hidden');
select is((select count(*) from public.owner_accounts where id = pg_temp.fx('acct_a')), 1::bigint, 'owner: account A visible');
select is((select count(*) from public.owner_account_notes), 0::bigint, 'owner: owner_account_notes hidden (both accounts)');
select is((select count(*) from public.memberships where owner_account_id = pg_temp.fx('acct_b')), 0::bigint, 'owner: memberships of account B hidden');
select is((select count(*) from public.memberships where owner_account_id = pg_temp.fx('acct_a')), 2::bigint, 'owner: memberships of account A visible');
select is((select count(*) from public.memberships where role = 'manager'), 0::bigint, 'owner: manager memberships hidden');
select is((select count(*) from public.properties where id = pg_temp.fx('prop_b')), 0::bigint, 'owner: property B hidden');
select is((select count(*) from public.properties where id = pg_temp.fx('prop_a')), 1::bigint, 'owner: property A visible');
select is((select count(*) from public.leads), 0::bigint, 'owner: leads hidden');
select is((select count(*) from public.events where owner_account_id = pg_temp.fx('acct_b')), 0::bigint, 'owner: events of account B hidden');
select is((select count(*) from public.events where property_id = pg_temp.fx('prop_a') and audience @> '{owner}'), 1::bigint, 'owner: owner-audience events of property A visible');
select is((select count(*) from public.events where audience = '{crew}' or audience = '{internal}'), 0::bigint, 'owner: crew-only and internal events hidden');
select is((select count(*) from public.documents where owner_account_id = pg_temp.fx('acct_b')), 0::bigint, 'owner: documents of account B hidden');
select is((select count(*) from public.documents where owner_account_id = pg_temp.fx('acct_a')), 1::bigint, 'owner: account A documents visible');
select is((select count(*) from public.crew_profiles), 0::bigint, 'owner: crew_profiles hidden');
select is((select count(*) from public.agreements where owner_account_id = pg_temp.fx('acct_b')), 0::bigint, 'owner: agreements of account B hidden');
select is((select count(*) from public.agreements where owner_account_id = pg_temp.fx('acct_a')), 1::bigint, 'owner: agreement of account A visible');
select is((select count(*) from public.disclosure_acknowledgements where agreement_id = pg_temp.fx('agr_b')), 0::bigint, 'owner: acknowledgements of account B hidden');
select is((select count(*) from public.disclosure_acknowledgements where agreement_id = pg_temp.fx('agr_a')), 1::bigint, 'owner: acknowledgements of account A visible');
select is((select count(*) from public.dd_mandates where owner_account_id = pg_temp.fx('acct_b')), 0::bigint, 'owner: mandates of account B hidden');
select is((select count(*) from public.dd_mandates where owner_account_id = pg_temp.fx('acct_a')), 1::bigint, 'owner: mandate of account A visible');
select is((select count(*) from public.offboardings where property_id = pg_temp.fx('prop_b')), 0::bigint, 'owner: offboarding of property B hidden');
select is((select count(*) from public.offboardings where property_id = pg_temp.fx('prop_a')), 1::bigint, 'owner: offboarding of property A visible');
select is((select count(*) from public.notification_rules where recipient_role <> 'owner'), 0::bigint, 'owner: only owner-role notification rules visible');
select ok((select count(*) from public.notification_rules where recipient_role = 'owner') > 0, 'owner: owner-role notification rules visible');
select is((select count(*) from public.notification_preferences where user_id <> pg_temp.fx('jane')), 0::bigint, 'owner: other preferences hidden');
select is((select count(*) from public.notification_preferences where user_id = pg_temp.fx('jane')), 1::bigint, 'owner: own preferences visible');
select is((select count(*) from public.push_subscriptions where user_id <> pg_temp.fx('jane')), 0::bigint, 'owner: other push subscriptions hidden');
select is_empty('select * from public.outbox', 'owner: select * from outbox returns nothing');
select is((select count(*) from public.notifications where user_id <> pg_temp.fx('jane')), 0::bigint, 'owner: other notifications hidden');
select is((select count(*) from public.notifications where user_id = pg_temp.fx('jane')), 1::bigint, 'owner: own notifications visible');
select is((select count(*) from public.webhook_receipts), 0::bigint, 'owner: webhook_receipts hidden');
select is((select count(*) from public.integration_sync), 0::bigint, 'owner: integration_sync hidden');
select throws_ok('select * from public.rate_limits', '42501', null, 'owner: rate_limits not even selectable');

reset role;
select pg_temp.logout();

-- ---------------------------------------------------------------- Kel: cleaner
select pg_temp.login(pg_temp.fx('kel'));
set local role authenticated;
select is((select count(*) from public.owner_accounts), 0::bigint, 'cleaner: cannot select any owner_accounts row');
select is((select count(*) from public.owner_account_notes), 0::bigint, 'cleaner: owner_account_notes hidden');
select is((select count(*) from public.properties), 0::bigint, 'cleaner: properties hidden until an assignment exists (crew_at stub)');
select is((select count(*) from public.events), 0::bigint, 'cleaner: crew events hidden until can_see_job is real');
select is((select count(*) from public.crew_profiles where user_id = pg_temp.fx('kel')), 1::bigint, 'cleaner: sees own crew_profile');
select is((select count(*) from public.crew_profiles where user_id <> pg_temp.fx('kel')), 0::bigint, 'cleaner: no other crew_profile');
select is((select count(*) from public.documents where user_id = pg_temp.fx('kel')), 1::bigint, 'cleaner: sees own remittance document');
select is((select count(*) from public.documents where user_id is distinct from pg_temp.fx('kel')), 0::bigint, 'cleaner: no owner documents');
select is_empty('select * from public.outbox', 'cleaner: select * from outbox returns nothing');
reset role;
select pg_temp.logout();

-- ---------------------------------------------------------------- Court: manager at aal2
select pg_temp.login(pg_temp.fx('court'), 'aal2');
set local role authenticated;
select is((select count(*) from public.owner_accounts where id in (pg_temp.fx('acct_a'), pg_temp.fx('acct_b'))), 2::bigint, 'manager: both accounts visible');
select is((select count(*) from public.owner_account_notes where owner_account_id in (pg_temp.fx('acct_a'), pg_temp.fx('acct_b'))), 2::bigint, 'manager: both notes rows visible');
select is((select count(*) from public.properties where id in (pg_temp.fx('prop_a'), pg_temp.fx('prop_b'))), 2::bigint, 'manager: both properties visible');
select is((select count(*) from public.leads where id = pg_temp.fx('lead')), 1::bigint, 'manager: leads visible');
select is((select count(*) from public.events where owner_account_id in (pg_temp.fx('acct_a'), pg_temp.fx('acct_b')) or entity_id = pg_temp.fx('lead')), 4::bigint, 'manager: every event visible, internal and crew included');
select is_empty('select * from public.outbox', 'manager: select * from outbox returns nothing');
select is((select count(*) from public.org_settings), 1::bigint, 'manager: org_settings visible');
reset role;
select pg_temp.logout();

-- ---------------------------------------------------------------- Court without aal2: not a manager
select pg_temp.login(pg_temp.fx('court'), 'aal1');
set local role authenticated;
select is((select count(*) from public.owner_accounts), 0::bigint, 'manager at aal1: sees no owner_accounts');
select is((select count(*) from public.org_settings), 0::bigint, 'manager at aal1: sees no org_settings');
reset role;
select pg_temp.logout();

select * from finish();
rollback;
