-- 0001_enums.sql
-- Every enum from design v1.0 section 3.2 with the v1.1 amendments, created in phase 0 so later
-- phases add tables, never enums. Values marked (reserved) exist for the long-term/tenant work
-- that is out of v1.

create type public.app_role as enum ('owner', 'crew', 'manager', 'tenant');
create type public.crew_kind as enum ('cleaner', 'tradie');
create type public.membership_status as enum ('invited', 'active', 'read_only', 'ended');
create type public.secrets_access as enum ('none', 'property');
create type public.engagement_type as enum ('managed', 'setup_only');
create type public.property_kind as enum ('short_stay', 'long_term');
create type public.property_status as enum ('onboarding', 'live', 'offboarding', 'closed', 'handed_over');
create type public.step_phase as enum ('onboarding', 'offboarding');
create type public.step_status as enum ('pending', 'in_progress', 'done', 'waived', 'blocked');
create type public.lead_source as enum ('website', 'phone', 'referral', 'walk_in');
create type public.lead_stage as enum ('new', 'contacted', 'walkthrough_booked', 'walkthrough_done', 'proposal_sent', 'won', 'lost', 'parked');
create type public.lead_lost_reason as enum ('price', 'timing', 'chose_other_manager', 'sold', 'no_response', 'duplicate', 'other');
create type public.current_letting as enum ('none', 'self_airbnb', 'self_vrbo', 'other_manager', 'long_term');
create type public.agreement_status as enum ('draft', 'sent', 'signed', 'superseded', 'terminated');
create type public.signature_method as enum ('esign_provider', 'uploaded_scan', 'in_app_click');
create type public.collector as enum ('pinch', 'stripe', 'manual');
create type public.mandate_status as enum ('pending', 'active', 'cancelled', 'failed');
create type public.platform as enum ('airbnb', 'vrbo', 'booking_com', 'direct');
create type public.sync_mode as enum ('api', 'ical', 'none');
create type public.connection_status as enum ('pending', 'connected', 'disconnected', 'error');
create type public.listing_status as enum ('active', 'paused', 'removed');
create type public.ical_import_status as enum ('active', 'stopped', 'error');
create type public.ical_audience as enum ('platform_vrbo', 'owner_calendar');
create type public.reservation_source as enum ('hospitable', 'ical', 'manual');
create type public.reservation_kind as enum ('guest', 'owner', 'block');
create type public.reservation_status as enum ('tentative', 'confirmed', 'cancelled', 'superseded');
create type public.job_kind as enum ('clean', 'trade', 'inspection');
create type public.job_trigger as enum ('turnover', 'pre_arrival', 'manual', 'refresh', 'qa_reclean', 'deep', 'inspection', 'trade');
create type public.job_status as enum ('scheduled', 'assigned', 'accepted', 'in_progress', 'done_pending_upload', 'done', 'reopened', 'cancelled', 'superseded');
create type public.window_flag as enum ('ok', 'tight', 'overlap');
create type public.assignment_role as enum ('lead', 'helper');
create type public.assignment_status as enum ('offered', 'accepted', 'declined', 'removed');
-- v1.1: who carries the clean (owner invoice after a guest stay, owner stay, or none when declined)
create type public.bill_to as enum ('owner_invoice', 'owner_stay', 'none');
create type public.job_cancel_reason as enum ('reservation_cancelled', 'owner_declined_clean', 'manager_cancelled', 'duplicate', 'offboarding', 'other');
create type public.qa_status as enum ('none', 'review', 'passed');
create type public.photo_kind as enum ('room', 'before', 'after', 'issue', 'invoice_scan', 'handover', 'inspection');
create type public.photo_status as enum ('current', 'replaced', 'rejected');
create type public.maintenance_status as enum ('reported', 'quoted', 'waiting_owner', 'approved', 'declined', 'booked', 'done', 'invoiced', 'cancelled');
create type public.urgency as enum ('routine', 'soon', 'urgent');
create type public.reporter_kind as enum ('guest', 'cleaner', 'tradie', 'manager', 'owner', 'neighbour', 'system', 'tenant');
create type public.quote_status as enum ('submitted', 'superseded', 'accepted', 'declined');
-- v1.1: four approval kinds (manager_override replaced by emergency_override; variance added)
create type public.approval_kind as enum ('owner', 'under_threshold', 'variance', 'emergency_override');
create type public.approval_decision as enum ('approved', 'declined');
create type public.approval_via as enum ('in_app', 'phone_logged');
create type public.invoice_addressee as enum ('owner', 'tidewell');
create type public.supplier_invoice_status as enum ('submitted', 'needs_review', 'confirmed', 'paid', 'disputed', 'void');
create type public.claim_status as enum ('draft', 'lodged', 'paid', 'partial', 'rejected', 'withdrawn');
create type public.pay_run_status as enum ('open', 'approved', 'exported', 'paid');
-- v1.1: Hospitable financials are expectations (reservation_financials), never actual payouts
create type public.payout_source as enum ('reservation_financials', 'manual', 'csv');
create type public.payout_match_status as enum ('unmatched', 'matched', 'variance', 'written_off');
create type public.statement_status as enum ('draft', 'blocked', 'ready', 'issued', 'superseded');
-- v1.1: no `gst` line kind anywhere; GST is a per-line amount and an invoice total
create type public.statement_line_kind as enum ('accommodation', 'cleaning_fee', 'platform_fee', 'taxes', 'paid_to_owner', 'expected_payout', 'management_fee', 'clean_charge', 'disbursement_repair', 'recharge_repair', 'owner_direct', 'credit', 'adjustment', 'levy', 'dishonour_fee');
create type public.invoice_status as enum ('draft', 'issued', 'debit_scheduled', 'paid', 'failed', 'void', 'credited', 'refunded');
create type public.invoice_line_kind as enum ('management_fee', 'clean_charge', 'disbursement_repair', 'recharge_repair', 'setup_fee', 'credit', 'adjustment', 'levy', 'dishonour_fee');
create type public.document_kind as enum ('statement', 'tax_invoice', 'tax_pack', 'remittance', 'rcti', 'agreement', 'supplier_invoice', 'fact_sheet', 'handover_pack', 'export', 'adjustment_note');
create type public.thread_party as enum ('guest', 'owner', 'crew', 'neighbour', 'enquirer', 'unknown', 'tenant');
create type public.thread_status as enum ('open', 'drafted', 'needs_person', 'replied', 'resolved');
create type public.level as enum ('green', 'amber', 'red');
create type public.message_channel as enum ('hospitable', 'sms', 'voice', 'email', 'in_app');
create type public.direction as enum ('inbound', 'outbound');
create type public.author_kind as enum ('person', 'assistant', 'system');
create type public.notify_channel as enum ('in_app', 'push', 'sms', 'email', 'platform', 'voice');
create type public.outbox_kind as enum ('notification', 'message', 'document');
create type public.outbox_status as enum ('queued', 'sending', 'sent', 'delivered', 'bounced', 'failed', 'cancelled');
create type public.outbox_cancel_reason as enum ('superseded', 'digested', 'acknowledged', 'no_address', 'stale');
create type public.access_code_kind as enum ('guest', 'crew', 'standing');
create type public.code_source as enum ('manual', 'standing_copy', 'adapter');
create type public.lock_provider as enum ('manual', 'igloohome', 'seam');
create type public.lock_sync_status as enum ('manual', 'pending', 'pushed', 'failed');
create type public.secret_kind as enum ('wifi_password', 'alarm_code', 'safe_code', 'lockbox_code', 'other');
create type public.entry_type as enum ('keypad_lock', 'keybox', 'smart_lock', 'key_only');
create type public.reveal_actor_kind as enum ('guest', 'crew', 'manager', 'owner', 'system');
create type public.reveal_channel as enum ('stay_page', 'app', 'phone', 'lock_program', 'adapter');
create type public.reveal_outcome as enum ('revealed', 'denied');
create type public.deny_reason as enum ('before_window', 'after_window', 'link_revoked', 'link_expired', 'cancelled', 'role', 'not_assigned', 'rate_limited', 'no_code', 'pending_cancel', 'superseded');
create type public.interaction_type as enum ('phone_call', 'in_person', 'text', 'email', 'inspection', 'review');
create type public.contact_method as enum ('phone', 'text', 'email');
create type public.contact_cadence as enum ('monthly', 'six_weekly', 'quarterly');
create type public.offboarding_reason as enum ('selling', 'self_manage', 'other_manager', 'unhappy', 'tidewell_ended', 'other');
create type public.offboarding_status as enum ('notice_given', 'winding_down', 'final_statement_pending', 'closed', 'cancelled');
create type public.revenue_recognition as enum ('check_in', 'check_out');
-- v1.1: each clean is re-charged as Tidewell's own taxable supply (recharge) or absorbed in the fee
create type public.cleaning_model as enum ('recharge', 'absorbed');
create type public.rate_status as enum ('suggested', 'accepted', 'rejected', 'pushed', 'push_failed');
create type public.rate_source as enum ('manual', 'pricelabs', 'assistant');
-- New in v1.1
create type public.claimant as enum ('owner', 'tidewell');
create type public.payout_kind as enum ('booking', 'cancellation', 'claim', 'adjustment');
create type public.invoice_kind as enum ('monthly', 'setup');
create type public.webhook_verification as enum ('signature', 'refetch', 'none');
create type public.clean_charge_basis as enum ('pay', 'pay_plus_super', 'fixed');
