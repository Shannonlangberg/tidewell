-- Phase-0 RPCs: membership lifecycle (two-person rule, session deletion) and the approval
-- threshold with the 24-hour undo rule for non-primary members.
begin;
\ir fixture.inc
select pg_temp.seed_world();
select plan(35);

-- ------------------------------------------------------------ set_approval_threshold
-- Rob is not the primary contact: an increase waits 24 hours
select pg_temp.login(pg_temp.fx('rob'));
set local role authenticated;
select is((public.set_approval_threshold(pg_temp.fx('acct_a'), 30000)) ->> 'applied', 'false', 'non-primary increase: not applied');
reset role;
select is((select approval_threshold_cents from public.owner_accounts where id = pg_temp.fx('acct_a')), 15000, 'non-primary increase: threshold unchanged');
select is((select threshold_pending_cents from public.owner_accounts where id = pg_temp.fx('acct_a')), 30000, 'non-primary increase: pending amount recorded');
select ok((select threshold_pending_until from public.owner_accounts where id = pg_temp.fx('acct_a')) between now() + interval '23 hours' and now() + interval '25 hours', 'non-primary increase: pending for 24 hours');
select is((select count(*) from public.events where type = 'threshold.change_pending' and owner_account_id = pg_temp.fx('acct_a')), 1::bigint, 'non-primary increase: threshold.change_pending emitted');
select is((select count(*) from public.outbox o join public.events e on e.id = o.event_id where e.type = 'threshold.change_pending' and o.recipient_user_id in (pg_temp.fx('jane'), pg_temp.fx('rob'))), 2::bigint, 'non-primary increase: every member of the account is queued a notification');
select is((select payload - 'pending_until' from public.events where type = 'threshold.change_pending' and owner_account_id = pg_temp.fx('acct_a')), '{"threshold_cents": 30000, "previous_threshold_cents": 15000, "changed_by_first_name": "Rob"}'::jsonb, 'non-primary increase: payload carries only whitelisted keys');

-- any member may undo inside the window
select pg_temp.login(pg_temp.fx('jane'));
set local role authenticated;
select lives_ok($$select public.undo_threshold_change('$$ || pg_temp.fx('acct_a') || $$')$$, 'undo: the primary contact undoes the pending change');
reset role;
select is((select threshold_pending_cents from public.owner_accounts where id = pg_temp.fx('acct_a')), null, 'undo: pending cleared');
select is((select count(*) from public.events where type = 'threshold.change_undone' and owner_account_id = pg_temp.fx('acct_a')), 1::bigint, 'undo: threshold.change_undone emitted');

-- a non-primary decrease applies at once
select pg_temp.login(pg_temp.fx('rob'));
set local role authenticated;
select is((public.set_approval_threshold(pg_temp.fx('acct_a'), 10000)) ->> 'applied', 'true', 'non-primary decrease: applied at once');
reset role;
select is((select approval_threshold_cents from public.owner_accounts where id = pg_temp.fx('acct_a')), 10000, 'non-primary decrease: threshold updated');

-- the primary contact's increase applies at once
select pg_temp.login(pg_temp.fx('jane'));
set local role authenticated;
select is((public.set_approval_threshold(pg_temp.fx('acct_a'), 25000)) ->> 'applied', 'true', 'primary increase: applied at once');
reset role;
select is((select approval_threshold_cents from public.owner_accounts where id = pg_temp.fx('acct_a')), 25000, 'primary increase: threshold updated');
select is((select count(*) from public.events where type = 'threshold.changed' and owner_account_id = pg_temp.fx('acct_a')), 2::bigint, 'threshold.changed emitted for each applied change');

-- the timer applies an expired pending increase
select pg_temp.login(pg_temp.fx('rob'));
set local role authenticated;
select is((public.set_approval_threshold(pg_temp.fx('acct_a'), 40000)) ->> 'applied', 'false', 'second non-primary increase: pending again');
reset role;
update public.owner_accounts set threshold_pending_until = now() - interval '1 minute' where id = pg_temp.fx('acct_a');
select is(private.apply_pending_thresholds(pg_temp.fx('acct_a')), 1, 'apply_pending_thresholds: applies one expired change');
select is((select approval_threshold_cents from public.owner_accounts where id = pg_temp.fx('acct_a')), 40000, 'apply_pending_thresholds: threshold now 40000');

