-- Planted HQ: Meetings (migrations 0140, 0141).
-- Structure and security, the capability matrix, forged callers (anon, non-staff, aal1, read_only,
-- junior, wrong capability), one-transaction creation (meeting, attendees, links, action tasks, touch
-- points, history) and its rollback on any refusal, the exactly-one and one-per-person rules, action
-- tasks created through hq.tasks with task visibility respected, touch-point interactions created once
-- and updated (never duplicated), confidential visibility for outsiders, attendees, the recorder and
-- directors, decision promotion, optimistic concurrency, append-only history with snapshots,
-- archive / restore, RLS (no direct writes), audit rows, and the two views.
--
-- NOTE: never CALL a function a hint role lacks execute on (see hq_01). Every RPC here is granted to
-- authenticated; anon is refused at the schema.
begin;
\ir hq_fixture.inc
select pg_temp.seed_hq();
select plan(139);

-- anything already in this database is put out of the way for the transaction
update hq.meetings set deleted_at = now() where deleted_at is null;
update hq.decisions set deleted_at = now() where deleted_at is null
  and not exists (select 1 from hq.decisions x where x.superseded_by_id = hq.decisions.id and x.deleted_at is null);

create temp table zz_r (k text primary key, v jsonb) on commit drop;
grant select, insert on zz_r to public;
create function pg_temp.r(p_k text) returns jsonb language sql stable as $$ select v from zz_r where k = p_k $$;
create function pg_temp.mid(p_k text) returns uuid language sql stable as $$ select (v ->> 'meeting_id')::uuid from zz_r where k = p_k $$;
create function pg_temp.tp_live(p_m uuid) returns bigint language sql stable as $$
  select count(*) from hq.meeting_links l join hq.interactions i on i.id = l.interaction_id and i.deleted_at is null where l.meeting_id = p_m $$;
create function pg_temp.audits(p_id uuid, p_action text) returns bigint language sql stable as $$
  select count(*) from hq.audit_events where entity_type = 'meeting' and entity_id = p_id and action = p_action $$;

-- a lead and a contractor to link (as the table owner)
insert into hq.opportunities (prospect_name, assigned_to) values ('Mtg Prospect [test]', pg_temp.fx('dir')) returning id \gset opp_
insert into fx values ('opp', :'opp_id');
insert into hq.contractors (business_name, categories) values ('Mtg Plumbing [test]', '{plumbing}') returning id \gset ctr_
insert into fx values ('ctr', :'ctr_id');

-- ------------------------------------------------------------ structure and security
select has_table('hq', 'meetings', 'hq.meetings exists');
select has_table('hq', 'meeting_attendees', 'hq.meeting_attendees exists');
select has_table('hq', 'meeting_links', 'hq.meeting_links exists');
select has_table('hq', 'meeting_actions', 'hq.meeting_actions exists');
select has_table('hq', 'meeting_history', 'hq.meeting_history exists');
select enum_has_labels('hq', 'meeting_type', array['partner_referral', 'internal_team', 'contractor', 'landlord_owner', 'supplier_other', 'planning_strategy', 'other']);
select is((select count(*) from pg_class where oid in ('hq.meetings'::regclass, 'hq.meeting_attendees'::regclass, 'hq.meeting_links'::regclass, 'hq.meeting_actions'::regclass, 'hq.meeting_history'::regclass)
            and relrowsecurity and relforcerowsecurity), 5::bigint, 'RLS is enabled and forced on the five meeting tables');
select policies_are('hq', 'meetings', array['meetings_select'], 'meetings: one select policy, nothing else');
select policies_are('hq', 'meeting_attendees', array['meeting_attendees_select'], 'meeting_attendees: one select policy');
select policies_are('hq', 'meeting_links', array['meeting_links_select'], 'meeting_links: one select policy');
select policies_are('hq', 'meeting_actions', array['meeting_actions_select'], 'meeting_actions: one select policy');
select policies_are('hq', 'meeting_history', array['meeting_history_select'], 'meeting_history: one select policy');
select is((select count(*) from pg_policies where schemaname = 'hq' and tablename like 'meeting%' and qual like '%has_capability(''meetings.read''%'), 5::bigint, 'every meeting policy needs meetings.read');
select is((select count(*) from unnest(array['meetings', 'meeting_attendees', 'meeting_links', 'meeting_actions', 'meeting_history']) t
            where has_table_privilege('authenticated', 'hq.' || t, 'select') and not has_table_privilege('authenticated', 'hq.' || t, 'insert,update,delete,truncate')),
  5::bigint, 'authenticated can only select the meeting tables (written by RPC)');
