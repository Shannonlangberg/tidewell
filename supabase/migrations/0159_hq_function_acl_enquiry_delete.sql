-- 0159_hq_function_acl_enquiry_delete.sql
-- Function privileges for 0158. As in 0157:
--   * hq.delete_enquiry is new: revoked from every API role, then granted to authenticated only (it
--     checks growth.delete and the director role inside);
--   * hq_private.enquiry_no_delete is a trigger function: no API role may execute it.
-- The pgTAP totals in hq_01 check the end state across every migration.

revoke execute on function hq_private.enquiry_no_delete() from public, anon, authenticated, service_role;

revoke execute on function hq.delete_enquiry(uuid, text) from public, anon, authenticated, service_role;
grant execute on function hq.delete_enquiry(uuid, text) to authenticated;

notify pgrst, 'reload schema';
