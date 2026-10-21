-- Planted HQ: branded email drafting and approved sending (migrations 0132, 0133).
-- Structure and security, the capability matrix, forged callers (anon, non-staff, aal1, read_only,
-- junior, roles without email.send), recipient rules (one recipient, a live contact with an email or an
-- active member of staff (a typed address is hq_12b), copied at draft time, re-checked at approval and at
-- send), the status machine (double send impossible, closed states, a failed send retried only by a new
-- approval, stuck sends), the daily send limit and the hourly draft limit at their boundaries, chat-send
-- mode (off by default, the token's channel, the same app, the 30-minute window), approval rules, RLS
-- visibility, the timeline entry on send, the audit trail and the settings guard.
--
-- A connected chat app is simulated by a session whose claims carry client_id (as Supabase's OAuth
-- tokens do). NOTE: never CALL a function a hint role lacks execute on (see hq_01).
begin;
\ir hq_fixture.inc
select pg_temp.seed_hq();
select plan(152);

-- a session from a connected chat app: the same person, plus the OAuth client id claim
create function pg_temp.become_app(p_key text, p_client text, p_aal text default 'aal2') returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', pg_temp.fx(p_key), 'role', 'authenticated', 'aal', p_aal, 'client_id', p_client)::text, true);
  execute 'set local role authenticated';
end $$;

create temp table zz_r (k text primary key, v jsonb) on commit drop;
grant select, insert on zz_r to public;
create function pg_temp.eid(p_k text) returns uuid language sql stable as $$ select (v ->> 'draft_id')::uuid from zz_r where k = p_k $$;
create function pg_temp.st(p_id uuid) returns text language sql stable security definer as $$ select status::text from hq.email_drafts where id = p_id $$;
create function pg_temp.audits(p_id uuid, p_action text) returns bigint language sql stable security definer as $$
  select count(*) from hq.audit_events where entity_type = 'email_draft' and entity_id = p_id and action = p_action $$;
grant execute on function pg_temp.st(uuid), pg_temp.audits(uuid, text), pg_temp.eid(text) to public;

-- anything already in this database is put out of the way: today's sends would count against the limit
alter table hq.email_drafts disable trigger email_draft_guard;
update hq.email_drafts set status = 'discarded', discarded_at = coalesce(discarded_at, now()), send_started_at = null, sent_by = null, send_via = null, sent_at = null, interaction_id = null
where status <> 'discarded' or send_started_at is not null;
alter table hq.email_drafts enable trigger email_draft_guard;
update hq.settings set value = '20'::jsonb where key = 'email_daily_limit';
update hq.settings set value = 'false'::jsonb where key = 'email_chat_send_enabled';

-- a staff member who has left, and a contact that is archived
update hq.staff_profiles set employment_status = 'ended' where id = pg_temp.fx('dir2');
insert into hq.contacts (full_name, email) values ('Archie Archived', 'archie@old.test');
insert into fx select 'archie', id from hq.contacts where full_name = 'Archie Archived' and deleted_at is null;
update hq.contacts set deleted_at = now() where id = pg_temp.fx('archie');
insert into hq.contacts (full_name, email) values ('Tim Thankyou', 'tim@partner.test');
insert into fx select 'tim', id from hq.contacts where full_name = 'Tim Thankyou' and deleted_at is null;

-- ------------------------------------------------------------ structure and security
select has_table('hq', 'email_drafts', 'hq.email_drafts exists');
select columns_are('hq', 'email_drafts', array['id', 'ref_number', 'created_by', 'created_via', 'mcp_client_id', 'recipient_contact_id', 'recipient_staff_id',
  'to_email', 'to_name', 'subject', 'body_text', 'template', 'reply_to_email', 'status', 'approved_by', 'approved_at', 'send_started_at', 'sent_by', 'send_via',
  'sent_at', 'provider_message_id', 'error_code', 'interaction_id', 'opportunity_id', 'discarded_at', 'discarded_by', 'created_at', 'updated_at']);
select enum_has_labels('hq', 'email_template', array['thank_you', 'follow_up', 'introduction', 'general']);
select enum_has_labels('hq', 'email_status', array['draft', 'approved', 'sending', 'sent', 'failed', 'discarded']);
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'hq.email_drafts'::regclass), 'RLS is enabled and forced on email_drafts');
select policies_are('hq', 'email_drafts', array['email_drafts_select'], 'email_drafts: one select policy, nothing else');
select table_privs_are('hq', 'email_drafts', 'authenticated', array['SELECT'], 'email_drafts: authenticated can only select (written by RPC)');
select table_privs_are('hq', 'email_drafts', 'service_role', array['SELECT'], 'email_drafts: service_role can only select');
select ok(not has_table_privilege('anon', 'hq.email_drafts', 'select'), 'anon holds nothing on email_drafts');

