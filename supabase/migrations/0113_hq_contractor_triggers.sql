-- 0113_hq_contractor_triggers.sql
-- Guard, bookkeeping and audit triggers for Phase 2 (docs/hq-phase-2.md, section 3 "Status rules").
--
-- THE STATUS GUARD (hq_private.contractor_guard). The database, not the screen, decides how a
-- contractor's status moves. It holds for EVERY writer, including the security definer RPCs, the
-- secret key and the table owner:
--   * a contractor is created as prospect, contacted or vetting, never anything else;
--   * approved / preferred are entered only inside hq.approve_contractor, which marks the transaction
--     with hq.contractor_approval = <contractor id> while running as the function owner;
--   * a suspended contractor leaves suspended only to vetting, only inside hq.reinstate_contractor
--     (hq.contractor_reinstate = <contractor id>);
--   * a person's direct update (role authenticated) may move status only among prospect, contacted,
--     vetting and inactive (and into suspended, with a reason); leaving approved / preferred needs
--     hq.set_contractor_status.
-- The transaction marks are honoured only when the writer is NOT an API role (current_user), so a
-- client that could somehow set them still gets nothing. The guard functions are deliberately NOT
-- security definer: current_user must be the real writer.

-- ------------------------------------------------------------------ contractors: guard and normalisation
create function hq_private.contractor_guard() returns trigger
language plpgsql set search_path = pg_catalog, public, extensions as $$
declare
  v_direct constant boolean := current_user in ('authenticated', 'anon');
  v_approving boolean;
  v_reinstating boolean;
begin
  -- normalise: the ABN is stored as digits (whitespace removed); suburbs and regions are trimmed, inner
  -- whitespace collapsed, blanks and case-insensitive repeats dropped (first spelling kept, in order)
  new.abn := nullif(regexp_replace(coalesce(new.abn, ''), '\s', '', 'g'), '');
  new.service_suburbs := array(
    select d.v from (
      select distinct on (lower(t.v)) t.v, t.o
      from (select regexp_replace(btrim(x), '\s+', ' ', 'g') as v, o from unnest(coalesce(new.service_suburbs, '{}'::text[])) with ordinality as u(x, o)) t
      where t.v is not null and t.v <> ''
      order by lower(t.v), t.o) d
    order by d.o);
  new.service_regions := array(
    select d.v from (
      select distinct on (lower(t.v)) t.v, t.o
      from (select regexp_replace(btrim(x), '\s+', ' ', 'g') as v, o from unnest(coalesce(new.service_regions, '{}'::text[])) with ordinality as u(x, o)) t
      where t.v is not null and t.v <> ''
      order by lower(t.v), t.o) d
    order by d.o);

  if tg_op = 'INSERT' then
    if new.status not in ('prospect', 'contacted', 'vetting') then
      raise exception 'a new contractor starts as prospect, contacted or vetting (not %)', new.status
        using errcode = 'insufficient_privilege';
    end if;
    new.approved_at := null;
    new.approved_by := null;
    if v_direct then
      new.licence_verified_at := null;
      new.insurance_verified_at := null;
      new.external_ids := '{}'::jsonb;
    end if;
    return new;
  end if;

  v_approving := not v_direct and coalesce(current_setting('hq.contractor_approval', true), '') = new.id::text;
  v_reinstating := not v_direct and coalesce(current_setting('hq.contractor_reinstate', true), '') = new.id::text;

  if new.status is distinct from old.status then
    if new.status in ('approved', 'preferred') and not v_approving then
      raise exception 'only hq.approve_contractor can make a contractor %', new.status
        using errcode = 'insufficient_privilege';
    end if;
    if old.status = 'suspended' and not (v_reinstating and new.status = 'vetting') then
      raise exception 'a suspended contractor is reinstated only by hq.reinstate_contractor, and only to vetting'
        using errcode = 'insufficient_privilege';
    end if;
    if v_direct and old.status in ('approved', 'preferred') then
      raise exception 'an approved or preferred contractor changes status only through hq.set_contractor_status'
        using errcode = 'insufficient_privilege';
    end if;
    -- a direct status change that does not restate the reason does not inherit the old one
    if v_direct and new.status_reason is not distinct from old.status_reason then
      new.status_reason := null;
    end if;
  end if;

  -- approval stamps: written by approve_contractor; kept while the contractor stays cleared; cleared when it leaves
  if not v_approving then
    if new.status in ('approved', 'preferred') then
      new.approved_at := old.approved_at;
      new.approved_by := old.approved_by;
    else
      new.approved_at := null;
      new.approved_by := null;
    end if;
  end if;

  if v_direct then
    -- verified dates come only from hq.verify_contractor_document; a hand-edited expiry date is no longer the verified one
    new.licence_verified_at := case when new.licence_expires_on is distinct from old.licence_expires_on then null else old.licence_verified_at end;
    new.insurance_verified_at := case when new.insurance_expires_on is distinct from old.insurance_expires_on then null else old.insurance_verified_at end;
    new.external_ids := old.external_ids;
  end if;
  return new;
