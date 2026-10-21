-- 0155_hq_function_acl_enquiry_auto_reply_not_begun.sql
-- Function privileges for 0154. As in 0137:
--   * hq.fail_enquiry_auto_reply is new, so it is revoked from every API role (CREATE FUNCTION gives the
--     schema's default privileges) and then granted to service_role ONLY: the website's server calls it
--     with the secret key (lib/hq/enquiry-intake.ts). It refuses a person's session inside as well;
--   * CREATE OR REPLACE keeps a function's existing privileges, so hq.begin_enquiry_auto_reply stays
--     service_role only and hq_private.enquiry_auto_reply_guard stays with nobody.
-- The pgTAP totals in hq_01 check the end state across every migration.

revoke execute on function hq.fail_enquiry_auto_reply(uuid, text) from public, anon, authenticated, service_role;

grant execute on function hq.fail_enquiry_auto_reply(uuid, text) to service_role;

notify pgrst, 'reload schema';
