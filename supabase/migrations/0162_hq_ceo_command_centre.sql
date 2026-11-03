-- 0162_hq_ceo_command_centre.sql
-- The CEO Command Centre (/hq/ceo, docs/hq-ceo-command-centre.md). Read-mostly: one aggregate RPC over the
-- records HQ already keeps, plus the three smallest extensions the figures need. Nothing here invents a
-- figure; where HQ holds no data the aggregate returns nothing and the page says what is missing.
--
--   managed_properties  + weekly_rent_cents   the weekly rent on the management agreement (long-term)
--                       + annual_fee_cents    the agreed yearly management fee where it is not a percentage
--                                             of rent (a flat fee, other, or short-term accommodation)
--                       + end_reason          why a management ended (with the existing notes)
--   set_property_terms  portfolio.write. Sets or clears those three (audited by the existing audit trigger).
--   settings            ceo_weekly_targets: null until a director sets it; validated by its own guard.
--   set_ceo_targets     settings.admin. Writes ceo_weekly_targets.
--   ceo_overview        The period figures (a period and the comparison period the caller chose), the
--                       monthly portfolio series, the funnel with days in stage and conversions from stage
--                       history, referral performance, weekly activity and website-enquiry response.
--                       Each part needs the capability its records need (portfolio.read, growth.read).
--
-- Fees are recorded EXCLUDING GST (the form says so). "Contracted annualised fees" = weekly rent x 52 x the
-- fee percentage, or the agreed yearly fee: what the agreements say, never money received (Ailo holds that).

-- ------------------------------------------------------------------ managed_properties: terms and end reason
create type hq.management_end_reason as enum ('owner_sold', 'owner_self_managing', 'moved_to_another_manager', 'owner_moving_in', 'service', 'fees', 'other');

alter table hq.managed_properties
  add column weekly_rent_cents bigint,
  add column annual_fee_cents bigint,
  add column end_reason hq.management_end_reason,
  add constraint managed_properties_weekly_rent_range check (weekly_rent_cents is null or weekly_rent_cents between 1 and 10000000),
  add constraint managed_properties_annual_fee_range check (annual_fee_cents is null or annual_fee_cents between 1 and 100000000),
  add constraint managed_properties_end_reason_only_when_ended check (end_reason is null or status in ('offboarding', 'ended'));
comment on column hq.managed_properties.weekly_rent_cents is 'The weekly rent on the management agreement, in cents (long-term). With fee_percent it gives the contracted yearly fee. Ailo holds the live rent; this is the agreed figure, typed by a person.';
comment on column hq.managed_properties.annual_fee_cents is 'The agreed yearly management fee in cents, excluding GST, where the fee is not a percentage of rent (flat fee, other) or for short-term accommodation. Typed by a person; never income received.';
comment on column hq.managed_properties.end_reason is 'Why the management is ending or ended (offboarding or ended only).';

-- portfolio_overview (0129) with the three new columns appended, so the view is replaced in place.
create or replace view hq.portfolio_overview with (security_invoker = true) as
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
  mp.deleted_at,
  mp.weekly_rent_cents,
  mp.annual_fee_cents,
  mp.end_reason
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

-- ------------------------------------------------------------------ the contracted yearly fee of one property
-- Cents a year, or null when the terms that give it are not recorded. Percent of rent: rent x 52 x pct;
-- otherwise the agreed yearly fee. One definition, used by ceo_overview and the property page.
create function hq_private.mp_annual_fee_cents(p_m hq.managed_properties) returns bigint
language sql immutable set search_path = pg_catalog, public, extensions as $$
  select case
    when p_m.fee_basis = 'percent_of_rent' and p_m.fee_percent is not null and p_m.weekly_rent_cents is not null
      then round(p_m.weekly_rent_cents * 52 * p_m.fee_percent / 100)::bigint
    when p_m.annual_fee_cents is not null and (p_m.fee_basis is distinct from 'percent_of_rent')
      then p_m.annual_fee_cents
    else null
  end
