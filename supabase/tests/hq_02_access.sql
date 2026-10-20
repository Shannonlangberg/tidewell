-- Planted HQ: who may do what. Non-staff, the capability matrix per role, MFA, read_only, junior
-- property manager, task visibility, staff administration, the last-director guard, settings, pods.
begin;
\ir hq_fixture.inc
select pg_temp.seed_hq();
select plan(146);

-- helpers: what the caller holds, read two ways
create function pg_temp.caps_my_access() returns text[]
language sql as $$ select coalesce(array(select jsonb_array_elements_text(hq.my_access() -> 'capabilities') order by 1), '{}') $$;
create function pg_temp.caps_can() returns text[]
language sql as $$
  select coalesce(array_agg(c order by c) filter (where hq.can(c)), '{}')
  from unnest(array['growth.read', 'growth.write', 'growth.delete', 'tasks.read_all', 'tasks.write', 'people.read', 'people.admin', 'audit.read', 'import.run', 'settings.admin']) c
$$;
create function pg_temp.visible_rows() returns bigint
language sql as $$
  select (select count(*) from hq.pods) + (select count(*) from hq.staff_profiles) + (select count(*) from hq.role_capabilities)
       + (select count(*) from hq.settings) + (select count(*) from hq.organisations) + (select count(*) from hq.contacts)
       + (select count(*) from hq.interactions) + (select count(*) from hq.opportunities) + (select count(*) from hq.opportunity_stage_history)
       + (select count(*) from hq.referrals) + (select count(*) from hq.tasks) + (select count(*) from hq.audit_events)
       + (select count(*) from hq.import_batches) + (select count(*) from hq.contact_directory) + (select count(*) from hq.organisation_directory)
       + (select count(*) from hq.referral_overview) + (select count(*) from hq.partner_performance) + (select count(*) from hq.overdue_followups)
       + (select count(*) from hq.ai_requests) + (select count(*) from hq.referral_partner_overview)
       + (select count(*) from hq.decisions) + (select count(*) from hq.decision_history) + (select count(*) from hq.decision_tasks) + (select count(*) from hq.decision_overview)
$$;

-- ------------------------------------------------------------ a signed-in person with no HQ profile
select pg_temp.become('outsider');
select is(hq.my_access(), null::jsonb, 'non-staff: my_access() is null');
select is(hq.can('growth.read'), false, 'non-staff: can() is false');
select is(pg_temp.visible_rows(), 0::bigint, 'non-staff: every hq table and view returns zero rows');
select is(hq.global_search('alpha', 5), '{"contacts": [], "organisations": [], "referrals": [], "tasks": [], "contractors": []}'::jsonb, 'non-staff: global_search finds nothing');
select throws_ok($$insert into hq.organisations (name, categories) values ('Outsider Co', '{other}')$$, '42501', null, 'non-staff cannot insert an organisation');
select throws_ok($$insert into hq.tasks (title) values ('Outsider task')$$, '42501', null, 'non-staff cannot insert a task');
select throws_ok($$select hq.record_interaction(null, null, 'note', null, 'x')$$, '42501', null, 'non-staff cannot record_interaction');
select throws_ok($$select hq.record_referral('sent')$$, '42501', null, 'non-staff cannot record_referral');
select throws_ok($$select hq.move_opportunity(gen_random_uuid(), 'contacted')$$, '42501', null, 'non-staff cannot move_opportunity');
select throws_ok($$select hq.set_attributed_referral(gen_random_uuid(), gen_random_uuid())$$, '42501', null, 'non-staff cannot set_attributed_referral');
select throws_ok($$select hq.archive_record('contact', gen_random_uuid())$$, '42501', null, 'non-staff cannot archive_record');
select throws_ok($$select hq.restore_record('contact', gen_random_uuid())$$, '42501', null, 'non-staff cannot restore_record');
select throws_ok($$select hq.preview_partner_import('[]'::jsonb)$$, '42501', null, 'non-staff cannot preview_partner_import');
select throws_ok($$select hq.apply_partner_import('[]'::jsonb, 'x')$$, '42501', null, 'non-staff cannot apply_partner_import');
select throws_ok($$select hq.growth_summary(null)$$, '42501', null, 'non-staff cannot growth_summary');
select throws_ok($$select hq.add_staff(gen_random_uuid(), 'x@y.test', 'X Y', 'read_only')$$, '42501', null, 'non-staff cannot add_staff');
select throws_ok($$select hq.update_staff(gen_random_uuid())$$, '42501', null, 'non-staff cannot update_staff');
select throws_ok($$select hq.deactivate_staff(gen_random_uuid())$$, '42501', null, 'non-staff cannot deactivate_staff');
select pg_temp.unbecome();