select is((select count(*) from unnest(array['meetings', 'meeting_attendees', 'meeting_links', 'meeting_actions', 'meeting_history']) t
            where has_table_privilege('service_role', 'hq.' || t, 'insert,update,delete,truncate')), 0::bigint, 'service_role cannot write the meeting tables');
select ok((select bool_and(reloptions @> array['security_invoker=true']) from pg_class where oid in ('hq.meeting_overview'::regclass, 'hq.open_meeting_actions'::regclass)),
  'meeting_overview and open_meeting_actions are security_invoker');
select ok(not has_table_privilege('anon', 'hq.meeting_overview', 'select') and not has_table_privilege('anon', 'hq.open_meeting_actions', 'select'), 'anon holds nothing on the two views');

create temp table zz_rpcs (sig regprocedure primary key) on commit drop;
insert into zz_rpcs values
  ('hq.create_meeting(text, hq.meeting_type, timestamptz, integer, text, text, text, text, boolean, jsonb, jsonb, jsonb, text)'),
  ('hq.update_meeting(uuid, integer, text, hq.meeting_type, timestamptz, integer, text, text, text, text, boolean, text[], text)'),
  ('hq.add_meeting_attendee(uuid, uuid, uuid, text)'), ('hq.remove_meeting_attendee(uuid, bigint)'),
  ('hq.link_meeting(uuid, text, uuid)'), ('hq.unlink_meeting(uuid, text, uuid)'),
  ('hq.add_meeting_action(uuid, text, uuid, date, hq.task_priority, text)'),
  ('hq.promote_decision_to_register(uuid, text, hq.decision_category, text, text, date, hq.decision_status)');
select is((select count(*) from zz_rpcs where has_function_privilege('authenticated', sig, 'execute')), 8::bigint, 'authenticated can execute the eight meeting RPCs');
select is((select count(*) from zz_rpcs where has_function_privilege('anon', sig, 'execute') or has_function_privilege('service_role', sig, 'execute')), 0::bigint, 'anon and service_role can execute none of them');
select is((select count(*) from zz_rpcs z join pg_proc p on p.oid = z.sig where p.prosecdef and p.proconfig::text like '%search_path=pg_catalog, public, extensions%'), 8::bigint, 'all eight are security definer with a pinned search_path');
select is((select count(*) from pg_proc p where p.pronamespace = 'hq_private'::regnamespace and p.proname like 'meeting%'
            and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))), 0::bigint, 'the meeting helpers are executable by no API role');
select ok(exists (select 1 from pg_constraint where conname = 'tasks_source_known' and pg_get_constraintdef(oid) like '%meeting%'), 'a task may come from a meeting');

-- ------------------------------------------------------------ the capability matrix (an assumption for the owner)
select is((select array_agg(role::text order by role::text) from hq.role_capabilities where capability = 'meetings.read'),
  array['administrator', 'business_development_manager', 'director', 'property_manager', 'senior_property_manager', 'virtual_assistant'], 'meetings.read: everyone but junior PM and read-only');
select is((select array_agg(role::text order by role::text) from hq.role_capabilities where capability = 'meetings.write'),
  array['administrator', 'business_development_manager', 'director', 'property_manager', 'senior_property_manager', 'virtual_assistant'], 'meetings.write: the same six roles');

-- ------------------------------------------------------------ forged callers
select pg_temp.become_anon();
select throws_ok($$select hq.create_meeting('x', 'other', now())$$, '42501', null, 'anon cannot create a meeting');
select throws_ok('select 1 from hq.meetings', '42501', null, 'anon is denied the meetings');
select throws_ok('select 1 from hq.meeting_overview', '42501', null, 'anon is denied the overview');
select pg_temp.unbecome();
select pg_temp.become('outsider');
select throws_ok($$select hq.create_meeting('Outsider [test]', 'other', now())$$, '42501', null, 'a signed-in person who is not staff cannot create');
select pg_temp.become('dir', 'aal1');
select throws_ok($$select hq.create_meeting('aal1 [test]', 'other', now())$$, '42501', null, 'a director without MFA (aal1) cannot create');
select pg_temp.become('ro');
select throws_ok($$select hq.create_meeting('RO [test]', 'other', now())$$, '42501', null, 'read_only cannot create a meeting');
select pg_temp.become('jpm');
select throws_ok($$select hq.create_meeting('Junior [test]', 'other', now())$$, '42501', null, 'a junior property manager cannot create a meeting');
select pg_temp.unbecome();

