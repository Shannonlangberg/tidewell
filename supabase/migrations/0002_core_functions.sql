-- 0002_core_functions.sql
-- Shared trigger functions and the pure helpers that tables and check constraints reference.
-- Everything here is table-independent; the membership-reading helpers come in 0013_helpers.sql.

-- updated_at on every mutable table (3.1)
create function private.set_updated_at() returns trigger
language plpgsql set search_path = pg_catalog, public, extensions as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Immutability: raises for every role, including the secret key (3.1). Attached `before update or delete`.
create function private.raise_immutable() returns trigger
language plpgsql set search_path = pg_catalog, public, extensions as $$
begin
  raise exception '%.% rows are immutable (% refused)', tg_table_schema, tg_table_name, tg_op
    using errcode = 'insufficient_privilege';
end $$;

-- The `app.rpc` guard on state tables (3.1): a `before update` raises unless the transaction-local
-- setting `app.rpc` names one of the RPCs given as trigger arguments. Every write RPC does
-- `perform set_config('app.rpc', '<name>', true)` first and clears it before returning.
create function private.rpc_guard() returns trigger
language plpgsql set search_path = pg_catalog, public, extensions as $$
declare
  v_rpc text := coalesce(current_setting('app.rpc', true), '');
begin
  if v_rpc = '' or not (v_rpc = any (tg_argv)) then
    raise exception '%.% is written only by its RPCs (app.rpc = %)', tg_table_schema, tg_table_name, coalesce(nullif(v_rpc, ''), 'unset')
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

-- Initials for profiles.initials (generated column, so the function must be immutable).
create function private.initials(p_full_name text, p_first_name text) returns text
language sql immutable strict set search_path = pg_catalog as $$
  select upper(
    left(btrim(p_first_name), 1)
    || case
         when position(' ' in btrim(p_full_name)) > 0
           then left(regexp_replace(btrim(p_full_name), '^.*\s', ''), 1)
         else ''
       end
  )
$$;

-- Secret lint (3.1): free text that reaches a guest or crew member is refused when it carries a
-- run of 4 to 8 digits or the words code, pin or password, unless the calling RPC supplies an
-- `allow_digits_reason`. Returns the text unchanged so it can wrap an assignment.
create function private.lint_secret_text(p_text text, p_allow_digits_reason text default null) returns text
language plpgsql immutable set search_path = pg_catalog as $$
begin
  if p_text is null then
    return null;
  end if;
  if coalesce(btrim(p_allow_digits_reason), '') = '' then
    if p_text ~ '(^|[^0-9])[0-9]{4,8}([^0-9]|$)' then
      raise exception 'text refused by the secret lint: it contains a run of 4 to 8 digits'
        using errcode = 'check_violation', hint = 'If the digits are not a code, pass allow_digits_reason.';
    end if;
    if p_text ~* '\m(code|pin|password)\M' then
      raise exception 'text refused by the secret lint: it mentions a code, pin or password'
        using errcode = 'check_violation', hint = 'Say where the keybox is, never what opens it.';
    end if;
  end if;
  return p_text;
end $$;

