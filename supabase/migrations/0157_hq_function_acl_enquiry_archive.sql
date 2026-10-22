-- 0157_hq_function_acl_enquiry_archive.sql
-- Function privileges for 0156. As in 0135:
--   * hq.archive_enquiry and hq.restore_enquiry are new, so they are revoked from every API role
--     (CREATE FUNCTION gives the schema's default privileges) and then granted to authenticated only;
--     each checks growth.write inside;
--   * CREATE OR REPLACE keeps a function's existing privileges, so hq.set_enquiry_status stays
--     authenticated only.
-- The pgTAP totals in hq_01 check the end state across every migration.

revoke execute on function
  hq.archive_enquiry(uuid, text),
  hq.restore_enquiry(uuid)
from public, anon, authenticated, service_role;

grant execute on function
  hq.archive_enquiry(uuid, text),
  hq.restore_enquiry(uuid)
to authenticated;

notify pgrst, 'reload schema';