create temp table zz_rpcs (sig regprocedure) on commit drop;
insert into zz_rpcs values
  ('hq.create_email_draft(hq.email_template, text, text, uuid, uuid, uuid, text, text)'),
  ('hq.update_email_draft(uuid, text, text, hq.email_template)'),
  ('hq.discard_email_draft(uuid, text)'),
  ('hq.approve_email_draft(uuid)'),
  ('hq.begin_email_send(uuid, text)'),
  ('hq.finish_email_send(uuid, boolean, text, text)');
select is((select count(*) from zz_rpcs z join pg_proc p on p.oid = z.sig where p.prosecdef and p.proconfig::text like '%search_path=pg_catalog, public, extensions%'), 6::bigint, 'the six email RPCs are security definer with a pinned search_path');
select is((select count(*) from zz_rpcs where has_function_privilege('authenticated', sig, 'execute')), 6::bigint, 'authenticated can execute all six');
select is((select count(*) from zz_rpcs where has_function_privilege('anon', sig, 'execute') or has_function_privilege('service_role', sig, 'execute')), 0::bigint, 'anon and service_role can execute none of them');
select is((select count(*) from pg_proc p where p.pronamespace = 'hq_private'::regnamespace and p.proname like 'email%'
            and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))),
  0::bigint, 'no API role can execute an email helper');
-- 0146: create_email_draft takes ONE typed address and its name; no other email RPC takes an address, and none takes cc or bcc
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'hq'::regnamespace and p.proname like '%email%'
                        and exists (select 1 from unnest(coalesce(p.proargnames, '{}')) a where a ~* '^p_(to|to_email|email|address|cc|bcc)'
                                      and not (p.proname = 'create_email_draft' and a in ('p_to_email', 'p_to_name')))),
  'no email RPC takes an address except create_email_draft''s one typed address (p_to_email, p_to_name): no cc or bcc');

select is((select array_agg(role::text order by role::text) from hq.role_capabilities where capability = 'email.draft'),
  array['administrator', 'business_development_manager', 'director', 'property_manager', 'senior_property_manager', 'virtual_assistant'], 'email.draft: the six drafting roles');
select is((select array_agg(role::text order by role::text) from hq.role_capabilities where capability = 'email.send'),
  array['administrator', 'business_development_manager', 'director'], 'email.send: director, administrator, business development manager');
select is((select value from hq.settings where key = 'email_daily_limit'), '20'::jsonb, 'email_daily_limit defaults to 20');
select is((select value from hq.settings where key = 'email_chat_send_enabled'), 'false'::jsonb, 'email_chat_send_enabled defaults to false');

-- ------------------------------------------------------------ forged callers
select pg_temp.become_anon();
select throws_ok($$select hq.create_email_draft('thank_you', 'Hi', 'Body', pg_temp.fx('alice'))$$, '42501', null, 'anon cannot draft');
select pg_temp.unbecome();
select pg_temp.become('outsider');
select throws_ok($$select hq.create_email_draft('thank_you', 'Hi', 'Body', pg_temp.fx('alice'))$$, '42501', null, 'a login with no HQ profile cannot draft');
select is((select count(*) from hq.email_drafts), 0::bigint, 'non-staff: sees no email');
select pg_temp.become('ro');
select throws_ok($$select hq.create_email_draft('thank_you', 'Hi', 'Body', pg_temp.fx('alice'))$$, '42501', null, 'read_only cannot draft (no email.draft)');
select pg_temp.become('jpm');
select throws_ok($$select hq.create_email_draft('thank_you', 'Hi', 'Body', null, pg_temp.fx('pm'))$$, '42501', null, 'junior property manager cannot draft (no email.draft)');
select pg_temp.become('dir', 'aal1');
select throws_ok($$select hq.create_email_draft('thank_you', 'Hi', 'Body', pg_temp.fx('alice'))$$, '42501', null, 'a director at aal1 with require_mfa cannot draft');
select pg_temp.unbecome();

-- ------------------------------------------------------------ recipient rules
select pg_temp.become('dir');
select throws_ok($$select hq.create_email_draft('general', 'Hi', 'Body', pg_temp.fx('alice'), pg_temp.fx('pm'))$$, '22023', 'an email goes to exactly one person: a contact, a member of staff or one typed address', 'two recipients are refused');
select throws_ok($$select hq.create_email_draft('general', 'Hi', 'Body')$$, '22023', 'an email goes to exactly one person: a contact, a member of staff or one typed address', 'no recipient is refused');
select throws_ok($$select hq.create_email_draft('general', 'Hi', 'Body', pg_temp.fx('alex'))$$, '22023', 'there is no email address on record for this person; add it to their record first', 'a contact with no email is refused');
select throws_ok($$select hq.create_email_draft('general', 'Hi', 'Body', pg_temp.fx('archie'))$$, 'P0002', 'that contact could not be found', 'an archived contact is refused');
select throws_ok($$select hq.create_email_draft('general', 'Hi', 'Body', null, pg_temp.fx('dir2'))$$, 'P0002', null, 'a member of staff who has left is refused');
select throws_ok($$select hq.create_email_draft('general', 'Hi', 'Body', gen_random_uuid())$$, 'P0002', null, 'an unknown contact id is refused');
select throws_ok($$select hq.create_email_draft('general', '   ', 'Body', pg_temp.fx('alice'))$$, '22023', 'an email needs a subject', 'a blank subject is refused');
select throws_ok($$select hq.create_email_draft('general', repeat('s', 201), 'Body', pg_temp.fx('alice'))$$, '22023', 'the subject is at most 200 characters', 'a 201-character subject is refused');
select throws_ok($$select hq.create_email_draft('general', 'Hi', repeat('b', 8001), pg_temp.fx('alice'))$$, '22023', 'the message is at most 8000 characters', 'an 8001-character message is refused');
select throws_ok($$select hq.create_email_draft('general', 'Hi', E' \n\t ', pg_temp.fx('alice'))$$, '22023', 'an email needs a message', 'a blank message is refused');
select lives_ok($$insert into zz_r select 'max', hq.create_email_draft('general', repeat('s', 200), repeat('b', 8000), pg_temp.fx('alice'))$$, 'a 200-character subject and an 8000-character message are accepted');

