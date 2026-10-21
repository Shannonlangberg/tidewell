-- Planted HQ: the automatic thank-you for a brand-new enquirer and for one HQ already knows, and the
-- record of a thank-you that could not begin (migrations 0136, 0154, 0155).
-- A new address and an existing contact with an open lead (ENQ-0002's shape) are both thanked and the
-- outcome is recorded; fail_enquiry_auto_reply is service_role only, records none -> failed once
-- (not_begun or begin_timeout), leaves every other state alone, is audited as System, and such a
-- failure does not count toward the 24-hour per-address limit.
--
-- Runs on an unseeded database (the CI job resets from scratch). As in hq_14: never CALL a function a
-- role lacks execute on as authenticated; that is asserted from pg_proc.
begin;
\ir hq_fixture.inc
select pg_temp.seed_hq();
select plan(31);

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
create function pg_temp.fail_ack(p_id uuid, p_err text default null) returns jsonb
language plpgsql as $$
declare
  v jsonb;
begin
  perform pg_temp.become_service();
  v := hq.fail_enquiry_auto_reply(p_id, p_err);
  execute 'reset role';
  return v;
end $$;
create function pg_temp.ack(p_id uuid) returns text language sql stable as $$ select auto_reply_status::text from hq.enquiries where id = p_id $$;
create function pg_temp.why(p_id uuid) returns text language sql stable as $$ select auto_reply_reason from hq.enquiries where id = p_id $$;

-- Any thank-you already in this database is moved out of the last day, so the limits below are exact.
alter table hq.enquiries disable trigger enquiry_auto_reply_guard;
update hq.enquiries set auto_reply_at = auto_reply_at - interval '3 days' where auto_reply_at is not null;
alter table hq.enquiries enable trigger enquiry_auto_reply_guard;
update hq.settings set value = 'true'::jsonb where key = 'enquiry_auto_reply_enabled';

-- ------------------------------------------------------------ privileges
select ok(has_function_privilege('service_role', 'hq.fail_enquiry_auto_reply(uuid,text)', 'execute'), 'service_role can execute fail_enquiry_auto_reply');
select ok(not has_function_privilege('authenticated', 'hq.fail_enquiry_auto_reply(uuid,text)', 'execute')
      and not has_function_privilege('anon', 'hq.fail_enquiry_auto_reply(uuid,text)', 'execute'), 'authenticated and anon cannot');

-- ------------------------------------------------------------ a brand-new enquirer
select pg_temp.submit('new', '[test] Nora New', 'nora@new.test', 'Can you manage my house?');
select is(pg_temp.r('new', 'created_contact') || pg_temp.r('new', 'created_lead'), 'truetrue', 'a new address creates a contact and a lead');
select is(pg_temp.begin_ack('new_b', pg_temp.eid('new')) ->> 'send', 'true', '... and the thank-you may go');
select is(pg_temp.r('new_b', 'to'), 'nora@new.test', '... to the address typed');
select is(pg_temp.ack(pg_temp.eid('new')), 'sending', '... begun');
select is(pg_temp.finish_ack(pg_temp.eid('new'), true, 'sg-new.1') ->> 'status', 'sent', 'the provider accepted it: sent');
select is((select contact_id from hq.interactions where id = (select auto_reply_interaction_id from hq.enquiries where id = pg_temp.eid('new'))),
  (pg_temp.r('new', 'contact_id'))::uuid, '... with a timeline entry on the new contact');

-- ------------------------------------------------------------ an enquirer HQ already knows (a contact with an open lead, like ENQ-0002)
select pg_temp.become('bdm');
insert into zz_r select 'known_lead', hq.create_opportunity('[test] Kim Known', null, 'kim@known.test', 'Moonta', null, 'own_marketing', null, 'Call Kim', hq.today() + 3);
select pg_temp.unbecome();
create temp table zz_known as select c.id from hq.contacts c where c.email = 'kim@known.test' and c.deleted_at is null;
grant select on zz_known to public;
select is((select count(*) from zz_known), 1::bigint, 'the known enquirer is already a contact');
select pg_temp.submit('known', '[test] Kim Known', 'KIM@known.test', 'Following up on my appraisal');
select is(pg_temp.r('known', 'created_contact') || pg_temp.r('known', 'created_lead') || pg_temp.r('known', 'duplicate'), 'falsefalsefalse',
  'an enquiry from that address is new, but creates no contact and no lead');
select is((pg_temp.r('known', 'contact_id'))::uuid, (select id from zz_known), '... and is linked to the existing contact');
select is(pg_temp.begin_ack('known_b', pg_temp.eid('known')) ->> 'send', 'true', 'the thank-you may still go');
select is(lower(pg_temp.r('known_b', 'to')), 'kim@known.test', '... to the address typed');
select is(pg_temp.finish_ack(pg_temp.eid('known'), true, 'sg-known.1') ->> 'status', 'sent', '... and is recorded as sent');
select is((select opportunity_id from hq.interactions where id = (select auto_reply_interaction_id from hq.enquiries where id = pg_temp.eid('known'))),
  (pg_temp.r('known', 'opportunity_id'))::uuid, '... on the existing open lead');

-- the same address again within the day: the per-address limit still applies (a thank-you went)
select pg_temp.submit('known2', '[test] Kim Known', 'kim@known.test', 'One more thing');
select is(pg_temp.begin_ack('known2_b', pg_temp.eid('known2')) ->> 'reason', 'address_limit', 'a second enquiry from that address within 24 hours is not thanked again');

-- a failed send is recorded with its code
select pg_temp.submit('prov', '[test] Pat Provider', 'pat@provider.test', 'Hello');
select pg_temp.begin_ack('prov_b', pg_temp.eid('prov'));
select is(pg_temp.finish_ack(pg_temp.eid('prov'), false, null, 'provider_auth') ->> 'status', 'failed', 'a provider failure is recorded as failed');
select is(pg_temp.why(pg_temp.eid('prov')), 'provider_auth', '... with the provider''s code');

-- ------------------------------------------------------------ begin could not run: fail_enquiry_auto_reply
select pg_temp.submit('nb', '[test] Nell Notbegun', 'nell@notbegun.test', 'Hello');
select is(pg_temp.fail_ack(pg_temp.eid('nb'), 'not_begun') ->> 'changed', 'true', 'a thank-you that could not begin is recorded');
select is(pg_temp.ack(pg_temp.eid('nb')) || '/' || pg_temp.why(pg_temp.eid('nb')), 'failed/not_begun', '... as failed, not_begun');
select ok((select auto_reply_at is not null from hq.enquiries where id = pg_temp.eid('nb')), '... with when');
select is((select actor_name || ': ' || summary from hq.audit_events where entity_id = pg_temp.eid('nb') and action = 'auto_reply_failed'),
  'System: Automatic thank-you for website enquiry ' || pg_temp.r('nb', 'ref') || ' was not sent (not_begun)', '... audited as System, without the address');
select is(pg_temp.fail_ack(pg_temp.eid('nb'), 'not_begun') ->> 'changed', 'false', 'recording it twice changes nothing');
select is(pg_temp.begin_ack('nb_b', pg_temp.eid('nb')) ->> 'reason', 'already_started', 'and a late begin finds it decided, so nothing is sent');

-- a never-begun failure sent nothing, so the next enquiry from that address is still thanked
select pg_temp.submit('nb2', '[test] Nell Notbegun', 'nell@notbegun.test', 'Trying again');
select is(pg_temp.begin_ack('nb2_b', pg_temp.eid('nb2')) ->> 'send', 'true', 'a failure that never began does not count toward the per-address limit');

-- a timeout, and an unknown code
select pg_temp.submit('bt', '[test] Tom Timeout', 'tom@timeout.test', 'Hello');
select pg_temp.fail_ack(pg_temp.eid('bt'), 'BEGIN_TIMEOUT');
select is(pg_temp.why(pg_temp.eid('bt')), 'begin_timeout', 'a timeout is recorded as begin_timeout');
select pg_temp.submit('odd', '[test] Olive Odd', 'olive@odd.test', 'Hello');
select pg_temp.fail_ack(pg_temp.eid('odd'), 'anything <else>');
select is(pg_temp.why(pg_temp.eid('odd')), 'not_begun', 'any other code is recorded as not_begun');

-- every other state is left alone: sending (begin committed after the site gave up), sent and skipped
select is(pg_temp.fail_ack(pg_temp.eid('nb2')) ->> 'changed', 'false', 'a thank-you being sent is not overwritten');
select is(pg_temp.ack(pg_temp.eid('nb2')), 'sending', '... it stays sending');
select is(pg_temp.fail_ack(pg_temp.eid('new')) ->> 'status', 'sent', 'nor is one already sent');

-- a person's session never gets in, even with execute (defence in depth inside the function)
select pg_temp.become_anon();
select throws_ok(format($$select hq.fail_enquiry_auto_reply(%L)$$, pg_temp.eid('odd')), '42501', null, 'anon cannot record a thank-you failure');
select pg_temp.unbecome();

select * from finish();
rollback;
