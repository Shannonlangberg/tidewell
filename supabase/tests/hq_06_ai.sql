-- Planted HQ Phase 3 (docs/hq-phase-3.md, section 2): Ask Planted's database side. The ai.use
-- capability, the two settings, hq.ai_requests (structure, RLS, append-only apart from the one
-- finishing update), and ai_status / ai_begin_request / ai_finish_request: forged callers (anon, a
-- signed-in person with no HQ profile, read_only, an aal1 session, a deactivated person), the disabled
-- refusal, the hourly limit exactly at its boundary, finish-once and owner-only.
--
-- NOTE: never CALL a function a hint role (anon, authenticated, service_role) lacks execute on (the
-- local image's supautils permission hint segfaults). Execute privilege is read from pg_proc. Calls
-- as anon are safe: anon has no usage on schema hq, so the call is refused at the schema.
begin;
\ir hq_fixture.inc
select pg_temp.seed_hq();
select plan(139);

-- requests by a fixture person, read as postgres (not through RLS)
create function pg_temp.ai_rows(p_key text) returns bigint
language sql as $$ select count(*) from hq.ai_requests where staff_id = pg_temp.fx(p_key) $$;
-- the same, read by whoever the caller is (through RLS)
create function pg_temp.ai_visible(p_key text) returns bigint
language sql as $$ select count(*) from hq.ai_requests where staff_id = pg_temp.fx(p_key) $$;

-- ------------------------------------------------------------ structure
select has_table('hq', 'ai_requests', 'hq.ai_requests exists');
select columns_are('hq', 'ai_requests', array['id', 'staff_id', 'asked_at', 'question', 'tools_used', 'status', 'input_tokens', 'output_tokens', 'finished_at'],
  'ai_requests has exactly the section 2 columns');
select col_type_is('hq', 'ai_requests', 'tools_used', 'text[]', 'tools_used is text[]');
select col_type_is('hq', 'ai_requests', 'input_tokens', 'integer', 'input_tokens is integer');
select col_type_is('hq', 'ai_requests', 'output_tokens', 'integer', 'output_tokens is integer');
select fk_ok('hq', 'ai_requests', 'staff_id', 'hq', 'staff_profiles', 'id', 'staff_id references hq.staff_profiles');
select has_index('hq', 'ai_requests', 'ai_requests_staff_id_asked_at_idx', array['staff_id', 'asked_at'], 'the rate-limit lookup has an index (staff_id, asked_at)');
select ok((select c.relrowsecurity and c.relforcerowsecurity from pg_class c where c.oid = 'hq.ai_requests'::regclass), 'RLS is enabled and forced on ai_requests');
select policies_are('hq', 'ai_requests', array['ai_requests_select'], 'ai_requests: a select policy only (no insert, update or delete policy)');
select ok((select qual from pg_policies where schemaname = 'hq' and tablename = 'ai_requests' and policyname = 'ai_requests_select') ~ 'audit\.read.*auth\.uid',
  'ai_requests_select: audit.read sees all, otherwise only your own');
select table_privs_are('hq', 'ai_requests', 'authenticated', array['SELECT'], 'ai_requests: authenticated can only select');
select table_privs_are('hq', 'ai_requests', 'service_role', array['SELECT'], 'ai_requests: service_role can only select');
select ok(not has_table_privilege('anon', 'hq.ai_requests', 'select,insert,update,delete,truncate'), 'anon holds no privilege on ai_requests');
select is((select count(*) from pg_trigger where tgrelid = 'hq.ai_requests'::regclass and not tgisinternal), 2::bigint,
  'ai_requests carries the two append-only triggers (row update/delete guard, truncate)');

-- ------------------------------------------------------------ function privileges (from pg_proc)
create temp table zz_rpcs (sig regprocedure primary key) on commit drop;
insert into zz_rpcs values ('hq.ai_status()'), ('hq.ai_begin_request(text)'), ('hq.ai_finish_request(uuid, text[], text, integer, integer)');
select is((select count(*) from zz_rpcs), 3::bigint, 'the three Phase 3 RPCs exist with the documented signatures');
select function_returns('hq', 'ai_status', array[]::text[], 'jsonb', 'ai_status() returns jsonb');
select function_returns('hq', 'ai_begin_request', array['text'], 'uuid', 'ai_begin_request(text) returns uuid');
select function_returns('hq', 'ai_finish_request', array['uuid', 'text[]', 'text', 'integer', 'integer'], 'void', 'ai_finish_request(...) returns void');
select is((select count(*) from zz_rpcs where has_function_privilege('authenticated', sig, 'execute')), 3::bigint, 'authenticated can execute all three');
select is((select count(*) from zz_rpcs where has_function_privilege('anon', sig, 'execute')), 0::bigint, 'anon can execute none of them');
select is((select count(*) from zz_rpcs z join pg_proc p on p.oid = z.sig where p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)),
  0::bigint, 'public can execute none of them');
