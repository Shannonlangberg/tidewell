-- 0130_hq_portfolio_rpc.sql
-- The portfolio RPCs (tables and rules in 0129). Each is security definer, pins its search_path, checks
-- the caller INSIDE (active staff in an MFA-satisfying session, then the capability), is one transaction
-- and is audited (the 0129 row triggers, with a note set through hq_private.audit_context where it
-- helps). Execute: authenticated only (0131).
-- Errors: 42501 permission denied, 22023 invalid argument (plain message), P0002 not found,
-- 23505 already exists, 23514 a rule refuses the change (plain message and a hint).
--
--   convert_to_managed_property    portfolio.write  a SIGNED opportunity becomes a managed property;
--                                                   address, suburb, owner and the agreement date
--                                                   default from the opportunity (typed once)
--   add_existing_managed_property  portfolio.write  a property signed before HQ, with a note saying so
--   update_managed_property        portfolio.write  patch, status moves with rules, optimistic concurrency
--   set_handover_step              portfolio.write  one checklist step (the vetting-step pattern)
--   set_business_goal              settings.admin   the managed-property target and the goal date
--   business_summary               growth.read or portfolio.read: the CEO's "business at a glance",
--                                                   every figure labelled actual / signed / estimate
--   archive_record / restore_record gain entity 'managed_property' (portfolio.write).

-- ------------------------------------------------------------------ helpers (not granted to any API role)
create function hq_private.mp_ref(p_n bigint) returns text
language sql immutable parallel safe set search_path = pg_catalog as $$
  select 'MP-' || lpad(p_n::text, greatest(4, length(p_n::text)), '0')
$$;

create function hq_private.mp_json(p_m hq.managed_properties) returns jsonb
language sql stable set search_path = pg_catalog, public, extensions as $$
  select jsonb_build_object(
    'managed_property_id', p_m.id, 'ref', hq_private.mp_ref(p_m.ref_number), 'ref_number', p_m.ref_number,
    'opportunity_id', p_m.opportunity_id, 'property_address', p_m.property_address, 'suburb', p_m.suburb,
    'owner_contact_id', p_m.owner_contact_id, 'owner_name', p_m.owner_name, 'service_type', p_m.service_type,
    'fee_basis', p_m.fee_basis, 'fee_percent', p_m.fee_percent, 'agreement_signed_on', p_m.agreement_signed_on,
    'managed_from', p_m.managed_from, 'status', p_m.status, 'ended_on', p_m.ended_on,
    'ailo_reference', p_m.ailo_reference, 'ailo_status', p_m.ailo_status, 'updated_at', p_m.updated_at)
$$;

create function hq_private.mp_status_label(p_status hq.managed_status) returns text
language sql immutable parallel safe set search_path = pg_catalog, public, extensions as $$
  select case p_status when 'onboarding' then 'Onboarding' when 'active' then 'Active' when 'offboarding' then 'Offboarding' when 'ended' then 'Ended' end
$$;

-- The checks every create and update shares, on the record as it would be after the change. Each
-- raises with a plain message; the table constraints stay the final word.
create function hq_private.mp_check(p_m hq.managed_properties, p_self uuid) returns void
language plpgsql stable security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_today date := hq.today();
  v_other text;
begin
  if p_m.property_address is null or btrim(p_m.property_address) = '' then
    raise exception 'a property address is required' using errcode = 'invalid_parameter_value';
  end if;
  if char_length(btrim(p_m.property_address)) > 300 then
    raise exception 'a property address is at most 300 characters' using errcode = 'invalid_parameter_value';
  end if;
  if p_m.suburb is not null and char_length(p_m.suburb) > 120 then
    raise exception 'a suburb is at most 120 characters' using errcode = 'invalid_parameter_value';
  end if;
  if p_m.owner_contact_id is null and p_m.owner_name is null then
    raise exception 'say who the owner is: choose a contact or type their name' using errcode = 'invalid_parameter_value';
  end if;
  if p_m.owner_name is not null and char_length(p_m.owner_name) > 200 then
    raise exception 'an owner name is at most 200 characters' using errcode = 'invalid_parameter_value';
  end if;
  if p_m.owner_contact_id is not null and not exists (select 1 from hq.contacts c where c.id = p_m.owner_contact_id and c.deleted_at is null) then
    raise exception 'the owner contact was not found' using errcode = 'invalid_parameter_value';
  end if;
  if p_m.fee_percent is not null and (p_m.fee_percent < 0 or p_m.fee_percent > 100) then
    raise exception 'a fee percentage is from 0 to 100' using errcode = 'invalid_parameter_value';
  end if;
  if p_m.fee_basis = 'percent_of_rent' and p_m.fee_percent is null then
    raise exception 'a fee charged as a percentage of rent needs the percentage' using errcode = 'invalid_parameter_value';
  end if;
  if p_m.fee_notes is not null and char_length(p_m.fee_notes) > 500 then
    raise exception 'fee notes are at most 500 characters' using errcode = 'invalid_parameter_value';
  end if;
  if p_m.notes is not null and char_length(p_m.notes) > 5000 then
    raise exception 'notes are at most 5000 characters' using errcode = 'invalid_parameter_value';
  end if;
  if p_m.agreement_signed_on is not null and (p_m.agreement_signed_on > v_today or p_m.agreement_signed_on < date '1990-01-01') then
    raise exception 'the agreement date must be a real date, today or earlier' using errcode = 'invalid_parameter_value';
  end if;
  if p_m.managed_from is not null and p_m.managed_from < date '1990-01-01' then
    raise exception 'that management start date is too far in the past' using errcode = 'invalid_parameter_value';
  end if;
  if p_m.status = 'active' and p_m.managed_from is null then
    raise exception 'an active property needs the date management started' using errcode = 'invalid_parameter_value';
  end if;
  if p_m.status = 'active' and p_m.managed_from > v_today then
    raise exception 'an active property''s management start date cannot be in the future; keep it onboarding until then' using errcode = 'invalid_parameter_value';
  end if;
  if p_m.status = 'ended' and p_m.ended_on is null then
    raise exception 'an ended property needs the date management ended' using errcode = 'invalid_parameter_value';
  end if;
  if p_m.status <> 'ended' and p_m.ended_on is not null then
    raise exception 'an end date is only recorded when the property has ended' using errcode = 'invalid_parameter_value';
  end if;
  if p_m.ended_on is not null and (p_m.ended_on > v_today or (p_m.managed_from is not null and p_m.ended_on < p_m.managed_from)) then
    raise exception 'the end date must be today or earlier, and not before management started' using errcode = 'invalid_parameter_value';
  end if;
  if p_m.ailo_reference is not null and char_length(p_m.ailo_reference) > 100 then
    raise exception 'an Ailo reference is at most 100 characters' using errcode = 'invalid_parameter_value';
  end if;
  if p_m.ailo_status = 'live' and p_m.ailo_reference is null then
    raise exception 'record the Ailo reference before marking the property live in Ailo' using errcode = 'invalid_parameter_value';
  end if;
  if p_m.ailo_reference is not null then
    select hq_private.mp_ref(x.ref_number) into v_other from hq.managed_properties x
    where lower(btrim(x.ailo_reference)) = lower(btrim(p_m.ailo_reference)) and x.deleted_at is null and x.id is distinct from p_self;
    if found then
      raise exception 'that Ailo reference is already recorded on %', v_other using errcode = 'unique_violation', hint = 'managed_property_ailo_reference_taken';
    end if;
  end if;
  if p_m.status <> 'ended' then
    select hq_private.mp_ref(x.ref_number) into v_other from hq.managed_properties x
    where x.address_key = hq_private.normalise_name(p_m.property_address) and x.deleted_at is null and x.status <> 'ended' and x.id is distinct from p_self;
    if found then
      raise exception 'that address is already a managed property (%)', v_other using errcode = 'unique_violation', hint = 'managed_property_address_taken';
    end if;
  end if;
