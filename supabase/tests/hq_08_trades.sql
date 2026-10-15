-- Planted HQ: trades (hq.trades, migration 0123) and "record a job" (hq.mark_contractor_used).
-- Structure and security, the seeded 22 trades, forged callers (anon, non-staff, aal1, read_only,
-- junior for writes, a writer without approve for archiving), slug derivation, uniqueness and
-- immutability, rename / describe / reorder, archive refused while in use and allowed when empty,
-- contractor writes limited to current trades (archived slugs kept on existing rows), the conversion
-- from the old enum on fixture rows, import / search / summary with custom trades, and the
-- never-backwards rule for the last job date.
--
-- NOTE: never CALL a function a hint role lacks execute on (see hq_01). Every RPC here is granted to
-- authenticated; anon is refused at the schema.
begin;
\ir hq_fixture.inc
\ir hq_contractor_fixture.inc
select pg_temp.seed_hq();
select pg_temp.seed_contractors();
select plan(124);

create function pg_temp.trade(p_slug text) returns hq.trades
language sql stable as $$ select t.* from hq.trades t where t.slug = p_slug $$;
create function pg_temp.tid(p_slug text) returns uuid
language sql stable as $$ select t.id from hq.trades t where t.slug = p_slug $$;
create temp table zz_r (k text primary key, v jsonb) on commit drop;
grant select, insert on zz_r to public;
create function pg_temp.r(p_k text) returns jsonb language sql stable as $$ select v from zz_r where k = p_k $$;

-- ------------------------------------------------------------ structure and security
select has_table('hq', 'trades', 'hq.trades exists');
select columns_are('hq', 'trades', array['id', 'slug', 'label', 'description', 'sort_order', 'is_active', 'archived_at', 'archived_by', 'created_at', 'updated_at', 'created_by', 'updated_by']);
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'hq.trades'::regclass), 'RLS is enabled and forced on trades');
select policies_are('hq', 'trades', array['trades_select'], 'trades: one select policy, nothing else');
select ok((select qual from pg_policies where schemaname = 'hq' and tablename = 'trades' and policyname = 'trades_select') like '%has_capability(''contractors.read''%', 'reading trades needs contractors.read');
select table_privs_are('hq', 'trades', 'authenticated', array['SELECT'], 'trades: authenticated can only select (written by RPC)');
select table_privs_are('hq', 'trades', 'service_role', array['SELECT'], 'trades: service_role can only select');
select ok(not has_table_privilege('anon', 'hq.trades', 'select,insert,update,delete,truncate'), 'anon holds no privilege on trades');
select is((select count(*) from pg_constraint where conrelid = 'hq.trades'::regclass and conname = 'trades_slug_key' and contype = 'u'), 1::bigint, 'slugs are unique (archived ones included)');
select ok((select indexdef from pg_indexes where schemaname = 'hq' and indexname = 'trades_label_uq') ~ 'UNIQUE.*lower\(label\)', 'labels are unique ignoring case');

create temp table zz_rpcs (sig regprocedure primary key) on commit drop;
insert into zz_rpcs values ('hq.create_trade(text, text)'), ('hq.update_trade(uuid, text, text, integer)'), ('hq.move_trade(uuid, text)'),
  ('hq.set_trade_active(uuid, boolean, text)'), ('hq.mark_contractor_used(uuid, date, boolean)');
select is((select count(*) from zz_rpcs where has_function_privilege('authenticated', sig, 'execute')), 5::bigint, 'authenticated can execute the five new RPCs');
select is((select count(*) from zz_rpcs where has_function_privilege('anon', sig, 'execute') or has_function_privilege('service_role', sig, 'execute')), 0::bigint, 'anon and service_role can execute none of them');
select is((select count(*) from zz_rpcs z join pg_proc p on p.oid = z.sig where p.prosecdef and p.proconfig::text like '%search_path=pg_catalog, public, extensions%'), 5::bigint, 'all five are security definer with a pinned search_path');
select is((select count(*) from pg_proc p where p.pronamespace = 'hq_private'::regnamespace
            and p.proname in ('trade_slug_base', 'trade_unique_slug', 'trade_clean_label', 'trade_check_label', 'trade_json', 'trade_guard', 'contractor_trades_guard')
            and has_function_privilege('authenticated', p.oid, 'execute')), 0::bigint, 'the trade helpers and guards are not executable by authenticated');