end $$;

create trigger row_stamp before insert or update on hq.contractors for each row execute function hq_private.row_stamp();
create trigger soft_delete_guard before insert or update on hq.contractors for each row execute function hq_private.soft_delete_guard();
create trigger verification_guard before insert or update on hq.contractors for each row execute function hq_private.verification_guard();
create trigger contractor_guard before insert or update on hq.contractors for each row execute function hq_private.contractor_guard();

-- After insert: the nine checklist rows (not_started) and the first history row. After a status change:
-- a history row; and leaving approved / preferred reopens the final step (review_and_approve is done
-- exactly while the contractor is cleared). The note comes from the transaction-local setting
-- hq.status_note (set by the RPCs), else the status reason.
create function hq_private.contractor_after_write() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_note text := coalesce(nullif(current_setting('hq.status_note', true), ''), nullif(btrim(coalesce(new.status_reason, '')), ''));
begin
  if tg_op = 'INSERT' then
    insert into hq.contractor_vetting_steps (contractor_id, step)
    select new.id, s from unnest(enum_range(null::hq.vetting_step)) as s;
    insert into hq.contractor_status_history (contractor_id, from_status, to_status, changed_by, note)
    values (new.id, null, new.status, auth.uid(), left(v_note, 500));
  elsif new.status is distinct from old.status then
    insert into hq.contractor_status_history (contractor_id, from_status, to_status, changed_by, note)
    values (new.id, old.status, new.status, auth.uid(), left(v_note, 500));
    if old.status in ('approved', 'preferred') and new.status not in ('approved', 'preferred') then
      update hq.contractor_vetting_steps set status = 'not_started', note = null
      where contractor_id = new.id and step = 'review_and_approve' and status <> 'not_started';
    end if;
  end if;
  return null;
end $$;
create trigger after_write after insert or update on hq.contractors for each row execute function hq_private.contractor_after_write();

-- ------------------------------------------------------------------ vetting steps
-- Completion stamps follow the status (set when it becomes done / not_applicable, kept while it stays,
-- cleared when it leaves). review_and_approve leaves not_started only inside hq.approve_contractor.
create function hq_private.vetting_step_guard() returns trigger
language plpgsql set search_path = pg_catalog, public, extensions as $$
begin
  if tg_op = 'UPDATE' and (new.contractor_id is distinct from old.contractor_id or new.step is distinct from old.step) then
    raise exception 'a vetting step cannot be moved to another contractor or step' using errcode = 'insufficient_privilege';
  end if;
  if new.step = 'review_and_approve' and new.status <> 'not_started'
     and not (current_user not in ('authenticated', 'anon')
              and coalesce(current_setting('hq.contractor_approval', true), '') = new.contractor_id::text) then
    raise exception 'the review_and_approve step is completed only by hq.approve_contractor' using errcode = 'insufficient_privilege';
  end if;
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
create trigger vetting_step_guard before insert or update on hq.contractor_vetting_steps for each row execute function hq_private.vetting_step_guard();

