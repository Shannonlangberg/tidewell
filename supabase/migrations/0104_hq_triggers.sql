-- 0104_hq_triggers.sql
-- Guard and bookkeeping triggers (design section 4 conventions, section 6). These make direct writes
-- by `authenticated` safe: the database, not the client, decides who created a row, when it was
-- updated, who archived it, who verified it and when a task was completed.
--
-- Caller test: the guards that police a person's direct write check `current_user in
-- ('authenticated', 'anon')`. A security definer RPC runs as its owner (postgres), so an RPC that
-- has already checked its own capability passes through; the migration, the secret key and a seed
-- script are system writers and are trusted. Invariants that must hold for every writer (the last
-- director, one attributed referral, append-only history) do not test the caller at all.

-- id is immutable; created_at / created_by are stamped by the database; updated_at is maintained.
create function hq_private.row_stamp() returns trigger
language plpgsql set search_path = pg_catalog, public, extensions as $$
declare
  v_uid uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    if v_uid is not null then
      new.created_by := v_uid;
      new.created_at := now();
    end if;
    new.updated_at := now();
  else
    if new.id is distinct from old.id then
      raise exception 'the id of a % row cannot change', tg_table_name using errcode = 'insufficient_privilege';
    end if;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.updated_at := now();
  end if;
  return new;
end $$;

create trigger row_stamp before insert or update on hq.pods for each row execute function hq_private.row_stamp();
create trigger row_stamp before insert or update on hq.staff_profiles for each row execute function hq_private.row_stamp();
create trigger row_stamp before insert or update on hq.organisations for each row execute function hq_private.row_stamp();
create trigger row_stamp before insert or update on hq.contacts for each row execute function hq_private.row_stamp();
create trigger row_stamp before insert or update on hq.opportunities for each row execute function hq_private.row_stamp();
create trigger row_stamp before insert or update on hq.referrals for each row execute function hq_private.row_stamp();
create trigger row_stamp before insert or update on hq.tasks for each row execute function hq_private.row_stamp();
create trigger row_stamp before insert or update on hq.interactions for each row execute function hq_private.row_stamp();

-- Soft deletion: a person's direct change to deleted_at needs growth.delete; deleted_by is always
-- the caller (or null on restore) and cannot be written by hand. The archive_record / restore_record
-- RPCs (definer, own capability checks) pass through.
create function hq_private.soft_delete_guard() returns trigger
language plpgsql set search_path = pg_catalog, public, extensions as $$
begin
  if tg_op = 'INSERT' then
    if current_user in ('authenticated', 'anon') then
      new.deleted_at := null;
      new.deleted_by := null;
    end if;
    return new;
  end if;
  if new.deleted_at is distinct from old.deleted_at then
    if current_user in ('authenticated', 'anon') and not hq_private.has_capability('growth.delete') then
      raise exception 'archiving or restoring a record needs growth.delete' using errcode = 'insufficient_privilege';
    end if;
    new.deleted_by := case when new.deleted_at is null then null else coalesce(auth.uid(), new.deleted_by) end;
  else
    new.deleted_by := old.deleted_by;
  end if;
  return new;
end $$;

create trigger soft_delete_guard before insert or update on hq.organisations for each row execute function hq_private.soft_delete_guard();
create trigger soft_delete_guard before insert or update on hq.contacts for each row execute function hq_private.soft_delete_guard();
create trigger soft_delete_guard before insert or update on hq.opportunities for each row execute function hq_private.soft_delete_guard();
create trigger soft_delete_guard before insert or update on hq.referrals for each row execute function hq_private.soft_delete_guard();
create trigger soft_delete_guard before insert or update on hq.tasks for each row execute function hq_private.soft_delete_guard();
create trigger soft_delete_guard before insert or update on hq.interactions for each row execute function hq_private.soft_delete_guard();

-- Verification: needs_verification true means unverified. Clearing it stamps verified_at and
-- verified_by (the caller); setting it again clears both. A person cannot write the stamp by hand.
create function hq_private.verification_guard() returns trigger
language plpgsql set search_path = pg_catalog, public, extensions as $$
begin
  if tg_op = 'INSERT' then
    if new.needs_verification or current_user in ('authenticated', 'anon') then
      new.verified_at := null;
      new.verified_by := null;
    end if;
    return new;
  end if;
  if new.needs_verification then
    new.verified_at := null;
    new.verified_by := null;
  elsif old.needs_verification then
    new.verified_at := now();
    new.verified_by := auth.uid();
  else
    new.verified_at := old.verified_at;
    new.verified_by := old.verified_by;
  end if;
  return new;
end $$;

create trigger verification_guard before insert or update on hq.organisations for each row execute function hq_private.verification_guard();
create trigger verification_guard before insert or update on hq.contacts for each row execute function hq_private.verification_guard();

-- Tasks: completed_at / completed_by follow the status (set when it becomes completed, cleared when
-- it leaves), so a client only ever changes `status`.
create function hq_private.task_completion() returns trigger
language plpgsql set search_path = pg_catalog, public, extensions as $$
begin
  if new.status = 'completed' then
    if tg_op = 'INSERT' or old.status <> 'completed' then
      new.completed_at := now();
      new.completed_by := auth.uid();
    else
      new.completed_at := old.completed_at;
      new.completed_by := old.completed_by;
    end if;
  else
    new.completed_at := null;
    new.completed_by := null;
  end if;
  return new;
end $$;
create trigger task_completion before insert or update on hq.tasks for each row execute function hq_private.task_completion();

-- Opportunities: stage_changed_at follows the stage; every creation and stage change writes an
-- append-only history row (the source for "ever reached qualified"). The optional note comes from
-- the transaction-local setting hq.stage_note, set by move_opportunity.
create function hq_private.opportunity_stage_stamp() returns trigger
language plpgsql set search_path = pg_catalog, public, extensions as $$
begin
  if new.stage is distinct from old.stage then
    new.stage_changed_at := now();
  end if;
  return new;
end $$;
create trigger stage_stamp before update on hq.opportunities for each row execute function hq_private.opportunity_stage_stamp();

create function hq_private.opportunity_history() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
begin
  if tg_op = 'INSERT' then
    insert into hq.opportunity_stage_history (opportunity_id, from_stage, to_stage, changed_by, note)
    values (new.id, null, new.stage, auth.uid(), nullif(current_setting('hq.stage_note', true), ''));
  elsif new.stage is distinct from old.stage then
    insert into hq.opportunity_stage_history (opportunity_id, from_stage, to_stage, changed_by, note)
    values (new.id, old.stage, new.stage, auth.uid(), nullif(current_setting('hq.stage_note', true), ''));
  end if;
  return null;
end $$;
create trigger stage_history after insert or update on hq.opportunities for each row execute function hq_private.opportunity_history();

-- At least one active director must always remain (any writer, including the secret key).
create function hq_private.last_director_guard() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_others integer;
begin
  if not (old.role = 'director' and old.is_active and old.employment_status = 'active') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'UPDATE' and new.role = 'director' and new.is_active and new.employment_status = 'active' then
    return new;
  end if;
  -- Two directors removed at the same moment must not both pass: serialise the check.
  perform pg_advisory_xact_lock(hashtextextended('hq.last_director', 0));
  select count(*) into v_others
  from hq.staff_profiles sp
  where sp.role = 'director' and sp.is_active and sp.employment_status = 'active' and sp.id <> old.id;
  if v_others = 0 then
    raise exception 'at least one active director must remain' using errcode = 'check_violation';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger last_director_guard before update or delete on hq.staff_profiles
  for each row execute function hq_private.last_director_guard();

-- Settings: known keys are validated; the writer is stamped.
create function hq_private.settings_guard() returns trigger
language plpgsql set search_path = pg_catalog, public, extensions as $$
begin
  if tg_op = 'UPDATE' and new.key is distinct from old.key then
    raise exception 'a setting key cannot change' using errcode = 'insufficient_privilege';
  end if;
  if new.key = 'require_mfa' and jsonb_typeof(new.value) is distinct from 'boolean' then
    raise exception 'require_mfa must be true or false' using errcode = 'invalid_parameter_value';
  end if;
  if new.key = 'timezone' and (
       jsonb_typeof(new.value) is distinct from 'string'
       or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = new.value #>> '{}')) then
    raise exception 'timezone must be an IANA timezone name' using errcode = 'invalid_parameter_value';
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;
create trigger settings_guard before insert or update on hq.settings for each row execute function hq_private.settings_guard();

-- Referrals: the partner organisation follows the partner contact. A referral that names a contact
-- but no organisation takes the contact's organisation; one that names both must agree. This is what
-- lets partner_performance credit the right organisation.
create function hq_private.referral_partners() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_org uuid;
begin
  if new.referring_contact_id is not null then
    select c.organisation_id into v_org from hq.contacts c where c.id = new.referring_contact_id;
    if new.referring_organisation_id is null then
      new.referring_organisation_id := v_org;
    elsif v_org is not null and v_org <> new.referring_organisation_id then
      raise exception 'the referring contact does not belong to the referring organisation' using errcode = 'invalid_parameter_value';
    end if;
  end if;
  if new.receiving_contact_id is not null then
    select c.organisation_id into v_org from hq.contacts c where c.id = new.receiving_contact_id;
    if new.receiving_organisation_id is null then
      new.receiving_organisation_id := v_org;
    elsif v_org is not null and v_org <> new.receiving_organisation_id then
      raise exception 'the receiving contact does not belong to the receiving organisation' using errcode = 'invalid_parameter_value';
    end if;
  end if;
  return new;
end $$;
create trigger referral_partners before insert or update on hq.referrals for each row execute function hq_private.referral_partners();

-- Exactly one attributed referral per opportunity, always. The partial unique index
-- (referrals_one_attributed_uq) makes "more than one" impossible; this deferred check makes "none"
-- impossible while the opportunity still has a live received referral. Deferred, so a transaction may
-- move attribution between two referrals.
create function hq_private.check_attribution() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_opp uuid;
begin
  for v_opp in
    select distinct x.id
    from (values (new.opportunity_id), (case when tg_op = 'UPDATE' then old.opportunity_id end)) as x(id)
    where x.id is not null
  loop
    if exists (select 1 from hq.referrals r where r.opportunity_id = v_opp and r.direction = 'received' and r.deleted_at is null)
       and not exists (select 1 from hq.referrals r where r.opportunity_id = v_opp and r.is_attributed and r.deleted_at is null) then
      raise exception 'opportunity % has received referrals but none is attributed; move attribution first', v_opp
        using errcode = 'check_violation';
    end if;
  end loop;
  return null;
end $$;
create constraint trigger referrals_attribution after insert or update on hq.referrals
  deferrable initially deferred for each row execute function hq_private.check_attribution();

-- Append-only tables: no update, no delete, no truncate, for any role.
create trigger append_only before update or delete on hq.audit_events
  for each row execute function hq_private.raise_immutable();
create trigger append_only_truncate before truncate on hq.audit_events
  for each statement execute function hq_private.raise_immutable();
create trigger append_only before update or delete on hq.opportunity_stage_history
  for each row execute function hq_private.raise_immutable();
create trigger append_only_truncate before truncate on hq.opportunity_stage_history
  for each statement execute function hq_private.raise_immutable();

revoke execute on all functions in schema hq_private from public, anon;
