-- 0150_hq_function_acl_leadership.sql
-- Function privileges for the command center (0148, 0149), stated exactly as in 0145:
--   * each NEW function is revoked from every API role (CREATE FUNCTION gives the schema default), and
--     the four RPCs are granted to authenticated only;
--   * CREATE OR REPLACE keeps existing privileges, so hq_private.settings_guard, task_entry_errors and
--     task_update_core keep "no API role".
-- The pgTAP totals in hq_01 check the end state across every migration.

revoke execute on function
  hq_private.planning_item_guard(),
  hq_private.task_waiting_guard(),
  hq_private.task_waiting_log(),
  hq_private.leadership_date(text, text),
  hq_private.planning_item_json(hq.planning_items)
from public, anon, authenticated, service_role;

revoke execute on function
  hq.save_planning_item(uuid, hq.planning_kind, text, text, numeric, text, date, hq.planning_status, text[], integer),
  hq.set_task_waiting(uuid, text, uuid, date, date, date, text),
  hq.resolve_task_waiting(uuid, hq.task_status, text, date, date),
  hq.set_milestone_launch_gate(uuid, boolean)
from public, anon, service_role;

grant execute on function
  hq.save_planning_item(uuid, hq.planning_kind, text, text, numeric, text, date, hq.planning_status, text[], integer),
  hq.set_task_waiting(uuid, text, uuid, date, date, date, text),
  hq.resolve_task_waiting(uuid, hq.task_status, text, date, date),
  hq.set_milestone_launch_gate(uuid, boolean)
to authenticated;
