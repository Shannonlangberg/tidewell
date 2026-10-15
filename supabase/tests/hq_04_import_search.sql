-- Planted HQ: growth_summary, partner import (preview and apply agree exactly), global_search.
-- The 27 research-lead rows of hq/seed/referral-contacts.json are embedded below (not read from SQL).
begin;
\ir hq_fixture.inc
select pg_temp.seed_hq();
select plan(109);

create temp table zz_rows (rows jsonb not null) on commit drop;
grant select on zz_rows to public;
insert into zz_rows values ($rows$[{"organisation":"eXp Realty","full_name":"Tim Hosking","categories":["real_estate_sales"],"service_region":"Copper Coast"},{"organisation":"eXp Realty","full_name":"Sarb Singh","categories":["real_estate_sales"],"service_region":"Copper Coast"},{"organisation":"a.s lending co.","full_name":"Amanda Schultz","categories":["mortgage_broker"],"service_region":"Copper Coast"},{"organisation":"Mildwaters Byrth","full_name":"Anna Przibilla","categories":["conveyancer"],"service_region":"Copper Coast"},{"organisation":"Mildwaters Byrth","full_name":"Candice Light","categories":["conveyancer"],"service_region":"Copper Coast"},{"organisation":"Germein Reed","full_name":"Ros Rawson","categories":["conveyancer"],"service_region":"Copper Coast"},{"organisation":"Germein Reed","full_name":"Doug Reed","categories":["lawyer","conveyancer"],"service_region":"Copper Coast","flags":["Supplied category was \"Legal / Conveyancing\"; both recorded."]},{"organisation":"BankSA","full_name":"Troy Scott","categories":["bank_lending"],"service_region":"Copper Coast"},{"organisation":"Loan Market","full_name":"Mark West","categories":["mortgage_broker"],"service_region":"Copper Coast"},{"organisation":"Mildwaters Byrth","full_name":"Kylie Mildwaters","categories":["lawyer"],"service_region":"Copper Coast"},{"organisation":"Mildwaters Byrth","full_name":"Joel Byrth","categories":["lawyer"],"service_region":"Copper Coast"},{"organisation":"Wardle Co","full_name":"Brenton Brind","categories":["real_estate_sales"],"service_region":"Copper Coast","flags":["Supplied category was \"Real Estate\"; recorded as real estate sales. Confirm his role."]},{"organisation":"Your Property Strategy","full_name":"David Ronson","categories":["buyers_agent"],"service_region":"Adelaide"},{"organisation":"Scale Property Advisory","full_name":"Bois Qodirjonov","categories":["buyers_agent"],"service_region":"Adelaide","flags":["Confirm spelling of the name."]},{"organisation":"Complete Property Strategies","full_name":"Brian Sayers","categories":["buyers_agent","mortgage_broker"],"service_region":"Adelaide","flags":["Supplied category was \"Buyers Agent / Mortgage Broker\"; both recorded."]},{"organisation":"Estate of Mind Property","full_name":"Shane Byrne","categories":["buyers_agent"],"service_region":"Adelaide"},{"organisation":"Core Capital","full_name":"Cobi Rontaunay","categories":["buyers_agent"],"service_region":"Adelaide","flags":["Confirm spelling of the name."]},{"organisation":"PBA","full_name":"Stephen Goodwin","categories":["buyers_agent"],"service_region":"Adelaide"},{"organisation":"PBA","full_name":"Damian Swart","categories":["buyers_agent"],"service_region":"Adelaide"},{"organisation":"You & Me Property Partners","full_name":"Simon Deering","categories":["buyers_agent"],"service_region":"Adelaide"},{"organisation":"EquityLift","full_name":"Michael Lillywhite","categories":["buyers_agent"],"service_region":"Adelaide"},{"organisation":"The Loan Arranger","full_name":"Scott Marshall","categories":["mortgage_broker"],"service_region":"Adelaide","flags":["Possible duplicate of Steve Marshall at the same organisation. Confirm whether they are one person or two before contacting either."]},{"organisation":"My Brokers Office","full_name":"Steven Voroniansky","categories":["mortgage_broker"],"service_region":"Adelaide"},{"organisation":"Fintegra","full_name":"Travis Hole","categories":["mortgage_broker"],"service_region":"Adelaide"},{"organisation":"Fintegra","full_name":"Brad Smart","categories":["mortgage_broker"],"service_region":"Adelaide"},{"organisation":"The Loan Arranger","full_name":"Steve Marshall","categories":["mortgage_broker"],"service_region":"Adelaide","flags":["Possible duplicate of Scott Marshall at the same organisation. Confirm whether they are one person or two before contacting either."]},{"organisation":"AAF Conveyancing","full_name":"Syed Kazim Hussain Zaidi","categories":["conveyancer"],"service_region":"Adelaide"}]$rows$::jsonb);
create function pg_temp.rows() returns jsonb language sql stable as $$ select rows from zz_rows $$;

