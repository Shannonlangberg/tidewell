-- Planted HQ: the Referral partners read model (hq.referral_partner_overview, migration 0122).
-- Shape and security, last contacted / never contacted, next follow-up, most advanced status, the
-- figures matching partner_performance exactly for every organisation, a prospect claimed twice
-- counted once, independent contacts kept (not dropped) without double counting, and RLS.
begin;
\ir hq_fixture.inc
select pg_temp.seed_hq();
select plan(48);

-- an independent partner (no organisation) and a contact-less organisation
with i as (insert into hq.contacts (full_name, phone, email, categories) values ('Ivy Independent', '0400 000 001', 'ivy@indie.test', '{mortgage_broker}') returning id)
insert into fx select 'ivy', id from i;
with o as (insert into hq.organisations (name, categories) values ('Delta Developments', '{property_developer}') returning id)
insert into fx select 'delta', id from o;
update hq.contacts set phone = '0400 000 002' where id = pg_temp.fx('alice');

-- the figures that must equal partner_performance, side by side
create function pg_temp.mismatches() returns bigint
language sql as $$
  select count(*)
  from hq.partner_performance pp
  full join (select * from hq.referral_partner_overview where partner_kind = 'organisation') v on v.id = pp.organisation_id
  where v.id is null or pp.organisation_id is null
     or (v.referrals_received, v.referrals_sent, v.referrals_qualified, v.managements_signed, v.conversion, v.estimated_value_signed_cents, v.reciprocal)
        is distinct from (pp.received, pp.sent, pp.qualified, pp.signed, pp.conversion, pp.estimated_value_signed_cents, pp.reciprocal)
$$;

-- ------------------------------------------------------------ shape and security
select has_view('hq', 'referral_partner_overview', 'the referral_partner_overview view exists');
select ok((select c.reloptions @> array['security_invoker=true'] from pg_class c where c.oid = 'hq.referral_partner_overview'::regclass), 'it is security_invoker (the reader''s RLS applies)');
select ok(has_table_privilege('authenticated', 'hq.referral_partner_overview', 'select'), 'authenticated may select it');
select ok(not has_table_privilege('anon', 'hq.referral_partner_overview', 'select'), 'anon may not');
select ok(not has_table_privilege('authenticated', 'hq.referral_partner_overview', 'insert,update,delete,truncate'), 'it is read-only to authenticated');
select pg_temp.become_anon();
select throws_ok('select 1 from hq.referral_partner_overview', '42501', null, 'anon is denied, not merely empty');
select pg_temp.unbecome();

-- ------------------------------------------------------------ one row per live partner, nothing dropped
select pg_temp.become('bdm');
select is((select array_agg(name order by name) from hq.referral_partner_overview where partner_kind = 'organisation'),
  array['Alpha Realty', 'Beta Broking', 'Delta Developments', 'Gamma Conveyancing'], 'one organisation row per live organisation');
select is((select array_agg(name order by name) from hq.referral_partner_overview where partner_kind = 'independent'),
  array['Ivy Independent'], 'a contact with no organisation is kept, as an independent partner');
select ok((select organisation_id is null from hq.referral_partner_overview where id = pg_temp.fx('ivy')), 'an independent row has no organisation id ...');
select is((select contact_id::text || '|' || contact_count || '|' || primary_contact_phone || '|' || primary_contact_email from hq.referral_partner_overview where id = pg_temp.fx('ivy')),
  pg_temp.fx('ivy')::text || '|1|0400 000 001|ivy@indie.test', '... and is its own contact');
select is((select primary_contact_name || '|' || primary_contact_phone || '|' || primary_contact_email || '|' || contact_count from hq.referral_partner_overview where id = pg_temp.fx('alpha')),
  'Alice Anders|0400 000 002|alice@alpha.test|2', 'an organisation row carries its primary contact and contact count');
select is((select primary_contact_id is null and contact_count = 0 and relationship_status is null from hq.referral_partner_overview where id = pg_temp.fx('delta')),
  true, 'an organisation with no contacts: no primary, zero contacts, no status');

-- ------------------------------------------------------------ never contacted
select is((select count(*) from hq.referral_partner_overview where last_contacted_at is null and days_since_contact is null), 5::bigint,
  'never contacted: last_contacted_at and days_since_contact are null (shown as Never), for every partner');
select is((select referrals_received + referrals_sent + managements_signed from hq.referral_partner_overview where id = pg_temp.fx('alpha')), 0::bigint, 'no referrals: zeros, not nulls');
select is((select last_referral_date from hq.referral_partner_overview where id = pg_temp.fx('alpha')), null::date, 'no referrals: no last referral date');
select is(pg_temp.mismatches(), 0::bigint, 'before any activity, every organisation''s figures equal partner_performance');

