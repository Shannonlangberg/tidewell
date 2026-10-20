-- Planted HQ: the portfolio (migrations 0129, 0130, 0131): managed properties, the Ailo handover
-- checklist, the business goal and business_summary.
-- Structure and security, the capability matrix, forged callers (anon, non-staff, aal1, read_only,
-- junior, a property manager without write, a BDM, a virtual assistant), conversion only from a SIGNED
-- live opportunity, one property per opportunity, defaults typed once (address, suburb, owner, date),
-- no duplicate address or Ailo reference, status and Ailo rules, optimistic concurrency, the handover
-- steps (created by trigger, completion stamps, not applicable needs a note, never change the status),
-- the opportunity guard, the goal settings, business_summary figures on fixtures (actual / signed /
-- estimate kept apart, short-term accommodation separate), RLS, archive / restore and the audit rows.
--
-- NOTE: never CALL a function a hint role lacks execute on (see hq_01). Every RPC here is granted to
-- authenticated; anon is refused at the schema.
begin;
\ir hq_fixture.inc
select pg_temp.seed_hq();
select plan(175);

-- anything already in this database is put out of the way for the transaction
update hq.managed_properties set deleted_at = now() where deleted_at is null;
update hq.settings set value = '20'::jsonb where key = 'goal_managed_properties';
update hq.settings set value = 'null'::jsonb where key = 'goal_date';

create temp table zz_r (k text primary key, v jsonb) on commit drop;
grant select, insert on zz_r to public;
create function pg_temp.r(p_k text) returns jsonb language sql stable as $$ select v from zz_r where k = p_k $$;
create function pg_temp.mid(p_k text) returns uuid language sql stable as $$ select (v ->> 'managed_property_id')::uuid from zz_r where k = p_k $$;
create function pg_temp.audits(p_entity text, p_id uuid, p_action text) returns bigint language sql stable as $$
  select count(*) from hq.audit_events where entity_type = p_entity and entity_id = p_id and action = p_action $$;

-- opportunities: four signed (one with a landlord contact), one signed but archived, two open
create function pg_temp.opp(p_key text, p_name text, p_stage hq.opportunity_stage, p_address text, p_suburb text, p_value bigint default null, p_owner uuid default null, p_deleted boolean default false)
returns void language plpgsql as $$
declare v uuid;
begin
  insert into hq.opportunities (prospect_name, property_address, property_suburb, stage, signed_at, estimated_annual_value_cents,
                                assigned_to, next_action, next_action_due, owner_contact_id, deleted_at)
  values (p_name, p_address, p_suburb, p_stage, case when p_stage = 'management_signed' then now() end, p_value,
          pg_temp.fx('bdm'), case when p_stage not in ('management_signed', 'lost') then 'Call back' end,
          case when p_stage not in ('management_signed', 'lost') then hq.today() + 3 end, p_owner, case when p_deleted then now() end)
  returning id into v;
  insert into fx values (p_key, v);
end $$;
select pg_temp.opp('o1', '[test] Pat Landlord', 'management_signed', '1 Test Street', 'Moonta', 300000);
select pg_temp.opp('o2', '[test] Lee Landlord', 'management_signed', '2 Test Street', 'Wallaroo', null, pg_temp.fx('alice'));
select pg_temp.opp('o3', '[test] Sky Stays', 'management_signed', '3 Beach Road', 'Moonta Bay');
select pg_temp.opp('o4', '[test] Quinn Owner', 'management_signed', null, 'Kadina');
select pg_temp.opp('o_arch', '[test] Gone', 'management_signed', '9 Old Road', 'Moonta', null, null, true);
select pg_temp.opp('o_open', '[test] Open Lead', 'qualified', '5 Open Way', 'Kadina', 120000);
select pg_temp.opp('o_open2', '[test] Open Lead Two', 'proposal_sent', '6 Open Way', 'Kadina');

-- ------------------------------------------------------------ structure and security
select has_table('hq', 'managed_properties', 'hq.managed_properties exists');
select has_table('hq', 'property_handover_steps', 'hq.property_handover_steps exists');
select columns_are('hq', 'managed_properties', array['id', 'ref_number', 'opportunity_id', 'manual_origin_note', 'owner_contact_id', 'owner_name', 'property_address', 'address_key', 'suburb',
  'service_type', 'fee_basis', 'fee_percent', 'fee_notes', 'agreement_signed_on', 'managed_from', 'status', 'ended_on', 'ailo_reference', 'ailo_status', 'notes',
  'created_at', 'updated_at', 'created_by', 'updated_by', 'deleted_at', 'deleted_by']);
select columns_are('hq', 'property_handover_steps', array['property_id', 'step', 'status', 'note', 'completed_by', 'completed_at', 'updated_at']);
select enum_has_labels('hq', 'service_type', array['long_term_residential', 'short_term_accommodation']);
select enum_has_labels('hq', 'fee_basis', array['percent_of_rent', 'flat_fee', 'other']);
select enum_has_labels('hq', 'managed_status', array['onboarding', 'active', 'offboarding', 'ended']);
select enum_has_labels('hq', 'ailo_status', array['not_started', 'set_up', 'live']);
select enum_has_labels('hq', 'handover_step', array['owner_onboarded', 'management_agreement_signed', 'owner_id_verified', 'bank_and_payment_details_in_ailo',
  'property_created_in_ailo', 'owner_invited_to_ailo', 'condition_report_or_inspection_scheduled', 'keys_and_access_arranged', 'welcome_pack_sent']);