end $$;

-- The trimmed text a person typed (blank = null) for every text field of a new record.
create function hq_private.mp_new(
  p_opportunity uuid, p_origin text, p_address text, p_suburb text, p_owner_contact uuid, p_owner_name text,
  p_service hq.service_type, p_fee_basis hq.fee_basis, p_fee_percent numeric, p_fee_notes text, p_agreement date,
  p_from date, p_status hq.managed_status, p_ailo_reference text, p_ailo_status hq.ailo_status, p_notes text
) returns hq.managed_properties
language plpgsql stable set search_path = pg_catalog, public, extensions as $$
declare
  v hq.managed_properties;
begin
  v.opportunity_id := p_opportunity;
  v.manual_origin_note := nullif(btrim(coalesce(p_origin, '')), '');
  v.property_address := nullif(btrim(coalesce(p_address, '')), '');
  v.suburb := nullif(btrim(coalesce(p_suburb, '')), '');
  v.owner_contact_id := p_owner_contact;
  v.owner_name := nullif(btrim(coalesce(p_owner_name, '')), '');
  v.service_type := p_service;
  v.fee_percent := p_fee_percent;
  v.fee_basis := coalesce(p_fee_basis, case when p_fee_percent is not null then 'percent_of_rent'::hq.fee_basis end);
  v.fee_notes := nullif(btrim(coalesce(p_fee_notes, '')), '');
  v.agreement_signed_on := p_agreement;
  v.managed_from := p_from;
  v.status := coalesce(p_status, 'onboarding');
  v.ailo_reference := nullif(btrim(coalesce(p_ailo_reference, '')), '');
  v.ailo_status := coalesce(p_ailo_status, 'not_started');
  v.notes := nullif(btrim(coalesce(p_notes, '')), '');
  return v;
end $$;

create function hq_private.mp_insert(p_m hq.managed_properties, p_audit_note text) returns hq.managed_properties
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v hq.managed_properties;
begin
  if p_m.service_type is null then
    raise exception 'choose the service: long-term residential or short-term accommodation' using errcode = 'invalid_parameter_value';
  end if;
  if p_m.status not in ('onboarding', 'active') then
    raise exception 'a new managed property starts as onboarding or active' using errcode = 'invalid_parameter_value';
  end if;
  if p_m.fee_basis is distinct from 'percent_of_rent' and p_m.fee_percent is not null then
    raise exception 'a percentage is recorded only for a fee charged as a percentage of rent' using errcode = 'invalid_parameter_value';
  end if;
  perform hq_private.mp_check(p_m, null);
  perform hq_private.audit_context(null, left(p_audit_note, 200));
  insert into hq.managed_properties (
    opportunity_id, manual_origin_note, owner_contact_id, owner_name, property_address, suburb, service_type,
    fee_basis, fee_percent, fee_notes, agreement_signed_on, managed_from, status, ailo_reference, ailo_status, notes)
  values (
    p_m.opportunity_id, p_m.manual_origin_note, p_m.owner_contact_id, p_m.owner_name, p_m.property_address, p_m.suburb, p_m.service_type,
    p_m.fee_basis, p_m.fee_percent, p_m.fee_notes, p_m.agreement_signed_on, p_m.managed_from, p_m.status, p_m.ailo_reference, p_m.ailo_status, p_m.notes)
  returning * into v;
  perform hq_private.audit_context();
  return v;
end $$;

