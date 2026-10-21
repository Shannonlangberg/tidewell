-- 0148_hq_brand_resources.sql
-- Resources: the home of PLANTED.'s branding in HQ (brand guide, logos, photos, colours and type,
-- design tokens, UI kit code). Every member of staff can view and download it, connected chat apps can
-- list, read and fetch it (hq-mcp.md section 14), and a director or administrator adds to it and
-- updates it. Same patterns as the contractor documents (0112, 0114, 0116: private bucket, signed upload
-- URL, then a register RPC) and the Knowledge base (0138).
--
-- TABLES (schema hq; RLS enabled and forced; the API may only SELECT; every write goes through the
-- security definer RPCs in 0149):
--   brand_resources          one row per resource, shown as RES-0001 (ref_number). It describes the CURRENT
--                            file. Soft deletion only (archive_brand_resource / restore_brand_resource);
--                            never deleted, and no stored object is ever removed.
--   brand_resource_versions  one row per file a resource has had (append-only). Replacing a file keeps
--                            the old object and adds a row; the resource points at the newest.
--
-- CAPABILITIES (data, in hq.role_capabilities; an assumption for the owner to confirm):
--   resources.read    every role that can sign in to HQ (all eight, read-only and junior property manager included)
--   resources.manage  director, administrator (add a file, change its details, replace its file, archive, restore)
--
-- THE BUCKET brand-resources is private (no public URL ever works), 10 MiB per file, with a type
-- allowlist. Staff holding resources.read may read an object whose resource they can see; staff holding
-- resources.manage may add an object under <resource id>/<object id>-<file name>. There is no update or
-- delete policy, so nobody can overwrite or remove a stored file through the API (no upsert).
--
-- RULES (database-enforced): title 1-200 (unique among live resources, ignoring case); description up
-- to 2000; note up to 1000 (shown as a banner on the resource); at most 12 tags of 1-40 characters;
-- sort order 0-9999; a SHA-256 fingerprint of the content; the same content cannot be in the same
-- category twice (live rows).

-- ------------------------------------------------------------------ enum
create type hq.brand_resource_category as enum ('guidelines', 'logos', 'photos', 'colours_type', 'tokens', 'ui_kit', 'other');

-- ------------------------------------------------------------------ capabilities (an assumption for the owner to confirm)
insert into hq.role_capabilities (role, capability)
select r.role::hq.staff_role, r.capability
from (values
  ('director', 'resources.read'), ('director', 'resources.manage'),
  ('administrator', 'resources.read'), ('administrator', 'resources.manage'),
  ('senior_property_manager', 'resources.read'),
  ('property_manager', 'resources.read'),
  ('junior_property_manager', 'resources.read'),
  ('business_development_manager', 'resources.read'),
  ('virtual_assistant', 'resources.read'),
  ('read_only', 'resources.read')
) as r(role, capability)
on conflict do nothing;

-- ------------------------------------------------------------------ the one list of accepted file types
-- Used by the bucket, the table and the RPCs, so the three can never disagree. Not granted to any API role (0150).
create function hq_private.brand_mimes() returns text[]
language sql immutable parallel safe set search_path = pg_catalog as $$
  select array[
    'image/svg+xml', 'image/png', 'image/jpeg', 'application/pdf',
    'text/css', 'text/javascript', 'application/json', 'text/markdown', 'text/plain', 'text/html',
    'application/zip', 'font/woff', 'font/woff2', 'font/ttf', 'font/otf'
  ]::text[]
$$;