-- ------------------------------------------------------------ create (director): one transaction
select pg_temp.become('dir');
insert into zz_r select 'm1', hq.create_meeting(
  '[test] Coffee with Alice', 'partner_referral', now() - interval '1 hour', 45, 'Coffee at Kadina',
  'Alice will refer two landlords this month. We send our fee schedule.',
  E'## Agenda\n- Referrals\n\n## Discussion\nAlice has two landlords ready.\n\n## Next steps\n- Send the fee schedule',
  E'- Offer Alpha a thank-you for each signed referral',
  false,
  jsonb_build_array(jsonb_build_object('staff_id', pg_temp.fx('dir')), jsonb_build_object('contact_id', pg_temp.fx('alice')), jsonb_build_object('name', 'Tim from the bank')),
  jsonb_build_array(jsonb_build_object('kind', 'contact', 'id', pg_temp.fx('alice')), jsonb_build_object('kind', 'organisation', 'id', pg_temp.fx('alpha')),
                    jsonb_build_object('kind', 'organisation', 'id', pg_temp.fx('beta')), jsonb_build_object('kind', 'opportunity', 'id', pg_temp.fx('opp')),
                    jsonb_build_object('kind', 'contractor', 'id', pg_temp.fx('ctr'))),
  jsonb_build_array(jsonb_build_object('title', 'Send Alice the fee schedule', 'assignee_id', pg_temp.fx('pm'), 'due_date', (hq.today() + 3)::text, 'priority', 'high'),
                    jsonb_build_object('title', 'Call Bob about the Moonta house', 'due_date', (hq.today() + 1)::text)));
select pg_temp.unbecome();

select ok((pg_temp.r('m1') ->> 'ref') ~ '^MTG-\d{4,}$', 'create_meeting returns an MTG-0001 style ref');
select is((select version from hq.meetings where id = pg_temp.mid('m1')), 1, 'a new meeting is version 1');
select is((select created_via || '|' || coalesce(mcp_client_id, '-') || '|' || created_by::text from hq.meetings where id = pg_temp.mid('m1')), 'hq|-|' || pg_temp.fx('dir')::text, 'recorded through HQ, by the director');
select is((select count(*) from hq.meeting_attendees where meeting_id = pg_temp.mid('m1')), 3::bigint, 'three attendees: staff, contact, typed name');
select is((select staff_attendee_ids from hq.meetings where id = pg_temp.mid('m1')), array[pg_temp.fx('dir')], 'the staff attendee copy holds the director');
select is((select count(*) from hq.meeting_links where meeting_id = pg_temp.mid('m1')), 5::bigint, 'five links');
select is((select count(*) from hq.meeting_actions where meeting_id = pg_temp.mid('m1')), 2::bigint, 'two actions');
select is((select string_agg(t.source || '/' || t.assigned_to::text || '/' || t.created_by::text || '/' || t.priority::text, ',' order by t.title) from hq.meeting_actions a join hq.tasks t on t.id = a.task_id where a.meeting_id = pg_temp.mid('m1')),
  'meeting/' || pg_temp.fx('dir')::text || '/' || pg_temp.fx('dir')::text || '/normal,meeting/' || pg_temp.fx('pm')::text || '/' || pg_temp.fx('dir')::text || '/high',
  'the actions are real tasks (source meeting), assigned as given (default the creator), created by the creator');
select ok((select bool_and(t.description like '%From meeting MTG-%: [test] Coffee with Alice.%') from hq.meeting_actions a join hq.tasks t on t.id = a.task_id where a.meeting_id = pg_temp.mid('m1')), 'each task says which meeting it came from');
select is(pg_temp.tp_live(pg_temp.mid('m1')), 4::bigint, 'four touch points: the contact (carrying Alpha), Beta, the lead and the contractor');
select is((select interaction_id from hq.meeting_links where meeting_id = pg_temp.mid('m1') and organisation_id = pg_temp.fx('alpha')), null, 'Alpha is covered by Alice''s interaction (not logged twice)');
select is((select i.organisation_id from hq.interactions i join hq.meeting_links l on l.interaction_id = i.id where l.meeting_id = pg_temp.mid('m1') and l.contact_id = pg_temp.fx('alice')), pg_temp.fx('alpha'), '... Alice''s interaction carries Alpha');
select is((select string_agg(distinct i.interaction_type::text, ',') from hq.meeting_links l join hq.interactions i on i.id = l.interaction_id where l.meeting_id = pg_temp.mid('m1')), 'coffee_meeting', 'the location says coffee, so they are coffee meetings');
select ok((select bool_and(i.summary like 'Meeting MTG-%: [test] Coffee with Alice. Alice will refer%') from hq.meeting_links l join hq.interactions i on i.id = l.interaction_id where l.meeting_id = pg_temp.mid('m1')), 'touch points carry the ref, title and summary');
select ok((select last_contact_at > now() - interval '2 hours' from hq.contacts where id = pg_temp.fx('alice')), 'Alice''s last contacted moved to the meeting');
select ok((select last_activity_at > now() - interval '2 hours' from hq.opportunities where id = pg_temp.fx('opp')), 'the lead''s last activity moved to the meeting');
select is((select count(*) || '|' || min(version) || '|' || min(action) from hq.meeting_history where meeting_id = pg_temp.mid('m1')), '1|1|create', 'history: one create row at version 1');
select ok((select minutes like '## Agenda%' and summary like 'Alice will refer%' from hq.meeting_history where meeting_id = pg_temp.mid('m1') and version = 1), '... with a snapshot of the minutes and summary');
select is(pg_temp.audits(pg_temp.mid('m1'), 'create'), 1::bigint, 'audit: one create meeting row');
select is(jsonb_array_length(pg_temp.r('m1') -> 'tasks') || '|' || jsonb_array_length(pg_temp.r('m1') -> 'touch_points'), '2|5', 'the result lists the tasks and every touch point (one covered)');

