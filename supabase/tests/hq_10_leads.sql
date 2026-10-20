-- Planted HQ: the leads pipeline (0127, 0128). Direct leads (create_opportunity), editing a lead
-- (update_opportunity), activity on a lead (log_opportunity_activity), the open-lead rule (owner, next
-- action, follow-up date), the duplicate guard, source and lost-reason rules, landlord contacts kept out
-- of every partner view and count, the overdue view on its boundary days, forged callers and RLS.
begin;
\ir hq_fixture.inc
select pg_temp.seed_hq();
select plan(135);

-- The hint / detail of the error a statement raises (null when it raises nothing).
create function pg_temp.err(p_sql text, p_part text default 'hint') returns text language plpgsql as $$
declare v_hint text; v_detail text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint, v_detail = pg_exception_detail;
  return case p_part when 'detail' then v_detail else v_hint end;
end $$;

-- Partner figures BEFORE any landlord exists: they must be identical afterwards.
create temp table before_partners on commit drop as
select
  (select count(*) from hq.referral_partner_overview) as partners,
  (select coalesce(sum(contact_count), 0) from hq.referral_partner_overview) as contact_count,
  (select count(*) from hq.referral_partner_overview where partner_kind = 'independent') as independents,
  (select string_agg(id::text || ':' || coalesce(primary_contact_id::text, '-') || ':' || coalesce(relationship_status::text, '-'), ',' order by id) from hq.referral_partner_overview) as shape;
grant select on before_partners to public;
select pg_temp.become('dir');
create temp table before_summary on commit drop as
select (hq.growth_summary() -> 'contacts_by_status') as by_status, (hq.growth_summary() ->> 'contacts_not_contacted_30d') as stale;
select pg_temp.unbecome();
grant select on before_summary to public;

-- ------------------------------------------------------------ structure and function privileges
select has_function('hq', 'create_opportunity', 'create_opportunity exists');
select has_function('hq', 'update_opportunity', 'update_opportunity exists');
select has_function('hq', 'log_opportunity_activity', 'log_opportunity_activity exists');
select ok(has_function_privilege('authenticated', 'hq.create_opportunity(text,text,text,text,text,hq.lead_source,uuid,text,date,date,bigint,text,boolean,boolean)', 'execute')
      and has_function_privilege('authenticated', 'hq.update_opportunity(uuid,text,text,text,text,text,hq.lead_source,uuid,text,date,date,bigint,text,uuid,text[],timestamptz)', 'execute')
      and has_function_privilege('authenticated', 'hq.log_opportunity_activity(uuid,hq.interaction_type,timestamptz,text,text,date,boolean,uuid)', 'execute')
      and has_function_privilege('authenticated', 'hq.move_opportunity(uuid,hq.opportunity_stage,text,timestamptz,text,text,hq.lost_reason)', 'execute'),
  'authenticated can execute the four lead RPCs');
select ok(not has_function_privilege('anon', 'hq.create_opportunity(text,text,text,text,text,hq.lead_source,uuid,text,date,date,bigint,text,boolean,boolean)', 'execute')
      and not has_function_privilege('anon', 'hq.log_opportunity_activity(uuid,hq.interaction_type,timestamptz,text,text,date,boolean,uuid)', 'execute')
      and not has_function_privilege('service_role', 'hq.update_opportunity(uuid,text,text,text,text,text,hq.lead_source,uuid,text,date,date,bigint,text,uuid,text[],timestamptz)', 'execute'),
  'anon and service_role cannot execute them');
select is((select count(*) from pg_proc where pronamespace = 'hq'::regnamespace and proname = 'move_opportunity'), 1::bigint, 'there is one move_opportunity (the six-argument one was replaced)');
select ok((select prosecdef from pg_proc where oid = 'hq.create_opportunity(text,text,text,text,text,hq.lead_source,uuid,text,date,date,bigint,text,boolean,boolean)'::regprocedure)
      and (select prosecdef from pg_proc where oid = 'hq.log_opportunity_activity(uuid,hq.interaction_type,timestamptz,text,text,date,boolean,uuid)'::regprocedure), 'the lead RPCs are security definer');