select is((select count(*) from pg_type where typname = 'contractor_category'), 0::bigint, 'the enum hq.contractor_category is gone');
select is((select count(*) from pg_proc p where p.pronamespace in ('hq'::regnamespace, 'hq_private'::regnamespace) and p.prosrc like '%contractor_category%'), 0::bigint, 'no function still names the old enum');
select ok(exists (select 1 from information_schema.columns where table_schema = 'hq' and table_name = 'contractor_directory' and column_name = 'trade_labels'), 'contractor_directory carries trade_labels');
select ok(has_column_privilege('authenticated', 'hq.contractors', 'categories', 'update') and has_column_privilege('authenticated', 'hq.contractors', 'categories', 'insert'), 'categories is still writable directly (the conversion kept the column grants)');

-- ------------------------------------------------------------ the seed
select is((select count(*) from hq.trades), 22::bigint, '22 trades seeded');
select is((select count(*) from hq.trades where is_active), 22::bigint, 'all active');
select is((select label from hq.trades where slug = 'air_conditioning'), 'Air conditioning', 'a seeded label is a clean display name');
select is((select array_agg(slug order by sort_order) from hq.trades where sort_order <= 30), array['plumbing', 'electrical', 'general_maintenance'], 'seeded in the old enum order');
select is((select count(*) from hq.trades where description is not null), 0::bigint, 'no description is invented');

-- ------------------------------------------------------------ the conversion logic, on fixture rows
create type public.zz_old_cat as enum ('plumbing', 'electrical', 'air_conditioning', 'other', 'tree_services');
create table public.zz_conv (id integer primary key, categories public.zz_old_cat[] not null);
insert into public.zz_conv values (1, '{plumbing}'), (2, '{electrical,air_conditioning,other}'), (3, '{tree_services,plumbing}');
create table public.zz_conv_before as select id, categories::text as txt from public.zz_conv;
alter table public.zz_conv alter column categories type text[] using categories::text[];
select is((select count(*) from public.zz_conv c join public.zz_conv_before b using (id) where c.categories::text = b.txt), 3::bigint, 'conversion: every row keeps its values, in order');
select is((select categories from public.zz_conv where id = 2), array['electrical', 'air_conditioning', 'other'], 'conversion: a multi-trade row is intact');
select is((select count(*) from public.zz_conv c, unnest(c.categories) k where k not in (select slug from hq.trades)), 0::bigint, 'conversion: every converted value is a trade slug');

-- ------------------------------------------------------------ slug derivation (pure)
select is(hq_private.trade_slug_base('Solar & Batteries'), 'solar_and_batteries', 'slug: & reads as and, spaces become _');
select is(hq_private.trade_slug_base('  Air-Con / Heating!! '), 'air_con_heating', 'slug: punctuation collapses to one _, ends trimmed');
select is(hq_private.trade_slug_base('24/7 Call-outs'), 't_24_7_call_outs', 'slug: a leading digit gets t_');
select is(hq_private.trade_slug_base('!!!'), 'trade', 'slug: nothing left gives "trade"');
select ok((select char_length(s) <= 40 and s !~ '_$' from hq_private.trade_slug_base(repeat('Long name ', 20)) s), 'slug: at most 40 characters, never ending in _');

