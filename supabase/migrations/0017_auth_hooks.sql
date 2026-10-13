-- 0017_auth_hooks.sql
-- The Custom Access Token hook and the Password Verification hook (3.1, 3.6, section 8), with the
-- grants the hook migration carries: usage on private and execute on the hook to
-- supabase_auth_admin, select on memberships plus its policy. config.toml registers both as
-- pg-functions://postgres/private/<name>.

-- Claims route the UI only (decision 3): app_roles text[], is_manager bool, crew_kind text or null,
-- owner_account_ids uuid[], all from active memberships. RLS never trusts them. `is_manager` here
-- means "holds a manager membership"; private.is_manager() additionally requires aal2.
create function private.custom_access_token_hook(event jsonb) returns jsonb
language plpgsql stable security invoker set search_path = pg_catalog, public, extensions as $$
declare
  v_uid uuid := (event ->> 'user_id')::uuid;
  v_claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  v_roles text[];
  v_is_manager boolean;
  v_crew_kind text;
  v_accounts uuid[];
begin
  select
    coalesce(array_agg(distinct m.role::text order by m.role::text), '{}'::text[]),
    coalesce(bool_or(m.role = 'manager'), false),
    (array_agg(m.crew_kind::text order by m.created_at) filter (where m.role = 'crew' and m.crew_kind is not null))[1],
    coalesce(array_agg(distinct m.owner_account_id) filter (where m.role = 'owner' and m.owner_account_id is not null), '{}'::uuid[])
  into v_roles, v_is_manager, v_crew_kind, v_accounts
  from public.memberships m
  where m.user_id = v_uid
    -- Active rows, plus read_only owners (the 90 days after a property closes): they may
    -- still read their statements and photos, so the UI must still route them somewhere.
    and (m.status = 'active' or (m.role = 'owner' and m.status = 'read_only'));

  v_claims := v_claims || jsonb_build_object(
    'app_roles', to_jsonb(v_roles),
    'is_manager', v_is_manager,
    'crew_kind', v_crew_kind,
    'owner_account_ids', to_jsonb(v_accounts)
  );
  return jsonb_set(event, '{claims}', v_claims);
end $$;
comment on function private.custom_access_token_hook(jsonb) is 'Supabase Auth custom access token hook. Adds app_roles, is_manager, crew_kind, owner_account_ids from active memberships. Routes the UI only.';

-- Password sign-in is refused for everyone: codes by email are the single door (section 8).
create function private.password_verification_hook(event jsonb) returns jsonb
language sql immutable security invoker set search_path = pg_catalog as $$
  select jsonb_build_object(
    'decision', 'reject',
    'message', 'Password sign-in is not available. Ask for a sign-in code by email.'
  )
$$;
comment on function private.password_verification_hook(jsonb) is 'Supabase Auth password verification hook. Rejects every password sign-in.';

grant usage on schema private to supabase_auth_admin;
grant execute on function private.custom_access_token_hook(jsonb) to supabase_auth_admin;
grant execute on function private.password_verification_hook(jsonb) to supabase_auth_admin;
revoke execute on function private.custom_access_token_hook(jsonb) from authenticated, anon, public;
revoke execute on function private.password_verification_hook(jsonb) from authenticated, anon, public;

grant select on table public.memberships to supabase_auth_admin;
create policy memberships_auth_admin_select on public.memberships for select to supabase_auth_admin
  using (status = 'active' or (role = 'owner' and status = 'read_only'));