create temp table zz_res (k text primary key, v jsonb not null) on commit drop;
grant select, insert on zz_res to public;
create function pg_temp.res(p_key text) returns jsonb language sql stable as $$ select v from zz_res where k = p_key $$;
-- "<classification>/<action>" of one row of a stored preview or apply result
create function pg_temp.cls(p_key text, p_row integer) returns text language sql stable as $$
  select (e ->> 'classification') || '/' || (e ->> 'action')
  from jsonb_array_elements(pg_temp.res(p_key) -> 'rows') e where (e ->> 'row')::integer = p_row $$;
create function pg_temp.cls_of(p_result jsonb, p_row integer) returns text language sql stable as $$
  select (e ->> 'classification') || '/' || (e ->> 'action')
  from jsonb_array_elements(p_result -> 'rows') e where (e ->> 'row')::integer = p_row $$;
create function pg_temp.counts_of(p_key text) returns jsonb language sql stable as $$ select pg_temp.res(p_key) -> 'counts' $$;

-- ------------------------------------------------------------ growth_summary: real counts only
select pg_temp.become('pm');
select is(hq.growth_summary(null) - 'contacts_by_status',
  jsonb_build_object('since', hq.today() - 30, 'as_of', hq.today(), 'managements_signed', 0, 'referrals_received', 0, 'referrals_sent', 0,
    'active_opportunities', 0, 'qualified', 0, 'conversion', null, 'overdue_followups', 0, 'contacts_not_contacted_30d', 4,
    'estimated_value_signed_cents', 0),
  'growth_summary on an empty pipeline: zeros, conversion null (never a fabricated number); since defaults to 30 days ago');
select pg_temp.unbecome();
update hq.contacts set relationship_status = 'contacted', last_contact_at = now() - interval '40 days' where id = pg_temp.fx('alice');
update hq.contacts set relationship_status = 'met', last_contact_at = now() - interval '5 days' where id = pg_temp.fx('alex');
update hq.contacts set relationship_status = 'inactive', next_follow_up_date = hq.today() - 5 where id = pg_temp.fx('bob');
update hq.contacts set next_follow_up_date = hq.today() - 1 where id = pg_temp.fx('carol');
select pg_temp.become('pm');
select is(hq.growth_summary(null) -> 'contacts_by_status',
  '{"identified": 1, "contacted": 1, "meeting_booked": 0, "met": 1, "active_relationship": 0, "referring_partner": 0, "inactive": 1}'::jsonb,
  'growth_summary: contacts_by_status holds every status');
select is((hq.growth_summary(null) ->> 'overdue_followups')::int, 1, 'growth_summary: overdue follow-ups exclude inactive contacts');
select is((hq.growth_summary(null) ->> 'contacts_not_contacted_30d')::int, 2, 'growth_summary: not contacted in 30 days = never contacted or last contact older than 30 days (inactive excluded)');
select is(hq.growth_summary(date '2026-01-01') ->> 'since', '2026-01-01', 'growth_summary: p_since is honoured');
select pg_temp.unbecome();

-- ------------------------------------------------------------ preview_partner_import: classification, nothing written
select pg_temp.become('va');
select throws_ok($$select hq.preview_partner_import('[]'::jsonb)$$, '42501', null, 'a virtual assistant (no import.run) cannot preview an import');
select throws_ok($$select hq.apply_partner_import('[]'::jsonb, 'x')$$, '42501', null, 'a virtual assistant cannot apply an import');
select pg_temp.become('pm');
select throws_ok($$select hq.preview_partner_import('[]'::jsonb)$$, '42501', null, 'a property manager cannot preview an import');
select pg_temp.unbecome();

select count(*) as orgs0 from hq.organisations \gset
select count(*) as contacts0 from hq.contacts \gset
select count(*) as batches0 from hq.import_batches \gset
select count(*) as audit0 from hq.audit_events \gset

