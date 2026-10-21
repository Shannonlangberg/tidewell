-- Planted HQ: email to someone HQ does not hold yet (migrations 0146, 0147).
-- A typed address plus a name becomes a contact first (needs_verification, source 'email draft'), then the
-- draft runs as before. Covers: the one signature surface and its privileges, a new contact, reuse of an
-- existing contact (any case), the staff-address path, an archived contact's address, bad address shapes,
-- a missing or bad name, exactly one recipient, roles without growth.write, the per-hour new-contact cap,
-- the audit rows, a send writing the new contact's timeline entry, and chat sending: refused for a draft
-- whose contact still needs verification (new or imported), allowed once a person verifies the contact,
-- and approval from a connected app still refused. A connected chat app is a session whose claims carry
-- client_id (as in hq_12). NOTE: never CALL a function a hint role lacks execute on (see hq_01).
begin;
\ir hq_fixture.inc
select pg_temp.seed_hq();
select plan(105);

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
create function pg_temp.cid(p_k text) returns uuid language sql stable as $$ select (v ->> 'contact_id')::uuid from zz_r where k = p_k $$;
create function pg_temp.st(p_id uuid) returns text language sql stable security definer as $$ select status::text from hq.email_drafts where id = p_id $$;
create function pg_temp.n_contacts(p_email text) returns bigint language sql stable security definer as $$
  select count(*) from hq.contacts where email = p_email::extensions.citext and deleted_at is null $$;
grant execute on function pg_temp.st(uuid), pg_temp.eid(text), pg_temp.cid(text), pg_temp.n_contacts(text) to public;

update hq.settings set value = '20'::jsonb where key = 'email_daily_limit';
update hq.settings set value = 'false'::jsonb where key = 'email_chat_send_enabled';

-- a verified contact with an address, an archived contact, a flagged (imported-style) contact
insert into hq.contacts (full_name, email) values ('Vera Verified', 'vera@partner.test');
insert into fx select 'vera', id from hq.contacts where email = 'vera@partner.test' and deleted_at is null;
insert into hq.contacts (full_name, email) values ('Archie Archived', 'archie@old.test');
insert into fx select 'archie', id from hq.contacts where email = 'archie@old.test' and deleted_at is null;
update hq.contacts set deleted_at = now() where id = pg_temp.fx('archie');
insert into hq.contacts (full_name, email, needs_verification, source) values ('Ivy Imported', 'ivy@imported.test', true, 'research');
insert into fx select 'ivy', id from hq.contacts where email = 'ivy@imported.test' and deleted_at is null;

-- ------------------------------------------------------------ the signature surface
select is((select count(*) from pg_proc where pronamespace = 'hq'::regnamespace and proname = 'create_email_draft'), 1::bigint, 'there is ONE create_email_draft (the old signature was dropped, not overloaded)');
select ok(to_regprocedure('hq.create_email_draft(hq.email_template, text, text, uuid, uuid, uuid)') is null, 'the six-argument form no longer exists');
select ok((select prosecdef and proconfig::text like '%search_path=pg_catalog, public, extensions%' from pg_proc where oid = 'hq.create_email_draft(hq.email_template, text, text, uuid, uuid, uuid, text, text)'::regprocedure), 'create_email_draft is security definer with a pinned search_path');
select ok(has_function_privilege('authenticated', 'hq.create_email_draft(hq.email_template, text, text, uuid, uuid, uuid, text, text)', 'execute'), 'authenticated can execute create_email_draft');
select ok(not has_function_privilege('anon', 'hq.create_email_draft(hq.email_template, text, text, uuid, uuid, uuid, text, text)', 'execute')
          and not has_function_privilege('service_role', 'hq.create_email_draft(hq.email_template, text, text, uuid, uuid, uuid, text, text)', 'execute'), 'anon and service_role cannot execute it');
select ok(has_function_privilege('authenticated', 'hq.begin_email_send(uuid, text)', 'execute') and not has_function_privilege('anon', 'hq.begin_email_send(uuid, text)', 'execute'), 'begin_email_send keeps its privileges');

