-- 0111_hq_function_acl.sql
-- Function privileges, stated once at the end so they hold whatever the default ACL did (see
-- 0000_extensions.sql: a schema-scoped default-privilege revoke is not stored on this Postgres, so
-- Postgres's default `execute for public` would otherwise stand on every new function).
--
-- hq_private: nothing is executable by an API role except the helpers that policies, guard triggers,
--   views and the generated name_key columns evaluate AS the caller (granted by name). Everything
--   else in hq_private is reachable only from the security definer RPCs, which run as the owner.
-- hq: every RPC is executable by authenticated only; none by public or anon.
--   bootstrap_first_director is executable by service_role only.

revoke execute on all functions in schema hq_private from public, anon, authenticated, service_role;
revoke execute on all functions in schema hq from public, anon, authenticated, service_role;

grant execute on function
  hq_private.current_staff_id(),
  hq_private.is_staff(),
  hq_private.staff_role(),
  hq_private.mfa_ok(),
  hq_private.staff_session(),
  hq_private.has_capability(text)
to authenticated;

-- A generated column is evaluated by the writer, so the writer needs execute on its function.
grant execute on function hq_private.normalise_name(text) to authenticated, service_role;

grant execute on function
  hq.my_access(),
  hq.can(text),
  hq.today(),
  hq.add_staff(uuid, text, text, hq.staff_role, uuid, text, date, text, text),
  hq.update_staff(uuid, text, text, hq.staff_role, uuid, boolean, hq.employment_status, date, text, text, text[], boolean, boolean),
  hq.deactivate_staff(uuid, text),
  hq.record_interaction(uuid, uuid, hq.interaction_type, timestamptz, text, text, date, boolean, uuid, hq.relationship_status),
  hq.record_referral(hq.referral_direction, uuid, uuid, uuid, uuid, date, text, text, text, text, text, uuid, bigint, text, uuid),
  hq.move_opportunity(uuid, hq.opportunity_stage, text, timestamptz, text, text),
  hq.set_attributed_referral(uuid, uuid),
  hq.archive_record(text, uuid, text),
  hq.restore_record(text, uuid),
  hq.preview_partner_import(jsonb),
  hq.apply_partner_import(jsonb, text, text),
  hq.global_search(text, integer),
  hq.growth_summary(date)
to authenticated;

grant execute on function hq.bootstrap_first_director(uuid, text, text, text) to service_role;

-- PostgREST rereads its schema cache.
notify pgrst, 'reload schema';
