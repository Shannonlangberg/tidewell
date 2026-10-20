-- 0127_hq_leads_pipeline.sql
-- The sales pipeline runs real landlord leads, not only referral-sourced ones (Planted HQ Day 2).
--
-- WHAT CHANGES
--   hq.opportunities  + source (hq.lead_source; existing rows and record_referral: referral_partner),
--                       next_action (1..300), next_action_due, expected_close_date,
--                       owner_contact_id (the landlord / property owner as a contact),
--                       lost_reason_code (hq.lost_reason, used with the free-text lost_reason),
--                       last_activity_at (the latest call / meeting / note logged on the lead).
--   hq.contacts       + contact_kind (hq.contact_kind: partner | landlord | other; default partner) so a
--                       landlord can be a contact WITHOUT appearing in any partner list or count.
--   hq.interactions   + opportunity_id: a call, meeting or note logged on a lead.
--
-- RULES (database-enforced)
--   * An OPEN lead (any stage but management_signed and lost) has an owner (assigned_to), a next
--     action and a follow-up date (next_action_due). Checked by the opportunity_lead_guard trigger for
--     every writer whenever a lead is created, reopened, restored or one of those three changes. A new
--     row that names none gets the defaults (the caller as owner, "Make first contact", tomorrow), which
--     is how record_referral keeps working unchanged. Existing open rows are backfilled below; a row the
--     backfill could not give an owner (no active creator) is listed by overdue_opportunities.
--   * lost needs lost_reason_code (CHECK) as well as the free-text reason (0102); a code only when lost.
--   * create_opportunity refuses source referral_partner: a partner's introduction is recorded with
--     record_referral, so the partner is credited and a signed management is counted once. A lead with
--     a received referral keeps source referral_partner; one without cannot be given it.
--   * Duplicate guard (create_opportunity): the same email, the same phone number, or the same name in
--     the same suburb as a live lead or a live landlord contact is refused with 23505 and
--     hint 'possible_duplicate' (detail 'opportunity:<id>' or 'contact:<id>'), unless the caller says
--     the person is someone else (p_confirm_distinct).
--   * Stage still moves ONLY through move_opportunity, and signing still only there.
--
-- RPCs (security definer, search_path pinned, growth.write checked inside, MFA through the helpers,
-- audited by the 0105 triggers; execute granted to authenticated only in 0128):
--   create_opportunity, update_opportunity, log_opportunity_activity, move_opportunity (now takes
--   p_lost_reason_code; replaces the 0109 six-argument version), growth_summary (partner contact
--   figures count partner contacts only).
-- VIEWS (security_invoker): opportunity_overview, overdue_opportunities; contact_directory gains
--   contact_kind; referral_partner_overview counts partner contacts only.

-- ------------------------------------------------------------------ enums
create type hq.lead_source as enum ('website_enquiry', 'referral_partner', 'own_marketing', 'direct_approach', 'other');
create type hq.lost_reason as enum ('price', 'chose_another_manager', 'self_managing', 'not_ready', 'unresponsive', 'out_of_area', 'other');
create type hq.contact_kind as enum ('partner', 'landlord', 'other');

-- ------------------------------------------------------------------ contacts: kind
alter table hq.contacts add column contact_kind hq.contact_kind not null default 'partner';
comment on column hq.contacts.contact_kind is 'partner (a referral partner: shown in partner lists and counts), landlord (a property owner or prospect, usually linked to a lead), other. Only partner contacts appear in partner views.';
create index contacts_contact_kind_idx on hq.contacts (contact_kind) where deleted_at is null;

-- ------------------------------------------------------------------ opportunities: lead fields
alter table hq.opportunities
  add column source hq.lead_source not null default 'referral_partner',
  add column next_action text,
  add column next_action_due date,
  add column expected_close_date date,
  add column owner_contact_id uuid references hq.contacts (id),
  add column lost_reason_code hq.lost_reason,
  add column last_activity_at timestamptz;
comment on column hq.opportunities.source is 'Where the lead came from. referral_partner only through record_referral (a received referral credits the partner).';
comment on column hq.opportunities.next_action is 'The next step on an open lead (1 to 300 characters). Required while the lead is open.';
comment on column hq.opportunities.next_action_due is 'When the next step is due (the follow-up date). Required while the lead is open; before hq.today() = overdue.';
comment on column hq.opportunities.owner_contact_id is 'The landlord or property owner as a contact (usually contact_kind landlord).';
comment on column hq.opportunities.lost_reason_code is 'Why a lost lead did not proceed (with the free-text lost_reason). Required when lost, only when lost.';
comment on column hq.opportunities.last_activity_at is 'The latest call, meeting or note logged on the lead (log_opportunity_activity).';

-- Lost leads that predate the code (none on the live project; defensive) are coded "other".
update hq.opportunities set lost_reason_code = 'other' where stage = 'lost' and lost_reason_code is null;

alter table hq.opportunities
  add constraint opportunities_next_action_length check (next_action is null or char_length(btrim(next_action)) between 1 and 300),
  add constraint opportunities_lost_needs_code check (stage <> 'lost' or lost_reason_code is not null),
  add constraint opportunities_lost_code_only_when_lost check (lost_reason_code is null or stage = 'lost'),
  add constraint opportunities_next_action_due_sane check (next_action_due is null or next_action_due >= date '2000-01-01'),
  add constraint opportunities_expected_close_sane check (expected_close_date is null or expected_close_date >= date '2000-01-01');

create index opportunities_source_idx on hq.opportunities (source) where deleted_at is null;
create index opportunities_next_action_due_idx on hq.opportunities (next_action_due) where deleted_at is null;
create index opportunities_owner_contact_id_idx on hq.opportunities (owner_contact_id);

-- Existing open leads get an owner (their creator, when still active staff), a next action and a
-- follow-up date tomorrow, so the rule below holds for them. Runs before the guard exists.
update hq.opportunities o set
  assigned_to = coalesce(o.assigned_to, (
    select sp.id from hq.staff_profiles sp where sp.id = o.created_by and sp.is_active and sp.employment_status = 'active')),
  next_action = coalesce(nullif(btrim(coalesce(o.next_action, '')), ''), 'Make first contact'),
  next_action_due = coalesce(o.next_action_due, hq.today() + 1)
where o.stage not in ('management_signed', 'lost')
  and (o.assigned_to is null or o.next_action is null or o.next_action_due is null);

