-- fixture.inc: shared pgTAP helpers, included with \ir from each test file. Not a test itself.
-- Everything here lives in pg_temp and in the test's transaction, so nothing leaks.

-- A minimal auth.users row (the on_auth_user_created trigger builds the profile).
create function pg_temp.mk_user(p_email text, p_full text, p_first text) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, email_confirmed_at)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', p_email,
          '{"provider":"email","providers":["email"]}'::jsonb,
          jsonb_build_object('full_name', p_full, 'first_name', p_first), now(), now(), now());
  return v_id;
end $$;

-- Simulate a session: the claims PostgREST/Realtime would set. Pair with `set local role authenticated`.
create function pg_temp.login(p_uid uuid, p_aal text default 'aal2') returns void
language sql as $$
  select set_config('request.jwt.claims',
    jsonb_strip_nulls(jsonb_build_object('sub', p_uid, 'role', 'authenticated', 'aal', p_aal))::text, true);
$$;
create function pg_temp.logout() returns void
language sql as $$
  select set_config('request.jwt.claims', '', true);
$$;

-- Fixture ids by key (see pg_temp.seed_world).
create temp table fx (key text primary key, id uuid not null) on commit drop;
grant select on fx to public; -- readable after `set local role authenticated`
create function pg_temp.fx(p_key text) returns uuid
language sql stable as $$ select id from fx where key = p_key $$;

-- The API roles have no usage on `private`, so a test that wants to evaluate a helper as a
-- signed-in person goes through these definer wrappers (they run as postgres with the same claims).
create function pg_temp.is_manager() returns boolean
language sql stable security definer as $$ select private.is_manager() $$;
create function pg_temp.my_owner_account_ids() returns uuid[]
language sql stable security definer as $$ select private.my_owner_account_ids() $$;

-- Two owner accounts (A: Jane primary + Rob; B: Mia), one property each, a cleaner, two active
-- managers and one invited manager, plus one row per phase-0 table for each account.
create function pg_temp.seed_world() returns void
language plpgsql as $$
declare
  v_jane uuid; v_rob uuid; v_mia uuid; v_kel uuid; v_court uuid; v_sam uuid; v_newmgr uuid;
  v_acct_a uuid; v_acct_b uuid; v_prop_a uuid; v_prop_b uuid; v_fee uuid;
  v_agr_a uuid; v_agr_b uuid; v_lead uuid; v_ev bigint;
