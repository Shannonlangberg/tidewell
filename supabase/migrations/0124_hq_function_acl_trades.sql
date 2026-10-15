-- 0124_hq_function_acl_trades.sql
-- Function privileges after the trades change (0123), stated once at the end as 0111, 0118 and 0121
-- did, so they hold whatever the default ACL did.
--
-- hq_private: unchanged from 0121. The trade helpers (trade_slug_base, trade_unique_slug,
--   trade_clean_label, trade_check_label, trade_json, trade_guard, contractor_trades_guard) are NOT
--   granted: only the security definer RPCs and the triggers reach them.
-- hq: every RPC is executable by authenticated only; bootstrap_first_director by service_role only.

revoke execute on all functions in schema hq_private from public, anon, authenticated, service_role;
revoke execute on all functions in schema hq from public, anon, authenticated, service_role;

grant execute on function
  hq_private.current_staff_id(),
  hq_private.is_staff(),
  hq_private.staff_role(),
  hq_private.mfa_ok(),
  hq_private.staff_session(),
  hq_private.has_capability(text),
  hq_private.abn_is_valid(text),
  hq_private.expiry_state(date, boolean, boolean, date, integer)
to authenticated;

grant execute on function hq_private.normalise_name(text) to authenticated, service_role;

grant execute on function
  -- Phase 1 (0111)
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
  hq.growth_summary(date),
  -- Phase 2 (0116, 0117)
  hq.set_vetting_step(uuid, hq.vetting_step, hq.vetting_step_status, text),
  hq.preview_contractor_approval(uuid),
  hq.approve_contractor(uuid, boolean, text),
  hq.set_contractor_status(uuid, hq.contractor_status, text),
  hq.reinstate_contractor(uuid, text),
  hq.add_contractor_document(uuid, hq.contractor_document_type, text, text, text, bigint, date, text),
  hq.verify_contractor_document(uuid, hq.document_verification, date, text, boolean),
  hq.record_contractor_review(uuid, date, text, integer, integer, integer, integer, hq.tenant_feedback, boolean, text),
  hq.record_contractor_contact(uuid, hq.interaction_type, timestamptz, text, text, date, boolean, uuid, hq.contractor_status),
  hq.contractor_summary(),
  hq.create_expiry_tasks(),
  hq.preview_contractor_import(jsonb),
  hq.apply_contractor_import(jsonb, text, text),
  -- Phase 3 (0120)
  hq.ai_status(),
  hq.ai_begin_request(text),
  hq.ai_finish_request(uuid, text[], text, integer, integer),
  -- Trades (0123)
  hq.create_trade(text, text),
  hq.update_trade(uuid, text, text, integer),
  hq.move_trade(uuid, text),
  hq.set_trade_active(uuid, boolean, text),
  hq.mark_contractor_used(uuid, date, boolean)
to authenticated;

grant execute on function hq.bootstrap_first_director(uuid, text, text, text) to service_role;

notify pgrst, 'reload schema';