-- an owner of another account, or a read_only member, cannot set the threshold
select pg_temp.login(pg_temp.fx('mia'));
set local role authenticated;
select throws_ok($$select public.set_approval_threshold('$$ || pg_temp.fx('acct_a') || $$', 100)$$, '42501', null, 'another account''s owner cannot set the threshold');
reset role;
update public.memberships set status = 'read_only' where user_id = pg_temp.fx('rob');
select pg_temp.login(pg_temp.fx('rob'));
set local role authenticated;
select throws_ok($$select public.set_approval_threshold('$$ || pg_temp.fx('acct_a') || $$', 100)$$, '42501', null, 'a read_only member cannot set the threshold');
select is((select count(*) from public.owner_accounts where id = pg_temp.fx('acct_a')), 1::bigint, 'a read_only member still reads the account');
reset role;
select pg_temp.logout();
select throws_ok($$select public.set_approval_threshold('$$ || pg_temp.fx('acct_a') || $$', 100)$$, '42501', null, 'no session: not signed in');

-- ------------------------------------------------------------ set_contact_preferences
select pg_temp.login(pg_temp.fx('jane'));
set local role authenticated;
select lives_ok($$select public.set_contact_preferences('$$ || pg_temp.fx('acct_a') || $$', 'email', 'quarterly', array['evenings'])$$, 'set_contact_preferences: owner member');
reset role;
select is((select contact_method::text || '/' || contact_cadence::text from public.owner_accounts where id = pg_temp.fx('acct_a')), 'email/quarterly', 'set_contact_preferences: columns updated');

-- ------------------------------------------------------------ add_member / confirm_member / end_membership
select pg_temp.login(pg_temp.fx('jane'));
set local role authenticated;
select throws_ok($$select public.add_member('$$ || pg_temp.fx('rob') || $$', 'manager')$$, '42501', null, 'add_member: an owner is refused');
reset role;

-- fresh people for Court to add (created as postgres; Nia already has an invited row)
select set_config('tw.new_owner', pg_temp.mk_user('new-owner@owners.test', 'Ned Owner', 'Ned')::text, true);
select set_config('tw.new_mgr', pg_temp.mk_user('new-mgr@tidewell.test', 'Max Manager', 'Max')::text, true);
select pg_temp.login(pg_temp.fx('court'), 'aal2');
set local role authenticated;
select throws_ok($$select public.add_member('$$ || pg_temp.fx('jane') || $$', 'owner', '$$ || pg_temp.fx('acct_a') || $$')$$, '23505', null, 'add_member: duplicate grants are refused by the unique constraint');
select lives_ok($$select public.add_member('$$ || current_setting('tw.new_owner') || $$', 'owner', '$$ || pg_temp.fx('acct_b') || $$')$$, 'add_member: manager adds an owner member');
select lives_ok($$select public.add_member('$$ || current_setting('tw.new_mgr') || $$', 'manager')$$, 'add_member: manager invites a manager');
reset role;
select is((select status::text from public.memberships where user_id = current_setting('tw.new_mgr')::uuid), 'invited', 'add_member: a new manager row is invited, not active');

-- the inviting manager cannot confirm; a different manager can
select pg_temp.login(pg_temp.fx('court'), 'aal2');
set local role authenticated;
select lives_ok($$select public.confirm_member((select id from public.memberships where user_id = '$$ || current_setting('tw.new_mgr') || $$'))$$, 'confirm_member: a different manager confirms');
reset role;
select is((select status::text from public.memberships where user_id = current_setting('tw.new_mgr')::uuid), 'active', 'confirm_member: row now active');

-- a manager cannot confirm themselves (Nia at aal2 with only an invited row is not a manager; Sam inviting and confirming is the real case)
select pg_temp.login(pg_temp.fx('sam'), 'aal2');
set local role authenticated;
select throws_ok($$select public.confirm_member((select id from public.memberships where user_id = '$$ || pg_temp.fx('sam') || $$'))$$, '23514', null, 'confirm_member: refuses a non-invited row');
reset role;

-- end_membership deletes the person's sessions
insert into auth.sessions (id, user_id, created_at, updated_at, aal) values (gen_random_uuid(), pg_temp.fx('rob'), now(), now(), 'aal1');
select pg_temp.login(pg_temp.fx('court'), 'aal2');
set local role authenticated;
select lives_ok($$select public.end_membership((select id from public.memberships where user_id = '$$ || pg_temp.fx('rob') || $$'))$$, 'end_membership: manager ends Rob');
reset role;
select is((select count(*) from auth.sessions where user_id = pg_temp.fx('rob')), 0::bigint, 'end_membership: auth.sessions rows deleted');
select is((select status::text from public.memberships where user_id = pg_temp.fx('rob')), 'ended', 'end_membership: status ended');

select * from finish();
rollback;
