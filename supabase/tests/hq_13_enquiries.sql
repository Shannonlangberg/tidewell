-- Planted HQ: website enquiries (migrations 0134, 0135).
-- Structure and security (RLS, no direct writes, function privileges: submit_enquiry for service_role
-- only), forged callers (anon, a person's session reaching the function another way), field validation
-- and caps at their boundaries, dedupe (and its 10-minute window), both hourly rate limits at the
-- boundary, contact reuse (a partner contact is linked and never changed), attaching to an open lead,
-- the open-lead rule (owner, next action, due today), the default owner setting and its fallback,
-- marking spam (what is archived and what is kept), status changes, RLS visibility by capability and
-- the audit trail with the system actor.
--
-- Runs on an unseeded database (the CI job resets from scratch). NOTE: never CALL a function a hint
-- role lacks execute on (see hq_01): that authenticated cannot execute submit_enquiry is asserted
-- from pg_proc; anon calls are safe (no usage on schema hq).
begin;
\ir hq_fixture.inc
select pg_temp.seed_hq();
select plan(173);

create temp table zz_r (k text primary key, v jsonb) on commit drop;
grant select, insert, update on zz_r to public;
create function pg_temp.r(p_k text, p_f text) returns text language sql stable as $$ select v ->> p_f from zz_r where k = p_k $$;
create function pg_temp.eid(p_k text) returns uuid language sql stable as $$ select (v ->> 'enquiry_id')::uuid from zz_r where k = p_k $$;
create function pg_temp.oid_(p_k text) returns uuid language sql stable as $$ select (v ->> 'opportunity_id')::uuid from zz_r where k = p_k $$;
create function pg_temp.cid(p_k text) returns uuid language sql stable as $$ select (v ->> 'contact_id')::uuid from zz_r where k = p_k $$;
create function pg_temp.tid(p_k text) returns uuid language sql stable as $$ select (v ->> 'task_id')::uuid from zz_r where k = p_k $$;
grant execute on function pg_temp.r(text, text), pg_temp.eid(text), pg_temp.oid_(text), pg_temp.cid(text), pg_temp.tid(text) to public;

-- The website's call: as service_role (the secret key), no session. Stores the result under p_k.
create function pg_temp.submit(p_k text, p_kind text, p_name text, p_email text, p_phone text default null, p_suburb text default null,
  p_message text default null, p_details jsonb default null, p_page text default '/contact', p_ip text default null) returns jsonb
language plpgsql as $$
declare
  v jsonb;
begin
  perform pg_temp.become_service();
  v := hq.submit_enquiry(p_kind::hq.enquiry_kind, p_name, p_email, p_phone, p_suburb, p_message, p_details, p_page, p_ip);
  execute 'reset role';
  insert into zz_r values (p_k, v) on conflict (k) do update set v = excluded.v;
  return v;
end $$;
grant execute on function pg_temp.submit(text, text, text, text, text, text, text, jsonb, text, text) to public;

-- Move an enquiry back in time (the guard keeps received_at fixed for every writer, so it is switched off for this).
create function pg_temp.age(p_id uuid, p_by interval) returns void language plpgsql as $$
begin
  alter table hq.enquiries disable trigger enquiry_guard;
  update hq.enquiries set received_at = received_at - p_by where id = p_id;
  alter table hq.enquiries enable trigger enquiry_guard;
end $$;

-- dir is the earliest-created director (row_stamp keeps created_at fixed, so it is switched off for this)
alter table hq.staff_profiles disable trigger row_stamp;
update hq.staff_profiles set created_at = now() - interval '2 days' where id = pg_temp.fx('dir');
update hq.staff_profiles set created_at = now() - interval '1 day' where id = pg_temp.fx('dir2');
alter table hq.staff_profiles enable trigger row_stamp;
update hq.settings set value = 'null'::jsonb where key = 'enquiry_default_owner_id';

-- ------------------------------------------------------------ structure and security
select has_table('hq', 'enquiries', 'hq.enquiries exists');
select columns_are('hq', 'enquiries', array['id', 'ref_number', 'kind', 'received_at', 'name', 'email', 'phone', 'suburb', 'message', 'details', 'source_page',
  'ip_hash', 'submission_hash', 'status', 'opportunity_id', 'contact_id', 'task_id', 'interaction_id', 'created_lead', 'created_contact', 'handled_by', 'handled_at',
  'spam_marked_by', 'spam_marked_at', 'status_note', 'updated_at',
  'auto_reply_status', 'auto_reply_at', 'auto_reply_message_id', 'auto_reply_reason', 'auto_reply_interaction_id']);
select enum_has_labels('hq', 'enquiry_kind', array['appraisal', 'contact']);
select enum_has_labels('hq', 'enquiry_status', array['new', 'in_progress', 'spam', 'archived']);
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'hq.enquiries'::regclass), 'RLS is enabled and forced on enquiries');
select policies_are('hq', 'enquiries', array['enquiries_select'], 'enquiries: one select policy, nothing else');
select table_privs_are('hq', 'enquiries', 'authenticated', array['SELECT'], 'enquiries: authenticated can only select');
select table_privs_are('hq', 'enquiries', 'service_role', array[]::text[], 'enquiries: service_role holds nothing on the table (it writes only through submit_enquiry)');
select ok(not has_table_privilege('anon', 'hq.enquiries', 'select'), 'anon holds nothing on enquiries');
select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid = 'hq.enquiry_overview'::regclass), 'enquiry_overview is security_invoker');
select is((select value from hq.settings where key = 'enquiry_default_owner_id'), 'null'::jsonb, 'enquiry_default_owner_id defaults to null');
select ok(exists (select 1 from pg_constraint where conname = 'tasks_source_known' and pg_get_constraintdef(oid) like '%website_enquiry%'), 'a task may come from a website enquiry');