-- ------------------------------------------------------------ anon, non-staff, aal1
select pg_temp.become_anon();
select throws_ok('select 1 from hq.trades', '42501', null, 'anon is denied on hq.trades');
select throws_ok($$select hq.create_trade('Anon Trade')$$, '42501', null, 'anon cannot create a trade');
select pg_temp.unbecome();

select pg_temp.become('outsider');
select is((select count(*) from hq.trades), 0::bigint, 'non-staff: reads no trade');
select throws_ok($$select hq.create_trade('Outsider Trade')$$, '42501', null, 'non-staff cannot create a trade');
select throws_ok(format($$select hq.update_trade(%L, 'Hacked')$$, pg_temp.tid('plumbing')), '42501', null, 'non-staff cannot rename a trade');
select throws_ok(format($$select hq.set_trade_active(%L, false)$$, pg_temp.tid('roofing')), '42501', null, 'non-staff cannot archive a trade');
select throws_ok(format($$select hq.mark_contractor_used(%L)$$, pg_temp.fx('c_plumb')), '42501', null, 'non-staff cannot record a job');
select pg_temp.unbecome();

select pg_temp.become('dir', 'aal1');
select is((select count(*) from hq.trades), 0::bigint, 'aal1 under require_mfa: reads no trade');
select throws_ok($$select hq.create_trade('Aal1 Trade')$$, '42501', null, 'aal1 under require_mfa: cannot create a trade');
select pg_temp.unbecome();

-- ------------------------------------------------------------ read_only and junior: read, never write
select pg_temp.become('ro');
select is((select count(*) from hq.trades), 22::bigint, 'read_only reads every trade');
select throws_ok($$select hq.create_trade('Ro Trade')$$, '42501', null, 'read_only cannot create a trade');
select throws_ok(format($$select hq.update_trade(%L, 'Plumbers')$$, pg_temp.tid('plumbing')), '42501', null, 'read_only cannot rename a trade');
select throws_ok(format($$select hq.move_trade(%L, 'down')$$, pg_temp.tid('plumbing')), '42501', null, 'read_only cannot reorder');
select throws_ok(format($$select hq.set_trade_active(%L, false)$$, pg_temp.tid('roofing')), '42501', null, 'read_only cannot archive');
select throws_ok(format($$select hq.mark_contractor_used(%L)$$, pg_temp.fx('c_plumb')), '42501', null, 'read_only cannot record a job');
select throws_ok($$insert into hq.trades (slug, label) values ('forged', 'Forged')$$, '42501', null, 'read_only cannot insert a trade directly');
select pg_temp.unbecome();

select pg_temp.become('jpm');
select is((select count(*) from hq.trades), 22::bigint, 'junior reads every trade');
select throws_ok($$select hq.create_trade('Junior Trade')$$, '42501', null, 'junior cannot create a trade');
select throws_ok(format($$select hq.update_trade(%L, null, 'desc')$$, pg_temp.tid('plumbing')), '42501', null, 'junior cannot describe a trade');
select throws_ok(format($$select hq.move_trade(%L, 'up')$$, pg_temp.tid('electrical')), '42501', null, 'junior cannot reorder');
select throws_ok(format($$select hq.mark_contractor_used(%L)$$, pg_temp.fx('c_plumb')), '42501', null, 'junior cannot record a job');
select pg_temp.unbecome();

-- a writer without approve (virtual assistant, property manager): writes, but cannot archive
select pg_temp.become('va');
select throws_ok(format($$select hq.set_trade_active(%L, false)$$, pg_temp.tid('roofing')), '42501', null, 'contractors.write alone cannot archive a trade');
select throws_ok(format($$update hq.trades set label = 'Direct' where id = %L$$, pg_temp.tid('roofing')), '42501', null, 'a writer cannot update a trade directly (RPC only)');
select pg_temp.unbecome();
select pg_temp.become('pm');
select throws_ok(format($$select hq.set_trade_active(%L, true)$$, pg_temp.tid('roofing')), '42501', null, 'a property manager cannot restore a trade');
select pg_temp.unbecome();
select is((select count(*) from hq.trades where is_active), 22::bigint, 'after every refused call nothing changed');

