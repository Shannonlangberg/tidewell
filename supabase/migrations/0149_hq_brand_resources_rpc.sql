-- 0149_hq_brand_resources_rpc.sql
-- The write side of Resources (0148): register a file the caller has ALREADY uploaded to the private
-- bucket brand-resources (signed upload URL, as with contractor documents, 0116), change a resource's
-- details, replace its file, archive and restore it, and one service-role function for the importer
-- (scripts/hq/import-brand-resources.mts).
--
-- Every RPC is security definer, pins its search_path, checks resources.manage INSIDE (the database, not
-- the caller's token, decides) and is audited as entity brand_resource. Function privileges: 0150.
-- Errors: 42501 permission denied, 22023 invalid argument, P0002 not found, 23505 already registered,
-- 23514 a rule (same content already in the category, title taken, nothing to replace with).
--
-- THE OBJECT RULE: an object must exist in brand-resources at <resource id>/<object id>-<sanitised name>
-- (sanitised name: 1-120 of A-Z a-z 0-9 . _ -), and its stored size and type must equal what was declared.
-- A new resource takes its id from the first part of the path; a replacement uses the resource's own id
-- and a NEW object id, and the old object is kept (it stays downloadable from the version list).

-- ------------------------------------------------------------------ helpers (no API role may execute these: 0150)
create function hq_private.brand_ref(p_n bigint) returns text
language sql immutable parallel safe set search_path = pg_catalog as $$
  select 'RES-' || lpad(p_n::text, greatest(4, length(p_n::text)), '0')
$$;

-- One line a person typed (title, label, note): control characters become spaces, runs collapse, trimmed, bounded.
create function hq_private.brand_line(p_value text, p_max integer, p_what text) returns text
language plpgsql immutable set search_path = pg_catalog as $$
declare
  v text := nullif(btrim(regexp_replace(regexp_replace(coalesce(p_value, ''), '[[:cntrl:]]', ' ', 'g'), ' {2,}', ' ', 'g')), '');
begin
  if v is not null and char_length(v) > p_max then
    raise exception '% is at most % characters', p_what, p_max using errcode = 'invalid_parameter_value';
  end if;
  return v;
end $$;

-- Free text (description): line breaks kept, other control characters out, trimmed, bounded.
create function hq_private.brand_text(p_value text, p_max integer, p_what text) returns text
language plpgsql immutable set search_path = pg_catalog as $$
declare
  v text := nullif(btrim(regexp_replace(regexp_replace(coalesce(p_value, ''), E'\r\n?', E'\n', 'g'), E'[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]', '', 'g'), E' \t\n'), '');
begin
  if v is not null and char_length(v) > p_max then
    raise exception '% is at most % characters', p_what, p_max using errcode = 'invalid_parameter_value';
  end if;
  return v;
end $$;

-- The checks every new file goes through: the declared details, then the stored object itself.
-- Returns the cleaned file name.
create function hq_private.brand_check_upload(p_file_name text, p_path text, p_mime text, p_size bigint, p_sha text)
returns text
language plpgsql stable security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_file text := btrim(coalesce(p_file_name, ''));
  v_meta jsonb;
begin
  if v_file = '' or char_length(v_file) > 255 then
    raise exception 'a file name (at most 255 characters) is required' using errcode = 'invalid_parameter_value';
  end if;
  if p_mime is null or not (lower(btrim(p_mime)) = any (hq_private.brand_mimes())) then
    raise exception 'only SVG, PNG, JPEG, PDF, CSS, JavaScript, JSON, Markdown, text, HTML, ZIP and font files are accepted' using errcode = 'invalid_parameter_value';
  end if;
  if p_size is null or p_size <= 0 or p_size > 10485760 then
    raise exception 'a file must be larger than 0 bytes and at most 10 MiB' using errcode = 'invalid_parameter_value';
  end if;
  if p_sha is null or lower(btrim(p_sha)) !~ '^[0-9a-f]{64}$' then
    raise exception 'the file fingerprint (SHA-256) is not valid' using errcode = 'invalid_parameter_value';
  end if;
  if p_path is null or p_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9._-]{1,120}$' then
    raise exception 'the storage path must be <resource id>/<object id>-<file name>' using errcode = 'invalid_parameter_value';
  end if;
  select o.metadata into v_meta from storage.objects o where o.bucket_id = 'brand-resources' and o.name = p_path;
  if not found then
    raise exception 'the uploaded file was not found in storage' using errcode = 'no_data_found';
  end if;
  if (v_meta ->> 'size') is null or (v_meta ->> 'size')::bigint <> p_size then
    raise exception 'the stored file size does not match the declared size' using errcode = 'invalid_parameter_value';
  end if;
  if lower(btrim(split_part(coalesce(v_meta ->> 'mimetype', ''), ';', 1))) <> lower(btrim(p_mime)) then
    raise exception 'the stored file type does not match the declared type' using errcode = 'invalid_parameter_value';
  end if;
  return v_file;