select enum_has_labels('hq', 'handover_step_status', array['not_started', 'in_progress', 'done', 'not_applicable']);
select is((select count(*) from pg_class where oid in ('hq.managed_properties'::regclass, 'hq.property_handover_steps'::regclass) and relrowsecurity and relforcerowsecurity), 2::bigint, 'RLS is enabled and forced on both portfolio tables');
select policies_are('hq', 'managed_properties', array['managed_properties_select'], 'managed_properties: one select policy, nothing else');
select policies_are('hq', 'property_handover_steps', array['property_handover_steps_select'], 'property_handover_steps: one select policy');
select table_privs_are('hq', 'managed_properties', 'authenticated', array['SELECT'], 'managed_properties: authenticated can only select (written by RPC)');
select table_privs_are('hq', 'property_handover_steps', 'authenticated', array['SELECT'], 'property_handover_steps: authenticated can only select');
select is((select count(*) from unnest(array['managed_properties', 'property_handover_steps']) t where has_table_privilege('service_role', 'hq.' || t, 'insert,update,delete,truncate')), 0::bigint, 'service_role cannot write the portfolio tables');
select ok(not has_table_privilege('anon', 'hq.managed_properties', 'select') and not has_table_privilege('anon', 'hq.portfolio_overview', 'select'), 'anon holds nothing on managed_properties or the overview');
select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid = 'hq.portfolio_overview'::regclass), 'portfolio_overview is security_invoker');
select ok(has_table_privilege('authenticated', 'hq.portfolio_overview', 'select'), 'authenticated can select the overview');

create temp table zz_rpcs (sig regprocedure primary key) on commit drop;
insert into zz_rpcs values
  ('hq.convert_to_managed_property(uuid, hq.service_type, text, text, uuid, text, hq.fee_basis, numeric, text, date, date, hq.managed_status, text, text)'),
  ('hq.add_existing_managed_property(text, text, hq.service_type, text, uuid, text, hq.fee_basis, numeric, text, date, date, hq.managed_status, text, hq.ailo_status, text)'),
  ('hq.update_managed_property(uuid, text, text, uuid, text, hq.service_type, hq.fee_basis, numeric, text, date, date, hq.managed_status, date, text, hq.ailo_status, text, text[], text, timestamptz)'),
  ('hq.set_handover_step(uuid, hq.handover_step, hq.handover_step_status, text)'), ('hq.set_business_goal(integer, date)'), ('hq.business_summary()');
select is((select count(*) from zz_rpcs where has_function_privilege('authenticated', sig, 'execute')), 6::bigint, 'authenticated can execute the six portfolio RPCs');
select is((select count(*) from zz_rpcs where has_function_privilege('anon', sig, 'execute') or has_function_privilege('service_role', sig, 'execute')), 0::bigint, 'anon and service_role can execute none of them');
select is((select count(*) from zz_rpcs z join pg_proc p on p.oid = z.sig where p.prosecdef and p.proconfig::text like '%search_path=pg_catalog, public, extensions%'), 6::bigint, 'all six are security definer with a pinned search_path');
select is((select count(*) from pg_proc p where p.pronamespace = 'hq_private'::regnamespace
            and p.proname in ('managed_property_guard', 'managed_property_after_insert', 'handover_step_guard', 'opportunity_portfolio_guard', 'mp_ref', 'mp_json', 'mp_status_label', 'mp_check', 'mp_new', 'mp_insert')
            and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))), 0::bigint, 'the portfolio helpers are executable by no API role');

-- ------------------------------------------------------------ the capability matrix and the goal settings
select is((select array_agg(role::text order by role::text) from hq.role_capabilities where capability = 'portfolio.read'),
  array['administrator', 'business_development_manager', 'director', 'property_manager', 'read_only', 'senior_property_manager'], 'portfolio.read: director, administrator, senior PM, PM, BDM, read_only');
select is((select array_agg(role::text order by role::text) from hq.role_capabilities where capability = 'portfolio.write'),
  array['administrator', 'director', 'senior_property_manager'], 'portfolio.write: director, administrator, senior PM');
select is((select value from hq.settings where key = 'goal_managed_properties'), '20'::jsonb, 'the goal defaults to 20 managed properties');
select is((select value from hq.settings where key = 'goal_date'), 'null'::jsonb, 'the goal date is null until the owner sets it (never invented)');

