-- 0019_views.sql
-- Definer views (3.1 model): plain security_barrier views owned by postgres with the role predicate
-- in the body; the base table grants nothing to the role the view serves; select goes to
-- authenticated (and anon for the two public views). Supabase advisor lint 0010
-- (security_definer_view) is expected for exactly these views and is suppressed by design.

-- org_settings_public: the published fields, hours, timezone and licence number. Nulls are
-- unconfirmed facts; the site hides them. Readable by anon and authenticated.
create view public.org_settings_public with (security_barrier = true) as
  select
    legal_name,
    abn,
    published_phone_e164,
    published_url,
    hours_start,
    hours_end,
    timezone,
    sla_minutes,
    land_agent_licence_number,
    onboarding_open,
    disclosure_set_version,
    privacy_policy_version,
    collection_notice_version
  from public.org_settings
  where id;
comment on view public.org_settings_public is 'Definer view (3.1). Published organisation facts for the site and every signed-in role. Lint 0010 suppressed by design.';
revoke all on public.org_settings_public from public, anon, authenticated, service_role;
grant select on public.org_settings_public to anon, authenticated, service_role;

-- fee_schedules_public: every column but created_by. The site reads 18% + GST, the 19.8% total,
-- the setup band, the notice period and the pass-through definition from here.
create view public.fee_schedules_public with (security_barrier = true) as
  select
    id,
    effective_from,
    management_fee_bps,
    gst_bps,
    total_fee_inc_gst_bps,
    setup_fee_min_inc_gst_cents,
    setup_fee_max_inc_gst_cents,
    fee_base,
    revenue_recognition,
    cleaning_model,
    clean_charge_basis,
    owner_stay_clean_at_cost,
    cancellation_payout_fee_bps,
    default_notice_days,
    fee_definition,
    passthrough_definition,
    published_url,
    published_at,
    created_at
  from public.fee_schedules
  where effective_from is not null;
comment on view public.fee_schedules_public is 'Definer view (3.1). Published prices for the site and every signed-in role; never created_by. Lint 0010 suppressed by design.';
revoke all on public.fee_schedules_public from public, anon, authenticated, service_role;
grant select on public.fee_schedules_public to anon, authenticated, service_role;

-- profiles_directory: first names only, for a signed-in person: managers, the person themself, and
-- people who share a property with them (co-owners now; co-assignees on open jobs from phase 3).
-- Never email or phone.
create view public.profiles_directory with (security_barrier = true) as
  select
    p.id,
    p.first_name,
    p.initials,
    exists (
      select 1 from public.memberships m
      where m.user_id = p.id and m.role = 'manager' and m.status = 'active'
    ) as is_manager
  from public.profiles p
  where (select auth.uid()) is not null
    and p.is_active
    and (
      p.id = (select auth.uid())
      or exists (
        select 1 from public.memberships m
        where m.user_id = p.id and m.role = 'manager' and m.status = 'active'
      )
      or private.shares_property(p.id)
    );
comment on view public.profiles_directory is 'Definer view (3.1). First names of managers, the caller, and people sharing a property with the caller. Lint 0010 suppressed by design.';
revoke all on public.profiles_directory from public, anon, authenticated, service_role;
grant select on public.profiles_directory to authenticated, service_role;