-- ------------------------------------------------------------ a typed address makes a contact (director, in HQ)
select pg_temp.become('dir');
insert into zz_r select 'n1', hq.create_email_draft('introduction', 'Hello from PLANTED.', E'Hi Jane,\n\nNice to meet you.', null, null, null, '  Jane.Citizen@Example.TEST ', '  Jane Citizen ');
select is((select (v ->> 'new_contact')::boolean from zz_r where k = 'n1'), true, 'the result says a contact was created');
select is((select v ->> 'status' from zz_r where k = 'n1'), 'draft', '...and the email is a draft');
select is(pg_temp.n_contacts('jane.citizen@example.test'), 1::bigint, 'one live contact now holds the address');
select is((select email::text || '|' || full_name || '|' || source || '|' || contact_kind::text from hq.contacts where id = pg_temp.cid('n1')),
  'jane.citizen@example.test|Jane Citizen|email draft|other', 'the contact: lower-cased address, trimmed name, source email draft, kind other');
select ok((select needs_verification and verified_at is null and verified_by is null from hq.contacts where id = pg_temp.cid('n1')), 'the contact needs verification');
select ok((select created_by = pg_temp.fx('dir') and organisation_id is null and relationship_owner_id is null and categories = '{}' and relationship_status = 'identified' and last_contact_at is null from hq.contacts where id = pg_temp.cid('n1')),
  'created by the caller; every other column left at its default');
select is((select recipient_contact_id from hq.email_drafts where id = pg_temp.eid('n1')), pg_temp.cid('n1'), 'the draft points at the new contact');
select ok((select recipient_staff_id is null and to_email::text = 'jane.citizen@example.test' and to_name = 'Jane Citizen' and created_via = 'hq' and mcp_client_id is null from hq.email_drafts where id = pg_temp.eid('n1')), 'the draft copies the address and name, made in HQ, no staff recipient');
select is((select reply_to_email::text from hq.email_drafts where id = pg_temp.eid('n1')), 'dir@hq.test', 'Reply-To is still the drafter');
select is(pg_temp.st(pg_temp.eid('n1')), 'draft', 'it waits for approval');
select pg_temp.unbecome();

-- the audit trail: the contact's creation and the draft
select is((select count(*) from hq.audit_events where entity_type = 'contact' and entity_id = pg_temp.cid('n1') and action = 'create' and actor_id = pg_temp.fx('dir') and summary like '%added from an email draft%'),
  1::bigint, 'one audit row for the contact''s creation, with its reason');
select is((select count(*) from hq.audit_events where entity_type = 'email_draft' and entity_id = pg_temp.eid('n1') and action = 'create' and summary like '%(a new contact)%'),
  1::bigint, 'one audit row for the draft, saying it came with a new contact');
select ok(not exists (select 1 from hq.audit_events where entity_type = 'email_draft' and (summary like '%@%' or changes::text like '%@%' or changes::text like '%Nice to meet%')),
  'draft audit rows hold neither an address nor the message');

-- ------------------------------------------------------------ reuse: never a duplicate
select pg_temp.become('bdm');
insert into zz_r select 'n2', hq.create_email_draft('general', 'Second email', 'Hi again.', null, null, null, 'JANE.CITIZEN@example.test', 'Someone Else Entirely');
select is((select (v ->> 'new_contact')::boolean from zz_r where k = 'n2'), false, 'the same address typed again (any case, any name) creates nothing');
select is(pg_temp.cid('n2'), pg_temp.cid('n1'), '...and reuses the same contact');
select is(pg_temp.n_contacts('jane.citizen@example.test'), 1::bigint, '...so there is still ONE contact for the address');
select is((select to_name from hq.email_drafts where id = pg_temp.eid('n2')), 'Jane Citizen', '...and the draft uses the name on the record, not the typed one');
select ok((select needs_verification from hq.contacts where id = pg_temp.cid('n1')), 'reusing a contact does not verify it');
insert into zz_r select 'n3', hq.create_email_draft('general', 'Hi Vera', 'Hi Vera.', null, null, null, 'VERA@Partner.test', 'Vera V');
select ok((select not (v ->> 'new_contact')::boolean and (v ->> 'contact_id')::uuid = pg_temp.fx('vera') from zz_r where k = 'n3'), 'an existing verified contact is reused too');
select is((select to_name from hq.email_drafts where id = pg_temp.eid('n3')), 'Vera Verified', '...with the name on its record');
select pg_temp.unbecome();
select is((select count(*) from hq.audit_events where entity_type = 'contact' and action = 'create' and summary like '%added from an email draft%'), 1::bigint, 'reuse writes no second contact audit row');

