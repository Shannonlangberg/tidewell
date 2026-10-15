-- 0109_hq_rpc_growth.sql
-- Growth RPCs (design section 5): record_interaction, record_referral, move_opportunity,
-- set_attributed_referral, archive_record, restore_record.
--
-- Each is `security definer` with a pinned search_path, checks its capability inside, and is one
-- transaction: if any step fails, nothing is kept. Audit rows come from the 0105 triggers (an RPC
-- sets hq_private.audit_context() only to give the row a semantic action or a reason).
-- Execute: authenticated only (0111_hq_function_acl.sql).

-- ------------------------------------------------------------------ record_interaction
-- One transaction: log the interaction; set contacts.last_contact_at = greatest(existing,
-- occurred_at); set contacts.next_follow_up_date when a follow-up date is given; optionally create
-- the follow-up task (and link it); optionally move the relationship status.
-- The interaction is inserted BEFORE the task, so a task that cannot be created rolls the logged
-- interaction back with it.
create function hq.record_interaction(
  p_contact uuid default null,
  p_organisation uuid default null,
  p_type hq.interaction_type default null,
  p_occurred_at timestamptz default null,
  p_summary text default null,
  p_next_action text default null,
  p_follow_up_date date default null,
  p_create_task boolean default false,
  p_task_assignee uuid default null,
  p_new_status hq.relationship_status default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_caller uuid := hq_private.require_staff();
  v_contact hq.contacts;
  v_org uuid := p_organisation;
  v_org_name text;
  v_when timestamptz := coalesce(p_occurred_at, now());
  v_summary text := btrim(coalesce(p_summary, ''));
  v_interaction uuid;
  v_task uuid;
  v_assignee uuid := coalesce(p_task_assignee, v_caller);
  v_title text;
begin
  perform hq_private.require_capability('growth.write');
  if coalesce(p_create_task, false) then
    perform hq_private.require_capability('tasks.write');
    perform hq_private.require_active_staff(v_assignee, 'the task assignee');
  end if;
  if p_type is null then
    raise exception 'an interaction type is required' using errcode = 'invalid_parameter_value';
  end if;
  if v_summary = '' then
    raise exception 'a summary is required' using errcode = 'invalid_parameter_value';
  end if;
  if p_contact is null and p_organisation is null then
    raise exception 'a contact or an organisation is required' using errcode = 'invalid_parameter_value';
  end if;
  if p_new_status is not null and p_contact is null then
    raise exception 'a relationship status change needs a contact' using errcode = 'invalid_parameter_value';
  end if;
  if v_when > now() + interval '1 hour' then
    raise exception 'an interaction cannot have occurred in the future' using errcode = 'invalid_parameter_value';
  end if;

  if p_contact is not null then
    select c.* into v_contact from hq.contacts c where c.id = p_contact and c.deleted_at is null for update;
    if not found then
      raise exception 'contact not found' using errcode = 'no_data_found';
    end if;
    if v_org is null then
      v_org := v_contact.organisation_id;
    elsif v_contact.organisation_id is not null and v_contact.organisation_id <> v_org then
      raise exception 'the contact does not belong to that organisation' using errcode = 'invalid_parameter_value';
    end if;
  end if;
  if v_org is not null then
    select o.name into v_org_name from hq.organisations o where o.id = v_org and o.deleted_at is null;
    if not found then
      raise exception 'organisation not found' using errcode = 'no_data_found';
    end if;
  end if;

  insert into hq.interactions (contact_id, organisation_id, interaction_type, occurred_at, summary, staff_id, next_action, follow_up_date)
  values (p_contact, v_org, p_type, v_when, v_summary, v_caller, nullif(btrim(coalesce(p_next_action, '')), ''), p_follow_up_date)
  returning id into v_interaction;

  if coalesce(p_create_task, false) then
    v_title := left(coalesce(nullif(btrim(coalesce(p_next_action, '')), ''), 'Follow up with ' || coalesce(v_contact.full_name, v_org_name)), 200);
    insert into hq.tasks (title, assigned_to, due_date, related_contact_id, related_organisation_id, source)
    values (v_title, v_assignee, p_follow_up_date, p_contact, v_org, 'interaction')
    returning id into v_task;
    perform hq_private.audit_context('skip');
    update hq.interactions set task_id = v_task where id = v_interaction;
    perform hq_private.audit_context();
  end if;

  if p_contact is not null then
    update hq.contacts set
      last_contact_at = greatest(coalesce(last_contact_at, v_when), v_when),
      next_follow_up_date = coalesce(p_follow_up_date, next_follow_up_date),
      relationship_status = coalesce(p_new_status, relationship_status)
    where id = p_contact;
  end if;

  return jsonb_build_object('interaction_id', v_interaction, 'task_id', v_task);
end $$;
comment on function hq.record_interaction(uuid, uuid, hq.interaction_type, timestamptz, text, text, date, boolean, uuid, hq.relationship_status) is 'growth.write (+ tasks.write when creating a task). One transaction: interaction, contact last_contact_at / next_follow_up_date, optional task, optional status change. Returns {interaction_id, task_id}.';

-- ------------------------------------------------------------------ record_referral
-- received: creates an opportunity at introduction_received and attributes it to this referral, or
--   (p_existing_opportunity) attaches to an existing opportunity as a NON-attributed claim.
-- sent: records the outbound referral to a receiving partner; creates no opportunity.
create function hq.record_referral(
  p_direction hq.referral_direction,
  p_referring_contact uuid default null,
  p_referring_organisation uuid default null,
  p_receiving_contact uuid default null,
  p_receiving_organisation uuid default null,
  p_referral_date date default null,
  p_prospect_name text default null,
  p_prospect_phone text default null,
  p_prospect_email text default null,
  p_property_suburb text default null,
  p_property_address text default null,
  p_assigned_to uuid default null,
  p_estimated_value_cents bigint default null,
  p_notes text default null,
  p_existing_opportunity uuid default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_date date := coalesce(p_referral_date, hq.today());
  v_prospect text := nullif(btrim(coalesce(p_prospect_name, '')), '');
  v_ref_org uuid;
  v_opp hq.opportunities;
  v_opp_id uuid;
  v_attributed boolean;
  v_referral uuid;
  v_number bigint;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('growth.write');
  if p_direction is null then
    raise exception 'a direction is required' using errcode = 'invalid_parameter_value';
  end if;
  perform hq_private.require_active_staff(p_assigned_to, 'the assignee');

  -- every named partner must exist and be live
  if p_referring_contact is not null and not exists (select 1 from hq.contacts c where c.id = p_referring_contact and c.deleted_at is null) then
    raise exception 'referring contact not found' using errcode = 'no_data_found';
  end if;
  if p_receiving_contact is not null and not exists (select 1 from hq.contacts c where c.id = p_receiving_contact and c.deleted_at is null) then
    raise exception 'receiving contact not found' using errcode = 'no_data_found';
  end if;
  if p_referring_organisation is not null and not exists (select 1 from hq.organisations o where o.id = p_referring_organisation and o.deleted_at is null) then
    raise exception 'referring organisation not found' using errcode = 'no_data_found';
  end if;
  if p_receiving_organisation is not null and not exists (select 1 from hq.organisations o where o.id = p_receiving_organisation and o.deleted_at is null) then
    raise exception 'receiving organisation not found' using errcode = 'no_data_found';
  end if;

  if p_direction = 'sent' then
    if p_referring_contact is not null or p_referring_organisation is not null then
      raise exception 'a sent referral has a receiving partner, not a referring one' using errcode = 'invalid_parameter_value';
    end if;
    if p_receiving_contact is null and p_receiving_organisation is null then
      raise exception 'a sent referral needs a receiving contact or organisation' using errcode = 'invalid_parameter_value';
    end if;
    if p_existing_opportunity is not null or p_estimated_value_cents is not null then
      raise exception 'a sent referral creates no opportunity' using errcode = 'invalid_parameter_value';
    end if;
    insert into hq.referrals (
      direction, receiving_contact_id, receiving_organisation_id, referral_date, assigned_to, is_attributed, sent_outcome,
      prospect_name, prospect_phone, prospect_email, property_suburb, property_address, notes)
    values (
      'sent', p_receiving_contact, p_receiving_organisation, v_date, p_assigned_to, false, 'sent',
      v_prospect, nullif(btrim(coalesce(p_prospect_phone, '')), ''), nullif(btrim(coalesce(p_prospect_email, '')), ''),
      nullif(btrim(coalesce(p_property_suburb, '')), ''), nullif(btrim(coalesce(p_property_address, '')), ''),
      nullif(btrim(coalesce(p_notes, '')), ''))
    returning id, ref_number into v_referral, v_number;
    return jsonb_build_object('referral_id', v_referral, 'opportunity_id', null, 'ref_number', v_number, 'is_attributed', false);
  end if;

  -- received
  if p_receiving_contact is not null or p_receiving_organisation is not null then
    raise exception 'a received referral has a referring partner, not a receiving one' using errcode = 'invalid_parameter_value';
  end if;
  if p_referring_contact is null and p_referring_organisation is null then
    raise exception 'a received referral needs a referring contact or organisation' using errcode = 'invalid_parameter_value';
  end if;
  v_ref_org := coalesce(p_referring_organisation, (select c.organisation_id from hq.contacts c where c.id = p_referring_contact));

  if p_existing_opportunity is null then
    if v_prospect is null then
      raise exception 'a prospect name is required for a new opportunity' using errcode = 'invalid_parameter_value';
    end if;
    insert into hq.opportunities (
      prospect_name, prospect_phone, prospect_email, property_suburb, property_address,
      estimated_annual_value_cents, assigned_to, notes)
    values (
      v_prospect, nullif(btrim(coalesce(p_prospect_phone, '')), ''), nullif(btrim(coalesce(p_prospect_email, '')), ''),
      nullif(btrim(coalesce(p_property_suburb, '')), ''), nullif(btrim(coalesce(p_property_address, '')), ''),
      p_estimated_value_cents, p_assigned_to, nullif(btrim(coalesce(p_notes, '')), ''))
    returning id into v_opp_id;
    v_attributed := true;
    insert into hq.referrals (
      direction, referring_contact_id, referring_organisation_id, opportunity_id, referral_date, assigned_to, is_attributed, notes)
    values ('received', p_referring_contact, p_referring_organisation, v_opp_id, v_date, p_assigned_to, true, nullif(btrim(coalesce(p_notes, '')), ''))
    returning id, ref_number into v_referral, v_number;
  else
    if p_estimated_value_cents is not null then
      raise exception 'the estimated value belongs to the opportunity; it cannot be set by an additional referral' using errcode = 'invalid_parameter_value';
    end if;
    select o.* into v_opp from hq.opportunities o where o.id = p_existing_opportunity and o.deleted_at is null for update;
    if not found then
      raise exception 'opportunity not found' using errcode = 'no_data_found';
    end if;
    v_opp_id := v_opp.id;
    if exists (
      select 1 from hq.referrals r
      where r.opportunity_id = v_opp_id and r.direction = 'received' and r.deleted_at is null
        and ((v_ref_org is not null and r.referring_organisation_id = v_ref_org)
             or (p_referring_contact is not null and r.referring_contact_id = p_referring_contact))
    ) then
      raise exception 'that partner already has a referral on this opportunity' using errcode = 'unique_violation';
    end if;
    -- a non-attributed claim, unless the opportunity somehow has no attributed referral left
    v_attributed := not exists (
      select 1 from hq.referrals r where r.opportunity_id = v_opp_id and r.is_attributed and r.deleted_at is null);
    insert into hq.referrals (
      direction, referring_contact_id, referring_organisation_id, opportunity_id, referral_date, assigned_to, is_attributed,
      prospect_name, prospect_phone, prospect_email, property_suburb, property_address, notes)
    values (
      'received', p_referring_contact, p_referring_organisation, v_opp_id, v_date, p_assigned_to, v_attributed,
      v_prospect, nullif(btrim(coalesce(p_prospect_phone, '')), ''), nullif(btrim(coalesce(p_prospect_email, '')), ''),
      nullif(btrim(coalesce(p_property_suburb, '')), ''), nullif(btrim(coalesce(p_property_address, '')), ''),
      nullif(btrim(coalesce(p_notes, '')), ''))
    returning id, ref_number into v_referral, v_number;
  end if;

  return jsonb_build_object('referral_id', v_referral, 'opportunity_id', v_opp_id, 'ref_number', v_number, 'is_attributed', v_attributed);
end $$;
comment on function hq.record_referral(hq.referral_direction, uuid, uuid, uuid, uuid, date, text, text, text, text, text, uuid, bigint, text, uuid) is 'growth.write. received: new opportunity at introduction_received, attributed to this referral, or an additional non-attributed claim on p_existing_opportunity. sent: outbound referral, no opportunity. Returns {referral_id, opportunity_id, ref_number, is_attributed}.';

-- ------------------------------------------------------------------ move_opportunity
-- Stage change with history (the trigger writes the history row and stage_changed_at). Signing sets
-- signed_at once and is idempotent: moving an opportunity to the stage it is already in changes
-- nothing and writes no second history row, so re-signing counts nothing. Leaving management_signed
-- needs a director or administrator and clears signed_at and management_reference. `lost` needs a
-- reason. Returns {opportunity_id, stage, previous_stage, changed, signed_at}.
create function hq.move_opportunity(
  p_opportunity uuid,
  p_stage hq.opportunity_stage,
  p_note text default null,
  p_signed_at timestamptz default null,
  p_management_reference text default null,
  p_lost_reason text default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_opp hq.opportunities;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_reason text := nullif(btrim(coalesce(p_lost_reason, '')), '');
  v_ref text := nullif(btrim(coalesce(p_management_reference, '')), '');
  v_prev hq.opportunity_stage;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('growth.write');
  if p_stage is null then
    raise exception 'a stage is required' using errcode = 'invalid_parameter_value';
  end if;
  select o.* into v_opp from hq.opportunities o where o.id = p_opportunity and o.deleted_at is null for update;
  if not found then
    raise exception 'opportunity not found' using errcode = 'no_data_found';
  end if;

  v_prev := v_opp.stage;
  if v_opp.stage = p_stage then
    return jsonb_build_object('opportunity_id', v_opp.id, 'stage', v_opp.stage, 'previous_stage', v_opp.stage,
                              'changed', false, 'signed_at', v_opp.signed_at);
  end if;
  if v_opp.stage = 'management_signed'
     and hq_private.staff_role() not in ('director'::hq.staff_role, 'administrator'::hq.staff_role) then
    raise exception 'only a director or administrator can move an opportunity out of management_signed' using errcode = 'insufficient_privilege';
  end if;
  if p_stage = 'lost' and v_reason is null then
    raise exception 'a lost opportunity needs a reason' using errcode = 'invalid_parameter_value';
  end if;

  perform set_config('hq.stage_note', coalesce(left(v_note, 500), ''), true);
  perform hq_private.audit_context(null, left(v_note, 200));
  update hq.opportunities set
    stage = p_stage,
    signed_at = case when p_stage = 'management_signed' then coalesce(p_signed_at, now()) else null end,
    management_reference = case when p_stage = 'management_signed' then coalesce(v_ref, management_reference) else null end,
    lost_reason = case when p_stage = 'lost' then v_reason else null end
  where id = v_opp.id
  returning * into v_opp;
  perform set_config('hq.stage_note', '', true);
  perform hq_private.audit_context();

  return jsonb_build_object('opportunity_id', v_opp.id, 'stage', v_opp.stage, 'previous_stage', v_prev,
                            'changed', true, 'signed_at', v_opp.signed_at);
end $$;
comment on function hq.move_opportunity(uuid, hq.opportunity_stage, text, timestamptz, text, text) is 'growth.write. Stage change with history. Signing is idempotent (no second history row, signed_at set once). Leaving management_signed needs director or administrator. lost needs p_lost_reason.';

-- ------------------------------------------------------------------ set_attributed_referral
-- Moves credit for an opportunity to a different received referral, atomically: exactly one
-- referral is attributed at every moment a transaction can observe.
create function hq.set_attributed_referral(p_opportunity uuid, p_referral uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_ref hq.referrals;
  v_previous uuid;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('growth.write');
  perform 1 from hq.opportunities o where o.id = p_opportunity and o.deleted_at is null for update;
  if not found then
    raise exception 'opportunity not found' using errcode = 'no_data_found';
  end if;
  select r.* into v_ref from hq.referrals r where r.id = p_referral and r.deleted_at is null for update;
  if not found or v_ref.opportunity_id is distinct from p_opportunity or v_ref.direction <> 'received' then
    raise exception 'that is not a received referral for this opportunity' using errcode = 'invalid_parameter_value';
  end if;
  select r.id into v_previous from hq.referrals r
  where r.opportunity_id = p_opportunity and r.is_attributed and r.deleted_at is null;
  if v_previous = p_referral then
    return jsonb_build_object('opportunity_id', p_opportunity, 'referral_id', p_referral, 'previous_referral_id', v_previous, 'changed', false);
  end if;

  -- between the two statements no referral is attributed: the check must wait for the end of the transaction
  set constraints hq.referrals_attribution deferred;
  perform hq_private.audit_context('attribution', 'credit moved to REF-' || lpad(v_ref.ref_number::text, 4, '0'));
  update hq.referrals set is_attributed = false
  where opportunity_id = p_opportunity and is_attributed and deleted_at is null and id <> p_referral;
  update hq.referrals set is_attributed = true where id = p_referral;
  perform hq_private.audit_context();

  return jsonb_build_object('opportunity_id', p_opportunity, 'referral_id', p_referral, 'previous_referral_id', v_previous, 'changed', true);
end $$;
comment on function hq.set_attributed_referral(uuid, uuid) is 'growth.write. Moves attribution to another received referral for the same opportunity, atomically.';

-- ------------------------------------------------------------------ archive_record / restore_record
-- Soft deletion for organisation, contact, referral, task (design) and, as extensions, opportunity
-- and interaction. growth.delete for all of them; a task may also be archived by someone with
-- tasks.write who can see it. Archiving does not cascade: an archived organisation's contacts stay.
-- An attributed referral cannot be archived while the opportunity has other live received
-- referrals: move attribution first.
create function hq.archive_record(p_entity text, p_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_table text;
  v_caller uuid := hq_private.require_staff();
  v_deleted timestamptz;
  v_allowed boolean := hq_private.has_capability('growth.delete');
  v_ref hq.referrals;
  v_n integer;
begin
  v_table := case p_entity
    when 'organisation' then 'organisations' when 'contact' then 'contacts' when 'referral' then 'referrals'
    when 'task' then 'tasks' when 'opportunity' then 'opportunities' when 'interaction' then 'interactions' end;
  if v_table is null then
    raise exception 'unknown entity %; expected organisation, contact, referral, task, opportunity or interaction', p_entity
      using errcode = 'invalid_parameter_value';
  end if;
  if not v_allowed and p_entity = 'task' and hq_private.has_capability('tasks.write') then
    v_allowed := exists (
      select 1 from hq.tasks t
      where t.id = p_id and (t.assigned_to = v_caller or t.created_by = v_caller or hq_private.has_capability('tasks.read_all')));
  end if;
  if not v_allowed then
    raise exception 'permission denied' using errcode = 'insufficient_privilege', detail = 'requires growth.delete';
  end if;

  execute format('select deleted_at from hq.%I where id = $1 for update', v_table) into v_deleted using p_id;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception '% not found', p_entity using errcode = 'no_data_found';
  end if;
  if v_deleted is not null then
    return jsonb_build_object('entity', p_entity, 'id', p_id, 'archived', true, 'changed', false);
  end if;

  if p_entity = 'referral' then
    select r.* into v_ref from hq.referrals r where r.id = p_id;
    if v_ref.is_attributed and exists (
      select 1 from hq.referrals r
      where r.opportunity_id = v_ref.opportunity_id and r.id <> v_ref.id and r.direction = 'received' and r.deleted_at is null
    ) then
      raise exception 'this referral is the attributed source; move attribution to another referral first' using errcode = 'check_violation';
    end if;
  end if;

  perform hq_private.audit_context(null, left(nullif(btrim(coalesce(p_reason, '')), ''), 200));
  execute format('update hq.%I set deleted_at = now() where id = $1', v_table) using p_id;
  perform hq_private.audit_context();
  return jsonb_build_object('entity', p_entity, 'id', p_id, 'archived', true, 'changed', true);
end $$;
comment on function hq.archive_record(text, uuid, text) is 'growth.delete (a task also by its assignee or creator holding tasks.write). Soft-deletes organisation, contact, referral, task, opportunity or interaction.';

create function hq.restore_record(p_entity text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_table text;
  v_deleted timestamptz;
  v_n integer;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('growth.delete');
  v_table := case p_entity
    when 'organisation' then 'organisations' when 'contact' then 'contacts' when 'referral' then 'referrals'
    when 'task' then 'tasks' when 'opportunity' then 'opportunities' when 'interaction' then 'interactions' end;
  if v_table is null then
    raise exception 'unknown entity %; expected organisation, contact, referral, task, opportunity or interaction', p_entity
      using errcode = 'invalid_parameter_value';
  end if;
  execute format('select deleted_at from hq.%I where id = $1 for update', v_table) into v_deleted using p_id;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception '% not found', p_entity using errcode = 'no_data_found';
  end if;
  if v_deleted is null then
    return jsonb_build_object('entity', p_entity, 'id', p_id, 'archived', false, 'changed', false);
  end if;

  perform hq_private.audit_context();
  if p_entity = 'referral' then
    -- take credit back only if the opportunity has no attributed referral now
    update hq.referrals r set
      deleted_at = null,
      is_attributed = (r.direction = 'received' and not exists (
        select 1 from hq.referrals o where o.opportunity_id = r.opportunity_id and o.id <> r.id and o.is_attributed and o.deleted_at is null))
    where r.id = p_id;
  else
    -- a unique name, email or primary contact that was taken meanwhile fails the restore (23505)
    execute format('update hq.%I set deleted_at = null where id = $1', v_table) using p_id;
  end if;
  return jsonb_build_object('entity', p_entity, 'id', p_id, 'archived', false, 'changed', true);
end $$;
comment on function hq.restore_record(text, uuid) is 'growth.delete. Restores a soft-deleted record. A restored referral takes attribution back only when the opportunity has none.';
