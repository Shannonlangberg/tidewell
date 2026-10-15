-- Planted HQ Phase 2: the contractor import (preview writes nothing, apply is transactional and
-- idempotent, a duplicate name is skipped, possible duplicates by ABN / email / phone / similar name
-- with the confirm_distinct override, invalid rows refuse the file), the 31 maintenance prospects of
-- hq/seed/maintenance-contractors.json (embedded below, not read from SQL), and global_search over
-- contractors.
begin;
\ir hq_fixture.inc
\ir hq_contractor_fixture.inc
select pg_temp.seed_hq();
select pg_temp.seed_contractors();
select plan(64);

create temp table zz_rows (rows jsonb not null) on commit drop;
grant select on zz_rows to public;
insert into zz_rows values ($rows$[{"business_name":"Copper Coast Plumbing","categories":["plumbing"]},{"business_name":"Peninsula Plumbing SA","categories":["plumbing"]},{"business_name":"Bennett & Co Industries","categories":["plumbing"]},{"business_name":"Dean Trevor Todd","categories":["plumbing"],"flags":["Reads like a person's name rather than a business name. Imported exactly as listed; confirm the trading name before contacting."]},{"business_name":"Moonta Plumbing","categories":["plumbing"]},{"business_name":"Mildwaters Electrical","categories":["electrical"]},{"business_name":"Electrical NRG Solutions","categories":["electrical"]},{"business_name":"Lamshed Electrical","categories":["electrical"]},{"business_name":"Baden Napier Electrical & Solar","categories":["electrical"]},{"business_name":"AH Electrical & Solar","categories":["electrical"]},{"business_name":"BradZ Electrical","categories":["electrical"]},{"business_name":"WJC Electrical","categories":["electrical"]},{"business_name":"Copper Coast Property Maintenance","categories":["general_maintenance"]},{"business_name":"Challenge Garden & Home Maintenance","categories":["general_maintenance"]},{"business_name":"Bungendore Handyman Service","categories":["general_maintenance"]},{"business_name":"Copper Coast Garden Care","categories":["general_maintenance"]},{"business_name":"TC Constructions","categories":["general_maintenance"]},{"business_name":"Northern York Peninsula Cleaning","categories":["cleaning"]},{"business_name":"Hamiltons Pest & Weed Control","categories":["pest_control"]},{"business_name":"Laidlaw Pest Control","categories":["pest_control"]},{"business_name":"SMS Eco Pest Management","categories":["pest_control"]},{"business_name":"Murray Pest Control Yorke Peninsula","categories":["pest_control"]},{"business_name":"Yorke Peninsula Locksmiths","categories":["locksmith"]},{"business_name":"Leaney The Locksmith","categories":["locksmith"]},{"business_name":"YP Energy Solutions","categories":["other"]},{"business_name":"Kadina Retravision","categories":["other"]},{"business_name":"Inside and Out Painting","categories":["other"]},{"business_name":"Yorkes Home Improvements","categories":["other"]},{"business_name":"Peninsula Tree and Stump","categories":["other"]},{"business_name":"Copper Coast Garage Doors","categories":["other"]},{"business_name":"Roof Replacement and Gutters SA","categories":["other"]}]$rows$::jsonb);
create function pg_temp.rows() returns jsonb language sql stable as $$ select rows from zz_rows $$;

create temp table zz_res (k text primary key, v jsonb not null) on commit drop;
grant select, insert on zz_res to public;
create function pg_temp.res(p_key text) returns jsonb language sql stable as $$ select v from zz_res where k = p_key $$;
create function pg_temp.cls(p_key text, p_row integer) returns text language sql stable as $$
  select (e ->> 'classification') || '/' || (e ->> 'action')
  from jsonb_array_elements(pg_temp.res(p_key) -> 'rows') e where (e ->> 'row')::integer = p_row $$;
create function pg_temp.reason(p_key text, p_row integer) returns text language sql stable as $$
  select e ->> 'reason' from jsonb_array_elements(pg_temp.res(p_key) -> 'rows') e where (e ->> 'row')::integer = p_row $$;
