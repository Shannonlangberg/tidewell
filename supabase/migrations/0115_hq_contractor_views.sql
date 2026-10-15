-- 0115_hq_contractor_views.sql
-- Phase 2 read models (docs/hq-phase-2.md, section 4). Every view is `security_invoker = true`, so the
-- reader's own row level security applies; none reads hq.audit_events. Settings are read live:
--   contractor_expiry_warning_days     (default 30) the expiry warning window
--   contractor_min_reviews_for_rating  (default 3)  reviews WITH A RATING needed before a rating shows
-- Expiry states come from the one rule, hq_private.expiry_state (0112).

-- ------------------------------------------------------------------ contractor_directory
-- One row per live contractor: the table's fields plus derived states and counts.
--   rating  null unless rated_review_count >= rating_threshold. A review's score is the mean of the
--           ratings it carries; the rating is the mean of those scores, to one decimal. The four
--           rating_* columns are the per-dimension means, under the same threshold.
--   open_task_count  open tasks related to the contractor THAT THE READER CAN SEE (task visibility rules).
--   last_contacted_at  the latest logged contact (hq.record_contractor_contact).
create view hq.contractor_directory with (security_invoker = true) as
with cfg as (
  select
    hq.today() as today,
    coalesce((select (s.value #>> '{}')::integer from hq.settings s where s.key = 'contractor_expiry_warning_days'), 30) as warning_days,
    coalesce((select (s.value #>> '{}')::integer from hq.settings s where s.key = 'contractor_min_reviews_for_rating'), 3) as min_reviews
)
select
  c.id,
  c.business_name,
  c.primary_contact_name,
  c.phone,
  c.email,
  c.website,
  c.abn,
  c.categories,
  c.service_suburbs,
  array(select lower(x) from unnest(c.service_suburbs) as x) as service_suburb_keys,
  c.service_regions,
  array(select lower(x) from unnest(c.service_regions) as x) as service_region_keys,
  c.emergency_available,
  c.business_hours,
  c.hourly_rate_cents,
  c.callout_fee_cents,
  c.after_hours_fee_cents,
  c.minimum_charge_cents,
  c.invoice_terms,
  c.licence_details,
  c.licence_verified_at,
  c.licence_expires_on,
  hq_private.expiry_state(c.licence_expires_on, c.licence_verified_at is not null,
    nullif(btrim(coalesce(c.licence_details, '')), '') is not null, cfg.today, cfg.warning_days) as licence_state,
  (c.licence_expires_on - cfg.today) as licence_days_remaining,
  c.insurance_details,
  c.insurance_verified_at,
  c.insurance_expires_on,
  hq_private.expiry_state(c.insurance_expires_on, c.insurance_verified_at is not null,
    nullif(btrim(coalesce(c.insurance_details, '')), '') is not null, cfg.today, cfg.warning_days) as insurance_state,
  (c.insurance_expires_on - cfg.today) as insurance_days_remaining,
  c.status,
  c.status_reason,
  c.approved_at,
  c.approved_by,
  ab.full_name as approved_by_name,
  c.relationship_owner_id,
  ro.full_name as relationship_owner_name,
  c.internal_notes,
  c.last_job_date,
  c.source,
  c.needs_verification,
  c.verified_at,
  c.created_at,
  c.updated_at,
  coalesce(v.done, 0) as vetting_done_count,
  coalesce(r.review_count, 0) as review_count,
  coalesce(r.rated_count, 0) as rated_review_count,
  cfg.min_reviews as rating_threshold,
  case when coalesce(r.rated_count, 0) >= cfg.min_reviews then r.rating end as rating,
  case when coalesce(r.rated_count, 0) >= cfg.min_reviews then r.avg_response_time end as rating_response_time,
  case when coalesce(r.rated_count, 0) >= cfg.min_reviews then r.avg_communication end as rating_communication,
  case when coalesce(r.rated_count, 0) >= cfg.min_reviews then r.avg_work_quality end as rating_work_quality,
  case when coalesce(r.rated_count, 0) >= cfg.min_reviews then r.avg_invoice_accuracy end as rating_invoice_accuracy,
  coalesce(d.document_count, 0) as document_count,
  coalesce(t.open_count, 0) as open_task_count,
  i.last_contacted_at
from hq.contractors c
cross join cfg
left join hq.staff_profiles ro on ro.id = c.relationship_owner_id
left join hq.staff_profiles ab on ab.id = c.approved_by
left join lateral (
  select count(*) filter (where s.status in ('done', 'not_applicable')) as done
  from hq.contractor_vetting_steps s where s.contractor_id = c.id
) v on true
left join lateral (
  select
    count(*) as review_count,
    count(*) filter (where x.n > 0) as rated_count,
    round(avg(x.total::numeric / x.n) filter (where x.n > 0), 1) as rating,
    round(avg(x.response_time), 1) as avg_response_time,
    round(avg(x.communication), 1) as avg_communication,
    round(avg(x.work_quality), 1) as avg_work_quality,
    round(avg(x.invoice_accuracy), 1) as avg_invoice_accuracy
  from (
    select rv.response_time, rv.communication, rv.work_quality, rv.invoice_accuracy,
           num_nonnulls(rv.response_time, rv.communication, rv.work_quality, rv.invoice_accuracy) as n,
           coalesce(rv.response_time, 0) + coalesce(rv.communication, 0) + coalesce(rv.work_quality, 0) + coalesce(rv.invoice_accuracy, 0) as total
    from hq.contractor_reviews rv
    where rv.contractor_id = c.id and rv.deleted_at is null
  ) x
) r on true
left join lateral (
  select count(*) as document_count from hq.contractor_documents dc where dc.contractor_id = c.id and dc.deleted_at is null
) d on true
left join lateral (
  select count(*) as open_count from hq.tasks tk
  where tk.related_contractor_id = c.id and tk.deleted_at is null and tk.status not in ('completed', 'cancelled')
) t on true
left join lateral (
  select max(it.occurred_at) as last_contacted_at from hq.interactions it where it.contractor_id = c.id and it.deleted_at is null
) i on true
where c.deleted_at is null;
comment on view hq.contractor_directory is 'Live contractors with licence_state / insurance_state (not_recorded, unverified, current, expiring_soon, expired), vetting_done_count (0-9), review counts, rating (null below the threshold), document and open task counts, last_contacted_at. security_invoker.';

-- ------------------------------------------------------------------ contractor_expiry_watch
-- One row per licence, insurance or document expiry that is expired or within the warning window, for
-- live contractors that are not inactive. Documents: live, not rejected, with an expiry date; a document
-- is left out when a newer live, non-rejected document of the same type (other than 'other') for the
-- same contractor expires later (it has been superseded). item_key identifies the item for
-- hq.create_expiry_tasks: licence | insurance | document:<document id>.
create view hq.contractor_expiry_watch with (security_invoker = true) as
with cfg as (
  select
    hq.today() as today,
    coalesce((select (s.value #>> '{}')::integer from hq.settings s where s.key = 'contractor_expiry_warning_days'), 30) as warning_days
),
items as (
  select c.id as contractor_id, 'licence'::text as kind, 'licence'::text as item_key, null::uuid as document_id,
         null::hq.contractor_document_type as document_type, null::text as file_name,
         c.licence_expires_on as expires_on, (c.licence_verified_at is not null) as verified
  from hq.contractors c
  where c.deleted_at is null and c.status <> 'inactive' and c.licence_expires_on is not null
  union all
  select c.id, 'insurance', 'insurance', null, null, null, c.insurance_expires_on, (c.insurance_verified_at is not null)
  from hq.contractors c
  where c.deleted_at is null and c.status <> 'inactive' and c.insurance_expires_on is not null
  union all
  select d.contractor_id, 'document', 'document:' || d.id::text, d.id, d.document_type, d.file_name, d.expires_on, (d.verification = 'verified')
  from hq.contractor_documents d
  join hq.contractors c on c.id = d.contractor_id and c.deleted_at is null and c.status <> 'inactive'
  where d.deleted_at is null and d.verification <> 'rejected' and d.expires_on is not null
    and (d.document_type = 'other' or not exists (
      select 1 from hq.contractor_documents n
      where n.contractor_id = d.contractor_id and n.document_type = d.document_type and n.id <> d.id
        and n.deleted_at is null and n.verification <> 'rejected' and n.expires_on > d.expires_on))
)
select
  i.contractor_id,
  c.business_name,
  c.status as contractor_status,
  c.relationship_owner_id,
  ro.full_name as relationship_owner_name,
  i.kind,
  i.item_key,
  i.document_id,
  i.document_type,
  i.file_name,
  i.expires_on,
  (i.expires_on - cfg.today) as days_remaining,
  hq_private.expiry_state(i.expires_on, i.verified, true, cfg.today, cfg.warning_days) as state,
  i.verified
from items i
cross join cfg
join hq.contractors c on c.id = i.contractor_id
left join hq.staff_profiles ro on ro.id = c.relationship_owner_id
where hq_private.expiry_state(i.expires_on, i.verified, true, cfg.today, cfg.warning_days) in ('expired', 'expiring_soon');
comment on view hq.contractor_expiry_watch is 'Licence, insurance and document expiries that are expired or within contractor_expiry_warning_days, for live contractors that are not inactive. kind licence | insurance | document; state expired | expiring_soon. security_invoker.';

-- ------------------------------------------------------------------ contractor_timeline
-- What happened with a contractor, newest first, built from the underlying tables (each reader's RLS
-- applies; audit_events is never read): status changes, completed vetting steps (their current
-- completion), document uploads and reviews (verified / rejected), job feedback and logged contacts.
-- event_key is unique across the view.
create view hq.contractor_timeline with (security_invoker = true) as
select
  e.event_key,
  e.contractor_id,
  c.business_name,
  e.kind,
  e.occurred_at,
  e.actor_id,
  sp.full_name as actor_name,
  e.summary,
  e.detail,
  e.entity_id,
  e.from_status,
  e.to_status,
  e.step,
  e.step_status,
  e.document_type,
  e.interaction_type
from (
  select 'status:' || h.id::text as event_key, h.contractor_id, 'status_change'::text as kind, h.changed_at as occurred_at,
         h.changed_by as actor_id,
         case when h.from_status is null then 'Added as ' || replace(h.to_status::text, '_', ' ')
              else 'Status changed from ' || replace(h.from_status::text, '_', ' ') || ' to ' || replace(h.to_status::text, '_', ' ') end as summary,
         h.note as detail, null::uuid as entity_id, h.from_status, h.to_status,
         null::hq.vetting_step as step, null::hq.vetting_step_status as step_status,
         null::hq.contractor_document_type as document_type, null::hq.interaction_type as interaction_type
  from hq.contractor_status_history h
  union all
  select 'step:' || s.contractor_id::text || ':' || s.step::text, s.contractor_id, 'vetting_step', s.completed_at, s.completed_by,
         'Vetting step "' || replace(s.step::text, '_', ' ') || '" marked ' || case s.status when 'done' then 'done' else 'not applicable' end,
         s.note, null, null, null, s.step, s.status, null, null
  from hq.contractor_vetting_steps s
  where s.completed_at is not null
  union all
  select 'document:' || d.id::text, d.contractor_id, 'document_uploaded', d.uploaded_at, d.uploaded_by,
         'Document uploaded: ' || replace(d.document_type::text, '_', ' ') || ' (' || d.file_name || ')',
         d.notes, d.id, null, null, null, null, d.document_type, null
  from hq.contractor_documents d
  where d.deleted_at is null
  union all
  select 'document-review:' || d.id::text, d.contractor_id,
         case d.verification when 'verified' then 'document_verified' else 'document_rejected' end, d.verified_at, d.verified_by,
         'Document ' || case d.verification when 'verified' then 'verified' else 'rejected' end || ': '
           || replace(d.document_type::text, '_', ' ') || ' (' || d.file_name || ')',
         d.verification_note, d.id, null, null, null, null, d.document_type, null
  from hq.contractor_documents d
  where d.deleted_at is null and d.verified_at is not null
  union all
  select 'review:' || r.id::text, r.contractor_id, 'review', r.created_at, r.recorded_by,
         'Job feedback recorded' || coalesce(' for ' || nullif(btrim(r.job_reference), ''), ''),
         r.notes, r.id, null, null, null, null, null, null
  from hq.contractor_reviews r
  where r.deleted_at is null
  union all
  select 'contact:' || it.id::text, it.contractor_id, 'contact', it.occurred_at, it.staff_id,
         initcap(replace(it.interaction_type::text, '_', ' ')) || ' logged',
         it.summary, it.id, null, null, null, null, null, it.interaction_type
  from hq.interactions it
  where it.contractor_id is not null and it.deleted_at is null
) e
join hq.contractors c on c.id = e.contractor_id and c.deleted_at is null
left join hq.staff_profiles sp on sp.id = e.actor_id
order by e.occurred_at desc, e.event_key;
comment on view hq.contractor_timeline is 'Per contractor, newest first: status_change, vetting_step, document_uploaded, document_verified, document_rejected, review, contact. Built from the underlying tables (never audit_events). security_invoker.';

revoke all on hq.contractor_directory, hq.contractor_expiry_watch, hq.contractor_timeline from public, anon, authenticated, service_role;
grant select on hq.contractor_directory, hq.contractor_expiry_watch, hq.contractor_timeline to authenticated, service_role;