-- ------------------------------------------------------------ last contacted and next follow-up
select hq.record_interaction(pg_temp.fx('alex'), null, 'phone_call', now() - interval '40 days', 'Old call');
select hq.record_interaction(pg_temp.fx('alice'), null, 'coffee_meeting', now() - interval '3 days', 'Coffee in Moonta', null, hq.today() + 5);
select is((select last_contacted_at from hq.referral_partner_overview where id = pg_temp.fx('alpha')), now() - interval '3 days', 'last contacted is the latest across the organisation''s contacts');
select is((select days_since_contact from hq.referral_partner_overview where id = pg_temp.fx('alpha')), 3, '... 3 days ago, in calendar days');
select is((select next_follow_up_date from hq.referral_partner_overview where id = pg_temp.fx('alpha')), hq.today() + 5, 'next follow-up: the earliest open follow-up among its contacts');
select is((select follow_up_overdue from hq.referral_partner_overview where id = pg_temp.fx('alpha')), false, '... not overdue');
-- an organisation-level interaction (no contact) counts as contact, and its follow-up is open until something is logged after it
select hq.record_interaction(null, pg_temp.fx('delta'), 'email', now() - interval '45 days', 'Intro email to the office', null, hq.today() - 2);
select is((select days_since_contact from hq.referral_partner_overview where id = pg_temp.fx('delta')), 45, 'an organisation-level interaction counts as contact (45 days)');
select is((select next_follow_up_date::text || '|' || follow_up_overdue from hq.referral_partner_overview where id = pg_temp.fx('delta')), (hq.today() - 2)::text || '|true', '... its follow-up is open, and overdue');
select hq.record_interaction(null, pg_temp.fx('delta'), 'phone_call', now() - interval '1 day', 'Followed up by phone');
select is((select next_follow_up_date from hq.referral_partner_overview where id = pg_temp.fx('delta')), null::date, 'a later interaction closes the organisation-level follow-up');
select is((select days_since_contact from hq.referral_partner_overview where id = pg_temp.fx('delta')), 1, '... and last contacted moves to yesterday');
-- an inactive contact's follow-up is not open (as in overdue_followups)
select pg_temp.unbecome();
update hq.contacts set next_follow_up_date = hq.today() - 10, relationship_status = 'inactive' where id = pg_temp.fx('bob');
select pg_temp.become('bdm');
select is((select next_follow_up_date from hq.referral_partner_overview where id = pg_temp.fx('beta')), null::date, 'an inactive contact''s follow-up does not count');

-- ------------------------------------------------------------ the most advanced relationship status
select pg_temp.unbecome();
update hq.contacts set relationship_status = 'met' where id = pg_temp.fx('alice');
update hq.contacts set relationship_status = 'inactive' where id = pg_temp.fx('alex');
select pg_temp.become('bdm');
select is((select relationship_status from hq.referral_partner_overview where id = pg_temp.fx('alpha')), 'met'::hq.relationship_status, 'status: the most advanced among live contacts, ignoring inactive');
select is((select relationship_status from hq.referral_partner_overview where id = pg_temp.fx('beta')), 'inactive'::hq.relationship_status, 'status: inactive only when every contact is inactive');
select pg_temp.unbecome();
update hq.contacts set relationship_status = 'referring_partner' where id = pg_temp.fx('alex');
select pg_temp.become('bdm');
select is((select relationship_status from hq.referral_partner_overview where id = pg_temp.fx('alpha')), 'referring_partner'::hq.relationship_status, 'status: referring partner outranks met');
select pg_temp.unbecome();

-- ------------------------------------------------------------ referrals: one prospect, two claims, signed ONCE
select pg_temp.become('bdm');
select pg_temp.keep('rA', hq.record_referral(p_direction := 'received', p_referring_contact := pg_temp.fx('alice'), p_prospect_name := 'Pat Prospect',
  p_estimated_value_cents := 1200000, p_referral_date := hq.today() - 6));
select pg_temp.keep('rB', hq.record_referral(p_direction := 'received', p_referring_organisation := pg_temp.fx('beta'), p_existing_opportunity := pg_temp.fx('rA_opportunity_id'),
  p_referral_date := hq.today() - 4));
select hq.move_opportunity(pg_temp.fx('rA_opportunity_id'), 'qualified');
select hq.move_opportunity(pg_temp.fx('rA_opportunity_id'), 'management_signed', null, now(), 'PM-7001');
select hq.move_opportunity(pg_temp.fx('rA_opportunity_id'), 'management_signed', null, now(), 'PM-7002');
select pg_temp.keep('rS', hq.record_referral(p_direction := 'sent', p_receiving_organisation := pg_temp.fx('alpha'), p_prospect_name := 'Sam Seller', p_referral_date := hq.today() - 1));
select pg_temp.unbecome();
-- the same partner holding a second referral row on the same prospect (another of its contacts logged it):
-- the RPC refuses this, so it is written directly, to prove the view still counts the signing once
insert into hq.referrals (direction, referring_contact_id, opportunity_id, referral_date, is_attributed)
values ('received', pg_temp.fx('alex'), pg_temp.fx('rA_opportunity_id'), hq.today() - 2, false);
select pg_temp.become('bdm');

select is((select referrals_received || '|' || referrals_sent || '|' || referrals_qualified || '|' || managements_signed || '|' || estimated_value_signed_cents || '|' || reciprocal
             from hq.referral_partner_overview where id = pg_temp.fx('alpha')),
  '2|1|1|1|1200000|true', 'alpha: two referrals for one prospect, signed ONCE; one sent, so reciprocal');
