-- Planted HQ: the automatic thank-you to the enquirer (migrations 0136, 0137).
-- Privileges (begin/finish for service_role only; refused inside for a session), the switch, the
-- status machine (double-begin refused, finish only once), the 24-hour per-address limit at its
-- boundary, the global hourly cap at its boundary, no thank-you for a duplicate, a spam-marked, an old
-- or an odd-address enquiry, the timeline entry and the audit trail (System, no address), mark_enquiry_spam
-- archiving the thank-you's timeline entry with the lead, and RLS (no direct writes; who can read it).
--
-- Runs on an unseeded database (the CI job resets from scratch). As in hq_13: never CALL a function a
-- role lacks execute on as authenticated; that is asserted from pg_proc. anon calls are safe (no usage
-- on schema hq).
begin;
\ir hq_fixture.inc
select pg_temp.seed_hq();
select plan(95);

create temp table zz_r (k text primary key, v jsonb) on commit drop;
grant select, insert, update on zz_r to public;
create function pg_temp.r(p_k text, p_f text) returns text language sql stable as $$ select v ->> p_f from zz_r where k = p_k $$;
create function pg_temp.eid(p_k text) returns uuid language sql stable as $$ select (v ->> 'enquiry_id')::uuid from zz_r where k = p_k $$;
grant execute on function pg_temp.r(text, text), pg_temp.eid(text) to public;

-- The website's calls, as service_role (the secret key) with no session.
create function pg_temp.submit(p_k text, p_name text, p_email text, p_message text) returns jsonb
language plpgsql as $$
declare
  v jsonb;
begin
  perform pg_temp.become_service();
  v := hq.submit_enquiry('contact'::hq.enquiry_kind, p_name, p_email, null, null, p_message, '{"enquiryType": "General Enquiry"}'::jsonb, '/contact', null);
  execute 'reset role';
  insert into zz_r values (p_k, v) on conflict (k) do update set v = excluded.v;
  return v;
end $$;
create function pg_temp.begin_ack(p_k text, p_id uuid) returns jsonb
language plpgsql as $$
declare
  v jsonb;
begin
  perform pg_temp.become_service();
  v := hq.begin_enquiry_auto_reply(p_id);
  execute 'reset role';
  insert into zz_r values (p_k, v) on conflict (k) do update set v = excluded.v;
  return v;
end $$;
create function pg_temp.finish_ack(p_id uuid, p_ok boolean, p_msg text default null, p_err text default null) returns jsonb
language plpgsql as $$
declare
  v jsonb;
begin
  perform pg_temp.become_service();
  v := hq.finish_enquiry_auto_reply(p_id, p_ok, p_msg, p_err);
  execute 'reset role';
  return v;
end $$;
create function pg_temp.ack(p_id uuid) returns text language sql stable as $$ select auto_reply_status::text from hq.enquiries where id = p_id $$;
create function pg_temp.why(p_id uuid) returns text language sql stable as $$ select auto_reply_reason from hq.enquiries where id = p_id $$;
-- Move a thank-you (or an arrival) back in time: the guards keep both fixed for every writer, so they are switched off for this.
create function pg_temp.age_ack(p_id uuid, p_at timestamptz) returns void language plpgsql as $$
begin
  alter table hq.enquiries disable trigger enquiry_auto_reply_guard;
  update hq.enquiries set auto_reply_at = p_at where id = p_id;
  alter table hq.enquiries enable trigger enquiry_auto_reply_guard;
end $$;
create function pg_temp.age_received(p_id uuid, p_by interval) returns void language plpgsql as $$
begin
  alter table hq.enquiries disable trigger enquiry_guard;
  update hq.enquiries set received_at = received_at - p_by where id = p_id;
  alter table hq.enquiries enable trigger enquiry_guard;
end $$;