select is((select count(*) from zz_rpcs where has_function_privilege('service_role', sig, 'execute')), 0::bigint, 'service_role can execute none of them');
select is((select count(*) from zz_rpcs z join pg_proc p on p.oid = z.sig where p.prosecdef), 3::bigint, 'all three are security definer');
select is((select count(*) from zz_rpcs z join pg_proc p on p.oid = z.sig where p.proconfig::text like '%search_path=pg_catalog, public, extensions%'),
  3::bigint, 'all three pin search_path');
select is((select count(*) from pg_proc p where p.pronamespace = 'hq_private'::regnamespace
            and p.proname in ('ai_enabled', 'ai_hourly_limit', 'ai_used_this_hour', 'ai_request_guard')
            and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))),
  0::bigint, 'the Phase 3 hq_private helpers are not executable by any API role');
select is((select count(*) from pg_proc p where p.pronamespace = 'hq_private'::regnamespace
            and p.proname in ('ai_enabled', 'ai_hourly_limit', 'ai_used_this_hour', 'ai_request_guard')), 4::bigint, '... and all four exist');
select ok(not (select prosecdef from pg_proc where oid = 'hq_private.ai_request_guard()'::regprocedure), 'the append-only guard is not security definer');

-- ------------------------------------------------------------ the capability (every role except read_only)
select is((select array_agg(role::text order by role::text) from hq.role_capabilities where capability = 'ai.use'),
  array['administrator', 'business_development_manager', 'director', 'junior_property_manager', 'property_manager', 'senior_property_manager', 'virtual_assistant'],
  'ai.use is held by every role except read_only');
select is((select count(*) from hq.role_capabilities where role = 'read_only' and capability = 'ai.use'), 0::bigint, 'read_only has no ai.use row');
select pg_temp.become('jpm');
select is(hq.can('ai.use'), true, 'can(): a junior property manager holds ai.use');
select ok((hq.my_access() -> 'capabilities') ? 'ai.use', 'my_access(): ai.use is listed for a junior property manager');
select pg_temp.become('ro');
select is(hq.can('ai.use'), false, 'can(): read_only does not hold ai.use');
select pg_temp.unbecome();

-- ------------------------------------------------------------ settings (defaults, validation, who may change them)
select is((select value from hq.settings where key = 'ai_enabled'), 'false'::jsonb, 'setting ai_enabled defaults to false');
select is((select value from hq.settings where key = 'ai_hourly_limit'), '40'::jsonb, 'setting ai_hourly_limit defaults to 40');
select throws_ok($$update hq.settings set value = '"yes"'::jsonb where key = 'ai_enabled'$$, '22023', 'ai_enabled must be true or false', 'ai_enabled must be a boolean');
select throws_ok($$update hq.settings set value = '0'::jsonb where key = 'ai_hourly_limit'$$, '22023', 'ai_hourly_limit must be a whole number from 1 to 1000', 'the hourly limit is at least 1');
select throws_ok($$update hq.settings set value = '1001'::jsonb where key = 'ai_hourly_limit'$$, '22023', null, 'the hourly limit is at most 1000');
select throws_ok($$update hq.settings set value = '2.5'::jsonb where key = 'ai_hourly_limit'$$, '22023', null, 'the hourly limit is a whole number');
select throws_ok($$update hq.settings set value = '"40"'::jsonb where key = 'ai_hourly_limit'$$, '22023', null, 'the hourly limit is a JSON number, not a string');
select throws_ok($$update hq.settings set value = '-5'::jsonb where key = 'ai_hourly_limit'$$, '22023', null, 'the hourly limit cannot be negative');
select throws_ok($$update hq.settings set value = '400'::jsonb where key = 'contractor_expiry_warning_days'$$, '22023', null, 'the Phase 2 bounds still hold (warning window at most 365)');
select pg_temp.become('adm');
update hq.settings set value = 'true'::jsonb where key = 'ai_enabled';
select pg_temp.unbecome();
select is((select value from hq.settings where key = 'ai_enabled'), 'false'::jsonb, 'an administrator cannot switch Ask Planted on (settings.admin is a director capability)');
select pg_temp.become('dir');
select lives_ok($$update hq.settings set value = '1000'::jsonb where key = 'ai_hourly_limit'$$, 'a director can set the hourly limit (1000 accepted)');
select lives_ok($$update hq.settings set value = '40'::jsonb where key = 'ai_hourly_limit'$$, '... and set it back');
select pg_temp.unbecome();
select is((select count(*) from hq.audit_events where entity_type = 'setting' and actor_id = pg_temp.fx('dir') and summary like '%ai_hourly_limit%'), 2::bigint,
  'changes to the Ask Planted settings are audited with the director as actor');