-- ------------------------------------------------------------ refusals keep nothing (one transaction)
select pg_temp.become('dir');
select throws_ok(format($$select hq.create_meeting('[test] Rollback A', 'other', now(), p_actions => jsonb_build_array(jsonb_build_object('title', 'x', 'assignee_id', %L)))$$, pg_temp.fx('outsider')),
  '22023', null, 'an action for someone who is not active staff is refused');
select throws_ok(format($$select hq.create_meeting('[test] Rollback B', 'other', now(), p_links => jsonb_build_array(jsonb_build_object('kind', 'contact', 'id', %L)))$$, gen_random_uuid()),
  'P0002', 'contact not found', 'a link to a contact that does not exist is refused');
select throws_ok(format($$select hq.create_meeting('[test] Rollback C', 'other', now(), p_attendees => jsonb_build_array(jsonb_build_object('staff_id', %L, 'name', 'Also a name')))$$, pg_temp.fx('dir')),
  '22023', 'an attendee is one person: a member of staff, a contact, or a name', 'an attendee with two identities is refused');
select throws_ok($$select hq.create_meeting('[test] Rollback D', 'other', now() + interval '3 days')$$, '22023', null, 'a meeting more than a day ahead is refused');
select throws_ok($$select hq.create_meeting('   ', 'other', now())$$, '22023', 'a meeting needs a title', 'a blank title is refused');
select throws_ok($$select hq.create_meeting('[test] Rollback E', 'other', now(), p_duration_minutes => 0)$$, '22023', null, 'a zero duration is refused');
select throws_ok($$select hq.create_meeting('[test] Rollback F', 'other', now(), p_links => '{"kind": "contact"}'::jsonb)$$, '22023', 'links must be a list', 'links that are not a list are refused');
select throws_ok(format($$select hq.create_meeting('[test] Rollback G', 'other', now(), p_actions => jsonb_build_array(jsonb_build_object('title', 'x', 'due_date', %L)))$$, (hq.today() + 1000)::text),
  '22023', null, 'an action due more than two years ahead is refused');
select pg_temp.unbecome();
select is((select count(*) from hq.meetings where title like '[test] Rollback%'), 0::bigint, 'none of the refused meetings was kept');
select is((select count(*) from hq.tasks where title = 'x'), 0::bigint, '... nor any of their tasks');

-- ------------------------------------------------------------ exactly-one and one-per-person rules (every writer)
select throws_ok(format($$insert into hq.meeting_attendees (meeting_id, staff_id, contact_id) values (%L, %L, %L)$$, pg_temp.mid('m1'), pg_temp.fx('pm'), pg_temp.fx('bob')),
  '23514', null, 'an attendee row with two identities is refused even as postgres');
select throws_ok(format($$insert into hq.meeting_attendees (meeting_id) values (%L)$$, pg_temp.mid('m1')), '23514', null, '... and one with none');
select throws_ok(format($$insert into hq.meeting_attendees (meeting_id, staff_id) values (%L, %L)$$, pg_temp.mid('m1'), pg_temp.fx('dir')), '23505', null, 'the same person twice is refused');
select throws_ok(format($$insert into hq.meeting_links (meeting_id, contact_id, organisation_id) values (%L, %L, %L)$$, pg_temp.mid('m1'), pg_temp.fx('bob'), pg_temp.fx('beta')),
  '23514', null, 'a link row to two records is refused');
select throws_ok(format($$update hq.meeting_links set contact_id = %L where meeting_id = %L and contact_id = %L$$, pg_temp.fx('bob'), pg_temp.mid('m1'), pg_temp.fx('alice')),
  '42501', null, 'a link is never re-pointed');