create function pg_temp.counts_of(p_key text) returns jsonb language sql stable as $$ select pg_temp.res(p_key) -> 'counts' $$;
create function pg_temp.live(p_source text) returns bigint language sql stable as $$
  select count(*) from hq.contractors where source = p_source and deleted_at is null $$;

-- ------------------------------------------------------------ preview: classification, nothing written
select count(*) as contractors0 from hq.contractors \gset
select count(*) as steps0 from hq.contractor_vetting_steps \gset
select count(*) as batches0 from hq.import_batches \gset
select count(*) as audit0 from hq.audit_events \gset
select pg_temp.become('dir');
insert into zz_res select 'preview1', hq.preview_contractor_import(pg_temp.rows());
select pg_temp.unbecome();
select is(jsonb_array_length(pg_temp.rows()), 31, 'the maintenance prospects file has 31 rows');
select is(pg_temp.counts_of('preview1'),
  '{"rows": 31, "new_contractor": 31, "duplicate": 0, "possible_duplicate": 0, "invalid": 0, "contractors_created": 31, "skipped": 0, "flagged": 1}'::jsonb,
  'preview: 31 new contractors, no duplicates, one flagged row (Dean Trevor Todd)');
select is((select count(*) from jsonb_array_elements(pg_temp.res('preview1') -> 'rows') e where e ->> 'classification' = 'new_contractor' and e ->> 'action' = 'create'), 31::bigint,
  'preview: every row is new_contractor / create');
select is((select e ->> 'flagged' from jsonb_array_elements(pg_temp.res('preview1') -> 'rows') e where e ->> 'business_name' = 'Dean Trevor Todd'), 'true', 'preview: Dean Trevor Todd is flagged for review');
select is((select count(*) from hq.contractors), :contractors0::bigint, 'PREVIEW WROTE NOTHING: no contractor');
select is((select count(*) from hq.contractor_vetting_steps), :steps0::bigint, 'preview wrote no vetting step');
select is((select count(*) from hq.import_batches), :batches0::bigint, 'preview wrote no import batch');
select is((select count(*) from hq.audit_events), :audit0::bigint, 'preview wrote no audit event');

-- ------------------------------------------------------------ apply
select pg_temp.become('dir');
insert into zz_res select 'apply1', hq.apply_contractor_import(pg_temp.rows(), 'research-maintenance-2026-10', 'maintenance-contractors.json');
select pg_temp.unbecome();
select is(pg_temp.counts_of('apply1'), pg_temp.counts_of('preview1'), 'apply: the counts equal the preview''s');
select is(pg_temp.res('apply1') -> 'rows', pg_temp.res('preview1') -> 'rows', 'apply: the per-row classification AGREES EXACTLY with the preview');
select is(pg_temp.live('research-maintenance-2026-10'), 31::bigint, 'apply: 31 contractors created');
select is((select count(*) from hq.contractors where source = 'research-maintenance-2026-10' and deleted_at is null and (status <> 'prospect' or not needs_verification)), 0::bigint,
  'apply: every imported contractor is a prospect that needs verification');
select is((select count(*) from hq.contractors where source = 'research-maintenance-2026-10' and deleted_at is null and (
            primary_contact_name is not null or phone is not null or email is not null or website is not null or abn is not null
            or cardinality(service_suburbs) > 0 or cardinality(service_regions) > 0 or emergency_available is not null or business_hours is not null
            or hourly_rate_cents is not null or callout_fee_cents is not null or after_hours_fee_cents is not null or minimum_charge_cents is not null
            or invoice_terms is not null or licence_details is not null or licence_expires_on is not null or licence_verified_at is not null
            or insurance_details is not null or insurance_expires_on is not null or insurance_verified_at is not null or relationship_owner_id is not null
            or last_job_date is not null or verified_at is not null or approved_at is not null or external_ids <> '{}'::jsonb)), 0::bigint,
  'apply: NOTHING IS INVENTED (no phone, email, ABN, licence, insurance, availability, service area, rate, owner or date)');