-- ------------------------------------------------------------ the staff-address path
select pg_temp.become('dir');
insert into zz_r select 's1', hq.create_email_draft('general', 'Rota', 'See you Monday.', null, null, null, 'PM@hq.test', 'Pat M');
select ok((select (v ->> 'new_contact')::boolean = false and (v ->> 'contact_id') is null from zz_r where k = 's1'), 'an active staff address takes the staff path: no contact, new_contact false');
select ok((select recipient_staff_id = pg_temp.fx('pm') and recipient_contact_id is null and to_name = 'Pat Manager' and to_email::text = 'pm@hq.test' from hq.email_drafts where id = pg_temp.eid('s1')), 'the draft goes to the staff record, with the staff name');
select is(pg_temp.n_contacts('pm@hq.test'), 0::bigint, 'no contact was made for a member of staff');
select pg_temp.unbecome();
update hq.staff_profiles set employment_status = 'ended' where id = pg_temp.fx('dir2');
select pg_temp.become('dir');
insert into zz_r select 'x1', hq.create_email_draft('general', 'Hello Dev', 'Hi Dev.', null, null, null, 'dir2@hq.test', 'Dev Former');
select ok((select (v ->> 'new_contact')::boolean from zz_r where k = 'x1'), 'a staff address that is no longer active is a new contact (the staff record is not used)');

-- an archived contact's address is free again
insert into zz_r select 'x2', hq.create_email_draft('general', 'Hello again', 'Hi.', null, null, null, 'archie@old.test', 'Archie Returns');
select ok((select (v ->> 'new_contact')::boolean and pg_temp.cid('x2') <> pg_temp.fx('archie') from zz_r where k = 'x2'), 'an archived contact''s address makes a new live contact');
select is(pg_temp.n_contacts('archie@old.test'), 1::bigint, '...and exactly one live contact holds it');
select pg_temp.unbecome();

-- ------------------------------------------------------------ bad addresses
select pg_temp.become('dir');
select throws_ok($$select hq.create_email_draft('general', 'Hi', 'Body', null, null, null, 'not-an-address', 'Bad One')$$, '22023', 'that does not look like an email address: check it and try again', 'no @ is refused');
select throws_ok($$select hq.create_email_draft('general', 'Hi', 'Body', null, null, null, 'bad@nodot', 'Bad One')$$, '22023', 'that does not look like an email address: check it and try again', 'no dot in the domain is refused');
select throws_ok($$select hq.create_email_draft('general', 'Hi', 'Body', null, null, null, 'bad name@c.test', 'Bad One')$$, '22023', 'that does not look like an email address: check it and try again', 'a space inside is refused');
select throws_ok($$select hq.create_email_draft('general', 'Hi', 'Body', null, null, null, 'two@@c.test', 'Bad One')$$, '22023', 'that does not look like an email address: check it and try again', 'a second @ is refused');
select throws_ok($$select hq.create_email_draft('general', 'Hi', 'Body', null, null, null, '@c.test', 'Bad One')$$, '22023', 'that does not look like an email address: check it and try again', 'no local part is refused');
select throws_ok($$select hq.create_email_draft('general', 'Hi', 'Body', null, null, null, E'bad\n@c.test', 'Bad One')$$, '22023', 'that does not look like an email address: check it and try again', 'a line break inside is refused');
select throws_ok($$select hq.create_email_draft('general', 'Hi', 'Body', null, null, null, E'bad\x01@c.test', 'Bad One')$$, '22023', 'that does not look like an email address: check it and try again', 'a control character is refused');
select throws_ok($$select hq.create_email_draft('general', 'Hi', 'Body', null, null, null, '   ', 'Bad One')$$, '22023', 'that does not look like an email address: check it and try again', 'a blank address is refused');
select throws_ok($$select hq.create_email_draft('general', 'Hi', 'Body', null, null, null, repeat('a', 248) || '@c.test', 'Bad One')$$, '22023', 'that does not look like an email address: check it and try again', 'a 255-character address is refused');
select lives_ok($$insert into zz_r select 'len', hq.create_email_draft('general', 'Hi', 'Body', null, null, null, repeat('a', 247) || '@c.test', 'Long Address')$$, 'a 254-character address is accepted');
select is((select count(*) from hq.contacts where source = 'email draft' and full_name = 'Bad One'), 0::bigint, 'a refused address leaves no contact behind');

