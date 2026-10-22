-- Planted HQ: workspaces, Phase 1 (migrations 0160, 0161). The workspace preference (each person sets
-- only their own, it grants nothing), the call outcome and promised callback on interactions (phone calls
-- only, a callback needs a date, existing rows untouched), "no further follow-up" clearing a contact's
-- follow-up, the same on a lead, and a website appraisal request starting its new lead at Appraisal
-- requested while the contact form still starts at Introduction received.
--
-- NOTE: never CALL a function a hint role lacks execute on (see hq_01).
begin;
\ir hq_fixture.inc
select pg_temp.seed_hq();
select plan(31);

create temp table zz_r (k text primary key, v jsonb) on commit drop;
grant select, insert, update on zz_r to public;
create function pg_temp.r(p_k text) returns jsonb language sql stable as $$ select v from zz_r where k = p_k $$;
grant execute on function pg_temp.r(text) to public;

-- ------------------------------------------------------------ structure and privileges
select enum_has_labels('hq', 'workspace', array['grow', 'deliver', 'support', 'overview']);
select enum_has_labels('hq', 'call_outcome', array['spoke', 'left_message', 'no_answer', 'wrong_number']);
select is((select is_nullable from information_schema.columns where table_schema = 'hq' and table_name = 'staff_profiles' and column_name = 'workspace'), 'YES', 'workspace is optional: null means the role default');
select is((select column_default from information_schema.columns where table_schema = 'hq' and table_name = 'interactions' and column_name = 'callback_promised'), 'false', 'a call is not a promised callback unless marked');
select ok(has_function_privilege('authenticated', 'hq.set_my_workspace(hq.workspace)', 'execute')
      and not has_function_privilege('anon', 'hq.set_my_workspace(hq.workspace)', 'execute'), 'set_my_workspace: authenticated only');
select ok(has_function_privilege('authenticated', 'hq.record_interaction(uuid,uuid,hq.interaction_type,timestamptz,text,text,date,boolean,uuid,hq.relationship_status,hq.call_outcome,boolean,boolean)', 'execute')
      and has_function_privilege('authenticated', 'hq.log_opportunity_activity(uuid,hq.interaction_type,timestamptz,text,text,date,boolean,uuid,hq.call_outcome,boolean)', 'execute'),
  'the call RPCs with outcome are executable by authenticated');
select is((select count(*) from pg_proc where proname in ('record_interaction', 'log_opportunity_activity') and pronamespace = 'hq'::regnamespace), 2::bigint, 'the old call signatures are gone (one of each)');
select ok(not has_function_privilege('authenticated', 'hq.submit_enquiry(hq.enquiry_kind,text,text,text,text,text,jsonb,text,text)', 'execute')
      and has_function_privilege('service_role', 'hq.submit_enquiry(hq.enquiry_kind,text,text,text,text,text,jsonb,text,text)', 'execute'),
  'submit_enquiry keeps its privileges (service_role only)');

-- ------------------------------------------------------------ the workspace preference
select pg_temp.become('bdm');
select lives_ok($$select hq.set_my_workspace('grow')$$, 'a BDM saves Grow as their workspace');
select is((select workspace::text from hq.staff_profiles where id = pg_temp.fx('bdm')), 'grow', '... and it is stored on their own profile');
select is((select workspace from hq.staff_profiles where id = pg_temp.fx('dir')), null, '... nobody else''s changes');
select lives_ok($$select hq.set_my_workspace(null)$$, 'null goes back to the role default');
select is((select workspace from hq.staff_profiles where id = pg_temp.fx('bdm')), null, '... and clears it');
select pg_temp.unbecome();
select pg_temp.become('jpm');
select lives_ok($$select hq.set_my_workspace('grow')$$, 'a junior PM may save any workspace: it grants nothing');
select pg_temp.unbecome();
select is((select count(*) from hq.role_capabilities where role = 'junior_property_manager' and capability = 'growth.read'), 0::bigint, '... and the role still holds no growth.read');
select pg_temp.become_anon();
select throws_ok($$select hq.set_my_workspace('grow')$$, '42501', null, 'anon cannot set a workspace');
select pg_temp.unbecome();

