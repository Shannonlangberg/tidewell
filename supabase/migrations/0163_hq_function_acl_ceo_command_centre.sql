-- 0163_hq_function_acl_ceo_command_centre.sql
-- Function privileges for the CEO Command Centre (0162), stated exactly as in 0150: every new function is
-- revoked from every API role, and the three RPCs are granted to authenticated only. The pgTAP totals in
-- hq_01 check the end state across every migration.

revoke execute on function
  hq_private.mp_annual_fee_cents(hq.managed_properties),
  hq_private.mp_start_date(hq.managed_properties, text),
  hq_private.ceo_targets_valid(jsonb),
  hq_private.ceo_targets_guard(),
  hq_private.ceo_window(date, date, boolean, boolean)
from public, anon, authenticated, service_role;

revoke execute on function
  hq.set_property_terms(uuid, bigint, bigint, hq.management_end_reason, text[], timestamptz),
  hq.set_ceo_targets(jsonb),
  hq.ceo_overview(date, date, date, date)
from public, anon, service_role;

grant execute on function
  hq.set_property_terms(uuid, bigint, bigint, hq.management_end_reason, text[], timestamptz),
  hq.set_ceo_targets(jsonb),
  hq.ceo_overview(date, date, date, date)
to authenticated;