select is((select referrals_received || '|' || referrals_qualified || '|' || managements_signed from hq.referral_partner_overview where id = pg_temp.fx('beta')),
  '1|0|0', 'beta: a non-attributed claim on the same prospect is credited nothing');
select is((select sum(managements_signed)::int from hq.referral_partner_overview), 1, 'across every partner the prospect is signed ONCE');
select is((select last_referral_date from hq.referral_partner_overview where id = pg_temp.fx('alpha')), hq.today() - 1, 'last referral date: the latest in either direction');
select is(pg_temp.mismatches(), 0::bigint, 'every organisation''s figures equal partner_performance exactly');

-- moving attribution moves the credit, still once
select hq.set_attributed_referral(pg_temp.fx('rA_opportunity_id'), pg_temp.fx('rB_referral_id'));
select is((select managements_signed from hq.referral_partner_overview where id = pg_temp.fx('beta')), 1::bigint, 'after moving attribution, beta holds the one signing');
select is((select managements_signed from hq.referral_partner_overview where id = pg_temp.fx('alpha')), 0::bigint, '... and alpha none');
select is((select sum(managements_signed)::int from hq.referral_partner_overview), 1, '... still ONE across every partner');
select is(pg_temp.mismatches(), 0::bigint, '... and the view still equals partner_performance');

-- an independent partner: the same rules, on the referrals that name them and no organisation
select pg_temp.keep('rI', hq.record_referral(p_direction := 'received', p_referring_contact := pg_temp.fx('ivy'), p_prospect_name := 'Indi Prospect', p_estimated_value_cents := 300000));
select pg_temp.keep('rI2', hq.record_referral(p_direction := 'received', p_referring_contact := pg_temp.fx('ivy'), p_prospect_name := 'Lost Prospect'));
select hq.move_opportunity(pg_temp.fx('rI_opportunity_id'), 'management_signed', null, now(), 'PM-7003');
select hq.move_opportunity(pg_temp.fx('rI2_opportunity_id'), 'qualified');
select hq.move_opportunity(pg_temp.fx('rI2_opportunity_id'), 'lost', null, null, null, 'Sold instead', 'other');
select pg_temp.keep('rIS', hq.record_referral(p_direction := 'sent', p_receiving_contact := pg_temp.fx('ivy'), p_prospect_name := 'Out Going'));
select is((select referrals_received || '|' || referrals_sent || '|' || referrals_qualified || '|' || managements_signed || '|' || estimated_value_signed_cents || '|' || conversion || '|' || reciprocal
             from hq.referral_partner_overview where id = pg_temp.fx('ivy')),
  '2|1|2|1|300000|0.5000|true', 'independent: received, sent, ever-qualified (incl. the lost one), signed once, value, conversion, reciprocal');
select is(pg_temp.mismatches(), 0::bigint, 'an independent partner''s referrals change no organisation''s figures');
select is((select sum(referrals_received)::bigint from hq.referral_partner_overview), (select count(*) from hq.referrals where direction = 'received' and deleted_at is null),
  'every live received referral is counted exactly once across all partner rows');
select is((select sum(managements_signed)::bigint from hq.referral_partner_overview),
  (select count(distinct o.id) from hq.opportunities o join hq.referrals r on r.opportunity_id = o.id and r.is_attributed and r.deleted_at is null
    where o.deleted_at is null and o.stage = 'management_signed'),
  'every signed management with an attributed referral is counted exactly once across all partner rows');
select pg_temp.unbecome();

-- ------------------------------------------------------------ archived records
select pg_temp.become('dir');
select hq.archive_record('contact', pg_temp.fx('carol'));
select is((select contact_count || '|' || coalesce(primary_contact_name, 'none') from hq.referral_partner_overview where id = pg_temp.fx('gamma')), '0|none', 'an archived contact is not counted or shown');
select hq.archive_record('organisation', pg_temp.fx('gamma'));
select is((select count(*) from hq.referral_partner_overview where id = pg_temp.fx('gamma')), 0::bigint, 'an archived organisation is not listed (even for a growth.delete holder)');
select pg_temp.unbecome();

-- ------------------------------------------------------------ RLS: only growth.read holders see anything
select pg_temp.become('jpm');
select is((select count(*) from hq.referral_partner_overview), 0::bigint, 'junior property manager (no growth.read): sees nothing');
select pg_temp.become('outsider');
select is((select count(*) from hq.referral_partner_overview), 0::bigint, 'a signed-in person with no HQ profile: sees nothing');
select pg_temp.become('bdm', 'aal1');
select is((select count(*) from hq.referral_partner_overview), 0::bigint, 'MFA owed (aal1): sees nothing');
select pg_temp.become('ro');
select is((select count(*) from hq.referral_partner_overview), 4::bigint, 'read_only (growth.read): sees every live partner');
select pg_temp.become('pm');
select is((select count(*) from hq.referral_partner_overview), 4::bigint, 'property manager (growth.read): sees every live partner');
select pg_temp.unbecome();

select * from finish();
rollback;