-- ------------------------------------------------------------ create
select pg_temp.become('va');
insert into zz_r select 'solar', hq.create_trade('  Solar   &  Batteries ', 'Panels, inverters and home batteries');
insert into zz_r select 'solar2', hq.create_trade('Solar and Batteries');
insert into zz_r select 'digit', hq.create_trade('24/7 Call-outs');
select throws_ok($$select hq.create_trade('SOLAR & BATTERIES')$$, '23505', null, 'the same label in another case is refused');
select throws_ok($$select hq.create_trade('plumbing')$$, '23505', 'there is already a trade called Plumbing', 'a seeded label cannot be added twice');
select throws_ok($$select hq.create_trade('   ')$$, '22023', null, 'a blank label is refused');
select throws_ok($$select hq.create_trade('---')$$, '22023', null, 'a label needs a letter or digit');
select throws_ok(format($$select hq.create_trade(%L)$$, repeat('x', 61)), '22023', null, 'a label over 60 characters is refused');
select pg_temp.unbecome();
select is(pg_temp.r('solar') ->> 'slug', 'solar_and_batteries', 'create: the slug is derived from the label');
select is(pg_temp.r('solar') ->> 'label', 'Solar & Batteries', 'create: the label is tidied (trimmed, spaces collapsed)');
select is(pg_temp.r('solar2') ->> 'slug', 'solar_and_batteries_2', 'create: a colliding slug gets a numeric suffix');
select is(pg_temp.r('digit') ->> 'slug', 't_24_7_call_outs', 'create: a label starting with a digit');
select is((pg_temp.r('solar') ->> 'sort_order')::int, 230, 'create: a new trade goes to the end of the order');
select is(pg_temp.r('solar') ->> 'description', 'Panels, inverters and home batteries', 'create: the description is kept');
select is((select count(*) from hq.audit_events where entity_type = 'trade' and action = 'create' and actor_id = pg_temp.fx('va') and summary = 'Create trade: Solar & Batteries'), 1::bigint, 'create is audited with the label');
select is((select created_by from hq.trades where slug = 'solar_and_batteries'), pg_temp.fx('va'), 'created_by is the caller');

-- ------------------------------------------------------------ rename, describe, immutability
select pg_temp.become('pm');
insert into zz_r select 'ren', hq.update_trade(pg_temp.tid('electrical'), 'Electricians');
insert into zz_r select 'same', hq.update_trade(pg_temp.tid('electrical'), 'Electricians');
insert into zz_r select 'desc', hq.update_trade(pg_temp.tid('electrical'), null, 'Licensed electrical work');
insert into zz_r select 'clear', hq.update_trade(pg_temp.tid('solar_and_batteries'), null, '');
select throws_ok(format($$select hq.update_trade(%L, 'Plumbing')$$, pg_temp.tid('electrical')), '23505', null, 'a rename to another trade''s label is refused');
select throws_ok(format($$select hq.update_trade(%L, 'x', null, -1)$$, pg_temp.tid('electrical')), '22023', null, 'a negative sort order is refused');
select throws_ok(format($$select hq.update_trade(%L, 'x')$$, gen_random_uuid()), 'P0002', null, 'an unknown trade is not found');
select pg_temp.unbecome();
select is(pg_temp.r('ren') ->> 'slug', 'electrical', 'rename: the slug does not change');
select is((pg_temp.r('ren') ->> 'changed')::boolean, true, 'rename: changed');
select is((pg_temp.r('same') ->> 'changed')::boolean, false, 'the same label again: changed false');
select is((select label || '|' || description from hq.trades where slug = 'electrical'), 'Electricians|Licensed electrical work', 'a null label leaves the label; the description is set');
select is((select description from hq.trades where slug = 'solar_and_batteries'), null, 'a blank description clears it');
select throws_ok($$update hq.trades set slug = 'sparkies' where slug = 'electrical'$$, '42501', null, 'a slug cannot change, even for the table owner');
select throws_ok($$delete from hq.trades where slug = 'glazing'$$, '42501', null, 'a trade cannot be deleted, even by the table owner');
select is((select count(*) from hq.audit_events where entity_type = 'trade' and action = 'update' and entity_id = pg_temp.tid('electrical') and summary like '%Electricians%'), 2::bigint, 'renames and descriptions are audited');
select pg_temp.become('jpm');
select is((select trade_labels from hq.contractor_directory where id = pg_temp.fx('c_spark')), array['Electricians'], 'the directory shows the new label');
select is((select array_agg(e ->> 'title') from jsonb_array_elements(hq.global_search('Electricians') -> 'contractors') e), array['Test Sparks Co'], 'search finds a contractor by the renamed label');
select is((select e ->> 'subtitle' from jsonb_array_elements(hq.global_search('Test Sparks') -> 'contractors') e limit 1), 'Electricians - prospect', 'the search subtitle uses the current label');
select pg_temp.unbecome();