-- ------------------------------------------------------------------ documents
-- What was stored is immutable (contractor, path, type of file, size, uploader). The verification
-- fields, the document type and the expiry date change only inside hq.verify_contractor_document
-- (hq.document_verification = <document id>, not an API role). Every new row starts pending.
create function hq_private.contractor_document_guard() returns trigger
language plpgsql set search_path = pg_catalog, public, extensions as $$
declare
  v_verifying boolean;
begin
  if tg_op = 'INSERT' then
    new.verification := 'pending';
    new.verified_by := null;
    new.verified_at := null;
    new.verification_note := null;
    new.uploaded_at := now();
    new.uploaded_by := coalesce(auth.uid(), new.uploaded_by);
    return new;
  end if;
  if new.contractor_id is distinct from old.contractor_id or new.storage_path is distinct from old.storage_path
     or new.file_name is distinct from old.file_name or new.mime_type is distinct from old.mime_type
     or new.size_bytes is distinct from old.size_bytes or new.uploaded_by is distinct from old.uploaded_by
     or new.uploaded_at is distinct from old.uploaded_at then
    raise exception 'a stored document cannot be changed; upload a new one' using errcode = 'insufficient_privilege';
  end if;
  v_verifying := current_user not in ('authenticated', 'anon') and coalesce(current_setting('hq.document_verification', true), '') = new.id::text;
  if not v_verifying and (
       new.verification is distinct from old.verification or new.verified_by is distinct from old.verified_by
       or new.verified_at is distinct from old.verified_at or new.verification_note is distinct from old.verification_note
       or new.document_type is distinct from old.document_type or new.expires_on is distinct from old.expires_on) then
    raise exception 'a document is verified, rejected or re-dated only through hq.verify_contractor_document' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
create trigger row_stamp before insert or update on hq.contractor_documents for each row execute function hq_private.row_stamp();
create trigger soft_delete_guard before insert or update on hq.contractor_documents for each row execute function hq_private.soft_delete_guard();
create trigger contractor_document_guard before insert or update on hq.contractor_documents for each row execute function hq_private.contractor_document_guard();

-- ------------------------------------------------------------------ reviews
create function hq_private.contractor_review_guard() returns trigger
language plpgsql set search_path = pg_catalog, public, extensions as $$
begin
  if tg_op = 'INSERT' then
    new.recorded_by := coalesce(auth.uid(), new.recorded_by);
    return new;
  end if;
  if new.contractor_id is distinct from old.contractor_id or new.recorded_by is distinct from old.recorded_by then
    raise exception 'a review cannot be moved to another contractor or author' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
create trigger row_stamp before insert or update on hq.contractor_reviews for each row execute function hq_private.row_stamp();
create trigger soft_delete_guard before insert or update on hq.contractor_reviews for each row execute function hq_private.soft_delete_guard();
create trigger contractor_review_guard before insert or update on hq.contractor_reviews for each row execute function hq_private.contractor_review_guard();

-- ------------------------------------------------------------------ tasks: reminder_key belongs to create_expiry_tasks
create function hq_private.task_reminder_guard() returns trigger
language plpgsql set search_path = pg_catalog, public, extensions as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.reminder_key := case when tg_op = 'INSERT' then null else old.reminder_key end;
  end if;
  return new;
end $$;
create trigger task_reminder_guard before insert or update on hq.tasks for each row execute function hq_private.task_reminder_guard();

-- ------------------------------------------------------------------ append-only status history
create trigger append_only before update or delete on hq.contractor_status_history
  for each row execute function hq_private.raise_immutable();
create trigger append_only_truncate before truncate on hq.contractor_status_history
  for each statement execute function hq_private.raise_immutable();