select is((select count(*) from pg_class where oid in ('hq.opportunity_overview'::regclass, 'hq.overdue_opportunities'::regclass) and reloptions @> array['security_invoker=true']), 2::bigint, 'both new views are security_invoker');
select is((select count(*) from hq.opportunities o where o.stage not in ('management_signed', 'lost') and o.deleted_at is null and (o.next_action is null or o.next_action_due is null)), 0::bigint, 'every live open lead has a next action and a follow-up date (backfill)');
select is((select column_default from information_schema.columns where table_schema = 'hq' and table_name = 'contacts' and column_name = 'contact_kind'), '''partner''::hq.contact_kind', 'contact_kind defaults to partner');

-- ------------------------------------------------------------ forged callers
select pg_temp.become_anon();
select throws_ok($$select hq.create_opportunity('Anon Lead', p_source := 'own_marketing', p_next_action := 'x', p_next_action_due := hq.today() + 1)$$, '42501', null, 'anon cannot create a lead (no schema usage)');
select throws_ok($$select count(*) from hq.opportunity_overview$$, '42501', null, 'anon cannot read opportunity_overview');
select pg_temp.become('outsider');
select throws_ok($$select hq.create_opportunity('Outsider Lead', p_source := 'own_marketing', p_next_action := 'x', p_next_action_due := hq.today() + 1)$$, '42501', null, 'a signed-in non-staff user cannot create a lead');
select is((select count(*) from hq.opportunity_overview), 0::bigint, 'a non-staff user reads no leads');
select pg_temp.become('ro');
select throws_ok($$select hq.create_opportunity('RO Lead', p_source := 'own_marketing', p_next_action := 'x', p_next_action_due := hq.today() + 1)$$, '42501', null, 'read_only cannot create a lead');
select pg_temp.become('jpm');
select throws_ok($$select hq.create_opportunity('Junior Lead', p_source := 'own_marketing', p_next_action := 'x', p_next_action_due := hq.today() + 1)$$, '42501', null, 'a junior property manager cannot create a lead');
select pg_temp.become('bdm', 'aal1');
select throws_ok($$select hq.create_opportunity('AAL1 Lead', p_source := 'own_marketing', p_next_action := 'x', p_next_action_due := hq.today() + 1)$$, '42501', null, 'MFA required: an aal1 session cannot create a lead');
select pg_temp.unbecome();
select is((select count(*) from hq.opportunities where prospect_name like '% Lead' and deleted_at is null), 0::bigint, 'no forged call left a lead behind');

-- ------------------------------------------------------------ create_opportunity: required fields and rules
select pg_temp.become('bdm');
select throws_ok($$select hq.create_opportunity('  ', p_source := 'own_marketing', p_next_action := 'Call', p_next_action_due := hq.today() + 1)$$, '22023', null, 'a lead needs a name');
select throws_ok($$select hq.create_opportunity('No Source', p_next_action := 'Call', p_next_action_due := hq.today() + 1)$$, '22023', 'say where the lead came from', 'a lead needs a source');
select is(pg_temp.err($$select hq.create_opportunity('Partner Lead', p_source := 'referral_partner', p_next_action := 'Call', p_next_action_due := hq.today() + 1)$$), 'use_record_referral', 'source referral_partner is refused: a partner introduction is a received referral');
select throws_ok($$select hq.create_opportunity('No Action', p_source := 'own_marketing', p_next_action_due := hq.today() + 1)$$, '22023', 'a lead needs a next action', 'a lead needs a next action');
select throws_ok($$select hq.create_opportunity('No Due', p_source := 'own_marketing', p_next_action := 'Call')$$, '22023', 'a lead needs a follow-up date', 'a lead needs a follow-up date');
select throws_ok($$select hq.create_opportunity('Past Due', p_source := 'own_marketing', p_next_action := 'Call', p_next_action_due := hq.today() - 1)$$, '22023', null, 'the follow-up date cannot be in the past');
select throws_ok($$select hq.create_opportunity('Far Due', p_source := 'own_marketing', p_next_action := 'Call', p_next_action_due := hq.today() + 731)$$, '22023', null, 'the follow-up date is at most two years ahead');
select throws_ok($$select hq.create_opportunity('Long Action', p_source := 'own_marketing', p_next_action := repeat('x', 301), p_next_action_due := hq.today() + 1)$$, '22023', null, 'the next action is at most 300 characters');
select throws_ok($$select hq.create_opportunity('Past Close', p_source := 'own_marketing', p_next_action := 'Call', p_next_action_due := hq.today() + 1, p_expected_close_date := hq.today() - 1)$$, '22023', null, 'the expected close date cannot be in the past');
select throws_ok($$select hq.create_opportunity('Negative', p_source := 'own_marketing', p_next_action := 'Call', p_next_action_due := hq.today() + 1, p_estimated_annual_value_cents := -1)$$, '22023', null, 'a negative estimate is refused');
select throws_ok($$select hq.create_opportunity('Bad Email', p_prospect_email := 'not-an-email', p_source := 'own_marketing', p_next_action := 'Call', p_next_action_due := hq.today() + 1)$$, '22023', null, 'a malformed email is refused');
select throws_ok($$select hq.create_opportunity('Bad Phone', p_prospect_phone := 'call me', p_source := 'own_marketing', p_next_action := 'Call', p_next_action_due := hq.today() + 1)$$, '22023', null, 'a malformed phone number is refused');
select pg_temp.unbecome();
update hq.staff_profiles set is_active = false where id = pg_temp.fx('va');
select pg_temp.become('bdm');
select throws_ok(format($$select hq.create_opportunity('Inactive Owner', p_source := 'own_marketing', p_next_action := 'Call', p_next_action_due := hq.today() + 1, p_assigned_to := %L)$$, pg_temp.fx('va')), '22023', null, 'the owner must be active staff');
select pg_temp.unbecome();
update hq.staff_profiles set is_active = true where id = pg_temp.fx('va');
select is((select count(*) from hq.opportunities where deleted_at is null), 0::bigint, 'no refused call left a lead behind');
select is((select count(*) from hq.contacts where contact_kind = 'landlord' and deleted_at is null), 0::bigint, '... or a landlord contact');

-- ------------------------------------------------------------ create_opportunity: a direct lead
select pg_temp.become('bdm');
select pg_temp.keep('L1', hq.create_opportunity(
  'Jane Citizen', p_prospect_phone := '0400 000 000', p_property_suburb := 'Wallaroo', p_source := 'own_marketing',
  p_next_action := 'Call to book an appraisal', p_next_action_due := hq.today() + 1, p_estimated_annual_value_cents := 320000));
select pg_temp.unbecome();
select is((select stage::text || '|' || source::text || '|' || assigned_to || '|' || next_action || '|' || next_action_due || '|' || estimated_annual_value_cents from hq.opportunities where id = pg_temp.fx('L1_opportunity_id')),
  'introduction_received|own_marketing|' || pg_temp.fx('bdm') || '|Call to book an appraisal|' || (hq.today() + 1) || '|320000', 'a direct lead: first stage, its source, owned by the caller, with its next action, date and estimate');
select is((select contact_kind::text || '|' || needs_verification || '|' || coalesce(location, '-') || '|' || cardinality(categories) || '|' || relationship_owner_id from hq.contacts where id = pg_temp.fx('L1_owner_contact_id')),
  'landlord|true|Wallaroo|0|' || pg_temp.fx('bdm'), 'the person becomes a landlord contact, flagged to verify, in the suburb, with no partner categories');
select is((select owner_contact_id from hq.opportunities where id = pg_temp.fx('L1_opportunity_id')), pg_temp.fx('L1_owner_contact_id'), 'the lead is linked to the landlord contact');
select is((select array_agg(coalesce(from_stage::text, '-') || '>' || to_stage::text) from hq.opportunity_stage_history where opportunity_id = pg_temp.fx('L1_opportunity_id')), array['->introduction_received'], 'a stage history row is written');
select is((select count(*) from hq.audit_events where action = 'create' and ((entity_type = 'opportunity' and entity_id = pg_temp.fx('L1_opportunity_id')) or (entity_type = 'contact' and entity_id = pg_temp.fx('L1_owner_contact_id')))), 2::bigint, 'the lead and the contact are audited');
select is((select count(*) from hq.referrals where opportunity_id = pg_temp.fx('L1_opportunity_id')), 0::bigint, 'a direct lead has no referral');
select pg_temp.become('bdm');
select pg_temp.keep('L2', hq.create_opportunity(
  'Sam Owner', p_prospect_email := 'sam.owner@lead.test', p_property_suburb := 'Moonta', p_source := 'website_enquiry', p_assigned_to := pg_temp.fx('dir'),
  p_next_action := 'Send the fee schedule', p_next_action_due := hq.today(), p_expected_close_date := hq.today() + 60, p_create_contact := false));
select pg_temp.unbecome();
select is((select assigned_to::text || '|' || coalesce(owner_contact_id::text, 'none') || '|' || expected_close_date from hq.opportunities where id = pg_temp.fx('L2_opportunity_id')),
  pg_temp.fx('dir') || '|none|' || (hq.today() + 60), 'a lead can be given to someone else, without a contact, with an expected close date');

-- ------------------------------------------------------------ the duplicate guard
select pg_temp.become('bdm');
select throws_ok($$select hq.create_opportunity('Someone Else', p_prospect_phone := '+61 400 000 000', p_source := 'direct_approach', p_next_action := 'Call', p_next_action_due := hq.today() + 1)$$, '23505', null, 'the same phone number (written +61) is a possible duplicate');
select is(pg_temp.err($$select hq.create_opportunity('Someone Else', p_prospect_phone := '+61 400 000 000', p_source := 'direct_approach', p_next_action := 'Call', p_next_action_due := hq.today() + 1)$$), 'possible_duplicate', '... with hint possible_duplicate');
select is(pg_temp.err($$select hq.create_opportunity('Someone Else', p_prospect_phone := '0400000000', p_source := 'direct_approach', p_next_action := 'Call', p_next_action_due := hq.today() + 1)$$, 'detail'),
  'opportunity:' || pg_temp.fx('L1_opportunity_id') || ':phone', '... and the detail names the existing lead and why');
select throws_ok($$select hq.create_opportunity('S Owner', p_prospect_email := 'SAM.OWNER@lead.test', p_source := 'own_marketing', p_next_action := 'Call', p_next_action_due := hq.today() + 1)$$, '23505', null, 'the same email (any case) is a possible duplicate');
select throws_ok($$select hq.create_opportunity('JANE  citizen', p_property_suburb := 'wallaroo', p_source := 'other', p_next_action := 'Call', p_next_action_due := hq.today() + 1)$$, '23505', null, 'the same name in the same suburb is a possible duplicate');
select lives_ok($$select hq.create_opportunity('Jane Citizen', p_property_suburb := 'Kadina', p_source := 'other', p_next_action := 'Call', p_next_action_due := hq.today() + 1, p_create_contact := false)$$, 'the same name in another suburb is fine');
select pg_temp.keep('L3', hq.create_opportunity('Jane Citizen', p_property_suburb := 'Wallaroo', p_source := 'other', p_next_action := 'Call', p_next_action_due := hq.today() + 1, p_create_contact := false, p_confirm_distinct := true));
select ok(pg_temp.fx('L3_opportunity_id') is not null, 'confirm_distinct records a genuinely different person');
select pg_temp.unbecome();
-- a landlord contact with no lead is also checked; confirming links the contact that already has the email
insert into hq.contacts (full_name, email, contact_kind) values ('Lonely Landlord', 'lonely@lead.test', 'landlord');
select pg_temp.become('bdm');
select is(pg_temp.err($$select hq.create_opportunity('Lonely Landlord', p_prospect_email := 'lonely@lead.test', p_source := 'own_marketing', p_next_action := 'Call', p_next_action_due := hq.today() + 1)$$, 'detail'),
  'contact:' || (select id from hq.contacts where email = 'lonely@lead.test') || ':email', 'a landlord contact with the same email is a possible duplicate');
select pg_temp.keep('L4', hq.create_opportunity('Lonely Landlord', p_prospect_email := 'lonely@lead.test', p_source := 'own_marketing', p_next_action := 'Call', p_next_action_due := hq.today() + 1, p_confirm_distinct := true));
select pg_temp.unbecome();
select is((select owner_contact_id from hq.opportunities where id = pg_temp.fx('L4_opportunity_id')), (select id from hq.contacts where email = 'lonely@lead.test'), 'the contact already using the email is linked, not duplicated');
select is((select count(*) from hq.contacts where email = 'lonely@lead.test'), 1::bigint, '... so there is still one contact with that email');
select pg_temp.become('bdm');
select lives_ok($$select hq.create_opportunity('Alice Anders', p_prospect_email := 'someone.new@lead.test', p_property_suburb := 'Kadina', p_source := 'own_marketing', p_next_action := 'Call', p_next_action_due := hq.today() + 1, p_create_contact := false)$$,
  'a lead may share a name with a PARTNER contact (only leads and landlord contacts are compared)');
select pg_temp.unbecome();

-- ------------------------------------------------------------ the open-lead rule, for every writer
select pg_temp.become('bdm');
select throws_ok(format($$update hq.opportunities set assigned_to = null where id = %L$$, pg_temp.fx('L1_opportunity_id')), '23514', null, 'an open lead cannot lose its owner by a direct update');
select pg_temp.unbecome();
select throws_ok($$insert into hq.opportunities (prospect_name) values ('System Lead')$$, '23514', null, 'a system insert with nobody to own it is refused');
select lives_ok(format($$insert into hq.opportunities (prospect_name, assigned_to) values ('System Owned', %L)$$, pg_temp.fx('dir')), 'a system insert naming an owner gets the default next step');
select is((select next_action || '|' || next_action_due from hq.opportunities where prospect_name = 'System Owned'), 'Make first contact|' || (hq.today() + 1), '... "Make first contact", tomorrow');
select throws_ok(format($$update hq.opportunities set next_action = '  ' where id = %L$$, pg_temp.fx('L1_opportunity_id')), '23514', null, 'a blank next action on an open lead is refused (any writer)');
select throws_ok(format($$update hq.opportunities set next_action_due = null where id = %L$$, pg_temp.fx('L1_opportunity_id')), '23514', null, 'an open lead cannot lose its follow-up date');

-- record_referral keeps working and meets the rule
select pg_temp.become('bdm');
select pg_temp.keep('R1', hq.record_referral(p_direction := 'received', p_referring_organisation := pg_temp.fx('alpha'), p_referring_contact := pg_temp.fx('alice'),
  p_prospect_name := 'Pat Referred', p_property_suburb := 'Moonta Bay', p_estimated_value_cents := 250000));
select pg_temp.keep('R2', hq.record_referral(p_direction := 'received', p_referring_organisation := pg_temp.fx('beta'), p_prospect_name := 'Quinn Referred', p_assigned_to := pg_temp.fx('dir')));
select pg_temp.unbecome();
select is((select source::text || '|' || assigned_to || '|' || next_action || '|' || next_action_due from hq.opportunities where id = pg_temp.fx('R1_opportunity_id')),
  'referral_partner|' || pg_temp.fx('bdm') || '|Make first contact|' || (hq.today() + 1), 'record_referral: source referral_partner, owned by the caller, "Make first contact" tomorrow');
select is((select assigned_to from hq.opportunities where id = pg_temp.fx('R2_opportunity_id')), pg_temp.fx('dir'), 'record_referral: an assignee named on the referral owns the lead');
select is((select referral_id from (select r.id as referral_id from hq.referrals r where r.opportunity_id = pg_temp.fx('R1_opportunity_id') and r.is_attributed) x), pg_temp.fx('R1_referral_id'), 'the referral is still the credited source');

-- ------------------------------------------------------------ update_opportunity
select pg_temp.become('bdm');
select is((hq.update_opportunity(pg_temp.fx('L1_opportunity_id'), p_next_action := 'Book the appraisal', p_next_action_due := hq.today() + 3, p_expected_close_date := hq.today() + 30) -> 'changed_fields'),
  '["next_action", "next_action_due", "expected_close_date"]'::jsonb, 'update_opportunity changes the next action, date and expected close, and says which');
select is(hq.update_opportunity(pg_temp.fx('L1_opportunity_id'), p_next_action := 'Book the appraisal') ->> 'changed', 'false', 'the same value again changes nothing');
select pg_temp.unbecome();
select is((select count(*) from hq.audit_events where entity_type = 'opportunity' and entity_id = pg_temp.fx('L1_opportunity_id') and action = 'update'), 1::bigint, 'one audited update (the no-op wrote nothing)');
select pg_temp.become('bdm');
select throws_ok(format($$select hq.update_opportunity(%L, p_next_action := '   ')$$, pg_temp.fx('L1_opportunity_id')), '22023', 'a lead needs a next action', 'a blank next action is refused');
select throws_ok(format($$select hq.update_opportunity(%L, p_next_action_due := hq.today() - 2)$$, pg_temp.fx('L1_opportunity_id')), '22023', null, 'a follow-up date in the past is refused');
select throws_ok(format($$select hq.update_opportunity(%L, p_clear := array['assigned_to'])$$, pg_temp.fx('L1_opportunity_id')), '22023', null, 'the owner cannot be cleared');
select is(hq.update_opportunity(pg_temp.fx('L1_opportunity_id'), p_clear := array['expected_close_date']) ->> 'changed', 'true', 'an optional field can be cleared');
select is((select expected_close_date from hq.opportunities where id = pg_temp.fx('L1_opportunity_id')), null, '... and is cleared');
select is(pg_temp.err(format($$select hq.update_opportunity(%L, p_source := 'referral_partner')$$, pg_temp.fx('L1_opportunity_id'))), 'use_record_referral', 'a direct lead cannot be given source referral_partner');
select is(pg_temp.err(format($$select hq.update_opportunity(%L, p_source := 'own_marketing')$$, pg_temp.fx('R1_opportunity_id'))), 'source_is_referral', 'a referred lead keeps source referral_partner');
select is(hq.update_opportunity(pg_temp.fx('L1_opportunity_id'), p_source := 'direct_approach') ->> 'source', 'direct_approach', 'a direct lead''s source can be corrected');
select is(hq.update_opportunity(pg_temp.fx('L1_opportunity_id'), p_assigned_to := pg_temp.fx('dir')) ->> 'assigned_to', pg_temp.fx('dir')::text, 'the owner can be changed to another active member of staff');
select throws_ok(format($$select hq.update_opportunity(%L, p_assigned_to := %L)$$, pg_temp.fx('L1_opportunity_id'), pg_temp.fx('outsider')), '22023', null, 'the owner must be active staff');
select throws_ok(format($$select hq.update_opportunity(%L, p_prospect_name := 'x', p_expected_updated_at := '2000-01-01')$$, pg_temp.fx('L1_opportunity_id')), '23514', null, 'a stale edit is refused');
select throws_ok($$select hq.update_opportunity(gen_random_uuid(), p_prospect_name := 'x')$$, 'P0002', null, 'an unknown lead is reported');
select pg_temp.become('ro');
select throws_ok(format($$select hq.update_opportunity(%L, p_next_action := 'forged')$$, pg_temp.fx('L1_opportunity_id')), '42501', null, 'read_only cannot edit a lead');
select pg_temp.become('jpm');
select throws_ok(format($$select hq.update_opportunity(%L, p_next_action := 'forged')$$, pg_temp.fx('L1_opportunity_id')), '42501', null, 'a junior cannot edit a lead');
select pg_temp.unbecome();
select is((select next_action from hq.opportunities where id = pg_temp.fx('L1_opportunity_id')), 'Book the appraisal', 'the forged edits changed nothing');

-- ------------------------------------------------------------ log_opportunity_activity
select pg_temp.become('bdm');
select pg_temp.keep('A1', hq.log_opportunity_activity(pg_temp.fx('L1_opportunity_id'), 'phone_call', now() - interval '1 hour', 'Jane wants an appraisal next week',
  p_next_action := 'Do the appraisal', p_next_action_due := hq.today() + 7, p_create_task := true));
select pg_temp.unbecome();
select is((select opportunity_id::text || '|' || contact_id || '|' || interaction_type::text || '|' || staff_id from hq.interactions where id = pg_temp.fx('A1_interaction_id')),
  pg_temp.fx('L1_opportunity_id') || '|' || pg_temp.fx('L1_owner_contact_id') || '|phone_call|' || pg_temp.fx('bdm'), 'the call is logged on the lead and its landlord contact, by the caller');
select is((select next_action || '|' || next_action_due || '|' || (last_activity_at = now() - interval '1 hour') from hq.opportunities where id = pg_temp.fx('L1_opportunity_id')),
  'Do the appraisal|' || (hq.today() + 7) || '|true', 'the lead takes the new next action, date and last activity');
select is((select last_contact_at from hq.contacts where id = pg_temp.fx('L1_owner_contact_id')), now() - interval '1 hour', 'the landlord contact''s last contact moves too');
select is((select title || '|' || related_opportunity_id || '|' || related_contact_id || '|' || assigned_to || '|' || due_date || '|' || source from hq.tasks where id = pg_temp.fx('A1_task_id')),
  'Do the appraisal|' || pg_temp.fx('L1_opportunity_id') || '|' || pg_temp.fx('L1_owner_contact_id') || '|' || pg_temp.fx('bdm') || '|' || (hq.today() + 7) || '|interaction', 'the follow-up task is linked to the lead');
select is((select task_id from hq.interactions where id = pg_temp.fx('A1_interaction_id')), pg_temp.fx('A1_task_id'), 'the interaction is linked to its task');
select pg_temp.become('bdm');
select pg_temp.keep('A2', hq.log_opportunity_activity(pg_temp.fx('L2_opportunity_id'), 'note', null, 'Sent the fee schedule by email'));
select pg_temp.unbecome();
select is((select o.next_action || '|' || coalesce(i.contact_id::text, 'none') from hq.opportunities o join hq.interactions i on i.opportunity_id = o.id where i.id = pg_temp.fx('A2_interaction_id')),
  'Send the fee schedule|none', 'no next action given: the lead keeps its own; a lead without a contact logs on the lead alone');
select pg_temp.become('bdm');
select throws_ok(format($$select hq.log_opportunity_activity(%L, 'note', now() + interval '1 day', 'x')$$, pg_temp.fx('L1_opportunity_id')), '22023', null, 'activity cannot be in the future');
select throws_ok(format($$select hq.log_opportunity_activity(%L, 'note', null, '  ')$$, pg_temp.fx('L1_opportunity_id')), '22023', 'a summary is required', 'activity needs a summary');
select throws_ok(format($$select hq.log_opportunity_activity(%L, null, null, 'x')$$, pg_temp.fx('L1_opportunity_id')), '22023', null, 'activity needs a type');
select throws_ok($$select hq.log_opportunity_activity(gen_random_uuid(), 'note', null, 'x')$$, 'P0002', null, 'an unknown lead is reported');
select pg_temp.become('ro');
select throws_ok(format($$select hq.log_opportunity_activity(%L, 'note', null, 'forged')$$, pg_temp.fx('L1_opportunity_id')), '42501', null, 'read_only cannot log activity');
select pg_temp.become('jpm');
select throws_ok(format($$select hq.log_opportunity_activity(%L, 'note', null, 'forged', null, null, true)$$, pg_temp.fx('L1_opportunity_id')), '42501', null, 'a junior cannot log activity');
select pg_temp.unbecome();
select is((select count(*) from hq.interactions where summary = 'forged'), 0::bigint, 'no forged activity was kept');
-- RLS: activity on a lead is growth data
select pg_temp.become('pm');
select is((select count(*) from hq.interactions where opportunity_id = pg_temp.fx('L1_opportunity_id')), 1::bigint, 'a property manager (growth.read) sees activity on a lead');
select pg_temp.become('jpm');
select is((select count(*) from hq.interactions where opportunity_id is not null), 0::bigint, 'a junior sees no lead activity');
select is((select count(*) from hq.opportunity_overview), 0::bigint, 'a junior sees no leads');
select is((select count(*) from hq.overdue_opportunities), 0::bigint, '... and no overdue leads');
select pg_temp.become('ro');
select ok((select count(*) from hq.opportunity_overview) >= 5, 'read_only reads the leads');
select pg_temp.unbecome();

-- ------------------------------------------------------------ move_opportunity: lost codes, open stages, signing once
select pg_temp.become('bdm');
select throws_ok(format($$select hq.move_opportunity(%L, 'lost', null, null, null, 'Chose another agency')$$, pg_temp.fx('L2_opportunity_id')), '22023', 'a lost opportunity needs a reason code', 'lost needs a reason code');
select throws_ok(format($$select hq.move_opportunity(%L, 'lost', null, null, null, null, 'price')$$, pg_temp.fx('L2_opportunity_id')), '22023', 'a lost opportunity needs a reason', 'lost still needs the reason in words');
select is(hq.move_opportunity(pg_temp.fx('L2_opportunity_id'), 'lost', null, null, null, 'Chose another agency', 'chose_another_manager') ->> 'stage', 'lost', 'lost with a reason and its code');
select pg_temp.unbecome();
select is((select lost_reason_code::text || '|' || lost_reason from hq.opportunities where id = pg_temp.fx('L2_opportunity_id')), 'chose_another_manager|Chose another agency', 'both are stored');
select throws_ok(format($$update hq.opportunities set lost_reason_code = 'price' where id = %L$$, pg_temp.fx('L1_opportunity_id')), '23514', null, 'a code only on a lost lead (any writer)');
select pg_temp.become('bdm');
select is(hq.move_opportunity(pg_temp.fx('L2_opportunity_id'), 'contacted', 'Back in touch') ->> 'changed', 'true', 'a lost lead can be reopened');
select pg_temp.unbecome();
select is((select coalesce(lost_reason_code::text, 'none') || '|' || coalesce(lost_reason, 'none') || '|' || next_action from hq.opportunities where id = pg_temp.fx('L2_opportunity_id')),
  'none|none|Send the fee schedule', 'reopening clears the reason and code and keeps the next action');
select pg_temp.become('bdm');
select is(hq.move_opportunity(pg_temp.fx('L1_opportunity_id'), 'qualified') ->> 'changed', 'true', 'moving to a new open stage needs no new next action');
select is((select next_action from hq.opportunities where id = pg_temp.fx('L1_opportunity_id')), 'Do the appraisal', '... and keeps it');
select pg_temp.unbecome();
-- a lead from before the rule (no owner, no next step) is listed, then made whole by a move
alter table hq.opportunities disable trigger lead_guard;
insert into hq.opportunities (prospect_name, property_suburb, source) values ('Legacy Lead', 'Kadina', 'other');
alter table hq.opportunities enable trigger lead_guard;
select is((select reason || '|' || missing_owner || '|' || missing_next_action from hq.overdue_opportunities where prospect_name = 'Legacy Lead'), 'no_owner|true|true', 'a lead with no owner or next step is listed as needing attention');
select pg_temp.become('bdm');
select lives_ok($$select hq.move_opportunity((select id from hq.opportunities where prospect_name = 'Legacy Lead'), 'contacted')$$, 'moving it to an open stage works ...');
select pg_temp.unbecome();
select is((select assigned_to || '|' || next_action || '|' || next_action_due from hq.opportunities where prospect_name = 'Legacy Lead'), pg_temp.fx('bdm') || '|Follow up|' || (hq.today() + 1), '... and gives it an owner and a next step');
select is((select count(*) from hq.overdue_opportunities where prospect_name = 'Legacy Lead'), 0::bigint, '... so it no longer needs attention');
-- signing a referred lead: once, credited once
select pg_temp.become('bdm');
select is(hq.move_opportunity(pg_temp.fx('R1_opportunity_id'), 'management_signed', 'Signed', now(), 'PM-L1') ->> 'changed', 'true', 'a referred lead signs');
select is(hq.move_opportunity(pg_temp.fx('R1_opportunity_id'), 'management_signed') ->> 'changed', 'false', 'signing twice changes nothing');
select throws_ok(format($$select hq.move_opportunity(%L, 'contacted')$$, pg_temp.fx('R1_opportunity_id')), '42501', null, 'a BDM cannot move it out of signed');
select pg_temp.unbecome();
select is((select count(*) from hq.opportunity_stage_history where opportunity_id = pg_temp.fx('R1_opportunity_id') and to_stage = 'management_signed'), 1::bigint, 'one signed history row');
select is((select signed from hq.partner_performance where organisation_id = pg_temp.fx('alpha')), 1::bigint, 'the partner is credited with one signed management');

-- ------------------------------------------------------------ the overdue view on its boundary days
update hq.opportunities set next_action_due = hq.today() where id = pg_temp.fx('L1_opportunity_id');
update hq.opportunities set next_action_due = hq.today() - 1 where id = pg_temp.fx('L3_opportunity_id');
select is((select count(*) from hq.overdue_opportunities where opportunity_id = pg_temp.fx('L1_opportunity_id')), 0::bigint, 'due today is not overdue');
select is((select reason || '|' || days_overdue || '|' || overdue from hq.overdue_opportunities where opportunity_id = pg_temp.fx('L3_opportunity_id')), 'overdue|1|true', 'due yesterday is 1 day overdue');
select is((select next_action_overdue::text || '|' || needs_attention from hq.opportunity_overview where id = pg_temp.fx('L3_opportunity_id')), 'true|true', 'opportunity_overview flags it too');
select is((select next_action_overdue::text || '|' || needs_attention from hq.opportunity_overview where id = pg_temp.fx('L1_opportunity_id')), 'false|false', '... and not the lead due today');
update hq.opportunities set next_action_due = hq.today() - 30 where id = pg_temp.fx('R1_opportunity_id');
select is((select count(*) from hq.overdue_opportunities where opportunity_id = pg_temp.fx('R1_opportunity_id')), 0::bigint, 'a signed lead is never overdue');
update hq.staff_profiles set is_active = false where id = pg_temp.fx('dir2');
update hq.opportunities set assigned_to = pg_temp.fx('dir2') where id = pg_temp.fx('R2_opportunity_id');
select is((select reason from hq.overdue_opportunities where opportunity_id = pg_temp.fx('R2_opportunity_id')), 'owner_inactive', 'a lead whose owner has left needs attention');
update hq.staff_profiles set is_active = true where id = pg_temp.fx('dir2');
select pg_temp.become('dir');
select lives_ok(format($$select hq.archive_record('opportunity', %L)$$, pg_temp.fx('L3_opportunity_id')), 'archive the overdue lead');
select pg_temp.unbecome();
select is((select count(*) from hq.overdue_opportunities where opportunity_id = pg_temp.fx('L3_opportunity_id')), 0::bigint, 'an archived lead is not listed');
select is((select ref from hq.opportunity_overview where id = pg_temp.fx('L1_opportunity_id')), 'LEAD-' || lpad((select display_number::text from hq.opportunities where id = pg_temp.fx('L1_opportunity_id')), 4, '0'), 'opportunity_overview has a LEAD-0001 style reference');
select is((select coalesce(partner_organisation_name, 'none') || '|' || coalesce(credited_ref_label, 'none') || '|' || assigned_to_name || '|' || owner_contact_name from hq.opportunity_overview where id = pg_temp.fx('L1_opportunity_id')),
  'none|none|Dana Director|Jane Citizen', 'a direct lead: no credited partner, its owner and landlord by name');
select is((select partner_organisation_name || '|' || partner_contact_name || '|' || credited_ref_label from hq.opportunity_overview where id = pg_temp.fx('R1_opportunity_id')),
  'Alpha Realty|Alice Anders|REF-' || lpad((select ref_number::text from hq.referrals where id = pg_temp.fx('R1_referral_id')), 4, '0'), 'a referred lead shows the credited partner');

-- ------------------------------------------------------------ landlords never appear in partner views or counts
insert into hq.contacts (full_name, contact_kind, organisation_id, org_contact_role) values ('Landlord At Beta', 'landlord', pg_temp.fx('beta'), 'other');
select is((select count(*) from hq.contacts where contact_kind = 'landlord' and deleted_at is null), 3::bigint, 'three landlord contacts exist now (two linked to leads, one at an organisation)');
select is((select count(*) from hq.referral_partner_overview), (select partners from before_partners), 'the number of partners is unchanged');
select is((select count(*) from hq.referral_partner_overview where partner_kind = 'independent'), (select independents from before_partners), 'no landlord became an independent partner');
select is((select coalesce(sum(contact_count), 0) from hq.referral_partner_overview), (select contact_count from before_partners), 'partner contact counts are unchanged (a landlord at an organisation is not counted)');
select is((select string_agg(id::text || ':' || coalesce(primary_contact_id::text, '-') || ':' || coalesce(relationship_status::text, '-'), ',' order by id) from hq.referral_partner_overview), (select shape from before_partners), 'every partner row reads the same');
select is((select count(*) from hq.referral_partner_overview where contact_id in (select id from hq.contacts where contact_kind = 'landlord') or primary_contact_id in (select id from hq.contacts where contact_kind = 'landlord')), 0::bigint, 'a landlord is never a partner or a partner''s primary contact');
select pg_temp.become('dir');
select is((hq.growth_summary() -> 'contacts_by_status'), (select by_status from before_summary), 'growth_summary contacts by status are unchanged');
select is((hq.growth_summary() ->> 'contacts_not_contacted_30d'), (select stale from before_summary), 'growth_summary "not contacted in 30 days" is unchanged');
select is((select contact_kind::text from hq.contact_directory where id = pg_temp.fx('L1_owner_contact_id')), 'landlord', 'the contact directory lists the landlord with its kind');
select is((select count(*) from hq.contact_directory where contact_kind = 'partner' and id in (select id from hq.contacts where contact_kind = 'landlord')), 0::bigint, 'filtering the directory on partner leaves every landlord out');
select pg_temp.unbecome();

select * from finish();
rollback;