-- ------------------------------------------------------------ the name
select throws_ok($$select hq.create_email_draft('general', 'Hi', 'Body', null, null, null, 'noname@c.test', null)$$, '22023', 'add the name of the person you are emailing', 'a missing name is refused');
select throws_ok($$select hq.create_email_draft('general', 'Hi', 'Body', null, null, null, 'noname@c.test', '   ')$$, '22023', 'add the name of the person you are emailing', 'a blank name is refused');
select throws_ok($$select hq.create_email_draft('general', 'Hi', 'Body', null, null, null, 'noname@c.test', repeat('n', 201))$$, '22023', 'the name is at most 200 characters', 'a 201-character name is refused');
select throws_ok($$select hq.create_email_draft('general', 'Hi', 'Body', null, null, null, 'noname@c.test', E'Jane\tCitizen')$$, '22023', 'the name must be a plain name on one line', 'a name with a control character is refused');
select throws_ok($$select hq.create_email_draft('general', 'Hi', 'Body', null, null, null, 'noname@c.test', E'Jane\nCitizen')$$, '22023', 'the name must be a plain name on one line', 'a name with a line break is refused');
select throws_ok($$select hq.create_email_draft('general', 'Hi', 'Body', null, null, null, 'noname@c.test', '...')$$, '22023', 'the name must be a plain name on one line', 'a name with no letters or numbers is refused');
select lives_ok($$insert into zz_r select 'nm200', hq.create_email_draft('general', 'Hi', 'Body', null, null, null, 'name200@c.test', repeat('n', 200))$$, 'a 200-character name is accepted');
select is(pg_temp.n_contacts('noname@c.test'), 0::bigint, 'a refused name leaves no contact behind');

-- ------------------------------------------------------------ exactly one recipient
select throws_ok($$select hq.create_email_draft('general', 'Hi', 'Body', pg_temp.fx('vera'), null, null, 'one@c.test', 'One')$$, '22023', 'an email goes to exactly one person: a contact, a member of staff or one typed address', 'a contact and a typed address are refused');
select throws_ok($$select hq.create_email_draft('general', 'Hi', 'Body', null, pg_temp.fx('pm'), null, 'one@c.test', 'One')$$, '22023', 'an email goes to exactly one person: a contact, a member of staff or one typed address', 'a member of staff and a typed address are refused');
select throws_ok($$select hq.create_email_draft('general', 'Hi', 'Body', null, null, null, null, 'Only A Name')$$, '22023', 'an email goes to exactly one person: a contact, a member of staff or one typed address', 'a name with no address is refused');
select throws_ok($$select hq.create_email_draft('general', 'Hi', 'Body', pg_temp.fx('vera'), null, null, null, 'Stray Name')$$, '22023', 'an email goes to exactly one person: a contact, a member of staff or one typed address', 'a name next to a contact is refused');
select throws_ok($$select hq.create_email_draft('general', 'Hi', 'Body')$$, '22023', 'an email goes to exactly one person: a contact, a member of staff or one typed address', 'no recipient at all is still refused');
select is(pg_temp.n_contacts('one@c.test'), 0::bigint, 'none of those made a contact');
select pg_temp.unbecome();

-- ------------------------------------------------------------ who may type an address
select pg_temp.become('pm');
select throws_ok($$select hq.create_email_draft('general', 'Hi', 'Body', null, null, null, 'pm.new@c.test', 'Pm New')$$, '42501',
  'your role can email people HQ already holds; adding someone new to Contacts needs permission to edit contacts', 'a property manager (email.draft, no growth.write) cannot type an address');
