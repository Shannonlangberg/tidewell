-- 0014_policies.sql
-- RLS for every phase-0 table (3.1, 3.3). Every policy is `to authenticated` (or the auth admin
-- role for the hook) and carries its scoping predicate; the secret key bypasses RLS and writes the
-- tables marked "secret key only". Tables with no policy for a role give that role nothing.

-- profiles: select own row or manager; update own name, phone, timezone or manager; insert by trigger only.
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.is_manager());
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()) or private.is_manager())
  with check (id = (select auth.uid()) or private.is_manager());

create function private.profiles_self_update_guard() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
begin
  if new.phone_e164 is distinct from old.phone_e164 then
    new.phone_verified_at := null;
    new.sms_opt_out_at := null;
  end if;
  if private.is_manager() or auth.uid() is null then
    return new;
  end if;
  if row(new.id, new.email, new.phone_verified_at, new.sms_opt_out_at, new.email_bounced_at, new.is_active, new.mfa_enrolled_at, new.created_at)
     is distinct from
     row(old.id, old.email, old.phone_verified_at, old.sms_opt_out_at, old.email_bounced_at, old.is_active, old.mfa_enrolled_at, old.created_at) then
    raise exception 'a person may change only their name, phone and timezone' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
create trigger profiles_self_update_guard before update on public.profiles
  for each row execute function private.profiles_self_update_guard();

-- org_settings: M. Every other role reads org_settings_public (0019).
create policy org_settings_select on public.org_settings for select to authenticated
  using (private.is_manager());
create policy org_settings_update on public.org_settings for update to authenticated
  using (private.is_manager()) with check (private.is_manager());

-- fee_schedules: M (select, insert); update and delete none. Public view in 0019.
create policy fee_schedules_select on public.fee_schedules for select to authenticated
  using (private.is_manager());
create policy fee_schedules_insert on public.fee_schedules for insert to authenticated
  with check (private.is_manager());

-- owner_accounts: A (select manager or members; writes manager); delete none.
create policy owner_accounts_select on public.owner_accounts for select to authenticated
  using (private.is_manager() or id = any (private.my_owner_account_ids()));
create policy owner_accounts_insert on public.owner_accounts for insert to authenticated
  with check (private.is_manager());
create policy owner_accounts_update on public.owner_accounts for update to authenticated
  using (private.is_manager()) with check (private.is_manager());

-- owner_account_notes: M; delete none.
create policy owner_account_notes_select on public.owner_account_notes for select to authenticated
  using (private.is_manager());
create policy owner_account_notes_insert on public.owner_account_notes for insert to authenticated
  with check (private.is_manager());
create policy owner_account_notes_update on public.owner_account_notes for update to authenticated
  using (private.is_manager()) with check (private.is_manager());

-- memberships: select own rows, manager, or rows on an account the caller belongs to; writes only
-- through add_member() / end_membership() / confirm_member(). The supabase_auth_admin policy for the
-- token hook is in 0017_auth_hooks.sql.
create policy memberships_select on public.memberships for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.is_manager()
    or (owner_account_id is not null and owner_account_id = any (private.my_owner_account_ids()))
  );

-- properties: P (select manager or owner of the property; writes manager); delete none.
create policy properties_select on public.properties for select to authenticated
  using (private.is_manager() or private.is_owner_of(id));
create policy properties_insert on public.properties for insert to authenticated
  with check (private.is_manager());
create policy properties_update on public.properties for update to authenticated
  using (private.is_manager()) with check (private.is_manager());

-- leads: M; insert secret key (enquiry handler) or manager; delete none.
create policy leads_select on public.leads for select to authenticated
  using (private.is_manager());
create policy leads_insert on public.leads for insert to authenticated
  with check (private.is_manager());
create policy leads_update on public.leads for update to authenticated
  using (private.is_manager()) with check (private.is_manager());

-- events: select manager; owner where audience contains owner and the property or account is theirs;
-- crew where audience contains crew and the entity is a job they hold (phase 3 adds items).
create policy events_select_manager on public.events for select to authenticated
  using (private.is_manager());
create policy events_select_owner on public.events for select to authenticated
  using (
    audience @> '{owner}'
    and (
      (property_id is not null and private.is_owner_of(property_id))
      or (owner_account_id is not null and owner_account_id = any (private.my_owner_account_ids()))
    )
  );
