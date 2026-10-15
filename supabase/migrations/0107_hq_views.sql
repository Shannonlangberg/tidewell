-- 0107_hq_views.sql
-- Read models (design section 4, "Views"). Every view is `security_invoker = true`: the reader's own
-- row level security applies, so a person who cannot read contacts reads zero rows from
-- contact_directory. Granted to authenticated only. All views list live (not archived) records; an
-- archived record is read from its table by a growth.delete holder.

create view hq.contact_directory with (security_invoker = true) as
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
    where r.receiving_contact_id = c.id and r.direction = 'sent' and r.deleted_at is null) as referrals_sent
from hq.contacts c
left join hq.organisations o on o.id = c.organisation_id
left join hq.staff_profiles ro on ro.id = c.relationship_owner_id
where c.deleted_at is null;
comment on view hq.contact_directory is 'Live contacts with organisation and owner names, an overdue flag and referral counts. security_invoker.';

create view hq.organisation_directory with (security_invoker = true) as
select
  o.id,
  o.name,
  o.categories,
  o.website,
  o.phone,
  o.email,
  o.location,
  o.service_region,
  o.relationship_owner_id,
  ro.full_name as relationship_owner_name,
  o.notes,
  o.source,
  o.needs_verification,
  o.verified_at,
  o.created_at,
  o.updated_at,
  coalesce(cs.contact_count, 0) as contact_count,
  pc.id as primary_contact_id,
  pc.full_name as primary_contact_name,
  cs.last_contact_at,
  cs.next_follow_up_date
from hq.organisations o
left join hq.staff_profiles ro on ro.id = o.relationship_owner_id
left join lateral (
  select count(*) as contact_count, max(c.last_contact_at) as last_contact_at, min(c.next_follow_up_date) as next_follow_up_date
  from hq.contacts c where c.organisation_id = o.id and c.deleted_at is null
) cs on true
left join lateral (
  select c.id, c.full_name
  from hq.contacts c
  where c.organisation_id = o.id and c.org_contact_role = 'primary' and c.deleted_at is null
  limit 1
) pc on true
where o.deleted_at is null;
comment on view hq.organisation_directory is 'Live organisations with contact count, primary contact and last / next contact dates. security_invoker.';

-- One row per live referral: direction, the partner (the referrer for a received referral, the
-- recipient for a sent one), the prospect and the pipeline stage of the opportunity.
create view hq.referral_overview with (security_invoker = true) as
select
  r.id,
  r.ref_number,
  'REF-' || lpad(r.ref_number::text, 4, '0') as ref_label,
  r.direction,
  r.referral_date,
  r.is_attributed,
  r.sent_outcome,
  case when r.direction = 'received' then r.referring_organisation_id else r.receiving_organisation_id end as partner_organisation_id,
  case when r.direction = 'received' then ro.name else so.name end as partner_organisation_name,
  case when r.direction = 'received' then r.referring_contact_id else r.receiving_contact_id end as partner_contact_id,
  case when r.direction = 'received' then rc.full_name else sc.full_name end as partner_contact_name,
  r.referring_contact_id,
  r.referring_organisation_id,
  r.receiving_contact_id,
  r.receiving_organisation_id,
  r.opportunity_id,
  op.display_number as opportunity_number,
  coalesce(op.prospect_name, r.prospect_name) as prospect_name,
  coalesce(op.prospect_phone, r.prospect_phone) as prospect_phone,
  coalesce(op.prospect_email, r.prospect_email) as prospect_email,
  coalesce(op.property_suburb, r.property_suburb) as property_suburb,
  coalesce(op.property_address, r.property_address) as property_address,
  op.stage,
  op.stage_changed_at,
  op.estimated_annual_value_cents,
  op.signed_at,
  op.assigned_to as opportunity_assigned_to,
  r.assigned_to,
  asg.full_name as assigned_to_name,
  r.notes,
  r.created_at