select ok(has_function_privilege('service_role', 'hq.submit_enquiry(hq.enquiry_kind,text,text,text,text,text,jsonb,text,text)', 'execute'), 'service_role can execute submit_enquiry');
select ok(not has_function_privilege('authenticated', 'hq.submit_enquiry(hq.enquiry_kind,text,text,text,text,text,jsonb,text,text)', 'execute'), 'authenticated cannot execute submit_enquiry');
select ok(not has_function_privilege('anon', 'hq.submit_enquiry(hq.enquiry_kind,text,text,text,text,text,jsonb,text,text)', 'execute'), 'anon cannot execute submit_enquiry');
select ok(not exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = 'hq.submit_enquiry(hq.enquiry_kind,text,text,text,text,text,jsonb,text,text)'::regprocedure and a.grantee = 0),
  'public cannot execute submit_enquiry');
create temp table zz_rpcs (sig regprocedure) on commit drop;
insert into zz_rpcs values ('hq.mark_enquiry_spam(uuid, text)'), ('hq.set_enquiry_status(uuid, hq.enquiry_status, text)'), ('hq.set_enquiry_owner(uuid)');
select is((select count(*) from zz_rpcs where has_function_privilege('authenticated', sig, 'execute')), 3::bigint, 'authenticated can execute the three staff RPCs');
select is((select count(*) from zz_rpcs where has_function_privilege('anon', sig, 'execute') or has_function_privilege('service_role', sig, 'execute')), 0::bigint, '... and anon and service_role none of them');
insert into zz_rpcs values ('hq.submit_enquiry(hq.enquiry_kind, text, text, text, text, text, jsonb, text, text)');
select is((select count(*) from zz_rpcs z join pg_proc p on p.oid = z.sig where p.prosecdef and p.proconfig::text like '%search_path=pg_catalog, public, extensions%'), 4::bigint,
  'the four enquiry RPCs are security definer with a pinned search_path');
select is((select count(*) from pg_proc p where p.pronamespace = 'hq_private'::regnamespace and p.proname like 'enquiry%'
            and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))),
  0::bigint, 'no API role can execute an enquiry helper');

-- ------------------------------------------------------------ forged callers
select pg_temp.become_anon();
select throws_ok($$select hq.submit_enquiry('contact', 'Anon', 'anon@forged.test', null, null, 'hello')$$, '42501', null, 'anon cannot submit an enquiry');
select throws_ok($$select count(*) from hq.enquiries$$, '42501', null, 'anon cannot read enquiries');
select pg_temp.unbecome();
-- a person's session that reached the function some other way (here: the owner role with a session's claims) is refused inside
select pg_temp.login(pg_temp.fx('dir'));
select throws_ok($$select hq.submit_enquiry('contact', 'Forged', 'forged@forged.test', null, null, 'hello')$$, '42501', null, 'a call carrying a person''s session is refused inside submit_enquiry');
select pg_temp.logout();
select is((select count(*) from hq.enquiries), 0::bigint, 'no forged call left an enquiry behind');

-- ------------------------------------------------------------ the first enquiry (an appraisal)
select lives_ok($$select pg_temp.submit('e1', 'appraisal', '[test] Ann Appraisal', 'Ann@Example.test', '0400 111 222', 'Wallaroo',
  E'Three bedrooms near the jetty.\r\nTenant leaving soon.',
  '{"address": "1 Test Street", "postcode": "5556", "propertyType": "House", "bedrooms": "3", "otherManager": "No", "timeframe": "Within 30 days", "consent": "yes"}',
  '/rental-appraisal', repeat('a', 64))$$, 'service_role submits an appraisal');