insert into zz_r select 'a1', hq.create_email_draft('thank_you', E'Thank you\r\nfor   today', E'Hi Alice,\r\n\r\nThank you for meeting me today.\r\n', pg_temp.fx('alice'));
select is((select to_email::text from hq.email_drafts where id = pg_temp.eid('a1')), 'alice@alpha.test', 'the address is copied from the contact record');
select is((select to_name from hq.email_drafts where id = pg_temp.eid('a1')), 'Alice Anders', 'the name is copied from the contact record');
select is((select reply_to_email::text from hq.email_drafts where id = pg_temp.eid('a1')), 'dir@hq.test', 'Reply-To is the drafter''s own staff email');
select is((select subject from hq.email_drafts where id = pg_temp.eid('a1')), 'Thank you for today', 'the subject is one line (line breaks and repeated spaces collapse)');
select is((select body_text from hq.email_drafts where id = pg_temp.eid('a1')), E'Hi Alice,\n\nThank you for meeting me today.', 'the message keeps its paragraphs, CR LF becomes LF, and it is trimmed');
select is((select created_via || '/' || coalesce(mcp_client_id, '-') from hq.email_drafts where id = pg_temp.eid('a1')), 'hq/-', 'a browser session drafts with created_via hq');
select ok((select v ->> 'ref' from zz_r where k = 'a1') ~ '^EML-\d{4,}$', 'the result carries the EML number');
select is(pg_temp.st(pg_temp.eid('a1')), 'draft', 'a new email is a draft');
insert into zz_r select 's1', hq.create_email_draft('general', 'Rota', 'See you Monday.', null, pg_temp.fx('pm'));
select is((select to_email::text || ' ' || to_name from hq.email_drafts where id = pg_temp.eid('s1')), 'pm@hq.test Pat Manager', 'a staff recipient: address and name from the staff record');

-- direct writes are refused, for the API and (for the fixed fields) for the owner too
select throws_ok($$insert into hq.email_drafts (created_by, recipient_contact_id, to_email, to_name, subject, body_text, reply_to_email) values (pg_temp.fx('dir'), pg_temp.fx('alice'), 'x@y.test', 'X', 'S', 'B', 'dir@hq.test')$$, '42501', null, 'authenticated cannot insert directly');
select throws_ok($$update hq.email_drafts set to_email = 'evil@attacker.test' where id = pg_temp.eid('a1')$$, '42501', null, 'authenticated cannot update directly');
select pg_temp.unbecome();
select throws_ok($$update hq.email_drafts set to_email = 'evil@attacker.test' where id = pg_temp.eid('a1')$$, '42501', 'the sender and recipient of an email cannot change: discard it and draft a new one', 'even the table owner cannot change the address');
select throws_ok($$update hq.email_drafts set status = 'sent', sent_at = now() where id = pg_temp.eid('a1')$$, '23514', null, 'even the table owner cannot jump a draft to sent');
select throws_ok($$delete from hq.email_drafts where id = pg_temp.eid('a1')$$, '42501', null, 'an email is never deleted');
select throws_ok($$insert into hq.email_drafts (created_by, recipient_contact_id, to_email, to_name, subject, body_text, reply_to_email, status) values (pg_temp.fx('dir'), pg_temp.fx('alice'), 'alice@alpha.test', 'A', 'S', 'B', 'dir@hq.test', 'approved')$$, '23514', null, 'a new row must start as a draft');

-- ------------------------------------------------------------ editing (own, only while a draft)
select pg_temp.become('dir');
select is((select (hq.update_email_draft(pg_temp.eid('a1'), p_subject => 'Thank you for your time') ->> 'changed')::boolean), true, 'the drafter can edit the subject');
select is((select (hq.update_email_draft(pg_temp.eid('a1'), p_subject => 'Thank you for your time') ->> 'changed')::boolean), false, 'an edit that changes nothing says so');
select is(pg_temp.audits(pg_temp.eid('a1'), 'update'), 1::bigint, 'one audit row for the one real edit');
select pg_temp.become('adm');
select throws_ok($$select hq.update_email_draft(pg_temp.eid('a1'), p_subject => 'forged')$$, '42501', 'only the person who drafted this email can do that', 'an administrator (who can see it) cannot edit someone else''s draft');
select pg_temp.become('va');
select throws_ok($$select hq.update_email_draft(pg_temp.eid('a1'), p_subject => 'forged')$$, 'P0002', null, 'someone who cannot see it gets not found');
select pg_temp.unbecome();
select is((select subject from hq.email_drafts where id = pg_temp.eid('a1')), 'Thank you for your time', 'the subject is unchanged by the forged edits');