select is((select jsonb_object_agg(k, n order by k) from (select c::text as k, count(*) as n from hq.contractors, unnest(categories) c
            where source = 'research-maintenance-2026-10' and deleted_at is null group by 1) x),
  '{"cleaning": 1, "electrical": 7, "general_maintenance": 5, "locksmith": 2, "other": 7, "pest_control": 4, "plumbing": 5}'::jsonb,
  'apply: categories come only from the group headings (seven under Other)');
select is((select count(*) from hq.contractors where source = 'research-maintenance-2026-10' and deleted_at is null and cardinality(categories) <> 1), 0::bigint, 'apply: one category per prospect');
select is((select categories::text from hq.contractors where business_name = 'Inside and Out Painting' and deleted_at is null), '{other}', 'apply: no trade is inferred from a name (Inside and Out Painting is other)');
select is((select internal_notes from hq.contractors where business_name = 'Dean Trevor Todd' and deleted_at is null),
  'Verify: Reads like a person''s name rather than a business name. Imported exactly as listed; confirm the trading name before contacting.', 'apply: the Dean Trevor Todd flag is kept in internal_notes');
select is((select count(*) from hq.contractors where source = 'research-maintenance-2026-10' and deleted_at is null and internal_notes is not null), 1::bigint, 'apply: no other prospect carries a note');
select is((select count(*) from hq.contractor_vetting_steps s join hq.contractors c on c.id = s.contractor_id where c.source = 'research-maintenance-2026-10' and c.deleted_at is null and s.status = 'not_started'),
  279::bigint, 'apply: each prospect has its nine vetting steps, not started (31 x 9)');
select is((select count(*) from hq.contractor_status_history h join hq.contractors c on c.id = h.contractor_id where c.source = 'research-maintenance-2026-10' and c.deleted_at is null and h.from_status is null and h.to_status = 'prospect'),
  31::bigint, 'apply: each prospect has one history row (to prospect)');
select is((select row(kind, source, file_name, row_count, contractors_created, organisations_created, contacts_created, duplicates_skipped, flagged, applied_by)::text
           from hq.import_batches where id = (pg_temp.res('apply1') ->> 'batch_id')::uuid),
  row('contractor', 'research-maintenance-2026-10', 'maintenance-contractors.json', 31, 31, 0, 0, 0, 1, pg_temp.fx('dir'))::text, 'apply: an import_batches row (kind contractor) records the counts and who applied it');
select is((select (changes ->> 'contractors_created') || '|' || actor_id::text from hq.audit_events where action = 'import' and entity_id = (pg_temp.res('apply1') ->> 'batch_id')::uuid),
  '31|' || pg_temp.fx('dir'), 'apply: an import audit event is written by the person who applied it');
select is((select count(*) from hq.audit_events where entity_type = 'contractor' and action = 'create' and actor_id = pg_temp.fx('dir')
            and entity_id in (select id from hq.contractors where source = 'research-maintenance-2026-10')), 31::bigint, 'apply: each created contractor is audited');

-- ------------------------------------------------------------ idempotent: the same file twice creates nothing the second time
select pg_temp.become('dir');
insert into zz_res select 'preview2', hq.preview_contractor_import(pg_temp.rows());
insert into zz_res select 'apply2', hq.apply_contractor_import(pg_temp.rows(), 'research-maintenance-2026-10', 'maintenance-contractors.json');
select pg_temp.unbecome();
select is(pg_temp.counts_of('apply2'),
  '{"rows": 31, "new_contractor": 0, "duplicate": 31, "possible_duplicate": 0, "invalid": 0, "contractors_created": 0, "skipped": 31, "flagged": 1}'::jsonb,
  'apply twice: the second run creates nothing (31 duplicates, skipped)');
select is(pg_temp.res('apply2') -> 'rows', pg_temp.res('preview2') -> 'rows', 'the re-run preview and apply agree exactly too');
select is(pg_temp.live('research-maintenance-2026-10'), 31::bigint, 'apply twice: still 31 contractors');
select is(pg_temp.reason('apply2', 1), 'Same name as an existing contractor (Copper Coast Plumbing)', 'a duplicate explains itself');