-- Any thank-you already in this database is moved out of the last day, so the limits below are exact.
alter table hq.enquiries disable trigger enquiry_auto_reply_guard;
update hq.enquiries set auto_reply_at = auto_reply_at - interval '3 days' where auto_reply_at is not null;
alter table hq.enquiries enable trigger enquiry_auto_reply_guard;
-- dir is the earliest-created director, and gets the enquiries.
alter table hq.staff_profiles disable trigger row_stamp;
update hq.staff_profiles set created_at = now() - interval '2 days' where id = pg_temp.fx('dir');
alter table hq.staff_profiles enable trigger row_stamp;
update hq.settings set value = 'null'::jsonb where key = 'enquiry_default_owner_id';
update hq.settings set value = 'true'::jsonb where key = 'enquiry_auto_reply_enabled';

-- ------------------------------------------------------------ structure and privileges
select columns_are('hq', 'enquiries', array['id', 'ref_number', 'kind', 'received_at', 'name', 'email', 'phone', 'suburb', 'message', 'details', 'source_page',
  'ip_hash', 'submission_hash', 'status', 'opportunity_id', 'contact_id', 'task_id', 'interaction_id', 'created_lead', 'created_contact', 'handled_by', 'handled_at',
  'spam_marked_by', 'spam_marked_at', 'status_note', 'updated_at',
  'auto_reply_status', 'auto_reply_at', 'auto_reply_message_id', 'auto_reply_reason', 'auto_reply_interaction_id']);
select enum_has_labels('hq', 'enquiry_auto_reply_status', array['none', 'sending', 'sent', 'failed', 'skipped']);
select col_default_is('hq', 'enquiries', 'auto_reply_status', 'none'::hq.enquiry_auto_reply_status, 'a new enquiry starts with no thank-you');
select is((select value from hq.settings where key = 'enquiry_auto_reply_enabled'), 'true'::jsonb, 'enquiry_auto_reply_enabled exists (default true)');
select throws_ok($$update hq.settings set value = '"yes"'::jsonb where key = 'enquiry_auto_reply_enabled'$$, '22023', 'enquiry_auto_reply_enabled must be true or false', 'the switch must be true or false');

select ok(has_function_privilege('service_role', 'hq.begin_enquiry_auto_reply(uuid)', 'execute'), 'service_role can execute begin_enquiry_auto_reply');
select ok(has_function_privilege('service_role', 'hq.finish_enquiry_auto_reply(uuid,boolean,text,text)', 'execute'), 'service_role can execute finish_enquiry_auto_reply');
select ok(not has_function_privilege('authenticated', 'hq.begin_enquiry_auto_reply(uuid)', 'execute'), 'authenticated cannot execute begin_enquiry_auto_reply');
select ok(not has_function_privilege('authenticated', 'hq.finish_enquiry_auto_reply(uuid,boolean,text,text)', 'execute'), 'authenticated cannot execute finish_enquiry_auto_reply');
select ok(not has_function_privilege('anon', 'hq.begin_enquiry_auto_reply(uuid)', 'execute') and not has_function_privilege('anon', 'hq.finish_enquiry_auto_reply(uuid,boolean,text,text)', 'execute'),
  'anon can execute neither');
select ok(not exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                      where p.oid in ('hq.begin_enquiry_auto_reply(uuid)'::regprocedure, 'hq.finish_enquiry_auto_reply(uuid,boolean,text,text)'::regprocedure) and a.grantee = 0),
  'public can execute neither');
select is((select count(*) from pg_proc p where p.oid in ('hq.begin_enquiry_auto_reply(uuid)'::regprocedure, 'hq.finish_enquiry_auto_reply(uuid,boolean,text,text)'::regprocedure)
            and p.prosecdef and p.proconfig::text like '%search_path=pg_catalog, public, extensions%'), 2::bigint, 'both are security definer with a pinned search_path');
select is((select count(*) from pg_proc p where p.pronamespace = 'hq_private'::regnamespace and (p.proname like 'enquiry_ack%' or p.proname = 'enquiry_auto_reply_guard')
            and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))),
  0::bigint, 'no API role can execute a thank-you helper');
select ok(has_function_privilege('authenticated', 'hq.mark_enquiry_spam(uuid,text)', 'execute') and not has_function_privilege('service_role', 'hq.mark_enquiry_spam(uuid,text)', 'execute'),
  'mark_enquiry_spam (replaced) keeps its privileges');

