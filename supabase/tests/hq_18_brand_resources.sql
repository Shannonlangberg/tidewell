-- Planted HQ: Resources, the brand library (migrations 0148, 0149, 0150).
-- The bucket and its policies, the capability matrix (resources.read for every role, resources.manage for
-- director and administrator only), forged callers (anon, a login with no HQ profile, every role that may
-- only read), RLS (live rows for readers, archived rows for managers), no direct writes, the register /
-- update / replace / archive / restore rules on their boundaries, the dedupe rule, append-only versions,
-- the importer function (service_role only, acts for a manager) and the audit trail.
--
-- NOTE: never CALL a function a hint role lacks execute on (see hq_01). The five RPCs are granted to
-- authenticated; anon is refused at the schema.
begin;
\ir hq_fixture.inc
select pg_temp.seed_hq();
select plan(152);

-- anything already in this database is put out of the way for the transaction
update hq.brand_resources set deleted_at = now() where deleted_at is null;

create temp table zz_b (k text primary key, v jsonb) on commit drop;
grant select, insert on zz_b to public;
create function pg_temp.b(p_k text) returns jsonb language sql stable as $$ select v from zz_b where k = p_k $$;
create function pg_temp.bid(p_k text) returns uuid language sql stable as $$ select (v ->> 'resource_id')::uuid from zz_b where k = p_k $$;
-- a storage path <resource id>/<new object id>-<name>, a stored object, a content fingerprint
create function pg_temp.bpath(p_resource uuid default gen_random_uuid(), p_name text default 'mark.svg') returns text
language sql volatile as $$ select p_resource::text || '/' || gen_random_uuid()::text || '-' || p_name $$;
create function pg_temp.bobj(p_path text, p_size bigint default 1000, p_mime text default 'image/svg+xml') returns void
language sql as $$
  insert into storage.objects (bucket_id, name, owner, metadata) values ('brand-resources', p_path, null, jsonb_build_object('size', p_size, 'mimetype', p_mime));