select pg_temp.become('bdm');
insert into zz_res select 'preview1', hq.preview_partner_import(pg_temp.rows());
select pg_temp.unbecome();
select is(pg_temp.counts_of('preview1'),
  '{"rows": 27, "new_organisation": 19, "new_contact": 7, "duplicate": 0, "possible_duplicate": 1, "invalid": 0, "organisations_created": 19, "contacts_created": 26, "skipped": 1, "flagged": 7}'::jsonb,
  'preview: 19 new organisations, 7 new contacts, 1 possible duplicate, 26 contacts to create');
select is(pg_temp.cls('preview1', 22), 'new_organisation/create', 'preview: the FIRST of two near-matches (Scott Marshall) is not flagged');
select is(pg_temp.cls('preview1', 26), 'possible_duplicate/skip', 'preview: the LATER near-match (Steve Marshall) is a possible_duplicate, skipped');
select is(pg_temp.cls('preview1', 2), 'new_contact/create', 'preview: a second contact at an organisation created earlier in the file is a new_contact');
select is(pg_temp.cls('preview1', 1), 'new_organisation/create', 'preview: the first contact of a new organisation is a new_organisation');
select is((select e ->> 'match_row' from jsonb_array_elements(pg_temp.res('preview1') -> 'rows') e where (e ->> 'row')::int = 26), '22', 'preview: a possible duplicate says which row it matches');
select is((select count(*) from hq.organisations), :orgs0::bigint, 'preview wrote no organisation');
select is((select count(*) from hq.contacts), :contacts0::bigint, 'preview wrote no contact');
select is((select count(*) from hq.import_batches), :batches0::bigint, 'preview wrote no import batch');
select is((select count(*) from hq.audit_events), :audit0::bigint, 'preview wrote no audit event');

-- ------------------------------------------------------------ apply_partner_import
select pg_temp.become('bdm');
insert into zz_res select 'apply1', hq.apply_partner_import(pg_temp.rows(), 'research-leads-2026-10', 'referral-contacts.json');
select pg_temp.unbecome();
select is(pg_temp.counts_of('apply1'), pg_temp.counts_of('preview1'), 'apply: the counts equal the preview''s');
select is(pg_temp.res('apply1') -> 'rows', pg_temp.res('preview1') -> 'rows', 'apply: the per-row classification AGREES EXACTLY with the preview');
select is((select count(*) from hq.organisations where source = 'research-leads-2026-10' and deleted_at is null), 19::bigint, 'apply: 19 organisations created');
select is((select count(*) from hq.contacts where source = 'research-leads-2026-10' and deleted_at is null), 26::bigint, 'apply: 26 contacts created');
select is((select count(*) from hq.contacts where full_name = 'Steve Marshall'), 0::bigint, 'apply: Steve Marshall (a possible duplicate of Scott Marshall) is reported, not inserted');
select is((select count(*) from hq.contacts where full_name = 'Scott Marshall'), 1::bigint, 'apply: Scott Marshall is inserted');
select is((select count(*) from hq.contacts where source = 'research-leads-2026-10' and (relationship_status <> 'identified' or not needs_verification)), 0::bigint, 'apply: every imported contact is identified and needs verification');
select is((select count(*) from hq.organisations where source = 'research-leads-2026-10' and not needs_verification), 0::bigint, 'apply: every imported organisation needs verification');
select is((select count(*) from hq.contacts where source = 'research-leads-2026-10'
            and (phone is not null or email is not null or website is not null or location is not null or position is not null
                 or relationship_owner_id is not null or last_contact_at is not null or next_follow_up_date is not null or verified_at is not null)), 0::bigint,
  'apply: nothing is invented (no phone, email, website, address, position, owner, dates)');
select is((select count(*) from hq.organisations where source = 'research-leads-2026-10'
            and (phone is not null or email is not null or website is not null or location is not null or relationship_owner_id is not null)), 0::bigint, 'apply: nothing is invented on organisations either');
select is((select count(*) filter (where org_contact_role = 'primary') || '/' || count(*) filter (where org_contact_role = 'secondary') from hq.contacts where source = 'research-leads-2026-10'), '19/7', 'apply: one primary per organisation (its first contact), later contacts secondary');
select is((select array_agg(c.full_name || ':' || c.org_contact_role order by c.full_name) from hq.contacts c join hq.organisations o on o.id = c.organisation_id where o.name = 'eXp Realty'),
  array['Sarb Singh:secondary', 'Tim Hosking:primary'], 'apply: eXp Realty has Tim Hosking primary and Sarb Singh secondary');
