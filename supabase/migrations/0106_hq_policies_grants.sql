-- 0106_hq_policies_grants.sql
-- Row level security and table privileges (design D3, section 6).
--
-- RLS is enabled AND forced on every hq table. Every policy is `to authenticated` and carries a
-- scoping predicate that asks the database (hq_private.has_capability, which reads the caller's LIVE
-- staff row and the MFA requirement); none is a bare role check and no JWT claim grants anything.
-- `anon` has no usage on the schema and no table grant. Policies call the helpers inside
-- `(select ...)` so Postgres evaluates them once per statement, not once per row.
--
-- Direct writes are granted only where RLS plus the 0104 guard triggers make them safe:
--   pods, organisations, contacts, tasks   insert + update (no delete: soft deletion or deactivation)
--   settings                               update of `value` only
--   opportunities, referrals, interactions update of a column whitelist only; they are CREATED by the
--                                          record_referral / record_interaction RPCs, and stage,
--                                          attribution and the signing fields move only through RPCs
--   staff_profiles, role_capabilities, audit_events, import_batches, opportunity_stage_history
--                                          select only (staff by RPC, the rest by trigger or RPC)
-- `truncate` and `delete` are granted to nobody.

alter table hq.pods enable row level security;                      alter table hq.pods force row level security;
alter table hq.staff_profiles enable row level security;            alter table hq.staff_profiles force row level security;
alter table hq.role_capabilities enable row level security;         alter table hq.role_capabilities force row level security;
alter table hq.settings enable row level security;                  alter table hq.settings force row level security;
alter table hq.organisations enable row level security;             alter table hq.organisations force row level security;
alter table hq.contacts enable row level security;                  alter table hq.contacts force row level security;
alter table hq.interactions enable row level security;              alter table hq.interactions force row level security;
alter table hq.opportunities enable row level security;             alter table hq.opportunities force row level security;
alter table hq.opportunity_stage_history enable row level security; alter table hq.opportunity_stage_history force row level security;
alter table hq.referrals enable row level security;                 alter table hq.referrals force row level security;
alter table hq.tasks enable row level security;                     alter table hq.tasks force row level security;
alter table hq.audit_events enable row level security;              alter table hq.audit_events force row level security;
alter table hq.import_batches enable row level security;            alter table hq.import_batches force row level security;

-- ------------------------------------------------------------------ people and configuration
-- Reference data any active staff session may read.
create policy pods_select on hq.pods for select to authenticated
  using ((select hq_private.staff_session()));
create policy pods_insert on hq.pods for insert to authenticated
  with check ((select hq_private.has_capability('people.admin')));
create policy pods_update on hq.pods for update to authenticated
  using ((select hq_private.has_capability('people.admin')))
  with check ((select hq_private.has_capability('people.admin')));

-- People: everyone who may see people (people.read), plus always your own row. Writes: RPC only.
create policy staff_profiles_select on hq.staff_profiles for select to authenticated
  using (
    (select hq_private.has_capability('people.read'))
    or (id = (select auth.uid()) and (select hq_private.staff_session()))
  );

create policy role_capabilities_select on hq.role_capabilities for select to authenticated
  using ((select hq_private.staff_session()));

create policy settings_select on hq.settings for select to authenticated
  using ((select hq_private.staff_session()));
create policy settings_update on hq.settings for update to authenticated
  using ((select hq_private.has_capability('settings.admin')))
  with check ((select hq_private.has_capability('settings.admin')));

-- ------------------------------------------------------------------ growth
-- Soft-deleted rows are hidden from everyone except growth.delete holders.
create policy organisations_select on hq.organisations for select to authenticated
  using ((select hq_private.has_capability('growth.read'))
         and (deleted_at is null or (select hq_private.has_capability('growth.delete'))));
create policy organisations_insert on hq.organisations for insert to authenticated
  with check ((select hq_private.has_capability('growth.write')));
create policy organisations_update on hq.organisations for update to authenticated
  using ((select hq_private.has_capability('growth.write'))
         and (deleted_at is null or (select hq_private.has_capability('growth.delete'))))
  with check ((select hq_private.has_capability('growth.write')));

create policy contacts_select on hq.contacts for select to authenticated
  using ((select hq_private.has_capability('growth.read'))
         and (deleted_at is null or (select hq_private.has_capability('growth.delete'))));
create policy contacts_insert on hq.contacts for insert to authenticated
  with check ((select hq_private.has_capability('growth.write')));
create policy contacts_update on hq.contacts for update to authenticated
  using ((select hq_private.has_capability('growth.write'))
         and (deleted_at is null or (select hq_private.has_capability('growth.delete'))))
  with check ((select hq_private.has_capability('growth.write')));

-- Interactions: written by record_interaction; an author edits their own, growth.delete holders any.
create policy interactions_select on hq.interactions for select to authenticated
  using ((select hq_private.has_capability('growth.read'))
         and (deleted_at is null or (select hq_private.has_capability('growth.delete'))));
