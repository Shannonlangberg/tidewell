-- 0139_hq_function_acl_knowledge.sql
-- Function privileges for the Knowledge base (0138).
--
-- Like 0133, this file states exactly the functions 0138 creates rather than revoking everything and
-- re-stating the whole list:
--   * a function created by CREATE FUNCTION gets the schema's default privileges (execute for public,
--     and on Supabase also for anon, authenticated and service_role), so each new one is revoked from
--     every API role here, and the six RPCs are granted to authenticated only;
--   * CREATE OR REPLACE keeps a function's existing privileges, so hq.archive_record, hq.restore_record
--     (authenticated) and hq_private.settings_guard (no API role) keep what they had.
-- The pgTAP totals in hq_01 check the end state across every migration.
--
-- hq_private: the knowledge helpers are executable by NO API role: only the security definer RPCs and
--   the guard triggers reach them. The knowledge_overview view calls no hq_private function (hq.today()
--   is an authenticated RPC), so it needs no grant.
-- hq: the six knowledge RPCs are executable by authenticated only.

revoke execute on function
  hq_private.knowledge_document_guard(),
  hq_private.knowledge_version_guard(),
  hq_private.knowledge_ref(bigint),
  hq_private.knowledge_json(hq.knowledge_documents),
  hq_private.knowledge_line(text, integer, text),
  hq_private.knowledge_body(text),
  hq_private.knowledge_review_check(date),
  hq_private.knowledge_lock(uuid),
  hq_private.knowledge_save_draft(hq.knowledge_documents, text, text, text, text, text)
from public, anon, authenticated, service_role;

revoke execute on function
  hq.create_knowledge_document(text, hq.knowledge_category, text, text, uuid, date, text),
  hq.edit_knowledge_document(uuid, integer, text, text, text, text),
  hq.approve_knowledge_version(uuid, integer),
  hq.discard_knowledge_draft(uuid, integer, text),
  hq.set_knowledge_review(uuid, uuid, date, boolean, hq.knowledge_category, text),
  hq.restore_knowledge_version(uuid, integer, integer, text)
from public, anon, authenticated, service_role;

grant execute on function
  hq.create_knowledge_document(text, hq.knowledge_category, text, text, uuid, date, text),
  hq.edit_knowledge_document(uuid, integer, text, text, text, text),
  hq.approve_knowledge_version(uuid, integer),
  hq.discard_knowledge_draft(uuid, integer, text),
  hq.set_knowledge_review(uuid, uuid, date, boolean, hq.knowledge_category, text),
  hq.restore_knowledge_version(uuid, integer, integer, text)
to authenticated;

notify pgrst, 'reload schema';