-- ------------------------------------------------------------ call outcome on a contact
select pg_temp.become('bdm');
select lives_ok($$insert into zz_r values ('c1', hq.record_interaction(p_contact => pg_temp.fx('alice'), p_type => 'phone_call', p_summary => 'Happy to meet',
  p_outcome => 'spoke', p_callback_promised => true, p_follow_up_date => hq.today() + 3))$$, 'a call with an outcome and a promised callback');
select is((select outcome::text || '/' || callback_promised::text from hq.interactions where id = (pg_temp.r('c1') ->> 'interaction_id')::uuid), 'spoke/true', '... stores both');
select is((select next_follow_up_date from hq.contacts where id = pg_temp.fx('alice')), hq.today() + 3, '... and sets the contact''s follow-up');
select throws_ok($$select hq.record_interaction(p_contact => pg_temp.fx('alice'), p_type => 'phone_call', p_summary => 'x', p_callback_promised => true)$$,
  '22023', 'a promised callback needs a follow-up date', 'a promised callback needs a date');
select throws_ok($$select hq.record_interaction(p_contact => pg_temp.fx('alice'), p_type => 'email', p_summary => 'x', p_outcome => 'spoke')$$,
  '22023', 'an outcome belongs to a phone call', 'an outcome is for phone calls only');
select throws_ok($$select hq.record_interaction(p_contact => pg_temp.fx('alice'), p_type => 'phone_call', p_summary => 'x', p_clear_follow_up => true, p_follow_up_date => hq.today() + 1)$$,
  '22023', 'choose a follow-up date or no further follow-up, not both', 'a date and no further follow-up cannot both be given');
select lives_ok($$select hq.record_interaction(p_contact => pg_temp.fx('alice'), p_type => 'phone_call', p_summary => 'Not interested for now', p_outcome => 'spoke', p_clear_follow_up => true)$$,
  'no further follow-up');
select is((select next_follow_up_date from hq.contacts where id = pg_temp.fx('alice')), null, '... clears the contact''s follow-up');
select lives_ok($$select hq.record_interaction(p_contact => pg_temp.fx('bob'), p_type => 'note', p_summary => 'An old-style note')$$, 'the old call shape still works (no outcome)');
select is((select callback_promised from hq.interactions where contact_id = pg_temp.fx('bob') and deleted_at is null), false, '... and is not a promised callback');

-- ------------------------------------------------------------ call outcome on a lead
select lives_ok($$insert into zz_r values ('o1', hq.create_opportunity(p_prospect_name => '[test] Lena Lead', p_source => 'own_marketing', p_next_action => 'Call', p_next_action_due => hq.today() + 1))$$, 'a lead to call');
select lives_ok($$select hq.log_opportunity_activity((pg_temp.r('o1') ->> 'opportunity_id')::uuid, 'phone_call', null, 'Left a voicemail', 'Call again', hq.today() + 2, false, null, 'left_message', true)$$,
  'a lead call with an outcome and a promised callback');
select is((select outcome::text || '/' || callback_promised::text || '/' || follow_up_date::text from hq.interactions where opportunity_id = (pg_temp.r('o1') ->> 'opportunity_id')::uuid and interaction_type = 'phone_call'),
  'left_message/true/' || (hq.today() + 2)::text, '... stores the outcome, the callback and its date');
select pg_temp.unbecome();

-- ------------------------------------------------------------ website enquiries: the new lead's stage
select pg_temp.become_service();
select is((hq.submit_enquiry('appraisal', '[test] Ava Appraisal', 'ava@example.test', null, 'Moonta', 'Please appraise', '{"consent": "yes"}', '/rental-appraisal', repeat('b', 64)) ->> 'opportunity_id') is not null, true, 'an appraisal request makes a lead');
select pg_temp.unbecome();
select is((select stage::text from hq.opportunities where prospect_email = 'ava@example.test' and deleted_at is null), 'appraisal_requested', '... that starts at Appraisal requested');

select * from finish();
rollback;