-- ------------------------------------------------------------ reorder
select pg_temp.become('va');
insert into zz_r select 'up', hq.move_trade(pg_temp.tid('solar_and_batteries'), 'up');
insert into zz_r select 'top', hq.move_trade(pg_temp.tid('plumbing'), 'up');
select throws_ok(format($$select hq.move_trade(%L, 'sideways')$$, pg_temp.tid('plumbing')), '22023', null, 'a direction other than up or down is refused');
select pg_temp.unbecome();
select is((select array_agg(slug order by sort_order) from hq.trades where slug in ('other', 'solar_and_batteries', 'solar_and_batteries_2', 't_24_7_call_outs')),
  array['solar_and_batteries', 'other', 'solar_and_batteries_2', 't_24_7_call_outs'], 'move up: swapped with the trade above (other), the rest in place');
select is((pg_temp.r('top') ->> 'changed')::boolean, false, 'moving the first trade up changes nothing');
select is((select count(distinct sort_order) = count(*) from hq.trades where is_active), true, 'after a move every active trade has its own position');
select is((select count(*) from hq.audit_events where entity_type = 'trade' and action = 'reorder'), 1::bigint, 'a move is one audit row (reorder)');

-- ------------------------------------------------------------ archive and restore
select pg_temp.become('dir');
select throws_ok(format($$select hq.set_trade_active(%L, false)$$, pg_temp.tid('plumbing')), '23514', null, 'a trade a live contractor uses cannot be archived');
insert into zz_r select 'arch', hq.set_trade_active(pg_temp.tid('roofing'), false, 'Not a trade we use');
insert into zz_r select 'arch2', hq.set_trade_active(pg_temp.tid('roofing'), false);
select throws_ok(format($$select hq.move_trade(%L, 'up')$$, pg_temp.tid('roofing')), '22023', null, 'an archived trade cannot be moved');
select pg_temp.unbecome();
select is((select is_active from hq.trades where slug = 'plumbing'), true, 'the refused archive changed nothing');
select is((select (not is_active) and archived_by = pg_temp.fx('dir') from hq.trades where slug = 'roofing'), true, 'an unused trade is archived, stamped with who');
select is((pg_temp.r('arch2') ->> 'changed')::boolean, false, 'archiving again: changed false');
select is((select count(*) from hq.audit_events where entity_type = 'trade' and action = 'archive' and summary like '%Roofing%Not a trade we use%'), 1::bigint, 'the archive is audited with its reason');

