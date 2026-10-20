-- 0141_hq_function_acl_meetings.sql
-- Function privileges for Meetings (0140).
--
-- Like 0139, this file states exactly the functions 0140 creates rather than revoking everything and
-- re-stating the whole list:
--   * a function created by CREATE FUNCTION gets the schema's default privileges (execute for public,
--     and on Supabase also for anon, authenticated and service_role), so each new one is revoked from
--     every API role here, and the eight RPCs are granted to authenticated only;
--   * CREATE OR REPLACE keeps a function's existing privileges, so hq.archive_record and
--     hq.restore_record (authenticated) keep what they had.
-- The pgTAP totals in hq_01 check the end state across every migration.
--
-- hq_private: the meeting helpers are executable by NO API role: only the security definer RPCs and the
--   guard triggers reach them. The two views and the RLS policies call no new hq_private function (the
--   confidential rule reads meetings.staff_attendee_ids with the existing has_capability helper).
-- hq: the eight meeting RPCs are executable by authenticated only.

revoke execute on function
  hq_private.meeting_guard(),
  hq_private.meeting_attendee_guard(),
  hq_private.meeting_link_guard(),
  hq_private.meeting_ref(bigint),
  hq_private.meeting_json(hq.meetings),
  hq_private.meeting_text(text, integer, text),
  hq_private.meeting_uuid(text, text),
  hq_private.meeting_visible(hq.meetings),
  hq_private.meeting_lock(uuid),
  hq_private.meeting_history_write(hq.meetings, text, text, text, jsonb),
  hq_private.meeting_bump(uuid, text, text),
  hq_private.meeting_sync_staff(uuid),
  hq_private.meeting_add_attendee(uuid, uuid, uuid, text),
  hq_private.meeting_link_column(text),
  hq_private.meeting_add_link(uuid, text, uuid),
  hq_private.meeting_add_task(hq.meetings, text, uuid, date, hq.task_priority, text),
  hq_private.meeting_sync_touchpoints(uuid),
  hq_private.meeting_when_check(timestamptz),
  hq_private.meeting_duration_check(integer),
  hq_private.meeting_list(jsonb, integer, text),
  hq_private.meeting_date(text, text),
  hq_private.meeting_priority(text)
from public, anon, authenticated, service_role;

revoke execute on function
  hq.create_meeting(text, hq.meeting_type, timestamptz, integer, text, text, text, text, boolean, jsonb, jsonb, jsonb, text),
  hq.update_meeting(uuid, integer, text, hq.meeting_type, timestamptz, integer, text, text, text, text, boolean, text[], text),
  hq.add_meeting_attendee(uuid, uuid, uuid, text),
  hq.remove_meeting_attendee(uuid, bigint),
  hq.link_meeting(uuid, text, uuid),
  hq.unlink_meeting(uuid, text, uuid),
  hq.add_meeting_action(uuid, text, uuid, date, hq.task_priority, text),
  hq.promote_decision_to_register(uuid, text, hq.decision_category, text, text, date, hq.decision_status)
from public, anon, authenticated, service_role;

grant execute on function
  hq.create_meeting(text, hq.meeting_type, timestamptz, integer, text, text, text, text, boolean, jsonb, jsonb, jsonb, text),
  hq.update_meeting(uuid, integer, text, hq.meeting_type, timestamptz, integer, text, text, text, text, boolean, text[], text),
  hq.add_meeting_attendee(uuid, uuid, uuid, text),
  hq.remove_meeting_attendee(uuid, bigint),
  hq.link_meeting(uuid, text, uuid),
  hq.unlink_meeting(uuid, text, uuid),
  hq.add_meeting_action(uuid, text, uuid, date, hq.task_priority, text),
  hq.promote_decision_to_register(uuid, text, hq.decision_category, text, text, date, hq.decision_status)
to authenticated;

notify pgrst, 'reload schema';