select pg_temp.become('va');
insert into zz_r select 'att_dup', hq.add_meeting_attendee(pg_temp.mid('m1'), p_name => '  tim FROM the   bank ');
insert into zz_r select 'link_dup', hq.link_meeting(pg_temp.mid('m1'), 'organisation', pg_temp.fx('beta'));
select pg_temp.unbecome();
select is((pg_temp.r('att_dup') ->> 'changed')::boolean, false, 'adding a name already there (any case or spacing) changes nothing');
select is((pg_temp.r('link_dup') ->> 'changed')::boolean, false, 'linking a record already linked changes nothing');
select is((select version from hq.meetings where id = pg_temp.mid('m1')), 1, '... and no new version');

-- at most 40 attendees
select pg_temp.become('dir');
insert into zz_r select 'lim', hq.create_meeting('[test] Big team meeting', 'internal_team', now() - interval '1 day');
select pg_temp.unbecome();
insert into hq.meeting_attendees (meeting_id, external_name) select pg_temp.mid('lim'), 'Person ' || g from generate_series(1, 40) g;
select throws_ok(format($$insert into hq.meeting_attendees (meeting_id, external_name) values (%L, 'Person 41')$$, pg_temp.mid('lim')), '23514', 'a meeting can have at most 40 attendees', 'the 41st attendee is refused');

-- ------------------------------------------------------------ task visibility through the views
select pg_temp.become('pm');
select is((select count(*) from hq.open_meeting_actions where meeting_id = pg_temp.mid('m1')), 1::bigint, 'a property manager (no tasks.read_all) sees only their own open action');
select is((select open_action_count from hq.meeting_overview where id = pg_temp.mid('m1')), 1::bigint, '... and the overview counts only that one');
select pg_temp.become('spm');
select is((select count(*) from hq.open_meeting_actions where meeting_id = pg_temp.mid('m1')), 2::bigint, 'a senior PM (tasks.read_all) sees both');
select pg_temp.become('dir');
select ok((select attendee_names like '%Dana Director%' and attendee_names like '%Alice Anders%' and attendee_names like '%Tim from the bank%' and linked_names like '%Beta Broking%' and linked_names like '%Mtg Plumbing [test]%'
           from hq.meeting_overview where id = pg_temp.mid('m1')), 'the overview names the attendees and linked records');
select pg_temp.become('ro');
select is((select count(*) from hq.meetings), 0::bigint, 'read_only sees no meetings (no meetings.read)');
select is((select count(*) from hq.open_meeting_actions), 0::bigint, '... and no meeting actions');
select pg_temp.become('jpm');
select is((select count(*) from hq.meeting_overview), 0::bigint, 'a junior sees no meetings');
select pg_temp.unbecome();

-- ------------------------------------------------------------ edits: concurrency, history, touch points updated not duplicated
select pg_temp.become('va');
insert into zz_r select 'u1', hq.update_meeting(pg_temp.mid('m1'), 1, p_summary => 'Alice will refer three landlords. We send our fee schedule by Friday.',
  p_minutes => E'## Agenda\n- Referrals\n\n## Discussion\nAlice has three landlords ready.', p_change_note => 'Corrected the number of landlords');
select throws_ok(format($$select hq.update_meeting(%L, 1, p_title => 'Late edit')$$, pg_temp.mid('m1')), '23514', null, 'an edit against an old version is refused');
select throws_ok(format($$select hq.update_meeting(%L, null, p_title => 'No version')$$, pg_temp.mid('m1')), '22023', null, 'an edit must say which version it is based on');
insert into zz_r select 'u_same', hq.update_meeting(pg_temp.mid('m1'), 2, p_summary => 'Alice will refer three landlords. We send our fee schedule by Friday.');
select throws_ok(format($$select hq.update_meeting(%L, 2, p_clear => array['title'])$$, pg_temp.mid('m1')), '22023', null, 'the title cannot be cleared');
select pg_temp.unbecome();
select is((pg_temp.r('u1') ->> 'changed')::boolean and (pg_temp.r('u1') ->> 'version')::int = 2, true, 'the edit is saved as version 2');
select is((pg_temp.r('u_same') ->> 'changed')::boolean, false, 'an edit that changes nothing writes nothing');
select is((select count(*) from hq.meeting_history where meeting_id = pg_temp.mid('m1')), 2::bigint, 'history: two rows now');
select is((select change_summary || '|' || change_note || '|' || edited_by::text from hq.meeting_history where meeting_id = pg_temp.mid('m1') and version = 2),
  'Changed the summary, the minutes|Corrected the number of landlords|' || pg_temp.fx('va')::text, 'version 2: what changed, the note, who');