-- ------------------------------------------------------------------ the open-lead rule (every writer)
create function hq_private.opportunity_lead_guard() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_open boolean := new.stage not in ('management_signed', 'lost');
begin
  new.next_action := nullif(btrim(coalesce(new.next_action, '')), '');
  if tg_op = 'INSERT' and v_open then
    -- a writer that names no owner or next step (record_referral, a website enquiry) gets the defaults
    new.assigned_to := coalesce(new.assigned_to, hq_private.current_staff_id());
    new.next_action := coalesce(new.next_action, 'Make first contact');
    new.next_action_due := coalesce(new.next_action_due, hq.today() + 1);
  end if;
  if v_open and new.deleted_at is null
     and (tg_op = 'INSERT'
          or new.stage is distinct from old.stage
          or old.deleted_at is not null
          or new.assigned_to is distinct from old.assigned_to
          or new.next_action is distinct from old.next_action
          or new.next_action_due is distinct from old.next_action_due) then
    if new.assigned_to is null or new.next_action is null or new.next_action_due is null then
      raise exception 'an open lead needs an owner, a next action and a follow-up date'
        using errcode = 'check_violation', hint = 'lead_needs_next_step';
    end if;
  end if;
  return new;
end $$;
create trigger lead_guard before insert or update on hq.opportunities for each row execute function hq_private.opportunity_lead_guard();

-- ------------------------------------------------------------------ interactions on a lead
alter table hq.interactions add column opportunity_id uuid references hq.opportunities (id);
alter table hq.interactions drop constraint interactions_needs_subject;
alter table hq.interactions add constraint interactions_needs_subject
  check (contact_id is not null or organisation_id is not null or contractor_id is not null or opportunity_id is not null);
alter table hq.interactions add constraint interactions_opportunity_not_contractor check (opportunity_id is null or contractor_id is null);
create index interactions_opportunity_id_idx on hq.interactions (opportunity_id, occurred_at desc);
comment on table hq.interactions is 'Calls, meetings, emails and notes with a contact or organisation (hq.record_interaction), with a contractor (hq.record_contractor_contact) or on a lead (hq.log_opportunity_activity: opportunity_id, and the landlord contact when there is one).';

-- ------------------------------------------------------------------ views
-- contact_directory: + contact_kind (appended, so the view is replaced in place).
create or replace view hq.contact_directory with (security_invoker = true) as
select
  c.id,
  c.organisation_id,
  o.name as organisation_name,
  c.full_name,
  c.position,
  c.categories,
  c.phone,
  c.email,
  c.website,
  c.location,
  c.service_region,
  c.org_contact_role,
  c.relationship_owner_id,
  ro.full_name as relationship_owner_name,
  c.relationship_status,
  c.priority,
  c.last_contact_at,
  c.next_follow_up_date,
  (c.next_follow_up_date is not null and c.next_follow_up_date < hq.today() and c.relationship_status <> 'inactive') as follow_up_overdue,
  c.notes,
  c.source,
  c.needs_verification,
  c.verified_at,
  c.created_at,
  c.updated_at,
  (select count(*) from hq.referrals r
    where r.referring_contact_id = c.id and r.direction = 'received' and r.deleted_at is null) as referrals_received,
  (select count(*) from hq.referrals r
    where r.receiving_contact_id = c.id and r.direction = 'sent' and r.deleted_at is null) as referrals_sent,
  c.contact_kind
from hq.contacts c
left join hq.organisations o on o.id = c.organisation_id
left join hq.staff_profiles ro on ro.id = c.relationship_owner_id
where c.deleted_at is null;
comment on view hq.contact_directory is 'Live contacts of every kind with organisation and owner names, an overdue flag, referral counts and contact_kind (filter contact_kind = partner for the partner CRM). security_invoker.';