-- ------------------------------------------------------------ each role's capabilities match the section 4 matrix exactly
select pg_temp.become('dir');
select is(pg_temp.caps_my_access(), array['ai.use', 'audit.read', 'contractors.approve', 'contractors.documents', 'contractors.read', 'contractors.write', 'decisions.read', 'decisions.write', 'growth.delete', 'growth.read', 'growth.write', 'import.run', 'people.admin', 'people.read', 'settings.admin', 'tasks.read_all', 'tasks.write'], 'director: my_access capabilities = all seventeen (ten Phase 1, four contractors, ai.use, two decisions)');
select is(pg_temp.caps_can(), array['audit.read', 'growth.delete', 'growth.read', 'growth.write', 'import.run', 'people.admin', 'people.read', 'settings.admin', 'tasks.read_all', 'tasks.write'], 'director: can() = all ten');
select pg_temp.become('adm');
select is(pg_temp.caps_my_access(), array['ai.use', 'audit.read', 'contractors.approve', 'contractors.documents', 'contractors.read', 'contractors.write', 'decisions.read', 'decisions.write', 'growth.delete', 'growth.read', 'growth.write', 'import.run', 'people.admin', 'people.read', 'tasks.read_all', 'tasks.write'], 'administrator: my_access = all except settings.admin');
select is(pg_temp.caps_can(), array['audit.read', 'growth.delete', 'growth.read', 'growth.write', 'import.run', 'people.admin', 'people.read', 'tasks.read_all', 'tasks.write'], 'administrator: can() = all except settings.admin');
select pg_temp.become('bdm');
select is(pg_temp.caps_my_access(), array['ai.use', 'contractors.read', 'decisions.read', 'growth.read', 'growth.write', 'import.run', 'people.read', 'tasks.read_all', 'tasks.write'], 'business_development_manager: my_access');
select is(pg_temp.caps_can(), array['growth.read', 'growth.write', 'import.run', 'people.read', 'tasks.read_all', 'tasks.write'], 'business_development_manager: can()');
select pg_temp.become('spm');
select is(pg_temp.caps_my_access(), array['ai.use', 'contractors.documents', 'contractors.read', 'contractors.write', 'decisions.read', 'growth.read', 'people.read', 'tasks.read_all', 'tasks.write'], 'senior_property_manager: my_access');
select is(pg_temp.caps_can(), array['growth.read', 'people.read', 'tasks.read_all', 'tasks.write'], 'senior_property_manager: can()');
select pg_temp.become('pm');
select is(pg_temp.caps_my_access(), array['ai.use', 'contractors.documents', 'contractors.read', 'contractors.write', 'growth.read', 'people.read', 'tasks.write'], 'property_manager: my_access');
select is(pg_temp.caps_can(), array['growth.read', 'people.read', 'tasks.write'], 'property_manager: can()');
select pg_temp.become('jpm');
select is(pg_temp.caps_my_access(), array['ai.use', 'contractors.read', 'people.read', 'tasks.write'], 'junior_property_manager: my_access');
select is(pg_temp.caps_can(), array['people.read', 'tasks.write'], 'junior_property_manager: can()');
select pg_temp.become('va');
select is(pg_temp.caps_my_access(), array['ai.use', 'contractors.documents', 'contractors.read', 'contractors.write', 'growth.read', 'growth.write', 'people.read', 'tasks.write'], 'virtual_assistant: my_access');
select is(pg_temp.caps_can(), array['growth.read', 'growth.write', 'people.read', 'tasks.write'], 'virtual_assistant: can()');
select pg_temp.become('ro');
select is(pg_temp.caps_my_access(), array['contractors.read', 'decisions.read', 'growth.read', 'people.read', 'tasks.read_all'], 'read_only: my_access');
select is(pg_temp.caps_can(), array['growth.read', 'people.read', 'tasks.read_all'], 'read_only: can()');
select pg_temp.unbecome();