end $$;

-- The same content cannot be live in the same category twice; p_except is the resource being changed.
create function hq_private.brand_duplicate_check(p_category hq.brand_resource_category, p_sha text, p_except uuid) returns void
language plpgsql stable security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_other hq.brand_resources;
begin
  select * into v_other from hq.brand_resources r
  where r.category = p_category and r.content_sha256 = lower(btrim(p_sha)) and r.deleted_at is null and r.id is distinct from p_except
  limit 1;
  if found then
    raise exception 'this file is already in the library as % "%" (the same content in the same category)', hq_private.brand_ref(v_other.ref_number), v_other.title
      using errcode = 'check_violation', hint = 'brand_duplicate_file';
  end if;
end $$;

create function hq_private.brand_title_check(p_title text, p_except uuid) returns void
language plpgsql stable security definer set search_path = pg_catalog, public, extensions as $$
begin
  if exists (select 1 from hq.brand_resources r where r.deleted_at is null and lower(btrim(r.title)) = lower(btrim(p_title)) and r.id is distinct from p_except) then
    raise exception 'another resource already has that title' using errcode = 'check_violation', hint = 'brand_title_taken';
  end if;
end $$;

create function hq_private.brand_json(p_r hq.brand_resources) returns jsonb
language sql stable set search_path = pg_catalog, public, extensions as $$
  select jsonb_build_object(
    'resource_id', p_r.id, 'ref', hq_private.brand_ref(p_r.ref_number), 'ref_number', p_r.ref_number,
    'title', p_r.title, 'category', p_r.category, 'file_name', p_r.file_name, 'mime_type', p_r.mime_type,
    'size_bytes', p_r.size_bytes, 'version', p_r.version, 'archived', p_r.deleted_at is not null)
$$;