create policy interactions_update on hq.interactions for update to authenticated
  using ((select hq_private.has_capability('growth.write'))
         and (staff_id = (select auth.uid()) or (select hq_private.has_capability('growth.delete')))
         and (deleted_at is null or (select hq_private.has_capability('growth.delete'))))
  with check ((select hq_private.has_capability('growth.write')));

-- Opportunities and referrals: created by record_referral; limited column updates; stage and
-- attribution move only through move_opportunity / set_attributed_referral.
create policy opportunities_select on hq.opportunities for select to authenticated
  using ((select hq_private.has_capability('growth.read'))
         and (deleted_at is null or (select hq_private.has_capability('growth.delete'))));
create policy opportunities_update on hq.opportunities for update to authenticated
  using ((select hq_private.has_capability('growth.write'))
         and (deleted_at is null or (select hq_private.has_capability('growth.delete'))))
  with check ((select hq_private.has_capability('growth.write')));

create policy referrals_select on hq.referrals for select to authenticated
  using ((select hq_private.has_capability('growth.read'))
         and (deleted_at is null or (select hq_private.has_capability('growth.delete'))));
create policy referrals_update on hq.referrals for update to authenticated
  using ((select hq_private.has_capability('growth.write'))
         and (deleted_at is null or (select hq_private.has_capability('growth.delete'))))
  with check ((select hq_private.has_capability('growth.write')));

-- History of an opportunity the caller can see.
create policy opportunity_stage_history_select on hq.opportunity_stage_history for select to authenticated
  using ((select hq_private.has_capability('growth.read'))
         and exists (select 1 from hq.opportunities o where o.id = opportunity_id));

-- ------------------------------------------------------------------ tasks
-- Visible to the assignee, the creator and anyone with tasks.read_all (and to growth.delete holders
-- when archived). Anyone with tasks.write may create; an update must be to a task you can see.
create policy tasks_select on hq.tasks for select to authenticated
  using (
    (select hq_private.staff_session())
    and (assigned_to = (select auth.uid()) or created_by = (select auth.uid()) or (select hq_private.has_capability('tasks.read_all')))
    and (deleted_at is null or (select hq_private.has_capability('growth.delete')))
  );
create policy tasks_insert on hq.tasks for insert to authenticated
  with check ((select hq_private.has_capability('tasks.write')));
create policy tasks_update on hq.tasks for update to authenticated
  using (
    (select hq_private.has_capability('tasks.write'))
    and (assigned_to = (select auth.uid()) or created_by = (select auth.uid()) or (select hq_private.has_capability('tasks.read_all')))
    and (deleted_at is null or (select hq_private.has_capability('growth.delete')))
  )
  with check ((select hq_private.has_capability('tasks.write')));

-- ------------------------------------------------------------------ audit and imports
create policy audit_events_select on hq.audit_events for select to authenticated
  using ((select hq_private.has_capability('audit.read')));

create policy import_batches_select on hq.import_batches for select to authenticated
  using ((select hq_private.has_capability('import.run')) or (select hq_private.has_capability('audit.read')));

-- ------------------------------------------------------------------ table privileges
-- Start from nothing, then grant exactly what the design needs.
revoke all on all tables in schema hq from public, anon, authenticated, service_role;
revoke all on all sequences in schema hq from public, anon, authenticated, service_role;

grant select on
  hq.pods, hq.staff_profiles, hq.role_capabilities, hq.settings, hq.organisations, hq.contacts,
  hq.interactions, hq.opportunities, hq.opportunity_stage_history, hq.referrals, hq.tasks,
  hq.audit_events, hq.import_batches
to authenticated;

grant insert, update on hq.pods, hq.organisations, hq.contacts, hq.tasks to authenticated;
grant update (value) on hq.settings to authenticated;

grant update (prospect_name, prospect_phone, prospect_email, property_suburb, property_address,
              estimated_annual_value_cents, assigned_to, notes, deleted_at)
  on hq.opportunities to authenticated;
grant update (referral_date, assigned_to, sent_outcome, prospect_name, prospect_phone, prospect_email,
              property_suburb, property_address, notes, deleted_at)
  on hq.referrals to authenticated;
grant update (interaction_type, summary, next_action, follow_up_date, deleted_at)
  on hq.interactions to authenticated;

-- The secret key reads (support, reports); it writes nothing directly. Account creation in Auth and
-- hq.bootstrap_first_director() are its only HQ jobs.
grant select on
  hq.pods, hq.staff_profiles, hq.role_capabilities, hq.settings, hq.organisations, hq.contacts,
  hq.interactions, hq.opportunities, hq.opportunity_stage_history, hq.referrals, hq.tasks,
  hq.audit_events, hq.import_batches
to service_role;