select is((select count(*) from hq.contacts c join hq.organisations o on o.id = c.organisation_id where o.name = 'Mildwaters Byrth' and c.source = 'research-leads-2026-10'), 4::bigint, 'apply: Mildwaters Byrth has its four contacts');
select is((select count(*) from hq.organisations where name in ('eXp Realty', 'Germein Reed', 'PBA', 'The Loan Arranger', 'Fintegra', 'Mildwaters Byrth') and source = 'research-leads-2026-10'), 6::bigint, 'apply: repeated organisations are created once');
select is((select categories::text from hq.contacts where full_name = 'Doug Reed'), '{lawyer,conveyancer}', 'apply: the supplied categories are kept, in order');
select is((select service_region from hq.organisations where name = 'Core Capital'), 'Adelaide', 'apply: the supplied service region is kept');
select is((select notes from hq.contacts where full_name = 'Doug Reed'), 'Verify: Supplied category was "Legal / Conveyancing"; both recorded.', 'apply: flags are stored in notes prefixed Verify:');
select is((select count(*) from hq.contacts where source = 'research-leads-2026-10' and notes like 'Verify: %'), 6::bigint, 'apply: six imported contacts carry Verify notes (the seventh flagged row was skipped)');
select is((select name_key from hq.organisations where name = 'The Loan Arranger'), 'loan arranger', 'apply: The Loan Arranger is keyed as loan arranger');
select is((select row(source, file_name, row_count, organisations_created, contacts_created, duplicates_skipped, flagged, applied_by)::text from hq.import_batches where id = (pg_temp.res('apply1') ->> 'batch_id')::uuid),
  row('research-leads-2026-10', 'referral-contacts.json', 27, 19, 26, 1, 7, pg_temp.fx('bdm'))::text, 'apply: an import_batches row records the counts and who applied it');
select is((select changes ->> 'contacts_created' from hq.audit_events where action = 'import' and entity_id = (pg_temp.res('apply1') ->> 'batch_id')::uuid), '26', 'apply: an import audit event is written');
select is((select actor_id from hq.audit_events where action = 'import' and entity_id = (pg_temp.res('apply1') ->> 'batch_id')::uuid), pg_temp.fx('bdm'), '... by the person who applied it');

-- idempotence: the same file twice creates nothing the second time
select pg_temp.become('bdm');
insert into zz_res select 'preview2', hq.preview_partner_import(pg_temp.rows());
insert into zz_res select 'apply2', hq.apply_partner_import(pg_temp.rows(), 'research-leads-2026-10', 'referral-contacts.json');
select pg_temp.unbecome();
select is(pg_temp.counts_of('apply2') - 'flagged', '{"rows": 27, "new_organisation": 0, "new_contact": 0, "duplicate": 26, "possible_duplicate": 1, "invalid": 0, "organisations_created": 0, "contacts_created": 0, "skipped": 27}'::jsonb, 'apply twice: the second run creates nothing (26 duplicates, 1 possible duplicate)');
select is(pg_temp.res('apply2') -> 'rows', pg_temp.res('preview2') -> 'rows', 'the re-run preview and apply agree exactly too');
select is((select count(*) from hq.organisations where source = 'research-leads-2026-10'), 19::bigint, 'apply twice: still 19 organisations');
select is((select count(*) from hq.contacts where source = 'research-leads-2026-10'), 26::bigint, 'apply twice: still 26 contacts');
select is(pg_temp.cls('apply2', 22), 'duplicate/skip', 'apply twice: Scott Marshall is now a duplicate');
select is(pg_temp.cls('apply2', 26), 'possible_duplicate/skip', 'apply twice: Steve Marshall is still only a possible duplicate');