-- ------------------------------------------------------------ duplicates and possible duplicates
update hq.contractors set abn = '51824753556' where business_name = 'Moonta Plumbing' and deleted_at is null;
update hq.contractors set email = 'office@contractor.test' where business_name = 'Lamshed Electrical' and deleted_at is null;
update hq.contractors set phone = '0400 000 000' where business_name = 'Laidlaw Pest Control' and deleted_at is null;
select pg_temp.become('dir');
insert into zz_res select 'rules', hq.preview_contractor_import($j$[
  {"business_name": "The Copper Coast Plumbing Pty Ltd", "categories": ["plumbing"]},
  {"business_name": "Copper Coast Plumbers", "categories": ["plumbing"]},
  {"business_name": "Completely Unrelated Trading", "categories": ["other"], "abn": "51 824 753 556"},
  {"business_name": "Another Unrelated Trading", "categories": ["other"], "email": "OFFICE@contractor.test"},
  {"business_name": "Third Unrelated Trading", "categories": ["other"], "phone": "+61 400 000 000"},
  {"business_name": "Brand New Glaziers", "categories": ["glazing"], "primary_contact_name": "Test Contact Person", "service_suburbs": ["Moonta", " moonta "]},
  {"business_name": "Brand New Glaziers", "categories": ["glazing"]},
  {"business_name": "Brand New Glazier", "categories": ["glazing"]},
  {"business_name": "Copper Coast Plumbers", "categories": ["plumbing"], "confirm_distinct": true}
]$j$::jsonb);
select pg_temp.unbecome();
select is(pg_temp.cls('rules', 1), 'duplicate/skip', 'a DUPLICATE NAME (another spelling of an existing contractor) is skipped');
select is(pg_temp.cls('rules', 2), 'possible_duplicate/skip', 'a very similar name is a possible duplicate, skipped');
select ok(pg_temp.reason('rules', 2) like 'A very similar name to an existing contractor (Copper Coast Plumbing)%', '... and says which contractor it resembles');
select is(pg_temp.cls('rules', 3), 'possible_duplicate/skip', 'the same ABN (typed with spaces) is a possible duplicate');
select ok(pg_temp.reason('rules', 3) like 'Same ABN as an existing contractor (Moonta Plumbing)%', '... reported as the same ABN');
select is(pg_temp.cls('rules', 4), 'possible_duplicate/skip', 'the same email (any case) is a possible duplicate');
select is(pg_temp.cls('rules', 5), 'possible_duplicate/skip', 'the same phone (+61 read as 0) is a possible duplicate');
select is(pg_temp.cls('rules', 6), 'new_contractor/create', 'a genuinely new contractor');
select is(pg_temp.cls('rules', 7), 'duplicate/skip', 'the same name later in the same file is a duplicate of that row');
select is((select e ->> 'match_row' from jsonb_array_elements(pg_temp.res('rules') -> 'rows') e where (e ->> 'row')::int = 8), '6', 'a near-identical name later in the file is matched to its row');
select is(pg_temp.cls('rules', 8), 'possible_duplicate/skip', '... as a possible duplicate');
select is(pg_temp.cls('rules', 9), 'possible_duplicate/create', 'confirm_distinct: still reported as a possible duplicate, but created');
select pg_temp.become('dir');
insert into zz_res select 'rules_apply', hq.apply_contractor_import((select jsonb_agg(e) from jsonb_array_elements($j$[
  {"business_name": "Brand New Glaziers", "categories": ["glazing", "glazing", "building"], "primary_contact_name": "Test Contact Person", "service_suburbs": ["Moonta", " moonta "]},
  {"business_name": "Copper Coast Plumbers", "categories": ["plumbing"], "confirm_distinct": true}
]$j$::jsonb) e), 'manual-entry', 'two.json');
select pg_temp.unbecome();
select is((pg_temp.counts_of('rules_apply') ->> 'contractors_created')::int, 2, 'confirm_distinct: the confirmed row is created');
select is((select categories::text || '|' || primary_contact_name || '|' || array_to_string(service_suburbs, ',') || '|' || status::text || '|' || needs_verification::text
           from hq.contractors where business_name = 'Brand New Glaziers' and deleted_at is null),
  '{glazing,building}|Test Contact Person|Moonta|prospect|true', 'supplied fields are kept (categories without repeats, suburbs tidied); still prospect and needs verification');