-- ------------------------------------------------------------------ settings: the two contractor keys are whole numbers
create or replace function hq_private.settings_guard() returns trigger
language plpgsql set search_path = pg_catalog, public, extensions as $$
declare
  v_max integer;
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
  if new.key in ('contractor_min_reviews_for_rating', 'contractor_expiry_warning_days') then
    v_max := case new.key when 'contractor_min_reviews_for_rating' then 100 else 365 end;
    if jsonb_typeof(new.value) is distinct from 'number' or (new.value #>> '{}') !~ '^[0-9]{1,3}$' then
      raise exception '% must be a whole number from 1 to %', new.key, v_max using errcode = 'invalid_parameter_value';
    end if;
    if (new.value #>> '{}')::integer not between 1 and v_max then
      raise exception '% must be a whole number from 1 to %', new.key, v_max using errcode = 'invalid_parameter_value';
    end if;
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;

-- ------------------------------------------------------------------ audit (0105 extended)
-- Same function as 0105 with three additions: contractor rows are labelled by business name, a status
-- change is recorded as status_change "(from to to)", and a vetting step (no id column) is filed under
-- its contractor's id with the step as the label.
create or replace function hq_private.audit_row() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_entity text := tg_argv[0];
  v_new jsonb;
  v_old jsonb;
  v_row jsonb;
  v_changes jsonb := '{}'::jsonb;
  -- bookkeeping and derived columns never appear in a diff
  v_skip constant text[] := array['id', 'created_at', 'created_by', 'updated_at', 'deleted_by', 'updated_by', 'name_key', 'ref_number', 'display_number'];
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
    when tg_table_name = 'opportunities' and v_old ->> 'stage' is distinct from v_new ->> 'stage' then 'stage_change'
    when tg_table_name = 'contractors' and v_old ->> 'status' is distinct from v_new ->> 'status' then 'status_change'
    else 'update'
  end;

  v_label := coalesce(
    case when tg_table_name = 'referrals' then 'REF-' || lpad(v_row ->> 'ref_number', 4, '0') end,
    case when tg_table_name = 'role_capabilities' then (v_row ->> 'role') || ' ' || (v_row ->> 'capability') end,
    case when tg_table_name = 'interactions' then v_row ->> 'interaction_type' end,
    case when tg_table_name = 'contractor_vetting_steps' then replace(v_row ->> 'step', '_', ' ') || ' ' || replace(v_row ->> 'status', '_', ' ') end,
    case when tg_table_name = 'contractor_documents' then replace(v_row ->> 'document_type', '_', ' ') || ' ' || (v_row ->> 'file_name') end,
    case when tg_table_name = 'contractor_reviews' then v_row ->> 'job_reference' end,
    v_row ->> 'name', v_row ->> 'full_name', v_row ->> 'business_name', v_row ->> 'prospect_name', v_row ->> 'title', v_row ->> 'key');

  v_summary := initcap(replace(v_action, '_', ' ')) || ' ' || v_entity
    || coalesce(': ' || v_label, '')
    || case when v_action = 'stage_change' then ' (' || (v_old ->> 'stage') || ' to ' || (v_new ->> 'stage') || ')'
            when tg_table_name = 'contractors' and tg_op = 'UPDATE' and v_old ->> 'status' is distinct from v_new ->> 'status'
              then ' (' || (v_old ->> 'status') || ' to ' || (v_new ->> 'status') || ')'
            else '' end
    || coalesce(' [' || v_note || ']', '');

  insert into hq.audit_events (actor_id, actor_name, action, entity_type, entity_id, summary, changes)
  values (
    v_actor,
    coalesce((select sp.full_name from hq.staff_profiles sp where sp.id = v_actor), case when v_actor is null then 'System' end),
    v_action, v_entity,
    case when v_row ? 'id' then (v_row ->> 'id')::uuid
         when tg_table_name = 'contractor_vetting_steps' then (v_row ->> 'contractor_id')::uuid end,
    left(v_summary, 500), v_changes);
  return null;
end $$;

create trigger audit after insert or update or delete on hq.contractors for each row execute function hq_private.audit_row('contractor');
create trigger audit after insert or update or delete on hq.contractor_documents for each row execute function hq_private.audit_row('contractor_document');
create trigger audit after insert or update or delete on hq.contractor_reviews for each row execute function hq_private.audit_row('contractor_review');
-- the nine rows made with a contractor are part of its creation; changes to a step are audited
create trigger audit after update on hq.contractor_vetting_steps for each row execute function hq_private.audit_row('contractor_vetting_step');

revoke execute on all functions in schema hq_private from public, anon;
