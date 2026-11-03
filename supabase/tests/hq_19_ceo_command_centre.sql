-- Planted HQ: the CEO Command Centre (migrations 0162-0163). The agreement terms on a managed property
-- (who may set them, the rules, audited), the weekly targets setting (settings.admin, validated, starts
-- empty), and hq.ceo_overview: capability checks, period checks, and the figures it counts (started, ended
-- with reasons, managed at the start and end of a period, contracted fees, the economics, the monthly
-- series) checked against properties made here, and its growth figures checked against growth_summary.
--
-- NOTE: never CALL a function a hint role lacks execute on (see hq_01). Every RPC here is granted to
-- authenticated; anon is refused at the schema.
begin;
\ir hq_fixture.inc
select pg_temp.seed_hq();
select plan(41);

create temp table zz_r (k text primary key, v jsonb) on commit drop;
grant select, insert on zz_r to public;
create function pg_temp.r(p_k text) returns jsonb language sql stable as $$ select v from zz_r where k = p_k $$;
create function pg_temp.id(p_k text) returns uuid language sql stable as $$ select (v ->> 'managed_property_id')::uuid from zz_r where k = p_k $$;

-- ------------------------------------------------------------ structure
select has_column('hq', 'managed_properties', 'weekly_rent_cents', 'managed_properties.weekly_rent_cents exists');
select has_column('hq', 'managed_properties', 'annual_fee_cents', 'managed_properties.annual_fee_cents exists');
select has_column('hq', 'managed_properties', 'end_reason', 'managed_properties.end_reason exists');
select has_column('hq', 'portfolio_overview', 'weekly_rent_cents', 'portfolio_overview shows the terms');
select enum_has_labels('hq', 'management_end_reason', array['owner_sold', 'owner_self_managing', 'moved_to_another_manager', 'owner_moving_in', 'service', 'fees', 'other']);
select is((select value from hq.settings where key = 'ceo_weekly_targets'), 'null'::jsonb, 'no weekly targets are invented: the setting starts empty');

-- ------------------------------------------------------------ three properties, made as a director
select pg_temp.become('dir');
-- A: long-term, 8.8% of rent, managed for 40 days, active
insert into zz_r select 'a', hq.add_existing_managed_property('Signed before HQ', '1 Test Street, Wallaroo', 'long_term_residential', p_owner_name => 'Test Owner',
  p_fee_basis => 'percent_of_rent', p_fee_percent => 8.8, p_managed_from => hq.today() - 40, p_status => 'active');
-- B: short-term, flat fee, onboarding, agreement signed 5 days ago (no managed_from yet)
insert into zz_r select 'b', hq.add_existing_managed_property('Signed before HQ', '2 Test Street, Moonta Bay', 'short_term_accommodation', p_owner_name => 'Test Owner',
  p_fee_basis => 'flat_fee', p_agreement_signed_on => hq.today() - 5);
-- C: long-term, managed for 100 days, ended 3 days ago
insert into zz_r select 'c', hq.add_existing_managed_property('Signed before HQ', '3 Test Street, Kadina', 'long_term_residential', p_owner_name => 'Test Owner',
  p_fee_basis => 'percent_of_rent', p_fee_percent => 9, p_managed_from => hq.today() - 100, p_status => 'active');
select hq.update_managed_property(pg_temp.id('c'), p_status => 'ended', p_ended_on => hq.today() - 3);

-- ------------------------------------------------------------ set_property_terms
insert into zz_r select 'ta', hq.set_property_terms(pg_temp.id('a'), p_weekly_rent_cents => 65000);
select is((pg_temp.r('ta') ->> 'annual_fee_cents_worked_out')::bigint, 297440::bigint, 'rent x 52 x 8.8% = $2,974.40 a year');
select throws_ok(format($$select hq.set_property_terms(%L, p_annual_fee_cents => 100000)$$, pg_temp.id('a')), '22023', null, 'a percentage fee takes the rent, not a yearly fee');
select throws_ok(format($$select hq.set_property_terms(%L, p_end_reason => 'owner_sold')$$, pg_temp.id('a')), '22023', null, 'an active property has no reason for ending');
select throws_ok(format($$select hq.set_property_terms(%L, p_weekly_rent_cents => 0)$$, pg_temp.id('a')), '22023', null, 'a rent of nothing is refused');
select throws_ok(format($$select hq.set_property_terms(%L, p_clear => array['fee_percent'])$$, pg_temp.id('a')), '22023', null, 'only the three terms can be cleared');
insert into zz_r select 'tb', hq.set_property_terms(pg_temp.id('b'), p_annual_fee_cents => 120000);
select is((pg_temp.r('tb') ->> 'annual_fee_cents_worked_out')::bigint, 120000::bigint, 'a flat fee is the agreed yearly fee');
select is((hq.set_property_terms(pg_temp.id('b'), p_annual_fee_cents => 120000)) ->> 'changed', 'false', 'saving the same terms changes nothing');
select is((hq.set_property_terms(pg_temp.id('c'), p_weekly_rent_cents => 50000, p_end_reason => 'owner_sold')) ->> 'changed', 'true', 'an ended property records why');
select pg_temp.unbecome();
select ok(exists (select 1 from hq.audit_events where entity_type = 'managed_property' and entity_id = pg_temp.id('a') and changes::text like '%weekly_rent_cents%'), 'the terms are in the audit trail');