$$;
create function pg_temp.sha(p_seed text) returns text language sql immutable as $$ select encode(sha256(convert_to(p_seed, 'utf8')), 'hex') $$;
-- the SQLSTATE a statement fails with, or 'allowed'
create function pg_temp.outcome(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'allowed';
exception when others then
  return sqlstate;
end $$;
create function pg_temp.hint(p_sql text) returns text language plpgsql as $$
declare v text;
begin
  execute p_sql;
  return 'allowed';
exception when others then
  get stacked diagnostics v = pg_exception_hint;
  return v;
end $$;
create function pg_temp.msg(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'allowed';
exception when others then
  return sqlerrm;
end $$;
create function pg_temp.audits(p_id uuid, p_action text) returns bigint language sql stable as $$
  select count(*) from hq.audit_events where entity_type = 'brand_resource' and entity_id = p_id and action = p_action $$;
create function pg_temp.reg(p_title text, p_cat text, p_path text, p_sha text, p_name text default 'mark.svg', p_mime text default 'image/svg+xml') returns text
language sql as $$
  select format($f$select hq.register_brand_resource(%L, %L::hq.brand_resource_category, 'desc', %L, %L, %L, 1000, %L)$f$, p_title, p_cat, p_name, p_path, p_mime, p_sha)
$$;

-- ------------------------------------------------------------ the bucket
select is((select public from storage.buckets where id = 'brand-resources'), false, 'bucket: brand-resources is private');
select is((select file_size_limit from storage.buckets where id = 'brand-resources'), 10485760::bigint, 'bucket: 10 MiB per file');
select is((select allowed_mime_types from storage.buckets where id = 'brand-resources'),
  array['image/svg+xml', 'image/png', 'image/jpeg', 'application/pdf', 'text/css', 'text/javascript', 'application/json', 'text/markdown', 'text/plain', 'text/html', 'application/zip', 'font/woff', 'font/woff2', 'font/ttf', 'font/otf'],
  'bucket: svg, png, jpeg, pdf, css, js, json, markdown, text, html, zip and woff/woff2/ttf/otf only');
select is((select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'hq_brand_resources_%'), 2::bigint,
  'bucket: exactly two policies (select, insert), so no update or delete policy exists');
select is((select cmd from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'hq_brand_resources_select'), 'SELECT', 'bucket: the read policy is for select');
select is((select cmd from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'hq_brand_resources_insert'), 'INSERT', 'bucket: the add policy is for insert');

-- ------------------------------------------------------------ the capability matrix
select is((select count(*) from hq.role_capabilities where capability = 'resources.read'), 8::bigint, 'resources.read is held by all eight roles');
select is((select array_agg(role::text order by role::text) from hq.role_capabilities where capability = 'resources.manage'), array['administrator', 'director'], 'resources.manage is held by director and administrator only');
select is((select count(*) from hq.role_capabilities where capability = 'resources.read' and role in ('read_only', 'junior_property_manager')), 2::bigint, 'read-only and junior property manager can read resources');

-- ------------------------------------------------------------ register: the rules
select pg_temp.bpath(gen_random_uuid(), 'wordmark-forest.svg') as p1 \gset
select pg_temp.become('dir');
select is(pg_temp.outcome(pg_temp.reg('pgTAP wordmark', 'logos', :'p1', pg_temp.sha('wm1'))), 'P0002', 'register: a file that was never uploaded is refused (the uploaded file was not found in storage)');
select pg_temp.unbecome();
select pg_temp.bobj(:'p1', 1000, 'image/svg+xml');
select pg_temp.become('dir');
select throws_ok(format($$select hq.register_brand_resource('pgTAP wordmark', 'logos', 'd', 'wordmark-forest.svg', %L, 'image/svg+xml', 999, %L)$$, :'p1', pg_temp.sha('wm1')),
  '22023', 'the stored file size does not match the declared size', 'register: a declared size that differs from the stored object is refused');
select throws_ok(format($$select hq.register_brand_resource('pgTAP wordmark', 'logos', 'd', 'wordmark-forest.svg', %L, 'image/png', 1000, %L)$$, :'p1', pg_temp.sha('wm1')),
  '22023', 'the stored file type does not match the declared type', 'register: a declared type that differs from the stored object is refused');
select is(pg_temp.outcome(pg_temp.reg('pgTAP wordmark', 'logos', :'p1', pg_temp.sha('wm1'), 'setup.exe', 'application/x-msdownload')), '22023', 'register: a type outside the allowlist is refused');
select throws_ok(format($$select hq.register_brand_resource('pgTAP wordmark', 'logos', 'd', 'big.svg', %L, 'image/svg+xml', 10485761, %L)$$, :'p1', pg_temp.sha('wm1')),
  '22023', 'a file must be larger than 0 bytes and at most 10 MiB', 'register: more than 10 MiB is refused');
select throws_ok(format($$select hq.register_brand_resource('pgTAP wordmark', 'logos', 'd', 'empty.svg', %L, 'image/svg+xml', 0, %L)$$, :'p1', pg_temp.sha('wm1')),
  '22023', 'a file must be larger than 0 bytes and at most 10 MiB', 'register: an empty file is refused');
select throws_ok(format($$select hq.register_brand_resource('pgTAP wordmark', 'logos', 'd', 'a.svg', %L, 'image/svg+xml', 1000, 'not-a-hash')$$, :'p1'),
  '22023', 'the file fingerprint (SHA-256) is not valid', 'register: a malformed fingerprint is refused');
select throws_ok($$select hq.register_brand_resource('pgTAP wordmark', 'logos', 'd', 'a.svg', 'not/a-path.svg', 'image/svg+xml', 1000, repeat('a', 64))$$,
  '22023', 'the storage path must be <resource id>/<object id>-<file name>', 'register: a malformed storage path is refused');
select throws_ok(format($$select hq.register_brand_resource('  ', 'logos', 'd', 'a.svg', %L, 'image/svg+xml', 1000, %L)$$, :'p1', pg_temp.sha('wm1')),
  '22023', 'a resource needs a title (at most 200 characters)', 'register: a blank title is refused');
select throws_ok(format($$select hq.register_brand_resource(repeat('t', 201), 'logos', 'd', 'a.svg', %L, 'image/svg+xml', 1000, %L)$$, :'p1', pg_temp.sha('wm1')),
  '22023', 'a title is at most 200 characters', 'register: a title over 200 characters is refused');
select throws_ok(format($$select hq.register_brand_resource('pgTAP wordmark', null, 'd', 'a.svg', %L, 'image/svg+xml', 1000, %L)$$, :'p1', pg_temp.sha('wm1')),
  '22023', 'choose a category', 'register: no category is refused');
select throws_ok(format($$select hq.register_brand_resource('pgTAP wordmark', 'logos', repeat('d', 2001), 'a.svg', %L, 'image/svg+xml', 1000, %L)$$, :'p1', pg_temp.sha('wm1')),
  '22023', 'a description is at most 2000 characters', 'register: a description over 2000 characters is refused');
select throws_ok(format($$select hq.register_brand_resource('pgTAP wordmark', 'logos', 'd', 'a.svg', %L, 'image/svg+xml', 1000, %L, '{}', repeat('n', 1001))$$, :'p1', pg_temp.sha('wm1')),
  '22023', 'a note is at most 1000 characters', 'register: a note over 1000 characters is refused');
select throws_ok(format($$select hq.register_brand_resource('pgTAP wordmark', 'logos', 'd', 'a.svg', %L, 'image/svg+xml', 1000, %L, '{}', null, 10000)$$, :'p1', pg_temp.sha('wm1')),
  '22023', 'the sort order is a number from 0 to 9999', 'register: a sort order outside 0 to 9999 is refused');
select throws_ok(format($$select hq.register_brand_resource('pgTAP wordmark', 'logos', 'd', 'a.svg', %L, 'image/svg+xml', 1000, %L, array(select 'tag' || g from generate_series(1, 13) g))$$, :'p1', pg_temp.sha('wm1')),
  '22023', 'at most 12 tags', 'register: more than 12 tags are refused');
select throws_ok(format($$select hq.register_brand_resource('pgTAP wordmark', 'logos', 'd', 'a.svg', %L, 'image/svg+xml', 1000, %L, array['bad!tag'])$$, :'p1', pg_temp.sha('wm1')),
  '22023', 'tags are 1 to 40 characters: letters, numbers, spaces and - . _ : /', 'register: a tag with other characters is refused');
-- success: tags are tidied (lower case, single spaces, no duplicates)
insert into zz_b select 'wm', hq.register_brand_resource('pgTAP wordmark', 'logos', 'The forest wordmark', 'wordmark-forest.svg', :'p1', 'image/svg+xml', 1000, pg_temp.sha('wm1'),
  array['Brand', ' brand ', 'Logo  Mark'], 'Use on light backgrounds', 5);
select throws_ok(format($$select hq.register_brand_resource('pgTAP other', 'logos', 'd', 'wordmark-forest.svg', %L, 'image/svg+xml', 1000, %L)$$, :'p1', pg_temp.sha('wm2')),
  '23505', 'that file is already registered', 'register: the same object cannot be registered twice');
select pg_temp.unbecome();

select is((select jsonb_build_object('t', title, 'c', category, 'v', version, 'tags', tags, 'n', note, 's', sort_order, 'by', created_by) from hq.brand_resources where id = pg_temp.bid('wm')),
  jsonb_build_object('t', 'pgTAP wordmark', 'c', 'logos', 'v', 'v1', 'tags', jsonb_build_array('brand', 'logo mark'), 'n', 'Use on light backgrounds', 's', 5, 'by', pg_temp.fx('dir')),
  'register: the resource is stored at v1 with tidied tags, its note and sort order, created by the caller');
select is((select id::text from hq.brand_resources where title = 'pgTAP wordmark'), split_part(:'p1', '/', 1), 'register: the resource id is the first part of the storage path');
select is((select ref from hq.brand_resource_overview where id = pg_temp.bid('wm')) ~ '^RES-[0-9]{4,}$', true, 'register: the overview shows the RES-0001 style number');
select is((select created_by_name from hq.brand_resource_overview where id = pg_temp.bid('wm')), 'Dana Director', 'register: the overview names who added it');
select is((select version_number || '|' || label || '|' || storage_path || '|' || change_note from hq.brand_resource_versions where resource_id = pg_temp.bid('wm')), '1|v1|' || :'p1' || '|First version', 'register: version 1 is recorded with its object');
select is(pg_temp.audits(pg_temp.bid('wm'), 'create'), 1::bigint, 'audit: registering is audited as create (entity brand_resource)');
select is((select summary from hq.audit_events where entity_type = 'brand_resource' and entity_id = pg_temp.bid('wm') and action = 'create'), 'Create brand_resource: pgTAP wordmark', 'audit: the summary names the resource');

-- title and content rules
select pg_temp.bpath(gen_random_uuid(), 'other.svg') as p2 \gset
select pg_temp.bobj(:'p2');
select pg_temp.become('dir');
select throws_ok(pg_temp.reg('PGTAP WORDMARK ', 'logos', :'p2', pg_temp.sha('wm2')), '23514', 'another resource already has that title', 'rule: a title is unique among live resources, ignoring case and spaces');
select throws_ok(pg_temp.reg('pgTAP same content', 'logos', :'p2', pg_temp.sha('wm1')), '23514', null, 'rule: the same content cannot be in the same category twice');
select is(pg_temp.hint(pg_temp.reg('pgTAP same content', 'logos', :'p2', pg_temp.sha('wm1'))), 'brand_duplicate_file', 'rule: ... with the hint brand_duplicate_file');
select ok(pg_temp.msg(pg_temp.reg('pgTAP same content', 'logos', :'p2', pg_temp.sha('wm1'))) like 'this file is already in the library as RES-% "pgTAP wordmark" (the same content in the same category)', 'rule: ... naming the resource that has it');
select lives_ok(pg_temp.reg('pgTAP same content, other category', 'ui_kit', :'p2', pg_temp.sha('wm1')), 'rule: the same content may sit in a different category');
select pg_temp.unbecome();

-- ------------------------------------------------------------ roles: who may write
select pg_temp.bpath(gen_random_uuid(), 'r.svg') as p3 \gset
select pg_temp.bobj(:'p3');
select pg_temp.become('adm');
select lives_ok(pg_temp.reg('pgTAP admin adds', 'photos', :'p3', pg_temp.sha('adm1')), 'an administrator can register a resource');
select pg_temp.unbecome();
select pg_temp.bpath(gen_random_uuid(), 'x.svg') as p4 \gset
select pg_temp.bobj(:'p4');
select pg_temp.become('spm');
select is(pg_temp.outcome(pg_temp.reg('pgTAP spm', 'logos', :'p4', pg_temp.sha('spm1'))), '42501', 'senior property manager: register is refused');
select pg_temp.become('pm');
select is(pg_temp.outcome(pg_temp.reg('pgTAP pm', 'logos', :'p4', pg_temp.sha('pm1'))), '42501', 'property manager: register is refused');
select is(pg_temp.outcome(format($$select hq.update_brand_resource(%L, 't', 'd', 'logos', '{}', null, 0)$$, pg_temp.bid('wm'))), '42501', 'property manager: update is refused');
select is(pg_temp.outcome(format($$select hq.archive_brand_resource(%L)$$, pg_temp.bid('wm'))), '42501', 'property manager: archive is refused');
select is(pg_temp.outcome(format($$select hq.restore_brand_resource(%L)$$, pg_temp.bid('wm'))), '42501', 'property manager: restore is refused');
select is(pg_temp.outcome(format($$select hq.replace_brand_resource_file(%L, 'a.svg', %L, 'image/svg+xml', 1000, %L)$$, pg_temp.bid('wm'), :'p4', pg_temp.sha('pm2'))), '42501', 'property manager: replace is refused');
select pg_temp.become('jpm');
select is(pg_temp.outcome(pg_temp.reg('pgTAP jpm', 'logos', :'p4', pg_temp.sha('jpm1'))), '42501', 'junior property manager: register is refused');
select pg_temp.become('bdm');
select is(pg_temp.outcome(pg_temp.reg('pgTAP bdm', 'logos', :'p4', pg_temp.sha('bdm1'))), '42501', 'business development manager: register is refused');
select pg_temp.become('va');
select is(pg_temp.outcome(pg_temp.reg('pgTAP va', 'logos', :'p4', pg_temp.sha('va1'))), '42501', 'virtual assistant: register is refused');
select pg_temp.become('ro');
select is(pg_temp.outcome(pg_temp.reg('pgTAP ro', 'logos', :'p4', pg_temp.sha('ro1'))), '42501', 'read-only: register is refused');
select is(pg_temp.outcome(format($$select hq.archive_brand_resource(%L)$$, pg_temp.bid('wm'))), '42501', 'read-only: archive is refused');
select pg_temp.become('outsider');
select is(pg_temp.outcome(pg_temp.reg('pgTAP outsider', 'logos', :'p4', pg_temp.sha('out1'))), '42501', 'a login with no HQ profile: register is refused');
select pg_temp.become('dir', 'aal1');
select is(pg_temp.outcome(pg_temp.reg('pgTAP aal1', 'logos', :'p4', pg_temp.sha('aal1'))), '42501', 'a director at aal1 with MFA required: register is refused');
select pg_temp.unbecome();
select pg_temp.become_anon();
select throws_ok(pg_temp.reg('pgTAP anon', 'logos', :'p4', pg_temp.sha('anon1')), '42501', null, 'anon: register is refused (no usage on the schema)');
select throws_ok($$select count(*) from hq.brand_resources$$, '42501', null, 'anon: cannot read the table');
select pg_temp.unbecome();
select is((select count(*) from hq.brand_resources where title in ('pgTAP spm', 'pgTAP pm', 'pgTAP jpm', 'pgTAP bdm', 'pgTAP va', 'pgTAP ro', 'pgTAP outsider', 'pgTAP aal1', 'pgTAP anon')), 0::bigint, 'nothing was written by any refused caller');

-- ------------------------------------------------------------ no direct writes
select pg_temp.become('dir');
select throws_ok($$insert into hq.brand_resources (title, category, file_name, storage_path, mime_type, size_bytes, content_sha256) values ('x', 'logos', 'a.svg', 'p', 'image/svg+xml', 1, repeat('a', 64))$$, '42501', null, 'a director cannot insert into brand_resources directly');
select throws_ok(format($$update hq.brand_resources set title = 'Hijacked' where id = %L$$, pg_temp.bid('wm')), '42501', null, 'a director cannot update brand_resources directly');
select throws_ok(format($$update hq.brand_resources set deleted_at = now() where id = %L$$, pg_temp.bid('wm')), '42501', null, 'a director cannot archive directly (the RPC does)');
select throws_ok(format($$delete from hq.brand_resources where id = %L$$, pg_temp.bid('wm')), '42501', null, 'nobody can delete a resource');
select throws_ok($$insert into hq.brand_resource_versions (resource_id, version_number, label, file_name, storage_path, mime_type, size_bytes, content_sha256) values (gen_random_uuid(), 9, 'v9', 'a', 'b', 'image/png', 1, repeat('a', 64))$$, '42501', null, 'a director cannot insert a version directly');
select pg_temp.unbecome();
select throws_ok(format($$update hq.brand_resource_versions set label = 'edited' where resource_id = %L$$, pg_temp.bid('wm')), '42501', null, 'versions are append-only: not even the table owner can edit one');
select throws_ok(format($$delete from hq.brand_resource_versions where resource_id = %L$$, pg_temp.bid('wm')), '42501', null, 'versions are append-only: not even the table owner can delete one');
select throws_ok(format($$delete from hq.brand_resources where id = %L$$, pg_temp.bid('wm')), '42501', null, 'resources are never deleted: not even by the table owner');
select throws_ok(format($$update hq.brand_resources set ref_number = 999 where id = %L$$, pg_temp.bid('wm')), '428C9', null, 'a resource''s number cannot change (a generated identity column)');
select throws_ok(format($$update hq.brand_resources set storage_path = %L where id = %L$$, pg_temp.bpath(), pg_temp.bid('wm')), '23514', null, 'the storage path must belong to the resource (check constraint)');
select throws_ok(format($$update hq.brand_resources set mime_type = 'application/x-msdownload' where id = %L$$, pg_temp.bid('wm')), '23514', null, 'the type must be on the allowlist (check constraint)');
select throws_ok(format($$update hq.brand_resources set content_sha256 = 'abc' where id = %L$$, pg_temp.bid('wm')), '23514', null, 'the fingerprint must be 64 hex characters (check constraint)');

-- ------------------------------------------------------------ reading: RLS
select pg_temp.become('dir');
select is((select count(*) from hq.brand_resources where title like 'pgTAP%' and deleted_at is null), 3::bigint, 'director: reads the live resources');
select pg_temp.become('adm');
select is((select count(*) from hq.brand_resources where title like 'pgTAP%'), 3::bigint, 'administrator: reads them');
select pg_temp.become('spm');
select is((select count(*) from hq.brand_resources where title like 'pgTAP%'), 3::bigint, 'senior property manager: reads them');
select pg_temp.become('pm');
select is((select count(*) from hq.brand_resources where title like 'pgTAP%'), 3::bigint, 'property manager: reads them');
select pg_temp.become('jpm');
select is((select count(*) from hq.brand_resources where title like 'pgTAP%'), 3::bigint, 'junior property manager: reads them');
select pg_temp.become('bdm');
select is((select count(*) from hq.brand_resources where title like 'pgTAP%'), 3::bigint, 'business development manager: reads them');
select pg_temp.become('va');
select is((select count(*) from hq.brand_resources where title like 'pgTAP%'), 3::bigint, 'virtual assistant: reads them');
select pg_temp.become('ro');
select is((select count(*) from hq.brand_resources where title like 'pgTAP%'), 3::bigint, 'read-only: reads them');
select is((select count(*) from hq.brand_resource_versions v join hq.brand_resources r on r.id = v.resource_id where r.title like 'pgTAP%'), 3::bigint, 'read-only: reads their versions');
select is((select count(*) from hq.brand_resource_overview where title like 'pgTAP%'), 3::bigint, 'read-only: reads the overview');
select pg_temp.become('outsider');
select is((select count(*) from hq.brand_resources) + (select count(*) from hq.brand_resource_versions) + (select count(*) from hq.brand_resource_overview), 0::bigint, 'a login with no HQ profile reads nothing');
select pg_temp.become('dir', 'aal1');
select is((select count(*) from hq.brand_resources), 0::bigint, 'MFA required: a director at aal1 reads nothing');
select pg_temp.unbecome();

-- ------------------------------------------------------------ the bucket policies
select pg_temp.bobj(pg_temp.bpath(gen_random_uuid(), 'stray.svg')); -- uploaded but never registered
select pg_temp.become('pm');
select is((select count(*) from storage.objects where bucket_id = 'brand-resources' and name = :'p1'), 1::bigint, 'files: a property manager reads a registered file');
select is((select count(*) from storage.objects where bucket_id = 'brand-resources' and name not in (select storage_path from hq.brand_resource_versions)), 0::bigint, 'files: an object with no registered version is not readable');
select throws_ok(format($$insert into storage.objects (bucket_id, name, metadata) values ('brand-resources', %L, '{}')$$, pg_temp.bpath()), '42501', null, 'files: a property manager cannot add a file');
select pg_temp.become('ro');
select is((select count(*) from storage.objects where bucket_id = 'brand-resources' and name = :'p1'), 1::bigint, 'files: read-only reads a registered file');
select throws_ok(format($$insert into storage.objects (bucket_id, name, metadata) values ('brand-resources', %L, '{}')$$, pg_temp.bpath()), '42501', null, 'files: read-only cannot add a file');
select pg_temp.become('dir');
select is((select count(*) from storage.objects where bucket_id = 'brand-resources' and name not in (select storage_path from hq.brand_resource_versions)), 2::bigint, 'files: a manager can read the objects that are uploaded but not yet registered (so the server can check it first)');
select lives_ok(format($$insert into storage.objects (bucket_id, name, metadata) values ('brand-resources', %L, '{"size": 5, "mimetype": "image/png"}')$$, pg_temp.bpath(gen_random_uuid(), 'new.png')), 'files: a director can add a file under <resource id>/<object id>-<name>');
select throws_ok(format($$insert into storage.objects (bucket_id, name, metadata) values ('brand-resources', %L, '{}')$$, gen_random_uuid() || '/notes.pdf'), '42501', null, 'files: a name that is not <resource>/<uuid>-<name> is refused');
select throws_ok(format($$insert into storage.objects (bucket_id, name, metadata) values ('brand-resources', %L, '{}')$$, pg_temp.bpath(gen_random_uuid(), 'bad name.svg')), '42501', null, 'files: an unsanitised file name (a space) is refused');
select throws_ok(format($$insert into storage.objects (bucket_id, name, metadata) values ('other-bucket', %L, '{}')$$, pg_temp.bpath()), '42501', null, 'files: the policy does not open any other bucket');
update storage.objects set metadata = '{"size": 1}'::jsonb where bucket_id = 'brand-resources';
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects where bucket_id = 'brand-resources';
select set_config('storage.allow_delete_query', 'false', true);
select pg_temp.unbecome();
select is((select count(*) from storage.objects where bucket_id = 'brand-resources' and name = :'p1'), 1::bigint, 'files: nobody can delete a file through the API (no delete policy)');
select is((select count(*) from storage.objects where bucket_id = 'brand-resources' and metadata = '{"size": 1}'::jsonb), 0::bigint, 'files: nobody can overwrite a file (no update policy)');
select pg_temp.become_anon();
select is((select count(*) from storage.objects where bucket_id = 'brand-resources'), 0::bigint, 'files: anon reads nothing');
select pg_temp.unbecome();

-- ------------------------------------------------------------ update_brand_resource
select pg_temp.become('dir');
select throws_ok(format($$select hq.update_brand_resource(%L, 'pgTAP admin adds', 'd', 'logos', '{}', null, 0)$$, pg_temp.bid('wm')), '23514', 'another resource already has that title', 'update: a title another live resource has is refused');
select throws_ok(format($$select hq.update_brand_resource(%L, 'pgTAP wordmark', 'd', 'ui_kit', '{}', null, 0)$$, pg_temp.bid('wm')), '23514', null, 'update: a category that already holds the same content is refused');
select throws_ok(format($$select hq.update_brand_resource(%L, 'pgTAP wordmark', 'd', 'logos', '{}', null, 10000)$$, pg_temp.bid('wm')), '22023', 'the sort order is a number from 0 to 9999', 'update: a sort order outside 0 to 9999 is refused');
select throws_ok(format($$select hq.update_brand_resource(%L, '', 'd', 'logos', '{}', null, 0)$$, pg_temp.bid('wm')), '22023', 'a resource needs a title (at most 200 characters)', 'update: a blank title is refused');
select throws_ok($$select hq.update_brand_resource(gen_random_uuid(), 't', 'd', 'logos', '{}', null, 0)$$, 'P0002', 'resource not found', 'update: an unknown resource is refused');
select is(hq.update_brand_resource(pg_temp.bid('wm'), 'pgTAP wordmark', 'The forest wordmark', 'logos', array['brand', 'logo mark'], 'Use on light backgrounds', 5) ->> 'changed', 'false', 'update: sending the same values changes nothing');
select is(pg_temp.audits(pg_temp.bid('wm'), 'update'), 0::bigint, 'update: ... and writes no audit row');
select is(hq.update_brand_resource(pg_temp.bid('wm'), 'pgTAP wordmark, forest', 'New description', 'logos', array['Brand', 'forest'], null, 7) ->> 'changed', 'true', 'update: a change is made');
select pg_temp.unbecome();
select is((select jsonb_build_object('t', title, 'd', description, 'tags', tags, 'n', note, 's', sort_order, 'v', version, 'f', file_name) from hq.brand_resources where id = pg_temp.bid('wm')),
  jsonb_build_object('t', 'pgTAP wordmark, forest', 'd', 'New description', 'tags', jsonb_build_array('brand', 'forest'), 'n', null, 's', 7, 'v', 'v1', 'f', 'wordmark-forest.svg'),
  'update: title, description, tags and sort order changed, the note was cleared, the file and version untouched');
select is((select changes -> 'title' ->> 'to' from hq.audit_events where entity_type = 'brand_resource' and entity_id = pg_temp.bid('wm') and action = 'update'), 'pgTAP wordmark, forest', 'audit: an update carries a from/to diff');
select is((select updated_by from hq.brand_resources where id = pg_temp.bid('wm')), pg_temp.fx('dir'), 'update: updated_by is the caller');

-- ------------------------------------------------------------ replace_brand_resource_file
select pg_temp.bpath(pg_temp.bid('wm'), 'wordmark-forest-2.svg') as p5 \gset
select pg_temp.bpath(gen_random_uuid(), 'elsewhere.svg') as p6 \gset
select pg_temp.bobj(:'p5', 2000);
select pg_temp.bobj(:'p6', 2000);
select pg_temp.bpath(gen_random_uuid(), 'second-logo.svg') as p5b \gset
select pg_temp.bobj(:'p5b');
select pg_temp.become('dir');
select lives_ok(pg_temp.reg('pgTAP second logo', 'logos', :'p5b', pg_temp.sha('wm9')), 'setup: a second logo, so the replace rules can be tried against it');
select throws_ok(format($$select hq.replace_brand_resource_file(%L, 'w2.svg', %L, 'image/svg+xml', 2000, %L)$$, pg_temp.bid('wm'), :'p6', pg_temp.sha('wm3')), '22023', 'the storage path must start with this resource''s id', 'replace: an object under another resource''s id is refused');
select throws_ok(format($$select hq.replace_brand_resource_file(%L, 'w2.svg', %L, 'image/svg+xml', 2000, %L)$$, pg_temp.bid('wm'), pg_temp.bpath(pg_temp.bid('wm')), pg_temp.sha('wm3')), 'P0002', 'the uploaded file was not found in storage', 'replace: an object that was never uploaded is refused');
select throws_ok(format($$select hq.replace_brand_resource_file(%L, 'w2.svg', %L, 'image/svg+xml', 2000, %L)$$, pg_temp.bid('wm'), :'p5', pg_temp.sha('wm1')), '23514', 'that file is the same as the current version', 'replace: the same content as the current file is refused');
select throws_ok(format($$select hq.replace_brand_resource_file(%L, 'w2.svg', %L, 'image/svg+xml', 2000, %L)$$, pg_temp.bid('wm'), :'p5', pg_temp.sha('wm9')), '23514', null, 'replace: content that another live resource has in the same category is refused');
select throws_ok(format($$select hq.replace_brand_resource_file(%L, 'w2.svg', %L, 'image/svg+xml', 1999, %L)$$, pg_temp.bid('wm'), :'p5', pg_temp.sha('wm3')), '22023', 'the stored file size does not match the declared size', 'replace: a size that differs from the stored object is refused');
select throws_ok(format($$select hq.replace_brand_resource_file(%L, 'w2.svg', %L, 'image/svg+xml', 2000, %L, repeat('l', 41))$$, pg_temp.bid('wm'), :'p5', pg_temp.sha('wm3')), '22023', 'a version label is at most 40 characters', 'replace: a version label over 40 characters is refused');
select throws_ok(format($$select hq.replace_brand_resource_file(gen_random_uuid(), 'w2.svg', %L, 'image/svg+xml', 2000, %L)$$, :'p5', pg_temp.sha('wm3')), 'P0002', 'resource not found', 'replace: an unknown resource is refused');
select is(hq.replace_brand_resource_file(pg_temp.bid('wm'), 'wordmark-forest-2.svg', :'p5', 'image/svg+xml', 2000, pg_temp.sha('wm3'), null, 'Tightened the tracking') ->> 'version_number', '2', 'replace: the new file becomes version 2');
select throws_ok(format($$select hq.replace_brand_resource_file(%L, 'w2.svg', %L, 'image/svg+xml', 2000, %L)$$, pg_temp.bid('wm'), :'p5', pg_temp.sha('wm4')), '23505', 'that file is already registered', 'replace: an object that is already registered cannot be used again');
select pg_temp.unbecome();
select is((select version || '|' || file_name || '|' || storage_path || '|' || size_bytes from hq.brand_resources where id = pg_temp.bid('wm')), 'v2|wordmark-forest-2.svg|' || :'p5' || '|2000', 'replace: the resource now points at the new file, labelled v2');
select is((select count(*) from hq.brand_resource_versions where resource_id = pg_temp.bid('wm')), 2::bigint, 'replace: both versions are kept');
select is((select count(*) from storage.objects where bucket_id = 'brand-resources' and name in (:'p1', :'p5')), 2::bigint, 'replace: the old object is kept in storage');
select is((select change_note from hq.brand_resource_versions where resource_id = pg_temp.bid('wm') and version_number = 2), 'Tightened the tracking', 'replace: the change note is kept on the version');
select is(pg_temp.audits(pg_temp.bid('wm'), 'replace_file'), 1::bigint, 'audit: replacing a file is audited as replace_file');
select is((select content_sha256 from hq.brand_resources where id = pg_temp.bid('wm')), pg_temp.sha('wm3'), 'replace: the fingerprint is the new file''s');
select pg_temp.bpath(pg_temp.bid('wm'), 'wordmark-forest-3.svg') as p7 \gset
select pg_temp.bobj(:'p7', 3000);
select pg_temp.become('adm');
select is(hq.replace_brand_resource_file(pg_temp.bid('wm'), 'wordmark-forest-3.svg', :'p7', 'image/svg+xml', 3000, pg_temp.sha('wm5'), '2027 refresh') ->> 'version_number', '3', 'replace: an administrator can replace too; version 3');
select pg_temp.unbecome();
select is((select version from hq.brand_resources where id = pg_temp.bid('wm')), '2027 refresh', 'replace: a version label can be given');
select pg_temp.become('pm');
select is((select count(*) from storage.objects where bucket_id = 'brand-resources' and name = :'p5'), 1::bigint, 'replace: an older version''s file can still be read by staff');
select pg_temp.unbecome();

-- ------------------------------------------------------------ archive and restore
select pg_temp.become('dir');
select throws_ok($$select hq.archive_brand_resource(gen_random_uuid())$$, 'P0002', 'resource not found', 'archive: an unknown resource is refused');
select is(hq.archive_brand_resource(pg_temp.bid('wm'), 'Superseded by the new mark') ->> 'archived', 'true', 'archive: a manager archives a resource');
select throws_ok(format($$select hq.archive_brand_resource(%L)$$, pg_temp.bid('wm')), 'P0002', 'resource not found', 'archive: an archived resource cannot be archived again');
select throws_ok(format($$select hq.update_brand_resource(%L, 't', 'd', 'logos', '{}', null, 0)$$, pg_temp.bid('wm')), 'P0002', 'resource not found', 'update: an archived resource cannot be edited');
select is((select count(*) from hq.brand_resources where id = pg_temp.bid('wm')), 1::bigint, 'archive: a manager still sees the archived resource');
select is((select count(*) from storage.objects where bucket_id = 'brand-resources' and name = :'p1'), 1::bigint, 'archive: ... and its files');
select pg_temp.become('pm');
select is((select count(*) from hq.brand_resources where id = pg_temp.bid('wm')), 0::bigint, 'archive: a property manager no longer sees it');
select is((select count(*) from hq.brand_resource_versions where resource_id = pg_temp.bid('wm')), 0::bigint, 'archive: ... nor its versions');
select is((select count(*) from storage.objects where bucket_id = 'brand-resources' and name in (:'p1', :'p5', :'p7')), 0::bigint, 'archive: ... nor its files');
select pg_temp.unbecome();
select is((select deleted_by from hq.brand_resources where id = pg_temp.bid('wm')), pg_temp.fx('dir'), 'archive: deleted_by is the caller');
select is((select summary from hq.audit_events where entity_type = 'brand_resource' and entity_id = pg_temp.bid('wm') and action = 'archive'), 'Archive brand_resource: pgTAP wordmark, forest [Superseded by the new mark]', 'audit: the archive carries its reason');
-- the title and the content are free while it is archived; restoring is refused until they are free again
select pg_temp.bpath(gen_random_uuid(), 'again.svg') as p8 \gset
select pg_temp.bobj(:'p8');
select pg_temp.become('dir');
select lives_ok(pg_temp.reg('pgTAP wordmark, forest', 'logos', :'p8', pg_temp.sha('wm5')), 'archive: the title and the content can be used again while the old resource is archived');
select throws_ok(format($$select hq.restore_brand_resource(%L)$$, pg_temp.bid('wm')), '23514', 'another resource already has that title', 'restore: refused while a live resource has the title');
select is(hq.archive_brand_resource((select id from hq.brand_resources where storage_path = :'p8'), 'duplicate') ->> 'archived', 'true', 'restore: (the newer one is archived)');
select throws_ok($$select hq.restore_brand_resource(gen_random_uuid())$$, 'P0002', 'resource not found', 'restore: an unknown resource is refused');
select is(hq.restore_brand_resource(pg_temp.bid('wm')) ->> 'archived', 'false', 'restore: a manager brings it back');
select throws_ok(format($$select hq.restore_brand_resource(%L)$$, pg_temp.bid('wm')), 'P0002', 'resource not found', 'restore: a live resource cannot be restored');
select pg_temp.unbecome();
select is((select deleted_at is null and deleted_by is null from hq.brand_resources where id = pg_temp.bid('wm')), true, 'restore: deleted_at and deleted_by are cleared');
select is(pg_temp.audits(pg_temp.bid('wm'), 'restore'), 1::bigint, 'audit: restoring is audited');

-- ------------------------------------------------------------ the importer function (service_role only)
select pg_temp.bpath(gen_random_uuid(), 'imported.css') as p9 \gset
select pg_temp.bobj(:'p9', 500, 'text/css');
select pg_temp.become_service();
select is(pg_temp.outcome(format($$select hq.import_brand_resource(%L, null, 'pgTAP imported', 'tokens', 'd', 'imported.css', %L, 'text/css', 500, %L)$$, pg_temp.fx('ro'), :'p9', pg_temp.sha('imp1'))), '42501', 'import: acting for a read-only person is refused');
select is(pg_temp.outcome(format($$select hq.import_brand_resource(%L, null, 'pgTAP imported', 'tokens', 'd', 'imported.css', %L, 'text/css', 500, %L)$$, pg_temp.fx('outsider'), :'p9', pg_temp.sha('imp1'))), '42501', 'import: acting for someone with no HQ profile is refused');
select is(pg_temp.outcome(format($$select hq.import_brand_resource(%L, null, 'pgTAP imported', 'tokens', 'd', 'imported.css', %L, 'text/css', 500, %L)$$, gen_random_uuid(), :'p9', pg_temp.sha('imp1'))), '42501', 'import: acting for an unknown person is refused');
insert into zz_b select 'imp', hq.import_brand_resource(pg_temp.fx('dir'), null, 'pgTAP imported', 'tokens', 'Imported from a folder', 'imported.css', :'p9', 'text/css', 500, pg_temp.sha('imp1'), array['imported'], 'Note from the importer', 3);
select set_config('request.jwt.claim.sub', '', true);
select pg_temp.unbecome();
select is((select created_by from hq.brand_resources where id = pg_temp.bid('imp')), pg_temp.fx('dir'), 'import: the resource is created by the person it acted for');
select is((select actor_name || '|' || actor_id::text from hq.audit_events where entity_type = 'brand_resource' and entity_id = pg_temp.bid('imp') and action = 'import'), 'Dana Director|' || pg_temp.fx('dir'), 'audit: the import is attributed to that person, with the action import');
select pg_temp.bpath(pg_temp.bid('imp'), 'imported-2.css') as p10 \gset
select pg_temp.bobj(:'p10', 600, 'text/css');
select pg_temp.become_service();
select is(hq.import_brand_resource(pg_temp.fx('dir'), pg_temp.bid('imp'), 'ignored', 'tokens', null, 'imported-2.css', :'p10', 'text/css', 600, pg_temp.sha('imp2'), '{}', null, 0, 'Changed in the source folder') ->> 'version_number', '2', 'import: a changed file is added as a new version of the same resource');
select throws_ok(format($$select hq.import_brand_resource(%L, %L, 't', 'tokens', null, 'imported-2.css', %L, 'text/css', 600, %L)$$, pg_temp.fx('dir'), pg_temp.bid('imp'), :'p10', pg_temp.sha('imp2')), '23505', null, 'import: the same object twice is refused');
select set_config('request.jwt.claim.sub', '', true);
select pg_temp.unbecome();
select is((select title || '|' || tags::text || '|' || coalesce(note, '') || '|' || sort_order from hq.brand_resources where id = pg_temp.bid('imp')), 'pgTAP imported|{imported}|Note from the importer|3', 'import: replacing a file leaves the title, tags, note and sort order alone');
select is((select count(*) from hq.brand_resource_versions where resource_id = pg_temp.bid('imp')), 2::bigint, 'import: both versions are kept');

-- ------------------------------------------------------------ audit trail
select is((select count(distinct actor_id) from hq.audit_events where entity_type = 'brand_resource' and entity_id = pg_temp.bid('wm')), 2::bigint, 'audit: the director and the administrator both appear on the first resource');
select is((select count(*) from hq.audit_events where entity_type = 'brand_resource' and action not in ('create', 'update', 'replace_file', 'archive', 'restore', 'import')), 0::bigint, 'audit: only the expected actions were written');

select * from finish();
rollback;