-- ------------------------------------------------------------------ convert_to_managed_property
create function hq.convert_to_managed_property(
  p_opportunity_id uuid,
  p_service_type hq.service_type,
  p_property_address text default null,
  p_suburb text default null,
  p_owner_contact_id uuid default null,
  p_owner_name text default null,
  p_fee_basis hq.fee_basis default null,
  p_fee_percent numeric default null,
  p_fee_notes text default null,
  p_agreement_signed_on date default null,
  p_managed_from date default null,
  p_status hq.managed_status default 'onboarding',
  p_ailo_reference text default null,
  p_notes text default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_opp hq.opportunities;
  v_tz text := coalesce((select s.value #>> '{}' from hq.settings s where s.key = 'timezone'), 'Australia/Adelaide');
  v_existing hq.managed_properties;
  v_m hq.managed_properties;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('portfolio.write');
  if p_opportunity_id is null then
    raise exception 'choose the signed opportunity this property comes from' using errcode = 'invalid_parameter_value';
  end if;
  select o.* into v_opp from hq.opportunities o where o.id = p_opportunity_id and o.deleted_at is null for update;
  if not found then
    raise exception 'opportunity not found' using errcode = 'no_data_found';
  end if;
  if v_opp.stage <> 'management_signed' then
    raise exception 'only a signed management can become a managed property; this opportunity is at %', replace(v_opp.stage::text, '_', ' ')
      using errcode = 'check_violation', hint = 'managed_property_not_signed';
  end if;
  select mp.* into v_existing from hq.managed_properties mp where mp.opportunity_id = v_opp.id;
  if found then
    raise exception 'this opportunity is already a managed property (%)%', hq_private.mp_ref(v_existing.ref_number),
      case when v_existing.deleted_at is not null then '; it is archived, restore it instead' else '' end
      using errcode = 'unique_violation', hint = 'managed_property_exists';
  end if;

  -- typed once: the address, suburb, owner and signing date come from the opportunity unless given
  v_m := hq_private.mp_new(
    v_opp.id, null,
    coalesce(nullif(btrim(coalesce(p_property_address, '')), ''), v_opp.property_address),
    coalesce(nullif(btrim(coalesce(p_suburb, '')), ''), v_opp.property_suburb),
    -- the owner: the contact given, else the lead's landlord contact (0127), and the name typed, else
    -- the prospect's name when there is no contact
    coalesce(p_owner_contact_id, v_opp.owner_contact_id),
    case when coalesce(p_owner_contact_id, v_opp.owner_contact_id) is null
         then coalesce(nullif(btrim(coalesce(p_owner_name, '')), ''), v_opp.prospect_name) else p_owner_name end,
    p_service_type, p_fee_basis, p_fee_percent, p_fee_notes,
    coalesce(p_agreement_signed_on, (v_opp.signed_at at time zone v_tz)::date),
    p_managed_from, p_status, p_ailo_reference, 'not_started', p_notes);
  if v_m.property_address is null then
    raise exception 'a property address is required (the opportunity has none recorded)' using errcode = 'invalid_parameter_value';
  end if;
  v_m := hq_private.mp_insert(v_m, 'from opportunity ' || v_opp.display_number);
  return hq_private.mp_json(v_m) || jsonb_build_object('changed', true);
end $$;
comment on function hq.convert_to_managed_property(uuid, hq.service_type, text, text, uuid, text, hq.fee_basis, numeric, text, date, date, hq.managed_status, text, text) is 'portfolio.write. Makes a SIGNED, live opportunity a managed property (one per opportunity: 23505 if it already is). Address, suburb, owner name and the agreement date default from the opportunity. Starts onboarding (default) or active (needs managed_from, today or earlier). Creates the nine handover steps. Returns the property json plus {changed}.';

-- ------------------------------------------------------------------ add_existing_managed_property
create function hq.add_existing_managed_property(
  p_manual_origin_note text,
  p_property_address text,
  p_service_type hq.service_type,
  p_suburb text default null,
  p_owner_contact_id uuid default null,
  p_owner_name text default null,
  p_fee_basis hq.fee_basis default null,
  p_fee_percent numeric default null,
  p_fee_notes text default null,
  p_agreement_signed_on date default null,
  p_managed_from date default null,
  p_status hq.managed_status default 'onboarding',
  p_ailo_reference text default null,
  p_ailo_status hq.ailo_status default 'not_started',
  p_notes text default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_m hq.managed_properties;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('portfolio.write');
  v_m := hq_private.mp_new(null, p_manual_origin_note, p_property_address, p_suburb, p_owner_contact_id, p_owner_name,
    p_service_type, p_fee_basis, p_fee_percent, p_fee_notes, p_agreement_signed_on, p_managed_from, p_status, p_ailo_reference, p_ailo_status, p_notes);
  if v_m.manual_origin_note is null then
    raise exception 'a property signed before HQ needs a note saying where it came from' using errcode = 'invalid_parameter_value';
  end if;
  if char_length(v_m.manual_origin_note) > 1000 then
    raise exception 'the note is at most 1000 characters' using errcode = 'invalid_parameter_value';
  end if;
  v_m := hq_private.mp_insert(v_m, 'signed before HQ');
  return hq_private.mp_json(v_m) || jsonb_build_object('changed', true);
end $$;
comment on function hq.add_existing_managed_property(text, text, hq.service_type, text, uuid, text, hq.fee_basis, numeric, text, date, date, hq.managed_status, text, hq.ailo_status, text) is 'portfolio.write. Records a property signed BEFORE HQ (no opportunity): needs a note saying where it came from (1..1000), the address and the service. Same rules as convert_to_managed_property; may also carry the Ailo status (live needs the reference). Returns the property json plus {changed}.';

-- ------------------------------------------------------------------ update_managed_property
-- Patch semantics: a null argument leaves that field as it is; an empty string clears a text field
-- (suburb, owner_name, fee_notes, ailo_reference, notes); p_clear names the other fields to clear
-- (owner_contact_id, fee_basis, fee_percent, agreement_signed_on, managed_from, ended_on). A change that
-- changes nothing writes nothing ({changed: false}). Status moves:
--   onboarding / active / offboarding: any of the three, and to ended (needs ended_on);
--   from ended (reopening): director or administrator only; the end date is cleared.
-- Choosing a fee basis other than percent_of_rent clears the percentage; giving a percentage alone
-- sets the basis to percent_of_rent. p_expected_updated_at (optional): refuse if someone else changed
-- the property since it was read. p_note goes into the audit row.
create function hq.update_managed_property(
  p_id uuid,
  p_property_address text default null,
  p_suburb text default null,
  p_owner_contact_id uuid default null,
  p_owner_name text default null,
  p_service_type hq.service_type default null,
  p_fee_basis hq.fee_basis default null,
  p_fee_percent numeric default null,
  p_fee_notes text default null,
  p_agreement_signed_on date default null,
  p_managed_from date default null,
  p_status hq.managed_status default null,
  p_ended_on date default null,
  p_ailo_reference text default null,
  p_ailo_status hq.ailo_status default null,
  p_notes text default null,
  p_clear text[] default null,
  p_note text default null,
  p_expected_updated_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_cur hq.managed_properties;
  v_new hq.managed_properties;
  v_clear text[] := coalesce(p_clear, '{}');
  v_bad text[];
  v_note text := hq_private.decision_text(p_note, 1000, 'a note');
  v_fields text[] := '{}';
  v_role hq.staff_role;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('portfolio.write');
  v_bad := array(select c from unnest(v_clear) c
                 where c not in ('owner_contact_id', 'fee_basis', 'fee_percent', 'agreement_signed_on', 'managed_from', 'ended_on'));
  if cardinality(v_bad) > 0 then
    raise exception 'these fields cannot be cleared this way: %', array_to_string(v_bad, ', ') using errcode = 'invalid_parameter_value';
  end if;

  select mp.* into v_cur from hq.managed_properties mp where mp.id = p_id and mp.deleted_at is null for update;
  if not found then
    raise exception 'managed property not found' using errcode = 'no_data_found';
  end if;
  if p_expected_updated_at is not null and v_cur.updated_at <> p_expected_updated_at then
    raise exception 'this property was changed by someone else; reload it and try again'
      using errcode = 'check_violation', hint = 'managed_property_stale';
  end if;

  v_new := v_cur;
  if p_property_address is not null then v_new.property_address := nullif(btrim(p_property_address), ''); end if;
  if p_suburb is not null then v_new.suburb := nullif(btrim(p_suburb), ''); end if;
  if p_owner_contact_id is not null then v_new.owner_contact_id := p_owner_contact_id; end if;
  if 'owner_contact_id' = any (v_clear) then v_new.owner_contact_id := null; end if;
  if p_owner_name is not null then v_new.owner_name := nullif(btrim(p_owner_name), ''); end if;
  if p_service_type is not null then v_new.service_type := p_service_type; end if;
  if p_fee_basis is not null then
    v_new.fee_basis := p_fee_basis;
    if p_fee_basis <> 'percent_of_rent' then v_new.fee_percent := null; end if;
  end if;
  if p_fee_percent is not null then
    if p_fee_basis is not null and p_fee_basis <> 'percent_of_rent' then
      raise exception 'a percentage is recorded only for a fee charged as a percentage of rent' using errcode = 'invalid_parameter_value';
    end if;
    v_new.fee_percent := p_fee_percent;
    v_new.fee_basis := 'percent_of_rent';
  end if;
  if 'fee_basis' = any (v_clear) then v_new.fee_basis := null; v_new.fee_percent := null; end if;
  if 'fee_percent' = any (v_clear) then v_new.fee_percent := null; end if;
  if p_fee_notes is not null then v_new.fee_notes := nullif(btrim(p_fee_notes), ''); end if;
  if p_agreement_signed_on is not null then v_new.agreement_signed_on := p_agreement_signed_on; end if;
  if 'agreement_signed_on' = any (v_clear) then v_new.agreement_signed_on := null; end if;
  if p_managed_from is not null then v_new.managed_from := p_managed_from; end if;
  if 'managed_from' = any (v_clear) then v_new.managed_from := null; end if;
  if p_ailo_reference is not null then v_new.ailo_reference := nullif(btrim(p_ailo_reference), ''); end if;
  if p_ailo_status is not null then v_new.ailo_status := p_ailo_status; end if;
  if p_notes is not null then v_new.notes := nullif(btrim(p_notes), ''); end if;

  -- status
  if p_status is not null and p_status is distinct from v_cur.status then
    if v_cur.status = 'ended' then
      v_role := hq_private.staff_role();
      if v_role not in ('director'::hq.staff_role, 'administrator'::hq.staff_role) then
        raise exception 'only a director or administrator can reopen an ended property' using errcode = 'insufficient_privilege';
      end if;
      v_new.ended_on := null;
    end if;
    v_new.status := p_status;
  end if;
  if p_ended_on is not null then v_new.ended_on := p_ended_on; end if;
  if 'ended_on' = any (v_clear) then v_new.ended_on := null; end if;
  if v_new.status = 'ended' and v_cur.status = 'ended' and v_new.ended_on is null then
    raise exception 'an ended property needs the date management ended' using errcode = 'invalid_parameter_value';
  end if;

  perform hq_private.mp_check(v_new, v_cur.id);

  if v_new.property_address is distinct from v_cur.property_address then v_fields := v_fields || 'property_address'::text; end if;
  if v_new.suburb is distinct from v_cur.suburb then v_fields := v_fields || 'suburb'::text; end if;
  if v_new.owner_contact_id is distinct from v_cur.owner_contact_id then v_fields := v_fields || 'owner_contact_id'::text; end if;
  if v_new.owner_name is distinct from v_cur.owner_name then v_fields := v_fields || 'owner_name'::text; end if;
  if v_new.service_type is distinct from v_cur.service_type then v_fields := v_fields || 'service_type'::text; end if;
  if v_new.fee_basis is distinct from v_cur.fee_basis then v_fields := v_fields || 'fee_basis'::text; end if;
  if v_new.fee_percent is distinct from v_cur.fee_percent then v_fields := v_fields || 'fee_percent'::text; end if;
  if v_new.fee_notes is distinct from v_cur.fee_notes then v_fields := v_fields || 'fee_notes'::text; end if;
  if v_new.agreement_signed_on is distinct from v_cur.agreement_signed_on then v_fields := v_fields || 'agreement_signed_on'::text; end if;
  if v_new.managed_from is distinct from v_cur.managed_from then v_fields := v_fields || 'managed_from'::text; end if;
  if v_new.status is distinct from v_cur.status then v_fields := v_fields || 'status'::text; end if;
  if v_new.ended_on is distinct from v_cur.ended_on then v_fields := v_fields || 'ended_on'::text; end if;
  if v_new.ailo_reference is distinct from v_cur.ailo_reference then v_fields := v_fields || 'ailo_reference'::text; end if;
  if v_new.ailo_status is distinct from v_cur.ailo_status then v_fields := v_fields || 'ailo_status'::text; end if;
  if v_new.notes is distinct from v_cur.notes then v_fields := v_fields || 'notes'::text; end if;

  if cardinality(v_fields) = 0 then
    return hq_private.mp_json(v_cur) || jsonb_build_object('changed', false, 'changed_fields', '[]'::jsonb);
  end if;

  perform hq_private.audit_context(null, left(v_note, 200));
  update hq.managed_properties set
    property_address = v_new.property_address, suburb = v_new.suburb, owner_contact_id = v_new.owner_contact_id,
    owner_name = v_new.owner_name, service_type = v_new.service_type, fee_basis = v_new.fee_basis,
    fee_percent = v_new.fee_percent, fee_notes = v_new.fee_notes, agreement_signed_on = v_new.agreement_signed_on,
    managed_from = v_new.managed_from, status = v_new.status, ended_on = v_new.ended_on,
    ailo_reference = v_new.ailo_reference, ailo_status = v_new.ailo_status, notes = v_new.notes
  where id = v_cur.id
  returning * into v_new;
  perform hq_private.audit_context();
  return hq_private.mp_json(v_new) || jsonb_build_object('changed', true, 'changed_fields', to_jsonb(v_fields),
    'previous_status', v_cur.status, 'previous_ailo_status', v_cur.ailo_status);
end $$;
comment on function hq.update_managed_property(uuid, text, text, uuid, text, hq.service_type, hq.fee_basis, numeric, text, date, date, hq.managed_status, date, text, hq.ailo_status, text, text[], text, timestamptz) is 'portfolio.write. Changes one live managed property (null leaves a field; an empty string clears a text field; p_clear clears owner_contact_id, fee_basis, fee_percent, agreement_signed_on, managed_from or ended_on). Status: onboarding, active (needs managed_from, today or earlier), offboarding and ended (needs ended_on); reopening an ended property needs a director or administrator. Ailo live needs the reference. Optimistic concurrency with p_expected_updated_at (23514 hint managed_property_stale). Nothing to change: {changed: false}. Returns the property json plus {changed, changed_fields, previous_status, previous_ailo_status}.';

-- ------------------------------------------------------------------ set_handover_step
-- Sets one checklist step to exactly the status and note given (a null note clears it). Idempotent:
-- the same status and note again changes nothing. not_applicable needs a note. Never changes the
-- property's status or its Ailo status: those are separate, deliberate changes.
create function hq.set_handover_step(
  p_property_id uuid,
  p_step hq.handover_step,
  p_status hq.handover_step_status,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_step hq.property_handover_steps;
  v_changed boolean := false;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('portfolio.write');
  if p_step is null or p_status is null then
    raise exception 'a step and a status are required' using errcode = 'invalid_parameter_value';
  end if;
  if p_status = 'not_applicable' and v_note is null then
    raise exception 'a step marked not applicable needs a note saying why' using errcode = 'invalid_parameter_value';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'a note is at most 1000 characters' using errcode = 'invalid_parameter_value';
  end if;
  perform 1 from hq.managed_properties mp where mp.id = p_property_id and mp.deleted_at is null for update;
  if not found then
    raise exception 'managed property not found' using errcode = 'no_data_found';
  end if;
  select s.* into v_step from hq.property_handover_steps s where s.property_id = p_property_id and s.step = p_step for update;
  if v_step.status is distinct from p_status or v_step.note is distinct from v_note then
    update hq.property_handover_steps set status = p_status, note = v_note
    where property_id = p_property_id and step = p_step
    returning * into v_step;
    v_changed := true;
  end if;
  return jsonb_build_object(
    'managed_property_id', p_property_id, 'step', v_step.step, 'status', v_step.status, 'note', v_step.note,
    'completed_at', v_step.completed_at, 'completed_by', v_step.completed_by, 'changed', v_changed,
    'handover_done_count', (select count(*) from hq.property_handover_steps s where s.property_id = p_property_id and s.status in ('done', 'not_applicable')),
    'handover_total', (select count(*) from hq.property_handover_steps s where s.property_id = p_property_id));
end $$;
comment on function hq.set_handover_step(uuid, hq.handover_step, hq.handover_step_status, text) is 'portfolio.write. Sets one handover checklist step (status and note exactly as given) on a live managed property. Idempotent. not_applicable needs a note. Never changes the property''s status or Ailo status. Returns {managed_property_id, step, status, note, completed_at, completed_by, changed, handover_done_count, handover_total}.';

-- ------------------------------------------------------------------ set_business_goal
-- The managed-property target and the date to reach it. The date is the owner's: null until they set
-- it, and it may be cleared again (null). A new date must be today or later; an unchanged one may
-- have passed. settings.admin (directors).
create function hq.set_business_goal(p_target integer, p_date date default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_cur_target jsonb;
  v_cur_date jsonb;
  v_new_date jsonb := case when p_date is null then 'null'::jsonb else to_jsonb(to_char(p_date, 'YYYY-MM-DD')) end;
  v_changed boolean := false;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('settings.admin');
  if p_target is null or p_target < 1 or p_target > 10000 then
    raise exception 'the target is a whole number of properties from 1 to 10000' using errcode = 'invalid_parameter_value';
  end if;
  select s.value into v_cur_target from hq.settings s where s.key = 'goal_managed_properties' for update;
  select s.value into v_cur_date from hq.settings s where s.key = 'goal_date' for update;
  if p_date is not null and v_new_date is distinct from v_cur_date and p_date < hq.today() then
    raise exception 'the goal date must be today or later' using errcode = 'invalid_parameter_value';
  end if;
  if p_date is not null and p_date > date '2100-12-31' then
    raise exception 'that goal date is too far ahead' using errcode = 'invalid_parameter_value';
  end if;
  if v_cur_target is distinct from to_jsonb(p_target) then
    insert into hq.settings (key, value) values ('goal_managed_properties', to_jsonb(p_target))
    on conflict (key) do update set value = excluded.value;
    v_changed := true;
  end if;
  if v_cur_date is distinct from v_new_date then
    insert into hq.settings (key, value) values ('goal_date', v_new_date)
    on conflict (key) do update set value = excluded.value;
    v_changed := true;
  end if;
  return jsonb_build_object('target', p_target, 'goal_date', p_date, 'changed', v_changed);
end $$;
comment on function hq.set_business_goal(integer, date) is 'settings.admin. Sets the managed-property target (1..10000) and the goal date (null clears it; a new date is today or later). Audited through the settings rows. Returns {target, goal_date, changed}.';

-- ------------------------------------------------------------------ business_summary
-- The CEO's "business at a glance", every figure labelled:
--   actual    counted from records in HQ (managed properties, open opportunities)
--   signed    managements marked signed in HQ (from HQ records; not contracts HQ has seen)
--   estimate  people's own yearly-value estimates on open opportunities, never income
--   goal      the owner's own target and date (date null until they set it)
-- managed needs portfolio.read; signed, pipeline and leads need growth.read (a section the caller may
-- not see is null with a note). pace is null unless a goal date is set and both sections are visible.
create function hq.business_summary() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_today date := hq.today();
  v_tz text := coalesce((select s.value #>> '{}' from hq.settings s where s.key = 'timezone'), 'Australia/Adelaide');
  v_fy date;
  v_month date := date_trunc('month', hq.today())::date;
  v_portfolio boolean := hq_private.has_capability('portfolio.read');
  v_growth boolean := hq_private.has_capability('growth.read');
  v_target integer;
  v_goal_date date;
  v_managed jsonb := null;
  v_signed jsonb := null;
  v_pipeline jsonb := null;
  v_leads jsonb := null;
  v_pace jsonb := null;
  v_notes text[] := '{}';
  v_count integer;
  v_signed_90 integer;
  v_months numeric;
  v_remaining integer;
begin
  perform hq_private.require_staff();
  if not (v_portfolio or v_growth) then
    raise exception 'permission denied' using errcode = 'insufficient_privilege', detail = 'requires growth.read or portfolio.read';
  end if;
  v_fy := make_date(case when extract(month from v_today) >= 7 then extract(year from v_today)::integer else extract(year from v_today)::integer - 1 end, 7, 1);
  v_target := coalesce((select (s.value #>> '{}')::integer from hq.settings s where s.key = 'goal_managed_properties' and jsonb_typeof(s.value) = 'number'), 20);
  v_goal_date := (select (s.value #>> '{}')::date from hq.settings s where s.key = 'goal_date' and jsonb_typeof(s.value) = 'string');

  if v_portfolio then
    select jsonb_build_object(
      'label', 'actual',
      'basis', 'Managed property records in HQ. Managed means active or onboarding.',
      'managed', count(*) filter (where status in ('active', 'onboarding')),
      'active', count(*) filter (where status = 'active'),
      'onboarding', count(*) filter (where status = 'onboarding'),
      'offboarding', count(*) filter (where status = 'offboarding'),
      'ended', count(*) filter (where status = 'ended'),
      'long_term_residential', jsonb_build_object(
        'managed', count(*) filter (where status in ('active', 'onboarding') and service_type = 'long_term_residential'),
        'active', count(*) filter (where status = 'active' and service_type = 'long_term_residential'),
        'onboarding', count(*) filter (where status = 'onboarding' and service_type = 'long_term_residential')),
      'short_term_accommodation', jsonb_build_object(
        'managed', count(*) filter (where status in ('active', 'onboarding') and service_type = 'short_term_accommodation'),
        'active', count(*) filter (where status = 'active' and service_type = 'short_term_accommodation'),
        'onboarding', count(*) filter (where status = 'onboarding' and service_type = 'short_term_accommodation')),
      'handover_open', count(*) filter (where status in ('active', 'onboarding') and exists (
        select 1 from hq.property_handover_steps s where s.property_id = mp.id and s.status not in ('done', 'not_applicable'))),
      'recorded', count(*))
    into v_managed
    from hq.managed_properties mp
    where mp.deleted_at is null;
  else
    v_notes := v_notes || 'Managed properties are not shown: your role does not include portfolio.read.'::text;
  end if;

  if v_growth then
    select jsonb_build_object(
      'label', 'signed',
      'basis', 'Managements marked signed in HQ (from HQ records), counted by the date they were signed.',
      'this_month', count(*) filter (where (o.signed_at at time zone v_tz)::date >= v_month),
      'last_30_days', count(*) filter (where (o.signed_at at time zone v_tz)::date >= v_today - 30),
      'financial_year', count(*) filter (where (o.signed_at at time zone v_tz)::date >= v_fy),
      'financial_year_start', v_fy,
      'last_90_days', count(*) filter (where (o.signed_at at time zone v_tz)::date >= v_today - 90))
    into v_signed
    from hq.opportunities o
    where o.deleted_at is null and o.stage = 'management_signed';
    v_signed_90 := (v_signed ->> 'last_90_days')::integer;

    select jsonb_build_object(
      'label', 'actual',
      'basis', 'Open opportunities in the pipeline (not signed, not lost).',
      'open', (select count(*) from hq.opportunities o where o.deleted_at is null and o.stage not in ('management_signed', 'lost')),
      'by_stage', coalesce((
        select jsonb_object_agg(e.stage::text, coalesce(n.n, 0) order by e.ord)
        from (select s, row_number() over () as ord from unnest(enum_range(null::hq.opportunity_stage)) s) e(stage, ord)
        left join (select o.stage, count(*) as n from hq.opportunities o where o.deleted_at is null group by 1) n on n.stage = e.stage
        where e.stage not in ('management_signed', 'lost')), '{}'::jsonb),
      'estimated_yearly_value_cents', (select coalesce(sum(o.estimated_annual_value_cents), 0)::bigint from hq.opportunities o
                                       where o.deleted_at is null and o.stage not in ('management_signed', 'lost')),
      'estimated_value_label', 'estimate',
      'estimated_value_basis', 'The sum of the yearly values people estimated on open opportunities. An estimate, not income.',
      'with_estimate', (select count(*) from hq.opportunities o where o.deleted_at is null and o.stage not in ('management_signed', 'lost') and o.estimated_annual_value_cents is not null),
      'without_estimate', (select count(*) from hq.opportunities o where o.deleted_at is null and o.stage not in ('management_signed', 'lost') and o.estimated_annual_value_cents is null))
    into v_pipeline;

    -- leads needing attention: only when the leads pipeline's overdue_opportunities view exists
    if to_regclass('hq.overdue_opportunities') is not null then
      execute 'select count(*)::integer from hq.overdue_opportunities' into v_count;
      v_leads := jsonb_build_object('label', 'actual', 'basis', 'Open opportunities flagged in the pipeline as needing attention (no owner, no next step, or overdue).', 'count', v_count);
    else
      v_notes := v_notes || 'Leads needing attention are not counted yet: the pipeline does not flag them.'::text;
    end if;
  else
    v_notes := v_notes || 'Signings and the pipeline are not shown: your role does not include growth.read.'::text;
  end if;

  if v_goal_date is not null and v_managed is not null and v_signed is not null then
    v_remaining := greatest(v_target - (v_managed ->> 'managed')::integer, 0);
    v_months := round(greatest(v_goal_date - v_today, 0)::numeric / 30.4375, 1);
    v_pace := jsonb_build_object(
      'label', 'calculation',
      'basis', 'Needed: properties still to reach the target, spread over the months to the goal date. Actual: managements signed per month over the last 3 months (from HQ records).',
      'remaining', v_remaining,
      'months_left', v_months,
      'needed_per_month', case when v_remaining = 0 then 0 when v_months <= 0 then null else round(v_remaining / v_months, 1) end,
      'actual_per_month', round(v_signed_90::numeric / 3, 1),
      'goal_date_passed', v_goal_date < v_today,
      'target_reached', v_remaining = 0);
  end if;

  return jsonb_build_object(
    'as_of', v_today,
    'labels', jsonb_build_object(
      'actual', 'Counted from records in HQ.',
      'signed', 'Managements marked signed in HQ (from HQ records).',
      'estimate', 'People''s own yearly-value estimates. Not income.',
      'goal', 'The owner''s own target.',
      'calculation', 'Worked out from the figures above.'),
    'goal', jsonb_build_object('label', 'goal', 'target_managed', v_target, 'goal_date', v_goal_date),
    'managed', v_managed,
    'signed', v_signed,
    'pipeline', v_pipeline,
    'leads_needing_attention', v_leads,
    'pace', v_pace,
    'notes', to_jsonb(v_notes));
end $$;
comment on function hq.business_summary() is 'growth.read or portfolio.read. The CEO view: goal {target_managed, goal_date (null until set)}, managed (actual: active + onboarding, by status and service type; portfolio.read), signed (from HQ records: this month, last 30 days, financial year; growth.read), pipeline (actual open counts by stage plus the ESTIMATED yearly value; growth.read), leads_needing_attention (when hq.overdue_opportunities exists), pace (only with a goal date: needed vs actual per month), labels, notes.';

-- ------------------------------------------------------------------ archive_record / restore_record (0125 extended with 'managed_property')
create or replace function hq.archive_record(p_entity text, p_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_table text;
  v_caller uuid := hq_private.require_staff();
  v_deleted timestamptz;
  v_allowed boolean;
  v_needs text;
  v_ref hq.referrals;
  v_n integer;
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 200);
begin
  v_table := case p_entity
    when 'organisation' then 'organisations' when 'contact' then 'contacts' when 'referral' then 'referrals'
    when 'task' then 'tasks' when 'opportunity' then 'opportunities' when 'interaction' then 'interactions'
    when 'contractor' then 'contractors' when 'contractor_document' then 'contractor_documents'
    when 'contractor_review' then 'contractor_reviews' when 'decision' then 'decisions'
    when 'managed_property' then 'managed_properties' end;
  if v_table is null then
    raise exception 'unknown entity %; expected organisation, contact, referral, task, opportunity, interaction, contractor, contractor_document, contractor_review, decision or managed_property', p_entity
      using errcode = 'invalid_parameter_value';
  end if;
  if p_entity = 'contractor' then
    v_needs := 'contractors.approve';
    v_allowed := hq_private.has_capability('contractors.approve');
  elsif p_entity = 'contractor_document' then
    v_needs := 'contractors.documents';
    v_allowed := hq_private.has_capability('contractors.documents');
  elsif p_entity = 'contractor_review' then
    v_needs := 'contractors.approve';
    v_allowed := hq_private.has_capability('contractors.approve')
      or (hq_private.has_capability('contractors.write')
          and exists (select 1 from hq.contractor_reviews r where r.id = p_id and r.recorded_by = v_caller));
  elsif p_entity = 'decision' then
    v_needs := 'decisions.write';
    v_allowed := hq_private.has_capability('decisions.write');
  elsif p_entity = 'managed_property' then
    v_needs := 'portfolio.write';
    v_allowed := hq_private.has_capability('portfolio.write');
  else
    v_needs := 'growth.delete';
    v_allowed := hq_private.has_capability('growth.delete');
    if not v_allowed and p_entity = 'task' and hq_private.has_capability('tasks.write') then
      v_allowed := exists (
        select 1 from hq.tasks t
        where t.id = p_id and (t.assigned_to = v_caller or t.created_by = v_caller or hq_private.has_capability('tasks.read_all')));
    end if;
  end if;
  if not v_allowed then
    raise exception 'permission denied' using errcode = 'insufficient_privilege', detail = 'requires ' || v_needs;
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

  perform hq_private.audit_context(null, v_reason);
  execute format('update hq.%I set deleted_at = now() where id = $1', v_table) using p_id;
  perform hq_private.audit_context();
  if p_entity = 'decision' then
    perform hq_private.decision_history_write(p_id, 'archive', 'Archived', '{}'::jsonb, v_reason);
  end if;
  return jsonb_build_object('entity', p_entity, 'id', p_id, 'archived', true, 'changed', true);
end $$;
comment on function hq.archive_record(text, uuid, text) is 'Soft-deletes organisation, contact, referral, task, opportunity, interaction (growth.delete; a task also by its assignee or creator holding tasks.write; an opportunity that is a live managed property is refused), contractor (contractors.approve), contractor_document (contractors.documents), contractor_review (contractors.approve, or its recorder with contractors.write), decision (decisions.write; refused while a live decision is superseded by it; recorded in its history), managed_property (portfolio.write).';

create or replace function hq.restore_record(p_entity text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_table text;
  v_deleted timestamptz;
  v_n integer;
begin
  perform hq_private.require_staff();
  v_table := case p_entity
    when 'organisation' then 'organisations' when 'contact' then 'contacts' when 'referral' then 'referrals'
    when 'task' then 'tasks' when 'opportunity' then 'opportunities' when 'interaction' then 'interactions'
    when 'contractor' then 'contractors' when 'contractor_document' then 'contractor_documents'
    when 'contractor_review' then 'contractor_reviews' when 'decision' then 'decisions'
    when 'managed_property' then 'managed_properties' end;
  if v_table is null then
    raise exception 'unknown entity %; expected organisation, contact, referral, task, opportunity, interaction, contractor, contractor_document, contractor_review, decision or managed_property', p_entity
      using errcode = 'invalid_parameter_value';
  end if;
  perform hq_private.require_capability(case p_entity
    when 'contractor' then 'contractors.approve'
    when 'contractor_document' then 'contractors.documents'
    when 'contractor_review' then 'contractors.approve'
    when 'decision' then 'decisions.write'
    when 'managed_property' then 'portfolio.write'
    else 'growth.delete' end);
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
    -- a unique name, email, ABN, primary contact, address or Ailo reference that was taken meanwhile
    -- fails the restore (23505); a decision superseded by an archived decision is refused (restore that
    -- one first); a managed property whose opportunity is no longer signed and live is refused (23514)
    execute format('update hq.%I set deleted_at = null where id = $1', v_table) using p_id;
  end if;
  if p_entity = 'decision' then
    perform hq_private.decision_history_write(p_id, 'restore', 'Restored');
  end if;
  return jsonb_build_object('entity', p_entity, 'id', p_id, 'archived', false, 'changed', true);
end $$;
comment on function hq.restore_record(text, uuid) is 'Restores a soft-deleted record: growth.delete for the Phase 1 entities, contractors.approve for contractor and contractor_review, contractors.documents for contractor_document, decisions.write for decision, portfolio.write for managed_property (refused when its opportunity is no longer signed and live). A restored referral takes attribution back only when the opportunity has none.';

revoke execute on all functions in schema hq_private from public, anon;
revoke execute on all functions in schema hq from public, anon;
