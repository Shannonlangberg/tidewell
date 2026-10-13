-- seed.sql: date-free data only (design 10). Every dated fixture (people, homes, bookings) lives in
-- supabase/seed.ts (phase 1+), never here. Safe to run against any environment: it only inserts
-- the rows the application cannot run without, and never overwrites a value a founder has set.

-- The single org_settings row. Every unconfirmed business fact (legal name, ABN, phone, emails,
-- licence) stays null until the founders set it; onboarding stays closed; gst_registered is unknown.
insert into public.org_settings (id, onboarding_open, gst_registered)
values (true, false, null)
on conflict (id) do nothing;

-- The first published fee schedule: 18% + GST (19.8% all in), setup band $3,000 to $5,000 inc GST,
-- 30 days' notice both ways after the first Easter. The definitions are the section 2 defaults.
insert into public.fee_schedules (
  effective_from, management_fee_bps, gst_bps,
  setup_fee_min_inc_gst_cents, setup_fee_max_inc_gst_cents,
  fee_base, revenue_recognition, cleaning_model, clean_charge_basis, owner_stay_clean_at_cost,
  cancellation_payout_fee_bps, default_notice_days,
  fee_definition, passthrough_definition
)
values (
  date '2026-10-01', 1800, 1000,
  300000, 500000,
  'accommodation_cents', 'check_in', 'recharge', 'pay_plus_super', true,
  0, 30,
  'The management fee is 18% plus GST (19.8% all in) of accommodation revenue: the gross accommodation '
  'charged to the guest before the platform host fee, excluding cleaning fees and taxes, recognised in '
  'the month the stay checks in. Direct bookings are paid to the owner; Tidewell runs no checkout and '
  'takes no co-host payout. A cancellation payout the host keeps attracts no fee.',
  'Pass-throughs on the monthly tax invoice: each clean is re-charged as Tidewell''s own taxable supply '
  '(cleaner pay plus superannuation where it applies) with GST on top; a repair invoiced to the owner '
  'and paid by Tidewell on their behalf is an agency disbursement at cost with no GST uplift, and a '
  'repair invoiced to Tidewell is re-charged with GST on top; a direct-debit dishonour fee is not '
  'passed on; a damage claim a platform pays is the owner''s receipt and never a credit.'
)
on conflict (effective_from) do nothing;

-- The notification matrix (spec 2 in v1.0 section 5, with the v1.1 changes) for the phase-0 and
-- phase-1 event types. channels is the ladder; ack_wait_minutes is the fallback wait
-- (15 managers, 30 crew, 240 owners); priority 0 breaks quiet hours, 1 and 2 are held 22:00-08:00.
-- Later phases append their rows with the same statement.
insert into public.notification_rules (event_type, recipient_role, recipient_scope, priority, channels, ack_wait_minutes, respect_quiet_hours, template_key)
values
  -- identity and co-owner powers: every member of the account on every channel
  ('threshold.change_pending', 'owner', 'account_members', 1, '{in_app,push,sms,email}', 240, true, 'threshold_change_pending'),
  ('threshold.changed', 'owner', 'account_members', 2, '{in_app,push,email}', null, true, 'threshold_changed'),
  ('threshold.change_undone', 'owner', 'account_members', 2, '{in_app,push,email}', null, true, 'threshold_change_undone'),
  ('membership.created', 'owner', 'account_members', 2, '{in_app,email}', null, true, 'membership_created'),
  ('membership.ended', 'manager', 'all_managers', 2, '{in_app}', null, true, 'membership_ended'),
  ('membership.confirmed', 'manager', 'all_managers', 2, '{in_app,push}', null, true, 'membership_confirmed'),
  -- enquiries: page managers at priority 1 (held in quiet hours, never voice); acknowledge the enquirer once
  ('enquiry.received', 'manager', 'all_managers', 1, '{in_app,push,sms}', 15, true, 'enquiry_received'),
  ('enquiry.received', 'enquirer', 'lead_enquirer', 2, '{email}', null, false, 'enquiry_acknowledgement'),
  ('enquiry.rate_limited', 'manager', 'all_managers', 2, '{in_app}', null, true, 'enquiry_rate_limited'),
  ('lead.received', 'manager', 'all_managers', 2, '{in_app}', null, true, 'lead_received'),
  ('lead.converted', 'manager', 'all_managers', 2, '{in_app}', null, true, 'lead_converted'),
  -- onboarding
  ('owner_account.created', 'manager', 'all_managers', 2, '{in_app}', null, true, 'owner_account_created'),
  ('property.created', 'owner', 'account_members', 2, '{in_app,email}', null, true, 'property_created'),
  ('property.step_done', 'owner', 'property_owners', 2, '{in_app}', null, true, 'property_step_done'),
  ('property.step_waived', 'owner', 'property_owners', 2, '{in_app}', null, true, 'property_step_waived'),
  ('property.went_live', 'owner', 'property_owners', 2, '{in_app,push,email}', null, true, 'property_went_live'),
  ('property.went_live', 'manager', 'all_managers', 2, '{in_app}', null, true, 'property_went_live_manager'),
  ('agreement.sent', 'owner', 'account_members', 1, '{in_app,push,email}', 240, true, 'agreement_sent'),
  ('agreement.signed', 'owner', 'account_members', 2, '{email}', null, true, 'agreement_signed'),
  ('agreement.signed', 'manager', 'all_managers', 2, '{in_app,push}', null, true, 'agreement_signed_manager'),
  ('dd_mandate.pending', 'manager', 'all_managers', 2, '{in_app}', null, true, 'dd_mandate_pending'),
  ('dd_mandate.active', 'owner', 'account_members', 2, '{email}', null, true, 'dd_mandate_active'),
  ('dd_mandate.active', 'manager', 'all_managers', 2, '{in_app}', null, true, 'dd_mandate_active_manager'),
  ('dd_mandate.failed', 'owner', 'account_members', 1, '{email}', null, true, 'dd_mandate_failed'),
  ('dd_mandate.failed', 'manager', 'all_managers', 1, '{in_app,push}', 15, true, 'dd_mandate_failed_manager'),
  ('dd_mandate.cancelled', 'manager', 'all_managers', 1, '{in_app,push}', 15, true, 'dd_mandate_cancelled_manager'),
  -- offboarding: notice and the undo window reach every member of the account on every channel
  ('offboarding.notice_given', 'owner', 'account_members', 1, '{in_app,push,sms,email}', 240, true, 'offboarding_notice_given'),
  ('offboarding.notice_given', 'manager', 'all_managers', 1, '{in_app,push,sms}', 15, true, 'offboarding_notice_given_manager'),
  ('offboarding.undo_window', 'owner', 'account_members', 1, '{in_app,push,sms,email}', 240, true, 'offboarding_undo_window'),
  ('offboarding.cancelled', 'owner', 'account_members', 2, '{in_app,email}', null, true, 'offboarding_cancelled'),
  ('offboarding.cancelled', 'manager', 'all_managers', 2, '{in_app}', null, true, 'offboarding_cancelled_manager'),
  -- delivery problems go to managers
  ('delivery.failed', 'manager', 'all_managers', 1, '{in_app,push}', 15, true, 'delivery_failed')
on conflict (event_type, recipient_role, recipient_scope) do nothing;
