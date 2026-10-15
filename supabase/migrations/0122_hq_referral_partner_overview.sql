-- 0122_hq_referral_partner_overview.sql
-- The Referral partners page (/hq/growth/partners): one row per live referral partner, with when we
-- last spoke to them, what happens next and what they have referred. `security_invoker = true`, so the
-- reader's own row level security applies: a person without growth.read reads zero rows.
--
-- Two kinds of row (partner_kind):
--   'organisation'  one per live organisation (every organisation is a referral partner; its
--                   categories are the partner categories). id = the organisation id.
--   'independent'   one per live contact with NO organisation (a sole broker, an independent
--                   adviser). id = the contact id. Nothing is dropped.
--
-- Referral figures for an organisation are READ FROM hq.partner_performance (0107), not recomputed,
-- so the two can never disagree: received, sent, qualified ("ever reached qualified", from stage
-- history), signed (each opportunity once, through its single attributed referral), conversion,
-- estimated value signed, reciprocal. An independent contact's figures apply the SAME rules to the
-- referrals that name that contact and no organisation (exactly the referrals partner_performance
-- cannot credit to any organisation), so across every row each referral and each signed management
-- is counted once.
--
--   last_contacted_at   the latest of the contacts' last_contact_at and the partner's own logged
--                       interactions (null = never contacted)
--   days_since_contact  calendar days since then, in the configured timezone (hq.today()); null = never
--   next_follow_up_date the earliest open follow-up: a live, not-inactive contact's next_follow_up_date,
--                       or the follow-up date on an organisation-level interaction (no contact) that
--                       nothing has been logged after
--   relationship_status the most advanced status among the partner's live contacts, ignoring inactive
--                       ones unless every contact is inactive; null when the organisation has no contacts
--   last_referral_date  the latest live referral in either direction

create view hq.referral_partner_overview with (security_invoker = true) as
with cfg as (
  select
    hq.today() as today,
    coalesce((select s.value #>> '{}' from hq.settings s where s.key = 'timezone'), 'Australia/Adelaide') as tz
),
reached_qualified as (
  -- Identical to partner_performance's rule (0107): ever reached qualified or later.
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
    from hq.contacts c where c.organisation_id = org.id and c.deleted_at is null
  ) cs on true
  left join lateral (
    select c.id, c.full_name, c.phone, c.email
    from hq.contacts c
    where c.organisation_id = org.id and c.org_contact_role = 'primary' and c.deleted_at is null
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
  where c.deleted_at is null and c.organisation_id is null
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
comment on view hq.referral_partner_overview is 'One row per live referral partner (organisation, or independent contact with no organisation): last contacted, next follow-up, most advanced status, and referral figures read from partner_performance (independents by the same rules). security_invoker.';

revoke all on hq.referral_partner_overview from public, anon, authenticated, service_role;
grant select on hq.referral_partner_overview to authenticated, service_role;

notify pgrst, 'reload schema';