-- contractor writes may only add current trades
select pg_temp.become('va');
select throws_ok($$insert into hq.contractors (business_name, categories) values ('Roof Co', '{roofing}')$$, '23514', 'not a current trade: roofing (contractors_trades_known)', 'a contractor cannot be saved with an archived trade');
select throws_ok($$insert into hq.contractors (business_name, categories) values ('Wizard Co', '{plumbing,wizardry}')$$, '23514', 'not a current trade: wizardry (contractors_trades_known)', 'a contractor cannot be saved with an unknown trade');
select throws_ok(format($$update hq.contractors set categories = '{plumbing,roofing}' where id = %L$$, pg_temp.fx('c_plumb')), '23514', null, 'an archived trade cannot be added to an existing contractor');
select lives_ok($$insert into hq.contractors (business_name, categories) values ('Solar Co', '{ Solar_And_Batteries ,solar_and_batteries,electrical}')$$, 'a custom trade can be used');
select pg_temp.unbecome();
select is((select categories from hq.contractors where business_name = 'Solar Co'), array['solar_and_batteries', 'electrical'], 'slugs are trimmed, lower-cased, repeats dropped, order kept');

-- an archived slug stays valid on a row that already carries it
select pg_temp.mk_contractor('glass', 'Glass Co', '{glazing,building}');
select pg_temp.become('dir');
select hq.archive_record('contractor', pg_temp.fx('glass'), 'test');
insert into zz_r select 'glz', hq.set_trade_active(pg_temp.tid('glazing'), false);
select lives_ok(format($$select hq.restore_record('contractor', %L)$$, pg_temp.fx('glass')), 'a contractor carrying an archived trade can be restored');
select pg_temp.unbecome();
select pg_temp.become('va');
select lives_ok(format($$update hq.contractors set business_name = 'Glass Co Renamed', categories = '{glazing,building,plumbing}' where id = %L$$, pg_temp.fx('glass')), 'its other fields and other trades can still be edited (the archived slug is kept)');
select pg_temp.unbecome();
select is((select categories from hq.contractors where id = pg_temp.fx('glass')), array['glazing', 'building', 'plumbing'], 'the archived slug is still on the row');
select pg_temp.become('va');
select lives_ok(format($$update hq.contractors set categories = '{building,plumbing}' where id = %L$$, pg_temp.fx('glass')), 'the archived trade can be removed from the row');
select throws_ok(format($$update hq.contractors set categories = '{building,plumbing,glazing}' where id = %L$$, pg_temp.fx('glass')), '23514', null, '... but, once removed, not added back while archived');
select pg_temp.unbecome();
select pg_temp.become('dir');
select throws_ok(format($$select hq.set_trade_active(%L, false)$$, pg_temp.tid('building')), '23514', null, 'a trade used by the restored contractor cannot be archived');
insert into zz_r select 'restore', hq.set_trade_active(pg_temp.tid('roofing'), true);
select pg_temp.unbecome();
select is((pg_temp.r('restore') ->> 'is_active')::boolean, true, 'a trade can be restored');
select pg_temp.become('va');
select lives_ok($$insert into hq.contractors (business_name, categories) values ('Roof Co', '{roofing}')$$, 'a restored trade can be used again');
select pg_temp.unbecome();

-- ------------------------------------------------------------ import, summary with custom trades
select pg_temp.become('dir');
insert into zz_r select 'imp', hq.preview_contractor_import($j$[
  {"business_name": "Imported Solar", "categories": ["solar_and_batteries"]},
  {"business_name": "Imported Glass", "categories": ["glazing"]},
  {"business_name": "Imported Spark", "categories": ["Electrical"]}
]$j$::jsonb);
insert into zz_r select 'app', hq.apply_contractor_import('[{"business_name": "Imported Solar", "categories": ["solar_and_batteries", "plumbing"]}]'::jsonb, 'trades-test');
insert into zz_r select 'sum', hq.contractor_summary();
select pg_temp.unbecome();
select is((select array_agg(e ->> 'classification' order by (e ->> 'row')::int) from jsonb_array_elements(pg_temp.r('imp') -> 'rows') e),
  array['new_contractor', 'invalid', 'new_contractor'], 'import: a custom trade is accepted, an archived one is invalid, a slug in another case is accepted');