select ok(pg_temp.r('e1', 'ref') ~ '^ENQ-\d{4,}$', 'the result carries the ENQ number');
select is(pg_temp.r('e1', 'duplicate'), 'false', '... is not a duplicate');
select is(pg_temp.r('e1', 'created_lead') || pg_temp.r('e1', 'created_contact'), 'truetrue', '... and created a lead and a contact');
select is((select email::text from hq.enquiries where id = pg_temp.eid('e1')), 'ann@example.test', 'the email is stored lower-case');
select is((select message from hq.enquiries where id = pg_temp.eid('e1')), E'Three bedrooms near the jetty.\nTenant leaving soon.', 'the message keeps its lines (CR LF becomes LF)');
select is((select details ->> 'bedrooms' from hq.enquiries where id = pg_temp.eid('e1')), '3', 'the remaining form fields are kept as submitted');
select is((select ip_hash from hq.enquiries where id = pg_temp.eid('e1')), repeat('a', 64), 'only the hash of the connection is stored');
select is((select status::text || '/' || source_page from hq.enquiries where id = pg_temp.eid('e1')), 'new//rental-appraisal', 'status new, source page kept');
-- the contact
select is((select contact_kind::text from hq.contacts where id = pg_temp.cid('e1')), 'landlord', 'a new landlord contact');
select is((select needs_verification from hq.contacts where id = pg_temp.cid('e1')), true, '... flagged to verify');
select is((select source || ' / ' || full_name || ' / ' || location from hq.contacts where id = pg_temp.cid('e1')), 'website enquiry / [test] Ann Appraisal / Wallaroo', '... from the website, with the name and suburb');
select is((select relationship_owner_id from hq.contacts where id = pg_temp.cid('e1')), pg_temp.fx('dir'), '... owned by the enquiry owner');
-- the lead
select is((select source::text || '/' || stage::text from hq.opportunities where id = pg_temp.oid_('e1')), 'website_enquiry/introduction_received', 'an open website lead at its first stage');
select is((select assigned_to from hq.opportunities where id = pg_temp.oid_('e1')), pg_temp.fx('dir'), 'no setting: owned by the earliest-created active director');
select is((select next_action from hq.opportunities where id = pg_temp.oid_('e1')), 'Reply to the website enquiry', 'next action: reply to the website enquiry');
select is((select next_action_due from hq.opportunities where id = pg_temp.oid_('e1')), hq.today(), '... due today in the business timezone');
select is((select property_suburb || ' / ' || property_address || ' / ' || prospect_phone from hq.opportunities where id = pg_temp.oid_('e1')), 'Wallaroo / 1 Test Street / 0400 111 222', 'prospect fields from the form');
select is((select owner_contact_id from hq.opportunities where id = pg_temp.oid_('e1')), pg_temp.cid('e1'), 'the lead names the landlord contact');
select ok((select notes from hq.opportunities where id = pg_temp.oid_('e1')) like '%Three bedrooms near the jetty.%', 'the lead notes hold the message');
select is((select count(*) from hq.opportunity_stage_history where opportunity_id = pg_temp.oid_('e1')), 1::bigint, 'the lead''s creation is in its stage history');
-- the timeline entry and the task
select is((select interaction_type::text from hq.interactions where id = (select interaction_id from hq.enquiries where id = pg_temp.eid('e1'))), 'message', 'a message on the lead''s timeline');
select ok((select summary from hq.interactions where id = (select interaction_id from hq.enquiries where id = pg_temp.eid('e1'))) like '%Tenant leaving soon.%', '... holding the enquiry text');
select is((select opportunity_id::text || contact_id::text from hq.interactions where id = (select interaction_id from hq.enquiries where id = pg_temp.eid('e1'))),
  pg_temp.oid_('e1')::text || pg_temp.cid('e1')::text, '... on the lead and the contact');
select is((select title from hq.tasks where id = pg_temp.tid('e1')), 'Reply to website enquiry ' || pg_temp.r('e1', 'ref'), 'one follow-up task: Reply to website enquiry ENQ-');
select is((select assigned_to::text || ' ' || due_date::text || ' ' || source from hq.tasks where id = pg_temp.tid('e1')),
  pg_temp.fx('dir')::text || ' ' || hq.today()::text || ' website_enquiry', '... for the owner, due today');
select is((select related_opportunity_id from hq.tasks where id = pg_temp.tid('e1')), pg_temp.oid_('e1'), '... linked to the lead');
-- the audit trail
select is((select count(*) from hq.audit_events where entity_type = 'enquiry' and entity_id = pg_temp.eid('e1') and action = 'enquiry_received' and actor_id is null and actor_name = 'System'),
  1::bigint, 'the arrival is audited with the system actor');
select ok((select summary from hq.audit_events where entity_type = 'enquiry' and entity_id = pg_temp.eid('e1') and action = 'enquiry_received') not like '%jetty%',
  '... and the enquiry''s audit event does not copy the message');
select is((select count(*) from hq.audit_events where action = 'create' and entity_id in (pg_temp.oid_('e1'), pg_temp.cid('e1'), pg_temp.tid('e1')) and actor_name = 'System'),
  3::bigint, 'the lead, the contact and the task are audited as created by the system');