-- confirm_distinct: the person confirms Steve and Scott are two people
select pg_temp.become('bdm');
insert into zz_res select 'preview3', hq.preview_partner_import(jsonb_build_array((pg_temp.rows() -> 25) || '{"confirm_distinct": true}'::jsonb));
insert into zz_res select 'apply3', hq.apply_partner_import(jsonb_build_array((pg_temp.rows() -> 25) || '{"confirm_distinct": true}'::jsonb), 'research-leads-2026-10', 'steve.json');
select pg_temp.unbecome();
select is(pg_temp.cls('preview3', 1), 'possible_duplicate/create', 'confirm_distinct: still reported as a possible_duplicate, but will be created');
select is(pg_temp.res('apply3') -> 'rows', pg_temp.res('preview3') -> 'rows', 'confirm_distinct: preview and apply agree');
select is((select c.org_contact_role::text || '|' || c.needs_verification::text from hq.contacts c where c.full_name = 'Steve Marshall'), 'secondary|true', 'confirm_distinct: Steve Marshall is inserted as a secondary contact needing verification');
select is((select notes from hq.contacts where full_name = 'Steve Marshall') like 'Verify: Possible duplicate of Scott Marshall%', true, 'confirm_distinct: his Verify flag is kept');
select pg_temp.become('bdm');
select is(pg_temp.cls_of(hq.apply_partner_import(jsonb_build_array((pg_temp.rows() -> 25) || '{"confirm_distinct": true}'::jsonb), 'research-leads-2026-10', 'steve.json'), 1), 'duplicate/skip', 'confirm_distinct: applying it again is a duplicate');
select pg_temp.unbecome();

-- other classification rules
select pg_temp.become('bdm');
insert into zz_res select 'rules', hq.preview_partner_import($j$[
  {"organisation": "Zeta Co Pty Ltd", "full_name": "Zed Zeta", "categories": ["other"], "service_region": "Copper Coast"},
  {"organisation": "ZETA CO", "full_name": "Zoe Zeta", "categories": ["other"], "service_region": "Copper Coast"},
  {"organisation": "The Zeta Co.", "full_name": "zed  ZETA", "categories": ["other"], "service_region": "Copper Coast"},
  {"organisation": "Eta Co", "full_name": "Eve Eta", "categories": ["lawyer"], "service_region": "Adelaide", "email": "Eve@Eta.test"},
  {"organisation": "Theta Co", "full_name": "Theo Theta", "categories": ["lawyer"], "service_region": "Adelaide", "email": "eve@eta.test"},
  {"organisation": "Alpha Realty", "full_name": "Alice Anders", "categories": ["real_estate_sales"], "service_region": "Copper Coast"},
  {"organisation": "Alpha Realty", "full_name": "Andy Anders", "categories": ["real_estate_sales"], "service_region": "Copper Coast"},
  {"organisation": "Alpha Realty", "full_name": "Amy Zed", "categories": ["real_estate_sales"], "service_region": "Copper Coast"},
  {"organisation": "Iota Co", "full_name": "New Email", "categories": ["other"], "service_region": "Copper Coast", "email": "ALICE@alpha.test"},
  {"organisation": "Kappa Co", "full_name": "Mary Ann Smith", "categories": ["accountant"], "service_region": "Adelaide"},
  {"organisation": "Kappa Co", "full_name": "John Smith", "categories": ["accountant"], "service_region": "Adelaide"},
  {"organisation": "Kappa Co", "full_name": "Smith", "categories": ["accountant"], "service_region": "Adelaide"},
  {"organisation": "Lambda Co", "full_name": "Cher", "categories": ["other"], "service_region": "Adelaide"},
  {"organisation": "Lambda Co", "full_name": "Cher", "categories": ["other"], "service_region": "Adelaide"}
]$j$::jsonb);
select pg_temp.unbecome();
select is(pg_temp.cls('rules', 1), 'new_organisation/create', 'rules: a new organisation (suffix and case ignored)');
select is(pg_temp.cls('rules', 2), 'possible_duplicate/skip', 'rules: same organisation (a different spelling) and surname, different first name: possible_duplicate');
select is(pg_temp.cls('rules', 3), 'duplicate/skip', 'rules: same organisation and the same name, however spelled: duplicate');
select is(pg_temp.cls('rules', 4), 'new_organisation/create', 'rules: a row with an email');
select is(pg_temp.cls('rules', 5), 'duplicate/skip', 'rules: the same email in a different organisation, later in the file: duplicate');
select is(pg_temp.cls('rules', 6), 'duplicate/skip', 'rules: an existing contact (Alice Anders at Alpha Realty): duplicate');
select is(pg_temp.cls('rules', 7), 'possible_duplicate/skip', 'rules: same existing organisation and surname as an existing contact: possible_duplicate');
select is(pg_temp.cls('rules', 8), 'new_contact/create', 'rules: a new contact at an existing organisation');
select is(pg_temp.cls('rules', 9), 'duplicate/skip', 'rules: the email of an existing contact (any organisation): duplicate');
select is(pg_temp.cls('rules', 10), 'new_organisation/create', 'rules: Mary Ann Smith');
select is(pg_temp.cls('rules', 11), 'possible_duplicate/skip', 'rules: the surname is the LAST name token (Mary Ann Smith ~ John Smith)');
select is(pg_temp.cls('rules', 12), 'new_contact/create', 'rules: a single-word name is not compared by surname');
select is(pg_temp.cls('rules', 13), 'new_organisation/create', 'rules: Cher');
select is(pg_temp.cls('rules', 14), 'duplicate/skip', 'rules: the same single-word name twice: duplicate');
select is((select e ->> 'reason' from jsonb_array_elements(pg_temp.res('rules') -> 'rows') e where (e ->> 'row')::int = 5), 'Same email as row 4 of this file', 'rules: a duplicate explains itself');