-- ------------------------------------------------------------------ storage: the private bucket
-- Created here, not only in config.toml, so every project gets the same bucket. Private: files are read
-- through short-lived signed URLs made with the person's own session.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('brand-resources', 'brand-resources', false, 10485760, hq_private.brand_mimes())
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ------------------------------------------------------------------ brand_resources
create table hq.brand_resources (
  id uuid primary key default gen_random_uuid(),
  ref_number bigint generated always as identity,
  title text not null,
  description text,
  category hq.brand_resource_category not null,
  file_name text not null,
  storage_path text not null,
  mime_type text not null,
  size_bytes bigint not null,
  content_sha256 text not null,
  tags text[] not null default '{}',
  sort_order integer not null default 0,
  version text not null default 'v1',
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  constraint brand_resources_title_length check (char_length(btrim(title)) between 1 and 200),
  constraint brand_resources_description_length check (description is null or char_length(description) <= 2000),
  constraint brand_resources_note_length check (note is null or char_length(btrim(note)) between 1 and 1000),
  constraint brand_resources_file_name_length check (char_length(btrim(file_name)) between 1 and 255),
  constraint brand_resources_mime_allowed check (mime_type = any (hq_private.brand_mimes())),
  constraint brand_resources_size_allowed check (size_bytes > 0 and size_bytes <= 10485760),
  constraint brand_resources_sha256_shape check (content_sha256 ~ '^[0-9a-f]{64}$'),
  constraint brand_resources_tags_count check (cardinality(tags) <= 12),
  constraint brand_resources_sort_order_range check (sort_order between 0 and 9999),
  constraint brand_resources_version_length check (char_length(btrim(version)) between 1 and 40),
  -- <resource id>/<object id>-<sanitised file name>: the object belongs to this resource
  constraint brand_resources_path_shape check (
    storage_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9._-]{1,120}$'
    and split_part(storage_path, '/', 1) = id::text),
  constraint brand_resources_deleted_by_needs_deleted_at check (deleted_by is null or deleted_at is not null)
);
comment on table hq.brand_resources is 'The brand library. ref_number is shown as RES-0001. The row describes the CURRENT file (older files are in brand_resource_versions). Registered by register_brand_resource after a direct upload to the private bucket brand-resources; changed only through the brand RPCs. Soft deletion only; stored objects are retained.';
comment on column hq.brand_resources.note is 'A short warning shown as a banner on the resource (for example that part of a document is out of date).';
comment on column hq.brand_resources.content_sha256 is 'SHA-256 of the file, lower-case hex. The same content cannot be live in the same category twice.';
comment on column hq.brand_resources.version is 'The label of the current file: v1, v2, ... (or a label given when the file was replaced).';
create unique index brand_resources_ref_number_uq on hq.brand_resources (ref_number);
create unique index brand_resources_storage_path_uq on hq.brand_resources (storage_path);
create unique index brand_resources_title_uq on hq.brand_resources (lower(btrim(title))) where deleted_at is null;
create unique index brand_resources_content_uq on hq.brand_resources (category, content_sha256) where deleted_at is null;
create index brand_resources_list_idx on hq.brand_resources (category, sort_order, title) where deleted_at is null;

-- ------------------------------------------------------------------ brand_resource_versions (append-only)
create table hq.brand_resource_versions (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references hq.brand_resources (id),
  version_number integer not null,
  label text not null,
  file_name text not null,
  storage_path text not null,
  mime_type text not null,
  size_bytes bigint not null,
  content_sha256 text not null,
  change_note text,
  created_at timestamptz not null default now(),
  created_by uuid,
  created_by_name text,
  constraint brand_resource_versions_number_positive check (version_number >= 1),
  constraint brand_resource_versions_label_length check (char_length(btrim(label)) between 1 and 40),
  constraint brand_resource_versions_change_note_length check (change_note is null or char_length(change_note) <= 300),
  constraint brand_resource_versions_mime_allowed check (mime_type = any (hq_private.brand_mimes())),
  constraint brand_resource_versions_sha256_shape check (content_sha256 ~ '^[0-9a-f]{64}$'),
  constraint brand_resource_versions_resource_number_key unique (resource_id, version_number),
  constraint brand_resource_versions_storage_path_key unique (storage_path)
);
comment on table hq.brand_resource_versions is 'Every file a brand resource has had, newest last (append-only). Written inside register_brand_resource and replace_brand_resource_file; the old object is kept so an earlier version can still be downloaded.';

-- ------------------------------------------------------------------ guards
-- Every writer, including the table owner: tidy the text, check the tags, keep the number fixed.
create function hq_private.brand_resource_guard() returns trigger
language plpgsql set search_path = pg_catalog, public, extensions as $$
declare
  v_tags text[];
  v_tag text;
begin
  new.title := btrim(new.title);
  new.description := nullif(btrim(coalesce(new.description, '')), '');
  new.note := nullif(btrim(coalesce(new.note, '')), '');
  new.file_name := btrim(new.file_name);
  new.version := btrim(new.version);
  new.content_sha256 := lower(btrim(new.content_sha256));
  -- tags: lower case, single spaces, no duplicates, 1-40 characters of letters, numbers, space and - . _ : /
  v_tags := '{}';
  foreach v_tag in array coalesce(new.tags, '{}') loop
    v_tag := lower(btrim(regexp_replace(coalesce(v_tag, ''), '\s+', ' ', 'g')));
    if v_tag !~ '^[a-z0-9][a-z0-9 ._:/-]{0,39}$' then
      raise exception 'tags are 1 to 40 characters: letters, numbers, spaces and - . _ : /' using errcode = 'invalid_parameter_value';
    end if;
    if not (v_tag = any (v_tags)) then
      v_tags := v_tags || v_tag;
    end if;
  end loop;
  if cardinality(v_tags) > 12 then
    raise exception 'at most 12 tags' using errcode = 'invalid_parameter_value';
  end if;
  new.tags := v_tags;
  if tg_op = 'UPDATE' then
    if new.ref_number is distinct from old.ref_number then
      raise exception 'a resource''s number cannot change' using errcode = 'insufficient_privilege';
    end if;
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  else
    new.updated_by := null;
  end if;
  return new;