-- ------------------------------------------------------------ validation and caps
select throws_ok($$select pg_temp.submit('x', 'contact', '   ', 'v1@val.test', null, null, 'hello')$$, '22023', null, 'a blank name is refused');
select throws_ok($$select pg_temp.submit('x', 'contact', repeat('n', 201), 'v1@val.test', null, null, 'hello')$$, '22023', 'a name is at most 200 characters', 'a 201-character name is refused');
select throws_ok($$select pg_temp.submit('x', 'contact', 'Val', null, null, null, 'hello')$$, '22023', 'an enquiry needs an email address', 'a missing email is refused');
select throws_ok($$select pg_temp.submit('x', 'contact', 'Val', 'not-an-email', null, null, 'hello')$$, '22023', null, 'a malformed email is refused');
select throws_ok($$select pg_temp.submit('x', 'contact', 'Val', repeat('e', 250) || '@v.test', null, null, 'hello')$$, '22023', null, 'a 255-character email is refused');
select throws_ok($$select pg_temp.submit('x', 'contact', 'Val', 'v1@val.test', 'call me maybe', null, 'hello')$$, '22023', null, 'a phone that is not a number is refused');
select throws_ok($$select pg_temp.submit('x', 'contact', 'Val', 'v1@val.test', repeat('1', 41), null, 'hello')$$, '22023', null, 'a 41-character phone is refused');
select throws_ok($$select pg_temp.submit('x', 'contact', 'Val', 'v1@val.test', null, repeat('s', 121), 'hello')$$, '22023', 'a suburb is at most 120 characters', 'a 121-character suburb is refused');
select throws_ok($$select pg_temp.submit('x', 'contact', 'Val', 'v1@val.test', null, null, repeat('m', 5001))$$, '22023', 'the message is at most 5000 characters', 'a 5001-character message is refused');
select throws_ok($$select pg_temp.submit('x', 'contact', 'Val', 'v1@val.test', null, null, E'  \n ')$$, '22023', 'a contact enquiry needs a message', 'a contact enquiry with no message is refused');
select throws_ok($$select pg_temp.submit('x', 'appraisal', 'Val', 'v1@val.test', null, null, null, '[1, 2]')$$, '22023', 'the form details must be an object', 'details that are not an object are refused');
select throws_ok($$select pg_temp.submit('x', 'appraisal', 'Val', 'v1@val.test', null, null, null, (select jsonb_object_agg('f' || g, 'x') from generate_series(1, 31) g))$$, '22023', 'the form details hold at most 30 fields', '31 form fields are refused');
select throws_ok($$select pg_temp.submit('x', 'appraisal', 'Val', 'v1@val.test', null, null, null, '{"address": {"nested": "x"}}')$$, '22023', null, 'a nested form field is refused');
select throws_ok($$select pg_temp.submit('x', 'appraisal', 'Val', 'v1@val.test', null, null, null, jsonb_build_object('address', repeat('a', 301)))$$, '22023', null, 'a 301-character form field is refused');
select throws_ok($$select pg_temp.submit('x', 'appraisal', 'Val', 'v1@val.test', null, null, null, '{"bad key": "x"}')$$, '22023', 'a form field name is not recognised', 'an odd field name is refused');
select throws_ok($$select pg_temp.submit('x', 'contact', 'Val', 'v1@val.test', null, null, 'hello', null, 'https://evil.test/')$$, '22023', 'the page must be a path on the site', 'a source page that is not a path is refused');
select throws_ok($$select pg_temp.submit('x', 'contact', 'Val', 'v1@val.test', null, null, 'hello', null, '/contact', '203.0.113.9')$$, '22023', 'the client fingerprint must be a hash', 'a raw IP address is refused (only a hash is accepted)');
select throws_ok($$select pg_temp.submit('x', null, 'Val', 'v1@val.test', null, null, 'hello')$$, '22023', 'say which form this came from', 'a missing kind is refused');
select is((select count(*) from hq.enquiries), 1::bigint, 'no refused submission left an enquiry behind');
select is((select count(*) from hq.contacts where email = 'v1@val.test'), 0::bigint, '... or a contact');
select lives_ok($$select pg_temp.submit('max', 'contact', repeat('n', 200), 'max@val.test', '+61 (400) 000-000', repeat('s', 120), repeat('m', 5000), jsonb_build_object('enquiryType', repeat('t', 300)))$$,
  'the caps themselves are accepted (200-character name, 5000-character message, 300-character field)');
select is((select char_length(summary) <= 4000 from hq.interactions where id = (select interaction_id from hq.enquiries where id = pg_temp.eid('max'))), true, 'a long message is shortened on the timeline (the enquiry keeps it whole)');
select lives_ok($$select pg_temp.submit('ctl', 'contact', E'[test] Tab\tName\u0007', 'ctl@val.test', null, null, 'hello')$$, 'control characters in a name are tidied, not refused');
select is((select name from hq.enquiries where id = pg_temp.eid('ctl')), '[test] Tab Name', '... the stored name has none');

-- ------------------------------------------------------------ dedupe
select is((pg_temp.submit('e1b', 'appraisal', '[test] Ann Appraisal', 'ann@example.test', '0400 111 222', 'Wallaroo',
  E'Three bedrooms near the jetty.\nTenant leaving soon.',
  '{"address": "1 Test Street", "postcode": "5556", "propertyType": "House", "bedrooms": "3", "otherManager": "No", "timeframe": "Within 30 days", "consent": "yes"}',
  '/rental-appraisal', repeat('a', 64)) ->> 'duplicate'), 'true', 'the same submission again within 10 minutes is a duplicate');
