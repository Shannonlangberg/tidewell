-- 0147_hq_function_acl_email_new_recipient.sql
-- Function privileges for 0146, stated for exactly the function it re-creates.
--
--   * hq.create_email_draft was dropped and created again with two more arguments, so the new
--     signature has the schema's default privileges: revoked from every API role here and granted to
--     authenticated only, as 0133 did for the old one;
--   * hq.begin_email_send was replaced with the same signature (CREATE OR REPLACE keeps its privileges),
--     so it is not mentioned.
-- The pgTAP totals in hq_01 check the end state across every migration (the function count is unchanged:
-- one dropped, one created).

revoke execute on function
  hq.create_email_draft(hq.email_template, text, text, uuid, uuid, uuid, text, text)
from public, anon, authenticated, service_role;

grant execute on function
  hq.create_email_draft(hq.email_template, text, text, uuid, uuid, uuid, text, text)
to authenticated;

notify pgrst, 'reload schema';