-- ------------------------------------------------------------------ create (shared by register and import)
-- Runs as the person in auth.uid() (a real session, or the actor the importer function sets).
create function hq_private.brand_create(
  p_title text,
  p_category hq.brand_resource_category,
  p_description text,
  p_file_name text,
  p_storage_path text,
  p_mime_type text,
  p_size_bytes bigint,
  p_content_sha256 text,
  p_tags text[],
  p_note text,
  p_sort_order integer,
  p_audit_action text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_actor uuid := auth.uid();
  v_title text := hq_private.brand_line(p_title, 200, 'a title');
  v_desc text := hq_private.brand_text(p_description, 2000, 'a description');
  v_note text := hq_private.brand_line(p_note, 1000, 'a note');
  v_file text;
  v_mime text := lower(btrim(coalesce(p_mime_type, '')));
  v_sha text := lower(btrim(coalesce(p_content_sha256, '')));
  v_id uuid;
  v_r hq.brand_resources;
begin
  if v_title is null then
    raise exception 'a resource needs a title (at most 200 characters)' using errcode = 'invalid_parameter_value';
  end if;
  if p_category is null then
    raise exception 'choose a category' using errcode = 'invalid_parameter_value';
  end if;
  if coalesce(p_sort_order, 0) not between 0 and 9999 then
    raise exception 'the sort order is a number from 0 to 9999' using errcode = 'invalid_parameter_value';
  end if;
  v_file := hq_private.brand_check_upload(p_file_name, p_storage_path, v_mime, p_size_bytes, v_sha);
  v_id := split_part(p_storage_path, '/', 1)::uuid;
  if exists (select 1 from hq.brand_resources r where r.id = v_id or r.storage_path = p_storage_path)
     or exists (select 1 from hq.brand_resource_versions v where v.storage_path = p_storage_path) then
    raise exception 'that file is already registered' using errcode = 'unique_violation';
  end if;
  perform hq_private.brand_title_check(v_title, null);
  perform hq_private.brand_duplicate_check(p_category, v_sha, null);

  perform hq_private.audit_context(p_audit_action, null);
  insert into hq.brand_resources (id, title, description, category, file_name, storage_path, mime_type, size_bytes, content_sha256, tags, sort_order, version, note)
  values (v_id, v_title, v_desc, p_category, v_file, p_storage_path, v_mime, p_size_bytes, v_sha, coalesce(p_tags, '{}'), coalesce(p_sort_order, 0), 'v1', v_note)
  returning * into v_r;
  perform hq_private.audit_context();
  insert into hq.brand_resource_versions (resource_id, version_number, label, file_name, storage_path, mime_type, size_bytes, content_sha256, change_note, created_by, created_by_name)
  values (v_r.id, 1, 'v1', v_r.file_name, v_r.storage_path, v_r.mime_type, v_r.size_bytes, v_r.content_sha256, 'First version', v_actor,
          (select sp.full_name from hq.staff_profiles sp where sp.id = v_actor));
  return hq_private.brand_json(v_r) || jsonb_build_object('version_number', 1, 'changed', true);
end $$;

-- ------------------------------------------------------------------ replace (shared by replace and import)
create function hq_private.brand_replace(
  p_id uuid,
  p_file_name text,
  p_storage_path text,
  p_mime_type text,
  p_size_bytes bigint,
  p_content_sha256 text,
  p_label text,
  p_change_note text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_actor uuid := auth.uid();
  v_r hq.brand_resources;
  v_file text;
  v_mime text := lower(btrim(coalesce(p_mime_type, '')));
  v_sha text := lower(btrim(coalesce(p_content_sha256, '')));
  v_label text := hq_private.brand_line(p_label, 40, 'a version label');
  v_note text := hq_private.brand_line(p_change_note, 300, 'a change note');
  v_n integer;
begin
  select * into v_r from hq.brand_resources r where r.id = p_id and r.deleted_at is null for update;
  if not found then
    raise exception 'resource not found' using errcode = 'no_data_found';
  end if;
  v_file := hq_private.brand_check_upload(p_file_name, p_storage_path, v_mime, p_size_bytes, v_sha);
  if split_part(p_storage_path, '/', 1) <> p_id::text then
    raise exception 'the storage path must start with this resource''s id' using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from hq.brand_resource_versions v where v.storage_path = p_storage_path) then
    raise exception 'that file is already registered' using errcode = 'unique_violation';
  end if;
  if v_sha = v_r.content_sha256 then
    raise exception 'that file is the same as the current version' using errcode = 'check_violation', hint = 'brand_no_change';
  end if;
  perform hq_private.brand_duplicate_check(v_r.category, v_sha, v_r.id);

  select coalesce(max(v.version_number), 0) + 1 into v_n from hq.brand_resource_versions v where v.resource_id = v_r.id;
  v_label := coalesce(v_label, 'v' || v_n);
  perform hq_private.audit_context('replace_file', left(coalesce(v_note, v_label), 200));
  update hq.brand_resources set file_name = v_file, storage_path = p_storage_path, mime_type = v_mime, size_bytes = p_size_bytes,
         content_sha256 = v_sha, version = v_label
   where id = v_r.id
  returning * into v_r;
  perform hq_private.audit_context();
  insert into hq.brand_resource_versions (resource_id, version_number, label, file_name, storage_path, mime_type, size_bytes, content_sha256, change_note, created_by, created_by_name)
  values (v_r.id, v_n, v_label, v_r.file_name, v_r.storage_path, v_r.mime_type, v_r.size_bytes, v_r.content_sha256, v_note, v_actor,
          (select sp.full_name from hq.staff_profiles sp where sp.id = v_actor));
  return hq_private.brand_json(v_r) || jsonb_build_object('version_number', v_n, 'changed', true);
end $$;

-- ------------------------------------------------------------------ register_brand_resource
create function hq.register_brand_resource(
  p_title text,
  p_category hq.brand_resource_category,
  p_description text,
  p_file_name text,
  p_storage_path text,
  p_mime_type text,
  p_size_bytes bigint,
  p_content_sha256 text,
  p_tags text[] default '{}',
  p_note text default null,
  p_sort_order integer default 0
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('resources.manage');
  return hq_private.brand_create(p_title, p_category, p_description, p_file_name, p_storage_path, p_mime_type, p_size_bytes, p_content_sha256, p_tags, p_note, p_sort_order, null);
end $$;
comment on function hq.register_brand_resource(text, hq.brand_resource_category, text, text, text, text, bigint, text, text[], text, integer) is 'resources.manage. Registers an uploaded object: it must exist in brand-resources at <resource id>/<object id>-<name> with the declared size and type. Title 1-200 (unique among live resources), description up to 2000, note up to 1000, up to 12 tags, sort order 0-9999, SHA-256 fingerprint; the same content cannot be live in the same category twice. Audited. Returns the resource json plus {version_number, changed}.';

-- ------------------------------------------------------------------ update_brand_resource
-- The whole editable set every time (a form): an empty description or note clears it.
create function hq.update_brand_resource(
  p_id uuid,
  p_title text,
  p_description text,
  p_category hq.brand_resource_category,
  p_tags text[],
  p_note text,
  p_sort_order integer
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_r hq.brand_resources;
  v_title text := hq_private.brand_line(p_title, 200, 'a title');
  v_desc text := hq_private.brand_text(p_description, 2000, 'a description');
  v_note text := hq_private.brand_line(p_note, 1000, 'a note');
  v_tags text[];
  v_tag text;
  v_new hq.brand_resources;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('resources.manage');
  if v_title is null then
    raise exception 'a resource needs a title (at most 200 characters)' using errcode = 'invalid_parameter_value';
  end if;
  if p_category is null then
    raise exception 'choose a category' using errcode = 'invalid_parameter_value';
  end if;
  if coalesce(p_sort_order, 0) not between 0 and 9999 then
    raise exception 'the sort order is a number from 0 to 9999' using errcode = 'invalid_parameter_value';
  end if;
  select * into v_r from hq.brand_resources r where r.id = p_id and r.deleted_at is null for update;
  if not found then
    raise exception 'resource not found' using errcode = 'no_data_found';
  end if;
  -- compare the tidied tags (the guard tidies them again on write)
  v_tags := '{}';
  foreach v_tag in array coalesce(p_tags, '{}') loop
    v_tag := lower(btrim(regexp_replace(coalesce(v_tag, ''), '\s+', ' ', 'g')));
    if v_tag <> '' and not (v_tag = any (v_tags)) then v_tags := v_tags || v_tag; end if;
  end loop;
  if lower(v_title) <> lower(v_r.title) then
    perform hq_private.brand_title_check(v_title, v_r.id);
  end if;
  if p_category is distinct from v_r.category then
    perform hq_private.brand_duplicate_check(p_category, v_r.content_sha256, v_r.id);
  end if;
  if (v_title, v_desc, p_category, v_tags, v_note, coalesce(p_sort_order, 0))
     is not distinct from (v_r.title, v_r.description, v_r.category, v_r.tags, v_r.note, v_r.sort_order) then
    return hq_private.brand_json(v_r) || jsonb_build_object('changed', false);
  end if;
  update hq.brand_resources set title = v_title, description = v_desc, category = p_category, tags = v_tags, note = v_note,
         sort_order = coalesce(p_sort_order, 0)
   where id = v_r.id
  returning * into v_new;
  return hq_private.brand_json(v_new) || jsonb_build_object('changed', true);
end $$;
comment on function hq.update_brand_resource(uuid, text, text, hq.brand_resource_category, text[], text, integer) is 'resources.manage. Changes a live resource''s title, description, category, tags, note and sort order (the whole set: an empty description or note clears it). The file is changed only by replace_brand_resource_file. Audited with a from/to diff. Returns the resource json plus {changed}.';

-- ------------------------------------------------------------------ replace_brand_resource_file
create function hq.replace_brand_resource_file(
  p_id uuid,
  p_file_name text,
  p_storage_path text,
  p_mime_type text,
  p_size_bytes bigint,
  p_content_sha256 text,
  p_version_label text default null,
  p_change_note text default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('resources.manage');
  return hq_private.brand_replace(p_id, p_file_name, p_storage_path, p_mime_type, p_size_bytes, p_content_sha256, p_version_label, p_change_note);
end $$;
comment on function hq.replace_brand_resource_file(uuid, text, text, text, bigint, text, text, text) is 'resources.manage. Registers a NEW uploaded object as the resource''s current file (the path starts with the resource''s id and uses a new object id), keeps the old object, adds a version row and bumps the version label (v2, v3, ... or the label given, up to 40 characters). Refused when the content is the same as the current file or is already live in the category. Audited as replace_file. Returns the resource json plus {version_number, changed}.';

-- ------------------------------------------------------------------ archive_brand_resource / restore_brand_resource
create function hq.archive_brand_resource(p_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_r hq.brand_resources;
  v_reason text := hq_private.brand_line(p_reason, 200, 'a reason');
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('resources.manage');
  select * into v_r from hq.brand_resources r where r.id = p_id and r.deleted_at is null for update;
  if not found then
    raise exception 'resource not found' using errcode = 'no_data_found';
  end if;
  perform hq_private.audit_context(null, v_reason);
  update hq.brand_resources set deleted_at = now() where id = v_r.id returning * into v_r;
  perform hq_private.audit_context();
  return hq_private.brand_json(v_r) || jsonb_build_object('changed', true);
end $$;
comment on function hq.archive_brand_resource(uuid, text) is 'resources.manage. Soft-archives a resource (it leaves the library for everyone except managers, who can restore it). The file and every version are kept. Audited with the reason. Returns the resource json plus {changed}.';

create function hq.restore_brand_resource(p_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_r hq.brand_resources;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('resources.manage');
  select * into v_r from hq.brand_resources r where r.id = p_id and r.deleted_at is not null for update;
  if not found then
    raise exception 'resource not found' using errcode = 'no_data_found';
  end if;
  perform hq_private.brand_title_check(v_r.title, v_r.id);
  perform hq_private.brand_duplicate_check(v_r.category, v_r.content_sha256, v_r.id);
  update hq.brand_resources set deleted_at = null where id = v_r.id returning * into v_r;
  return hq_private.brand_json(v_r) || jsonb_build_object('changed', true);
end $$;
comment on function hq.restore_brand_resource(uuid) is 'resources.manage. Brings an archived resource back. Refused when a live resource now has the same title, or the same content in the same category. Audited. Returns the resource json plus {changed}.';

-- ------------------------------------------------------------------ import_brand_resource (service_role only)
-- For scripts/hq/import-brand-resources.mts. The importer has the project's secret key and no signed-in
-- person, so the function takes the person it acts for: an ACTIVE member of staff holding resources.manage
-- (checked here, without a session: the secret key is the trust anchor, as for submit_enquiry). The rest of
-- the transaction runs as that person, so the audit trail names them. p_resource null creates a resource;
-- a resource id replaces its file (the importer's "a changed file becomes a new version").
create function hq.import_brand_resource(
  p_actor uuid,
  p_resource uuid,
  p_title text,
  p_category hq.brand_resource_category,
  p_description text,
  p_file_name text,
  p_storage_path text,
  p_mime_type text,
  p_size_bytes bigint,
  p_content_sha256 text,
  p_tags text[] default '{}',
  p_note text default null,
  p_sort_order integer default 0,
  p_change_note text default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
begin
  if not exists (
    select 1 from hq.staff_profiles sp join hq.role_capabilities rc on rc.role = sp.role
    where sp.id = p_actor and sp.is_active and sp.employment_status = 'active' and rc.capability = 'resources.manage'
  ) then
    raise exception 'permission denied' using errcode = 'insufficient_privilege', detail = 'the import must act for an active member of staff holding resources.manage';
  end if;
  perform set_config('request.jwt.claim.sub', p_actor::text, true);
  if p_resource is null then
    return hq_private.brand_create(p_title, p_category, p_description, p_file_name, p_storage_path, p_mime_type, p_size_bytes, p_content_sha256, p_tags, p_note, p_sort_order, 'import');
  end if;
  return hq_private.brand_replace(p_resource, p_file_name, p_storage_path, p_mime_type, p_size_bytes, p_content_sha256, null, p_change_note);
end $$;
comment on function hq.import_brand_resource(uuid, uuid, text, hq.brand_resource_category, text, text, text, text, bigint, text, text[], text, integer, text) is 'service_role only (the importer script). Acts for an active member of staff holding resources.manage: creates a resource (p_resource null, audited as import) or replaces a resource''s file (a new version). Same rules and errors as register_brand_resource / replace_brand_resource_file. Returns the resource json plus {version_number, changed}.';