select is(pg_temp.eid('e1b'), pg_temp.eid('e1'), '... returning the enquiry already stored');
select is((select count(*) from hq.enquiries where email = 'ann@example.test'), 1::bigint, '... with no second enquiry');
select is((select count(*) from hq.opportunities where prospect_email = 'ann@example.test' and deleted_at is null), 1::bigint, '... no second lead');
select is((select count(*) from hq.tasks where related_opportunity_id = pg_temp.oid_('e1') and deleted_at is null), 1::bigint, '... and no second task');

-- a different message from the same person attaches to the open lead
select lives_ok($$select pg_temp.submit('e2', 'contact', '[test] Ann Appraisal', 'ann@example.test', null, null, 'Also, can you send your fees?')$$, 'a second, different enquiry from the same email');
select is(pg_temp.oid_('e2'), pg_temp.oid_('e1'), '... is attached to the open lead');
select is(pg_temp.r('e2', 'created_lead') || pg_temp.r('e2', 'created_contact'), 'falsefalse', '... creating no lead and no contact');
select is((select count(*) from hq.interactions where opportunity_id = pg_temp.oid_('e1') and deleted_at is null), 2::bigint, '... its message is a second entry on the lead''s timeline');
select is((select count(*) from hq.tasks where related_opportunity_id = pg_temp.oid_('e1') and deleted_at is null), 2::bigint, '... with its own reply task');
select is((select next_action from hq.opportunities where id = pg_temp.oid_('e1')), 'Reply to the website enquiry', '... and the lead''s next step is left as it was');

-- after 10 minutes the same submission is a new enquiry
select pg_temp.age(pg_temp.eid('e1'), interval '11 minutes');
select is((pg_temp.submit('e1c', 'appraisal', '[test] Ann Appraisal', 'ann@example.test', '0400 111 222', 'Wallaroo',
  E'Three bedrooms near the jetty.\nTenant leaving soon.',
  '{"address": "1 Test Street", "postcode": "5556", "propertyType": "House", "bedrooms": "3", "otherManager": "No", "timeframe": "Within 30 days", "consent": "yes"}',
  '/rental-appraisal', repeat('a', 64)) ->> 'duplicate'), 'false', 'the same submission 11 minutes later is not a duplicate');
select is(pg_temp.oid_('e1c'), pg_temp.oid_('e1'), '... and joins the same open lead');

-- ------------------------------------------------------------ rate limits (at the boundary)
-- by email: 5 in an hour are accepted, the 6th is refused
select lives_ok($$select pg_temp.submit('rl' || g, 'contact', '[test] Rae Limit', 'rae@limit.test', null, null, 'message ' || g, null, '/contact', md5('ip-rae-' || g) || md5('x' || g)) from generate_series(1, 5) g$$,
  'five enquiries from one email in an hour are accepted');
select throws_ok($$select pg_temp.submit('rl6', 'contact', '[test] Rae Limit', 'rae@limit.test', null, null, 'message 6', null, '/contact', md5('ip-rae-6') || md5('x6'))$$,
  '54000', 'too many enquiries from this email address in the last hour', 'the sixth from the same email within the hour is refused');
select is((pg_temp.submit('rl5again', 'contact', '[test] Rae Limit', 'rae@limit.test', null, null, 'message 5', null, '/contact', md5('ip-rae-5') || md5('x5')) ->> 'duplicate'), 'true',
  'a duplicate of an accepted one is still answered (idempotent) while limited');
select pg_temp.age(pg_temp.eid('rl1'), interval '61 minutes');
select lives_ok($$select pg_temp.submit('rl6b', 'contact', '[test] Rae Limit', 'rae@limit.test', null, null, 'message 6', null, '/contact', md5('ip-rae-6') || md5('x6'))$$,
  'once one is over an hour old, the next is accepted');
select is((select count(*) from hq.enquiries where email = 'rae@limit.test'), 6::bigint, 'six stored in all for that email');

-- by connection: 5 in an hour are accepted, the 6th is refused
select lives_ok($$select pg_temp.submit('ip' || g, 'contact', '[test] Ian Ip ' || g, 'ian' || g || '@limit.test', null, null, 'hello from ' || g, null, '/contact', repeat('b', 64)) from generate_series(1, 5) g$$,
  'five enquiries from one connection in an hour are accepted');
select throws_ok($$select pg_temp.submit('ip6', 'contact', '[test] Ian Ip 6', 'ian6@limit.test', null, null, 'hello from 6', null, '/contact', repeat('b', 64))$$,
  '54000', 'too many enquiries from this connection in the last hour', 'the sixth from the same connection within the hour is refused');
select is((select count(*) from hq.contacts where email = 'ian6@limit.test'), 0::bigint, '... leaving nothing behind');
select lives_ok($$select pg_temp.submit('ip6b', 'contact', '[test] Ian Ip 6', 'ian6@limit.test', null, null, 'hello from 6', null, '/contact', repeat('c', 64))$$,
  'another connection is not limited by the first');