-- ------------------------------------------------------------ forged callers: anon
select pg_temp.become_anon();
select throws_ok('select hq.ai_status()', '42501', null, 'anon cannot call ai_status');
select throws_ok($$select hq.ai_begin_request('hello')$$, '42501', null, 'anon cannot call ai_begin_request');
select throws_ok($$select hq.ai_finish_request(gen_random_uuid(), null, 'answered', 1, 1)$$, '42501', null, 'anon cannot call ai_finish_request');
select throws_ok('select 1 from hq.ai_requests', '42501', null, 'anon is denied on hq.ai_requests');
select pg_temp.unbecome();

-- switch it on for the forged-caller tests, so a refusal is about the caller, not the setting
update hq.settings set value = 'true'::jsonb where key = 'ai_enabled';

-- ------------------------------------------------------------ forged callers: signed in, no HQ profile
select pg_temp.become('outsider');
select throws_ok('select hq.ai_status()', '42501', 'permission denied', 'non-staff cannot call ai_status');
select throws_ok($$select hq.ai_begin_request('hello')$$, '42501', 'permission denied', 'non-staff cannot begin a request');
select throws_ok($$select hq.ai_finish_request(gen_random_uuid(), null, 'answered', 1, 1)$$, '42501', 'permission denied', 'non-staff cannot finish a request');
select throws_ok($$insert into hq.ai_requests (staff_id, question) values (auth.uid(), 'forged')$$, '42501', null, 'non-staff cannot insert into ai_requests');
select pg_temp.unbecome();
select is((select count(*) from hq.ai_requests where staff_id = pg_temp.fx('outsider')), 0::bigint, 'nothing was logged for the outsider');

-- ------------------------------------------------------------ forged callers: read_only (no ai.use)
select pg_temp.become('ro');
select throws_ok('select hq.ai_status()', '42501', 'permission denied', 'read_only cannot call ai_status');
select throws_ok($$select hq.ai_begin_request('hello')$$, '42501', 'permission denied', 'read_only cannot begin a request');
select throws_ok($$select hq.ai_finish_request(gen_random_uuid(), null, 'answered', 1, 1)$$, '42501', 'permission denied', 'read_only cannot finish a request');
select pg_temp.unbecome();
select is(pg_temp.ai_rows('ro'), 0::bigint, 'nothing was logged for read_only');

-- ------------------------------------------------------------ forged callers: aal1 with require_mfa, a deactivated person
select pg_temp.become('dir', 'aal1');
select throws_ok('select hq.ai_status()', '42501', 'permission denied', 'aal1 with require_mfa: ai_status is refused');
select throws_ok($$select hq.ai_begin_request('hello')$$, '42501', 'permission denied', 'aal1 with require_mfa: ai_begin_request is refused');
select pg_temp.unbecome();
update hq.staff_profiles set is_active = false where id = pg_temp.fx('spm');
select pg_temp.become('spm');
select throws_ok($$select hq.ai_begin_request('hello')$$, '42501', 'permission denied', 'a deactivated person cannot begin a request, whatever their token says');
select pg_temp.unbecome();
update hq.staff_profiles set is_active = true where id = pg_temp.fx('spm');
select is(pg_temp.ai_rows('dir') + pg_temp.ai_rows('spm'), 0::bigint, 'nothing was logged for the refused sessions');

