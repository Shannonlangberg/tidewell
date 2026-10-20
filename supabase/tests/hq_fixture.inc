-- hq_fixture.inc: shared pgTAP helpers for the Planted HQ tests, included with \ir from each hq_*.sql.
-- Not a test itself. Everything lives in pg_temp and in the test's transaction, so nothing leaks.
-- (Run `supabase test db` on the whole directory, never one file: the include path is relative.)

-- A minimal auth.users row. The existing on_auth_user_created trigger (Tidewell phase 0) requires
-- user_metadata.full_name and first_name, so they are supplied.
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

-- Simulate a session: the claims PostgREST would set. Pair with `set local role authenticated`.
create function pg_temp.login(p_uid uuid, p_aal text default 'aal2') returns void
language sql as $$
  select set_config('request.jwt.claims',
    jsonb_strip_nulls(jsonb_build_object('sub', p_uid, 'role', 'authenticated', 'aal', p_aal))::text, true);
$$;
create function pg_temp.logout() returns void
language sql as $$
  select set_config('request.jwt.claims', '', true);
$$;

-- Fixture ids by key (see pg_temp.seed_hq).
create temp table fx (key text primary key, id uuid not null) on commit drop;
grant select, insert on fx to public; -- readable (and, for keep(), writable) after `set local role authenticated`
create function pg_temp.fx(p_key text) returns uuid
language sql stable as $$ select id from fx where key = p_key $$;

-- keep('r1', <jsonb result of an RPC>) stores every uuid field of the result as fx key r1_<field>,
-- so a test can refer to ids an RPC just created (r1_referral_id, r1_opportunity_id, ...).
create function pg_temp.keep(p_prefix text, p_result jsonb) returns void
language sql as $$
  insert into fx
  select p_prefix || '_' || e.key, (e.value #>> '{}')::uuid
  from jsonb_each(p_result) e
  where jsonb_typeof(e.value) = 'string' and (e.value #>> '{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
$$;

-- become('dir') = sign in as that fixture person (aal2 unless said) and switch to the API role;
-- unbecome() = back to the test's own role with no session.
create function pg_temp.become(p_key text, p_aal text default 'aal2') returns void
language plpgsql as $$
begin
  perform pg_temp.login(pg_temp.fx(p_key), p_aal);
  execute 'set local role authenticated';
end $$;
create function pg_temp.become_anon() returns void
language plpgsql as $$
begin
  perform pg_temp.logout();
  execute 'set local role anon';
end $$;
create function pg_temp.become_service() returns void
language plpgsql as $$
begin
  perform pg_temp.logout();
  execute 'set local role service_role';
end $$;
create function pg_temp.unbecome() returns void
language plpgsql as $$
begin
  execute 'reset role';
  perform pg_temp.logout();
end $$;

-- Staff, one per role (two directors), an outsider with a login but no HQ profile, and a small
-- partner graph. Any data already in the local database is put out of the way for this transaction
-- (archived or deactivated, then rolled back), so counts and "last director" tests are exact.
--   dir dir2 adm spm pm jpm bdm va ro     outsider
--   alpha (Alpha Realty) beta (Beta Broking) gamma (Gamma Conveyancing)
--   alice (alpha, primary) alex (alpha) bob (beta, primary) carol (gamma, primary)
create function pg_temp.seed_hq() returns void
language plpgsql as $$
declare
  r record;
  v uuid;
begin
  update hq.settings set value = 'true'::jsonb where key = 'require_mfa';
  update hq.settings set value = '"Australia/Adelaide"'::jsonb where key = 'timezone';

  for r in select * from (values
    ('dir',  'Dana Director',  'Dana',  'director'),
    ('dir2', 'Dev Director',   'Dev',   'director'),
    ('adm',  'Ada Admin',      'Ada',   'administrator'),
    ('spm',  'Sam Senior',     'Sam',   'senior_property_manager'),
    ('pm',   'Pat Manager',    'Pat',   'property_manager'),
    ('jpm',  'Jo Junior',      'Jo',    'junior_property_manager'),
    ('bdm',  'Bree Business',  'Bree',  'business_development_manager'),
    ('va',   'Val Assistant',  'Val',   'virtual_assistant'),
    ('ro',   'Rory Readonly',  'Rory',  'read_only')
  ) as t(k, full_name, first_name, role) loop
    v := pg_temp.mk_user(r.k || '@hq.test', r.full_name, r.first_name);
    insert into fx values (r.k, v);
    insert into hq.staff_profiles (id, email, full_name, first_name, role)
    values (v, r.k || '@hq.test', r.full_name, r.first_name, r.role::hq.staff_role);
  end loop;
  insert into fx values ('outsider', pg_temp.mk_user('outsider@hq.test', 'Olly Outsider', 'Olly'));

  -- anything already in this database is put out of the way for the transaction
  update hq.staff_profiles set is_active = false where id not in (select id from fx);
  update hq.interactions set deleted_at = now() where deleted_at is null;
  update hq.tasks set deleted_at = now() where deleted_at is null;
  update hq.referrals set deleted_at = now() where deleted_at is null;
  update hq.managed_properties set deleted_at = now() where deleted_at is null; -- 0129: a live managed property keeps its opportunity live
  update hq.opportunities set deleted_at = now() where deleted_at is null;
  update hq.contacts set deleted_at = now() where deleted_at is null;
  update hq.organisations set deleted_at = now() where deleted_at is null;

  insert into hq.organisations (name, categories, service_region) values ('Alpha Realty', '{real_estate_sales}', 'Copper Coast') returning id into v;
  insert into fx values ('alpha', v);
  insert into hq.organisations (name, categories) values ('Beta Broking', '{mortgage_broker}') returning id into v;
  insert into fx values ('beta', v);
  insert into hq.organisations (name, categories) values ('Gamma Conveyancing', '{conveyancer}') returning id into v;
  insert into fx values ('gamma', v);

  insert into hq.contacts (organisation_id, full_name, email, org_contact_role)
    values (pg_temp.fx('alpha'), 'Alice Anders', 'alice@alpha.test', 'primary') returning id into v;
  insert into fx values ('alice', v);
  insert into hq.contacts (organisation_id, full_name) values (pg_temp.fx('alpha'), 'Alex Archer') returning id into v;
  insert into fx values ('alex', v);
  insert into hq.contacts (organisation_id, full_name, email, org_contact_role)
    values (pg_temp.fx('beta'), 'Bob Brown', 'bob@beta.test', 'primary') returning id into v;
  insert into fx values ('bob', v);
  insert into hq.contacts (organisation_id, full_name, org_contact_role)
    values (pg_temp.fx('gamma'), 'Carol Clark', 'primary') returning id into v;
  insert into fx values ('carol', v);
end $$;

-- Archive everything in the growth tables (a clean slate for exact-count tests).
create function pg_temp.clear_growth() returns void
language plpgsql as $$
begin
  update hq.interactions set deleted_at = now() where deleted_at is null;
  update hq.tasks set deleted_at = now() where deleted_at is null;
  update hq.referrals set deleted_at = now() where deleted_at is null;
  update hq.managed_properties set deleted_at = now() where deleted_at is null; -- 0129: a live managed property keeps its opportunity live
  update hq.opportunities set deleted_at = now() where deleted_at is null;
  update hq.contacts set deleted_at = now() where deleted_at is null;
  update hq.organisations set deleted_at = now() where deleted_at is null;
end $$;
