-- 0133_hq_function_acl_email.sql
-- Function privileges for email drafting and sending (0132).
--
-- Like 0131, this file states exactly the functions 0132 creates rather than revoking everything and
-- re-stating the whole list (the leads and portfolio migrations, built in parallel, own theirs):
--   * a function created by CREATE FUNCTION gets the schema's default privileges (execute for public,
--     and on Supabase also for anon, authenticated and service_role), so each new one is revoked from
--     every API role here, and the six RPCs are granted to authenticated only;
--   * CREATE OR REPLACE keeps a function's existing privileges, so hq_private.settings_guard keeps
--     what it had (nothing for any API role).
-- The pgTAP totals in hq_01 check the end state across every migration.
--
-- hq_private: the email helpers are executable by NO API role: only the security definer RPCs and the
--   guard trigger reach them.
-- hq: the six email RPCs are executable by authenticated only.

revoke execute on function
  hq_private.email_draft_guard(),
  hq_private.email_ref(bigint),
  hq_private.email_app_client(),
  hq_private.email_json(hq.email_drafts),
  hq_private.email_line(text, integer, text),
  hq_private.email_body(text),
  hq_private.email_recipient_problem(hq.email_drafts),
  hq_private.email_lock(uuid, uuid, boolean)
from public, anon, authenticated, service_role;

revoke execute on function
  hq.create_email_draft(hq.email_template, text, text, uuid, uuid, uuid),
  hq.update_email_draft(uuid, text, text, hq.email_template),
  hq.discard_email_draft(uuid, text),
  hq.approve_email_draft(uuid),
  hq.begin_email_send(uuid, text),
  hq.finish_email_send(uuid, boolean, text, text)
from public, anon, authenticated, service_role;

grant execute on function
  hq.create_email_draft(hq.email_template, text, text, uuid, uuid, uuid),
  hq.update_email_draft(uuid, text, text, hq.email_template),
  hq.discard_email_draft(uuid, text),
  hq.approve_email_draft(uuid),
  hq.begin_email_send(uuid, text),
  hq.finish_email_send(uuid, boolean, text, text)
to authenticated;

notify pgrst, 'reload schema';