$$;

-- When a management began, for the history: managed_from, else the agreement date, else when it was recorded.
create function hq_private.mp_start_date(p_m hq.managed_properties, p_tz text) returns date
language sql immutable set search_path = pg_catalog, public, extensions as $$
  select coalesce(p_m.managed_from, p_m.agreement_signed_on, (p_m.created_at at time zone p_tz)::date)
$$;

-- ------------------------------------------------------------------ set_property_terms
-- A null argument leaves that field as it is; p_clear names fields to clear (weekly_rent_cents,
-- annual_fee_cents, end_reason). The yearly fee only applies where the fee is not a percentage of rent.
create function hq.set_property_terms(
  p_id uuid,
  p_weekly_rent_cents bigint default null,
  p_annual_fee_cents bigint default null,
  p_end_reason hq.management_end_reason default null,
  p_clear text[] default null,
  p_expected_updated_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_cur hq.managed_properties;
  v_new hq.managed_properties;
  v_clear text[] := coalesce(p_clear, '{}');
  v_bad text[];
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('portfolio.write');
  v_bad := array(select c from unnest(v_clear) c where c not in ('weekly_rent_cents', 'annual_fee_cents', 'end_reason'));
  if cardinality(v_bad) > 0 then
    raise exception 'these fields cannot be cleared this way: %', array_to_string(v_bad, ', ') using errcode = 'invalid_parameter_value';
  end if;
  select mp.* into v_cur from hq.managed_properties mp where mp.id = p_id and mp.deleted_at is null for update;
  if not found then
    raise exception 'no such managed property' using errcode = 'no_data_found';
  end if;
  if p_expected_updated_at is not null and v_cur.updated_at > p_expected_updated_at then
    raise exception 'someone else changed this property since you opened it' using errcode = 'serialization_failure', hint = 'stale';
  end if;
  v_new := v_cur;
  if 'weekly_rent_cents' = any (v_clear) then v_new.weekly_rent_cents := null; elsif p_weekly_rent_cents is not null then v_new.weekly_rent_cents := p_weekly_rent_cents; end if;
  if 'annual_fee_cents' = any (v_clear) then v_new.annual_fee_cents := null; elsif p_annual_fee_cents is not null then v_new.annual_fee_cents := p_annual_fee_cents; end if;
  if 'end_reason' = any (v_clear) then v_new.end_reason := null; elsif p_end_reason is not null then v_new.end_reason := p_end_reason; end if;
  if v_new.weekly_rent_cents is not null and v_new.weekly_rent_cents not between 1 and 10000000 then
    raise exception 'the weekly rent must be between $0.01 and $100,000' using errcode = 'invalid_parameter_value';
  end if;
  if v_new.annual_fee_cents is not null and v_new.annual_fee_cents not between 1 and 100000000 then
    raise exception 'the yearly fee must be between $0.01 and $1,000,000' using errcode = 'invalid_parameter_value';
  end if;
  if v_new.annual_fee_cents is not null and v_new.fee_basis is not distinct from 'percent_of_rent' then
    raise exception 'a fee charged as a percentage of rent is worked out from the rent; record the weekly rent instead' using errcode = 'invalid_parameter_value';
  end if;
  if v_new.end_reason is not null and v_new.status not in ('offboarding', 'ended') then
    raise exception 'a reason for ending is recorded only when the property is offboarding or ended' using errcode = 'invalid_parameter_value';
  end if;
  if v_new.weekly_rent_cents is not distinct from v_cur.weekly_rent_cents
     and v_new.annual_fee_cents is not distinct from v_cur.annual_fee_cents
     and v_new.end_reason is not distinct from v_cur.end_reason then
    return jsonb_build_object('managed_property_id', v_cur.id, 'changed', false, 'annual_fee_cents_worked_out', hq_private.mp_annual_fee_cents(v_cur));
  end if;
  update hq.managed_properties mp
     set weekly_rent_cents = v_new.weekly_rent_cents, annual_fee_cents = v_new.annual_fee_cents, end_reason = v_new.end_reason
   where mp.id = v_cur.id
  returning mp.* into v_new;
  return jsonb_build_object('managed_property_id', v_new.id, 'changed', true, 'updated_at', v_new.updated_at,
    'weekly_rent_cents', v_new.weekly_rent_cents, 'annual_fee_cents', v_new.annual_fee_cents, 'end_reason', v_new.end_reason,
    'annual_fee_cents_worked_out', hq_private.mp_annual_fee_cents(v_new));
end $$;
comment on function hq.set_property_terms(uuid, bigint, bigint, hq.management_end_reason, text[], timestamptz) is 'portfolio.write. Sets the agreed weekly rent (cents), the agreed yearly fee (cents, excluding GST; only when the fee is not a percentage of rent) and the reason a management is ending (offboarding or ended only). Null leaves a field; p_clear clears it. Audited by the managed_properties audit trigger. Returns {managed_property_id, changed, annual_fee_cents_worked_out, ...}.';

-- ------------------------------------------------------------------ ceo_weekly_targets (a setting)
-- {"relationship_actions": n, "discovery_conversations": n, "qualified": n, "appraisals": n, "proposals": n, "signings": n}
-- each a whole number 0..1000, every key optional, no other keys. null = no targets set (none are invented).
insert into hq.settings (key, value) values ('ceo_weekly_targets', 'null'::jsonb) on conflict (key) do nothing;

create function hq_private.ceo_targets_valid(p_value jsonb) returns boolean
language sql immutable set search_path = pg_catalog, public, extensions as $$
  select p_value is null or jsonb_typeof(p_value) = 'null' or (
    jsonb_typeof(p_value) = 'object'
    and not exists (
      select 1 from jsonb_each(p_value) e
      where e.key not in ('relationship_actions', 'discovery_conversations', 'qualified', 'appraisals', 'proposals', 'signings')
         or jsonb_typeof(e.value) <> 'number'
         or (e.value #>> '{}') !~ '^[0-9]{1,4}$'
         or (e.value #>> '{}')::integer > 1000))
$$;

create function hq_private.ceo_targets_guard() returns trigger
language plpgsql set search_path = pg_catalog, public, extensions as $$
begin
  if new.key = 'ceo_weekly_targets' and not hq_private.ceo_targets_valid(new.value) then
    raise exception 'ceo_weekly_targets must be null or an object of whole numbers from 0 to 1000 (relationship_actions, discovery_conversations, qualified, appraisals, proposals, signings)'
      using errcode = 'invalid_parameter_value';
  end if;
  return new;
end $$;
create trigger ceo_targets_guard before insert or update on hq.settings for each row
  when (new.key = 'ceo_weekly_targets') execute function hq_private.ceo_targets_guard();

create function hq.set_ceo_targets(p_targets jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_value jsonb := case when p_targets is null or jsonb_typeof(p_targets) = 'null' or p_targets = '{}'::jsonb then 'null'::jsonb else p_targets end;
  v_old jsonb;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('settings.admin');
  if not hq_private.ceo_targets_valid(v_value) then
    raise exception 'each weekly target is a whole number from 0 to 1000' using errcode = 'invalid_parameter_value';
  end if;
  select s.value into v_old from hq.settings s where s.key = 'ceo_weekly_targets' for update;
  if v_old is not distinct from v_value then
    return jsonb_build_object('targets', v_value, 'changed', false);
  end if;
  -- audited through the settings row, as set_business_goal
  insert into hq.settings (key, value) values ('ceo_weekly_targets', v_value)
  on conflict (key) do update set value = excluded.value;
  return jsonb_build_object('targets', v_value, 'changed', true);
end $$;
comment on function hq.set_ceo_targets(jsonb) is 'settings.admin. Sets the weekly activity targets the CEO Command Centre compares against (null or {} clears them). Each is a whole number 0..1000. Audited through the settings row.';

-- ------------------------------------------------------------------ the figures for one window
create function hq_private.ceo_window(p_from date, p_to date, p_portfolio boolean, p_growth boolean) returns jsonb
language plpgsql stable set search_path = pg_catalog, public, extensions as $$
declare
  v_tz text := coalesce((select s.value #>> '{}' from hq.settings s where s.key = 'timezone'), 'Australia/Adelaide');
  v_portfolio jsonb := null;
  v_growth jsonb := null;
begin
  if p_portfolio then
    with mp as (
      select m.*, hq_private.mp_start_date(m, v_tz) as started_on, hq_private.mp_annual_fee_cents(m) as fee
      from hq.managed_properties m where m.deleted_at is null
    )
    select jsonb_build_object(
      'started', count(*) filter (where started_on between p_from and p_to),
      'started_long_term', count(*) filter (where started_on between p_from and p_to and service_type = 'long_term_residential'),
      'started_short_term', count(*) filter (where started_on between p_from and p_to and service_type = 'short_term_accommodation'),
      'ended', count(*) filter (where ended_on between p_from and p_to),
      'ended_reasons', coalesce((select jsonb_object_agg(coalesce(r.end_reason::text, 'not_recorded'), r.n) from (
          select x.end_reason, count(*) as n from mp x where x.ended_on between p_from and p_to group by 1) r), '{}'::jsonb),
      'managed_at_start', count(*) filter (where started_on < p_from and (ended_on is null or ended_on >= p_from)),
      'managed_at_end', count(*) filter (where started_on <= p_to and (ended_on is null or ended_on > p_to)),
      'fees_at_end_cents', coalesce(sum(fee) filter (where started_on <= p_to and (ended_on is null or ended_on > p_to)), 0),
      'fees_at_end_with_terms', count(fee) filter (where started_on <= p_to and (ended_on is null or ended_on > p_to)))
    into v_portfolio
    from mp;
  end if;

  if p_growth then
    with first_reach as (
      -- the first time each lead reached a stage (history, or its current stage when history is missing)
      select o.id, h.to_stage as stage, min(h.changed_at) as at
      from hq.opportunities o join hq.opportunity_stage_history h on h.opportunity_id = o.id
      where o.deleted_at is null group by 1, 2
      union all
      select o.id, o.stage, o.stage_changed_at from hq.opportunities o
      where o.deleted_at is null and not exists (select 1 from hq.opportunity_stage_history h where h.opportunity_id = o.id and h.to_stage = o.stage)
    ),
    reached as (
      select stage, count(distinct id) filter (where (at at time zone v_tz)::date between p_from and p_to) as n
      from first_reach group by 1
    ),
    qualified as (
      select count(*) as n from (
        select o.id, least(
          (select min(h.changed_at) from hq.opportunity_stage_history h
            where h.opportunity_id = o.id and h.to_stage in ('qualified', 'appraisal_requested', 'appraisal_completed', 'proposal_sent', 'management_signed')),
          case when o.stage in ('qualified', 'appraisal_requested', 'appraisal_completed', 'proposal_sent', 'management_signed') then o.stage_changed_at end) as at
        from hq.opportunities o where o.deleted_at is null) q
      where q.at is not null and (q.at at time zone v_tz)::date between p_from and p_to
    ),
    signed as (
      select count(*) as n, coalesce(sum(o.estimated_annual_value_cents), 0)::bigint as value,
             count(*) filter (where exists (select 1 from hq.referrals r where r.opportunity_id = o.id and r.direction = 'received' and r.is_attributed and r.deleted_at is null)) as from_partners
      from hq.opportunities o
      where o.deleted_at is null and o.stage = 'management_signed' and (o.signed_at at time zone v_tz)::date between p_from and p_to
    ),
    created as (
      select count(*) as n, coalesce(jsonb_object_agg(src, k) filter (where src is not null), '{}'::jsonb) as by_source from (
        select o.source::text as src, count(*) as k from hq.opportunities o
        where o.deleted_at is null and (o.created_at at time zone v_tz)::date between p_from and p_to group by 1) s
    ),
    lost as (
      select count(*) as n, coalesce(jsonb_object_agg(code, k) filter (where code is not null), '{}'::jsonb) as reasons from (
        select coalesce(o.lost_reason_code::text, 'other') as code, count(*) as k from hq.opportunities o
        where o.deleted_at is null and o.stage = 'lost' and (o.stage_changed_at at time zone v_tz)::date between p_from and p_to group by 1) l
    ),
    refs as (
      select count(*) filter (where r.direction = 'received') as received,
             count(*) filter (where r.direction = 'sent') as sent,
             count(distinct coalesce(r.referring_organisation_id, r.referring_contact_id)) filter (where r.direction = 'received') as partners_introducing,
             count(*) filter (where r.direction = 'received' and r.is_attributed and exists (
               select 1 from hq.opportunity_stage_history h where h.opportunity_id = r.opportunity_id
                 and h.to_stage in ('qualified', 'appraisal_requested', 'appraisal_completed', 'proposal_sent', 'management_signed'))) as qualified_referrals
      from hq.referrals r where r.deleted_at is null and r.referral_date between p_from and p_to
    ),
    talk as (
      select
        count(*) filter (where i.interaction_type <> 'note' and (i.organisation_id is not null or c.contact_kind = 'partner') and i.opportunity_id is null) as relationship_actions,
        count(*) filter (where i.interaction_type in ('phone_call', 'coffee_meeting', 'office_meeting') and (i.organisation_id is not null or c.contact_kind = 'partner') and i.opportunity_id is null) as partner_conversations,
        count(*) filter (where i.interaction_type in ('phone_call', 'coffee_meeting', 'office_meeting') and i.opportunity_id is not null) as discovery_conversations
      from hq.interactions i left join hq.contacts c on c.id = i.contact_id
      where i.deleted_at is null and (i.occurred_at at time zone v_tz)::date between p_from and p_to
    ),
    enq as (
      select count(*) as received,
             count(*) filter (where e.handled_at is not null) as handled,
             percentile_cont(0.5) within group (order by extract(epoch from (e.handled_at - e.received_at)) / 3600.0) filter (where e.handled_at is not null) as median_hours
      from hq.enquiries e
      where e.status <> 'spam' and (e.received_at at time zone v_tz)::date between p_from and p_to
    )
    select jsonb_build_object(
      'new_opportunities', created.n, 'new_by_source', created.by_source,
      'qualified', qualified.n,
      'entered', coalesce((select jsonb_object_agg(stage::text, n) from reached), '{}'::jsonb),
      'signed', signed.n, 'signed_estimated_value_cents', signed.value, 'signed_from_partners', signed.from_partners,
      'lost', lost.n, 'lost_reasons', lost.reasons,
      'referrals_received', refs.received, 'referrals_sent', refs.sent,
      'partners_introducing', refs.partners_introducing, 'qualified_referrals', refs.qualified_referrals,
      'relationship_actions', talk.relationship_actions, 'partner_conversations', talk.partner_conversations,
      'discovery_conversations', talk.discovery_conversations,
      'enquiries_received', enq.received, 'enquiries_handled', enq.handled,
      'enquiry_median_hours', case when enq.median_hours is null then null else round(enq.median_hours::numeric, 1) end)
    into v_growth
    from created, qualified, signed, lost, refs, talk, enq;
  end if;

  return jsonb_build_object('from', p_from, 'to', p_to, 'portfolio', v_portfolio, 'growth', v_growth);
end $$;

-- ------------------------------------------------------------------ ceo_overview
create function hq.ceo_overview(p_from date, p_to date, p_prev_from date default null, p_prev_to date default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_today date := hq.today();
  v_tz text := coalesce((select s.value #>> '{}' from hq.settings s where s.key = 'timezone'), 'Australia/Adelaide');
  v_portfolio boolean := hq_private.has_capability('portfolio.read');
  v_growth boolean := hq_private.has_capability('growth.read');
  v_to date;
  v_series jsonb := null;
  v_economics jsonb := null;
  v_funnel jsonb := null;
  v_conversion jsonb := null;
  v_partners jsonb := null;
  v_weeks jsonb := null;
  v_freshest timestamptz;
begin
  perform hq_private.require_staff();
  if not (v_portfolio or v_growth) then
    raise exception 'permission denied' using errcode = 'insufficient_privilege', detail = 'requires growth.read or portfolio.read';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'the period needs a start on or before its end' using errcode = 'invalid_parameter_value';
  end if;
  if p_to - p_from > 1100 then
    raise exception 'a period is at most three years' using errcode = 'invalid_parameter_value';
  end if;
  if (p_prev_from is null) <> (p_prev_to is null) or (p_prev_from is not null and (p_prev_from > p_prev_to or p_prev_to >= p_from)) then
    raise exception 'the comparison period must end before the period starts' using errcode = 'invalid_parameter_value';
  end if;
  -- A period never reaches past today: the future has no records, and counting it would flatter nothing.
  v_to := least(p_to, v_today);

  if v_portfolio then
    -- thirteen month-ends (the current month ends today): managed, started and ended, by service
    with months as (
      select (date_trunc('month', v_today) - make_interval(months => g))::date as m from generate_series(0, 12) g
    ), mp as (
      select m.service_type, hq_private.mp_start_date(m, v_tz) as started_on, m.ended_on
      from hq.managed_properties m where m.deleted_at is null
    )
    select jsonb_agg(jsonb_build_object(
      'month', mo.m,
      'complete', (mo.m + interval '1 month')::date <= v_today,
      'long_term', jsonb_build_object(
        'managed', (select count(*) from mp where mp.service_type = 'long_term_residential' and mp.started_on <= least((mo.m + interval '1 month - 1 day')::date, v_today) and (mp.ended_on is null or mp.ended_on > least((mo.m + interval '1 month - 1 day')::date, v_today))),
        'started', (select count(*) from mp where mp.service_type = 'long_term_residential' and date_trunc('month', mp.started_on)::date = mo.m),
        'ended', (select count(*) from mp where mp.service_type = 'long_term_residential' and date_trunc('month', mp.ended_on)::date = mo.m)),
      'short_term', jsonb_build_object(
        'managed', (select count(*) from mp where mp.service_type = 'short_term_accommodation' and mp.started_on <= least((mo.m + interval '1 month - 1 day')::date, v_today) and (mp.ended_on is null or mp.ended_on > least((mo.m + interval '1 month - 1 day')::date, v_today))),
        'started', (select count(*) from mp where mp.service_type = 'short_term_accommodation' and date_trunc('month', mp.started_on)::date = mo.m),
        'ended', (select count(*) from mp where mp.service_type = 'short_term_accommodation' and date_trunc('month', mp.ended_on)::date = mo.m))
    ) order by mo.m) into v_series
    from months mo;

    -- the economics of the current portfolio (active and onboarding), from the recorded terms
    with mp as (
      select m.*, hq_private.mp_annual_fee_cents(m) as fee from hq.managed_properties m
      where m.deleted_at is null and m.status in ('active', 'onboarding')
    )
    select jsonb_build_object(
      'long_term', jsonb_build_object(
        'properties', count(*) filter (where service_type = 'long_term_residential'),
        'with_rent', count(*) filter (where service_type = 'long_term_residential' and weekly_rent_cents is not null),
        'average_weekly_rent_cents', round(avg(weekly_rent_cents) filter (where service_type = 'long_term_residential')),
        'with_percent', count(*) filter (where service_type = 'long_term_residential' and fee_percent is not null),
        'average_fee_percent', round(avg(fee_percent) filter (where service_type = 'long_term_residential'), 2),
        'with_fee', count(fee) filter (where service_type = 'long_term_residential'),
        'annual_fees_cents', coalesce(sum(fee) filter (where service_type = 'long_term_residential'), 0)),
      'short_term', jsonb_build_object(
        'properties', count(*) filter (where service_type = 'short_term_accommodation'),
        'with_fee', count(fee) filter (where service_type = 'short_term_accommodation'),
        'with_percent', count(*) filter (where service_type = 'short_term_accommodation' and fee_percent is not null),
        'average_fee_percent', round(avg(fee_percent) filter (where service_type = 'short_term_accommodation'), 2),
        'annual_fees_cents', coalesce(sum(fee) filter (where service_type = 'short_term_accommodation'), 0)),
      'handover_open', (select count(*) from mp where exists (select 1 from hq.property_handover_steps s where s.property_id = mp.id and s.status not in ('done', 'not_applicable'))),
      'ailo_live', count(*) filter (where ailo_status = 'live'),
      'offboarding', (select count(*) from hq.managed_properties x where x.deleted_at is null and x.status = 'offboarding'))
    into v_economics
    from mp;
  end if;

  if v_growth then
    -- the funnel now: every open stage, in order, with value, days in stage and stalled leads
    with stages as (
      select s as stage, row_number() over () as ord from unnest(enum_range(null::hq.opportunity_stage)) s
    ), open_leads as (
      select o.stage, o.estimated_annual_value_cents as value, greatest(0, v_today - (o.stage_changed_at at time zone v_tz)::date) as days,
             o.next_action_due, o.last_activity_at
      from hq.opportunities o where o.deleted_at is null and o.stage not in ('management_signed', 'lost')
    )
    select jsonb_agg(jsonb_build_object(
      'stage', st.stage, 'count', (select count(*) from open_leads l where l.stage = st.stage),
      'value_cents', (select coalesce(sum(l.value), 0) from open_leads l where l.stage = st.stage),
      'with_estimate', (select count(l.value) from open_leads l where l.stage = st.stage),
      'average_days', (select round(avg(l.days), 1) from open_leads l where l.stage = st.stage),
      'stalled', (select count(*) from open_leads l where l.stage = st.stage and l.days >= 21
                    and (l.last_activity_at is null or l.last_activity_at < now() - interval '14 days')),
      'follow_ups_due', (select count(*) from open_leads l where l.stage = st.stage and l.next_action_due <= v_today)
    ) order by st.ord) into v_funnel
    from stages st where st.stage not in ('management_signed', 'lost');

    -- conversion from stage history: how many leads ever reached each stage (furthest stage reached,
    -- lost excluded), all time. The page shows a rate only where enough leads reached the earlier stage.
    with stages as (
      select s as stage, row_number() over () as ord from unnest(enum_range(null::hq.opportunity_stage)) s where s <> 'lost'
    ), furthest as (
      select o.id, max(st.ord) as ord
      from hq.opportunities o
      join lateral (select h.to_stage as stage from hq.opportunity_stage_history h where h.opportunity_id = o.id
                    union all select o.stage) x on true
      join stages st on st.stage = x.stage
      where o.deleted_at is null group by 1
    )
    select jsonb_agg(jsonb_build_object('stage', st.stage, 'reached', (select count(*) from furthest f where f.ord >= st.ord)) order by st.ord)
    into v_conversion from stages st;

    -- partners: relationships needing attention (met, active or referring; quiet 30 days or follow-up overdue)
    with p as (
      select c.id, c.full_name, c.relationship_status, c.last_contact_at, c.next_follow_up_date
      from hq.contacts c
      where c.deleted_at is null and c.contact_kind = 'partner' and c.relationship_status in ('met', 'active_relationship', 'referring_partner')
        and (c.last_contact_at is null or c.last_contact_at < now() - interval '30 days' or c.next_follow_up_date < v_today)
    ), top as (
      select coalesce(r.referring_organisation_id, r.referring_contact_id) as id,
             coalesce(org.name, ct.full_name) as name,
             case when r.referring_organisation_id is not null then 'organisation' else 'contact' end as kind,
             count(*) as received,
             count(*) filter (where o.stage = 'management_signed' and r.is_attributed) as signed
      from hq.referrals r
      left join hq.organisations org on org.id = r.referring_organisation_id
      left join hq.contacts ct on ct.id = r.referring_contact_id
      left join hq.opportunities o on o.id = r.opportunity_id and o.deleted_at is null
      where r.deleted_at is null and r.direction = 'received' and r.referral_date between p_from and v_to
      group by 1, 2, 3
    )
    select jsonb_build_object(
      'needing_attention', (select count(*) from p),
      'attention', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.full_name, 'status', x.relationship_status,
                                    'last_contact_at', x.last_contact_at, 'next_follow_up_date', x.next_follow_up_date)
                                    order by x.relationship_status desc, x.last_contact_at nulls first, x.full_name)
                             from (select * from p order by relationship_status desc, last_contact_at nulls first, full_name limit 5) x), '[]'::jsonb),
      'top_sources', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'kind', t.kind, 'received', t.received, 'signed', t.signed)
                                order by t.received desc, t.signed desc, t.name)
                               from (select * from top order by received desc, signed desc, name limit 5) t), '[]'::jsonb))
    into v_partners;

    -- the last eight weeks (Monday to Sunday; this week so far is the last), for the activity scorecard
    with weeks as (
      select (date_trunc('week', v_today) - make_interval(weeks => g))::date as w from generate_series(0, 7) g
    )
    select jsonb_agg(jsonb_build_object(
      'week', wk.w,
      'complete', wk.w + 6 < v_today,
      'figures', hq_private.ceo_window(wk.w, least(wk.w + 6, v_today), false, true) -> 'growth'
    ) order by wk.w) into v_weeks
    from weeks wk;
  end if;

  select max(t) into v_freshest from (
    select max(updated_at) as t from hq.opportunities where v_growth
    union all select max(created_at) from hq.interactions where v_growth
    union all select max(updated_at) from hq.referrals where v_growth
    union all select max(updated_at) from hq.managed_properties where v_portfolio
  ) f;

  return jsonb_build_object(
    'as_of', v_today,
    'generated_at', now(),
    'latest_change_at', v_freshest,
    'timezone', v_tz,
    'period', hq_private.ceo_window(p_from, v_to, v_portfolio, v_growth),
    'previous', case when p_prev_from is null then null else hq_private.ceo_window(p_prev_from, p_prev_to, v_portfolio, v_growth) end,
    'series', v_series,
    'economics', v_economics,
    'funnel', v_funnel,
    'conversion', v_conversion,
    'partners', v_partners,
    'weeks', v_weeks,
    'targets', (select case when jsonb_typeof(s.value) = 'object' then s.value end from hq.settings s where s.key = 'ceo_weekly_targets'),
    'stall_rule', jsonb_build_object('days_in_stage', 21, 'quiet_days', 14),
    'notes', to_jsonb(array_remove(array[
      case when not v_portfolio then 'Properties are not shown: your role does not include portfolio.read.' end,
      case when not v_growth then 'The pipeline, referrals and activity are not shown: your role does not include growth.read.' end], null)));
end $$;
comment on function hq.ceo_overview(date, date, date, date) is 'growth.read or portfolio.read. The CEO Command Centre figures for a period (clipped to today) and an optional comparison period: portfolio started/ended/managed and contracted fees (portfolio.read); new, qualified, stage entries, signed, lost, referrals, relationship and discovery conversations, website-enquiry response (growth.read). Also the 13-month portfolio series, current economics, the open funnel with days in stage and stalled leads, conversion from stage history, partners needing attention and top sources, eight weeks of activity, and the weekly targets. Counts of records only; estimates are labelled.';

notify pgrst, 'reload schema';