select ok((select minutes like '%two landlords%' from hq.meeting_history where meeting_id = pg_temp.mid('m1') and version = 1)
      and (select minutes like '%three landlords%' from hq.meeting_history where meeting_id = pg_temp.mid('m1') and version = 2), 'both versions of the minutes can be read back');
select is(pg_temp.tp_live(pg_temp.mid('m1')), 4::bigint, 'still four touch points after the edit');
select is((select count(*) from hq.interactions where summary like 'Meeting ' || (pg_temp.r('m1') ->> 'ref') || ':%'), 4::bigint, '... no duplicate interaction was made');
select ok((select bool_and(i.summary like '%three landlords%') from hq.meeting_links l join hq.interactions i on i.id = l.interaction_id where l.meeting_id = pg_temp.mid('m1')), '... each was updated with the new summary');
select throws_ok($$update hq.meeting_history set change_summary = 'changed'$$, '42501', null, 'meeting_history: update raises even as postgres');
select throws_ok($$delete from hq.meeting_history$$, '42501', null, 'meeting_history: delete raises even as postgres');
select throws_ok($$truncate hq.meeting_history$$, '42501', null, 'meeting_history: truncate raises even as postgres');
select throws_ok(format($$delete from hq.meetings where id = %L$$, pg_temp.mid('m1')), '42501', null, 'a meeting is never deleted, even as postgres');
select throws_ok(format($$update hq.meetings set version = 1 where id = %L$$, pg_temp.mid('m1')), '42501', null, 'a version never goes back');

-- ------------------------------------------------------------ RLS: no direct writes
select pg_temp.become('dir');
select throws_ok($$insert into hq.meetings (title, held_at) values ('Direct [test]', now())$$, '42501', null, 'a director cannot insert a meeting directly');
select throws_ok(format($$update hq.meetings set title = 'Direct' where id = %L$$, pg_temp.mid('m1')), '42501', null, 'a director cannot update a meeting directly');
select throws_ok(format($$insert into hq.meeting_actions (task_id, meeting_id) values (gen_random_uuid(), %L)$$, pg_temp.mid('m1')), '42501', null, 'nor link a task directly');
select pg_temp.unbecome();

-- ------------------------------------------------------------ attendees, links and actions
select pg_temp.become('va');
insert into zz_r select 'rm_att', hq.remove_meeting_attendee(pg_temp.mid('m1'), (select id from hq.meeting_attendees where meeting_id = pg_temp.mid('m1') and external_name is not null));
insert into zz_r select 'act', hq.add_meeting_action(pg_temp.mid('m1'), 'Book a follow-up coffee', p_due_date => hq.today() + 7);
insert into zz_r select 'unl', hq.unlink_meeting(pg_temp.mid('m1'), 'contact', pg_temp.fx('alice'));
select throws_ok(format($$select hq.promote_decision_to_register(%L, 'VA decision', 'partners')$$, pg_temp.mid('m1')), '42501', null, 'a virtual assistant (no decisions.write) cannot add a decision to the register');
select pg_temp.become('jpm');
select throws_ok(format($$select hq.add_meeting_action(%L, 'Junior action')$$, pg_temp.mid('m1')), '42501', null, 'a junior cannot add an action');
select pg_temp.become('spm');
select throws_ok(format($$select hq.promote_decision_to_register(%L, 'SPM decision', 'partners')$$, pg_temp.mid('m1')), '42501', null, 'a senior PM (decisions.read only) cannot add a decision to the register');
select pg_temp.unbecome();
select is((select count(*) from hq.meeting_attendees where meeting_id = pg_temp.mid('m1')), 2::bigint, 'remove_meeting_attendee removed the typed name');
select is((select string_agg(action, ',' order by version) from hq.meeting_history where meeting_id = pg_temp.mid('m1')), 'create,update,remove_attendee,add_action,unlink', 'each change is its own version in the history');
select is((select t.assigned_to::text || '|' || t.source from hq.tasks t where t.id = (pg_temp.r('act') -> 'task' ->> 'task_id')::uuid), pg_temp.fx('va')::text || '|meeting', 'add_meeting_action: a task for the caller by default');
select is((select count(*) from hq.meeting_links where meeting_id = pg_temp.mid('m1') and contact_id = pg_temp.fx('alice')), 0::bigint, 'unlink_meeting removed Alice');
select is((select count(*) from hq.interactions where summary like 'Meeting ' || (pg_temp.r('m1') ->> 'ref') || ':%' and contact_id = pg_temp.fx('alice') and deleted_at is null), 0::bigint, '... and archived her touch point');
select ok((select i.deleted_at is null and i.organisation_id = pg_temp.fx('alpha') from hq.meeting_links l join hq.interactions i on i.id = l.interaction_id where l.meeting_id = pg_temp.mid('m1') and l.organisation_id = pg_temp.fx('alpha')),
  '... and Alpha, no longer covered by her, has its own touch point now');