-- ------------------------------------------------------------ approval and the send status machine
select pg_temp.become('dir');
select throws_ok($$select hq.begin_email_send(pg_temp.eid('a1'), 'hq')$$, '42501', 'this email has not been approved: open it in HQ and tap Approve and send', 'an unapproved draft cannot be sent');
select is(pg_temp.st(pg_temp.eid('a1')), 'draft', '...and stays a draft');
select is((select hq.approve_email_draft(pg_temp.eid('a1')) ->> 'status'), 'approved', 'the creator (with email.send) may approve their own draft');
select is((select approved_by from hq.email_drafts where id = pg_temp.eid('a1')), pg_temp.fx('dir'), 'approved_by is the caller');
select throws_ok($$select hq.approve_email_draft(pg_temp.eid('a1'))$$, '22023', null, 'an approved email cannot be approved again');
select throws_ok($$select hq.update_email_draft(pg_temp.eid('a1'), p_body => 'changed after approval')$$, '22023', 'only a draft waiting for approval can be edited; this email is approved', 'an approved email cannot be edited');
select throws_ok($$select hq.begin_email_send(pg_temp.eid('a1'), 'chat')$$, '42501', 'that send channel does not match this session', 'a browser session cannot claim to be a chat app');
insert into zz_r select 'b1', hq.begin_email_send(pg_temp.eid('a1'), 'hq');
select is((select v ->> 'status' from zz_r where k = 'b1'), 'sending', 'begin_email_send flips it to sending');
select is((select v ->> 'to_email' || '|' || (v ->> 'reply_to_email') || '|' || (v ->> 'sender_name') || '|' || (v ->> 'sender_role') from zz_r where k = 'b1'),
  'alice@alpha.test|dir@hq.test|Dana Director|director', '...and returns the address, Reply-To, and the sender''s name and role');
select is((select v ->> 'body_text' from zz_r where k = 'b1'), E'Hi Alice,\n\nThank you for meeting me today.', '...and the message to send');
select throws_ok($$select hq.begin_email_send(pg_temp.eid('a1'), 'hq')$$, '22023', 'this email is already sending', 'a second begin while sending is refused (no double send)');
select throws_ok($$select hq.discard_email_draft(pg_temp.eid('a1'))$$, '22023', 'this email is being sent right now; wait a few minutes', 'a send in progress cannot be discarded');
select pg_temp.become('dir2');
select throws_ok($$select hq.finish_email_send(pg_temp.eid('a1'), true, 'x')$$, '42501', null, 'a former director cannot finish the send');
select pg_temp.become('adm');
select throws_ok($$select hq.finish_email_send(pg_temp.eid('a1'), true, 'forged-id')$$, '22023', 'this email is not being sent by you', 'only the person who began the send can finish it');
select pg_temp.become('dir');
select lives_ok($$insert into zz_r select 'f1', hq.finish_email_send(pg_temp.eid('a1'), true, 'sg-Abc.123_x', null)$$, 'finish_email_send records the send');
select pg_temp.unbecome();
select is(pg_temp.st(pg_temp.eid('a1')), 'sent', 'the email is sent');
select ok((select sent_at is not null and provider_message_id = 'sg-Abc.123_x' and sent_by = pg_temp.fx('dir') and send_via = 'hq' from hq.email_drafts where id = pg_temp.eid('a1')), 'sent_at, the provider message id, the sender and the channel are recorded');
select is((select count(*) from hq.interactions i join hq.email_drafts d on d.interaction_id = i.id
           where d.id = pg_temp.eid('a1') and i.contact_id = pg_temp.fx('alice') and i.interaction_type = 'email' and i.summary = 'Email sent: Thank you for your time' and i.staff_id = pg_temp.fx('dir')),
  1::bigint, 'one email interaction on the contact''s timeline: "Email sent: <subject>"');
select ok((select last_contact_at > now() - interval '1 minute' from hq.contacts where id = pg_temp.fx('alice')), 'the contact''s last contact moves to now');
select pg_temp.become('dir');
select throws_ok($$select hq.finish_email_send(pg_temp.eid('a1'), true, 'again')$$, '22023', 'this email is not being sent by you', 'finishing twice is refused');
select throws_ok($$select hq.begin_email_send(pg_temp.eid('a1'), 'hq')$$, '22023', 'this email is already sent', 'a sent email cannot be sent again');
select throws_ok($$select hq.approve_email_draft(pg_temp.eid('a1'))$$, '22023', null, 'a sent email cannot be re-approved');
select throws_ok($$select hq.discard_email_draft(pg_temp.eid('a1'))$$, '22023', 'this email is already sent and cannot be discarded', 'a sent email cannot be discarded');
select pg_temp.unbecome();
select throws_ok($$update hq.email_drafts set status = 'failed' where id = pg_temp.eid('a1')$$, '23514', 'this email is sent and can no longer change', 'a sent email is closed even for the owner');
select is((select string_agg(action, ',' order by id) from hq.audit_events where entity_type = 'email_draft' and entity_id = pg_temp.eid('a1')),
  'create,update,approve,send_start,sent', 'the audit trail: create, update, approve, send_start, sent');
