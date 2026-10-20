-- 0129_hq_managed_properties.sql
-- The portfolio: a LIGHT record of each property Planted manages, its Ailo handover checklist, and the
-- business goal (how many managed properties, by when). Same patterns as the contractor vetting steps
-- (0112, 0113, 0116) and the decisions register (0125).
--
-- AILO IS THE SYSTEM OF RECORD for rent, trust accounting, tenancies, maintenance, inspections and owner
-- communications. No public Ailo API is known, so HQ builds NO sync and stores NO Ailo credentials: it
-- holds only what is needed to run the company (who the owner is, the service, the fee basis, the dates,
-- the status) plus the Ailo reference a person types in by hand, and the checklist that gets a newly
-- signed property set up in Ailo.
--
-- TABLES (schema hq; RLS enabled and forced; the API may only SELECT; every write goes through the
-- security definer RPCs in 0130, as with hq.decisions):
--   managed_properties        one row per managed property, shown as MP-0001 (ref_number). Created from a
--                             SIGNED opportunity (convert_to_managed_property; one property per
--                             opportunity), or, for a property signed before HQ existed, without one but
--                             with a note saying where it came from (add_existing_managed_property). Soft
--                             deletion only (archive_record / restore_record, entity managed_property).
--   property_handover_steps   the nine handover steps, one row per step, created by trigger with the
--                             property. Written only by set_handover_step. Completing them never changes
--                             the property's status: that is a separate, deliberate change.
--
-- CAPABILITIES (data, in hq.role_capabilities; an assumption for the owner to confirm):
--   portfolio.read   director, administrator, senior_property_manager, property_manager,
--                    business_development_manager, read_only
--   portfolio.write  director, administrator, senior_property_manager
--
-- RULES (database-enforced, for every writer including the table owner):
--   * an opportunity, when given, is live and at management_signed when the property is created; it
--     never changes afterwards; a live property keeps its opportunity signed and live (the opportunity
--     cannot leave management_signed or be archived while a live managed property points at it);
--   * no opportunity => manual_origin_note is required (a property signed before HQ);
--   * property_address is required (1..300); an owner is required (a contact, or a name);
--   * status active needs managed_from (on or before today); ended <=> ended_on (on or before today, not
--     before managed_from); a new property starts onboarding or active;
--   * ailo_status live needs an ailo_reference; an ailo_reference is unique among live properties;
--   * fee: percent_of_rent <=> fee_percent (0 to 100, two decimals); other fee bases carry no percent;
--   * the same address (normalised) is not managed twice at once (live and not ended).
--
-- GOAL: settings goal_managed_properties (default 20, a whole number 1..10000) and goal_date (JSON null
-- until a director sets it; NEVER invented). Validated by settings_guard; written by set_business_goal.

-- ------------------------------------------------------------------ enums
create type hq.service_type as enum ('long_term_residential', 'short_term_accommodation');
create type hq.fee_basis as enum ('percent_of_rent', 'flat_fee', 'other');
create type hq.managed_status as enum ('onboarding', 'active', 'offboarding', 'ended');
create type hq.ailo_status as enum ('not_started', 'set_up', 'live');
create type hq.handover_step as enum (
  'owner_onboarded', 'management_agreement_signed', 'owner_id_verified', 'bank_and_payment_details_in_ailo',
  'property_created_in_ailo', 'owner_invited_to_ailo', 'condition_report_or_inspection_scheduled',
  'keys_and_access_arranged', 'welcome_pack_sent');
create type hq.handover_step_status as enum ('not_started', 'in_progress', 'done', 'not_applicable');

-- ------------------------------------------------------------------ capabilities (an assumption for the owner to confirm)
insert into hq.role_capabilities (role, capability)
select r.role::hq.staff_role, r.capability
from (values
  ('director', 'portfolio.read'), ('director', 'portfolio.write'),
  ('administrator', 'portfolio.read'), ('administrator', 'portfolio.write'),
  ('senior_property_manager', 'portfolio.read'), ('senior_property_manager', 'portfolio.write'),
  ('property_manager', 'portfolio.read'),
  ('business_development_manager', 'portfolio.read'),
  ('read_only', 'portfolio.read')
) as r(role, capability)
on conflict do nothing;