-- ------------------------------------------------------------ the first enquiry: one thank-you, recorded on the lead
select lives_ok($$select pg_temp.submit('a1', 'Jeff [test] Enquirer', 'Jeff@Ack.test', 'Hello, please call me about my unit.')$$, 'an enquiry arrives');
select is(pg_temp.ack(pg_temp.eid('a1')), 'none', '... with no thank-you yet');

select pg_temp.become_anon();
select throws_ok($$select hq.begin_enquiry_auto_reply('00000000-0000-0000-0000-000000000000')$$, '42501', null, 'anon cannot begin a thank-you');
select pg_temp.unbecome();
select pg_temp.login(pg_temp.fx('dir'));
select throws_ok(format('select hq.begin_enquiry_auto_reply(%L)', pg_temp.eid('a1')), '42501', null, 'a call carrying a person''s session is refused inside begin');
select throws_ok(format('select hq.finish_enquiry_auto_reply(%L, true)', pg_temp.eid('a1')), '42501', null, '... and inside finish');
select pg_temp.logout();
select is(pg_temp.ack(pg_temp.eid('a1')), 'none', 'no forged call changed it');

select is((pg_temp.begin_ack('b1', pg_temp.eid('a1')) ->> 'send'), 'true', 'service_role begins the thank-you');
select is(pg_temp.r('b1', 'to'), 'jeff@ack.test', '... to the address as stored');
select is(pg_temp.r('b1', 'first_name'), 'Jeff', '... with the first word of the name (the server checks it before greeting by it)');
select is(pg_temp.r('b1', 'reply_to'), 'dir@hq.test', '... Reply-To the lead owner''s HQ address');
select is(pg_temp.r('b1', 'ref'), pg_temp.r('a1', 'ref'), '... and the ENQ ref');
select is(pg_temp.ack(pg_temp.eid('a1')), 'sending', 'the enquiry is flipped to sending (the guard)');
select is((pg_temp.begin_ack('b1x', pg_temp.eid('a1')) ->> 'reason'), 'already_started', 'a second begin is refused: already started');
select is(pg_temp.r('b1x', 'send'), 'false', '... and does not send');
select is(pg_temp.ack(pg_temp.eid('a1')), 'sending', '... and leaves it as it was');
select throws_ok($$select pg_temp.begin_ack('bad', '00000000-0000-0000-0000-000000000000')$$, 'P0002', null, 'an unknown enquiry is not found');

select is((pg_temp.finish_ack(pg_temp.eid('a1'), true, 'fake-msg.123') ->> 'status'), 'sent', 'finish records it as sent');
select is((select auto_reply_message_id from hq.enquiries where id = pg_temp.eid('a1')), 'fake-msg.123', '... with the provider''s message id');
select ok((select auto_reply_at > now() - interval '1 minute' from hq.enquiries where id = pg_temp.eid('a1')), '... and when');
select is((select interaction_type::text || ' / ' || summary from hq.interactions where id = (select auto_reply_interaction_id from hq.enquiries where id = pg_temp.eid('a1'))),
  'email / Automatic thank-you email sent to the enquirer', 'a timeline entry: type email, the plain summary');
select is((select opportunity_id from hq.interactions where id = (select auto_reply_interaction_id from hq.enquiries where id = pg_temp.eid('a1'))), (pg_temp.r('a1', 'opportunity_id'))::uuid,
  '... on the lead (a touch point on its timeline)');
select is((select contact_id from hq.interactions where id = (select auto_reply_interaction_id from hq.enquiries where id = pg_temp.eid('a1'))), (pg_temp.r('a1', 'contact_id'))::uuid, '... and the contact');
select is((select staff_id from hq.interactions where id = (select auto_reply_interaction_id from hq.enquiries where id = pg_temp.eid('a1'))), null::uuid, '... by nobody on staff (the system)');
select is((select count(*) from hq.audit_events where entity_type = 'enquiry' and entity_id = pg_temp.eid('a1') and action = 'auto_reply_sent' and actor_id is null and actor_name = 'System'),
  1::bigint, 'the send is audited with the system actor');