select lives_ok($$insert into zz_r select 'pmx', hq.create_email_draft('general', 'Rota', 'Hi.', pg_temp.fx('vera'))$$, '...but still drafts to an existing contact');
select pg_temp.become('spm');
select throws_ok($$select hq.create_email_draft('general', 'Hi', 'Body', null, null, null, 'spm.new@c.test', 'Spm New')$$, '42501', null, 'a senior property manager cannot type an address');
select pg_temp.become('ro');
select throws_ok($$select hq.create_email_draft('general', 'Hi', 'Body', null, null, null, 'ro.new@c.test', 'Ro New')$$, '42501', null, 'read_only (no email.draft) cannot');
select pg_temp.become('jpm');
select throws_ok($$select hq.create_email_draft('general', 'Hi', 'Body', null, null, null, 'jpm.new@c.test', 'Jpm New')$$, '42501', null, 'a junior property manager cannot');
select pg_temp.become('dir', 'aal1');
select throws_ok($$select hq.create_email_draft('general', 'Hi', 'Body', null, null, null, 'aal1.new@c.test', 'Aal One')$$, '42501', null, 'a director at aal1 cannot');
select pg_temp.become_anon();
select throws_ok($$select hq.create_email_draft('general', 'Hi', 'Body', null, null, null, 'anon.new@c.test', 'Anon New')$$, '42501', null, 'anon cannot');
select pg_temp.become('outsider');
select throws_ok($$select hq.create_email_draft('general', 'Hi', 'Body', null, null, null, 'out.new@c.test', 'Outsider New')$$, '42501', null, 'a login with no HQ profile cannot');
select pg_temp.unbecome();
select is((select count(*) from hq.contacts where email::text in ('pm.new@c.test', 'spm.new@c.test', 'ro.new@c.test', 'jpm.new@c.test', 'aal1.new@c.test', 'anon.new@c.test', 'out.new@c.test')), 0::bigint, 'every refused caller left no contact behind');
select pg_temp.become('va');
select lives_ok($$insert into zz_r select 'vax', hq.create_email_draft('thank_you', 'Thank you', 'Hi.', null, null, null, 'va.new@c.test', 'Va New')$$, 'a virtual assistant (email.draft and growth.write) can');
select pg_temp.become('adm');
select lives_ok($$insert into zz_r select 'admx', hq.create_email_draft('thank_you', 'Thank you', 'Hi.', null, null, null, 'adm.new@c.test', 'Adm New')$$, 'an administrator can');
select pg_temp.unbecome();

-- ------------------------------------------------------------ the new-contact cap: 10 per person per hour
select pg_temp.become('bdm');
select lives_ok($q$do $d$ begin for i in 1..10 loop perform hq.create_email_draft('general', 'Hi', 'Body', null, null, null, 'cap' || i || '@cap.test', 'Cap Person ' || i); end loop; end $d$$q$, 'ten new contacts in an hour are accepted');
select is((select count(*) from hq.contacts where created_by = pg_temp.fx('bdm') and source = 'email draft'), 10::bigint, '...and ten contacts exist');
select throws_ok($$select hq.create_email_draft('general', 'Hi', 'Body', null, null, null, 'cap11@cap.test', 'Cap Person 11')$$, '54000', 'at most 10 new people per hour can be added by emailing them', 'the eleventh new contact is refused');
select is((select count(*) from hq.contacts where created_by = pg_temp.fx('bdm') and source = 'email draft'), 10::bigint, '...and no eleventh contact was made');
select is(pg_temp.n_contacts('cap11@cap.test'), 0::bigint, '...for that address');
select lives_ok($$insert into zz_r select 'cap_reuse', hq.create_email_draft('general', 'Hi', 'Body', null, null, null, 'cap3@cap.test', 'Anyone')$$, 'at the cap, an address that already has a contact still works (nothing new is made)');
select lives_ok($$insert into zz_r select 'cap_staff', hq.create_email_draft('general', 'Hi', 'Body', null, null, null, 'pm@hq.test', 'Pat')$$, '...and so does a staff address');
select lives_ok($$insert into zz_r select 'cap_contact', hq.create_email_draft('general', 'Hi', 'Body', pg_temp.fx('vera'))$$, '...and a draft to an existing contact');
select pg_temp.become('va');
select lives_ok($$insert into zz_r select 'va2', hq.create_email_draft('general', 'Hi', 'Body', null, null, null, 'va2.new@c.test', 'Va Two')$$, 'the cap is per person: someone else can still add a contact');
select pg_temp.unbecome();
select is((select count(*) from hq.audit_events where entity_type = 'contact' and action = 'create' and summary like '%added from an email draft%' and actor_id = pg_temp.fx('bdm')), 10::bigint, 'each of the ten contacts has its own audit row');
-- the cap looks back one hour only
alter table hq.contacts disable trigger row_stamp;
update hq.contacts set created_at = now() - interval '61 minutes' where email::text = 'cap1@cap.test';
alter table hq.contacts enable trigger row_stamp;
select pg_temp.become('bdm');
select lives_ok($$insert into zz_r select 'cap_again', hq.create_email_draft('general', 'Hi', 'Body', null, null, null, 'cap11@cap.test', 'Cap Person 11')$$, 'a contact made more than an hour ago no longer counts');
select pg_temp.unbecome();