-- ------------------------------------------------------------ forged callers
select pg_temp.become_anon();
select throws_ok('select 1 from hq.managed_properties', '42501', null, 'anon is denied on managed_properties');
select throws_ok('select 1 from hq.portfolio_overview', '42501', null, 'anon is denied on portfolio_overview');
select throws_ok('select hq.business_summary()', '42501', null, 'anon cannot call business_summary');
select pg_temp.unbecome();
select pg_temp.become('outsider');
select throws_ok(format($$select hq.convert_to_managed_property(%L, 'long_term_residential')$$, pg_temp.fx('o1')), '42501', null, 'a non-staff login cannot convert');
select throws_ok('select hq.business_summary()', '42501', null, 'a non-staff login cannot read business_summary');
select is((select count(*) from hq.managed_properties), 0::bigint, 'a non-staff login sees no managed properties');
select pg_temp.unbecome();
select pg_temp.become('dir', 'aal1');
select throws_ok(format($$select hq.convert_to_managed_property(%L, 'long_term_residential')$$, pg_temp.fx('o1')), '42501', null, 'a director at aal1 (MFA required) cannot convert');
select pg_temp.unbecome();
select pg_temp.become('ro');
select throws_ok(format($$select hq.convert_to_managed_property(%L, 'long_term_residential')$$, pg_temp.fx('o1')), '42501', null, 'read_only cannot convert');
select throws_ok(format($$select hq.add_existing_managed_property('forged', '1 Forged St', 'long_term_residential', null, null, 'X')$$), '42501', null, 'read_only cannot add a property');
select throws_ok('select hq.set_business_goal(30, null)', '42501', null, 'read_only cannot set the goal');
select pg_temp.unbecome();
select pg_temp.become('jpm');
select throws_ok(format($$select hq.convert_to_managed_property(%L, 'long_term_residential')$$, pg_temp.fx('o1')), '42501', null, 'a junior cannot convert');
select throws_ok('select hq.business_summary()', '42501', null, 'a junior (neither growth.read nor portfolio.read) cannot read business_summary');
select pg_temp.unbecome();
select pg_temp.become('pm');
select throws_ok(format($$select hq.convert_to_managed_property(%L, 'long_term_residential')$$, pg_temp.fx('o1')), '42501', null, 'a property manager (portfolio.read, no write) cannot convert');
select pg_temp.unbecome();
select pg_temp.become('adm');
select throws_ok('select hq.set_business_goal(30, null)', '42501', null, 'an administrator cannot set the goal (settings.admin is a director capability)');
select pg_temp.unbecome();
select pg_temp.become('spm');
select throws_ok(format($$insert into hq.managed_properties (opportunity_id, property_address, service_type, owner_name) values (%L, 'x', 'long_term_residential', 'y')$$, pg_temp.fx('o1')), '42501', null, 'no direct insert, even for a writer');
select pg_temp.unbecome();
select is((select count(*) from hq.managed_properties where deleted_at is null), 0::bigint, 'none of the forged calls created a property');

-- ------------------------------------------------------------ conversion
select pg_temp.become('spm');
select throws_ok(format($$select hq.convert_to_managed_property(%L, 'long_term_residential')$$, pg_temp.fx('o_open')), '23514', null, 'an open (unsigned) opportunity cannot be converted');
select throws_ok(format($$select hq.convert_to_managed_property(%L, 'long_term_residential')$$, pg_temp.fx('o_arch')), 'P0002', 'opportunity not found', 'an archived opportunity cannot be converted');
select throws_ok($$select hq.convert_to_managed_property(null, 'long_term_residential')$$, '22023', null, 'an opportunity is required');
select throws_ok(format($$select hq.convert_to_managed_property(%L, null)$$, pg_temp.fx('o1')), '22023', null, 'a service type is required');
select throws_ok(format($$select hq.convert_to_managed_property(%L, 'long_term_residential')$$, pg_temp.fx('o4')), '22023', null, 'an opportunity with no address needs one given');
select throws_ok(format($$select hq.convert_to_managed_property(%L, 'long_term_residential', p_status => 'active')$$, pg_temp.fx('o1')), '22023', 'an active property needs the date management started', 'active needs managed_from');
select throws_ok(format($$select hq.convert_to_managed_property(%L, 'long_term_residential', p_status => 'active', p_managed_from => hq.today() + 1)$$, pg_temp.fx('o1')), '22023', null, 'active cannot start in the future');
select throws_ok(format($$select hq.convert_to_managed_property(%L, 'long_term_residential', p_status => 'ended')$$, pg_temp.fx('o1')), '22023', null, 'a new property cannot start ended');
select throws_ok(format($$select hq.convert_to_managed_property(%L, 'long_term_residential', p_fee_percent => 101)$$, pg_temp.fx('o1')), '22023', 'a fee percentage is from 0 to 100', 'a fee over 100 percent is refused');
select throws_ok(format($$select hq.convert_to_managed_property(%L, 'long_term_residential', p_fee_basis => 'percent_of_rent')$$, pg_temp.fx('o1')), '22023', null, 'a percent-of-rent fee needs the percentage');
select throws_ok(format($$select hq.convert_to_managed_property(%L, 'long_term_residential', p_fee_basis => 'flat_fee', p_fee_percent => 5)$$, pg_temp.fx('o1')), '22023', null, 'a percentage only goes with percent of rent');
select throws_ok(format($$select hq.convert_to_managed_property(%L, 'long_term_residential', p_ailo_reference => repeat('a', 101))$$, pg_temp.fx('o1')), '22023', null, 'an Ailo reference over 100 characters is refused');
insert into zz_r select 'a', hq.convert_to_managed_property(pg_temp.fx('o1'), 'long_term_residential', p_fee_percent => 8.8);
select throws_ok(format($$select hq.convert_to_managed_property(%L, 'long_term_residential')$$, pg_temp.fx('o1')), '23505', null, 'one managed property per opportunity');
insert into zz_r select 'b', hq.convert_to_managed_property(pg_temp.fx('o2'), 'long_term_residential', p_status => 'active', p_managed_from => hq.today() - 10, p_ailo_reference => '[test] AILO-0002');
select throws_ok(format($$select hq.convert_to_managed_property(%L, 'short_term_accommodation', p_property_address => '  1 TEST street ')$$, pg_temp.fx('o3')), '23505', null, 'the same address (any case and spacing) cannot be managed twice');
insert into zz_r select 'c', hq.convert_to_managed_property(pg_temp.fx('o3'), 'short_term_accommodation', p_status => 'active', p_managed_from => hq.today());
insert into zz_r select 'd', hq.convert_to_managed_property(pg_temp.fx('o4'), 'long_term_residential', p_property_address => '4 Test Street');
select pg_temp.unbecome();