-- ------------------------------------------------------------------ managed_properties
create table hq.managed_properties (
  id uuid primary key default gen_random_uuid(),
  ref_number bigint generated always as identity,
  opportunity_id uuid references hq.opportunities (id),
  manual_origin_note text,
  owner_contact_id uuid references hq.contacts (id),
  owner_name text,
  property_address text not null,
  address_key text generated always as (hq_private.normalise_name(property_address)) stored,
  suburb text,
  service_type hq.service_type not null,
  fee_basis hq.fee_basis,
  fee_percent numeric(5, 2),
  fee_notes text,
  agreement_signed_on date,
  managed_from date,
  status hq.managed_status not null default 'onboarding',
  ended_on date,
  ailo_reference text,
  ailo_status hq.ailo_status not null default 'not_started',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  constraint managed_properties_one_per_opportunity unique (opportunity_id),
  constraint managed_properties_origin check (opportunity_id is not null or (manual_origin_note is not null and char_length(btrim(manual_origin_note)) between 1 and 1000)),
  constraint managed_properties_origin_note_length check (manual_origin_note is null or char_length(manual_origin_note) <= 1000),
  constraint managed_properties_address_length check (char_length(btrim(property_address)) between 1 and 300 and address_key <> ''),
  constraint managed_properties_suburb_length check (suburb is null or char_length(suburb) <= 120),
  constraint managed_properties_owner check (owner_contact_id is not null or (owner_name is not null and btrim(owner_name) <> '')),
  constraint managed_properties_owner_name_length check (owner_name is null or char_length(owner_name) <= 200),
  constraint managed_properties_fee_percent_range check (fee_percent is null or fee_percent between 0 and 100),
  constraint managed_properties_fee_percent_iff_basis check ((fee_basis is not distinct from 'percent_of_rent') = (fee_percent is not null)),
  constraint managed_properties_fee_notes_length check (fee_notes is null or char_length(fee_notes) <= 500),
  constraint managed_properties_active_needs_start check (status <> 'active' or managed_from is not null),
  constraint managed_properties_ended_iff_date check ((status = 'ended') = (ended_on is not null)),
  constraint managed_properties_ended_after_start check (ended_on is null or managed_from is null or ended_on >= managed_from),
  constraint managed_properties_live_needs_reference check (ailo_status <> 'live' or ailo_reference is not null),
  constraint managed_properties_ailo_reference_length check (ailo_reference is null or char_length(btrim(ailo_reference)) between 1 and 100),
  constraint managed_properties_notes_length check (notes is null or char_length(notes) <= 5000),
  constraint managed_properties_dates_sane check ((agreement_signed_on is null or agreement_signed_on >= date '1990-01-01')
                                                  and (managed_from is null or managed_from >= date '1990-01-01')
                                                  and (ended_on is null or ended_on >= date '1990-01-01')),
  constraint managed_properties_deleted_by_needs_deleted_at check (deleted_by is null or deleted_at is not null)
);
comment on table hq.managed_properties is 'A light record of a property Planted manages, shown as MP-0001. Ailo is the system of record for rent, trust, tenancy, maintenance, inspections and owner comms; HQ holds only this record, the handover checklist and the Ailo reference typed by hand. Written only through the 0130 RPCs and archive_record / restore_record (entity managed_property).';
comment on column hq.managed_properties.opportunity_id is 'The signed opportunity it came from (one property per opportunity). Null only for a property signed before HQ, which then needs manual_origin_note.';
comment on column hq.managed_properties.ailo_reference is 'The property''s reference in Ailo, typed by a person. Never synced, never invented.';
comment on column hq.managed_properties.service_type is 'long_term_residential | short_term_accommodation (a separate service, always reported separately).';
create unique index managed_properties_ref_number_uq on hq.managed_properties (ref_number);
create unique index managed_properties_ailo_reference_uq on hq.managed_properties (lower(btrim(ailo_reference))) where ailo_reference is not null and deleted_at is null;
create unique index managed_properties_address_live_uq on hq.managed_properties (address_key) where deleted_at is null and status <> 'ended';
create index managed_properties_owner_contact_id_idx on hq.managed_properties (owner_contact_id);
create index managed_properties_status_idx on hq.managed_properties (status, service_type) where deleted_at is null;
create index managed_properties_address_trgm_idx on hq.managed_properties using gin (property_address extensions.gin_trgm_ops);