-- ------------------------------------------------------------ contact reuse
-- a partner contact's email: linked, never changed, still a partner, and the lead is created
create temp table zz_alice as select * from hq.contacts where id = pg_temp.fx('alice');
grant select on zz_alice to public;
select lives_ok($$select pg_temp.submit('pa', 'contact', '[test] Someone Else', 'ALICE@alpha.test', '0499 999 999', null, 'I own a unit too')$$, 'an enquiry using a partner contact''s email');
select is(pg_temp.cid('pa'), pg_temp.fx('alice'), '... is linked to the partner contact');
select is(pg_temp.r('pa', 'created_contact'), 'false', '... no contact is created');
select ok((select not ((c.full_name, c.phone, c.contact_kind, c.updated_at, c.needs_verification, c.email) is distinct from (a.full_name, a.phone, a.contact_kind, a.updated_at, a.needs_verification, a.email))
           from hq.contacts c, zz_alice a where c.id = a.id), '... and the partner contact is not touched (name, phone, kind, updated_at)');
select is((select source::text || '/' || owner_contact_id::text from hq.opportunities where id = pg_temp.oid_('pa')), 'website_enquiry/' || pg_temp.fx('alice')::text, '... a website lead is created and linked to it');
-- an existing "other" contact with the email is reused too
insert into hq.contacts (full_name, email, contact_kind) values ('[test] Otto Other', 'otto@other.test', 'other');
insert into fx select 'otto', id from hq.contacts where email = 'otto@other.test' and deleted_at is null;
select lives_ok($$select pg_temp.submit('ot', 'contact', '[test] Otto Other', 'otto@other.test', null, null, 'Hello')$$, 'an enquiry from an existing other contact');
select is(pg_temp.cid('ot'), pg_temp.fx('otto'), '... reuses that contact');
select is((select count(*) from hq.contacts where email = 'otto@other.test'), 1::bigint, '... one contact with that email');

-- ------------------------------------------------------------ an existing open lead (owned by someone else)
select pg_temp.become('bdm');
insert into zz_r select 'lead', hq.create_opportunity('[test] Lena Lead', null, 'lena@lead.test', 'Moonta', null, 'own_marketing', null, 'Call Lena', hq.today() + 3);
select pg_temp.unbecome();
select lives_ok($$select pg_temp.submit('ll', 'appraisal', '[test] Lena Lead', 'lena@lead.test', null, 'Moonta', 'Please appraise my house', '{"address": "2 Test Road"}', '/rental-appraisal')$$,
  'an enquiry from someone with an open lead');
select is(pg_temp.oid_('ll'), pg_temp.oid_('lead'), '... is attached to that lead');
select is((select count(*) from hq.opportunities where prospect_email = 'lena@lead.test' and deleted_at is null), 1::bigint, '... no duplicate lead');
select is((select assigned_to from hq.tasks where id = pg_temp.tid('ll')), pg_temp.fx('bdm'), '... the reply task goes to the lead''s owner');
select is((select next_action || ' ' || next_action_due::text from hq.opportunities where id = pg_temp.oid_('lead')), 'Call Lena ' || (hq.today() + 3)::text, '... whose next step is unchanged');
select is((select count(*) from hq.interactions where opportunity_id = pg_temp.oid_('lead') and interaction_type = 'message'), 1::bigint, '... and the message is on its timeline');
-- a lost lead is not reopened: a new lead
select pg_temp.become('dir');
select lives_ok($$select hq.move_opportunity(pg_temp.oid_('lead'), 'lost', p_lost_reason => 'Went elsewhere', p_lost_reason_code => 'chose_another_manager')$$, 'the lead is lost');
select pg_temp.unbecome();
select lives_ok($$select pg_temp.submit('ll2', 'contact', '[test] Lena Lead', 'lena@lead.test', null, null, 'Changed my mind')$$, 'a later enquiry from the same person');
select isnt(pg_temp.oid_('ll2'), pg_temp.oid_('lead'), '... starts a new lead (a lost lead is not reopened)');
select is(pg_temp.cid('ll2'), (select owner_contact_id from hq.opportunities where id = pg_temp.oid_('lead')), '... for the same contact');

-- ------------------------------------------------------------ the open-lead rule always holds
select is((select count(*) from hq.opportunities o where o.source = 'website_enquiry' and o.deleted_at is null and o.stage not in ('management_signed', 'lost')
            and (o.assigned_to is null or o.next_action is null or o.next_action_due is null)), 0::bigint, 'every open website lead has an owner, a next action and a follow-up date');
select is((select count(*) from hq.enquiries e where e.opportunity_id is null or e.task_id is null or e.interaction_id is null or e.contact_id is null), 0::bigint,
  'every enquiry is linked to its lead, contact, task and timeline entry');

