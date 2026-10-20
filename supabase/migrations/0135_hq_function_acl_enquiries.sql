-- 0135_hq_function_acl_enquiries.sql
-- Function privileges for website enquiries (0134).
--
-- Like 0133, this file states exactly the functions 0134 creates:
--   * a function created by CREATE FUNCTION gets the schema's default privileges (execute for public,
--     and on Supabase also for anon, authenticated and service_role), so each new one is revoked from
--     every API role here;
--   * hq.submit_enquiry is then granted to service_role ONLY: the public website calls it from the
--     server with the secret key (lib/hq/enquiry-intake.ts). anon and authenticated can never call it,
--     so a forged browser call is refused by the database, not only by the site;
--   * the three staff RPCs are granted to authenticated only (each checks its capability inside);
--   * CREATE OR REPLACE keeps a function's existing privileges, so hq_private.settings_guard keeps
--     what it had (nothing for any API role).
-- The pgTAP totals in hq_01 check the end state across every migration.

revoke execute on function
  hq_private.enquiry_guard(),
  hq_private.enquiry_owner_ok(uuid),
  hq_private.enquiry_ref(bigint),
  hq_private.enquiry_line(text, integer, text),
  hq_private.enquiry_message(text),
  hq_private.enquiry_details(jsonb),
  hq_private.enquiry_json(hq.enquiries, boolean)
from public, anon, authenticated, service_role;

revoke execute on function
  hq.submit_enquiry(hq.enquiry_kind, text, text, text, text, text, jsonb, text, text),
  hq.mark_enquiry_spam(uuid, text),
  hq.set_enquiry_status(uuid, hq.enquiry_status, text),
  hq.set_enquiry_owner(uuid)
from public, anon, authenticated, service_role;

grant execute on function hq.submit_enquiry(hq.enquiry_kind, text, text, text, text, text, jsonb, text, text) to service_role;

grant execute on function
  hq.mark_enquiry_spam(uuid, text),
  hq.set_enquiry_status(uuid, hq.enquiry_status, text),
  hq.set_enquiry_owner(uuid)
to authenticated;

notify pgrst, 'reload schema';