select is((select count(*) from hq.role_capabilities), 75::bigint, 'the matrix holds 75 role/capability rows (41 Phase 1, 20 contractors, 7 ai.use, 7 decisions)');
select is((select count(*) from hq.role_capabilities where role = 'director'), 17::bigint, 'director: 17 rows');
select is((select count(*) from hq.role_capabilities where role = 'administrator' and capability = 'settings.admin'), 0::bigint, 'administrator has no settings.admin row');

-- my_access shape
select pg_temp.become('pm');
select is(hq.my_access() - 'staff_id' - 'capabilities',
  '{"aal": "aal2", "role": "property_manager", "timezone": "Australia/Adelaide", "full_name": "Pat Manager", "first_name": "Pat", "mfa_required": true}'::jsonb,
  'my_access returns {staff_id, full_name, first_name, role, timezone, mfa_required, aal, capabilities}');
select is((hq.my_access() ->> 'staff_id')::uuid, pg_temp.fx('pm'), 'my_access.staff_id is the caller');
select pg_temp.unbecome();

-- ------------------------------------------------------------ MFA
select pg_temp.become('dir', 'aal1');
select is(hq.my_access() ->> 'aal', 'aal1', 'aal1: my_access works and reports aal1');
select is(hq.my_access() -> 'capabilities', '[]'::jsonb, 'aal1 with require_mfa: capabilities is an empty array');
select is(hq.my_access() ->> 'mfa_required', 'true', 'aal1 with require_mfa: mfa_required is true');
select is(hq.my_access() ->> 'role', 'director', 'aal1: the role is still reported so the app can ask for MFA');
select is(hq.can('growth.read'), false, 'aal1 with require_mfa: can() is false');
select is(pg_temp.visible_rows(), 0::bigint, 'aal1 with require_mfa: no hq data is readable');
select throws_ok($$insert into hq.organisations (name, categories) values ('Aal1 Co', '{other}')$$, '42501', null, 'aal1 with require_mfa: no writes');
select throws_ok($$select hq.growth_summary(null)$$, '42501', null, 'aal1 with require_mfa: RPCs are refused');
select pg_temp.login(pg_temp.fx('dir'), null);
select is(hq.my_access() ->> 'aal', 'aal1', 'no aal claim at all is treated as aal1');
select is(pg_temp.visible_rows(), 0::bigint, 'no aal claim: no hq data is readable');
select pg_temp.become('dir');
select is(hq.my_access() ->> 'aal', 'aal2', 'aal2: my_access reports aal2');
select is(array_length(pg_temp.caps_my_access(), 1), 17, 'aal2: the director holds seventeen capabilities');
select is((select count(*) from hq.organisations where deleted_at is null), 3::bigint, 'aal2: data is readable');
select pg_temp.unbecome();

update hq.settings set value = 'false'::jsonb where key = 'require_mfa';
select pg_temp.become('dir', 'aal1');
select is(hq.my_access() ->> 'mfa_required', 'false', 'require_mfa=false: mfa_required is false');
select is(array_length(pg_temp.caps_my_access(), 1), 17, 'require_mfa=false: aal1 holds all capabilities');
select is((select count(*) from hq.organisations where deleted_at is null), 3::bigint, 'require_mfa=false: aal1 reads data');
select lives_ok($$insert into hq.organisations (name, categories) values ('Aal1 Allowed Co', '{other}')$$, 'require_mfa=false: aal1 can write');
select pg_temp.unbecome();