-- ------------------------------------------------------------ approval stays a person's tap; chat sending needs a verified contact
update hq.settings set value = 'true'::jsonb where key = 'email_chat_send_enabled';
select pg_temp.become_app('dir', 'client-a');
insert into zz_r select 'c1', hq.create_email_draft('thank_you', 'Thanks from chat', 'Hi Chad, thank you.', null, null, null, 'chad@chat.test', 'Chad Chatter');
select ok((select (v ->> 'new_contact')::boolean from zz_r where k = 'c1'), 'a connected app can type an address too: a new contact is made');
select ok((select created_via = 'mcp' and mcp_client_id = 'client-a' from hq.email_drafts where id = pg_temp.eid('c1')), '...and the draft is recorded as made through the app');
select throws_ok($$select hq.begin_email_send(pg_temp.eid('c1'), 'chat')$$, '42501',
  'this address is new to HQ and has not been checked yet: open the email in HQ and tap Approve and send', 'chat sending is on, but an unverified contact''s draft is refused');
select is(pg_temp.st(pg_temp.eid('c1')), 'draft', '...and it stays a draft');
select throws_ok($$select hq.approve_email_draft(pg_temp.eid('c1'))$$, '42501', 'an email is approved in HQ, not through a connected app', 'a connected app still cannot approve');
select is(pg_temp.st(pg_temp.eid('c1')), 'draft', '...still a draft');
select pg_temp.become('dir');
select throws_ok($$select hq.begin_email_send(pg_temp.eid('c1'), 'hq')$$, '42501', 'this email has not been approved: open it in HQ and tap Approve and send', 'in HQ an unapproved draft still needs the approval tap');
select pg_temp.become_app('dir', 'client-a');
insert into zz_r select 'c2', hq.create_email_draft('general', 'Imported', 'Hi Ivy.', pg_temp.fx('ivy'));
select throws_ok($$select hq.begin_email_send(pg_temp.eid('c2'), 'chat')$$, '42501',
  'this address is new to HQ and has not been checked yet: open the email in HQ and tap Approve and send', 'an imported contact flagged needs_verification is held to the same rule');
insert into zz_r select 'c3', hq.create_email_draft('general', 'Verified', 'Hi Vera.', pg_temp.fx('vera'));
select is((select hq.begin_email_send(pg_temp.eid('c3'), 'chat') ->> 'status'), 'sending', 'a verified contact''s draft can be sent from chat as before');
insert into zz_r select 'c4', hq.create_email_draft('general', 'Staff', 'Hi Pat.', null, pg_temp.fx('pm'));
select is((select hq.begin_email_send(pg_temp.eid('c4'), 'chat') ->> 'status'), 'sending', 'a draft to a member of staff is not held back');