-- ------------------------------------------------------------ disabled: a plain refusal, nothing stored
update hq.settings set value = 'false'::jsonb where key = 'ai_enabled';
select pg_temp.become('jpm');
select is(hq.ai_status(), '{"enabled": false, "hourly_limit": 40, "remaining": 40}'::jsonb, 'ai_status when off: {enabled false, hourly_limit 40, remaining 40}');
select throws_ok($$select hq.ai_begin_request('Which contractors are waiting for approval?')$$, '55000', 'Ask Planted is switched off', 'switched off: ai_begin_request raises 55000');
select pg_temp.unbecome();
select is(pg_temp.ai_rows('jpm'), 0::bigint, 'switched off: no row is stored');
delete from hq.settings where key = 'ai_enabled';
select pg_temp.become('jpm');
select is(hq.ai_status() -> 'enabled', 'false'::jsonb, 'a missing ai_enabled setting means off');
select throws_ok($$select hq.ai_begin_request('hello')$$, '55000', 'Ask Planted is switched off', 'a missing ai_enabled setting refuses requests');
select pg_temp.unbecome();
insert into hq.settings (key, value) values ('ai_enabled', 'true'::jsonb);

-- ------------------------------------------------------------ enabled: begin
select pg_temp.become('jpm');
select is(hq.ai_status(), '{"enabled": true, "hourly_limit": 40, "remaining": 40}'::jsonb, 'ai_status when on: {enabled true, hourly_limit 40, remaining 40}');
insert into fx values ('q_jpm', hq.ai_begin_request('  Whose insurance expires in the next 30 days?  '));
select ok(pg_temp.fx('q_jpm') is not null, 'ai_begin_request returns the new request id');
select is((select row(staff_id, question, status, tools_used, input_tokens, output_tokens, finished_at)::text from hq.ai_requests where id = pg_temp.fx('q_jpm')),
  row(pg_temp.fx('jpm'), 'Whose insurance expires in the next 30 days?', 'started', '{}'::text[], null::integer, null::integer, null::timestamptz)::text,
  'the row is the caller''s, started, with the question trimmed and nothing else filled in');
select is(hq.ai_status() -> 'remaining', '39'::jsonb, 'remaining counts the new request');
select throws_ok($$select hq.ai_begin_request('   ')$$, '22023', 'a question is required', 'a blank question is refused');
select throws_ok($$select hq.ai_begin_request(null)$$, '22023', 'a question is required', 'a null question is refused');
select throws_ok(format('select hq.ai_begin_request(%L)', repeat('x', 2001)), '22023', 'a question is at most 2000 characters', 'a 2001-character question is refused');
select lives_ok(format('insert into fx values (%L, hq.ai_begin_request(%L))', 'q_long', repeat('x', 2000)), 'a 2000-character question is accepted');
select is((select char_length(question) from hq.ai_requests where id = pg_temp.fx('q_long')), 2000, '... and stored whole');
select pg_temp.unbecome();
select is((select count(*) from hq.audit_events where action = 'ai_begin' and entity_type = 'ai_request' and entity_id = pg_temp.fx('q_jpm') and actor_id = pg_temp.fx('jpm')),
  1::bigint, 'beginning a request writes one audit event (ai_begin) with the person as actor');
select ok((select changes::text || summary from hq.audit_events where action = 'ai_begin' and entity_id = pg_temp.fx('q_jpm')) not like '%insurance%',
  'the audit event does not copy the question text');
select is(pg_temp.ai_rows('jpm'), 2::bigint, 'refused questions stored nothing (two rows for the two accepted ones)');