select ok(pg_temp.r('a') ->> 'ref' ~ '^MP-[0-9]{4,}$', 'convert: the result carries an MP-0001 style ref');
select is((select property_address || '|' || suburb || '|' || owner_name from hq.managed_properties where id = pg_temp.mid('a')), '1 Test Street|Moonta|[test] Pat Landlord', 'convert: address, suburb and owner name come from the opportunity (typed once)');
select is((select agreement_signed_on from hq.managed_properties where id = pg_temp.mid('a')), hq.today(), 'convert: the agreement date defaults to the signing date');
select is((select status::text || '|' || ailo_status::text || '|' || service_type::text from hq.managed_properties where id = pg_temp.mid('a')), 'onboarding|not_started|long_term_residential', 'convert: starts onboarding, Ailo not started');
select is((select fee_basis::text || '|' || fee_percent from hq.managed_properties where id = pg_temp.mid('a')), 'percent_of_rent|8.80', 'convert: a percentage alone means percent of rent');
select is((select created_by from hq.managed_properties where id = pg_temp.mid('a')), pg_temp.fx('spm'), 'convert: created_by is the caller');
select is((select owner_contact_id from hq.managed_properties where id = pg_temp.mid('b')), pg_temp.fx('alice'), 'convert: the landlord contact comes from the opportunity');
select is((select owner_name from hq.managed_properties where id = pg_temp.mid('b')), null, '... and then no owner name is copied');
select is((select property_address from hq.managed_properties where id = pg_temp.mid('d')), '4 Test Street', 'convert: an address given is used');
select is((select count(*) from hq.property_handover_steps where property_id = pg_temp.mid('a')), 9::bigint, 'the nine handover steps are created with the property');
select is((select count(*) from hq.property_handover_steps where property_id = pg_temp.mid('a') and status = 'not_started' and completed_at is null), 9::bigint, '... all not started');
select is(pg_temp.audits('managed_property', pg_temp.mid('a'), 'create'), 1::bigint, 'convert: one audit row (entity managed_property)');
select ok((select summary from hq.audit_events where entity_type = 'managed_property' and entity_id = pg_temp.mid('a') and action = 'create') like 'Create managed_property: MP-% 1 Test Street [from opportunity %]', 'convert: the audit summary names the ref, address and opportunity');
select throws_ok(format($$insert into hq.managed_properties (opportunity_id, property_address, service_type, owner_name) values (%L, '7 Direct St', 'long_term_residential', 'y')$$, pg_temp.fx('o_open')),
  '23514', null, 'even the table owner cannot make an unsigned opportunity a managed property');
select throws_ok($$insert into hq.managed_properties (property_address, service_type, owner_name) values ('8 Direct St', 'long_term_residential', 'y')$$, '23514', null, 'no opportunity needs a manual origin note (constraint)');

-- ------------------------------------------------------------ the manual path: signed before HQ
select pg_temp.become('spm');
select throws_ok($$select hq.add_existing_managed_property('  ', '10 Early Street', 'long_term_residential', null, null, 'Early Owner')$$, '22023', null, 'a property signed before HQ needs a note');
insert into zz_r select 'e', hq.add_existing_managed_property('[test] Signed in 2025 on paper, before HQ', '10 Early Street', 'long_term_residential', 'Moonta', null, 'Early Owner',
  'flat_fee', null, 'Flat monthly fee', hq.today() - 400, hq.today() - 380, 'active', '[test] AILO-0010', 'live');
select throws_ok($$select hq.add_existing_managed_property('note', '11 Early Street', 'long_term_residential', null, null, 'X', null, null, null, null, null, 'onboarding', null, 'live')$$,
  '22023', 'record the Ailo reference before marking the property live in Ailo', 'Ailo live needs a reference');
select pg_temp.unbecome();
select is((select (opportunity_id is null) and manual_origin_note like '[test] Signed in 2025%' and status = 'active' and ailo_status = 'live' from hq.managed_properties where id = pg_temp.mid('e')), true,
  'manual: no opportunity, the note kept, active and live in Ailo');