select pg_temp.become('pm');
select throws_ok(format($$select hq.set_property_terms(%L, p_weekly_rent_cents => 1)$$, pg_temp.id('a')), '42501', null, 'a property manager (portfolio.read) cannot set terms');
select throws_ok($$select hq.set_ceo_targets('{"signings": 1}')$$, '42501', null, 'nor the weekly targets');

-- ------------------------------------------------------------ weekly targets
select pg_temp.become('dir');
select throws_ok($$select hq.set_ceo_targets('{"signings": 2000}')$$, '22023', null, 'a target is at most 1000');
select throws_ok($$select hq.set_ceo_targets('{"profit": 5}')$$, '22023', null, 'only the six measures have targets');
select throws_ok($$select hq.set_ceo_targets('{"signings": 1.5}')$$, '22023', null, 'a target is a whole number');
select is((hq.set_ceo_targets('{"signings": 1, "relationship_actions": 10}')) ->> 'changed', 'true', 'a director sets targets');
select is((select value from hq.settings where key = 'ceo_weekly_targets'), '{"signings": 1, "relationship_actions": 10}'::jsonb, 'and they are stored as given');
select pg_temp.unbecome();
select throws_ok($$update hq.settings set value = '{"signings": -1}' where key = 'ceo_weekly_targets'$$, '22023', null, 'the setting refuses a bad value even written directly');
select pg_temp.become('dir');
select is((hq.ceo_overview(hq.today(), hq.today())) -> 'targets', '{"signings": 1, "relationship_actions": 10}'::jsonb, 'ceo_overview returns the targets');
select hq.set_ceo_targets('{}');
select is((hq.ceo_overview(hq.today(), hq.today())) -> 'targets', 'null'::jsonb, 'an empty set clears them');

-- ------------------------------------------------------------ ceo_overview: periods and access
select throws_ok($$select hq.ceo_overview(hq.today(), hq.today() - 1)$$, '22023', null, 'a period ends on or after it starts');
select throws_ok($$select hq.ceo_overview(hq.today() - 2000, hq.today())$$, '22023', null, 'a period is at most three years');
select throws_ok($$select hq.ceo_overview(hq.today() - 5, hq.today(), hq.today() - 10, hq.today() - 5)$$, '22023', null, 'the comparison ends before the period starts');
select is((hq.ceo_overview(hq.today() - 5, hq.today() + 30)) -> 'period' ->> 'to', hq.today()::text, 'a period never reaches past today');

-- ------------------------------------------------------------ ceo_overview: the portfolio figures
insert into zz_r select 'o', hq.ceo_overview(hq.today() - 9, hq.today(), hq.today() - 19, hq.today() - 10);
select is((pg_temp.r('o') #>> '{period,portfolio,started}')::int, 1, 'started in the period: B (from its agreement date)');
select is((pg_temp.r('o') #>> '{period,portfolio,ended}')::int, 1, 'ended in the period: C');
select is(pg_temp.r('o') #> '{period,portfolio,ended_reasons}', '{"owner_sold": 1}'::jsonb, 'with its recorded reason');
select is((pg_temp.r('o') #>> '{period,portfolio,managed_at_start}')::int, 2, 'managed at the start: A and C');
select is((pg_temp.r('o') #>> '{period,portfolio,managed_at_end}')::int, 2, 'managed at the end: A and B');
select is((pg_temp.r('o') #>> '{period,portfolio,fees_at_end_cents}')::bigint, 417440::bigint, 'contracted fees at the end: A $2,974.40 + B $1,200');
select is((pg_temp.r('o') #>> '{previous,portfolio,managed_at_end}')::int, 2, 'the comparison period is counted the same way (A and C)');
select is(pg_temp.r('o') #> '{economics,long_term}', '{"with_fee": 1, "with_rent": 1, "properties": 1, "with_percent": 1, "annual_fees_cents": 297440, "average_fee_percent": 8.80, "average_weekly_rent_cents": 65000}'::jsonb,
  'long-term economics are the live portfolio only (the ended property is left out)');
select is((pg_temp.r('o') #>> '{economics,short_term,annual_fees_cents}')::bigint, 120000::bigint, 'short-term fees are reported apart');
select is(pg_temp.r('o') -> 'series' -> 12 -> 'long_term' -> 'managed', '1'::jsonb, 'this month ends with one long-term property managed');

-- ------------------------------------------------------------ ceo_overview: growth agrees with growth_summary
select is(((hq.ceo_overview(hq.today() - 30, hq.today())) #> '{period,growth}') - array['new_opportunities', 'new_by_source', 'entered', 'signed_estimated_value_cents', 'signed_from_partners', 'lost', 'lost_reasons', 'referrals_sent', 'partners_introducing', 'qualified_referrals', 'relationship_actions', 'partner_conversations', 'discovery_conversations', 'enquiries_received', 'enquiries_handled', 'enquiry_median_hours'],
  jsonb_build_object('qualified', (hq.growth_summary(hq.today() - 30)) -> 'qualified', 'signed', (hq.growth_summary(hq.today() - 30)) -> 'managements_signed', 'referrals_received', (hq.growth_summary(hq.today() - 30)) -> 'referrals_received'),
  'qualified, signed and referrals received are the same counts as growth_summary');

-- a role without growth.read or portfolio.read gets nothing
select pg_temp.unbecome();
select pg_temp.become('ro');
select ok((hq.ceo_overview(hq.today(), hq.today())) -> 'period' -> 'portfolio' is not null, 'read-only staff (portfolio.read) see the portfolio figures');
select pg_temp.unbecome();

select * from finish();
rollback;