-- ------------------------------------------------------------------ property_handover_steps (nine per property, created by trigger)
create table hq.property_handover_steps (
  property_id uuid not null references hq.managed_properties (id),
  step hq.handover_step not null,
  status hq.handover_step_status not null default 'not_started',
  note text,
  completed_by uuid,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (property_id, step),
  constraint property_handover_steps_completed_iff_status check ((status in ('done', 'not_applicable')) = (completed_at is not null)),
  constraint property_handover_steps_not_applicable_needs_note check (status <> 'not_applicable' or (note is not null and btrim(note) <> '')),
  constraint property_handover_steps_note_length check (note is null or char_length(note) <= 1000)
);
comment on table hq.property_handover_steps is 'The nine-step Ailo handover checklist, one row per step, created with the property. Written only through hq.set_handover_step. Completing every step never changes the property''s status.';

-- ------------------------------------------------------------------ guards
create function hq_private.managed_property_guard() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_opp hq.opportunities;
begin
  new.property_address := btrim(new.property_address);
  new.suburb := nullif(btrim(coalesce(new.suburb, '')), '');
  new.owner_name := nullif(btrim(coalesce(new.owner_name, '')), '');
  new.fee_notes := nullif(btrim(coalesce(new.fee_notes, '')), '');
  new.notes := nullif(btrim(coalesce(new.notes, '')), '');
  new.ailo_reference := nullif(btrim(coalesce(new.ailo_reference, '')), '');
  new.manual_origin_note := nullif(btrim(coalesce(new.manual_origin_note, '')), '');

  if tg_op = 'UPDATE' then
    if new.ref_number is distinct from old.ref_number then
      raise exception 'a managed property''s number cannot change' using errcode = 'insufficient_privilege';
    end if;
    if new.opportunity_id is distinct from old.opportunity_id then
      raise exception 'a managed property cannot be moved to another opportunity' using errcode = 'insufficient_privilege';
    end if;
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  else
    new.updated_by := null;
    if new.status not in ('onboarding', 'active') then
      raise exception 'a new managed property starts as onboarding or active (not %)', new.status
        using errcode = 'check_violation', hint = 'managed_property_bad_start';
    end if;
  end if;

  -- the opportunity, checked when the property is created (or restored): live and signed
  if new.opportunity_id is not null and (tg_op = 'INSERT' or (old.deleted_at is not null and new.deleted_at is null)) then
    select o.* into v_opp from hq.opportunities o where o.id = new.opportunity_id;
    if not found or v_opp.deleted_at is not null then
      raise exception 'the opportunity must be a live (not archived) opportunity'
        using errcode = 'check_violation', hint = 'managed_property_opportunity_not_live';
    end if;
    if v_opp.stage <> 'management_signed' then
      raise exception 'only a signed management can become a managed property (this opportunity is at %)', replace(v_opp.stage::text, '_', ' ')
        using errcode = 'check_violation', hint = 'managed_property_not_signed';
    end if;
  end if;

  if new.owner_contact_id is not null and (tg_op = 'INSERT' or new.owner_contact_id is distinct from old.owner_contact_id) then
    if not exists (select 1 from hq.contacts c where c.id = new.owner_contact_id and c.deleted_at is null) then
      raise exception 'the owner must be a live (not archived) contact' using errcode = 'invalid_parameter_value';
    end if;
  end if;

  if (tg_op = 'INSERT' or new.status is distinct from old.status or new.managed_from is distinct from old.managed_from)
     and new.status = 'active' and new.managed_from > hq.today() then
    raise exception 'an active property''s management start date cannot be in the future; keep it onboarding until then'
      using errcode = 'check_violation', hint = 'managed_property_start_in_future';
  end if;
  if (tg_op = 'INSERT' or new.ended_on is distinct from old.ended_on) and new.ended_on > hq.today() then
    raise exception 'the end date cannot be in the future' using errcode = 'invalid_parameter_value';
  end if;
  if (tg_op = 'INSERT' or new.agreement_signed_on is distinct from old.agreement_signed_on) and new.agreement_signed_on > hq.today() then
    raise exception 'the agreement signing date cannot be in the future' using errcode = 'invalid_parameter_value';
  end if;
  return new;
