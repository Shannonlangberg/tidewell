-- 0020_function_acl.sql
-- Function privileges, stated once at the end of phase 0 so they hold whatever the default ACL did.
-- `private`: nothing is executable by the API roles except the helpers that policies and view
-- bodies call (granted to authenticated by name) and the two auth hooks (supabase_auth_admin).
-- `public`: RPCs are never executable by anon or public; each RPC migration grants authenticated.
-- Later phases repeat the same two patterns for the functions they add.

revoke execute on all functions in schema private from public, anon, authenticated, service_role;

grant execute on function
  private.is_manager(),
  private.is_owner_of(uuid),
  private.is_active_owner_of(uuid),
  private.my_owner_account_ids(),
  private.my_active_owner_account_ids(),
  private.my_roles(),
  private.crew_at(uuid),
  private.can_see_job(uuid),
  private.shares_property(uuid),
  private.topic_property_id(text, text)
to authenticated;

grant execute on function
  private.custom_access_token_hook(jsonb),
  private.password_verification_hook(jsonb)
to supabase_auth_admin;

revoke execute on all functions in schema public from public, anon;