delete from hq.settings where key = 'require_mfa';
select pg_temp.become('dir', 'aal1');
select is(hq.my_access() -> 'capabilities', '[]'::jsonb, 'a missing require_mfa setting means MFA is required');
select pg_temp.unbecome();
insert into hq.settings (key, value) values ('require_mfa', 'true'::jsonb);

-- ------------------------------------------------------------ read_only
select pg_temp.become('ro');
select is((select count(*) from hq.organisations where id in (select id from fx)), 3::bigint, 'read_only can read organisations');
select throws_ok($$insert into hq.organisations (name, categories) values ('RO Co', '{other}')$$, '42501', null, 'read_only cannot insert an organisation');
select throws_ok($$insert into hq.contacts (full_name) values ('RO Person')$$, '42501', null, 'read_only cannot insert a contact');
select throws_ok($$insert into hq.tasks (title) values ('RO task')$$, '42501', null, 'read_only cannot insert a task');
update hq.organisations set notes = 'changed by read_only' where id = pg_temp.fx('alpha');
select throws_ok($$select hq.record_interaction(null, '$$ || pg_temp.fx('alpha') || $$', 'note', null, 'x')$$, '42501', null, 'read_only cannot record_interaction');
select throws_ok($$select hq.record_referral('sent', null, null, null, '$$ || pg_temp.fx('alpha') || $$')$$, '42501', null, 'read_only cannot record_referral');
select throws_ok($$select hq.archive_record('organisation', '$$ || pg_temp.fx('alpha') || $$')$$, '42501', null, 'read_only cannot archive');
select pg_temp.unbecome();
select is((select notes from hq.organisations where id = pg_temp.fx('alpha')), null, 'read_only update changed nothing (RLS filtered the row)');

-- ------------------------------------------------------------ junior property manager
insert into hq.tasks (title, assigned_to, created_by) values ('vis-dir-for-pm', pg_temp.fx('pm'), pg_temp.fx('dir'));
select pg_temp.become('jpm');
select is((select count(*) from hq.organisations) + (select count(*) from hq.contacts) + (select count(*) from hq.referrals)
        + (select count(*) from hq.opportunities) + (select count(*) from hq.interactions), 0::bigint,
  'junior: cannot read organisations, contacts, referrals, opportunities or interactions');
select is((select count(*) from hq.contact_directory) + (select count(*) from hq.organisation_directory) + (select count(*) from hq.referral_overview)
        + (select count(*) from hq.partner_performance) + (select count(*) from hq.overdue_followups) + (select count(*) from hq.referral_partner_overview), 0::bigint, 'junior: the directory views are empty');
select is(hq.global_search('alpha', 5), '{"contacts": [], "organisations": [], "referrals": [], "tasks": [], "contractors": []}'::jsonb, 'junior: global_search finds no partners');
select is((select count(*) from hq.audit_events), 0::bigint, 'junior: cannot read the audit log');
select throws_ok($$insert into hq.organisations (name, categories) values ('Junior Co', '{other}')$$, '42501', null, 'junior cannot create an organisation');
select throws_ok($$select hq.record_interaction(null, '$$ || pg_temp.fx('alpha') || $$', 'note', null, 'x')$$, '42501', null, 'junior cannot record_interaction');
select throws_ok($$select hq.growth_summary(null)$$, '42501', null, 'junior cannot growth_summary');
select lives_ok($$insert into hq.tasks (title, assigned_to) values ('vis-junior-own', pg_temp.fx('jpm'))$$, 'junior can create a task');
select is((select count(*) from hq.tasks where title = 'vis-junior-own'), 1::bigint, 'junior sees their own task');
select is((select count(*) from hq.tasks where title = 'vis-dir-for-pm'), 0::bigint, 'junior does not see a task assigned to someone else by someone else');
select is((select count(*) filter (where id in (select id from fx)) from hq.staff_profiles), 9::bigint, 'junior can read the staff list (people.read)');
select is((select count(*) from hq.role_capabilities), 75::bigint, 'junior can read the capability matrix');
select pg_temp.unbecome();