-- invalid rows are reported by the preview and refuse the whole file at apply
select pg_temp.become('bdm');
insert into zz_res select 'invalid', hq.preview_partner_import($j$[
  {"organisation": "", "full_name": "No Org", "categories": ["other"]},
  {"organisation": "Mu Co", "full_name": "Bad Category", "categories": ["wizard"]},
  {"organisation": "Mu Co", "full_name": "No Category", "categories": []},
  {"organisation": "Mu Co", "full_name": "Bad Email", "categories": ["other"], "email": "nope"},
  {"organisation": "Mu Co", "full_name": "Bad Flags", "categories": ["other"], "flags": "oops"},
  "not an object",
  {"organisation": "Nu Co", "full_name": "Fine Person", "categories": ["other"]}
]$j$::jsonb);
select pg_temp.unbecome();
select is((select array_agg(e ->> 'classification' order by (e ->> 'row')::int) from jsonb_array_elements(pg_temp.res('invalid') -> 'rows') e),
  array['invalid', 'invalid', 'invalid', 'invalid', 'invalid', 'invalid', 'new_organisation'], 'invalid rows are classified invalid (and the valid row is not affected)');
select is(pg_temp.counts_of('invalid') ->> 'invalid', '6', 'the preview counts the invalid rows');
select pg_temp.become('bdm');
select throws_ok($$select hq.apply_partner_import('[{"organisation": "Nu Co", "full_name": "Fine Person", "categories": ["other"]}, {"organisation": "Mu Co", "full_name": "Bad", "categories": ["wizard"]}]'::jsonb, 'bad-file')$$, '22023', null, 'apply refuses a file with an invalid row');
select throws_ok($$select hq.preview_partner_import('{"not": "an array"}'::jsonb)$$, '22023', null, 'rows must be a JSON array');
select throws_ok($$select hq.preview_partner_import('[]'::jsonb)$$, '22023', null, 'rows must not be empty');
select throws_ok($$select hq.apply_partner_import('[{"organisation": "Nu Co", "full_name": "Fine Person", "categories": ["other"]}]'::jsonb, '  ')$$, '22023', null, 'apply needs a source');
select pg_temp.unbecome();
select is((select count(*) from hq.organisations where name = 'Nu Co'), 0::bigint, 'a refused apply wrote nothing');

-- apply is transactional: a failure part-way through rolls the whole import back
create function public.zz_boom() returns trigger language plpgsql as $$ begin raise exception 'contact insert failed' using errcode = 'P0001'; end $$;
create trigger zz_boom before insert on hq.contacts for each row when (new.full_name = 'Bella Boom') execute function public.zz_boom();
select count(*) as batches1 from hq.import_batches \gset
select count(*) as orgs1 from hq.organisations \gset
select count(*) as audit1 from hq.audit_events \gset
select pg_temp.become('bdm');
select throws_ok($$select hq.apply_partner_import('[{"organisation": "Xi Co", "full_name": "Gary Good", "categories": ["other"]}, {"organisation": "Xi Co", "full_name": "Bella Boom", "categories": ["other"]}]'::jsonb, 'boom-file')$$,
  'P0001', 'contact insert failed', 'apply: a failure part-way raises');
