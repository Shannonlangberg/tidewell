-- 0156_hq_enquiry_archive.sql
-- Archiving and restoring website enquiries (docs/hq-setup.md "Website enquiries"). An enquiry could
-- already be set to the status 'archived' (0134 set_enquiry_status), but nothing recorded who archived
-- it, why, or what it was before, so "Back to New" was the only way back and the list showed archived
-- enquiries with the rest. This keeps the status and adds the record of the archive:
--
-- COLUMNS on hq.enquiries (every writer goes through the RPCs; no API role writes the table):
--   archived_at, archived_by   when and by whom it was archived (null unless the status is archived)
--   archived_from              the status it had (new or in_progress): restoring puts it back there
--   archive_reason             optional, at most 200 characters, also in the audit trail
--   Constraint: the status is 'archived' exactly when archived_at and archived_from are set.
--   Rows already archived are stamped from who handled them, with archived_from in_progress.
--
-- RPCs (security definer, search_path pinned; privileges in 0157):
--   archive_enquiry(id, reason)  growth.write. New or In progress -> Archived. A spam enquiry is refused
--                                (spam is already kept out of the list). Already archived: unchanged.
--                                Only the enquiry changes: its lead, contact and task are left alone
--                                (archive those from their own pages). Audited ('archive').
--   restore_enquiry(id)          growth.write. Archived -> the status it had before. Not archived:
--                                unchanged. Audited ('restore').
--   set_enquiry_status           replaced: choosing Archived stamps the archive as above; leaving it
--                                clears the stamps. Everything else as in 0134.
-- VIEW enquiry_overview: the archive columns appended (with the archiver's name).
-- Nothing is erased: the enquiry, its lead, contact, task and timeline entry are all kept.

-- ------------------------------------------------------------------ the columns
alter table hq.enquiries
  add column archived_at timestamptz,
  add column archived_by uuid references hq.staff_profiles (id),
  add column archived_from hq.enquiry_status,
  add column archive_reason text;

update hq.enquiries
set archived_at = coalesce(handled_at, updated_at), archived_by = handled_by, archived_from = 'in_progress'
where status = 'archived';

alter table hq.enquiries
  add constraint enquiries_archived_iff check (
    (status = 'archived') = (archived_at is not null)
    and (archived_at is null) = (archived_from is null)
    and (archived_at is not null or (archived_by is null and archive_reason is null))
    and (archived_from is null or archived_from in ('new', 'in_progress'))),
  add constraint enquiries_archive_reason_length check (archive_reason is null or char_length(archive_reason) between 1 and 200);

create index enquiries_archived_by_idx on hq.enquiries (archived_by);

comment on column hq.enquiries.archived_from is 'The status the enquiry had when it was archived (new or in_progress); restore_enquiry puts it back there.';
comment on column hq.enquiries.archive_reason is 'Why it was archived (optional, at most 200 characters; also in the audit trail).';

-- ------------------------------------------------------------------ archive_enquiry (growth.write)
create function hq.archive_enquiry(p_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_caller uuid := hq_private.require_staff();
  v_e hq.enquiries;
  v_reason text;
  v_ref text;
begin
  perform hq_private.require_capability('growth.write');
  v_reason := hq_private.enquiry_line(p_reason, 200, 'the reason');
  select * into v_e from hq.enquiries e where e.id = p_id for update;
  if not found then
    raise exception 'enquiry not found' using errcode = 'no_data_found';
  end if;
  v_ref := hq_private.enquiry_ref(v_e.ref_number);
  if v_e.status = 'archived' then
    return jsonb_build_object('enquiry_id', v_e.id, 'ref', v_ref, 'status', v_e.status, 'changed', false);
  end if;
  if v_e.status = 'spam' then
    raise exception 'a spam enquiry is already kept out of the list; move it back to New first to archive it'
      using errcode = 'invalid_parameter_value', hint = 'enquiry_is_spam';
  end if;

  update hq.enquiries set status = 'archived', archived_at = now(), archived_by = v_caller,
    archived_from = v_e.status, archive_reason = v_reason
  where id = v_e.id
  returning * into v_e;

  perform hq_private.audit_write('archive', 'enquiry', v_e.id,
    'Archived website enquiry ' || v_ref || coalesce(' [' || v_reason || ']', ''),
    jsonb_build_object('status', jsonb_build_object('from', v_e.archived_from, 'to', 'archived')));

  return jsonb_build_object('enquiry_id', v_e.id, 'ref', v_ref, 'status', v_e.status, 'changed', true);
end $$;
comment on function hq.archive_enquiry(uuid, text) is 'growth.write. Archives a website enquiry (new or in_progress; spam is refused, hint enquiry_is_spam), stamped with the caller, the time, the status it had and an optional reason (at most 200). Hidden from the default list; nothing is erased and its lead, contact and task are unchanged. Idempotent. Audited. Returns {enquiry_id, ref, status, changed}.';

-- ------------------------------------------------------------------ restore_enquiry (growth.write)
create function hq.restore_enquiry(p_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_caller uuid := hq_private.require_staff();
  v_e hq.enquiries;
  v_to hq.enquiry_status;
  v_ref text;
begin
  perform hq_private.require_capability('growth.write');
  select * into v_e from hq.enquiries e where e.id = p_id for update;
  if not found then
    raise exception 'enquiry not found' using errcode = 'no_data_found';
  end if;
  v_ref := hq_private.enquiry_ref(v_e.ref_number);
  if v_e.status <> 'archived' then
    return jsonb_build_object('enquiry_id', v_e.id, 'ref', v_ref, 'status', v_e.status, 'changed', false);
  end if;
  v_to := coalesce(v_e.archived_from, 'new');

  update hq.enquiries set status = v_to, archived_at = null, archived_by = null, archived_from = null, archive_reason = null
  where id = v_e.id
  returning * into v_e;

  perform hq_private.audit_write('restore', 'enquiry', v_e.id,
    'Restored website enquiry ' || v_ref || ' to ' || v_to::text,
    jsonb_build_object('status', jsonb_build_object('from', 'archived', 'to', v_to), 'restored_by', v_caller));

  return jsonb_build_object('enquiry_id', v_e.id, 'ref', v_ref, 'status', v_e.status, 'changed', true);
end $$;
comment on function hq.restore_enquiry(uuid) is 'growth.write. Brings an archived website enquiry back to the status it had before it was archived (new or in_progress) and clears the archive stamps. Idempotent. Audited. Returns {enquiry_id, ref, status, changed}.';

-- ------------------------------------------------------------------ set_enquiry_status (0134) with the archive stamps
create or replace function hq.set_enquiry_status(p_id uuid, p_status hq.enquiry_status, p_note text default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_caller uuid := hq_private.require_staff();
  v_e hq.enquiries;
  v_old hq.enquiry_status;
  v_note text;
  v_ref text;
begin
  perform hq_private.require_capability('growth.write');
  if p_status is null then
    raise exception 'choose a status' using errcode = 'invalid_parameter_value';
  end if;
  if p_status = 'spam' then
    raise exception 'use mark_enquiry_spam to mark an enquiry as spam' using errcode = 'invalid_parameter_value', hint = 'use_mark_enquiry_spam';
  end if;
  v_note := hq_private.enquiry_line(p_note, 500, 'the note');
  select * into v_e from hq.enquiries e where e.id = p_id for update;
  if not found then
    raise exception 'enquiry not found' using errcode = 'no_data_found';
  end if;
  v_ref := hq_private.enquiry_ref(v_e.ref_number);
  v_old := v_e.status;
  if v_old = p_status and v_note is null then
    return jsonb_build_object('enquiry_id', v_e.id, 'ref', v_ref, 'status', v_e.status, 'changed', false);
  end if;

  update hq.enquiries set status = p_status,
    spam_marked_by = null, spam_marked_at = null,
    handled_by = case when p_status = 'new' then null else v_caller end,
    handled_at = case when p_status = 'new' then null else now() end,
    status_note = coalesce(v_note, status_note),
    archived_at = case when p_status <> 'archived' then null when v_old = 'archived' then archived_at else now() end,
    archived_by = case when p_status <> 'archived' then null when v_old = 'archived' then archived_by else v_caller end,
    archived_from = case when p_status <> 'archived' then null when v_old = 'archived' then archived_from
                         when v_old in ('new', 'in_progress') then v_old else 'new' end,
    archive_reason = case when p_status <> 'archived' then null else archive_reason end
  where id = v_e.id
  returning * into v_e;

  perform hq_private.audit_write('status_change', 'enquiry', v_e.id,
    'Website enquiry ' || v_ref || ': ' || v_old::text || ' to ' || p_status::text || coalesce(' [' || v_note || ']', ''),
    jsonb_build_object('status', jsonb_build_object('from', v_old, 'to', p_status)));

  return jsonb_build_object('enquiry_id', v_e.id, 'ref', v_ref, 'status', v_e.status, 'changed', true);
end $$;
comment on function hq.set_enquiry_status(uuid, hq.enquiry_status, text) is 'growth.write. Sets a website enquiry to new, in_progress or archived (spam only through mark_enquiry_spam; leaving spam clears the stamp). Stamps who handled it; archived also records when, by whom and the status it had (as archive_enquiry), and leaving archived clears that. Audited. Returns {enquiry_id, ref, status, changed}.';

-- ------------------------------------------------------------------ the list, with the archive (columns appended; same rules as 0136)
create or replace view hq.enquiry_overview with (security_invoker = true) as
select
  e.id,
  e.ref_number,
  'ENQ-' || lpad(e.ref_number::text, greatest(4, length(e.ref_number::text)), '0') as ref,
  e.kind,
  e.status,
  e.received_at,
  e.name,
  e.email,
  e.phone,
  e.suburb,
  e.message,
  e.details,
  e.source_page,
  e.opportunity_id,
  case when o.id is not null then 'LEAD-' || lpad(o.display_number::text, greatest(4, length(o.display_number::text)), '0') end as lead_ref,
  o.stage as lead_stage,
  (o.id is not null and o.deleted_at is null) as lead_live,
  o.assigned_to as owner_id,
  asg.full_name as owner_name,
  e.contact_id,
  c.full_name as contact_name,
  c.contact_kind,
  e.task_id,
  e.created_lead,
  e.created_contact,
  e.handled_by,
  hb.full_name as handled_by_name,
  e.handled_at,
  e.spam_marked_by,
  e.spam_marked_at,
  e.status_note,
  e.updated_at,
  e.auto_reply_status,
  e.auto_reply_at,
  e.auto_reply_reason,
  e.interaction_id,
  e.auto_reply_interaction_id,
  e.archived_at,
  e.archived_by,
  ab.full_name as archived_by_name,
  e.archived_from,
  e.archive_reason
from hq.enquiries e
left join hq.opportunities o on o.id = e.opportunity_id
left join hq.staff_profiles asg on asg.id = o.assigned_to
left join hq.contacts c on c.id = e.contact_id
left join hq.staff_profiles hb on hb.id = e.handled_by
left join hq.staff_profiles ab on ab.id = e.archived_by;
comment on view hq.enquiry_overview is 'Website enquiries newest first: ENQ ref, kind, status, the submitted fields, the lead (LEAD ref, stage, live), its owner, the contact, who handled it, the automatic thank-you (status, when, why not) and the archive (when, by whom, from which status, why). security_invoker: growth.read.';

revoke all on hq.enquiry_overview from public, anon, authenticated, service_role;
grant select on hq.enquiry_overview to authenticated;