select ok(not exists (select 1 from hq.audit_events where entity_type = 'email_draft' and (summary like '%meeting me today%' or changes::text like '%alice@alpha.test%')),
  'audit rows hold neither the message nor the address');

-- a staff recipient: sent, no timeline entry
select pg_temp.become('dir');
select lives_ok($$select hq.approve_email_draft(pg_temp.eid('s1')); select hq.begin_email_send(pg_temp.eid('s1'), 'hq'); select hq.finish_email_send(pg_temp.eid('s1'), true, 'sg-2')$$, 'an email to a member of staff is approved and sent');
select pg_temp.unbecome();
select ok((select status = 'sent' and interaction_id is null from hq.email_drafts where id = pg_temp.eid('s1')), 'an email to staff writes no interaction');

-- ------------------------------------------------------------ the record's address changed: refused at send
select pg_temp.become('bdm');
insert into zz_r select 'bob1', hq.create_email_draft('follow_up', 'Following up', 'Hi Bob, following up.', pg_temp.fx('bob'));
select is((select hq.approve_email_draft(pg_temp.eid('bob1')) ->> 'status'), 'approved', 'a business development manager approves their own draft');
insert into zz_r select 'bob2', hq.create_email_draft('follow_up', 'Second', 'Hi Bob.', pg_temp.fx('bob'));
select pg_temp.unbecome();
update hq.contacts set email = 'bob.new@beta.test' where id = pg_temp.fx('bob');
select pg_temp.become('bdm');
select throws_ok($$select hq.begin_email_send(pg_temp.eid('bob1'), 'hq')$$, '22023', 'not sent: the email address on the record has changed since this was drafted. Discard it and draft a new one', 'a changed record address refuses the send');
select is(pg_temp.st(pg_temp.eid('bob1')), 'approved', '...and nothing changed');
select throws_ok($$select hq.approve_email_draft(pg_temp.eid('bob2'))$$, '22023', 'not approved: the email address on the record has changed since this was drafted. Discard it and draft a new one', 'approval is refused too');
select pg_temp.unbecome();
update hq.contacts set email = null where id = pg_temp.fx('bob');
select pg_temp.become('bdm');
select throws_ok($$select hq.begin_email_send(pg_temp.eid('bob1'), 'hq')$$, '22023', 'not sent: the record no longer has an email address. Discard it and draft a new one', 'an address removed from the record refuses the send');
select pg_temp.unbecome();
update hq.contacts set email = 'bob@beta.test' where id = pg_temp.fx('bob');
update hq.contacts set deleted_at = now() where id = pg_temp.fx('bob');
select pg_temp.become('bdm');
select throws_ok($$select hq.begin_email_send(pg_temp.eid('bob1'), 'hq')$$, '22023', 'not sent: the contact has been archived. Discard it and draft a new one', 'an archived contact refuses the send');
select is((select (hq.discard_email_draft(pg_temp.eid('bob1'), 'contact archived') ->> 'status')), 'discarded', 'the drafter discards it');
select throws_ok($$select hq.update_email_draft(pg_temp.eid('bob1'), p_subject => 'x')$$, '22023', null, 'a discarded email cannot be edited');
select throws_ok($$select hq.approve_email_draft(pg_temp.eid('bob1'))$$, '22023', null, 'a discarded email cannot be approved');
select pg_temp.unbecome();
update hq.contacts set deleted_at = null where id = pg_temp.fx('bob');
-- a staff recipient who leaves
select pg_temp.become('dir');
insert into zz_r select 's2', hq.create_email_draft('general', 'Hello', 'Hi Sam.', null, pg_temp.fx('spm'));
select hq.approve_email_draft(pg_temp.eid('s2'));
select pg_temp.unbecome();
update hq.staff_profiles set employment_status = 'on_leave' where id = pg_temp.fx('spm');
select pg_temp.become('dir');
select throws_ok($$select hq.begin_email_send(pg_temp.eid('s2'), 'hq')$$, '22023', 'not sent: that member of staff is no longer active. Discard it and draft a new one', 'a staff recipient no longer active refuses the send');
select pg_temp.unbecome();
update hq.staff_profiles set employment_status = 'active' where id = pg_temp.fx('spm');