select is((select count(*) from hq.audit_events where action = 'create' and entity_id = (select auto_reply_interaction_id from hq.enquiries where id = pg_temp.eid('a1')) and actor_name = 'System'),
  1::bigint, '... and the timeline entry is audited as created by the system');
select throws_ok(format('select pg_temp.finish_ack(%L, true)', pg_temp.eid('a1')), '22023', 'this thank-you is not being sent', 'it cannot be finished twice');
select is((pg_temp.begin_ack('b1y', pg_temp.eid('a1')) ->> 'reason'), 'already_started', 'and once sent, a begin is refused');
select is((select count(*) from hq.interactions where opportunity_id = (pg_temp.r('a1', 'opportunity_id'))::uuid and interaction_type = 'email' and deleted_at is null), 1::bigint,
  'exactly one thank-you on the lead''s timeline');

-- the status machine holds for the table owner too
select throws_ok(format($$update hq.enquiries set auto_reply_status = 'none', auto_reply_at = null, auto_reply_message_id = null, auto_reply_interaction_id = null where id = %L$$, pg_temp.eid('a1')),
  '42501', null, 'a sent thank-you cannot be reset, even as the table owner');
select throws_ok(format($$update hq.enquiries set auto_reply_message_id = 'other' where id = %L$$, pg_temp.eid('a1')), '42501', null, '... nor its message id changed');

-- ------------------------------------------------------------ one per address per 24 hours (at the boundary)
select lives_ok($$select pg_temp.submit('a2', 'Jeff [test] Enquirer', 'jeff@ack.test', 'A second question, about fees.')$$, 'a second enquiry from the same address');
select is((pg_temp.begin_ack('b2', pg_temp.eid('a2')) ->> 'reason'), 'address_limit', '... gets no second thank-you within 24 hours');
select is(pg_temp.ack(pg_temp.eid('a2')) || ' / ' || pg_temp.why(pg_temp.eid('a2')), 'skipped / address_limit', '... recorded as skipped, with the reason');
select is((select count(*) from hq.audit_events where entity_id = pg_temp.eid('a2') and action = 'auto_reply_skipped' and actor_name = 'System'), 1::bigint, '... and audited');
select pg_temp.age_ack(pg_temp.eid('a1'), now() - interval '24 hours' + interval '1 second');
select lives_ok($$select pg_temp.submit('a3', 'Jeff [test] Enquirer', 'jeff@ack.test', 'A third question.')$$, 'another enquiry, 23:59:59 after the thank-you');
select is((pg_temp.begin_ack('b3', pg_temp.eid('a3')) ->> 'reason'), 'address_limit', '... is still inside the 24 hours');
select pg_temp.age_ack(pg_temp.eid('a1'), now() - interval '24 hours');
select lives_ok($$select pg_temp.submit('a4', 'Jeff [test] Enquirer', 'jeff@ack.test', 'A fourth question.')$$, 'another enquiry, exactly 24 hours after the thank-you');
select is((pg_temp.begin_ack('b4', pg_temp.eid('a4')) ->> 'send'), 'true', '... may have a thank-you again');
select lives_ok($$select pg_temp.submit('a5', 'Jeff [test] Enquirer', 'JEFF@ack.test', 'A fifth question.')$$, 'one more while that one is still sending (any letter case)');
select is((pg_temp.begin_ack('b5', pg_temp.eid('a5')) ->> 'reason'), 'address_limit', '... a thank-you being sent counts too');

