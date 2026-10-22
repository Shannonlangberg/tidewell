-- 0161_hq_function_acl_workspaces.sql
-- Function privileges for workspaces (0160). Like 0153, this states exactly the functions 0160 creates:
-- each new one gets the schema's default privileges, so it is revoked from every API role and then
-- granted to authenticated, the only role meant to call it. submit_enquiry was replaced in place
-- (create or replace), so its privileges from 0135 (service_role only) stand.

revoke execute on function
  hq.set_my_workspace(hq.workspace),
  hq.record_interaction(uuid, uuid, hq.interaction_type, timestamptz, text, text, date, boolean, uuid, hq.relationship_status, hq.call_outcome, boolean, boolean),
  hq.log_opportunity_activity(uuid, hq.interaction_type, timestamptz, text, text, date, boolean, uuid, hq.call_outcome, boolean)
from public, anon, authenticated, service_role;

grant execute on function
  hq.set_my_workspace(hq.workspace),
  hq.record_interaction(uuid, uuid, hq.interaction_type, timestamptz, text, text, date, boolean, uuid, hq.relationship_status, hq.call_outcome, boolean, boolean),
  hq.log_opportunity_activity(uuid, hq.interaction_type, timestamptz, text, text, date, boolean, uuid, hq.call_outcome, boolean)
to authenticated;

notify pgrst, 'reload schema';