-- ------------------------------------------------------------ a failed send is retried only by a new approval
select pg_temp.become('dir');
insert into zz_r select 'fail', hq.create_email_draft('general', 'Retry me', 'Hello Alice.', pg_temp.fx('alice'));
select hq.approve_email_draft(pg_temp.eid('fail'));
select hq.begin_email_send(pg_temp.eid('fail'), 'hq');
select is((select hq.finish_email_send(pg_temp.eid('fail'), false, null, 'timeout') ->> 'status'), 'failed', 'a provider failure marks it failed');
select is((select error_code from hq.email_drafts where id = pg_temp.eid('fail')), 'timeout', 'with a short error code');
select ok((select interaction_id is null and sent_at is null from hq.email_drafts where id = pg_temp.eid('fail')), 'a failed send writes no timeline entry');
select throws_ok($$select hq.begin_email_send(pg_temp.eid('fail'), 'hq')$$, '22023', 'this email is failed; approve it again in HQ to retry', 'a failed email cannot simply be sent again');
select is((select hq.approve_email_draft(pg_temp.eid('fail')) ->> 'status'), 'approved', 'a new approval makes it sendable');
select is((select error_code from hq.email_drafts where id = pg_temp.eid('fail')), null, '...and clears the error code');
select is((select hq.begin_email_send(pg_temp.eid('fail'), 'hq') ->> 'status'), 'sending', 'the retry begins');
select is((select hq.finish_email_send(pg_temp.eid('fail'), false, 'bad id with spaces', 'Not A Code! alice@alpha.test') ->> 'error_code'), 'provider_error', 'an error that is not a short code is stored as provider_error (no free text, no address)');
select pg_temp.unbecome();
select is((select provider_message_id from hq.email_drafts where id = pg_temp.eid('fail')), null, 'a message id with unsafe characters is not stored');

-- a stuck send (the server stopped between begin and finish) can be discarded after 15 minutes
select pg_temp.become('dir');
insert into zz_r select 'stuck', hq.create_email_draft('general', 'Stuck', 'Hello.', pg_temp.fx('alice'));
select hq.approve_email_draft(pg_temp.eid('stuck'));
select hq.begin_email_send(pg_temp.eid('stuck'), 'hq');
select pg_temp.unbecome();
alter table hq.email_drafts disable trigger email_draft_guard;
update hq.email_drafts set send_started_at = now() - interval '16 minutes' where id = pg_temp.eid('stuck');
alter table hq.email_drafts enable trigger email_draft_guard;
select pg_temp.become('dir');
select is((select hq.discard_email_draft(pg_temp.eid('stuck')) ->> 'status'), 'discarded', 'a send stuck for 15 minutes can be discarded');
select pg_temp.unbecome();

-- ------------------------------------------------------------ approval rules and who may send
select pg_temp.become('va');
insert into zz_r select 'va1', hq.create_email_draft('introduction', 'Introducing', 'Hello Alice.', pg_temp.fx('alice'));
select throws_ok($$select hq.approve_email_draft(pg_temp.eid('va1'))$$, '42501', null, 'a virtual assistant cannot approve (no email.send), not even their own');
select throws_ok($$select hq.begin_email_send(pg_temp.eid('va1'), 'hq')$$, '42501', null, 'a virtual assistant cannot send');
select pg_temp.become('spm');
select throws_ok($$select hq.approve_email_draft(pg_temp.eid('va1'))$$, '42501', null, 'a senior property manager cannot approve (no email.send)');
select pg_temp.become('bdm');
select throws_ok($$select hq.approve_email_draft(pg_temp.eid('va1'))$$, 'P0002', null, 'a business development manager cannot approve a draft they cannot see');
select pg_temp.become('dir');
select is((select hq.approve_email_draft(pg_temp.eid('va1')) ->> 'status'), 'approved', 'a director approves the virtual assistant''s draft');
select pg_temp.become('adm');
select throws_ok($$select hq.begin_email_send(pg_temp.eid('va1'), 'hq')$$, '42501', 'only the person who drafted or approved this email can send it', 'an administrator who neither drafted nor approved it cannot send it');
select pg_temp.become('dir');
select is((select hq.begin_email_send(pg_temp.eid('va1'), 'hq') ->> 'sender_name'), 'Val Assistant', 'the approver sends it; it is signed by (and replies go to) the person who drafted it');
select hq.finish_email_send(pg_temp.eid('va1'), true, 'sg-va');
select pg_temp.become('adm');
select throws_ok($$select hq.discard_email_draft(pg_temp.eid('s2'))$$, '42501', 'only the person who drafted this email can do that', 'an administrator cannot discard someone else''s draft');
select pg_temp.become('dir2', 'aal2');
select throws_ok($$select hq.discard_email_draft(pg_temp.eid('s2'))$$, '42501', null, 'a director who has left cannot discard');
select pg_temp.unbecome();