select is(pg_temp.tp_live(pg_temp.mid('m1')), 4::bigint, 'four live touch points again (Alpha, Beta, the lead, the contractor)');

-- ------------------------------------------------------------ decision promotion (director)
select pg_temp.become('dir');
insert into zz_r select 'prom', hq.promote_decision_to_register(pg_temp.mid('m1'), '[test] Thank partners for each signed referral', 'partners', p_rationale => 'Agreed at the coffee with Alice');
select pg_temp.unbecome();
select is((select count(*) from hq.decisions where id = (pg_temp.r('prom') -> 'decision' ->> 'decision_id')::uuid and deleted_at is null and category = 'partners'), 1::bigint, 'the decision is in the register');
select is((select count(*) from hq.meeting_links where meeting_id = pg_temp.mid('m1') and decision_id = (pg_temp.r('prom') -> 'decision' ->> 'decision_id')::uuid), 1::bigint, '... linked to the meeting');
select is((select note from hq.decision_history where decision_id = (pg_temp.r('prom') -> 'decision' ->> 'decision_id')::uuid and action = 'create'), 'From meeting ' || (pg_temp.r('m1') ->> 'ref'), '... and its history says which meeting');
select is((select decision_date from hq.decisions where id = (pg_temp.r('prom') -> 'decision' ->> 'decision_id')::uuid), ((now() - interval '1 hour') at time zone 'Australia/Adelaide')::date, '... dated the meeting day');
select is(pg_temp.tp_live(pg_temp.mid('m1')), 4::bigint, 'a decision link logs no touch point');

-- ------------------------------------------------------------ confidential meetings
select pg_temp.become('bdm');
insert into zz_r select 'c1', hq.create_meeting('[test] Confidential staffing', 'internal_team', now() - interval '2 hours', p_location => 'Phone',
  p_summary => 'secret summary about a staff matter', p_minutes => 'secret minutes', p_confidential => true,
  p_attendees => jsonb_build_array(jsonb_build_object('staff_id', pg_temp.fx('va'))),
  p_links => jsonb_build_array(jsonb_build_object('kind', 'contact', 'id', pg_temp.fx('bob'))),
  p_actions => jsonb_build_array(jsonb_build_object('title', 'Confidential follow-up', 'assignee_id', pg_temp.fx('bdm'))));
select is((select count(*) from hq.meetings where id = pg_temp.mid('c1')), 1::bigint, 'the recorder sees their confidential meeting');
select pg_temp.become('va');
select is((select count(*) from hq.meeting_overview where id = pg_temp.mid('c1')), 1::bigint, 'a staff attendee sees it');
select pg_temp.become('pm');
select is((select count(*) from hq.meetings where id = pg_temp.mid('c1')) + (select count(*) from hq.meeting_overview where id = pg_temp.mid('c1')), 0::bigint, 'a colleague who was not there does not see it, in the table or the overview');
select is((select count(*) from hq.meeting_history where meeting_id = pg_temp.mid('c1')) + (select count(*) from hq.meeting_links where meeting_id = pg_temp.mid('c1'))
          + (select count(*) from hq.meeting_attendees where meeting_id = pg_temp.mid('c1')) + (select count(*) from hq.meeting_actions where meeting_id = pg_temp.mid('c1')), 0::bigint,
  '... nor its history, links, attendees or actions');
select is((select count(*) from hq.interactions where contact_id = pg_temp.fx('bob') and summary like '%secret%'), 0::bigint, 'its summary never reaches Bob''s timeline');
select is((select count(*) from hq.interactions where contact_id = pg_temp.fx('bob') and summary = (pg_temp.r('c1') ->> 'ref') || ' (confidential meeting: details are in Meetings)' and interaction_type = 'phone_call'), 1::bigint,
  '... which shows only that a confidential meeting (a phone call) happened');
