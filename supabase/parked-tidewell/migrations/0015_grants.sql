-- 0015_grants.sql
-- Table privileges (3.1). Supabase's default ACL grants the API roles everything on a new table in
-- public; this migration takes back what the design never grants: truncate everywhere, every table
-- from anon, writes on the state tables (events, outbox), and the columns a person may not update.

-- anon never touches a table (only the two public views in 0019).
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- truncate: never, for any API role (row triggers do not fire on TRUNCATE).
revoke truncate on all tables in schema public from anon, authenticated, service_role;

-- State tables grant select only; every change goes through a security definer RPC (3.1).
revoke all on public.events from authenticated, service_role;
grant select on public.events to authenticated, service_role;
revoke all on public.outbox from authenticated, service_role;
grant select on public.outbox to authenticated, service_role;

-- Tables the clients never write (writes come from the secret key or RPCs). RLS already has no
-- write policy for authenticated; the grant is withdrawn too so the intent is visible in \dp.
revoke insert, update, delete on public.memberships from authenticated;
revoke insert, update, delete on public.dd_mandates from authenticated;
revoke insert, update, delete on public.offboardings from authenticated;
revoke insert, update, delete on public.disclosure_acknowledgements from authenticated;
revoke insert, update, delete on public.webhook_receipts from authenticated;
revoke insert, update, delete on public.integration_sync from authenticated;
revoke all on public.rate_limits from authenticated;
revoke insert, delete on public.profiles from authenticated;
revoke insert, delete on public.org_settings from authenticated;
revoke update, delete on public.fee_schedules from authenticated;
revoke delete on public.owner_accounts, public.owner_account_notes, public.properties, public.leads,
  public.documents, public.crew_profiles, public.agreements, public.notification_rules from authenticated;
revoke insert, delete on public.documents from authenticated;
revoke insert, delete on public.notifications from authenticated;

-- notifications: a person may update only read_at on their own rows.
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;