-- ------------------------------------------------------------ invalid rows: reported by the preview, refuse the file at apply
select pg_temp.become('dir');
insert into zz_res select 'invalid', hq.preview_contractor_import($j$[
  {"business_name": "", "categories": ["other"]},
  {"business_name": "Bad Category Co", "categories": ["wizardry"]},
  {"business_name": "No Category Co", "categories": []},
  {"business_name": "Status Vetting Co", "categories": ["other"], "status": "vetting"},
  {"business_name": "Status Preferred Co", "categories": ["other"], "status": "preferred"},
  {"business_name": "Verified Already Co", "categories": ["other"], "needs_verification": false},
  {"business_name": "Bad Abn Co", "categories": ["other"], "abn": "51 824 753 557"},
  {"business_name": "Bad Email Co", "categories": ["other"], "email": "nope"},
  {"business_name": "Bad Flags Co", "categories": ["other"], "flags": "oops"},
  {"business_name": "Bad Suburbs Co", "categories": ["other"], "service_suburbs": "Moonta"},
  "not an object",
  {"business_name": "Explicit Prospect Co", "categories": ["other"], "status": "prospect", "needs_verification": true}
]$j$::jsonb);
select pg_temp.unbecome();
select is((select array_agg(e ->> 'classification' order by (e ->> 'row')::int) from jsonb_array_elements(pg_temp.res('invalid') -> 'rows') e),
  array['invalid', 'invalid', 'invalid', 'invalid', 'invalid', 'invalid', 'invalid', 'invalid', 'invalid', 'invalid', 'invalid', 'new_contractor'],
  'malformed rows (including any status but prospect, or needs_verification false) are invalid; the valid row is not affected');
select is(pg_temp.reason('invalid', 5), 'imported contractors are always prospects; a status cannot be imported', 'an imported status is explained');
select is(pg_temp.reason('invalid', 7), 'the ABN is not valid (11 digits that pass the ATO checksum)', 'an invalid ABN is explained');
select pg_temp.become('dir');
select throws_ok($$select hq.apply_contractor_import('[{"business_name": "Fine Co", "categories": ["other"]}, {"business_name": "Bad Co", "categories": ["wizardry"]}]'::jsonb, 'bad-file')$$,
  '22023', null, 'apply refuses a file with an invalid row');
select throws_ok($$select hq.preview_contractor_import('{"not": "an array"}'::jsonb)$$, '22023', null, 'rows must be a JSON array');
select throws_ok($$select hq.preview_contractor_import('[]'::jsonb)$$, '22023', null, 'rows must not be empty');
select throws_ok($$select hq.apply_contractor_import('[{"business_name": "Fine Co", "categories": ["other"]}]'::jsonb, '  ')$$, '22023', null, 'apply needs a source');
select pg_temp.unbecome();
select is((select count(*) from hq.contractors where business_name = 'Fine Co'), 0::bigint, 'a refused apply wrote nothing');

-- apply is transactional: a failure part-way through rolls the whole import back
create function public.zz_boom() returns trigger language plpgsql as $$ begin raise exception 'contractor insert failed' using errcode = 'P0001'; end $$;
create trigger zz_boom before insert on hq.contractors for each row when (new.business_name = 'Boom Co') execute function public.zz_boom();
select count(*) as batches1 from hq.import_batches \gset
select count(*) as audit1 from hq.audit_events \gset
select pg_temp.become('dir');
select throws_ok($$select hq.apply_contractor_import('[{"business_name": "Before Boom Co", "categories": ["other"]}, {"business_name": "Boom Co", "categories": ["other"]}]'::jsonb, 'boom-file')$$,
  'P0001', 'contractor insert failed', 'apply: a failure part-way raises');