select throws_ok(format($$select hq.update_meeting(%L, 1, p_title => 'Peek')$$, pg_temp.mid('c1')), 'P0002', 'meeting not found', 'an outsider cannot edit it: not found');
select throws_ok(format($$select hq.archive_record('meeting', %L)$$, pg_temp.mid('c1')), 'P0002', 'meeting not found', '... nor archive it');
select throws_ok(format($$select hq.add_meeting_action(%L, 'Sneaky')$$, pg_temp.mid('c1')), 'P0002', 'meeting not found', '... nor add an action to it');
select pg_temp.become('spm');
select is((select count(*) from hq.open_meeting_actions where meeting_id = pg_temp.mid('c1')), 0::bigint, 'a senior PM with tasks.read_all still sees no actions of a confidential meeting in the meeting views');
select pg_temp.become('dir');
select is((select count(*) from hq.meeting_overview where id = pg_temp.mid('c1')), 1::bigint, 'a director (audit.read) sees it');
select pg_temp.become('va');
select throws_ok(format($$select hq.update_meeting(%L, 1, p_confidential => false)$$, pg_temp.mid('c1')), '42501', null, 'an attendee who did not record it cannot make it visible to everyone');
select pg_temp.become('bdm');
insert into zz_r select 'c1_open', hq.update_meeting(pg_temp.mid('c1'), 1, p_confidential => false, p_summary => 'Agreed the rota for December', p_change_note => 'Nothing sensitive after all');
select pg_temp.become('pm');
select is((select count(*) from hq.meeting_overview where id = pg_temp.mid('c1')), 1::bigint, 'once the recorder makes it visible, colleagues see it');
select is((select count(*) from hq.interactions where contact_id = pg_temp.fx('bob') and summary like '%Agreed the rota for December%' and deleted_at is null), 1::bigint, '... and the touch point now carries the summary (updated, one row)');
select pg_temp.unbecome();

-- ------------------------------------------------------------ archive and restore
select pg_temp.become('jpm');
select throws_ok(format($$select hq.archive_record('meeting', %L)$$, pg_temp.mid('m1')), '42501', null, 'a junior cannot archive a meeting');
select pg_temp.become('dir');
insert into zz_r select 'arc', hq.archive_record('meeting', pg_temp.mid('m1'), 'Test archive');
select pg_temp.unbecome();
select ok((select deleted_at is not null from hq.meetings where id = pg_temp.mid('m1')), 'archive_record archives the meeting');
select is(pg_temp.tp_live(pg_temp.mid('m1')) + (select count(*) from hq.interactions where summary like 'Meeting ' || (pg_temp.r('m1') ->> 'ref') || ':%' and deleted_at is null), 0::bigint, '... and its touch points');
select is((select count(*) from hq.meeting_actions a join hq.tasks t on t.id = a.task_id and t.deleted_at is null where a.meeting_id = pg_temp.mid('m1')), 3::bigint, '... but not its tasks');
select is((select action || '|' || change_note from hq.meeting_history where meeting_id = pg_temp.mid('m1') order by version desc limit 1), 'archive|Test archive', '... recorded in its history');
select is(pg_temp.audits(pg_temp.mid('m1'), 'archive'), 1::bigint, 'audit: one archive row');
select pg_temp.become('pm');
select is((select count(*) from hq.open_meeting_actions where meeting_id = pg_temp.mid('m1')), 0::bigint, 'an archived meeting''s actions leave the open-actions view');
select pg_temp.become('dir');
insert into zz_r select 'res', hq.restore_record('meeting', pg_temp.mid('m1'));
select pg_temp.unbecome();
select ok((select deleted_at is null from hq.meetings where id = pg_temp.mid('m1')), 'restore_record restores it');
select is(pg_temp.tp_live(pg_temp.mid('m1')), 4::bigint, '... and logs its touch points again');
select is((select count(*) from hq.interactions where summary like 'Meeting ' || (pg_temp.r('m1') ->> 'ref') || ':%' and deleted_at is null), 4::bigint, '... one per linked record, no duplicates');
select is(pg_temp.audits(pg_temp.mid('m1'), 'restore'), 1::bigint, 'audit: one restore row');
select is((select count(*) from hq.meeting_history where meeting_id = pg_temp.mid('m1')), (select version::bigint from hq.meetings where id = pg_temp.mid('m1')), 'one history row per version, no gaps');

-- ------------------------------------------------------------ a connected chat app is recorded as such
select pg_temp.become('va');
select set_config('request.jwt.claims', (current_setting('request.jwt.claims')::jsonb || '{"client_id": "chatgpt-test"}'::jsonb)::text, true);
insert into zz_r select 'app', hq.create_meeting('[test] Saved from chat', 'other', now() - interval '5 minutes', p_summary => 'Chat summary');
select pg_temp.unbecome();
select is((select created_via || '|' || mcp_client_id from hq.meetings where id = pg_temp.mid('app')), 'mcp|chatgpt-test', 'a meeting saved from a connected app records the app');
select is((select via || '|' || change_note from hq.meeting_history where meeting_id = pg_temp.mid('app')), 'mcp|Saved from a chat app', '... and so does its history');

select * from finish();
rollback;