begin
  v_jane := pg_temp.mk_user('jane@owners.test', 'Jane Pelham', 'Jane');
  v_rob := pg_temp.mk_user('rob@owners.test', 'Rob Tait', 'Rob');
  v_mia := pg_temp.mk_user('mia@owners.test', 'Mia Castellano', 'Mia');
  v_kel := pg_temp.mk_user('kel@crew.test', 'Kel Brown', 'Kel');
  v_court := pg_temp.mk_user('court@tidewell.test', 'Court Langberg', 'Court');
  v_sam := pg_temp.mk_user('sam@tidewell.test', 'Sam Second', 'Sam');
  v_newmgr := pg_temp.mk_user('new@tidewell.test', 'Nia Newbie', 'Nia');
  insert into fx values ('jane', v_jane), ('rob', v_rob), ('mia', v_mia), ('kel', v_kel), ('court', v_court), ('sam', v_sam), ('newmgr', v_newmgr);

  select id into v_fee from public.fee_schedules order by effective_from desc limit 1;
  insert into fx values ('fee', v_fee);

  insert into public.owner_accounts (display_name, billing_email, approval_threshold_cents)
    values ('Jane and Rob', 'jane@owners.test', 15000) returning id into v_acct_a;
  insert into public.owner_accounts (display_name, billing_email, approval_threshold_cents)
    values ('Mia', 'mia@owners.test', 20000) returning id into v_acct_b;
  insert into fx values ('acct_a', v_acct_a), ('acct_b', v_acct_b);

  insert into public.owner_account_notes (owner_account_id, notes) values (v_acct_a, 'A notes'), (v_acct_b, 'B notes');

  insert into public.properties (owner_account_id, name, town, slug) values (v_acct_a, '12 Bayview Road', 'Moonta Bay', 'bayview') returning id into v_prop_a;
  insert into public.properties (owner_account_id, name, town, slug) values (v_acct_b, '9 Esplanade', 'Wallaroo', 'esplanade') returning id into v_prop_b;
  insert into fx values ('prop_a', v_prop_a), ('prop_b', v_prop_b);

  -- memberships written with no session (dashboard semantics): the guard allows active managers here
  insert into public.memberships (user_id, role, owner_account_id, status, is_primary_contact) values
    (v_jane, 'owner', v_acct_a, 'active', true),
    (v_rob, 'owner', v_acct_a, 'active', false),
    (v_mia, 'owner', v_acct_b, 'active', true);
  insert into public.memberships (user_id, role, crew_kind, status) values (v_kel, 'crew', 'cleaner', 'active');
  insert into public.memberships (user_id, role, status) values (v_court, 'manager', 'active'), (v_sam, 'manager', 'active');
  insert into public.memberships (user_id, role, status) values (v_newmgr, 'manager', 'invited');
  insert into public.crew_profiles (user_id, crew_kind, business_name) values (v_kel, 'cleaner', 'Kel Cleans');

  insert into public.leads (name, email, stage) values ('Lead One', 'lead@enquirers.test', 'new') returning id into v_lead;
  insert into fx values ('lead', v_lead);

  insert into public.agreements (property_id, owner_account_id, template_version, fee_schedule_id, setup_fee_cents)
    values (v_prop_a, v_acct_a, '2026-10', v_fee, 300000) returning id into v_agr_a;
  insert into public.agreements (property_id, owner_account_id, template_version, fee_schedule_id, setup_fee_cents)
    values (v_prop_b, v_acct_b, '2026-10', v_fee, 400000) returning id into v_agr_b;
  insert into fx values ('agr_a', v_agr_a), ('agr_b', v_agr_b);
  insert into public.disclosure_acknowledgements (agreement_id, key, version, acknowledged_by_user_id) values
    (v_agr_a, 'fee_definition', '2026-10', v_jane), (v_agr_b, 'fee_definition', '2026-10', v_mia);

  insert into public.dd_mandates (owner_account_id, collector, external_customer_id, status) values
    (v_acct_a, 'pinch', 'cust_a', 'active'), (v_acct_b, 'pinch', 'cust_b', 'pending');

  insert into public.offboardings (property_id, initiated_by, reason, effective_date, requested_by_user_id) values
    (v_prop_a, 'owner', 'selling', current_date + 60, v_jane), (v_prop_b, 'tidewell', 'other', current_date + 90, v_court);

  insert into public.documents (kind, owner_account_id, property_id, storage_path, sha256, retain_until) values
    ('statement', v_acct_a, v_prop_a, v_acct_a::text || '/2026/statement/a.pdf', decode(repeat('a', 64), 'hex'), current_date + 1825),
    ('statement', v_acct_b, v_prop_b, v_acct_b::text || '/2026/statement/b.pdf', decode(repeat('b', 64), 'hex'), current_date + 1825);
  insert into public.documents (kind, user_id, storage_path, sha256, retain_until) values
    ('remittance', v_kel, 'crew/' || v_kel::text || '/2026/remittance/k.pdf', decode(repeat('c', 64), 'hex'), current_date + 1825);

  insert into public.notification_preferences (user_id) values (v_jane), (v_mia), (v_kel);
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values
    (v_jane, 'https://push.test/jane', 'k', 'a'), (v_mia, 'https://push.test/mia', 'k', 'a'), (v_kel, 'https://push.test/kel', 'k', 'a');

  -- events through the emitter (owner audience) for each account; the router queues outbox rows
  v_ev := private.emit_event('property', v_prop_a, 'property.went_live', v_prop_a, v_acct_a, '{owner}',
            jsonb_build_object('name', '12 Bayview Road'), 'system', null);
  v_ev := private.emit_event('property', v_prop_b, 'property.went_live', v_prop_b, v_acct_b, '{owner}',
            jsonb_build_object('name', '9 Esplanade'), 'system', null);
  v_ev := private.emit_event('job', gen_random_uuid(), 'job.done', v_prop_a, v_acct_a, '{crew}', '{}'::jsonb, 'system', null);
  v_ev := private.emit_event('lead', v_lead, 'enquiry.received', null, null, '{internal}', '{}'::jsonb, 'system', null);

  insert into public.notifications (user_id, event_id, property_id, priority, title) values
    (v_jane, (select max(id) from public.events), v_prop_a, 2, 'Hello Jane'),
    (v_mia, (select max(id) from public.events), v_prop_b, 2, 'Hello Mia');

  insert into public.webhook_receipts (provider, external_event_id) values ('hospitable', 'evt_1');
  insert into public.integration_sync (provider, entity_type, entity_id) values ('xero', 'owner_account', v_acct_a);
  insert into public.rate_limits (key, tokens) values ('ip:127.0.0.1', 5);
end $$;