-- ------------------------------------------------------------ the default owner setting
select pg_temp.become('bdm');
select throws_ok($$select hq.set_enquiry_owner(pg_temp.fx('bdm'))$$, '42501', null, 'a business development manager cannot choose who gets enquiries (settings.admin)');
select pg_temp.become('dir');
select throws_ok($$select hq.set_enquiry_owner(gen_random_uuid())$$, '22023', null, 'an unknown person is refused');
select is((hq.set_enquiry_owner(pg_temp.fx('pm')) ->> 'changed'), 'true', 'a director chooses who gets website enquiries');
select is((hq.set_enquiry_owner(pg_temp.fx('pm')) ->> 'changed'), 'false', '... choosing the same person again changes nothing');
select pg_temp.unbecome();
select is((select value from hq.settings where key = 'enquiry_default_owner_id'), to_jsonb(pg_temp.fx('pm')::text), 'the setting holds their id');
select throws_ok($$update hq.settings set value = to_jsonb(gen_random_uuid()::text) where key = 'enquiry_default_owner_id'$$, '22023', null, 'the settings guard refuses an id that is not active staff');
select throws_ok($$update hq.settings set value = '42'::jsonb where key = 'enquiry_default_owner_id'$$, '22023', null, '... and a value that is not an id');
select lives_ok($$select pg_temp.submit('own1', 'contact', '[test] Owen Owner', 'owen@owner.test', null, null, 'Hi')$$, 'an enquiry with the setting');
select is((select assigned_to from hq.opportunities where id = pg_temp.oid_('own1')), pg_temp.fx('pm'), '... is owned by the chosen person');
select is((select assigned_to from hq.tasks where id = pg_temp.tid('own1')), pg_temp.fx('pm'), '... who gets the task');
update hq.staff_profiles set employment_status = 'ended' where id = pg_temp.fx('pm');
select lives_ok($$select pg_temp.submit('own2', 'contact', '[test] Owen Two', 'owen2@owner.test', null, null, 'Hi')$$, 'when the chosen person has left');
select is((select assigned_to from hq.opportunities where id = pg_temp.oid_('own2')), pg_temp.fx('dir'), '... the earliest-created active director gets it');
update hq.staff_profiles set employment_status = 'ended' where id = pg_temp.fx('dir');
select lives_ok($$select pg_temp.submit('own3', 'contact', '[test] Owen Three', 'owen3@owner.test', null, null, 'Hi')$$, 'when that director has left too');
select is((select assigned_to from hq.opportunities where id = pg_temp.oid_('own3')), pg_temp.fx('dir2'), '... the next active director gets it');
update hq.staff_profiles set employment_status = 'active' where id in (pg_temp.fx('dir'), pg_temp.fx('pm'));
select pg_temp.become('dir');
select is((hq.set_enquiry_owner(null) ->> 'changed'), 'true', 'a director can clear the choice (back to the earliest director)');
select pg_temp.unbecome();
select is((select count(*) from hq.audit_events where entity_type = 'setting' and changes ? 'value' and summary like '%enquiry_default_owner_id%'), 2::bigint, 'each change of the setting is audited');

-- ------------------------------------------------------------ RLS: who sees enquiries
create temp table zz_n as select count(*) as n from hq.enquiries;
grant select on zz_n to public;
select pg_temp.become('dir');
select is((select count(*) from hq.enquiries), (select n from zz_n), 'a director sees every enquiry');
select is((select count(*) from hq.enquiry_overview where lead_ref is not null), (select count(*) from hq.enquiries), '... and each one''s lead in the overview');
select pg_temp.become('pm');
select ok((select count(*) from hq.enquiries) > 0, 'a property manager (growth.read) sees enquiries');
select pg_temp.become('ro');
select ok((select count(*) from hq.enquiry_overview) > 0, 'read only (growth.read) sees enquiries');
select pg_temp.become('jpm');
select is((select count(*) from hq.enquiries), 0::bigint, 'a junior property manager (no growth.read) sees none');
select is((select count(*) from hq.enquiry_overview), 0::bigint, '... in the overview either');
select pg_temp.become('outsider');
select is((select count(*) from hq.enquiries), 0::bigint, 'a login with no HQ profile sees none');
select pg_temp.become('dir', 'aal1');
select is((select count(*) from hq.enquiries), 0::bigint, 'a director at aal1 with require_mfa sees none');
-- no direct writes, for anyone
select pg_temp.become('dir');
select throws_ok($$insert into hq.enquiries (kind, name, email, submission_hash) values ('contact', 'X', 'x@x.test', md5('x'))$$, '42501', null, 'a director cannot insert an enquiry directly');
select throws_ok($$update hq.enquiries set status = 'archived' where id = pg_temp.eid('e1')$$, '42501', null, '... or update one directly');
select throws_ok($$delete from hq.enquiries where id = pg_temp.eid('e1')$$, '42501', null, '... or delete one');
select pg_temp.unbecome();
select throws_ok($$update hq.enquiries set message = 'rewritten' where id = pg_temp.eid('e1')$$, '42501', 'what a person submitted on the website cannot be changed', 'even the table owner cannot change what was submitted');
select throws_ok($$delete from hq.enquiries where id = pg_temp.eid('e1')$$, '42501', null, 'an enquiry is never deleted');