-- ------------------------------------------------------------ updates and status rules
select pg_temp.become('spm');
select throws_ok(format($$select hq.update_managed_property(%L, p_status => 'active')$$, pg_temp.mid('a')), '22023', 'an active property needs the date management started', 'update: active needs managed_from');
insert into zz_r select 'u1', hq.update_managed_property(pg_temp.mid('a'), p_status => 'active', p_managed_from => hq.today() - 1, p_note => 'Keys handed over');
insert into zz_r select 'u1b', hq.update_managed_property(pg_temp.mid('a'), p_status => 'active', p_managed_from => hq.today() - 1);
select throws_ok(format($$select hq.update_managed_property(%L, p_status => 'ended')$$, pg_temp.mid('a')), '22023', 'an ended property needs the date management ended', 'ended needs ended_on');
select throws_ok(format($$select hq.update_managed_property(%L, p_ended_on => hq.today())$$, pg_temp.mid('a')), '22023', null, 'an end date only on an ended property');
select throws_ok(format($$select hq.update_managed_property(%L, p_status => 'ended', p_ended_on => hq.today() + 1)$$, pg_temp.mid('a')), '22023', null, 'the end date cannot be in the future');
select throws_ok(format($$select hq.update_managed_property(%L, p_ailo_status => 'live')$$, pg_temp.mid('a')), '22023', null, 'Ailo live needs a reference');
select throws_ok(format($$select hq.update_managed_property(%L, p_ailo_reference => '[test] ailo-0002 ')$$, pg_temp.mid('a')), '23505', null, 'an Ailo reference already on another property is refused (any case)');
insert into zz_r select 'u2', hq.update_managed_property(pg_temp.mid('a'), p_ailo_reference => '[test] AILO-0001', p_ailo_status => 'live');
select throws_ok(format($$select hq.update_managed_property(%L, p_ailo_reference => '')$$, pg_temp.mid('a')), '22023', null, 'the reference cannot be cleared while live in Ailo');
insert into zz_r select 'u3', hq.update_managed_property(pg_temp.mid('a'), p_fee_basis => 'flat_fee', p_fee_notes => '$99 a month');
select throws_ok(format($$select hq.update_managed_property(%L, p_expected_updated_at => now() - interval '1 day', p_notes => 'stale')$$, pg_temp.mid('a')), '23514', null, 'a stale edit is refused (optimistic concurrency)');
select throws_ok(format($$select hq.update_managed_property(%L, p_clear => array['property_address'])$$, pg_temp.mid('a')), '22023', null, 'only the listed fields can be cleared with p_clear');
select throws_ok(format($$select hq.update_managed_property(%L, p_owner_name => '')$$, pg_temp.mid('a')), '22023', null, 'the owner cannot be removed altogether');
select throws_ok(format($$select hq.update_managed_property(%L, p_property_address => '2 test street')$$, pg_temp.mid('a')), '23505', null, 'an edit cannot take an address already managed');
insert into zz_r select 'u4', hq.update_managed_property(pg_temp.mid('d'), p_status => 'ended', p_ended_on => hq.today(), p_note => 'Owner sold');
select throws_ok(format($$select hq.update_managed_property(%L, p_status => 'active', p_managed_from => hq.today())$$, pg_temp.mid('d')), '42501', null, 'a senior PM cannot reopen an ended property');
select pg_temp.unbecome();
select pg_temp.become('pm');
select throws_ok(format($$select hq.update_managed_property(%L, p_notes => 'forged')$$, pg_temp.mid('a')), '42501', null, 'a property manager cannot update');
select pg_temp.unbecome();

select is((pg_temp.r('u1') ->> 'changed')::boolean, true, 'update: changed');
select is((pg_temp.r('u1b') ->> 'changed')::boolean, false, 'update: the same values again change nothing');
select ok((pg_temp.r('u1') -> 'changed_fields') ?& array['status', 'managed_from'], 'update: changed_fields lists status and managed_from');
select is(pg_temp.audits('managed_property', pg_temp.mid('a'), 'status_change'), 1::bigint, 'update: the status move is audited once as status_change');
select ok((select summary from hq.audit_events where entity_type = 'managed_property' and entity_id = pg_temp.mid('a') and action = 'status_change') like '%(onboarding to active) [Keys handed over]', 'update: the audit summary shows the move and the note');
select is((select ailo_status::text || '|' || ailo_reference from hq.managed_properties where id = pg_temp.mid('a')), 'live|[test] AILO-0001', 'update: reference and live together');
select is((select fee_basis::text || '|' || coalesce(fee_percent::text, 'none') || '|' || fee_notes from hq.managed_properties where id = pg_temp.mid('a')), 'flat_fee|none|$99 a month', 'update: a flat fee clears the percentage');
select is((select status::text || '|' || ended_on from hq.managed_properties where id = pg_temp.mid('d')), 'ended|' || hq.today(), 'update: ended with its date');
select pg_temp.become('dir');
insert into zz_r select 'u5', hq.update_managed_property(pg_temp.mid('d'), p_status => 'onboarding');
select pg_temp.unbecome();
select is((select status::text || '|' || coalesce(ended_on::text, 'none') from hq.managed_properties where id = pg_temp.mid('d')), 'onboarding|none', 'a director can reopen an ended property; the end date is cleared');
select pg_temp.become('dir');
insert into zz_r select 'u6', hq.update_managed_property(pg_temp.mid('d'), p_status => 'ended', p_ended_on => hq.today());
select pg_temp.unbecome();

-- ------------------------------------------------------------ the opportunity stays signed and live
select pg_temp.become('dir');
select throws_ok(format($$select hq.move_opportunity(%L, 'qualified')$$, pg_temp.fx('o1')), '23514', null, 'a converted opportunity cannot leave management signed');
select throws_ok(format($$select hq.archive_record('opportunity', %L)$$, pg_temp.fx('o1')), '23514', null, 'a converted opportunity cannot be archived while its property is live');
select pg_temp.unbecome();