select pg_temp.unbecome();
select is((select count(*) from hq.contractors where business_name = 'Before Boom Co'), 0::bigint, 'apply is transactional: the contractor created before the failure is rolled back');
select is((select count(*) from hq.contractor_vetting_steps s join hq.contractors c on c.id = s.contractor_id where c.business_name = 'Before Boom Co'), 0::bigint, '... with its vetting steps');
select is((select count(*) from hq.import_batches), :batches1::bigint, 'apply is transactional: no import batch recorded');
select is((select count(*) from hq.audit_events), :audit1::bigint, 'apply is transactional: no audit rows kept');
drop trigger zz_boom on hq.contractors;
drop function public.zz_boom();

-- an archived contractor does not block a re-import of the same name
select pg_temp.become('dir');
select hq.archive_record('contractor', (select id from hq.contractors where business_name = 'Kadina Retravision' and deleted_at is null), 'test');
insert into zz_res select 'archived', hq.apply_contractor_import((select jsonb_agg(e) from jsonb_array_elements(pg_temp.rows()) e where e ->> 'business_name' = 'Kadina Retravision'),
  'research-maintenance-2026-10', 'kadina.json');
select pg_temp.unbecome();
select is(pg_temp.cls('archived', 1), 'new_contractor/create', 'an archived contractor is ignored: the same name is new again');
select is(pg_temp.live('research-maintenance-2026-10'), 31::bigint, 'still 31 live prospects');

-- ------------------------------------------------------------ global_search: contractors
select pg_temp.mk_contractor('arbor', 'Arbor Works Co', '{tree_services}');
update hq.contractors set service_suburbs = '{Wallaroo,Port Hughes}' where id = pg_temp.fx('arbor');
update hq.contractors set primary_contact_name = 'Test Person Alpha' where id = pg_temp.fx('c_spark');
select pg_temp.become('jpm');
select is((select array_agg(t order by t) from (select e ->> 'title' as t from jsonb_array_elements(hq.global_search('Copper Coast Plumb') -> 'contractors') with ordinality as x(e, n) where n <= 2) y),
  array['Copper Coast Plumbers', 'Copper Coast Plumbing'], 'search: contractors by business name (prefix matches rank first, fuzzy matches follow)');
select is((select array_agg(e ->> 'title') from jsonb_array_elements(hq.global_search('tree services') -> 'contractors') e), array['Arbor Works Co'], 'search: by trade label (tree_services read as "tree services")');
select is((select array_agg(e ->> 'title') from jsonb_array_elements(hq.global_search('Hughes') -> 'contractors') e), array['Arbor Works Co'], 'search: by service suburb');
select is((select array_agg(e ->> 'title') from jsonb_array_elements(hq.global_search('Person Alpha') -> 'contractors') e), array['Test Sparks Co'], 'search: by primary contact');
select is((select e - 'id' from jsonb_array_elements(hq.global_search('Test Plumbing') -> 'contractors') e limit 1),
  '{"title": "Test Plumbing Co", "business_name": "Test Plumbing Co", "status": "prospect", "categories": ["plumbing"], "primary_contact_name": null, "subtitle": "Plumbing - Moonta, Kadina - prospect"}'::jsonb,
  'search: a contractor result carries title, business_name, status, categories, primary_contact_name and a subtitle (trade labels from hq.trades)');
select is(jsonb_array_length(hq.global_search('pest control', 2) -> 'contractors'), 2, 'search: p_limit caps the contractor list');
select ok(hq.global_search('ab') ? 'contractors' and hq.global_search('a') ? 'contractors', 'search: the contractors key is always present');
select pg_temp.unbecome();
select pg_temp.become('dir');
select hq.archive_record('contractor', pg_temp.fx('arbor'), 'test');
select is(hq.global_search('Arbor') -> 'contractors', '[]'::jsonb, 'search: an archived contractor is not found');
select pg_temp.unbecome();

select * from finish();
rollback;