-- a person verifies the contact (the existing flow: clear needs_verification on the contact), then chat may send
select pg_temp.become('dir');
select lives_ok($$update hq.contacts set needs_verification = false where id = pg_temp.cid('c1')$$, 'a person marks the new contact verified (the existing verify action)');
select ok((select not needs_verification and verified_at is not null and verified_by = pg_temp.fx('dir') from hq.contacts where id = pg_temp.cid('c1')), '...which stamps who and when');
select pg_temp.become_app('dir', 'client-a');
select is((select hq.begin_email_send(pg_temp.eid('c1'), 'chat') ->> 'status'), 'sending', 'once verified, the same draft can be sent from chat');
select pg_temp.unbecome();

-- a person's approval in HQ makes a draft to an unverified contact sendable, and does not verify the contact
select pg_temp.become('dir');
insert into zz_r select 'h1', hq.create_email_draft('general', 'Approve me', 'Hi Hal.', null, null, null, 'hal@hq-approve.test', 'Hal Approver');
select is((select hq.approve_email_draft(pg_temp.eid('h1')) ->> 'status'), 'approved', 'a person approves a draft to a new contact in HQ');
select ok((select needs_verification from hq.contacts where id = pg_temp.cid('h1')), '...approval does not verify the contact');
select is((select hq.begin_email_send(pg_temp.eid('h1'), 'hq') ->> 'status'), 'sending', '...and it is sent from HQ');
select lives_ok($$select hq.finish_email_send(pg_temp.eid('h1'), true, 'sg-h1')$$, 'the send is recorded');
select pg_temp.unbecome();
select is((select count(*) from hq.interactions i join hq.email_drafts d on d.interaction_id = i.id
           where d.id = pg_temp.eid('h1') and i.contact_id = pg_temp.cid('h1') and i.interaction_type = 'email' and i.summary = 'Email sent: Approve me'),
  1::bigint, 'the send writes the new contact''s timeline entry');
select ok((select last_contact_at > now() - interval '1 minute' from hq.contacts where id = pg_temp.cid('h1')), '...and moves its last contact to now');

-- the address is still re-checked at approval and at send
select pg_temp.become('dir');
insert into zz_r select 'r1', hq.create_email_draft('general', 'Recheck', 'Hi Rae.', null, null, null, 'rae@recheck.test', 'Rae Recheck');
select pg_temp.unbecome();
update hq.contacts set email = 'rae.changed@recheck.test' where id = pg_temp.cid('r1');
select pg_temp.become('dir');
select throws_ok($$select hq.approve_email_draft(pg_temp.eid('r1'))$$, '22023', 'not approved: the email address on the record has changed since this was drafted. Discard it and draft a new one', 'a changed address is refused at approval');
select pg_temp.unbecome();
update hq.contacts set email = 'rae@recheck.test' where id = pg_temp.cid('r1');
select pg_temp.become('dir');
select is((select hq.approve_email_draft(pg_temp.eid('r1')) ->> 'status'), 'approved', 'the address back as drafted: approved');
select pg_temp.unbecome();
update hq.contacts set deleted_at = now() where id = pg_temp.cid('r1');
select pg_temp.become('dir');
select throws_ok($$select hq.begin_email_send(pg_temp.eid('r1'), 'hq')$$, '22023', 'not sent: the contact has been archived. Discard it and draft a new one', 'an archived contact is refused at send');
select pg_temp.unbecome();

-- ------------------------------------------------------------ the draft limit still applies
select pg_temp.become('adm');
select lives_ok($q$do $d$ begin for i in 1..29 loop perform hq.create_email_draft('general', 'Hi', 'Body', pg_temp.fx('vera')); end loop; end $d$$q$, 'a person can still make drafts up to the hourly bound (30 with the one above)');
select throws_ok($$select hq.create_email_draft('general', 'Hi', 'Body', null, null, null, 'limit@c.test', 'Limit Person')$$, '54000', 'at most 30 email drafts per hour', 'the 31st draft is refused even for a new address');
select is(pg_temp.n_contacts('limit@c.test'), 0::bigint, '...and no contact is made');
select pg_temp.unbecome();

select * from finish();
rollback;