-- ------------------------------------------------------------ handover steps
select pg_temp.become('spm');
insert into zz_r select 's1', hq.set_handover_step(pg_temp.mid('a'), 'owner_onboarded', 'done', 'Met at the property');
insert into zz_r select 's1b', hq.set_handover_step(pg_temp.mid('a'), 'owner_onboarded', 'done', 'Met at the property');
select throws_ok(format($$select hq.set_handover_step(%L, 'keys_and_access_arranged', 'not_applicable')$$, pg_temp.mid('a')), '22023', 'a step marked not applicable needs a note saying why', 'not applicable needs a note');
insert into zz_r select 's2', hq.set_handover_step(pg_temp.mid('a'), 'keys_and_access_arranged', 'not_applicable', 'Owner keeps the keys');
insert into zz_r select 's3', hq.set_handover_step(pg_temp.mid('a'), 'welcome_pack_sent', 'done');
insert into zz_r select 's4', hq.set_handover_step(pg_temp.mid('a'), 'welcome_pack_sent', 'in_progress');
select throws_ok(format($$select hq.set_handover_step(%L, 'owner_onboarded', 'done', %L)$$, pg_temp.mid('a'), repeat('n', 1001)), '22023', null, 'a step note is at most 1000 characters');
select throws_ok(format($$select hq.set_handover_step(%L, 'owner_onboarded', 'done')$$, gen_random_uuid()), 'P0002', null, 'an unknown property is not found');
select throws_ok(format($$update hq.property_handover_steps set status = 'done' where property_id = %L$$, pg_temp.mid('a')), '42501', null, 'no direct update of a step');
select pg_temp.unbecome();
select pg_temp.become('bdm');
select throws_ok(format($$select hq.set_handover_step(%L, 'owner_id_verified', 'done')$$, pg_temp.mid('a')), '42501', null, 'a BDM (portfolio.read only) cannot set a step');
select pg_temp.unbecome();
select is((pg_temp.r('s1') ->> 'changed')::boolean || '/' || (pg_temp.r('s1b') ->> 'changed')::boolean, 'true/false', 'set_handover_step: changed, then idempotent');
select is((select completed_by from hq.property_handover_steps where property_id = pg_temp.mid('a') and step = 'owner_onboarded'), pg_temp.fx('spm'), 'done: completed_by is the caller');
select ok((select completed_at is not null from hq.property_handover_steps where property_id = pg_temp.mid('a') and step = 'keys_and_access_arranged'), 'not applicable: completed_at is set');
select is((select completed_at from hq.property_handover_steps where property_id = pg_temp.mid('a') and step = 'welcome_pack_sent'), null, 'back to in progress: completed_at is cleared');
select is((pg_temp.r('s2') ->> 'handover_done_count')::integer, 2, 'the result counts done and not applicable steps');
update hq.property_handover_steps set completed_at = null, completed_by = null where property_id = pg_temp.mid('a') and step = 'owner_onboarded';
select is((select completed_by from hq.property_handover_steps where property_id = pg_temp.mid('a') and step = 'owner_onboarded'), pg_temp.fx('spm'), 'the completion stamp cannot be rewritten by hand (even by the owner)');
select throws_ok(format($$delete from hq.property_handover_steps where property_id = %L$$, pg_temp.mid('a')), '42501', null, 'steps are never deleted');
select is(pg_temp.audits('property_handover_step', pg_temp.mid('a'), 'update'), 4::bigint, 'each step change is audited under its property (4 changes)');
-- every step done never changes the status
select pg_temp.become('spm');
select hq.set_handover_step(pg_temp.mid('c'), s, 'done') from unnest(enum_range(null::hq.handover_step)) s;
select pg_temp.unbecome();
select is((select status::text || '|' || ailo_status::text from hq.managed_properties where id = pg_temp.mid('c')), 'active|not_started', 'completing all nine steps changes neither the status nor the Ailo status');

-- ------------------------------------------------------------ the goal
select pg_temp.become('dir');
select throws_ok('select hq.set_business_goal(0, null)', '22023', null, 'a goal of 0 is refused');
select throws_ok('select hq.set_business_goal(10001, null)', '22023', null, 'a goal over 10000 is refused');
select throws_ok('select hq.set_business_goal(20, hq.today() - 1)', '22023', 'the goal date must be today or later', 'a past goal date is refused');
insert into zz_r select 'g0', hq.set_business_goal(20, null);
select pg_temp.unbecome();
select is((pg_temp.r('g0') ->> 'changed')::boolean, false, 'the same goal again changes nothing');
select throws_ok($$update hq.settings set value = '"soon"'::jsonb where key = 'goal_date'$$, '22023', null, 'the settings guard refuses a goal_date that is not a date (even for the owner)');
select throws_ok($$update hq.settings set value = '"2027-02-30"'::jsonb where key = 'goal_date'$$, '22023', null, '... or an impossible date');
select throws_ok($$update hq.settings set value = '"20"'::jsonb where key = 'goal_managed_properties'$$, '22023', null, 'the settings guard refuses a target that is not a number');
select throws_ok($$update hq.settings set value = '0'::jsonb where key = 'goal_managed_properties'$$, '22023', null, '... or a target of 0');