-- referral_partner_overview (0122): identical, except that only PARTNER contacts are partners or are
-- counted towards a partner (independent rows, contact counts, primary contact, status, follow-ups).
-- Every existing contact is a partner contact, so no figure changes for partner data.
create or replace view hq.referral_partner_overview with (security_invoker = true) as
with cfg as (
  select
    hq.today() as today,
    coalesce((select s.value #>> '{}' from hq.settings s where s.key = 'timezone'), 'Australia/Adelaide') as tz
),
reached_qualified as (
  select o.id as opportunity_id
  from hq.opportunities o
  where o.deleted_at is null
    and (
      o.stage in ('qualified', 'appraisal_requested', 'appraisal_completed', 'proposal_sent', 'management_signed')
      or exists (
        select 1 from hq.opportunity_stage_history h
        where h.opportunity_id = o.id
          and h.to_stage in ('qualified', 'appraisal_requested', 'appraisal_completed', 'proposal_sent', 'management_signed')
      )
    )
),
org_rows as (
  select
    'organisation'::text as partner_kind,
    org.id,
    org.id as organisation_id,
    null::uuid as contact_id,
    org.name,
    org.categories,
    org.relationship_owner_id,
    ro.full_name as relationship_owner_name,
    pc.id as primary_contact_id,
    pc.full_name as primary_contact_name,
    pc.phone as primary_contact_phone,
    pc.email as primary_contact_email,
    coalesce(cs.contact_count, 0)::bigint as contact_count,
    greatest(cs.last_contact_at, ia.last_at) as last_contacted_at,
    least(cs.next_follow_up_date, ofu.follow_up_date) as next_follow_up_date,
    case when cs.live_status is not null then cs.live_status else cs.any_status end as relationship_status,
    org.needs_verification,
    pp.received as referrals_received,
    pp.sent as referrals_sent,
    pp.qualified as referrals_qualified,
    pp.signed as managements_signed,
    pp.conversion,
    pp.estimated_value_signed_cents,
    pp.reciprocal,
    lr.last_referral_date
  from hq.organisations org
  join hq.partner_performance pp on pp.organisation_id = org.id
  left join hq.staff_profiles ro on ro.id = org.relationship_owner_id
  left join lateral (
    select
      count(*) as contact_count,
      max(c.last_contact_at) as last_contact_at,
      min(c.next_follow_up_date) filter (where c.relationship_status <> 'inactive') as next_follow_up_date,
      max(c.relationship_status) filter (where c.relationship_status <> 'inactive') as live_status,
      max(c.relationship_status) as any_status
    from hq.contacts c where c.organisation_id = org.id and c.deleted_at is null and c.contact_kind = 'partner'
  ) cs on true
  left join lateral (
    select c.id, c.full_name, c.phone, c.email
    from hq.contacts c
    where c.organisation_id = org.id and c.org_contact_role = 'primary' and c.deleted_at is null and c.contact_kind = 'partner'
    limit 1
  ) pc on true
  left join lateral (
    select max(i.occurred_at) as last_at
    from hq.interactions i where i.organisation_id = org.id and i.deleted_at is null
  ) ia on true
  left join lateral (
    select min(i.follow_up_date) as follow_up_date
    from hq.interactions i
    where i.organisation_id = org.id and i.contact_id is null and i.deleted_at is null and i.follow_up_date is not null
      and not exists (
        select 1 from hq.interactions j
        where j.organisation_id = org.id and j.deleted_at is null and j.occurred_at > i.occurred_at
      )
  ) ofu on true
  left join lateral (
    select max(r.referral_date) as last_referral_date
    from hq.referrals r
    where r.deleted_at is null
      and ((r.direction = 'received' and r.referring_organisation_id = org.id)
        or (r.direction = 'sent' and r.receiving_organisation_id = org.id))
  ) lr on true
  where org.deleted_at is null
),
independent_rows as (
  select
    'independent'::text as partner_kind,
    c.id,
    null::uuid as organisation_id,
    c.id as contact_id,
    c.full_name as name,
    c.categories,
    c.relationship_owner_id,
    ro.full_name as relationship_owner_name,
    c.id as primary_contact_id,
    c.full_name as primary_contact_name,
    c.phone as primary_contact_phone,
    c.email as primary_contact_email,
    1::bigint as contact_count,
    greatest(c.last_contact_at, ia.last_at) as last_contacted_at,
    case when c.relationship_status <> 'inactive' then c.next_follow_up_date end as next_follow_up_date,
    c.relationship_status,
    c.needs_verification,
    coalesce(rec.n, 0)::bigint as referrals_received,
    coalesce(snt.n, 0)::bigint as referrals_sent,
    coalesce(q.n, 0)::bigint as referrals_qualified,
    coalesce(sg.n, 0)::bigint as managements_signed,
    case when coalesce(rec.n, 0) = 0 then null else round(coalesce(sg.n, 0)::numeric / rec.n, 4) end as conversion,
    coalesce(sg.value, 0)::bigint as estimated_value_signed_cents,
    (coalesce(rec.n, 0) > 0 and coalesce(snt.n, 0) > 0) as reciprocal,
    greatest(rec.last_date, snt.last_date) as last_referral_date
  from hq.contacts c
  left join hq.staff_profiles ro on ro.id = c.relationship_owner_id
  left join lateral (
    select max(i.occurred_at) as last_at
    from hq.interactions i where i.contact_id = c.id and i.deleted_at is null
  ) ia on true
  left join lateral (
    select count(*) as n, max(r.referral_date) as last_date
    from hq.referrals r
    where r.direction = 'received' and r.deleted_at is null and r.referring_contact_id = c.id and r.referring_organisation_id is null
  ) rec on true
  left join lateral (
    select count(*) as n, max(r.referral_date) as last_date
    from hq.referrals r
    where r.direction = 'sent' and r.deleted_at is null and r.receiving_contact_id = c.id and r.receiving_organisation_id is null
  ) snt on true
  left join lateral (
    select count(*) as n
    from hq.referrals r join reached_qualified rq on rq.opportunity_id = r.opportunity_id
    where r.direction = 'received' and r.is_attributed and r.deleted_at is null
      and r.referring_contact_id = c.id and r.referring_organisation_id is null
  ) q on true
  left join lateral (
    select count(*) as n, sum(o.estimated_annual_value_cents) as value
    from hq.referrals r join hq.opportunities o on o.id = r.opportunity_id
    where r.direction = 'received' and r.is_attributed and r.deleted_at is null
      and r.referring_contact_id = c.id and r.referring_organisation_id is null
      and o.deleted_at is null and o.stage = 'management_signed'
  ) sg on true
  where c.deleted_at is null and c.organisation_id is null and c.contact_kind = 'partner'
),
all_rows as (
  select * from org_rows
  union all
  select * from independent_rows
)
select
  a.partner_kind,
  a.id,
  a.organisation_id,
  a.contact_id,
  a.name,
  a.categories,
  a.relationship_owner_id,
  a.relationship_owner_name,
  a.primary_contact_id,
  a.primary_contact_name,
  a.primary_contact_phone,
  a.primary_contact_email,
  a.contact_count,
  a.last_contacted_at,
  case when a.last_contacted_at is null then null
       else greatest(0, cfg.today - (a.last_contacted_at at time zone cfg.tz)::date) end as days_since_contact,
  a.next_follow_up_date,
  (a.next_follow_up_date is not null and a.next_follow_up_date < cfg.today) as follow_up_overdue,
  a.relationship_status,
  a.needs_verification,
  a.referrals_received,
  a.referrals_sent,
  a.referrals_qualified,
  a.managements_signed,
  a.conversion,
  a.estimated_value_signed_cents,
  a.reciprocal,
  a.last_referral_date
from all_rows a
cross join cfg;
comment on view hq.referral_partner_overview is 'One row per live referral partner (organisation, or independent PARTNER contact with no organisation): last contacted, next follow-up, most advanced status, and referral figures read from partner_performance (independents by the same rules). Landlord and other contacts are never partners. security_invoker.';

-- One row per live lead: the pipeline board, the lead's page and the MCP tools read this.
create view hq.opportunity_overview with (security_invoker = true) as
with cfg as (
  select
    hq.today() as today,
    coalesce((select s.value #>> '{}' from hq.settings s where s.key = 'timezone'), 'Australia/Adelaide') as tz
)
select
  o.id,
  o.display_number,
  'LEAD-' || lpad(o.display_number::text, greatest(4, length(o.display_number::text)), '0') as ref,
  o.prospect_name,
  o.prospect_phone,
  o.prospect_email,
  o.property_suburb,
  o.property_address,
  o.stage,
  o.stage_changed_at,
  greatest(0, cfg.today - (o.stage_changed_at at time zone cfg.tz)::date) as days_in_stage,
  (o.stage not in ('management_signed', 'lost')) as is_open,
  o.source,
  o.assigned_to,
  asg.full_name as assigned_to_name,
  o.next_action,
  o.next_action_due,
  (o.stage not in ('management_signed', 'lost') and o.next_action_due is not null and o.next_action_due < cfg.today) as next_action_overdue,
  (o.stage not in ('management_signed', 'lost')
    and (o.assigned_to is null or o.next_action is null or o.next_action_due is null or o.next_action_due < cfg.today)) as needs_attention,
  o.expected_close_date,
  o.estimated_annual_value_cents,
  o.last_activity_at,
  o.owner_contact_id,
  oc.full_name as owner_contact_name,
  o.signed_at,
  o.management_reference,
  o.lost_reason,
  o.lost_reason_code,
  o.notes,
  cr.id as credited_referral_id,
  case when cr.id is not null then 'REF-' || lpad(cr.ref_number::text, 4, '0') end as credited_ref_label,
  cr.referring_organisation_id as partner_organisation_id,
  po.name as partner_organisation_name,
  cr.referring_contact_id as partner_contact_id,
  pcn.full_name as partner_contact_name,
  coalesce(cl.n, 0)::bigint as other_claims,
  o.created_at,
  o.created_by,
  o.updated_at
from hq.opportunities o
cross join cfg
left join hq.staff_profiles asg on asg.id = o.assigned_to
left join hq.contacts oc on oc.id = o.owner_contact_id and oc.deleted_at is null
left join lateral (
  select r.id, r.ref_number, r.referring_organisation_id, r.referring_contact_id
  from hq.referrals r
  where r.opportunity_id = o.id and r.direction = 'received' and r.is_attributed and r.deleted_at is null
  limit 1
) cr on true
left join hq.organisations po on po.id = cr.referring_organisation_id
left join hq.contacts pcn on pcn.id = cr.referring_contact_id
left join lateral (
  select count(*) as n from hq.referrals r
  where r.opportunity_id = o.id and r.direction = 'received' and not r.is_attributed and r.deleted_at is null
) cl on true
where o.deleted_at is null;
comment on view hq.opportunity_overview is 'One row per live lead (opportunity): LEAD-0001 ref, prospect, stage and days in it, source, owner (assigned_to) name, next action and due, overdue and needs-attention flags, expected close, estimate, last activity, landlord contact, the credited partner (if a referral introduced it) and other claims. security_invoker: names need people.read / growth.read.';

-- Open leads that need attention: no owner, no next action or follow-up date, the follow-up date has
-- passed, or the owner has left. The date is the configured timezone's (hq.today()): a lead due today
-- is not overdue; due yesterday is 1 day overdue.
create view hq.overdue_opportunities with (security_invoker = true) as
select
  o.id as opportunity_id,
  o.display_number,
  'LEAD-' || lpad(o.display_number::text, greatest(4, length(o.display_number::text)), '0') as ref,
  o.prospect_name,
  o.property_suburb,
  o.stage,
  o.source,
  o.assigned_to,
  asg.full_name as assigned_to_name,
  o.next_action,
  o.next_action_due,
  case when o.next_action_due < hq.today() then hq.today() - o.next_action_due else 0 end as days_overdue,
  (o.assigned_to is null) as missing_owner,
  (o.next_action is null or o.next_action_due is null) as missing_next_action,
  (o.next_action_due is not null and o.next_action_due < hq.today()) as overdue,
  (o.assigned_to is not null and asg.id is not null and not (asg.is_active and asg.employment_status = 'active')) as owner_inactive,
  case
    when o.assigned_to is null then 'no_owner'
    when asg.id is not null and not (asg.is_active and asg.employment_status = 'active') then 'owner_inactive'
    when o.next_action is null or o.next_action_due is null then 'no_next_action'
    else 'overdue'
  end as reason,
  o.last_activity_at
from hq.opportunities o
left join hq.staff_profiles asg on asg.id = o.assigned_to
where o.deleted_at is null
  and o.stage not in ('management_signed', 'lost')
  and (
    o.assigned_to is null
    or o.next_action is null
    or o.next_action_due is null
    or o.next_action_due < hq.today()
    or (asg.id is not null and not (asg.is_active and asg.employment_status = 'active'))
  );
comment on view hq.overdue_opportunities is 'Live open leads needing attention: no owner, owner left, no next action / follow-up date, or the follow-up date is before hq.today(). reason is the first that applies. security_invoker.';

revoke all on hq.contact_directory, hq.referral_partner_overview, hq.opportunity_overview, hq.overdue_opportunities
  from public, anon, authenticated, service_role;
grant select on hq.contact_directory, hq.referral_partner_overview, hq.opportunity_overview, hq.overdue_opportunities
  to authenticated, service_role;

-- ------------------------------------------------------------------ RPC helpers (not granted to any API role)
create function hq_private.lead_ref(p_n bigint) returns text
language sql immutable parallel safe set search_path = pg_catalog as $$
  select 'LEAD-' || lpad(p_n::text, greatest(4, length(p_n::text)), '0')
$$;

-- A phone number as digits, Australian +61 written as 0: "0400 000 000" and "+61 400 000 000" match.
create function hq_private.lead_phone_key(p_phone text) returns text
language sql immutable parallel safe set search_path = pg_catalog as $$
  select case
    when d = '' then null
    when d ~ '^61[0-9]{9}$' then '0' || substr(d, 3)
    else d end
  from (select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as d) x
$$;

-- Text a person typed: trimmed, blank = null, bounded (22023 with a plain message).
create function hq_private.lead_text(p_value text, p_max integer, p_what text) returns text
language plpgsql immutable set search_path = pg_catalog as $$
declare
  v text := nullif(btrim(coalesce(p_value, '')), '');
begin
  if v is not null and char_length(v) > p_max then
    raise exception '% is at most % characters', p_what, p_max using errcode = 'invalid_parameter_value';
  end if;
  return v;
end $$;

create function hq_private.lead_check_contact_details(p_phone text, p_email text) returns void
language plpgsql immutable set search_path = pg_catalog as $$
declare
  v_digits integer := char_length(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'));
begin
  if p_phone is not null and (p_phone !~ '^[0-9 ()+.-]+$' or v_digits < 8 or v_digits > 15) then
    raise exception 'that does not look like a phone number' using errcode = 'invalid_parameter_value';
  end if;
  if p_email is not null and (char_length(p_email) > 254 or p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    raise exception 'that does not look like an email address' using errcode = 'invalid_parameter_value';
  end if;
end $$;

-- The first live lead or live landlord contact that looks like the same person: {kind, id, reason}, or null.
create function hq_private.lead_duplicate(p_name text, p_phone text, p_email text, p_suburb text, p_except uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_key text := hq_private.normalise_name(p_name);
  v_phone text := hq_private.lead_phone_key(p_phone);
  v_email text := lower(nullif(btrim(coalesce(p_email, '')), ''));
  v_suburb text := lower(nullif(btrim(coalesce(p_suburb, '')), ''));
  v_id uuid;
begin
  if v_email is not null then
    select o.id into v_id from hq.opportunities o
    where o.deleted_at is null and o.id is distinct from p_except and lower(o.prospect_email::text) = v_email limit 1;
    if found then return jsonb_build_object('kind', 'opportunity', 'id', v_id, 'reason', 'email'); end if;
    select c.id into v_id from hq.contacts c
    where c.deleted_at is null and c.contact_kind = 'landlord' and lower(c.email::text) = v_email limit 1;
    if found then return jsonb_build_object('kind', 'contact', 'id', v_id, 'reason', 'email'); end if;
  end if;
  if v_phone is not null then
    select o.id into v_id from hq.opportunities o
    where o.deleted_at is null and o.id is distinct from p_except and hq_private.lead_phone_key(o.prospect_phone) = v_phone limit 1;
    if found then return jsonb_build_object('kind', 'opportunity', 'id', v_id, 'reason', 'phone'); end if;
    select c.id into v_id from hq.contacts c
    where c.deleted_at is null and c.contact_kind = 'landlord' and hq_private.lead_phone_key(c.phone) = v_phone limit 1;
    if found then return jsonb_build_object('kind', 'contact', 'id', v_id, 'reason', 'phone'); end if;
  end if;
  if v_key <> '' and v_suburb is not null then
    select o.id into v_id from hq.opportunities o
    where o.deleted_at is null and o.id is distinct from p_except
      and hq_private.normalise_name(o.prospect_name) = v_key and lower(btrim(o.property_suburb)) = v_suburb limit 1;
    if found then return jsonb_build_object('kind', 'opportunity', 'id', v_id, 'reason', 'name_suburb'); end if;
    select c.id into v_id from hq.contacts c
    where c.deleted_at is null and c.contact_kind = 'landlord' and c.name_key = v_key and lower(btrim(c.location)) = v_suburb limit 1;
    if found then return jsonb_build_object('kind', 'contact', 'id', v_id, 'reason', 'name_suburb'); end if;
  end if;
  return null;
end $$;

create function hq_private.lead_json(p_o hq.opportunities) returns jsonb
language sql stable set search_path = pg_catalog, public, extensions as $$
  select jsonb_build_object(
    'opportunity_id', p_o.id, 'ref', hq_private.lead_ref(p_o.display_number), 'display_number', p_o.display_number,
    'prospect_name', p_o.prospect_name, 'stage', p_o.stage, 'source', p_o.source, 'assigned_to', p_o.assigned_to,
    'next_action', p_o.next_action, 'next_action_due', p_o.next_action_due, 'expected_close_date', p_o.expected_close_date,
    'estimated_annual_value_cents', p_o.estimated_annual_value_cents, 'owner_contact_id', p_o.owner_contact_id,
    'updated_at', p_o.updated_at)
$$;

-- ------------------------------------------------------------------ create_opportunity
-- A lead that did not come through a referral partner (website, own marketing, a direct approach).
-- Creates the prospect as a landlord contact (flagged needs_verification) when p_create_contact, or
-- links the existing contact that already uses the email. Returns the lead json plus
-- {owner_contact_id, contact_created, changed}.
create function hq.create_opportunity(
  p_prospect_name text,
  p_prospect_phone text default null,
  p_prospect_email text default null,
  p_property_suburb text default null,
  p_property_address text default null,
  p_source hq.lead_source default null,
  p_assigned_to uuid default null,
  p_next_action text default null,
  p_next_action_due date default null,
  p_expected_close_date date default null,
  p_estimated_annual_value_cents bigint default null,
  p_notes text default null,
  p_create_contact boolean default true,
  p_confirm_distinct boolean default false
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_caller uuid := hq_private.require_staff();
  v_today date;
  v_name text;
  v_phone text;
  v_email text;
  v_suburb text;
  v_address text;
  v_action text;
  v_notes text;
  v_owner uuid;
  v_dup jsonb;
  v_contact uuid;
  v_created boolean := false;
  v_o hq.opportunities;
begin
  perform hq_private.require_capability('growth.write');
  v_today := hq.today();
  v_name := hq_private.lead_text(p_prospect_name, 200, 'a name');
  if v_name is null then
    raise exception 'a lead needs the person''s name' using errcode = 'invalid_parameter_value';
  end if;
  v_phone := hq_private.lead_text(p_prospect_phone, 40, 'a phone number');
  v_email := lower(hq_private.lead_text(p_prospect_email, 254, 'an email address'));
  perform hq_private.lead_check_contact_details(v_phone, v_email);
  v_suburb := hq_private.lead_text(p_property_suburb, 120, 'a suburb');
  v_address := hq_private.lead_text(p_property_address, 300, 'an address');
  v_notes := hq_private.lead_text(p_notes, 2000, 'the notes');
  if p_source is null then
    raise exception 'say where the lead came from' using errcode = 'invalid_parameter_value';
  end if;
  if p_source = 'referral_partner' then
    raise exception 'a lead from a referral partner is recorded as a received referral, so the partner is credited'
      using errcode = 'invalid_parameter_value', hint = 'use_record_referral';
  end if;
  v_action := hq_private.lead_text(p_next_action, 300, 'the next action');
  if v_action is null then
    raise exception 'a lead needs a next action' using errcode = 'invalid_parameter_value';
  end if;
  if p_next_action_due is null then
    raise exception 'a lead needs a follow-up date' using errcode = 'invalid_parameter_value';
  end if;
  if p_next_action_due < v_today or p_next_action_due > v_today + 730 then
    raise exception 'the follow-up date must be from today to two years ahead' using errcode = 'invalid_parameter_value';
  end if;
  if p_expected_close_date is not null and (p_expected_close_date < v_today or p_expected_close_date > v_today + 1095) then
    raise exception 'the expected close date must be from today to three years ahead' using errcode = 'invalid_parameter_value';
  end if;
  if p_estimated_annual_value_cents is not null and (p_estimated_annual_value_cents < 0 or p_estimated_annual_value_cents > 10000000000) then
    raise exception 'the estimated yearly value must be from 0 to 100 million dollars' using errcode = 'invalid_parameter_value';
  end if;
  v_owner := coalesce(p_assigned_to, v_caller);
  perform hq_private.require_active_staff(v_owner, 'the lead owner');

  if not coalesce(p_confirm_distinct, false) then
    v_dup := hq_private.lead_duplicate(v_name, v_phone, v_email, v_suburb);
    if v_dup is not null then
      raise exception 'a lead or landlord with these details is already in HQ'
        using errcode = 'unique_violation', hint = 'possible_duplicate', detail = (v_dup ->> 'kind') || ':' || (v_dup ->> 'id') || ':' || (v_dup ->> 'reason');
    end if;
  end if;

  if coalesce(p_create_contact, true) then
    -- A contact that already uses this email is the same person: link it rather than fail on the unique email.
    if v_email is not null then
      select c.id into v_contact from hq.contacts c where c.deleted_at is null and lower(c.email::text) = v_email limit 1;
    end if;
    if v_contact is null then
      insert into hq.contacts (full_name, phone, email, location, contact_kind, categories, relationship_owner_id, needs_verification, source)
      values (v_name, v_phone, v_email, v_suburb, 'landlord', '{}', v_owner, true, 'Lead (' || replace(p_source::text, '_', ' ') || ')')
      returning id into v_contact;
      v_created := true;
    end if;
  end if;

  insert into hq.opportunities (
    prospect_name, prospect_phone, prospect_email, property_suburb, property_address, source, assigned_to,
    next_action, next_action_due, expected_close_date, estimated_annual_value_cents, notes, owner_contact_id)
  values (
    v_name, v_phone, v_email, v_suburb, v_address, p_source, v_owner,
    v_action, p_next_action_due, p_expected_close_date, p_estimated_annual_value_cents, v_notes, v_contact)
  returning * into v_o;

  return hq_private.lead_json(v_o) || jsonb_build_object('contact_created', v_created, 'changed', true);
end $$;
comment on function hq.create_opportunity(text, text, text, text, text, hq.lead_source, uuid, text, date, date, bigint, text, boolean, boolean) is 'growth.write. Adds a lead that did not come through a referral partner (source website_enquiry | own_marketing | direct_approach | other; referral_partner is refused: use record_referral). Needs the name, a next action and a follow-up date (today to 2 years ahead); owner defaults to the caller (active staff). Creates the person as a landlord contact (needs_verification) or links the contact already using the email. Duplicate guard: same email, phone, or name in the same suburb as a live lead or landlord contact -> 23505 hint possible_duplicate, detail kind:id:reason, unless p_confirm_distinct. Returns the lead json plus {contact_created, changed}.';

-- ------------------------------------------------------------------ update_opportunity
-- Patch: a null argument leaves that field; p_clear names optional fields to empty
-- (prospect_phone, prospect_email, property_suburb, property_address, expected_close_date,
-- estimated_annual_value, notes, owner_contact). Stage and signing are NOT here (move_opportunity).
-- Nothing to change: {changed: false}, nothing written. p_expected_updated_at refuses a stale edit.
create function hq.update_opportunity(
  p_opportunity uuid,
  p_prospect_name text default null,
  p_prospect_phone text default null,
  p_prospect_email text default null,
  p_property_suburb text default null,
  p_property_address text default null,
  p_source hq.lead_source default null,
  p_assigned_to uuid default null,
  p_next_action text default null,
  p_next_action_due date default null,
  p_expected_close_date date default null,
  p_estimated_annual_value_cents bigint default null,
  p_notes text default null,
  p_owner_contact uuid default null,
  p_clear text[] default null,
  p_expected_updated_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_today date;
  v_cur hq.opportunities;
  v_new hq.opportunities;
  v_clear text[] := coalesce(p_clear, '{}');
  v_bad text;
  v_has_referral boolean;
  v_changed text[] := '{}';
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('growth.write');
  v_today := hq.today();
  select v.x into v_bad from unnest(v_clear) v(x)
  where v.x not in ('prospect_phone', 'prospect_email', 'property_suburb', 'property_address', 'expected_close_date', 'estimated_annual_value', 'notes', 'owner_contact')
  limit 1;
  if v_bad is not null then
    raise exception 'that field cannot be cleared: %', left(v_bad, 40) using errcode = 'invalid_parameter_value';
  end if;

  select o.* into v_cur from hq.opportunities o where o.id = p_opportunity and o.deleted_at is null for update;
  if not found then
    raise exception 'opportunity not found' using errcode = 'no_data_found';
  end if;
  if p_expected_updated_at is not null and v_cur.updated_at <> p_expected_updated_at then
    raise exception 'this lead was changed by someone else; reload it and try again' using errcode = 'check_violation', hint = 'lead_stale';
  end if;

  v_new := v_cur;
  if p_prospect_name is not null then
    v_new.prospect_name := hq_private.lead_text(p_prospect_name, 200, 'a name');
    if v_new.prospect_name is null then
      raise exception 'a lead needs the person''s name' using errcode = 'invalid_parameter_value';
    end if;
  end if;
  if p_prospect_phone is not null then v_new.prospect_phone := hq_private.lead_text(p_prospect_phone, 40, 'a phone number'); end if;
  if p_prospect_email is not null then v_new.prospect_email := lower(hq_private.lead_text(p_prospect_email, 254, 'an email address')); end if;
  if p_property_suburb is not null then v_new.property_suburb := hq_private.lead_text(p_property_suburb, 120, 'a suburb'); end if;
  if p_property_address is not null then v_new.property_address := hq_private.lead_text(p_property_address, 300, 'an address'); end if;
  if p_notes is not null then v_new.notes := hq_private.lead_text(p_notes, 2000, 'the notes'); end if;
  if 'prospect_phone' = any (v_clear) then v_new.prospect_phone := null; end if;
  if 'prospect_email' = any (v_clear) then v_new.prospect_email := null; end if;
  if 'property_suburb' = any (v_clear) then v_new.property_suburb := null; end if;
  if 'property_address' = any (v_clear) then v_new.property_address := null; end if;
  if 'notes' = any (v_clear) then v_new.notes := null; end if;
  perform hq_private.lead_check_contact_details(v_new.prospect_phone, v_new.prospect_email::text);

  if p_source is not null and p_source is distinct from v_cur.source then
    v_has_referral := exists (select 1 from hq.referrals r where r.opportunity_id = v_cur.id and r.direction = 'received' and r.deleted_at is null);
    if v_has_referral then
      raise exception 'this lead was introduced by a referral partner, so its source stays referral partner'
        using errcode = 'invalid_parameter_value', hint = 'source_is_referral';
    end if;
    if p_source = 'referral_partner' then
      raise exception 'a lead from a referral partner is recorded as a received referral, so the partner is credited'
        using errcode = 'invalid_parameter_value', hint = 'use_record_referral';
    end if;
    v_new.source := p_source;
  end if;

  if p_assigned_to is not null and p_assigned_to is distinct from v_cur.assigned_to then
    perform hq_private.require_active_staff(p_assigned_to, 'the lead owner');
    v_new.assigned_to := p_assigned_to;
  end if;
  if p_next_action is not null then
    v_new.next_action := hq_private.lead_text(p_next_action, 300, 'the next action');
    if v_new.next_action is null then
      raise exception 'a lead needs a next action' using errcode = 'invalid_parameter_value';
    end if;
  end if;
  if p_next_action_due is not null and p_next_action_due is distinct from v_cur.next_action_due then
    if p_next_action_due < v_today or p_next_action_due > v_today + 730 then
      raise exception 'the follow-up date must be from today to two years ahead' using errcode = 'invalid_parameter_value';
    end if;
    v_new.next_action_due := p_next_action_due;
  end if;
  if p_expected_close_date is not null and p_expected_close_date is distinct from v_cur.expected_close_date then
    if p_expected_close_date < v_today or p_expected_close_date > v_today + 1095 then
      raise exception 'the expected close date must be from today to three years ahead' using errcode = 'invalid_parameter_value';
    end if;
    v_new.expected_close_date := p_expected_close_date;
  end if;
  if 'expected_close_date' = any (v_clear) then v_new.expected_close_date := null; end if;
  if p_estimated_annual_value_cents is not null then
    if p_estimated_annual_value_cents < 0 or p_estimated_annual_value_cents > 10000000000 then
      raise exception 'the estimated yearly value must be from 0 to 100 million dollars' using errcode = 'invalid_parameter_value';
    end if;
    v_new.estimated_annual_value_cents := p_estimated_annual_value_cents;
  end if;
  if 'estimated_annual_value' = any (v_clear) then v_new.estimated_annual_value_cents := null; end if;
  if p_owner_contact is not null and p_owner_contact is distinct from v_cur.owner_contact_id then
    if not exists (select 1 from hq.contacts c where c.id = p_owner_contact and c.deleted_at is null) then
      raise exception 'contact not found' using errcode = 'no_data_found';
    end if;
    v_new.owner_contact_id := p_owner_contact;
  end if;
  if 'owner_contact' = any (v_clear) then v_new.owner_contact_id := null; end if;

  if v_new.prospect_name is distinct from v_cur.prospect_name then v_changed := v_changed || 'prospect_name'::text; end if;
  if v_new.prospect_phone is distinct from v_cur.prospect_phone then v_changed := v_changed || 'prospect_phone'::text; end if;
  if v_new.prospect_email is distinct from v_cur.prospect_email then v_changed := v_changed || 'prospect_email'::text; end if;
  if v_new.property_suburb is distinct from v_cur.property_suburb then v_changed := v_changed || 'property_suburb'::text; end if;
  if v_new.property_address is distinct from v_cur.property_address then v_changed := v_changed || 'property_address'::text; end if;
  if v_new.source is distinct from v_cur.source then v_changed := v_changed || 'source'::text; end if;
  if v_new.assigned_to is distinct from v_cur.assigned_to then v_changed := v_changed || 'assigned_to'::text; end if;
  if v_new.next_action is distinct from v_cur.next_action then v_changed := v_changed || 'next_action'::text; end if;
  if v_new.next_action_due is distinct from v_cur.next_action_due then v_changed := v_changed || 'next_action_due'::text; end if;
  if v_new.expected_close_date is distinct from v_cur.expected_close_date then v_changed := v_changed || 'expected_close_date'::text; end if;
  if v_new.estimated_annual_value_cents is distinct from v_cur.estimated_annual_value_cents then v_changed := v_changed || 'estimated_annual_value_cents'::text; end if;
  if v_new.notes is distinct from v_cur.notes then v_changed := v_changed || 'notes'::text; end if;
  if v_new.owner_contact_id is distinct from v_cur.owner_contact_id then v_changed := v_changed || 'owner_contact_id'::text; end if;

  if cardinality(v_changed) = 0 then
    return hq_private.lead_json(v_cur) || jsonb_build_object('changed', false, 'changed_fields', '[]'::jsonb);
  end if;

  update hq.opportunities set
    prospect_name = v_new.prospect_name, prospect_phone = v_new.prospect_phone, prospect_email = v_new.prospect_email,
    property_suburb = v_new.property_suburb, property_address = v_new.property_address, source = v_new.source,
    assigned_to = v_new.assigned_to, next_action = v_new.next_action, next_action_due = v_new.next_action_due,
    expected_close_date = v_new.expected_close_date, estimated_annual_value_cents = v_new.estimated_annual_value_cents,
    notes = v_new.notes, owner_contact_id = v_new.owner_contact_id
  where id = v_cur.id
  returning * into v_new;
  return hq_private.lead_json(v_new) || jsonb_build_object('changed', true, 'changed_fields', to_jsonb(v_changed));
end $$;
comment on function hq.update_opportunity(uuid, text, text, text, text, text, hq.lead_source, uuid, text, date, date, bigint, text, uuid, text[], timestamptz) is 'growth.write. Edits one live lead (null leaves a field; p_clear empties optional fields: prospect_phone, prospect_email, property_suburb, property_address, expected_close_date, estimated_annual_value, notes, owner_contact). Owner must be active staff; follow-up date today to 2 years ahead; expected close today to 3 years ahead; source cannot become or stop being referral_partner. Stage and signing only through move_opportunity. Returns the lead json plus {changed, changed_fields}.';

-- ------------------------------------------------------------------ log_opportunity_activity
-- One transaction: the interaction (opportunity_id, and the landlord contact when there is one),
-- the lead's last activity and (optionally) its next action and follow-up date, the landlord
-- contact's last_contact_at, and an optional follow-up task linked to the lead.
create function hq.log_opportunity_activity(
  p_opportunity uuid,
  p_type hq.interaction_type default null,
  p_occurred_at timestamptz default null,
  p_summary text default null,
  p_next_action text default null,
  p_next_action_due date default null,
  p_create_task boolean default false,
  p_task_assignee uuid default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_caller uuid := hq_private.require_staff();
  v_today date;
  v_o hq.opportunities;
  v_when timestamptz := coalesce(p_occurred_at, now());
  v_summary text;
  v_action text;
  v_assignee uuid := coalesce(p_task_assignee, v_caller);
  v_interaction uuid;
  v_task uuid;
  v_contact uuid;
begin
  perform hq_private.require_capability('growth.write');
  if coalesce(p_create_task, false) then
    perform hq_private.require_capability('tasks.write');
    perform hq_private.require_active_staff(v_assignee, 'the task assignee');
  end if;
  v_today := hq.today();
  if p_type is null then
    raise exception 'an interaction type is required' using errcode = 'invalid_parameter_value';
  end if;
  v_summary := hq_private.lead_text(p_summary, 4000, 'the summary');
  if v_summary is null then
    raise exception 'a summary is required' using errcode = 'invalid_parameter_value';
  end if;
  v_action := hq_private.lead_text(p_next_action, 300, 'the next action');
  if v_when > now() + interval '1 hour' then
    raise exception 'an interaction cannot have occurred in the future' using errcode = 'invalid_parameter_value';
  end if;
  if p_next_action_due is not null and (p_next_action_due < v_today or p_next_action_due > v_today + 730) then
    raise exception 'the follow-up date must be from today to two years ahead' using errcode = 'invalid_parameter_value';
  end if;

  select o.* into v_o from hq.opportunities o where o.id = p_opportunity and o.deleted_at is null for update;
  if not found then
    raise exception 'opportunity not found' using errcode = 'no_data_found';
  end if;
  select c.id into v_contact from hq.contacts c where c.id = v_o.owner_contact_id and c.deleted_at is null;

  insert into hq.interactions (opportunity_id, contact_id, interaction_type, occurred_at, summary, staff_id, next_action, follow_up_date)
  values (v_o.id, v_contact, p_type, v_when, v_summary, v_caller, v_action, p_next_action_due)
  returning id into v_interaction;

  if coalesce(p_create_task, false) then
    insert into hq.tasks (title, assigned_to, due_date, related_opportunity_id, related_contact_id, source)
    values (left(coalesce(v_action, 'Follow up with ' || v_o.prospect_name), 200), v_assignee, coalesce(p_next_action_due, v_o.next_action_due),
            v_o.id, v_contact, 'interaction')
    returning id into v_task;
    perform hq_private.audit_context('skip');
    update hq.interactions set task_id = v_task where id = v_interaction;
    perform hq_private.audit_context();
  end if;

  update hq.opportunities set
    last_activity_at = greatest(coalesce(last_activity_at, v_when), v_when),
    next_action = coalesce(v_action, next_action),
    next_action_due = coalesce(p_next_action_due, next_action_due)
  where id = v_o.id
  returning * into v_o;

  if v_contact is not null then
    update hq.contacts set last_contact_at = greatest(coalesce(last_contact_at, v_when), v_when) where id = v_contact;
  end if;

  return jsonb_build_object('interaction_id', v_interaction, 'task_id', v_task, 'opportunity_id', v_o.id,
    'next_action', v_o.next_action, 'next_action_due', v_o.next_action_due, 'last_activity_at', v_o.last_activity_at);
end $$;
comment on function hq.log_opportunity_activity(uuid, hq.interaction_type, timestamptz, text, text, date, boolean, uuid) is 'growth.write (+ tasks.write for a task). One transaction: logs a call, meeting, email, message or note on a live lead (interactions.opportunity_id, and the landlord contact), sets the lead''s last activity and, when given, its next action and follow-up date (today to 2 years ahead), the contact''s last_contact_at, and an optional follow-up task linked to the lead. Returns {interaction_id, task_id, opportunity_id, next_action, next_action_due, last_activity_at}.';

-- ------------------------------------------------------------------ move_opportunity (replaces 0109)
-- As 0109, plus: lost needs p_lost_reason_code as well as the reason; moving to an open stage keeps the
-- lead's owner, next action and follow-up date (a lead missing one, from before Day 2, gets the caller,
-- "Follow up" and tomorrow), so the open-lead rule holds without asking for a new next action.
drop function hq.move_opportunity(uuid, hq.opportunity_stage, text, timestamptz, text, text);
create function hq.move_opportunity(
  p_opportunity uuid,
  p_stage hq.opportunity_stage,
  p_note text default null,
  p_signed_at timestamptz default null,
  p_management_reference text default null,
  p_lost_reason text default null,
  p_lost_reason_code hq.lost_reason default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_caller uuid := hq_private.require_staff();
  v_opp hq.opportunities;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_reason text := nullif(btrim(coalesce(p_lost_reason, '')), '');
  v_ref text := nullif(btrim(coalesce(p_management_reference, '')), '');
  v_prev hq.opportunity_stage;
  v_open boolean := p_stage not in ('management_signed', 'lost');
begin
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
  if p_stage = 'lost' and p_lost_reason_code is null then
    raise exception 'a lost opportunity needs a reason code' using errcode = 'invalid_parameter_value', hint = 'lost_reason_code_required';
  end if;

  perform set_config('hq.stage_note', coalesce(left(v_note, 500), ''), true);
  perform hq_private.audit_context(null, left(v_note, 200));
  update hq.opportunities set
    stage = p_stage,
    signed_at = case when p_stage = 'management_signed' then coalesce(p_signed_at, now()) else null end,
    management_reference = case when p_stage = 'management_signed' then coalesce(v_ref, management_reference) else null end,
    lost_reason = case when p_stage = 'lost' then v_reason else null end,
    lost_reason_code = case when p_stage = 'lost' then p_lost_reason_code else null end,
    assigned_to = case when v_open then coalesce(assigned_to, v_caller) else assigned_to end,
    next_action = case when v_open then coalesce(next_action, 'Follow up') else next_action end,
    next_action_due = case when v_open then coalesce(next_action_due, hq.today() + 1) else next_action_due end
  where id = v_opp.id
  returning * into v_opp;
  perform set_config('hq.stage_note', '', true);
  perform hq_private.audit_context();

  return jsonb_build_object('opportunity_id', v_opp.id, 'stage', v_opp.stage, 'previous_stage', v_prev,
                            'changed', true, 'signed_at', v_opp.signed_at);
end $$;
comment on function hq.move_opportunity(uuid, hq.opportunity_stage, text, timestamptz, text, text, hq.lost_reason) is 'growth.write. Stage change with history. Signing is idempotent (no second history row, signed_at set once). Leaving management_signed needs director or administrator. lost needs p_lost_reason AND p_lost_reason_code. An open stage keeps the owner, next action and follow-up date (filled with the caller, "Follow up" and tomorrow only where missing).';

-- ------------------------------------------------------------------ growth_summary (0110): partner contact figures
-- Identical, except that contacts_by_status and contacts_not_contacted_30d count PARTNER contacts only,
-- so a landlord added with a lead never changes a partner figure. overdue_followups still counts every
-- contact whose follow-up date has passed (a follow-up is a follow-up, whoever it is with).
create or replace function hq.growth_summary(p_since date default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_today date := hq.today();
  v_tz text := coalesce((select s.value #>> '{}' from hq.settings s where s.key = 'timezone'), 'Australia/Adelaide');
  v_since date;
  v_signed bigint;
  v_value bigint;
  v_received bigint;
  v_sent bigint;
  v_active bigint;
  v_qualified bigint;
  v_overdue bigint;
  v_stale bigint;
  v_status jsonb;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('growth.read');
  v_since := coalesce(p_since, v_today - 30);

  select count(*), coalesce(sum(o.estimated_annual_value_cents), 0)::bigint into v_signed, v_value
  from hq.opportunities o
  where o.deleted_at is null and o.stage = 'management_signed' and (o.signed_at at time zone v_tz)::date >= v_since;

  select count(*) filter (where r.direction = 'received'), count(*) filter (where r.direction = 'sent') into v_received, v_sent
  from hq.referrals r where r.deleted_at is null and r.referral_date >= v_since;

  select count(*) into v_active from hq.opportunities o
  where o.deleted_at is null and o.stage not in ('management_signed', 'lost');

  select count(*) into v_qualified
  from (
    select least(
             (select min(h.changed_at) from hq.opportunity_stage_history h
               where h.opportunity_id = o.id and h.to_stage in ('qualified', 'appraisal_requested', 'appraisal_completed', 'proposal_sent', 'management_signed')),
             case when o.stage in ('qualified', 'appraisal_requested', 'appraisal_completed', 'proposal_sent', 'management_signed') then o.stage_changed_at end
           ) as first_qualified
    from hq.opportunities o where o.deleted_at is null
  ) q
  where q.first_qualified is not null and (q.first_qualified at time zone v_tz)::date >= v_since;

  select count(*) into v_overdue from hq.contacts c
  where c.deleted_at is null and c.relationship_status <> 'inactive' and c.next_follow_up_date < v_today;

  select count(*) into v_stale from hq.contacts c
  where c.deleted_at is null and c.contact_kind = 'partner' and c.relationship_status <> 'inactive'
    and (c.last_contact_at is null or c.last_contact_at < now() - interval '30 days');

  select jsonb_object_agg(e.status::text, coalesce(n.n, 0) order by e.ord) into v_status
  from (select s, row_number() over () as ord from unnest(enum_range(null::hq.relationship_status)) s) e(status, ord)
  left join (select c.relationship_status, count(*) as n from hq.contacts c where c.deleted_at is null and c.contact_kind = 'partner' group by 1) n
    on n.relationship_status = e.status;

  return jsonb_build_object(
    'since', v_since,
    'as_of', v_today,
    'managements_signed', v_signed,
    'referrals_received', v_received,
    'referrals_sent', v_sent,
    'active_opportunities', v_active,
    'qualified', v_qualified,
    'conversion', case when v_received = 0 then null else round(v_signed::numeric / v_received, 4) end,
    'overdue_followups', v_overdue,
    'contacts_by_status', v_status,
    'contacts_not_contacted_30d', v_stale,
    'estimated_value_signed_cents', v_value
  );
end $$;
comment on function hq.growth_summary(date) is 'growth.read. Real counts only: managements_signed (distinct opportunities), referrals_received / sent, active_opportunities, qualified, conversion (null when none received), overdue_followups (every contact), contacts_by_status and contacts_not_contacted_30d (partner contacts only), estimated_value_signed_cents.';

revoke execute on all functions in schema hq_private from public, anon;
revoke execute on all functions in schema hq from public, anon;

notify pgrst, 'reload schema';