from hq.referrals r
left join hq.organisations ro on ro.id = r.referring_organisation_id
left join hq.organisations so on so.id = r.receiving_organisation_id
left join hq.contacts rc on rc.id = r.referring_contact_id
left join hq.contacts sc on sc.id = r.receiving_contact_id
left join hq.opportunities op on op.id = r.opportunity_id
left join hq.staff_profiles asg on asg.id = r.assigned_to
where r.deleted_at is null;
comment on view hq.referral_overview is 'Live referrals flattened: direction, partner, prospect, stage. security_invoker.';

-- Per organisation. received / sent count live referral rows. qualified and signed count
-- OPPORTUNITIES through their single attributed referral, so an opportunity claimed by two partners
-- is credited once, to the attributed one. qualified = ever reached qualified or later (stage
-- history, or the current stage), so a lost deal that was once qualified still counts.
create view hq.partner_performance with (security_invoker = true) as
with reached_qualified as (
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
attributed as (
  select r.referring_organisation_id as organisation_id, r.opportunity_id
  from hq.referrals r
  where r.direction = 'received' and r.is_attributed and r.deleted_at is null
    and r.referring_organisation_id is not null
)
select
  org.id as organisation_id,
  org.name as organisation_name,
  org.categories,
  coalesce(rec.n, 0) as received,
  coalesce(snt.n, 0) as sent,
  coalesce(q.n, 0) as qualified,
  coalesce(sg.n, 0) as signed,
  case when coalesce(rec.n, 0) = 0 then null else round(coalesce(sg.n, 0)::numeric / rec.n, 4) end as conversion,
  coalesce(sg.value, 0)::bigint as estimated_value_signed_cents,
  (coalesce(rec.n, 0) > 0 and coalesce(snt.n, 0) > 0) as reciprocal
from hq.organisations org
left join (
  select r.referring_organisation_id as organisation_id, count(*) as n
  from hq.referrals r where r.direction = 'received' and r.deleted_at is null group by 1
) rec on rec.organisation_id = org.id
left join (
  select r.receiving_organisation_id as organisation_id, count(*) as n
  from hq.referrals r where r.direction = 'sent' and r.deleted_at is null group by 1
) snt on snt.organisation_id = org.id
left join (
  select a.organisation_id, count(*) as n
  from attributed a join reached_qualified rq on rq.opportunity_id = a.opportunity_id group by 1
) q on q.organisation_id = org.id
left join (
  select a.organisation_id, count(*) as n, sum(o.estimated_annual_value_cents) as value
  from attributed a join hq.opportunities o on o.id = a.opportunity_id
  where o.deleted_at is null and o.stage = 'management_signed' group by 1
) sg on sg.organisation_id = org.id
where org.deleted_at is null;
comment on view hq.partner_performance is 'Per organisation: referrals received and sent, qualified and signed opportunities (each opportunity counted once, through its attributed referral), conversion, signed value, reciprocal flag. security_invoker.';

-- Contacts whose follow-up date has passed (the date is in the configured timezone: hq.today()).
create view hq.overdue_followups with (security_invoker = true) as
select
  c.id as contact_id,
  c.full_name,
  c.organisation_id,
  o.name as organisation_name,
  c.relationship_status,
  c.priority,
  c.next_follow_up_date,
  (hq.today() - c.next_follow_up_date) as days_overdue,
  c.last_contact_at,
  c.relationship_owner_id,
  ro.full_name as relationship_owner_name
from hq.contacts c
left join hq.organisations o on o.id = c.organisation_id
left join hq.staff_profiles ro on ro.id = c.relationship_owner_id
where c.deleted_at is null
  and c.relationship_status <> 'inactive'
  and c.next_follow_up_date is not null
  and c.next_follow_up_date < hq.today();
comment on view hq.overdue_followups is 'Live, non-inactive contacts whose next_follow_up_date is before hq.today(). security_invoker.';

revoke all on hq.contact_directory, hq.organisation_directory, hq.referral_overview, hq.partner_performance, hq.overdue_followups
  from public, anon, authenticated, service_role;
grant select on hq.contact_directory, hq.organisation_directory, hq.referral_overview, hq.partner_performance, hq.overdue_followups
  to authenticated, service_role;
