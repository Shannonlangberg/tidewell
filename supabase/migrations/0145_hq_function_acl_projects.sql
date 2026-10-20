-- 0145_hq_function_acl_projects.sql
-- Function privileges for Projects (0142, 0143, 0144).
--
-- Like 0141, this file states exactly the functions 0142-0144 create rather than revoking everything
-- and re-stating the whole list:
--   * a function created by CREATE FUNCTION gets the schema's default privileges (execute for public,
--     and on Supabase also for anon, authenticated and service_role), so each new one is revoked from
--     every API role here, and the 26 RPCs are granted to authenticated only;
--   * CREATE OR REPLACE keeps a function's existing privileges, so hq.archive_record and
--     hq.restore_record (authenticated) and hq_private.settings_guard (no API role) keep what they had.
-- The pgTAP totals in hq_01 check the end state across every migration.
--
-- hq_private: the project and task helpers and guard / activity triggers are executable by NO API role:
--   only the security definer RPCs and the triggers reach them. The views and RLS policies call no new
--   hq_private function.
-- hq: the 26 project, task, bulk and focus RPCs are executable by authenticated only.

revoke execute on function
  hq_private.project_guard(),
  hq_private.milestone_guard(),
  hq_private.project_link_guard(),
  hq_private.project_document_guard(),
  hq_private.task_structure_guard(),
  hq_private.task_dependency_stamp(),
  hq_private.task_dependency_cycle(),
  hq_private.task_dependency_refresh(),
  hq_private.checklist_guard(),
  hq_private.task_comment_guard(),
  hq_private.task_activity_log(),
  hq_private.task_history_guard(),
  hq_private.project_ref(bigint),
  hq_private.project_json(hq.projects),
  hq_private.milestone_json(hq.project_milestones),
  hq_private.task_json(hq.tasks),
  hq_private.project_activity_write(uuid, text, text, jsonb),
  hq_private.task_activity_write(uuid, text, text, jsonb),
  hq_private.project_lock(uuid),
  hq_private.milestone_lock(uuid),
  hq_private.task_updatable(hq.tasks),
  hq_private.task_lock(uuid),
  hq_private.task_priority_from(text),
  hq_private.task_status_from(text),
  hq_private.task_due_check(date),
  hq_private.task_sort_from(text),
  hq_private.json_strings(jsonb, text),
  hq_private.task_link_check(text, uuid),
  hq_private.task_dependency_add(uuid, uuid),
  hq_private.task_checklist_apply(uuid, jsonb),
  hq_private.task_entry_errors(jsonb, text),
  hq_private.task_create_core(jsonb, uuid, text, jsonb),
  hq_private.task_update_core(jsonb),
  hq_private.bulk_limits(),
  hq_private.bulk_used(uuid),
  hq_private.idempotency_check(uuid, text, text, text),
  hq_private.idempotency_key_check(text),
  hq_private.bulk_list(jsonb, text)
from public, anon, authenticated, service_role;

revoke execute on function
  hq.my_focus(integer),
  hq.overdue_tasks(text, uuid),
  hq.bulk_budget(),
  hq.consume_bulk_budget(integer, integer),
  hq.bulk_create_tasks(jsonb, text, uuid, boolean),
  hq.bulk_update_tasks(jsonb, text, boolean),
  hq.create_project_task(text, uuid, uuid, uuid, uuid, date, hq.task_priority, text, hq.task_status, uuid[], text[], integer, text),
  hq.update_project_task(uuid, jsonb),
  hq.complete_task(uuid, text),
  hq.add_task_dependency(uuid, uuid),
  hq.remove_task_dependency(uuid, uuid),
  hq.set_task_checklist(uuid, jsonb),
  hq.add_task_comment(uuid, text),
  hq.edit_task_comment(bigint, text),
  hq.create_project(text, text, uuid, hq.project_status, hq.task_priority, date, date, text),
  hq.update_project(uuid, integer, text, text, uuid, hq.project_status, hq.task_priority, date, date, text, text[], text),
  hq.set_project_status(uuid, hq.project_status, text),
  hq.add_project_link(uuid, text, uuid),
  hq.remove_project_link(uuid, text, uuid),
  hq.add_project_document(uuid, text, text),
  hq.remove_project_document(uuid, bigint),
  hq.create_milestone(uuid, text, text, date, integer),
  hq.update_milestone(uuid, text, text, date, text[]),
  hq.complete_milestone(uuid, boolean, text),
  hq.reopen_milestone(uuid),
  hq.reorder_milestones(uuid, uuid[])
from public, anon, authenticated, service_role;

grant execute on function
  hq.my_focus(integer),
  hq.overdue_tasks(text, uuid),
  hq.bulk_budget(),
  hq.consume_bulk_budget(integer, integer),
  hq.bulk_create_tasks(jsonb, text, uuid, boolean),
  hq.bulk_update_tasks(jsonb, text, boolean),
  hq.create_project_task(text, uuid, uuid, uuid, uuid, date, hq.task_priority, text, hq.task_status, uuid[], text[], integer, text),
  hq.update_project_task(uuid, jsonb),
  hq.complete_task(uuid, text),
  hq.add_task_dependency(uuid, uuid),
  hq.remove_task_dependency(uuid, uuid),
  hq.set_task_checklist(uuid, jsonb),
  hq.add_task_comment(uuid, text),
  hq.edit_task_comment(bigint, text),
  hq.create_project(text, text, uuid, hq.project_status, hq.task_priority, date, date, text),
  hq.update_project(uuid, integer, text, text, uuid, hq.project_status, hq.task_priority, date, date, text, text[], text),
  hq.set_project_status(uuid, hq.project_status, text),
  hq.add_project_link(uuid, text, uuid),
  hq.remove_project_link(uuid, text, uuid),
  hq.add_project_document(uuid, text, text),
  hq.remove_project_document(uuid, bigint),
  hq.create_milestone(uuid, text, text, date, integer),
  hq.update_milestone(uuid, text, text, date, text[]),
  hq.complete_milestone(uuid, boolean, text),
  hq.reopen_milestone(uuid),
  hq.reorder_milestones(uuid, uuid[])
to authenticated;

notify pgrst, 'reload schema';