-- created_by cannot be spoofed
select pg_temp.become('va');
select lives_ok($$insert into hq.tasks (title, assigned_to, created_by) values ('vis-spoof', pg_temp.fx('va'), pg_temp.fx('dir'))$$, 'a task is inserted with a spoofed created_by');
select pg_temp.unbecome();
select is((select created_by from hq.tasks where title = 'vis-spoof'), pg_temp.fx('va'), 'created_by is the caller, whatever the client sent');
select pg_temp.become('va');
select lives_ok($$insert into hq.organisations (name, categories, created_by) values ('Spoof Realty', '{other}', pg_temp.fx('dir'))$$, 'an organisation is inserted with a spoofed created_by');
select pg_temp.unbecome();
select is((select created_by from hq.organisations where name = 'Spoof Realty'), pg_temp.fx('va'), 'organisations.created_by is the caller too');

-- ------------------------------------------------------------ task visibility: assignee, creator, tasks.read_all
delete from hq.tasks where title in ('vis-dir-for-pm', 'vis-junior-own', 'vis-spoof');
insert into hq.tasks (title, assigned_to, created_by) values
  ('vis-a', pg_temp.fx('pm'), pg_temp.fx('dir')),
  ('vis-b', pg_temp.fx('va'), pg_temp.fx('pm')),
  ('vis-c', pg_temp.fx('spm'), pg_temp.fx('spm')),
  ('vis-d', pg_temp.fx('jpm'), pg_temp.fx('jpm'));
create function pg_temp.vis() returns text[] language sql as $$ select coalesce(array_agg(title order by title), '{}') from hq.tasks where title like 'vis-%' and deleted_at is null $$;
select pg_temp.become('pm');
select is(pg_temp.vis(), array['vis-a', 'vis-b'], 'property_manager sees the task assigned to them and the one they created');
select pg_temp.become('va');
select is(pg_temp.vis(), array['vis-b'], 'virtual_assistant sees only the task assigned to them');
select pg_temp.become('jpm');
select is(pg_temp.vis(), array['vis-d'], 'junior sees only their own task');
select pg_temp.become('spm');
select is(pg_temp.vis(), array['vis-a', 'vis-b', 'vis-c', 'vis-d'], 'senior_property_manager (tasks.read_all) sees every task');
select pg_temp.become('bdm');
select is(pg_temp.vis(), array['vis-a', 'vis-b', 'vis-c', 'vis-d'], 'business_development_manager (tasks.read_all) sees every task');
select pg_temp.become('ro');
select is(pg_temp.vis(), array['vis-a', 'vis-b', 'vis-c', 'vis-d'], 'read_only (tasks.read_all) sees every task');
select pg_temp.become('adm');
select is(pg_temp.vis(), array['vis-a', 'vis-b', 'vis-c', 'vis-d'], 'administrator sees every task');
select pg_temp.become('dir');
select is(pg_temp.vis(), array['vis-a', 'vis-b', 'vis-c', 'vis-d'], 'director sees every task');
select pg_temp.become('pm');
update hq.tasks set title = 'vis-c-hijacked' where title = 'vis-c';
select pg_temp.unbecome();
select is((select count(*) from hq.tasks where title = 'vis-c'), 1::bigint, 'a task you cannot see cannot be updated');

