-- Immutability triggers, the app.rpc guard, the outbox secret guard, the event emitter's
-- catalogue and whitelist, the secret lint, and the membership two-person rule.
begin;
\ir fixture.inc
select pg_temp.seed_world();
select plan(22);

-- events are immutable for every role, including postgres and the secret key
select throws_ok($$update public.events set payload = '{}' where owner_account_id = pg_temp.fx('acct_a')$$, '42501', null, 'events: update refused for postgres');
select throws_ok($$delete from public.events where owner_account_id = pg_temp.fx('acct_a')$$, '42501', null, 'events: delete refused for postgres');
set local role service_role;
select throws_ok($$update public.events set payload = '{}' where owner_account_id = pg_temp.fx('acct_a')$$, '42501', null, 'events: update refused for service_role');
select throws_ok($$delete from public.events where owner_account_id = pg_temp.fx('acct_a')$$, '42501', null, 'events: delete refused for service_role');
select throws_ok('insert into public.events (entity_type, type) values (''lead'', ''lead.received'')', '42501', null, 'events: service_role cannot insert directly');
reset role;

-- disclosure_acknowledgements are append-only
select throws_ok($$update public.disclosure_acknowledgements set version = 'x' where agreement_id = pg_temp.fx('agr_a')$$, '42501', null, 'disclosure_acknowledgements: update refused');
select throws_ok($$delete from public.disclosure_acknowledgements where agreement_id = pg_temp.fx('agr_a')$$, '42501', null, 'disclosure_acknowledgements: delete refused');

-- documents: only downloaded_at and resent_at move
select lives_ok($$update public.documents set downloaded_at = now() where owner_account_id = pg_temp.fx('acct_a')$$, 'documents: downloaded_at may change');
select throws_ok($$update public.documents set storage_path = 'elsewhere' where owner_account_id = pg_temp.fx('acct_a')$$, '42501', null, 'documents: storage_path is immutable');
select throws_ok($$delete from public.documents where owner_account_id = pg_temp.fx('acct_a')$$, '42501', null, 'documents: delete refused');

-- outbox: the app.rpc guard
select throws_ok($$update public.outbox set status = 'sent' where recipient_user_id = pg_temp.fx('jane')$$, '42501', null, 'outbox: update refused without app.rpc');
select lives_ok($$select set_config('app.rpc', 'outbox_worker', true); update public.outbox set attempts = attempts + 1 where recipient_user_id = pg_temp.fx('jane')$$, 'outbox: update allowed inside a named RPC');
select set_config('app.rpc', '', true);
select throws_ok($$insert into public.outbox (event_id, priority, recipient_kind, recipient_user_id, channel, dedupe_key, payload)
  values ((select min(id) from public.events), 2, 'user', pg_temp.fx('jane'), 'push', 'x', '{"door_code":"1234"}')$$, '23514', null, 'outbox: a door_code payload key is refused');

-- emit_event: the closed catalogue and the per-type whitelist
select throws_ok($$select private.emit_event('lead', null, 'lead.exploded')$$, '23514', null, 'emit_event: unknown type refused');
select throws_ok($$select private.emit_event('owner_account', pg_temp.fx('acct_a'), 'threshold.changed', null, pg_temp.fx('acct_a'), '{owner}', '{"email":"x@y.test"}')$$, '23514', null, 'emit_event: email key refused on an owner-audience event');
select throws_ok($$select private.emit_event('owner_account', pg_temp.fx('acct_a'), 'threshold.changed', null, pg_temp.fx('acct_a'), '{owner}', '{"note":"the pin is 4321"}')$$, '23514', null, 'emit_event: a key outside the whitelist is refused');
select set_config('tw.ev', private.emit_event('membership', gen_random_uuid(), 'membership.invited', null, null, '{owner}', '{}')::text, true);
select is((select audience from public.events where id = current_setting('tw.ev')::bigint), '{internal}'::text[], 'emit_event: internal-only types are forced internal');

-- the secret lint
select throws_ok($$select private.lint_secret_text('keybox code 2468 by the door')$$, '23514', null, 'lint: "code 2468" refused');
select throws_ok($$select private.lint_secret_text('ask for the password')$$, '23514', null, 'lint: the word password refused');
select is(private.lint_secret_text('ABN 12345678901 on the invoice'), 'ABN 12345678901 on the invoice', 'lint: an 11-digit run passes (not 4 to 8)');
select is(private.lint_secret_text('ring 0412 345 678', 'phone number in crew note'), 'ring 0412 345 678', 'lint: digits pass with an allow_digits_reason');

-- memberships: the two-person rule under a session
select pg_temp.login(pg_temp.fx('court'), 'aal2');
select throws_ok($$insert into public.memberships (user_id, role, status) values (pg_temp.fx('newmgr'), 'manager', 'active')$$, '42501', null, 'memberships: a manager row cannot be activated outside confirm_member()');
reset role;
select pg_temp.logout();

select * from finish();
rollback;
