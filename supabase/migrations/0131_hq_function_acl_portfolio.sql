-- 0131_hq_function_acl_portfolio.sql
-- Function privileges for the portfolio (0129, 0130).
--
-- Unlike 0111 / 0118 / 0121 / 0124 / 0126 this file does NOT revoke everything and re-state the whole
-- list: the leads pipeline (0127, 0128) was built in parallel and owns its own list, and re-stating it
-- here would silently drop whatever it adds. Instead it states exactly the functions 0129 and 0130
-- create, which is enough because:
--   * a function created by CREATE FUNCTION gets the schema's default privileges (execute for public,
--     and on Supabase also for anon, authenticated and service_role), so each new one is revoked from
--     every API role here, and the RPCs are granted to authenticated only;
--   * CREATE OR REPLACE keeps a function's existing privileges, so the replaced functions
--     (hq_private.settings_guard, hq_private.audit_row, hq.archive_record, hq.restore_record) keep
--     what 0126 (and 0128) gave them: nothing for the two triggers, authenticated for the two RPCs.
-- The pgTAP totals in hq_01 check the end state across every migration.
--
-- hq_private: the portfolio helpers are executable by NO API role: only the security definer RPCs and
--   the triggers reach them. The portfolio_overview view calls no hq_private function at read time
--   (address_key is a stored generated column), so it needs no grant.
-- hq: the six portfolio RPCs are executable by authenticated only.

revoke execute on function
  hq_private.managed_property_guard(),
  hq_private.managed_property_after_insert(),
  hq_private.handover_step_guard(),
  hq_private.opportunity_portfolio_guard(),
  hq_private.mp_ref(bigint),
  hq_private.mp_json(hq.managed_properties),
  hq_private.mp_status_label(hq.managed_status),
  hq_private.mp_check(hq.managed_properties, uuid),
  hq_private.mp_new(uuid, text, text, text, uuid, text, hq.service_type, hq.fee_basis, numeric, text, date, date, hq.managed_status, text, hq.ailo_status, text),
  hq_private.mp_insert(hq.managed_properties, text)
from public, anon, authenticated, service_role;

revoke execute on function
  hq.convert_to_managed_property(uuid, hq.service_type, text, text, uuid, text, hq.fee_basis, numeric, text, date, date, hq.managed_status, text, text),
  hq.add_existing_managed_property(text, text, hq.service_type, text, uuid, text, hq.fee_basis, numeric, text, date, date, hq.managed_status, text, hq.ailo_status, text),
  hq.update_managed_property(uuid, text, text, uuid, text, hq.service_type, hq.fee_basis, numeric, text, date, date, hq.managed_status, date, text, hq.ailo_status, text, text[], text, timestamptz),
  hq.set_handover_step(uuid, hq.handover_step, hq.handover_step_status, text),
  hq.set_business_goal(integer, date),
  hq.business_summary()
from public, anon, authenticated, service_role;

grant execute on function
  hq.convert_to_managed_property(uuid, hq.service_type, text, text, uuid, text, hq.fee_basis, numeric, text, date, date, hq.managed_status, text, text),
  hq.add_existing_managed_property(text, text, hq.service_type, text, uuid, text, hq.fee_basis, numeric, text, date, date, hq.managed_status, text, hq.ailo_status, text),
  hq.update_managed_property(uuid, text, text, uuid, text, hq.service_type, hq.fee_basis, numeric, text, date, date, hq.managed_status, date, text, hq.ailo_status, text, text[], text, timestamptz),
  hq.set_handover_step(uuid, hq.handover_step, hq.handover_step_status, text),
  hq.set_business_goal(integer, date),
  hq.business_summary()
to authenticated;

notify pgrst, 'reload schema';