-- completion is stamped by the database
select pg_temp.become('pm');
update hq.tasks set status = 'completed' where title = 'vis-a';
select pg_temp.unbecome();
select is((select completed_by from hq.tasks where title = 'vis-a'), pg_temp.fx('pm'), 'completing a task stamps completed_by');
select ok((select completed_at is not null from hq.tasks where title = 'vis-a'), 'completing a task stamps completed_at');
select pg_temp.become('pm');
update hq.tasks set status = 'in_progress' where title = 'vis-a';
select pg_temp.unbecome();
select ok((select completed_at is null and completed_by is null from hq.tasks where title = 'vis-a'), 'reopening a task clears the completion stamp');
update hq.tasks set completed_at = now() where title = 'vis-b';
select is((select completed_at from hq.tasks where title = 'vis-b'), null, 'completed_at cannot be set by hand on a task that is not completed');

-- ------------------------------------------------------------ staff administration
select pg_temp.mk_user('newdir@hq.test', 'Nia Newdirector', 'Nia') as u_newdir \gset
select pg_temp.mk_user('newpm@hq.test', 'Nev Newpm', 'Nev') as u_newpm \gset
select pg_temp.mk_user('newdir2@hq.test', 'Nora Second', 'Nora') as u_newdir2 \gset
select pg_temp.mk_user('lonely@hq.test', 'Lou Lonely', 'Lou') as u_lonely \gset

select pg_temp.become('adm');
select throws_ok($$select hq.add_staff('$$ || :'u_newdir' || $$', 'newdir@hq.test', 'Nia Newdirector', 'director')$$, '42501', 'only a director can create a director', 'administrator cannot create a director');
select lives_ok($$select hq.add_staff('$$ || :'u_newpm' || $$', 'NewPM@hq.test', 'Nev Newpm', 'property_manager', null, 'Nev', current_date, 'Looks after the coast')$$, 'administrator can add a property manager');
select throws_ok($$select hq.add_staff('$$ || :'u_newpm' || $$', 'newpm@hq.test', 'Nev Again', 'read_only')$$, '23505', null, 'adding the same person twice is refused');
select throws_ok($$select hq.add_staff(gen_random_uuid(), 'nobody@hq.test', 'No Body', 'read_only')$$, '22023', null, 'add_staff needs an existing sign-in (auth.users row with that id and email)');
select throws_ok($$select hq.add_staff('$$ || :'u_lonely' || $$', 'wrong@hq.test', 'Lou Lonely', 'read_only')$$, '22023', null, 'add_staff checks the email matches the sign-in');
select throws_ok($$select hq.update_staff('$$ || pg_temp.fx('dir2') || $$', p_full_name := 'Hacked')$$, '42501', 'only a director can change a director', 'administrator cannot modify a director');
select throws_ok($$select hq.update_staff('$$ || pg_temp.fx('pm') || $$', p_role := 'director')$$, '42501', 'only a director can make someone a director', 'administrator cannot promote anyone to director');
select throws_ok($$select hq.update_staff('$$ || pg_temp.fx('adm') || $$', p_role := 'director')$$, '42501', null, 'administrator cannot promote themselves');
select throws_ok($$select hq.deactivate_staff('$$ || pg_temp.fx('dir2') || $$')$$, '42501', 'only a director can deactivate a director', 'administrator cannot deactivate a director');
select lives_ok($$select hq.update_staff('$$ || pg_temp.fx('pm') || $$', p_responsibilities := 'Coast portfolio', p_role := 'senior_property_manager')$$, 'administrator can change a non-director''s role and responsibilities');
select pg_temp.unbecome();
select is((select role::text || '/' || email::text || '/' || coalesce(invited_by::text, '') from hq.staff_profiles where id = :'u_newpm'::uuid),
  'property_manager/newpm@hq.test/' || pg_temp.fx('adm'), 'the new profile is stored lower-cased, with invited_by = the administrator');
