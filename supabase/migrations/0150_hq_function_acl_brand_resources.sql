-- 0150_hq_function_acl_brand_resources.sql
-- Function privileges for Resources (0148, 0149).
--
-- Like 0139, this file states exactly the functions 0148 and 0149 create rather than revoking everything
-- and re-stating the whole list: a function created by CREATE FUNCTION gets the schema's default
-- privileges (execute for public, and on Supabase also for anon, authenticated and service_role), so each
-- new one is revoked from every API role here, and then granted where it is meant to be called.
-- The pgTAP totals in hq_01 check the end state across every migration.
--
-- hq_private: the brand helpers and the guard trigger are executable by NO API role: only the security
--   definer RPCs and the triggers reach them (the table's CHECK constraints call brand_mimes() as the
--   table owner, never as an API role: no API role can insert or update these tables).
-- hq: the five RPCs people use are executable by authenticated only; import_brand_resource by service_role
--   ONLY (the importer script holds the secret key; no signed-in person can call it).

revoke execute on function
  hq_private.brand_mimes(),
  hq_private.brand_resource_guard(),
  hq_private.brand_ref(bigint),
  hq_private.brand_line(text, integer, text),
  hq_private.brand_text(text, integer, text),
  hq_private.brand_check_upload(text, text, text, bigint, text),
  hq_private.brand_duplicate_check(hq.brand_resource_category, text, uuid),
  hq_private.brand_title_check(text, uuid),
  hq_private.brand_json(hq.brand_resources),
  hq_private.brand_create(text, hq.brand_resource_category, text, text, text, text, bigint, text, text[], text, integer, text),
  hq_private.brand_replace(uuid, text, text, text, bigint, text, text, text)
from public, anon, authenticated, service_role;

revoke execute on function
  hq.register_brand_resource(text, hq.brand_resource_category, text, text, text, text, bigint, text, text[], text, integer),
  hq.update_brand_resource(uuid, text, text, hq.brand_resource_category, text[], text, integer),
  hq.replace_brand_resource_file(uuid, text, text, text, bigint, text, text, text),
  hq.archive_brand_resource(uuid, text),
  hq.restore_brand_resource(uuid),
  hq.import_brand_resource(uuid, uuid, text, hq.brand_resource_category, text, text, text, text, bigint, text, text[], text, integer, text)
from public, anon, authenticated, service_role;

grant execute on function
  hq.register_brand_resource(text, hq.brand_resource_category, text, text, text, text, bigint, text, text[], text, integer),
  hq.update_brand_resource(uuid, text, text, hq.brand_resource_category, text[], text, integer),
  hq.replace_brand_resource_file(uuid, text, text, text, bigint, text, text, text),
  hq.archive_brand_resource(uuid, text),
  hq.restore_brand_resource(uuid)
to authenticated;

grant execute on function
  hq.import_brand_resource(uuid, uuid, text, hq.brand_resource_category, text, text, text, text, bigint, text, text[], text, integer, text)
to service_role;

notify pgrst, 'reload schema';