end $$;

-- After insert: the nine checklist rows (not_started).
create function hq_private.managed_property_after_insert() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
begin
  insert into hq.property_handover_steps (property_id, step)
  select new.id, s from unnest(enum_range(null::hq.handover_step)) as s;
  return null;
end $$;

-- Completion stamps follow the status (set when it becomes done / not_applicable, kept while it stays,
-- cleared when it leaves); a step never moves to another property or step. Copied from vetting steps.
create function hq_private.handover_step_guard() returns trigger
language plpgsql set search_path = pg_catalog, public, extensions as $$
begin
  if tg_op = 'UPDATE' and (new.property_id is distinct from old.property_id or new.step is distinct from old.step) then
    raise exception 'a handover step cannot be moved to another property or step' using errcode = 'insufficient_privilege';
  end if;
  new.note := nullif(btrim(coalesce(new.note, '')), '');
  if new.status in ('done', 'not_applicable') then
    if tg_op = 'UPDATE' and old.status = new.status then
      new.completed_at := old.completed_at;
      new.completed_by := old.completed_by;
    else
      new.completed_at := now();
      new.completed_by := auth.uid();
    end if;
  else
    new.completed_at := null;
    new.completed_by := null;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- A live managed property keeps its opportunity signed and live: refuse leaving management_signed or
-- archiving the opportunity while one points at it (archive the managed property first).
create function hq_private.opportunity_portfolio_guard() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
begin
  if ((old.stage = 'management_signed' and new.stage is distinct from old.stage)
      or (old.deleted_at is null and new.deleted_at is not null))
     and exists (select 1 from hq.managed_properties mp where mp.opportunity_id = new.id and mp.deleted_at is null) then
    raise exception 'this opportunity is a managed property; archive the managed property first'
      using errcode = 'check_violation', hint = 'opportunity_is_managed_property';
  end if;
  return new;
end $$;

create trigger row_stamp before insert or update on hq.managed_properties for each row execute function hq_private.row_stamp();
create trigger soft_delete_guard before insert or update on hq.managed_properties for each row execute function hq_private.soft_delete_guard();
create trigger managed_property_guard before insert or update on hq.managed_properties for each row execute function hq_private.managed_property_guard();
create trigger after_insert after insert on hq.managed_properties for each row execute function hq_private.managed_property_after_insert();
create trigger no_delete before delete on hq.managed_properties for each row execute function hq_private.raise_immutable();
create trigger no_truncate before truncate on hq.managed_properties for each statement execute function hq_private.raise_immutable();

create trigger handover_step_guard before insert or update on hq.property_handover_steps for each row execute function hq_private.handover_step_guard();
create trigger no_delete before delete on hq.property_handover_steps for each row execute function hq_private.raise_immutable();
create trigger no_truncate before truncate on hq.property_handover_steps for each statement execute function hq_private.raise_immutable();

create trigger portfolio_guard before update on hq.opportunities for each row execute function hq_private.opportunity_portfolio_guard();

-- ------------------------------------------------------------------ settings: the goal
insert into hq.settings (key, value) values
  ('goal_managed_properties', '20'::jsonb),
  ('goal_date', 'null'::jsonb)
on conflict (key) do nothing;

-- settings_guard (0119) with the two goal keys: goal_managed_properties is a whole number from 1 to
-- 10000 (a sanity bound, not a business figure); goal_date is JSON null or a real calendar date
-- (YYYY-MM-DD) from 2000 to 2100.
create or replace function hq_private.settings_guard() returns trigger
language plpgsql set search_path = pg_catalog, public, extensions as $$
declare
  v_max integer;
  v_date date;