-- ------------------------------------------------------------ a failed send
select lives_ok($$select pg_temp.submit('f1', 'Fay [test] Fail', 'fay@ack.test', 'Hello there.')$$, 'an enquiry whose thank-you will fail');
select is((pg_temp.begin_ack('bf1', pg_temp.eid('f1')) ->> 'send'), 'true', '... is begun');
select is((pg_temp.finish_ack(pg_temp.eid('f1'), false, null, 'timeout') ->> 'status'), 'failed', 'a provider failure is recorded as failed');
select is(pg_temp.why(pg_temp.eid('f1')), 'timeout', '... with its short code');
select is((select auto_reply_interaction_id from hq.enquiries where id = pg_temp.eid('f1')), null::uuid, '... and no timeline entry');
select is((select count(*) from hq.audit_events where entity_id = pg_temp.eid('f1') and action = 'auto_reply_failed' and actor_name = 'System'), 1::bigint, '... audited');
select lives_ok($$select pg_temp.submit('f2', 'Fay [test] Fail', 'fay@ack.test', 'Did you get my message?')$$, 'the same address again');
select is((pg_temp.begin_ack('bf2', pg_temp.eid('f2')) ->> 'reason'), 'address_limit', '... a failure counts for the day (a timeout may have been delivered)');
select lives_ok($$select pg_temp.submit('f3', 'Gus [test] Code', 'gus@ack.test', 'Hello.')$$, 'another enquiry');
select lives_ok(format('select pg_temp.begin_ack(%L, %L)', 'bf3', pg_temp.eid('f3')), '... begun');
select is((pg_temp.finish_ack(pg_temp.eid('f3'), false, null, 'Bad Code! <x>') ->> 'status'), 'failed', '... and fails with an odd error code');
select is(pg_temp.why(pg_temp.eid('f3')), 'provider_error', '... which is stored as provider_error');

-- ------------------------------------------------------------ never for these
-- the switch off
update hq.settings set value = 'false'::jsonb where key = 'enquiry_auto_reply_enabled';
select lives_ok($$select pg_temp.submit('s1', 'Sid [test] Switch', 'sid@ack.test', 'Hello.')$$, 'an enquiry while the switch is off');
select is((pg_temp.begin_ack('bs1', pg_temp.eid('s1')) ->> 'reason'), 'disabled', '... gets no thank-you');
select is(pg_temp.ack(pg_temp.eid('s1')), 'skipped', '... recorded as skipped');
update hq.settings set value = 'true'::jsonb where key = 'enquiry_auto_reply_enabled';
select is((pg_temp.begin_ack('bs1b', pg_temp.eid('s1')) ->> 'reason'), 'already_started', 'switching it back on later does not send it after all');

-- a duplicate (double tap) returns the stored enquiry, whose thank-you is already decided
select lives_ok($$select pg_temp.submit('d1', 'Dee [test] Double', 'dee@ack.test', 'Just the once, please.')$$, 'an enquiry');
select lives_ok(format('select pg_temp.begin_ack(%L, %L)', 'bd1', pg_temp.eid('d1')), '... its thank-you begun');
select lives_ok(format('select pg_temp.finish_ack(%L, true, %L)', pg_temp.eid('d1'), 'fake-d1'), '... and sent');
select is((pg_temp.submit('d1b', 'Dee [test] Double', 'dee@ack.test', 'Just the once, please.') ->> 'duplicate'), 'true', 'the same submission again is a duplicate');
select is((pg_temp.begin_ack('bd1b', pg_temp.eid('d1b')) ->> 'reason'), 'already_started', '... and gets no second thank-you');

-- spam
select lives_ok($$select pg_temp.submit('sp1', 'Spam [test] Bot', 'spam@ack.test', 'Buy now.')$$, 'an enquiry marked as spam before the thank-you');
select pg_temp.become('dir');
select lives_ok(format('select hq.mark_enquiry_spam(%L)', pg_temp.eid('sp1')), '... (by a director)');
select pg_temp.unbecome();
select is((pg_temp.begin_ack('bsp1', pg_temp.eid('sp1')) ->> 'reason'), 'not_new', '... gets no thank-you');