select is((select e ->> 'reason' from jsonb_array_elements(pg_temp.r('imp') -> 'rows') e where (e ->> 'row')::int = 2), 'unknown category: glazing is not a current trade', 'import: the archived trade is named');
select is((select categories from hq.contractors where business_name = 'Imported Solar' and deleted_at is null), array['solar_and_batteries', 'plumbing'], 'import: applied with the custom trade');
select is(jsonb_array_length(pg_temp.r('sum') -> 'preferred_coverage')::bigint, (select count(*) from hq.trades where is_active), 'summary: one coverage entry per active trade');
select ok(not exists (select 1 from jsonb_array_elements(pg_temp.r('sum') -> 'preferred_coverage') e where e ->> 'category' = 'glazing'), 'summary: an archived trade with no cleared contractor is left out');
select is((select e ->> 'label' from jsonb_array_elements(pg_temp.r('sum') -> 'preferred_coverage') e where e ->> 'category' = 'electrical'), 'Electricians', 'summary: coverage carries the current label');
select is((select (e ->> 'category') from jsonb_array_elements(pg_temp.r('sum') -> 'preferred_coverage') with ordinality as x(e, n) where n = 1), 'plumbing', 'summary: coverage follows the trade order');
select ok((pg_temp.r('sum') -> 'trades_without_cover') ? 'solar_and_batteries' and not ((pg_temp.r('sum') -> 'trades_without_cover') ? 'other'), 'summary: a custom trade with no cleared contractor is named; never other');

-- ------------------------------------------------------------ record a job (mark_contractor_used)
select pg_temp.become('va');
insert into zz_r select 'u1', hq.mark_contractor_used(pg_temp.fx('c_plumb'));
insert into zz_r select 'u2', hq.mark_contractor_used(pg_temp.fx('c_plumb'), hq.today());
select throws_ok(format($$select hq.mark_contractor_used(%L, hq.today() - 10)$$, pg_temp.fx('c_plumb')), '23514', null, 'an earlier date is refused unless confirmed');
select throws_ok(format($$select hq.mark_contractor_used(%L, hq.today() + 1)$$, pg_temp.fx('c_plumb')), '22023', null, 'a future date is refused');
insert into zz_r select 'u3', hq.mark_contractor_used(pg_temp.fx('c_plumb'), hq.today() - 10, true);
select throws_ok(format($$select hq.mark_contractor_used(%L)$$, gen_random_uuid()), 'P0002', null, 'an unknown contractor is not found');
select pg_temp.unbecome();
select is(pg_temp.r('u1') ->> 'last_job_date', hq.today()::text, 'record a job: defaults to today (configured timezone)');
select is((pg_temp.r('u2') ->> 'changed')::boolean, false, 'the same date again: changed false');
select is((pg_temp.r('u3') ->> 'last_job_date') || '|' || (pg_temp.r('u3') ->> 'previous_last_job_date'), (hq.today() - 10)::text || '|' || hq.today()::text, 'confirmed: the date moves back');
select is((select last_job_date from hq.contractor_directory where id = pg_temp.fx('c_plumb')), hq.today() - 10, 'the directory shows the recorded last job');
select is((select count(*) from hq.audit_events where entity_type = 'contractor' and entity_id = pg_temp.fx('c_plumb') and action = 'record_use' and actor_id = pg_temp.fx('va')), 2::bigint, 'each recorded job is audited (record_use)');
select pg_temp.become('dir');
select hq.archive_record('contractor', pg_temp.fx('c_spark'), 'test');
select throws_ok(format($$select hq.mark_contractor_used(%L)$$, pg_temp.fx('c_spark')), 'P0002', null, 'an archived contractor cannot be marked used');
select pg_temp.unbecome();

select * from finish();
rollback;