-- ------------------------------------------------------------ the hourly limit, exactly at its boundary
update hq.settings set value = '3'::jsonb where key = 'ai_hourly_limit';
select pg_temp.become('pm');
select is(hq.ai_status(), '{"enabled": true, "hourly_limit": 3, "remaining": 3}'::jsonb, 'limit 3: three remaining before any request');
insert into fx values ('q_pm1', hq.ai_begin_request('first'));
insert into fx values ('q_pm2', hq.ai_begin_request('second'));
select is(hq.ai_status() -> 'remaining', '1'::jsonb, 'after two requests, one remains');
select lives_ok($$insert into fx values ('q_pm3', hq.ai_begin_request('third'))$$, 'the request that reaches the limit exactly (3 of 3) is accepted');
select is(hq.ai_status() -> 'remaining', '0'::jsonb, 'at the limit, none remains');
select throws_ok($$select hq.ai_begin_request('fourth')$$, '54000', 'hourly limit reached', 'one over the limit (4 of 3) is refused with 54000');
select pg_temp.unbecome();
select is(pg_temp.ai_rows('pm'), 3::bigint, 'the refused request stored nothing (three rows)');
select pg_temp.become('va');
select is(hq.ai_status() -> 'remaining', '3'::jsonb, 'the limit is per person: another person still has three');
select pg_temp.become('pm');
select lives_ok($$select hq.ai_finish_request(pg_temp.fx('q_pm1'), null, 'answered', 10, 5)$$, 'finishing a request ...');
select throws_ok($$select hq.ai_begin_request('fourth again')$$, '54000', 'hourly limit reached', '... does not give it back: finished requests count towards the limit');
select pg_temp.unbecome();
update hq.settings set value = '4'::jsonb where key = 'ai_hourly_limit';
select pg_temp.become('pm');
select is(hq.ai_status(), '{"enabled": true, "hourly_limit": 4, "remaining": 1}'::jsonb, 'raising the limit to 4 frees exactly one');
select lives_ok($$select hq.ai_begin_request('fourth, under the new limit')$$, 'the fourth request is accepted under the new limit');
select pg_temp.unbecome();

-- the window: a request begun exactly one hour ago no longer counts; one begun just inside the hour does
update hq.settings set value = '3'::jsonb where key = 'ai_hourly_limit';
insert into hq.ai_requests (staff_id, asked_at, question, status, finished_at)
select pg_temp.fx('bdm'), now() - interval '1 hour', 'older ' || g, 'answered', now() - interval '1 hour' from generate_series(1, 3) g;
select pg_temp.become('bdm');
select is(hq.ai_status() -> 'remaining', '3'::jsonb, 'requests begun exactly one hour ago are outside the rolling hour');
select pg_temp.unbecome();
insert into hq.ai_requests (staff_id, asked_at, question, status, finished_at)
values (pg_temp.fx('bdm'), now() - interval '59 minutes 59 seconds', 'just inside', 'answered', now() - interval '59 minutes');
select pg_temp.become('bdm');
select is(hq.ai_status() -> 'remaining', '2'::jsonb, 'a request begun 59:59 ago is inside the rolling hour');
select pg_temp.unbecome();
update hq.settings set value = '40'::jsonb where key = 'ai_hourly_limit';

-- ------------------------------------------------------------ finish: validation, owner-only, once
select pg_temp.become('va');
insert into fx values ('q_va', hq.ai_begin_request('Find approved plumbers who service Moonta'));
select throws_ok($$select hq.ai_finish_request(pg_temp.fx('q_pm2'), null, 'answered', 1, 1)$$, 'P0002', 'ai request not found', 'someone else''s request cannot be finished (not found)');
select throws_ok($$select hq.ai_finish_request(gen_random_uuid(), null, 'answered', 1, 1)$$, 'P0002', 'ai request not found', 'an unknown request cannot be finished');
select throws_ok($$select hq.ai_finish_request(pg_temp.fx('q_va'), null, 'started', 1, 1)$$, '22023', 'status must be answered, refused, error or rate_limited', 'started is not a final status');
select throws_ok($$select hq.ai_finish_request(pg_temp.fx('q_va'), null, 'bogus', 1, 1)$$, '22023', null, 'an unknown status is refused');
select throws_ok($$select hq.ai_finish_request(pg_temp.fx('q_va'), null, null, 1, 1)$$, '22023', null, 'a null status is refused');
select throws_ok($$select hq.ai_finish_request(pg_temp.fx('q_va'), array['Drop Table'], 'answered', 1, 1)$$, '22023', 'each tool name is lower-case letters, digits and underscores', 'a malformed tool name is refused');
select throws_ok($$select hq.ai_finish_request(pg_temp.fx('q_va'), array['search_contractors', null], 'answered', 1, 1)$$, '22023', null, 'a null tool name is refused');
select throws_ok($$select hq.ai_finish_request(pg_temp.fx('q_va'), array_fill('get_contact'::text, array[65]), 'answered', 1, 1)$$, '22023', 'at most 64 tool names', 'more than 64 tool names are refused');
select throws_ok($$select hq.ai_finish_request(pg_temp.fx('q_va'), null, 'answered', -1, 1)$$, '22023', 'token counts cannot be negative', 'negative input tokens are refused');
select throws_ok($$select hq.ai_finish_request(pg_temp.fx('q_va'), null, 'answered', 1, -1)$$, '22023', 'token counts cannot be negative', 'negative output tokens are refused');
select lives_ok($$select hq.ai_finish_request(pg_temp.fx('q_va'), array['search_contractors', 'get_contractor', 'search_contractors'], 'answered', 1200, 340)$$,
  'the owner finishes their request');