begin
  if tg_op = 'UPDATE' and new.key is distinct from old.key then
    raise exception 'a setting key cannot change' using errcode = 'insufficient_privilege';
  end if;
  if new.key = 'require_mfa' and jsonb_typeof(new.value) is distinct from 'boolean' then
    raise exception 'require_mfa must be true or false' using errcode = 'invalid_parameter_value';
  end if;
  if new.key = 'ai_enabled' and jsonb_typeof(new.value) is distinct from 'boolean' then
    raise exception 'ai_enabled must be true or false' using errcode = 'invalid_parameter_value';
  end if;
  if new.key = 'timezone' and (
       jsonb_typeof(new.value) is distinct from 'string'
       or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = new.value #>> '{}')) then
    raise exception 'timezone must be an IANA timezone name' using errcode = 'invalid_parameter_value';
  end if;
  if new.key in ('contractor_min_reviews_for_rating', 'contractor_expiry_warning_days', 'ai_hourly_limit', 'goal_managed_properties') then
    v_max := case new.key when 'contractor_min_reviews_for_rating' then 100 when 'ai_hourly_limit' then 1000 when 'goal_managed_properties' then 10000 else 365 end;
    if jsonb_typeof(new.value) is distinct from 'number' or (new.value #>> '{}') !~ '^[0-9]{1,5}$' then
      raise exception '% must be a whole number from 1 to %', new.key, v_max using errcode = 'invalid_parameter_value';
    end if;
    if (new.value #>> '{}')::integer not between 1 and v_max then
      raise exception '% must be a whole number from 1 to %', new.key, v_max using errcode = 'invalid_parameter_value';
    end if;
  end if;
  if new.key = 'goal_date' and jsonb_typeof(new.value) is distinct from 'null' then
    if jsonb_typeof(new.value) is distinct from 'string' or (new.value #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'goal_date must be null or a date (YYYY-MM-DD)' using errcode = 'invalid_parameter_value';
    end if;
    begin
      v_date := (new.value #>> '{}')::date;
    exception when others then
      raise exception 'goal_date must be null or a date (YYYY-MM-DD)' using errcode = 'invalid_parameter_value';
    end;
    if to_char(v_date, 'YYYY-MM-DD') <> (new.value #>> '{}') or v_date not between date '2000-01-01' and date '2100-12-31' then
      raise exception 'goal_date must be null or a date (YYYY-MM-DD)' using errcode = 'invalid_parameter_value';
    end if;
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;

-- ------------------------------------------------------------------ audit: MP-0001 address, and the handover steps
-- audit_row (0125) with two additions: a managed property is labelled "MP-0001 <address>" and its status
-- change reads "(onboarding to active)"; a handover step (no id column) is filed under its property with
-- the label "<step> <status>", as a vetting step is filed under its contractor.
create or replace function hq_private.audit_row() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_entity text := tg_argv[0];
  v_new jsonb;
  v_old jsonb;
  v_row jsonb;
  v_changes jsonb := '{}'::jsonb;
  -- bookkeeping and derived columns never appear in a diff
  v_skip constant text[] := array['id', 'created_at', 'created_by', 'updated_at', 'deleted_by', 'updated_by', 'name_key', 'ref_number', 'display_number', 'address_key'];
  v_key text;
  v_val jsonb;
  v_action text;
  v_label text;
  v_summary text;
  v_note text := nullif(current_setting('hq.audit_note', true), '');
  v_override text := nullif(current_setting('hq.audit_action', true), '');
  v_actor uuid := auth.uid();
begin
  if v_override = 'skip' then
    return null; -- an RPC's own bookkeeping update (for example linking a task to its interaction)
  end if;
  if tg_op = 'DELETE' then
    v_old := to_jsonb(old);
    v_row := v_old;
  elsif tg_op = 'INSERT' then
    v_new := to_jsonb(new);
    v_row := v_new;
  else
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    v_row := v_new;
  end if;

  if tg_op = 'UPDATE' then
    for v_key, v_val in select e.key, e.value from jsonb_each(v_new) e loop
      if v_key = any (v_skip) then continue; end if;
      if v_val is distinct from (v_old -> v_key) then
        v_changes := v_changes || jsonb_build_object(v_key,
          jsonb_build_object('from', hq_private.audit_trim(v_old -> v_key), 'to', hq_private.audit_trim(v_val)));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then
      return null; -- nothing but bookkeeping changed
    end if;
  else
    for v_key, v_val in select e.key, e.value from jsonb_each(case when tg_op = 'INSERT' then v_new else v_old end) e loop
      if v_key = any (v_skip) or v_val in ('null'::jsonb, '{}'::jsonb, '[]'::jsonb) then continue; end if;
      v_changes := v_changes || jsonb_build_object(v_key,
        jsonb_build_object(case when tg_op = 'INSERT' then 'to' else 'from' end, hq_private.audit_trim(v_val)));
    end loop;
  end if;

  v_action := case
    when v_override is not null then v_override
    when tg_op = 'INSERT' then 'create'
    when tg_op = 'DELETE' then 'delete'
    when v_old ->> 'deleted_at' is null and v_new ->> 'deleted_at' is not null then 'archive'
    when v_old ->> 'deleted_at' is not null and v_new ->> 'deleted_at' is null then 'restore'
    when tg_table_name = 'trades' and v_old ->> 'archived_at' is null and v_new ->> 'archived_at' is not null then 'archive'
    when tg_table_name = 'trades' and v_old ->> 'archived_at' is not null and v_new ->> 'archived_at' is null then 'restore'
    when tg_table_name = 'opportunities' and v_old ->> 'stage' is distinct from v_new ->> 'stage' then 'stage_change'
    when tg_table_name in ('contractors', 'decisions', 'managed_properties') and v_old ->> 'status' is distinct from v_new ->> 'status' then 'status_change'
    else 'update'
  end;

  v_label := coalesce(
    case when tg_table_name = 'referrals' then 'REF-' || lpad(v_row ->> 'ref_number', 4, '0') end,
    case when tg_table_name = 'decisions' then 'DEC-' || lpad(v_row ->> 'ref_number', greatest(4, length(v_row ->> 'ref_number')), '0') || ' ' || (v_row ->> 'title') end,
    case when tg_table_name = 'managed_properties' then 'MP-' || lpad(v_row ->> 'ref_number', greatest(4, length(v_row ->> 'ref_number')), '0') || ' ' || (v_row ->> 'property_address') end,
    case when tg_table_name = 'role_capabilities' then (v_row ->> 'role') || ' ' || (v_row ->> 'capability') end,
    case when tg_table_name = 'interactions' then v_row ->> 'interaction_type' end,
    case when tg_table_name = 'contractor_vetting_steps' then replace(v_row ->> 'step', '_', ' ') || ' ' || replace(v_row ->> 'status', '_', ' ') end,
    case when tg_table_name = 'property_handover_steps' then replace(v_row ->> 'step', '_', ' ') || ' ' || replace(v_row ->> 'status', '_', ' ') end,
    case when tg_table_name = 'contractor_documents' then replace(v_row ->> 'document_type', '_', ' ') || ' ' || (v_row ->> 'file_name') end,
    case when tg_table_name = 'contractor_reviews' then v_row ->> 'job_reference' end,
    case when tg_table_name = 'trades' then v_row ->> 'label' end,
    v_row ->> 'name', v_row ->> 'full_name', v_row ->> 'business_name', v_row ->> 'prospect_name', v_row ->> 'title', v_row ->> 'key');

  v_summary := initcap(replace(v_action, '_', ' ')) || ' ' || v_entity
    || coalesce(': ' || v_label, '')
    || case when v_action = 'stage_change' then ' (' || (v_old ->> 'stage') || ' to ' || (v_new ->> 'stage') || ')'
            when tg_table_name in ('contractors', 'decisions', 'managed_properties') and tg_op = 'UPDATE' and v_old ->> 'status' is distinct from v_new ->> 'status'
              then ' (' || (v_old ->> 'status') || ' to ' || (v_new ->> 'status') || ')'
            else '' end
    || coalesce(' [' || v_note || ']', '');

  insert into hq.audit_events (actor_id, actor_name, action, entity_type, entity_id, summary, changes)
  values (
    v_actor,
    coalesce((select sp.full_name from hq.staff_profiles sp where sp.id = v_actor), case when v_actor is null then 'System' end),
    v_action, v_entity,
    case when v_row ? 'id' then (v_row ->> 'id')::uuid
         when tg_table_name = 'contractor_vetting_steps' then (v_row ->> 'contractor_id')::uuid
         when tg_table_name = 'property_handover_steps' then (v_row ->> 'property_id')::uuid end,
    left(v_summary, 500), v_changes);
  return null;
end $$;

create trigger audit after insert or update or delete on hq.managed_properties for each row execute function hq_private.audit_row('managed_property');
create trigger audit after update on hq.property_handover_steps for each row execute function hq_private.audit_row('property_handover_step');

-- ------------------------------------------------------------------ access
alter table hq.managed_properties enable row level security;       alter table hq.managed_properties force row level security;
alter table hq.property_handover_steps enable row level security;  alter table hq.property_handover_steps force row level security;

-- Readers see live properties; archived ones only portfolio.write holders (who can restore them).
create policy managed_properties_select on hq.managed_properties for select to authenticated
  using ((select hq_private.has_capability('portfolio.read'))
         and (deleted_at is null or (select hq_private.has_capability('portfolio.write'))));
-- Steps of a property the reader can see (the subquery runs under the reader's RLS).
create policy property_handover_steps_select on hq.property_handover_steps for select to authenticated
  using ((select hq_private.has_capability('portfolio.read'))
         and exists (select 1 from hq.managed_properties mp where mp.id = property_id));

revoke all on hq.managed_properties, hq.property_handover_steps from public, anon, authenticated, service_role;
grant select on hq.managed_properties, hq.property_handover_steps to authenticated, service_role;

-- ------------------------------------------------------------------ the overview (list and detail)
-- security_invoker: the reader's RLS applies to every table it reads, so the owner's contact name and
-- the opportunity need growth.read (every portfolio.read role holds it; without it they come back null
-- and owner_name falls back to the typed name).
create view hq.portfolio_overview with (security_invoker = true) as
select
  mp.id,
  mp.ref_number,
  'MP-' || lpad(mp.ref_number::text, greatest(4, length(mp.ref_number::text)), '0') as ref,
  mp.property_address,
  mp.suburb,
  mp.service_type,
  mp.status,
  mp.fee_basis,
  mp.fee_percent,
  mp.fee_notes,
  mp.agreement_signed_on,
  mp.managed_from,
  mp.ended_on,
  mp.ailo_reference,
  mp.ailo_status,
  mp.notes,
  mp.opportunity_id,
  o.display_number as opportunity_number,
  o.prospect_name as opportunity_prospect_name,
  o.signed_at as opportunity_signed_at,
  mp.manual_origin_note,
  mp.owner_contact_id,
  coalesce(c.full_name, mp.owner_name) as owner_display_name,
  mp.owner_name,
  c.phone as owner_phone,
  c.email::text as owner_email,
  coalesce(hs.done, 0)::integer as handover_done,
  coalesce(hs.total, 0)::integer as handover_total,
  coalesce(hs.open_steps, '{}'::text[]) as handover_open_steps,
  mp.created_by,
  mp.created_at,
  mp.updated_at,
  mp.deleted_at
from hq.managed_properties mp
left join hq.opportunities o on o.id = mp.opportunity_id
left join hq.contacts c on c.id = mp.owner_contact_id
left join lateral (
  select count(*) filter (where s.status in ('done', 'not_applicable')) as done,
         count(*) as total,
         array_agg(s.step::text order by s.step) filter (where s.status not in ('done', 'not_applicable')) as open_steps
  from hq.property_handover_steps s
  where s.property_id = mp.id
) hs on true;
comment on view hq.portfolio_overview is 'One row per managed property the reader can see: MP-0001 ref, address, owner (contact name, else the typed name), service, status, fee, dates, Ailo reference and status, handover progress (done or not applicable, of 9) and the open steps in checklist order. Filter deleted_at is null for the live portfolio.';
revoke all on hq.portfolio_overview from public, anon, authenticated, service_role;
grant select on hq.portfolio_overview to authenticated;

revoke execute on all functions in schema hq_private from public, anon;
revoke execute on all functions in schema hq from public, anon;