-- ------------------------------------------------------------ RLS visibility
select pg_temp.become('va');
select is((select count(*) from hq.email_drafts), (select count(*) from hq.email_drafts where created_by = pg_temp.fx('va')), 'a virtual assistant sees only their own emails');
select is((select count(*) from hq.email_drafts), 1::bigint, '...which is one');
select pg_temp.become('bdm');
select is((select count(*) from hq.email_drafts where created_by <> pg_temp.fx('bdm')), 0::bigint, 'a business development manager sees only their own emails');
select pg_temp.become('dir');
select ok((select count(*) from hq.email_drafts where created_by = pg_temp.fx('va')) = 1 and (select count(*) from hq.email_drafts where created_by = pg_temp.fx('bdm')) = 2, 'a director (audit.read) sees everyone''s');
select pg_temp.become('ro');
select is((select count(*) from hq.email_drafts), 0::bigint, 'read_only sees no email');
select pg_temp.become('jpm');
select is((select count(*) from hq.email_drafts), 0::bigint, 'a junior property manager sees no email');
select pg_temp.become('dir', 'aal1');
select is((select count(*) from hq.email_drafts), 0::bigint, 'a director at aal1 with require_mfa sees no email');
select pg_temp.unbecome();

-- ------------------------------------------------------------ the daily send limit (boundary)
update hq.settings set value = '3'::jsonb where key = 'email_daily_limit';
select pg_temp.become('bdm');
-- bdm has started no send today; three are allowed (one of them fails: attempts count), the fourth is refused
insert into zz_r select 'c1', hq.create_email_draft('general', 'One', 'Hi Tim.', pg_temp.fx('tim'));
insert into zz_r select 'c2', hq.create_email_draft('general', 'Two', 'Hi Tim.', pg_temp.fx('tim'));
insert into zz_r select 'c3', hq.create_email_draft('general', 'Three', 'Hi Tim.', pg_temp.fx('tim'));
insert into zz_r select 'c4', hq.create_email_draft('general', 'Four', 'Hi Tim.', pg_temp.fx('tim'));
select hq.approve_email_draft(pg_temp.eid(k)) from (values ('c1'), ('c2'), ('c3'), ('c4')) v(k);
select hq.begin_email_send(pg_temp.eid('c1'), 'hq');
select hq.finish_email_send(pg_temp.eid('c1'), false, null, 'provider_rejected');
select hq.begin_email_send(pg_temp.eid('c2'), 'hq');
select hq.finish_email_send(pg_temp.eid('c2'), true, 'sg-c2');
select is((select (hq.begin_email_send(pg_temp.eid('c3'), 'hq') ->> 'sent_today')::integer), 3, 'the third send of the day (limit 3) is allowed');
select hq.finish_email_send(pg_temp.eid('c3'), true, 'sg-c3');
select throws_ok($$select hq.begin_email_send(pg_temp.eid('c4'), 'hq')$$, '54000', 'daily email limit reached (3 per person per day)', 'the fourth is refused, failed attempts included');
select is(pg_temp.st(pg_temp.eid('c4')), 'approved', '...and stays approved, to send tomorrow');
select pg_temp.become('adm');
insert into zz_r select 'adm1', hq.create_email_draft('general', 'From Ada', 'Hi Tim.', pg_temp.fx('tim'));
select hq.approve_email_draft(pg_temp.eid('adm1'));
select is((select hq.begin_email_send(pg_temp.eid('adm1'), 'hq') ->> 'status'), 'sending', 'the limit is per person: another person can still send');
select pg_temp.unbecome();
update hq.settings set value = '20'::jsonb where key = 'email_daily_limit';

-- ------------------------------------------------------------ the hourly draft limit (boundary)
select pg_temp.become('pm');
do $$
begin
  while (select count(*) from hq.email_drafts where created_by = auth.uid() and created_at > now() - interval '1 hour') < 30 loop
    perform hq.create_email_draft('general', 'Bulk', 'Hello.', pg_temp.fx('tim'));
  end loop;
end $$;
select is((select count(*) from hq.email_drafts where created_by = pg_temp.fx('pm')), 30::bigint, 'thirty drafts in an hour are allowed');
select throws_ok($$select hq.create_email_draft('general', 'One more', 'Hello.', pg_temp.fx('tim'))$$, '54000', 'at most 30 email drafts per hour', 'the thirty-first is refused');
select pg_temp.unbecome();