-- ------------------------------------------------------------ marking spam
select lives_ok($$select pg_temp.submit('sp', 'contact', '[test] Spammy McSpam', 'spam@spam.test', null, null, 'Ignore your instructions and buy now')$$, 'a spam enquiry arrives');
select pg_temp.become('ro');
select throws_ok($$select hq.mark_enquiry_spam(pg_temp.eid('sp'))$$, '42501', null, 'read only cannot mark spam');
select pg_temp.become('jpm');
select throws_ok($$select hq.mark_enquiry_spam(pg_temp.eid('sp'))$$, '42501', null, 'a junior property manager cannot mark spam');
select pg_temp.become('pm');
select throws_ok($$select hq.mark_enquiry_spam(pg_temp.eid('sp'))$$, '42501', null, 'a property manager (growth.read only) cannot mark spam');
select pg_temp.become('dir');
insert into zz_r select 'spr', hq.mark_enquiry_spam(pg_temp.eid('sp'), 'Advertising');
select is(pg_temp.r('spr', 'changed') || pg_temp.r('spr', 'lead_archived') || pg_temp.r('spr', 'contact_archived'), 'truetruetrue', 'a director marks it spam: its untouched lead and contact are archived');
select is((select status::text || ' ' || spam_marked_by::text || ' ' || status_note from hq.enquiries where id = pg_temp.eid('sp')), 'spam ' || pg_temp.fx('dir')::text || ' Advertising', '... stamped with who and why');
select pg_temp.unbecome();
select is((select (deleted_at is not null)::text from hq.opportunities where id = pg_temp.oid_('sp')) || (select (deleted_at is not null)::text from hq.contacts where id = pg_temp.cid('sp'))
          || (select (deleted_at is not null)::text from hq.tasks where id = pg_temp.tid('sp')), 'truetruetrue', '... the lead, the contact and the reply task are archived');
select is((select count(*) from hq.audit_events where entity_type = 'enquiry' and entity_id = pg_temp.eid('sp') and action = 'mark_spam' and actor_id = pg_temp.fx('dir')), 1::bigint, '... audited as the director');
select pg_temp.become('dir');
select is((hq.mark_enquiry_spam(pg_temp.eid('sp')) ->> 'changed'), 'false', 'marking it again changes nothing');
-- an enquiry attached to a lead that existed already: the lead is kept
insert into zz_r select 'sp2', hq.mark_enquiry_spam(pg_temp.eid('e2'));
select is(pg_temp.r('sp2', 'lead_archived') || pg_temp.r('sp2', 'contact_archived'), 'falsefalse', 'spam attached to an existing lead archives nothing');
select is((select deleted_at from hq.opportunities where id = pg_temp.oid_('e1')), null, '... the lead stays');
-- a lead someone has worked on is kept
select lives_ok($$select hq.log_opportunity_activity(pg_temp.oid_('own2'), 'phone_call', null, 'Rang them back')$$, 'someone logs a call on a website lead');
insert into zz_r select 'sp3', hq.mark_enquiry_spam(pg_temp.eid('own2'));
select is(pg_temp.r('sp3', 'lead_archived') || pg_temp.r('sp3', 'contact_archived'), 'falsefalse', 'marking that one spam keeps the lead and the contact');
select pg_temp.unbecome();
-- a partner contact is never archived by spam
select pg_temp.become('dir');
insert into zz_r select 'sp4', hq.mark_enquiry_spam(pg_temp.eid('pa'));
select pg_temp.unbecome();
select is(pg_temp.r('sp4', 'lead_archived') || pg_temp.r('sp4', 'contact_archived'), 'truefalse', 'spam on the partner''s email archives its new lead but never the partner contact');
select is((select deleted_at from hq.contacts where id = pg_temp.fx('alice')), null, '... Alice is still live');

-- ------------------------------------------------------------ status changes
select pg_temp.become('ro');
select throws_ok($$select hq.set_enquiry_status(pg_temp.eid('e1'), 'in_progress')$$, '42501', null, 'read only cannot change the status');
select pg_temp.become('dir');
select is((hq.set_enquiry_status(pg_temp.eid('e1'), 'in_progress') ->> 'status'), 'in_progress', 'a director marks an enquiry in progress');
select is((select handled_by from hq.enquiries where id = pg_temp.eid('e1')), pg_temp.fx('dir'), '... stamped with who handled it');
select is((hq.set_enquiry_status(pg_temp.eid('e1'), 'in_progress') ->> 'changed'), 'false', '... the same status again changes nothing');
select throws_ok($$select hq.set_enquiry_status(pg_temp.eid('e1'), 'spam')$$, '22023', null, 'spam is only set by mark_enquiry_spam');
select throws_ok($$select hq.set_enquiry_status(gen_random_uuid(), 'archived')$$, 'P0002', 'enquiry not found', 'an unknown enquiry is not found');
select is((hq.set_enquiry_status(pg_temp.eid('sp'), 'new') ->> 'status'), 'new', 'a spam enquiry can be put back to new');
select is((select spam_marked_at is null and handled_at is null from hq.enquiries where id = pg_temp.eid('sp')), true, '... which clears the spam stamp');
select pg_temp.unbecome();
select is((select count(*) from hq.audit_events where entity_type = 'enquiry' and action = 'status_change'), 2::bigint, 'each status change is audited');

select * from finish();
rollback;