select is((select count(*) from hq.audit_events where action = 'invite' and entity_id = :'u_newpm'::uuid and actor_id = pg_temp.fx('adm')), 1::bigint, 'add_staff is audited as an invite by the administrator');
select is((select role::text from hq.staff_profiles where id = pg_temp.fx('pm')), 'senior_property_manager', 'the role change was applied');
select is((select count(*) from hq.audit_events where entity_type = 'staff' and entity_id = pg_temp.fx('pm') and action = 'update' and changes ? 'role'), 1::bigint, 'the role change is audited with a from/to diff');

select pg_temp.become('dir');
select lives_ok($$select hq.add_staff('$$ || :'u_newdir' || $$', 'newdir@hq.test', 'Nia Newdirector', 'director')$$, 'a director can create a director');
select lives_ok($$select hq.update_staff('$$ || pg_temp.fx('adm') || $$', p_full_name := 'Ada Administrator')$$, 'a director can change an administrator');
select throws_ok($$select hq.deactivate_staff('$$ || pg_temp.fx('dir') || $$')$$, '42501', null, 'nobody can deactivate themselves');
select throws_ok($$select hq.update_staff('$$ || pg_temp.fx('dir') || $$', p_role := 'administrator')$$, '42501', null, 'nobody changes their own role');
select pg_temp.unbecome();

-- self-service: a person may change their own timezone and dashboard widgets, nothing else
select pg_temp.become('jpm');
select lives_ok($$select hq.update_staff('$$ || pg_temp.fx('jpm') || $$', p_timezone := 'Australia/Perth', p_dashboard_widgets := array['tasks'])$$, 'a person can change their own timezone and widgets');
select throws_ok($$select hq.update_staff('$$ || pg_temp.fx('jpm') || $$', p_role := 'director')$$, '42501', null, 'a person cannot change their own role');
select throws_ok($$select hq.update_staff('$$ || pg_temp.fx('jpm') || $$', p_responsibilities := 'Everything')$$, '42501', null, 'a person cannot change their own responsibilities');
select throws_ok($$select hq.update_staff('$$ || pg_temp.fx('va') || $$', p_timezone := 'Australia/Perth')$$, '42501', null, 'a person cannot change someone else''s timezone');
select throws_ok($$select hq.update_staff('$$ || pg_temp.fx('jpm') || $$', p_timezone := 'Mars/Olympus')$$, '22023', null, 'an unknown timezone is refused');
select is((hq.my_access() ->> 'timezone'), 'Australia/Perth', 'my_access reports the person''s own timezone');
select throws_ok($$update hq.staff_profiles set role = 'director' where id = pg_temp.fx('jpm')$$, '42501', null, 'staff_profiles cannot be written directly');
select pg_temp.unbecome();
select is((select dashboard_widgets from hq.staff_profiles where id = pg_temp.fx('jpm')), array['tasks'], 'dashboard widgets saved');

-- the live staff row is read on every query: deactivating ends access at once
select pg_temp.become('dir');
select lives_ok($$select hq.deactivate_staff('$$ || pg_temp.fx('dir2') || $$', 'left the company')$$, 'a director can deactivate another director');
select pg_temp.become('dir2');
select is(hq.my_access(), null::jsonb, 'a deactivated person: my_access is null even with a valid aal2 token');
select is(pg_temp.visible_rows(), 0::bigint, 'a deactivated person: reads nothing');
select is(hq.can('growth.read'), false, 'a deactivated person: can() is false');
select pg_temp.unbecome();
select is((select is_active::text || '/' || employment_status::text from hq.staff_profiles where id = pg_temp.fx('dir2')), 'false/ended', 'deactivation sets is_active false and employment_status ended (history kept)');
select is((select count(*) from hq.audit_events where action = 'deactivate' and entity_id = pg_temp.fx('dir2') and summary like '%left the company%'), 1::bigint, 'deactivation is audited with its reason');
select pg_temp.become('dir');
select lives_ok($$select hq.update_staff('$$ || pg_temp.fx('dir2') || $$', p_is_active := true, p_employment_status := 'active')$$, 'a director can reactivate someone');
select pg_temp.become('dir2');
select ok(hq.my_access() is not null, 'a reactivated person has access again');
select pg_temp.unbecome();