end $$;

create trigger row_stamp before insert or update on hq.brand_resources for each row execute function hq_private.row_stamp();
create trigger soft_delete_guard before insert or update on hq.brand_resources for each row execute function hq_private.soft_delete_guard();
create trigger brand_resource_guard before insert or update on hq.brand_resources for each row execute function hq_private.brand_resource_guard();
create trigger no_delete before delete on hq.brand_resources for each row execute function hq_private.raise_immutable();
create trigger no_truncate before truncate on hq.brand_resources for each statement execute function hq_private.raise_immutable();
create trigger audit after insert or update or delete on hq.brand_resources for each row execute function hq_private.audit_row('brand_resource');

create trigger append_only before update or delete on hq.brand_resource_versions for each row execute function hq_private.raise_immutable();
create trigger append_only_truncate before truncate on hq.brand_resource_versions for each statement execute function hq_private.raise_immutable();

-- ------------------------------------------------------------------ access
alter table hq.brand_resources enable row level security;          alter table hq.brand_resources force row level security;
alter table hq.brand_resource_versions enable row level security;  alter table hq.brand_resource_versions force row level security;

-- Readers see live resources; archived ones only resources.manage holders (who can restore them).
create policy brand_resources_select on hq.brand_resources for select to authenticated
  using ((select hq_private.has_capability('resources.read'))
         and (deleted_at is null or (select hq_private.has_capability('resources.manage'))));
-- Versions of a resource the reader can see (the subquery runs under the reader's RLS).
create policy brand_resource_versions_select on hq.brand_resource_versions for select to authenticated
  using ((select hq_private.has_capability('resources.read'))
         and exists (select 1 from hq.brand_resources r where r.id = resource_id));

revoke all on hq.brand_resources, hq.brand_resource_versions from public, anon, authenticated, service_role;
grant select on hq.brand_resources, hq.brand_resource_versions to authenticated, service_role;

-- Objects: staff holding resources.read may read an object that belongs to a resource version they can see
-- (an archived resource's files are visible to managers only); staff holding resources.manage may add
-- files under <resource id>/<object id>-<sanitised file name> and read any object under that shape, so
-- the server can check a file they have just uploaded BEFORE it is registered (the register RPC then
-- checks the object again). No update or delete policy, so nobody can overwrite or remove a stored file
-- through the API. No policy for anon.
create policy hq_brand_resources_select on storage.objects for select to authenticated
  using (
    bucket_id = 'brand-resources'
    and objects.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9._-]{1,120}$'
    and ((select hq_private.has_capability('resources.manage'))
         or ((select hq_private.has_capability('resources.read'))
             and exists (select 1 from hq.brand_resource_versions v where v.storage_path = objects.name)))
  );
create policy hq_brand_resources_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'brand-resources'
    and (select hq_private.has_capability('resources.manage'))
    and objects.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9._-]{1,120}$'
  );

-- ------------------------------------------------------------------ the overview (list, detail)
-- security_invoker: the reader's RLS applies to both tables it reads.
create view hq.brand_resource_overview with (security_invoker = true) as
select
  r.id,
  r.ref_number,
  'RES-' || lpad(r.ref_number::text, greatest(4, length(r.ref_number::text)), '0') as ref,
  r.title,
  r.description,
  r.category,
  r.file_name,
  r.storage_path,
  r.mime_type,
  r.size_bytes,
  r.content_sha256,
  r.tags,
  r.sort_order,
  r.version,
  r.note,
  coalesce((select max(v.version_number) from hq.brand_resource_versions v where v.resource_id = r.id), 1) as version_number,
  r.created_by,
  cb.full_name as created_by_name,
  r.updated_by,
  ub.full_name as updated_by_name,
  r.created_at,
  r.updated_at,
  r.deleted_at
from hq.brand_resources r
left join hq.staff_profiles cb on cb.id = r.created_by
left join hq.staff_profiles ub on ub.id = r.updated_by;
comment on view hq.brand_resource_overview is 'One row per brand resource the reader can see: RES-0001 ref, who added it and who last changed it, and the number of its current version. Filter deleted_at is null for the live library.';
revoke all on hq.brand_resource_overview from public, anon, authenticated, service_role;
grant select on hq.brand_resource_overview to authenticated;
