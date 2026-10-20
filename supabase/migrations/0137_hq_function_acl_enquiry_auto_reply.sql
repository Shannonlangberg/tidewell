-- 0137_hq_function_acl_enquiry_auto_reply.sql
-- Function privileges for the automatic thank-you (0136). As in 0135:
--   * every function 0136 CREATES is revoked from every API role (CREATE FUNCTION gives the schema's
--     default privileges);
--   * begin_enquiry_auto_reply and finish_enquiry_auto_reply are then granted to service_role ONLY: the
--     website's server calls them with the secret key (lib/hq/enquiry-intake.ts). anon and authenticated
--     can never call them, and each refuses a session inside as well;
--   * CREATE OR REPLACE keeps a function's existing privileges, so hq.mark_enquiry_spam keeps
--     authenticated and hq_private.settings_guard keeps nothing.
-- The pgTAP totals in hq_01 check the end state across every migration.

revoke execute on function
  hq_private.enquiry_auto_reply_guard(),
  hq_private.enquiry_ack_address_ok(text),
  hq_private.enquiry_ack_skip(hq.enquiries, text)
from public, anon, authenticated, service_role;

revoke execute on function
  hq.begin_enquiry_auto_reply(uuid),
  hq.finish_enquiry_auto_reply(uuid, boolean, text, text)
from public, anon, authenticated, service_role;

grant execute on function
  hq.begin_enquiry_auto_reply(uuid),
  hq.finish_enquiry_auto_reply(uuid, boolean, text, text)
to service_role;

notify pgrst, 'reload schema';