select pg_temp.unbecome();
select is((select row(status, tools_used, input_tokens, output_tokens, finished_at is not null)::text from hq.ai_requests where id = pg_temp.fx('q_va')),
  row('answered', array['search_contractors', 'get_contractor', 'search_contractors'], 1200, 340, true)::text,
  'finishing sets the status, the tools in call order, the token counts and finished_at');
select is((select status from hq.ai_requests where id = pg_temp.fx('q_pm2')), 'started', 'the other person''s request was not touched');
select pg_temp.become('va');
select throws_ok($$select hq.ai_finish_request(pg_temp.fx('q_va'), null, 'error', 1, 1)$$, '23514', 'this request is already finished', 'a request can be finished only once');
select pg_temp.unbecome();
select is((select status from hq.ai_requests where id = pg_temp.fx('q_va')), 'answered', '... and the first outcome stands');
select is((select count(*) from hq.audit_events where action = 'ai_finish' and entity_type = 'ai_request' and entity_id = pg_temp.fx('q_va') and actor_id = pg_temp.fx('va')),
  1::bigint, 'finishing writes one audit event (ai_finish) with the person as actor');

-- an administrator (audit.read) can see someone's request but still cannot finish it
select pg_temp.become('adm');
select throws_ok($$select hq.ai_finish_request(pg_temp.fx('q_pm2'), null, 'error', null, null)$$, 'P0002', 'ai request not found', 'audit.read does not make you the owner: an administrator cannot finish another person''s request');
select pg_temp.unbecome();

-- finishing still works after Ask Planted is switched off; every final status is accepted; null tokens and tools are allowed
update hq.settings set value = 'false'::jsonb where key = 'ai_enabled';
select pg_temp.become('pm');
select lives_ok($$select hq.ai_finish_request(pg_temp.fx('q_pm2'), null, 'rate_limited', null, null)$$, 'a started request can be finished after Ask Planted is switched off (rate_limited, no tokens)');
select lives_ok($$select hq.ai_finish_request(pg_temp.fx('q_pm3'), '{}', 'refused', 0, 0)$$, 'refused is a final status');
select pg_temp.unbecome();
select pg_temp.become('jpm');
select lives_ok($$select hq.ai_finish_request(pg_temp.fx('q_jpm'), null, 'error', 50, null)$$, 'error is a final status');
select pg_temp.unbecome();
select is((select row(status, tools_used, input_tokens, output_tokens)::text from hq.ai_requests where id = pg_temp.fx('q_pm2')),
  row('rate_limited', '{}'::text[], null::integer, null::integer)::text, 'null tools are stored as an empty list and unknown tokens as null');
update hq.settings set value = 'true'::jsonb where key = 'ai_enabled';