create policy events_select_crew on public.events for select to authenticated
  using (
    audience @> '{crew}'
    and entity_id is not null
    and entity_type = 'job'
    and private.can_see_job(entity_id)
  );

-- documents: select manager, members, the user_id; update downloaded_at / resent_at only (trigger);
-- insert secret key or attach_document() (phase 4); delete none.
create policy documents_select on public.documents for select to authenticated
  using (
    private.is_manager()
    or (owner_account_id is not null and owner_account_id = any (private.my_owner_account_ids()))
    or user_id = (select auth.uid())
  );
create policy documents_update on public.documents for update to authenticated
  using (
    private.is_manager()
    or (owner_account_id is not null and owner_account_id = any (private.my_owner_account_ids()))
    or user_id = (select auth.uid())
  )
  with check (
    private.is_manager()
    or (owner_account_id is not null and owner_account_id = any (private.my_owner_account_ids()))
    or user_id = (select auth.uid())
  );

-- crew_profiles: select self or manager; insert manager; update manager (self: business name, address, ABN before verification).
create policy crew_profiles_select on public.crew_profiles for select to authenticated
  using (user_id = (select auth.uid()) or private.is_manager());
create policy crew_profiles_insert on public.crew_profiles for insert to authenticated
  with check (private.is_manager());
create policy crew_profiles_update on public.crew_profiles for update to authenticated
  using (user_id = (select auth.uid()) or private.is_manager())
  with check (user_id = (select auth.uid()) or private.is_manager());
create trigger crew_profiles_self_update_guard before update on public.crew_profiles
  for each row execute function private.crew_profiles_self_update_guard();

-- agreements: A (owner signs through sign_agreement(), phase 1); delete none.
create policy agreements_select on public.agreements for select to authenticated
  using (private.is_manager() or owner_account_id = any (private.my_owner_account_ids()));
create policy agreements_insert on public.agreements for insert to authenticated
  with check (private.is_manager());
create policy agreements_update on public.agreements for update to authenticated
  using (private.is_manager()) with check (private.is_manager());

-- disclosure_acknowledgements: child(agreements); insert via sign_agreement(); no update or delete.
create policy disclosure_acknowledgements_select on public.disclosure_acknowledgements for select to authenticated
  using (
    private.is_manager()
    or exists (
      select 1 from public.agreements a
      where a.id = agreement_id and a.owner_account_id = any (private.my_owner_account_ids())
    )
  );

-- dd_mandates: select A; writes secret key only.
create policy dd_mandates_select on public.dd_mandates for select to authenticated
  using (private.is_manager() or owner_account_id = any (private.my_owner_account_ids()));

-- offboardings: select P; writes through the offboarding RPCs (phase 8).
create policy offboardings_select on public.offboardings for select to authenticated
  using (private.is_manager() or private.is_owner_of(property_id));

-- notification_rules: a person reads the rules for the roles they hold; managers read and write all.
create policy notification_rules_select on public.notification_rules for select to authenticated
  using (private.is_manager() or recipient_role = any (private.my_roles()));
create policy notification_rules_insert on public.notification_rules for insert to authenticated
  with check (private.is_manager());
create policy notification_rules_update on public.notification_rules for update to authenticated
  using (private.is_manager()) with check (private.is_manager());

-- notification_preferences: own row; manager select.
create policy notification_preferences_select on public.notification_preferences for select to authenticated
  using (user_id = (select auth.uid()) or private.is_manager());
create policy notification_preferences_insert on public.notification_preferences for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy notification_preferences_update on public.notification_preferences for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- push_subscriptions: own rows; the worker (secret key) sets failed_at.
create policy push_subscriptions_select on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));
create policy push_subscriptions_insert on public.push_subscriptions for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy push_subscriptions_update on public.push_subscriptions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy push_subscriptions_delete on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));

-- outbox: no client policies (RLS enabled and forced in 0011; only route_event() and the worker).

-- notifications: select and update (read_at, column grant in 0015) own rows; insert by the worker.
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- webhook_receipts, integration_sync: M select; writes secret key.
create policy webhook_receipts_select on public.webhook_receipts for select to authenticated
  using (private.is_manager());
create policy integration_sync_select on public.integration_sync for select to authenticated
  using (private.is_manager());

-- rate_limits: no client policies (secret key only).