update hq.staff_profiles set employment_status = 'on_leave' where id = pg_temp.fx('va');
select pg_temp.become('va');
select is(hq.my_access(), null::jsonb, 'on_leave: no access');
select pg_temp.unbecome();
update hq.staff_profiles set employment_status = 'active' where id = pg_temp.fx('va');

-- ------------------------------------------------------------ at least one active director must remain
update hq.staff_profiles set is_active = false where id in (pg_temp.fx('dir2'), :'u_newdir'::uuid);
select throws_ok($$update hq.staff_profiles set is_active = false where id = pg_temp.fx('dir')$$, '23514', 'at least one active director must remain', 'the last active director cannot be deactivated');
select throws_ok($$update hq.staff_profiles set role = 'administrator' where id = pg_temp.fx('dir')$$, '23514', 'at least one active director must remain', 'the last active director cannot be demoted');
select throws_ok($$update hq.staff_profiles set employment_status = 'ended' where id = pg_temp.fx('dir')$$, '23514', 'at least one active director must remain', 'the last active director cannot be ended');
select throws_ok($$delete from hq.staff_profiles where id = pg_temp.fx('dir')$$, '23514', 'at least one active director must remain', 'the last active director cannot be removed');
select pg_temp.become('adm');
select throws_ok($$select hq.deactivate_staff('$$ || pg_temp.fx('dir') || $$')$$, '42501', null, 'an administrator cannot deactivate the last director either');
select pg_temp.unbecome();
select lives_ok($$update hq.staff_profiles set is_active = true where id = pg_temp.fx('dir2')$$, 'a second director can be reactivated');
select lives_ok($$update hq.staff_profiles set is_active = false where id = pg_temp.fx('dir')$$, 'with another active director, the first can be deactivated');

-- ------------------------------------------------------------ settings and pods
update hq.staff_profiles set is_active = true where id = pg_temp.fx('dir');
select pg_temp.become('adm');
update hq.settings set value = 'false'::jsonb where key = 'require_mfa';
select pg_temp.unbecome();
select is((select value from hq.settings where key = 'require_mfa'), 'true'::jsonb, 'an administrator cannot change settings (settings.admin is a director capability)');
select pg_temp.become('dir');
select lives_ok($$update hq.settings set value = 'false'::jsonb where key = 'require_mfa'$$, 'a director can change a setting');
select throws_ok($$update hq.settings set value = '"yes"'::jsonb where key = 'require_mfa'$$, '22023', 'require_mfa must be true or false', 'require_mfa must be a boolean');
select throws_ok($$update hq.settings set value = '"Mars/Olympus"'::jsonb where key = 'timezone'$$, '22023', 'timezone must be an IANA timezone name', 'timezone must be a real IANA name');
update hq.settings set value = 'true'::jsonb where key = 'require_mfa';
select throws_ok($$insert into hq.settings (key, value) values ('extra', '1'::jsonb)$$, '42501', null, 'settings cannot be inserted by the API');
select throws_ok($$insert into hq.role_capabilities (role, capability) values ('read_only', 'growth.write')$$, '42501', null, 'the capability matrix cannot be changed by the API');
select pg_temp.unbecome();
select is((select count(*) from hq.audit_events where entity_type = 'setting' and action = 'update' and summary like '%require_mfa%'), 3::bigint, 'setting changes are audited');
select pg_temp.become('adm');
select lives_ok($$insert into hq.pods (name, region) values ('Coast', 'Copper Coast')$$, 'an administrator can create a pod');
select pg_temp.become('pm');
select throws_ok($$insert into hq.pods (name) values ('Rogue')$$, '42501', null, 'a property manager cannot create a pod');
select is((select count(*) from hq.pods where name = 'Coast'), 1::bigint, 'a property manager can read pods');
select pg_temp.unbecome();

select * from finish();
rollback;