-- The closed events catalogue (3.5): the v1.0 list plus the v1.1 additions, minus
-- maintenance.approved_by_manager. `threshold.change_undone` and
-- `owner_account.preferences_changed` are phase-0 additions (see the phase-0 report).
create function private.event_types() returns text[]
language sql immutable parallel safe set search_path = pg_catalog as $$
  select array[
    -- pipeline and onboarding
    'lead.received', 'lead.stage_changed', 'lead.converted', 'owner_account.created', 'owner_account.preferences_changed',
    'membership.created', 'membership.invited', 'membership.confirmed', 'membership.ended',
    'threshold.change_pending', 'threshold.changed', 'threshold.change_undone',
    'property.created', 'property.step_done', 'property.step_waived', 'property.went_live', 'property.offboarding',
    'property.closed', 'property.handed_over', 'property.reopened',
    'agreement.sent', 'agreement.signed', 'disclosure.acknowledged',
    'dd_mandate.pending', 'dd_mandate.active', 'dd_mandate.cancelled', 'dd_mandate.failed',
    'channel_connection.connected', 'channel_connection.disconnected', 'channel_connection.error',
    'ical_import.ok', 'ical_import.error', 'ical_export.issued', 'ical_export.revoked',
    'property_fact.changed', 'property_secret.created', 'property_secret.rotated', 'property_secret.destroyed',
    'auth.unknown_email',
    -- bookings
    'reservation.created', 'reservation.created_partial', 'reservation.completed', 'reservation.changed',
    'reservation.cancelled', 'reservation.superseded', 'reservation.block_requested', 'reservation.block_confirmed',
    'reservation.times_changed', 'reservation.long_stay_flagged', 'reservation.code_ready_sent',
    'reservation.pending_cancel', 'reservation.pending_cancel_cleared', 'reservation.cancelled_after_checkin',
    'reservation.cancellation_confirmed', 'ical.vanished',
    'stay_link.issued', 'stay_link.sent', 'stay_link.revoked', 'sync.run', 'sync.failed', 'webhook.ignored',
    -- turnovers and photos
    'job.created', 'job.rescheduled', 'job.window_conflict', 'job.orphaned', 'job.cancelled', 'job.superseded',
    'job.offered', 'job.accepted', 'job.declined', 'job.late_decline', 'job.removed', 'job.unassigned_soon',
    'job.unaccepted_same_day', 'job.started', 'job.blocked', 'job.urgent', 'job.done_pending', 'job.done',
    'job.done_with_exception', 'job.pending_upload_stale', 'job.pending_upload_blocked', 'job.reopened',
    'job.qa_passed', 'job.photo_rejected', 'job.pinned', 'turnover.long_gap', 'reconciliation.alert',
    'photo.uploaded', 'photo.replaced',
    -- maintenance
    'maintenance.reported', 'maintenance.quoted', 'maintenance.waiting_owner', 'maintenance.waiting_owner_stalled',
    'maintenance.auto_approved', 'maintenance.approved', 'maintenance.approved_by_phone', 'maintenance.emergency_override',
    'maintenance.declined', 'maintenance.booked', 'maintenance.done', 'maintenance.invoiced', 'maintenance.invoice_variance',
    'maintenance.variance_waiting_owner', 'maintenance.variance_approved', 'maintenance.variance_declined',
    'maintenance.cancelled', 'supplier_invoice.needs_review', 'supplier_invoice.confirmed',
    'claim.lodged', 'claim.paid', 'claim.rejected',
    -- money
    'payout.recorded', 'payout.matched', 'payout.written_off', 'statement.built', 'statement.blocked', 'statement.ready',
    'statement.issue_requested', 'statement.issued', 'statement.superseded', 'statement.reconciled',
    'invoice.issued', 'invoice.scheduled', 'invoice.debited', 'invoice.dishonoured', 'invoice.paid', 'invoice.voided',
    'invoice.manual_collection', 'invoice.credited', 'invoice.refunded', 'invoice.adjustment_note',
    'document.generated', 'document.failed',
    'pay_run.opened', 'pay_run.approved', 'pay_run.exported', 'pay_run.paid', 'pay_run.super_paid', 'pay_line.withheld',
    -- communications
    'thread.opened', 'thread.inbound', 'thread.drafted', 'thread.needs_person', 'thread.owner_question', 'thread.replied',
    'thread.human_reply', 'thread.taken_over', 'thread.resolved', 'thread.sla_at_risk', 'thread.sla_breached',
    'thread.cycle_opened', 'thread.cycle_closed',
    'message.sent', 'message.delivered', 'message.failed', 'call.received', 'call.missed', 'call.voicemail',
    'notification.sent', 'notification.failed', 'notification.skipped', 'delivery.failed',
    'enquiry.received', 'enquiry.acknowledged', 'enquiry.rate_limited', 'digest.morning',
    -- access
    'access_code.created', 'access_code.pushed', 'access_code.push_failed', 'access_code.superseded', 'access_code.revoked',
    'access_code.still_live', 'access_code.destroyed', 'stay.code_ready', 'stay.code_missing', 'stay.code_missing_live',
    'stay.reveal_rate_limited', 'secret.revealed', 'secret.reveal_denied', 'secret.standing_rotation_due',
    'secret.rotation_required', 'lock.unlocked', 'lock.code_used', 'lock.battery_low', 'lock.pins_high', 'security.incident',
    -- offboarding and retention
    'offboarding.notice_given', 'offboarding.undo_window', 'offboarding.future_stays_acknowledged', 'offboarding.jobs_wound_down',
    'offboarding.codes_expired', 'offboarding.channels_disconnected', 'offboarding.final_statement_issued',
    'offboarding.mandate_cancelled', 'offboarding.handover_pack_delivered', 'offboarding.cancelled', 'retention.purged'
  ]::text[]
$$;

-- Event types whose audience is always internal (3.5).
create function private.internal_only_event_types() returns text[]
language sql immutable parallel safe set search_path = pg_catalog as $$
  select array['thread.inbound', 'secret.revealed', 'pay_line.withheld', 'membership.invited', 'maintenance.quoted']::text[]
$$;