-- ------------------------------------------------------------ RLS: your own rows; audit.read sees all
select pg_temp.become('pm');
select is(pg_temp.ai_visible('pm'), 4::bigint, 'a person sees their own requests');
select is((select count(*) from hq.ai_requests where staff_id <> pg_temp.fx('pm')), 0::bigint, 'a person sees nobody else''s requests');
select pg_temp.become('va');
select is(pg_temp.ai_visible('pm'), 0::bigint, 'a virtual assistant cannot see a property manager''s requests');
select pg_temp.become('dir');
select is(pg_temp.ai_visible('pm') + pg_temp.ai_visible('va') + pg_temp.ai_visible('jpm') + pg_temp.ai_visible('bdm'), 11::bigint, 'a director (audit.read) sees everyone''s requests');
select pg_temp.become('adm');
select is(pg_temp.ai_visible('pm'), 4::bigint, 'an administrator (audit.read) sees everyone''s requests');
select pg_temp.become('ro');
select is((select count(*) from hq.ai_requests), 0::bigint, 'read_only (no ai.use, no audit.read) sees no request');
select pg_temp.become('pm', 'aal1');
select is((select count(*) from hq.ai_requests), 0::bigint, 'aal1 with require_mfa: not even your own requests are readable');
select pg_temp.become('outsider');
select is((select count(*) from hq.ai_requests), 0::bigint, 'non-staff see no request');
select pg_temp.unbecome();

-- ------------------------------------------------------------ no direct writes by the API
select pg_temp.become('pm');
select throws_ok($$insert into hq.ai_requests (staff_id, question) values (auth.uid(), 'direct')$$, '42501', null, 'staff cannot insert into ai_requests directly');
select throws_ok($$update hq.ai_requests set status = 'answered', finished_at = now() where id = pg_temp.fx('q_pm1')$$, '42501', null, 'staff cannot update ai_requests directly');
select throws_ok($$delete from hq.ai_requests where id = pg_temp.fx('q_pm1')$$, '42501', null, 'staff cannot delete from ai_requests');
select pg_temp.become('dir');
select throws_ok($$delete from hq.ai_requests$$, '42501', null, 'not even a director can delete from ai_requests');
select throws_ok($$update hq.ai_requests set question = 'changed'$$, '42501', null, 'not even a director can update ai_requests directly');
select pg_temp.unbecome();

-- ------------------------------------------------------------ append-only for every role, apart from the one finishing update
select throws_ok($$update hq.ai_requests set status = 'error' where id = pg_temp.fx('q_va')$$, '42501', null, 'a finished request cannot be changed, even as postgres');
select throws_ok($$update hq.ai_requests set input_tokens = 1 where id = pg_temp.fx('q_va')$$, '42501', null, 'a finished request''s token counts cannot be changed');
select pg_temp.become('jpm');
insert into fx values ('q_open', hq.ai_begin_request('still open'));
select pg_temp.unbecome();
select throws_ok($$update hq.ai_requests set question = 'rewritten' where id = pg_temp.fx('q_open')$$, '42501', null, 'the question cannot be rewritten, even as postgres');
select throws_ok($$update hq.ai_requests set input_tokens = 5 where id = pg_temp.fx('q_open')$$, '42501', null, 'an open request cannot be edited without finishing it');
select throws_ok($$update hq.ai_requests set staff_id = pg_temp.fx('dir'), status = 'answered', finished_at = now() where id = pg_temp.fx('q_open')$$, '42501', null, 'finishing cannot move the request to another person');
select throws_ok($$update hq.ai_requests set asked_at = now() - interval '2 hours', status = 'answered', finished_at = now() where id = pg_temp.fx('q_open')$$, '42501', null, 'finishing cannot back-date the request (the limit cannot be dodged)');
select throws_ok($$delete from hq.ai_requests where id = pg_temp.fx('q_open')$$, '42501', null, 'delete raises even as postgres');
select throws_ok($$truncate hq.ai_requests$$, '42501', null, 'truncate raises even as postgres');
select is((select status from hq.ai_requests where id = pg_temp.fx('q_open')), 'started', 'the open request is unchanged');
select throws_ok($$insert into hq.ai_requests (staff_id, question) values (pg_temp.fx('pm'), '   ')$$, '23514', null, 'the table itself refuses a blank question');
select throws_ok(format($$insert into hq.ai_requests (staff_id, question) values (pg_temp.fx('pm'), %L)$$, repeat('y', 2001)), '23514', null, 'the table itself refuses a question over 2000 characters');
select throws_ok($$insert into hq.ai_requests (staff_id, question, status) values (pg_temp.fx('pm'), 'q', 'answered')$$, '23514', null, 'a final status needs finished_at');
select throws_ok($$insert into hq.ai_requests (staff_id, question, status) values (pg_temp.fx('pm'), 'q', 'thinking')$$, '23514', null, 'the table refuses an unknown status');

select * from finish();
rollback;