-- ------------------------------------------------------------ connected chat apps and chat-send mode
select pg_temp.become_app('dir', 'client-a');
insert into zz_r select 'm1', hq.create_email_draft('thank_you', 'Thanks from chat', 'Hi Tim, thank you.', pg_temp.fx('tim'));
select is((select created_via || '/' || mcp_client_id from hq.email_drafts where id = pg_temp.eid('m1')), 'mcp/client-a', 'a draft made through a connected app is created_via mcp with the app''s client id');
select throws_ok($$select hq.approve_email_draft(pg_temp.eid('m1'))$$, '42501', 'an email is approved in HQ, not through a connected app', 'a connected app cannot approve');
select throws_ok($$select hq.begin_email_send(pg_temp.eid('m1'), 'hq')$$, '42501', 'that send channel does not match this session', 'a connected app cannot claim to be HQ');
select throws_ok($$select hq.begin_email_send(pg_temp.eid('m1'), 'chat')$$, '42501', 'this email has not been approved: open it in HQ and tap Approve and send', 'chat-send mode off: an unapproved draft is refused');
select is(pg_temp.st(pg_temp.eid('m1')), 'draft', '...and stays a draft');
select pg_temp.become('adm');
update hq.settings set value = 'true'::jsonb where key = 'email_chat_send_enabled';
select is((select value from hq.settings where key = 'email_chat_send_enabled'), 'false'::jsonb, 'an administrator cannot switch chat sending on (settings.admin: the update matches no row)');
select pg_temp.become('dir');
select lives_ok($$update hq.settings set value = 'true'::jsonb where key = 'email_chat_send_enabled'$$, 'a director switches chat sending on');
select throws_ok($$update hq.settings set value = '"yes"'::jsonb where key = 'email_chat_send_enabled'$$, '22023', 'email_chat_send_enabled must be true or false', 'the switch is true or false');
select throws_ok($$update hq.settings set value = '0'::jsonb where key = 'email_daily_limit'$$, '22023', 'email_daily_limit must be a whole number from 1 to 200', 'the daily limit is at least 1');
select throws_ok($$update hq.settings set value = '201'::jsonb where key = 'email_daily_limit'$$, '22023', 'email_daily_limit must be a whole number from 1 to 200', 'the daily limit is at most 200');
select lives_ok($$update hq.settings set value = '200'::jsonb where key = 'email_daily_limit'$$, '200 is allowed');
select throws_ok($$update hq.settings set value = '"20"'::jsonb where key = 'email_daily_limit'$$, '22023', null, 'the daily limit is a number, not text');
select lives_ok($$update hq.settings set value = '20'::jsonb where key = 'email_daily_limit'$$, '...back to 20');
select throws_ok($$select hq.begin_email_send(pg_temp.eid('m1'), 'hq')$$, '42501', 'this email has not been approved: open it in HQ and tap Approve and send', 'chat-send mode on: HQ still needs the approval tap');
select pg_temp.become_app('dir', 'client-b');
select throws_ok($$select hq.begin_email_send(pg_temp.eid('m1'), 'chat')$$, '42501', null, 'chat-send mode on: a different app cannot send it');
select pg_temp.become_app('bdm', 'client-a');
select throws_ok($$select hq.begin_email_send(pg_temp.eid('m1'), 'chat')$$, 'P0002', null, 'chat-send mode on: another person cannot send it');
select pg_temp.become_app('dir', 'client-a');
select throws_ok($$select hq.begin_email_send(pg_temp.eid('max'), 'chat')$$, '42501', null, 'chat-send mode on: a draft made in HQ (not through the app) still needs approval');
select is((select hq.begin_email_send(pg_temp.eid('m1'), 'chat') ->> 'status'), 'sending', 'chat-send mode on: the same person and app may send an unapproved draft it made in the last 30 minutes');
select ok((select send_via = 'chat' and approved_by is null from hq.email_drafts where id = pg_temp.eid('m1')), '...recorded as sent through chat, with no approver');
select throws_ok($$select hq.begin_email_send(pg_temp.eid('m1'), 'chat')$$, '22023', 'this email is already sending', '...once');
select is((select hq.finish_email_send(pg_temp.eid('m1'), true, 'sg-m1') ->> 'status'), 'sent', 'and the app''s session finishes it');
insert into zz_r select 'm2', hq.create_email_draft('thank_you', 'Old chat draft', 'Hi Tim.', pg_temp.fx('tim'));
select pg_temp.unbecome();
alter table hq.email_drafts disable trigger email_draft_guard;
update hq.email_drafts set created_at = now() - interval '31 minutes' where id = pg_temp.eid('m2');
alter table hq.email_drafts enable trigger email_draft_guard;
select pg_temp.become_app('dir', 'client-a');
select throws_ok($$select hq.begin_email_send(pg_temp.eid('m2'), 'chat')$$, '42501', 'this email has not been approved: open it in HQ and tap Approve and send', 'chat-send mode on: a draft older than 30 minutes needs approval');
select pg_temp.become_app('va', 'client-v');
insert into zz_r select 'mv', hq.create_email_draft('general', 'VA chat', 'Hi Tim.', pg_temp.fx('tim'));
select throws_ok($$select hq.begin_email_send(pg_temp.eid('mv'), 'chat')$$, '42501', null, 'chat-send mode on: a role without email.send still cannot send');
select pg_temp.become('dir');
select is((select hq.approve_email_draft(pg_temp.eid('m2')) ->> 'status'), 'approved', 'the old chat draft is approved in HQ');
select pg_temp.become_app('dir', 'client-a');
select is((select hq.begin_email_send(pg_temp.eid('m2'), 'chat') ->> 'status'), 'sending', 'an APPROVED draft can be sent from chat');
select pg_temp.unbecome();
update hq.settings set value = 'false'::jsonb where key = 'email_chat_send_enabled';
select is((select count(*) from hq.audit_events where entity_type = 'setting' and summary like '%email_chat_send_enabled%' and actor_id = pg_temp.fx('dir')), 1::bigint, 'the director switching chat sending on is audited');

select * from finish();
rollback;