select pg_temp.unbecome();
select is((select count(*) from hq.organisations where name = 'Xi Co'), 0::bigint, 'apply is transactional: the organisation created before the failure is rolled back');
select is((select count(*) from hq.contacts where full_name = 'Gary Good'), 0::bigint, 'apply is transactional: the contact created before the failure is rolled back');
select is((select count(*) from hq.import_batches), :batches1::bigint, 'apply is transactional: no import batch recorded');
select is((select count(*) from hq.audit_events), :audit1::bigint, 'apply is transactional: no audit rows kept');
drop trigger zz_boom on hq.contacts;
drop function public.zz_boom();

-- archived contacts do not block a re-import; an organisation with no live primary gets a new primary
select pg_temp.become('dir');
select hq.archive_record('contact', (select id from hq.contacts where full_name = 'Tim Hosking' and source = 'research-leads-2026-10'), 'test');
select pg_temp.unbecome();
select pg_temp.become('bdm');
insert into zz_res select 'archived', hq.apply_partner_import(jsonb_build_array(pg_temp.rows() -> 0), 'research-leads-2026-10', 'tim.json');
select pg_temp.unbecome();
select is(pg_temp.cls('archived', 1), 'new_contact/create', 'an archived contact is ignored: the same person is a new_contact again');
select is((select org_contact_role::text from hq.contacts where full_name = 'Tim Hosking' and deleted_at is null), 'primary', 'with no live primary left, the re-imported contact becomes primary');
insert into hq.organisations (name, categories) values ('Primaryless Co', '{other}');
select pg_temp.become('bdm');
select hq.apply_partner_import('[{"organisation": "Primaryless Co", "full_name": "Pia Primary", "categories": ["other"], "service_region": "Adelaide"}]'::jsonb, 'manual-file');
select pg_temp.unbecome();
select is((select org_contact_role::text from hq.contacts where full_name = 'Pia Primary'), 'primary', 'an existing organisation with no primary gets its imported contact as primary');
select is((select o.needs_verification from hq.organisations o where o.name = 'Primaryless Co'), false, 'an existing organisation is never modified by an import');