-- old, and an odd address
select lives_ok($$select pg_temp.submit('o1', 'Old [test] Timer', 'old@ack.test', 'Hello.')$$, 'an enquiry from more than an hour ago');
select pg_temp.age_received(pg_temp.eid('o1'), interval '61 minutes');
select is((pg_temp.begin_ack('bo1', pg_temp.eid('o1')) ->> 'reason'), 'too_old', '... gets no late thank-you');
select lives_ok($$select pg_temp.submit('x1', 'Odd [test] Address', 'odd..dots@ack.test', 'Hello.')$$, 'an enquiry with an address HQ stores but would not write to');
select is((pg_temp.begin_ack('bx1', pg_temp.eid('x1')) ->> 'reason'), 'invalid_address', '... gets no thank-you');
select ok(not hq_private.enquiry_ack_address_ok('someone@host.c0m') and not hq_private.enquiry_ack_address_ok('a@b') and hq_private.enquiry_ack_address_ok('jo.o''neil+x@mail.example.com.au'),
  'the address check: a letters-only top-level label, a dotted domain, ordinary characters');

-- ------------------------------------------------------------ marking spam afterwards archives the thank-you's timeline entry with the lead
select pg_temp.become('dir');
select is((select (hq.mark_enquiry_spam(pg_temp.eid('d1')) ->> 'lead_archived')), 'true', 'an untouched lead whose enquiry was thanked is still archived as spam');
select pg_temp.unbecome();
select ok((select deleted_at is not null from hq.interactions where id = (select auto_reply_interaction_id from hq.enquiries where id = pg_temp.eid('d1'))), '... with the thank-you''s timeline entry');

-- ------------------------------------------------------------ the global hourly cap (at the boundary)
alter table hq.enquiries disable trigger enquiry_auto_reply_guard;
update hq.enquiries set auto_reply_at = auto_reply_at - interval '2 hours' where auto_reply_at is not null;
alter table hq.enquiries enable trigger enquiry_auto_reply_guard;
select lives_ok($$select pg_temp.submit('cap' || g, 'Cap [test] ' || g, 'cap' || g || '@ack.test', 'Hello ' || g) from generate_series(1, 31) g$$, '31 enquiries from 31 addresses');
select is((select count(*) from generate_series(1, 30) g where (pg_temp.begin_ack('bcap' || g, pg_temp.eid('cap' || g)) ->> 'send') = 'true'), 30::bigint, 'thirty thank-yous in an hour may go');
select is((pg_temp.begin_ack('bcap31', pg_temp.eid('cap31')) ->> 'reason'), 'hourly_cap', 'the thirty-first in the hour is refused');
select pg_temp.age_ack(pg_temp.eid('cap1'), now() - interval '1 hour');
select lives_ok($$select pg_temp.submit('cap32', 'Cap [test] 32', 'cap32@ack.test', 'Hello 32')$$, 'once one of them is an hour old');
select is((pg_temp.begin_ack('bcap32', pg_temp.eid('cap32')) ->> 'send'), 'true', '... the next may go');

-- ------------------------------------------------------------ privacy, RLS and who sees it
select is((select count(*) from hq.audit_events where action like 'auto_reply%' and (summary ilike '%@ack.test%' or changes::text ilike '%@ack.test%')), 0::bigint,
  'no thank-you audit event carries an address');
select pg_temp.become('dir');
select throws_ok(format($$update hq.enquiries set auto_reply_status = 'skipped' where id = %L$$, pg_temp.eid('cap31')), '42501', null, 'a director cannot write the thank-you record directly');
select pg_temp.unbecome();
select pg_temp.become_service();
select throws_ok(format($$update hq.enquiries set auto_reply_status = 'skipped' where id = %L$$, pg_temp.eid('cap31')), '42501', null, 'nor can service_role (only through the two functions)');
select pg_temp.unbecome();
select pg_temp.become('ro');
select is((select auto_reply_status::text from hq.enquiry_overview where id = pg_temp.eid('a1')), 'sent', 'read-only (growth.read) sees the thank-you status in the overview');
select pg_temp.unbecome();
select pg_temp.become('jpm');
select is((select count(*) from hq.enquiry_overview), 0::bigint, 'a junior property manager (no growth.read) sees no enquiry or thank-you');
select pg_temp.unbecome();

select * from finish();
rollback;