-- ------------------------------------------------------------ business_summary on the fixtures
-- live: a LT active (o1), b LT active (o2), c STA active (o3), d LT ended (o4), e LT active (manual)
select pg_temp.become('dir');
insert into zz_r select 'bs', hq.business_summary();
select pg_temp.unbecome();
select is(pg_temp.r('bs') #>> '{managed,label}', 'actual', 'managed figures are labelled actual');
select is((pg_temp.r('bs') #>> '{managed,managed}')::integer, 4, 'managed = active + onboarding (4; the ended one is not counted)');
select is((pg_temp.r('bs') #>> '{managed,active}')::integer || '/' || (pg_temp.r('bs') #>> '{managed,onboarding}')::integer || '/' || (pg_temp.r('bs') #>> '{managed,ended}')::integer, '4/0/1', 'by status: 4 active, 0 onboarding, 1 ended');
select is((pg_temp.r('bs') #>> '{managed,long_term_residential,managed}')::integer, 3, 'long-term residential: 3 managed');
select is((pg_temp.r('bs') #>> '{managed,short_term_accommodation,managed}')::integer, 1, 'short-term accommodation is counted separately: 1');
select is((pg_temp.r('bs') #>> '{managed,handover_open}')::integer, 3, 'managed properties with handover steps still open: 3 (c has all nine done)');
select is(pg_temp.r('bs') #>> '{signed,label}', 'signed', 'signings are labelled signed');
select is((pg_temp.r('bs') #>> '{signed,this_month}')::integer, 4, 'signed this month: the four live signed opportunities (the archived one is not counted)');
select is((pg_temp.r('bs') #>> '{signed,financial_year}')::integer, 4, 'signed this financial year: 4');
select is((pg_temp.r('bs') #>> '{pipeline,open}')::integer, 2, 'open pipeline: 2 opportunities (signed ones are not in the pipeline)');
select is((pg_temp.r('bs') #>> '{pipeline,by_stage,qualified}')::integer || '/' || (pg_temp.r('bs') #>> '{pipeline,by_stage,proposal_sent}')::integer, '1/1', 'open pipeline by stage');
select is((pg_temp.r('bs') #>> '{pipeline,estimated_yearly_value_cents}')::bigint, 120000::bigint, 'the estimated value sums open opportunities only (the signed $3000 estimate is not in it)');
select is(pg_temp.r('bs') #>> '{pipeline,estimated_value_label}', 'estimate', 'the pipeline value is labelled estimate');
select is((pg_temp.r('bs') #>> '{pipeline,with_estimate}')::integer || '/' || (pg_temp.r('bs') #>> '{pipeline,without_estimate}')::integer, '1/1', 'how many open opportunities carry an estimate');
select is((pg_temp.r('bs') #>> '{goal,target_managed}')::integer, 20, 'the goal is the setting (20)');
select is(pg_temp.r('bs') #>> '{goal,goal_date}', null, 'no goal date: none invented');
select is(pg_temp.r('bs') -> 'pace', 'null'::jsonb, 'no goal date: no pace');
select ok(pg_temp.r('bs') -> 'leads_needing_attention' is not null and pg_temp.r('bs') -> 'leads_needing_attention' <> 'null'::jsonb, 'leads needing attention is counted (the pipeline flags them)');
select pg_temp.become('dir');
insert into zz_r select 'g1', hq.set_business_goal(24, hq.today() + 365);
insert into zz_r select 'bs2', hq.business_summary();
select pg_temp.unbecome();
select is((pg_temp.r('g1') ->> 'changed')::boolean, true, 'set_business_goal: changed');
select is((select value from hq.settings where key = 'goal_date'), to_jsonb(to_char(hq.today() + 365, 'YYYY-MM-DD')), 'the goal date is stored as a date string');
select is((pg_temp.r('bs2') #>> '{pace,remaining}')::integer, 20, 'pace: 24 - 4 = 20 still to reach the goal');
select is((pg_temp.r('bs2') #>> '{pace,actual_per_month}')::numeric, 1.3, 'pace: actual = 4 signed in the last 3 months / 3');
select ok((pg_temp.r('bs2') #>> '{pace,needed_per_month}')::numeric between 1.6 and 1.7, 'pace: needed = 20 over about 12 months');
select is(pg_temp.r('bs2') #>> '{pace,label}', 'calculation', 'pace is labelled calculation');
select is((select count(*) from hq.audit_events where entity_type = 'setting' and summary like '%goal_date%' and actor_id = pg_temp.fx('dir')), 1::bigint, 'the goal change is audited (settings row)');
select pg_temp.become('va');
insert into zz_r select 'bs_va', hq.business_summary();
select pg_temp.unbecome();
select is(pg_temp.r('bs_va') -> 'managed', 'null'::jsonb, 'a virtual assistant (growth.read, no portfolio.read) gets no managed figures');
select ok(pg_temp.r('bs_va') ->> 'notes' like '%portfolio.read%', '... and a note saying why');
select is((pg_temp.r('bs_va') #>> '{signed,this_month}')::integer, 4, '... but does get the signed figures');
select is(pg_temp.r('bs_va') -> 'pace', 'null'::jsonb, '... and no pace (it needs both)');

-- ------------------------------------------------------------ RLS
select pg_temp.become('ro');
select is((select count(*) from hq.managed_properties), 5::bigint, 'read_only sees the five live properties');
select is((select count(*) from hq.property_handover_steps where property_id = pg_temp.mid('a')), 9::bigint, 'read_only sees the steps');
select is((select handover_done || ' of ' || handover_total from hq.portfolio_overview where id = pg_temp.mid('a')), '2 of 9', 'overview: handover progress 2 of 9');
select is((select handover_open_steps[1] from hq.portfolio_overview where id = pg_temp.mid('a')), 'management_agreement_signed', 'overview: open steps in checklist order');
select is((select owner_display_name from hq.portfolio_overview where id = pg_temp.mid('b')), 'Alice Anders', 'overview: the owner contact''s name');
select is((select owner_display_name from hq.portfolio_overview where id = pg_temp.mid('a')), '[test] Pat Landlord', 'overview: else the typed owner name');
select pg_temp.unbecome();
select pg_temp.become('jpm');
select is((select count(*) from hq.managed_properties), 0::bigint, 'a junior sees no managed properties');
select is((select count(*) from hq.property_handover_steps), 0::bigint, '... nor steps');
select is((select count(*) from hq.portfolio_overview), 0::bigint, '... nor the overview');
select pg_temp.unbecome();
select pg_temp.become('va');
select is((select count(*) from hq.managed_properties), 0::bigint, 'a virtual assistant sees no managed properties');
select pg_temp.unbecome();

-- ------------------------------------------------------------ archive and restore
select pg_temp.become('pm');
select throws_ok(format($$select hq.archive_record('managed_property', %L)$$, pg_temp.mid('b')), '42501', null, 'a property manager cannot archive a property');
select pg_temp.unbecome();
select pg_temp.become('spm');
insert into zz_r select 'arch', hq.archive_record('managed_property', pg_temp.mid('b'), 'Entered twice');
select throws_ok(format($$select hq.update_managed_property(%L, p_notes => 'x')$$, pg_temp.mid('b')), 'P0002', null, 'an archived property cannot be edited');
select throws_ok(format($$select hq.set_handover_step(%L, 'owner_onboarded', 'done')$$, pg_temp.mid('b')), 'P0002', null, '... nor its steps');
select is((select count(*) from hq.managed_properties where id = pg_temp.mid('b')), 1::bigint, 'a writer still sees an archived property (to restore it)');
select pg_temp.unbecome();
select pg_temp.become('pm');
select is((select count(*) from hq.managed_properties where id = pg_temp.mid('b')), 0::bigint, 'a reader does not see an archived property');
select is((select count(*) from hq.property_handover_steps where property_id = pg_temp.mid('b')), 0::bigint, '... nor its steps');
select pg_temp.unbecome();
select is(pg_temp.audits('managed_property', pg_temp.mid('b'), 'archive'), 1::bigint, 'archive is audited');
-- with the property archived, the opportunity may leave signed; then restoring the property is refused
select pg_temp.become('dir');
select hq.move_opportunity(pg_temp.fx('o2'), 'proposal_sent', 'Signed by mistake');
select pg_temp.unbecome();
select pg_temp.become('spm');
select throws_ok(format($$select hq.restore_record('managed_property', %L)$$, pg_temp.mid('b')), '23514', null, 'restoring a property whose opportunity is no longer signed is refused');
select pg_temp.unbecome();
select pg_temp.become('dir');
select hq.move_opportunity(pg_temp.fx('o2'), 'management_signed');
select pg_temp.unbecome();
select pg_temp.become('spm');
insert into zz_r select 'rest', hq.restore_record('managed_property', pg_temp.mid('b'));
select pg_temp.unbecome();
select is((select deleted_at is null and deleted_by is null from hq.managed_properties where id = pg_temp.mid('b')), true, 'restored once the opportunity is signed again');
select is(pg_temp.audits('managed_property', pg_temp.mid('b'), 'restore'), 1::bigint, 'restore is audited');
select throws_ok(format($$delete from hq.managed_properties where id = %L$$, pg_temp.mid('b')), '42501', null, 'a managed property is never deleted (even by the owner)');
select throws_ok(format($$update hq.managed_properties set opportunity_id = %L where id = %L$$, pg_temp.fx('o3'), pg_temp.mid('b')), '42501', null, 'a property never moves to another opportunity');

-- ------------------------------------------------------------ the overview's shape
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'hq' and table_name = 'portfolio_overview'),
  array['id', 'ref_number', 'ref', 'property_address', 'suburb', 'service_type', 'status', 'fee_basis', 'fee_percent', 'fee_notes', 'agreement_signed_on', 'managed_from', 'ended_on',
        'ailo_reference', 'ailo_status', 'notes', 'opportunity_id', 'opportunity_number', 'opportunity_prospect_name', 'opportunity_signed_at', 'manual_origin_note',
        'owner_contact_id', 'owner_display_name', 'owner_name', 'owner_phone', 'owner_email', 'handover_done', 'handover_total', 'handover_open_steps',
        'created_by', 'created_at', 'updated_at', 'deleted_at'],
  'overview: the documented columns, in order');
select is(hq_private.mp_ref(7), 'MP-0007', 'mp_ref pads to four digits');
select is(hq_private.mp_ref(123456), 'MP-123456', 'mp_ref never truncates a long number');

select * from finish();
rollback;