-- ------------------------------------------------------------ global_search
insert into hq.organisations (name, categories) values ('100% Pure Realty', '{other}'), ('ABC Realty', '{other}'), ('Back\Slash Realty', '{other}');
select pg_temp.become('dir');
select is((select array_agg(e ->> 'title') from jsonb_array_elements(hq.global_search('loan arranger') -> 'organisations') e), array['The Loan Arranger'], 'search: organisations by name (substring)');
select is((select array_agg(e ->> 'full_name' order by e ->> 'full_name') from jsonb_array_elements(hq.global_search('marshall') -> 'contacts') e), array['Scott Marshall', 'Steve Marshall'], 'search: contacts by surname');
select is((select e ->> 'organisation_name' || '|' || (e ->> 'subtitle') from jsonb_array_elements(hq.global_search('Scott') -> 'contacts') e limit 1), 'The Loan Arranger|The Loan Arranger', 'search: a contact result carries organisation_name and a subtitle');
select is((select array_agg(e ->> 'title') from jsonb_array_elements(hq.global_search('Hoskin') -> 'contacts') e), array['Tim Hosking'], 'search: prefix match on a partial name');
select is((select count(*) from jsonb_array_elements(hq.global_search('Hosking') -> 'contacts') e), 1::bigint, 'search: archived contacts are not found (Tim Hosking was archived and re-imported: one live row)');
select is((select array_agg(e ->> 'title') from jsonb_array_elements(hq.global_search('Hoskng') -> 'contacts') e), array['Tim Hosking'], 'search: a typo still finds it (pg_trgm similarity)');
select is((select array_agg(e ->> 'title') from jsonb_array_elements(hq.global_search('100%') -> 'organisations') e), array['100% Pure Realty'], 'search: a % in the query is matched literally');
select is(jsonb_array_length(hq.global_search('%%') -> 'organisations'), 0, 'search: a query of only % matches nothing (LIKE metacharacters are escaped)');
select is((select array_agg(e ->> 'title') from jsonb_array_elements(hq.global_search('a_c') -> 'organisations') e), null, 'search: an underscore is not a single-character wildcard (a_c does not find ABC)');
select is((select array_agg(e ->> 'title') from jsonb_array_elements(hq.global_search('k\s') -> 'organisations') e), array['Back\Slash Realty'], 'search: a backslash in the query is matched literally, never as an escape');
select is((select array_agg(e ->> 'title') from jsonb_array_elements(hq.global_search('Back\Slash') -> 'organisations') e), array['Back\Slash Realty'], 'search: a backslash is matched literally');
select is(hq.global_search('a') , '{"contacts": [], "organisations": [], "referrals": [], "tasks": [], "contractors": []}'::jsonb, 'search: a one-character query returns nothing');
select is(jsonb_array_length(hq.global_search('realty', 2) -> 'organisations'), 2, 'search: p_limit caps each list');
select is(hq.global_search('', 5), '{"contacts": [], "organisations": [], "referrals": [], "tasks": [], "contractors": []}'::jsonb, 'search: an empty query returns empty lists');
select pg_temp.keep('sr', hq.record_referral(p_direction := 'received', p_referring_contact := pg_temp.fx('alice'), p_prospect_name := 'Quentin Quokka'));
insert into hq.tasks (title, assigned_to) values ('Call Quentin about the appraisal', pg_temp.fx('dir'));
select is((select array_agg(e ->> 'prospect_name') from jsonb_array_elements(hq.global_search('quokka') -> 'referrals') e), array['Quentin Quokka'], 'search: referrals by prospect name');
select ok(jsonb_array_length(hq.global_search('REF-0') -> 'referrals') > 0, 'search: referrals by REF- label');
select is((select array_agg(e ->> 'title') from jsonb_array_elements(hq.global_search('appraisal') -> 'tasks') e), array['Call Quentin about the appraisal'], 'search: tasks by title');
select pg_temp.unbecome();
-- RLS decides what each person finds
select pg_temp.become('jpm');
select is(hq.global_search('loan') , '{"contacts": [], "organisations": [], "referrals": [], "tasks": [], "contractors": []}'::jsonb, 'search as a junior: no partners, referrals or others'' tasks (RLS)');
insert into hq.tasks (title, assigned_to) values ('Call Quentin from the junior desk', pg_temp.fx('jpm'));
select is((select array_agg(e ->> 'title') from jsonb_array_elements(hq.global_search('quentin') -> 'tasks') e), array['Call Quentin from the junior desk'], 'search as a junior: only their own task');
select pg_temp.become('pm');
select is((select count(*) from jsonb_array_elements(hq.global_search('loan') -> 'organisations') e), 2::bigint, 'search as a property manager (growth.read): partners are found');
select is((select array_agg(e ->> 'title') from jsonb_array_elements(hq.global_search('quentin') -> 'tasks') e), null, 'search as a property manager: tasks they cannot see are not found');
select pg_temp.unbecome();

-- ------------------------------------------------------------ timezone: dates follow hq.settings.timezone
select pg_temp.become('bdm');
select pg_temp.keep('tz', hq.record_referral(p_direction := 'received', p_referring_organisation := pg_temp.fx('alpha'), p_prospect_name := 'Tz Prospect'));
select hq.move_opportunity(pg_temp.fx('tz_opportunity_id'), 'management_signed', null, timestamptz '2026-10-15 20:00:00+00');
select is((hq.growth_summary(date '2026-10-16') ->> 'managements_signed')::int, 1, 'timezone: 20:00 UTC on the 15th is the 16th in Adelaide, so it counts since the 16th');
select is((hq.growth_summary(date '2026-10-17') ->> 'managements_signed')::int, 0, 'timezone: ... and does not count since the 17th');
select pg_temp.become('dir');
update hq.settings set value = '"Pacific/Kiritimati"'::jsonb where key = 'timezone';
select is(hq.today(), (now() at time zone 'Pacific/Kiritimati')::date, 'hq.today() follows settings.timezone');
select is((hq.growth_summary(date '2026-10-16') ->> 'managements_signed')::int, 1, 'timezone: Kiritimati (UTC+14) also puts it on the 16th');
update hq.settings set value = '"Etc/GMT+12"'::jsonb where key = 'timezone';
select is(hq.today(), (now() at time zone 'Etc/GMT+12')::date, 'hq.today() follows a changed timezone');
select is((hq.growth_summary(date '2026-10-16') ->> 'managements_signed')::int, 0, 'timezone: UTC-12 puts the signing on the 15th, so it does not count since the 16th');
update hq.settings set value = '"Australia/Adelaide"'::jsonb where key = 'timezone';
select pg_temp.unbecome();

select * from finish();
rollback;
