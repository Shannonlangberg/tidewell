-- 0116_hq_contractor_rpc.sql
-- Phase 2 RPCs (docs/hq-phase-2.md, section 5): set_vetting_step, preview_contractor_approval,
-- approve_contractor, set_contractor_status, reinstate_contractor, add_contractor_document,
-- verify_contractor_document, record_contractor_review, record_contractor_contact, contractor_summary,
-- create_expiry_tasks. (Import, search and archive are in 0117.)
--
-- Each is `security definer`, pins its search_path, checks the caller's capability INSIDE (live staff
-- row + MFA), is one transaction, and is audited (the 0105/0113 row triggers, with a semantic action
-- or note set through hq_private.audit_context where it helps). Execute: authenticated only (0118).
-- Errors: 42501 permission denied, 22023 invalid argument, P0002 not found, 23505 already exists,
-- 23514 a rule refuses the change (for example an incomplete checklist).
-- Contractors themselves are created and edited by direct insert / update under RLS (0114 column
-- grants, 0113 guard): a new contractor is always prospect, contacted or vetting.

-- ------------------------------------------------------------------ internal helpers
create function hq_private.setting_int(p_key text, p_default integer) returns integer
language sql stable security definer set search_path = pg_catalog, public, extensions as $$
  select coalesce((select (s.value #>> '{}')::integer from hq.settings s where s.key = p_key and jsonb_typeof(s.value) = 'number'), p_default)
$$;

-- Steps 1 to 8 that are neither done nor not_applicable, in checklist order.
create function hq_private.contractor_missing_steps(p_contractor uuid) returns text[]
language sql stable security definer set search_path = pg_catalog, public, extensions as $$
  select coalesce(array_agg(s.step::text order by s.step), '{}'::text[])
  from hq.contractor_vetting_steps s
  where s.contractor_id = p_contractor and s.step <> 'review_and_approve' and s.status not in ('done', 'not_applicable')
$$;

-- The warnings shown before an approval is confirmed (section 3). They inform; they never block.
--   insurance_not_verified   no verified insurance on file: neither the contractor's insurance (verified,
--                            expiry today or later) nor a live verified public_liability_insurance
--                            document with an expiry today or later
--   insurance_expired / insurance_expiring_soon / licence_expired / licence_expiring_soon
--                            from the contractor's insurance / licence state (hq_private.expiry_state)
--   no_service_suburbs       no service suburb recorded
--   rates_unknown            none of hourly rate, call-out fee, after-hours fee, minimum charge recorded
-- Each warning: {code, message} plus expires_on and days_remaining for the expiry ones.
create function hq_private.contractor_approval_warnings(p_contractor uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_c hq.contractors;
  v_today date := hq.today();
  v_days integer := hq_private.setting_int('contractor_expiry_warning_days', 30);
  v_ins text;
  v_lic text;
  v_out jsonb := '[]'::jsonb;
begin
  select c.* into v_c from hq.contractors c where c.id = p_contractor;
  v_ins := hq_private.expiry_state(v_c.insurance_expires_on, v_c.insurance_verified_at is not null,
             nullif(btrim(coalesce(v_c.insurance_details, '')), '') is not null, v_today, v_days);
  v_lic := hq_private.expiry_state(v_c.licence_expires_on, v_c.licence_verified_at is not null,
             nullif(btrim(coalesce(v_c.licence_details, '')), '') is not null, v_today, v_days);

  if not ((v_c.insurance_verified_at is not null and v_c.insurance_expires_on >= v_today)
          or exists (select 1 from hq.contractor_documents d
                     where d.contractor_id = v_c.id and d.deleted_at is null and d.document_type = 'public_liability_insurance'
                       and d.verification = 'verified' and d.expires_on >= v_today)) then
    v_out := v_out || jsonb_build_object('code', 'insurance_not_verified', 'message', 'No verified insurance on file.');
  end if;
  if v_ins = 'expired' then
    v_out := v_out || jsonb_build_object('code', 'insurance_expired', 'message', 'Insurance expired on ' || to_char(v_c.insurance_expires_on, 'FMDD Mon YYYY') || '.',
                                         'expires_on', v_c.insurance_expires_on, 'days_remaining', v_c.insurance_expires_on - v_today);
  elsif v_ins = 'expiring_soon' then
    v_out := v_out || jsonb_build_object('code', 'insurance_expiring_soon', 'message', 'Insurance expires on ' || to_char(v_c.insurance_expires_on, 'FMDD Mon YYYY') || '.',
                                         'expires_on', v_c.insurance_expires_on, 'days_remaining', v_c.insurance_expires_on - v_today);
  end if;
  if v_lic = 'expired' then
    v_out := v_out || jsonb_build_object('code', 'licence_expired', 'message', 'Licence expired on ' || to_char(v_c.licence_expires_on, 'FMDD Mon YYYY') || '.',
                                         'expires_on', v_c.licence_expires_on, 'days_remaining', v_c.licence_expires_on - v_today);
  elsif v_lic = 'expiring_soon' then
    v_out := v_out || jsonb_build_object('code', 'licence_expiring_soon', 'message', 'Licence expires on ' || to_char(v_c.licence_expires_on, 'FMDD Mon YYYY') || '.',
                                         'expires_on', v_c.licence_expires_on, 'days_remaining', v_c.licence_expires_on - v_today);
  end if;
  if cardinality(v_c.service_suburbs) = 0 then
    v_out := v_out || jsonb_build_object('code', 'no_service_suburbs', 'message', 'No service suburbs recorded.');
  end if;
  if v_c.hourly_rate_cents is null and v_c.callout_fee_cents is null and v_c.after_hours_fee_cents is null and v_c.minimum_charge_cents is null then
    v_out := v_out || jsonb_build_object('code', 'rates_unknown', 'message', 'Rates are not recorded.');
  end if;
  return v_out;
end $$;

-- ------------------------------------------------------------------ set_vetting_step
-- Sets one checklist step to exactly the status and note given (a null note clears it). Idempotent:
-- the same status and note again changes nothing. not_applicable needs a note. The final step,
-- review_and_approve, is completed only by approve_contractor. Never changes the contractor's status.
create function hq.set_vetting_step(
  p_contractor uuid,
  p_step hq.vetting_step,
  p_status hq.vetting_step_status,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_step hq.contractor_vetting_steps;
  v_changed boolean := false;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('contractors.write');
  if p_step is null or p_status is null then
    raise exception 'a step and a status are required' using errcode = 'invalid_parameter_value';
  end if;
  if p_step = 'review_and_approve' then
    raise exception 'the final step is completed by approving the contractor (approve_contractor)' using errcode = 'invalid_parameter_value';
  end if;
  if p_status = 'not_applicable' and v_note is null then
    raise exception 'a step marked not applicable needs a note saying why' using errcode = 'invalid_parameter_value';
  end if;
  perform 1 from hq.contractors c where c.id = p_contractor and c.deleted_at is null for update;
  if not found then
    raise exception 'contractor not found' using errcode = 'no_data_found';
  end if;
  select s.* into v_step from hq.contractor_vetting_steps s where s.contractor_id = p_contractor and s.step = p_step for update;
  if v_step.status is distinct from p_status or v_step.note is distinct from v_note then
    update hq.contractor_vetting_steps set status = p_status, note = v_note
    where contractor_id = p_contractor and step = p_step
    returning * into v_step;
    v_changed := true;
  end if;
  return jsonb_build_object(
    'contractor_id', p_contractor, 'step', v_step.step, 'status', v_step.status, 'note', v_step.note,
    'completed_at', v_step.completed_at, 'completed_by', v_step.completed_by, 'changed', v_changed,
    'vetting_done_count', (select count(*) from hq.contractor_vetting_steps s where s.contractor_id = p_contractor and s.status in ('done', 'not_applicable')));
end $$;
comment on function hq.set_vetting_step(uuid, hq.vetting_step, hq.vetting_step_status, text) is 'contractors.write. Sets one checklist step (status and note exactly as given). Idempotent. not_applicable needs a note. review_and_approve is refused (approve_contractor completes it). Never changes status.';

-- ------------------------------------------------------------------ preview_contractor_approval
-- What the approve dialog shows BEFORE the person confirms: whether approval is possible, what blocks
-- it, the unfinished steps and the warnings approve_contractor will return. Writes nothing.
create function hq.preview_contractor_approval(p_contractor uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_c hq.contractors;
  v_missing text[];
  v_blocked text[] := '{}'::text[];
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('contractors.read');
  select c.* into v_c from hq.contractors c where c.id = p_contractor and c.deleted_at is null;
  if not found then
    raise exception 'contractor not found' using errcode = 'no_data_found';
  end if;
  v_missing := hq_private.contractor_missing_steps(v_c.id);
  if not hq_private.has_capability('contractors.approve') then v_blocked := v_blocked || 'not_permitted'::text; end if;
  if v_c.status = 'suspended' then v_blocked := v_blocked || 'suspended'::text; end if;
  if v_c.status = 'inactive' then v_blocked := v_blocked || 'inactive'::text; end if;
  if cardinality(v_missing) > 0 then v_blocked := v_blocked || 'checklist_incomplete'::text; end if;
  return jsonb_build_object(
    'contractor_id', v_c.id,
    'status', v_c.status,
    'can_approve', cardinality(v_blocked) = 0,
    'blocked_by', to_jsonb(v_blocked),
    'missing_steps', to_jsonb(v_missing),
    'warnings', hq_private.contractor_approval_warnings(v_c.id));
end $$;
comment on function hq.preview_contractor_approval(uuid) is 'contractors.read. {contractor_id, status, can_approve, blocked_by[] (not_permitted | suspended | inactive | checklist_incomplete), missing_steps[], warnings[]}. Writes nothing.';

-- ------------------------------------------------------------------ approve_contractor
-- The ONLY way to approved / preferred (the 0113 guard enforces it). contractors.approve; a note is
-- required; refused for a suspended or inactive contractor and while any of steps 1 to 8 is neither
-- done nor not_applicable. Completes step 9, stamps approved_at / approved_by, writes history and an
-- audit row (action approve or prefer). It does NOT require a document: the warnings are returned for
-- the record and are the same list preview_contractor_approval shows before confirming.
-- p_make_preferred true -> preferred, false -> approved (so it also moves preferred back to approved).
-- Asking for the status the contractor already has changes nothing (changed false).
create function hq.approve_contractor(
  p_contractor uuid,
  p_make_preferred boolean default false,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_caller uuid := hq_private.require_staff();
  v_c hq.contractors;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_target hq.contractor_status := case when coalesce(p_make_preferred, false) then 'preferred'::hq.contractor_status else 'approved'::hq.contractor_status end;
  v_missing text[];
  v_warnings jsonb;
begin
  perform hq_private.require_capability('contractors.approve');
  select c.* into v_c from hq.contractors c where c.id = p_contractor and c.deleted_at is null for update;
  if not found then
    raise exception 'contractor not found' using errcode = 'no_data_found';
  end if;
  if v_c.status = 'suspended' then
    raise exception 'a suspended contractor must be reinstated (back to vetting) before it can be approved' using errcode = 'check_violation';
  end if;
  if v_c.status = 'inactive' then
    raise exception 'an inactive contractor must be moved back to vetting before it can be approved' using errcode = 'check_violation';
  end if;
  if v_note is null then
    raise exception 'an approval needs a note' using errcode = 'invalid_parameter_value';
  end if;
  v_missing := hq_private.contractor_missing_steps(v_c.id);
  if cardinality(v_missing) > 0 then
    raise exception 'the vetting checklist is not complete' using errcode = 'check_violation',
      detail = 'not done: ' || array_to_string(v_missing, ', ');
  end if;
  v_warnings := hq_private.contractor_approval_warnings(v_c.id);
  if v_c.status = v_target then
    return jsonb_build_object('contractor_id', v_c.id, 'status', v_c.status, 'previous_status', v_c.status, 'changed', false, 'warnings', v_warnings);
  end if;

  perform set_config('hq.contractor_approval', v_c.id::text, true);
  perform set_config('hq.status_note', left(v_note, 500), true);
  perform hq_private.audit_context(case when v_target = 'preferred' then 'prefer' else 'approve' end, left(v_note, 200));
  update hq.contractors set status = v_target, approved_at = now(), approved_by = v_caller where id = v_c.id;
  perform hq_private.audit_context(null, left(v_note, 200));
  update hq.contractor_vetting_steps set status = 'done', note = left(v_note, 2000)
  where contractor_id = v_c.id and step = 'review_and_approve';
  perform hq_private.audit_context();
  perform set_config('hq.status_note', '', true);
  perform set_config('hq.contractor_approval', '', true);

  return jsonb_build_object('contractor_id', v_c.id, 'status', v_target, 'previous_status', v_c.status, 'changed', true, 'warnings', v_warnings);
end $$;
comment on function hq.approve_contractor(uuid, boolean, text) is 'contractors.approve. The only path to approved / preferred. Needs a note and steps 1-8 done or not_applicable; refused when suspended or inactive. Completes review_and_approve. Returns {contractor_id, status, previous_status, changed, warnings[]}.';

-- ------------------------------------------------------------------ set_contractor_status
-- Every other move: prospect, contacted, vetting, suspended, inactive. contractors.write (suspending is
-- a safety action and must be quick). suspended needs a note. Refused: approved / preferred (use
-- approve_contractor) and leaving suspended (use reinstate_contractor). The note becomes status_reason.
create function hq.set_contractor_status(
  p_contractor uuid,
  p_status hq.contractor_status,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_c hq.contractors;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('contractors.write');
  if p_status is null then
    raise exception 'a status is required' using errcode = 'invalid_parameter_value';
  end if;
  if p_status in ('approved', 'preferred') then
    raise exception 'only approve_contractor can make a contractor %', p_status using errcode = 'insufficient_privilege';
  end if;
  select c.* into v_c from hq.contractors c where c.id = p_contractor and c.deleted_at is null for update;
  if not found then
    raise exception 'contractor not found' using errcode = 'no_data_found';
  end if;
  if v_c.status = p_status then
    return jsonb_build_object('contractor_id', v_c.id, 'status', v_c.status, 'previous_status', v_c.status, 'changed', false);
  end if;
  if v_c.status = 'suspended' then
    raise exception 'a suspended contractor is reinstated only by reinstate_contractor (contractors.approve)' using errcode = 'insufficient_privilege';
  end if;
  if p_status = 'suspended' and v_note is null then
    raise exception 'suspending a contractor needs a note saying why' using errcode = 'invalid_parameter_value';
  end if;

  perform set_config('hq.status_note', coalesce(left(v_note, 500), ''), true);
  perform hq_private.audit_context(case when p_status = 'suspended' then 'suspend' end, left(v_note, 200));
  update hq.contractors set status = p_status, status_reason = v_note where id = v_c.id;
  perform hq_private.audit_context();
  perform set_config('hq.status_note', '', true);

  return jsonb_build_object('contractor_id', v_c.id, 'status', p_status, 'previous_status', v_c.status, 'changed', true);
end $$;
comment on function hq.set_contractor_status(uuid, hq.contractor_status, text) is 'contractors.write. Moves status among prospect, contacted, vetting, suspended (needs a note), inactive, including out of approved / preferred. Never into approved / preferred; never out of suspended. Returns {contractor_id, status, previous_status, changed}.';

-- ------------------------------------------------------------------ reinstate_contractor
create function hq.reinstate_contractor(p_contractor uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_c hq.contractors;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('contractors.approve');
  select c.* into v_c from hq.contractors c where c.id = p_contractor and c.deleted_at is null for update;
  if not found then
    raise exception 'contractor not found' using errcode = 'no_data_found';
  end if;
  if v_c.status <> 'suspended' then
    raise exception 'only a suspended contractor can be reinstated' using errcode = 'invalid_parameter_value';
  end if;
  perform set_config('hq.contractor_reinstate', v_c.id::text, true);
  perform set_config('hq.status_note', coalesce(left(v_note, 500), ''), true);
  perform hq_private.audit_context('reinstate', left(v_note, 200));
  update hq.contractors set status = 'vetting', status_reason = v_note where id = v_c.id;
  perform hq_private.audit_context();
  perform set_config('hq.status_note', '', true);
  perform set_config('hq.contractor_reinstate', '', true);
  return jsonb_build_object('contractor_id', v_c.id, 'status', 'vetting', 'previous_status', 'suspended', 'changed', true);
end $$;
comment on function hq.reinstate_contractor(uuid, text) is 'contractors.approve. Returns a suspended contractor to vetting (never straight to approved). Returns {contractor_id, status, previous_status, changed}.';

-- ------------------------------------------------------------------ add_contractor_document
-- Registers a file the caller has ALREADY uploaded to the private bucket (signed upload URL, see the
-- design). The object must exist at p_storage_path = <contractor id>/<document uuid>-<sanitised name>
-- (sanitised name: 1-120 of A-Z a-z 0-9 . _ -), and its stored size and type must equal what was
-- declared. The document uuid in the path becomes the row id. New documents are pending.
create function hq.add_contractor_document(
  p_contractor uuid,
  p_document_type hq.contractor_document_type,
  p_file_name text,
  p_storage_path text,
  p_mime_type text,
  p_size_bytes bigint,
  p_expires_on date default null,
  p_notes text default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_file text := btrim(coalesce(p_file_name, ''));
  v_path text := btrim(coalesce(p_storage_path, ''));
  v_mime text := lower(btrim(coalesce(p_mime_type, '')));
  v_meta jsonb;
  v_id uuid;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('contractors.documents');
  if p_document_type is null then
    raise exception 'a document type is required' using errcode = 'invalid_parameter_value';
  end if;
  if v_file = '' or char_length(v_file) > 255 then
    raise exception 'a file name (at most 255 characters) is required' using errcode = 'invalid_parameter_value';
  end if;
  if v_mime not in ('application/pdf', 'image/jpeg', 'image/png') then
    raise exception 'only PDF, JPEG and PNG files are accepted' using errcode = 'invalid_parameter_value';
  end if;
  if p_size_bytes is null or p_size_bytes <= 0 or p_size_bytes > 10485760 then
    raise exception 'a file must be larger than 0 bytes and at most 10 MiB' using errcode = 'invalid_parameter_value';
  end if;
  perform 1 from hq.contractors c where c.id = p_contractor and c.deleted_at is null for share;
  if not found then
    raise exception 'contractor not found' using errcode = 'no_data_found';
  end if;
  if v_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9._-]{1,120}$'
     or split_part(v_path, '/', 1) <> p_contractor::text then
    raise exception 'the storage path must be <contractor id>/<document uuid>-<file name> for this contractor' using errcode = 'invalid_parameter_value';
  end if;
  v_id := left(split_part(v_path, '/', 2), 36)::uuid;
  if exists (select 1 from hq.contractor_documents d where d.id = v_id or d.storage_path = v_path) then
    raise exception 'that file is already registered' using errcode = 'unique_violation';
  end if;
  select o.metadata into v_meta from storage.objects o where o.bucket_id = 'contractor-documents' and o.name = v_path;
  if not found then
    raise exception 'the uploaded file was not found in storage' using errcode = 'no_data_found';
  end if;
  if (v_meta ->> 'size') is null or (v_meta ->> 'size')::bigint <> p_size_bytes then
    raise exception 'the stored file size does not match the declared size' using errcode = 'invalid_parameter_value';
  end if;
  if lower(btrim(split_part(coalesce(v_meta ->> 'mimetype', ''), ';', 1))) <> v_mime then
    raise exception 'the stored file type does not match the declared type' using errcode = 'invalid_parameter_value';
  end if;

  insert into hq.contractor_documents (id, contractor_id, document_type, file_name, storage_path, mime_type, size_bytes, expires_on, notes)
  values (v_id, p_contractor, p_document_type, v_file, v_path, v_mime, p_size_bytes, p_expires_on, nullif(btrim(coalesce(p_notes, '')), ''));

  return jsonb_build_object('document_id', v_id, 'contractor_id', p_contractor, 'storage_path', v_path, 'verification', 'pending');
end $$;
comment on function hq.add_contractor_document(uuid, hq.contractor_document_type, text, text, text, bigint, date, text) is 'contractors.documents. Registers an uploaded object: it must exist in contractor-documents at <contractor id>/<document uuid>-<name> with the declared size and type. Returns {document_id, contractor_id, storage_path, verification}.';

-- ------------------------------------------------------------------ verify_contractor_document
-- Sets a document's verification (verified | rejected | pending), stamping who and when (cleared for
-- pending); rejected needs a note. p_expires_on, when given, records the document's expiry date.
-- p_apply_to_contractor (only for a verified licence or public_liability_insurance document) records
-- licence_verified_at / licence_expires_on or insurance_verified_at / insurance_expires_on on the
-- contractor: verified_at = hq.today(), expires_on = the document's expiry. Explicit and audited; it
-- NEVER changes the contractor's status.
create function hq.verify_contractor_document(
  p_document uuid,
  p_verification hq.document_verification,
  p_expires_on date default null,
  p_note text default null,
  p_apply_to_contractor boolean default false
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_caller uuid := hq_private.require_staff();
  v_d hq.contractor_documents;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_apply boolean := coalesce(p_apply_to_contractor, false);
  v_changed boolean := false;
begin
  perform hq_private.require_capability('contractors.documents');
  if p_verification is null then
    raise exception 'a verification (verified, rejected or pending) is required' using errcode = 'invalid_parameter_value';
  end if;
  if p_verification = 'rejected' and v_note is null then
    raise exception 'a rejected document needs a note saying why' using errcode = 'invalid_parameter_value';
  end if;
  select d.* into v_d from hq.contractor_documents d where d.id = p_document and d.deleted_at is null for update;
  if not found then
    raise exception 'document not found' using errcode = 'no_data_found';
  end if;
  perform 1 from hq.contractors c where c.id = v_d.contractor_id and c.deleted_at is null for update;
  if not found then
    raise exception 'contractor not found' using errcode = 'no_data_found';
  end if;
  if v_apply and p_verification <> 'verified' then
    raise exception 'only a verified document can be applied to the contractor' using errcode = 'invalid_parameter_value';
  end if;
  if v_apply and v_d.document_type not in ('licence', 'public_liability_insurance') then
    raise exception 'only a licence or public liability insurance document can be applied to the contractor' using errcode = 'invalid_parameter_value';
  end if;

  if v_d.verification is distinct from p_verification or v_d.verification_note is distinct from v_note
     or (p_expires_on is not null and v_d.expires_on is distinct from p_expires_on) then
    perform set_config('hq.document_verification', v_d.id::text, true);
    perform hq_private.audit_context(case p_verification when 'verified' then 'verify' when 'rejected' then 'reject' else null end, left(v_note, 200));
    update hq.contractor_documents set
      verification = p_verification,
      verified_by = case when p_verification = 'pending' then null else v_caller end,
      verified_at = case when p_verification = 'pending' then null else now() end,
      verification_note = v_note,
      expires_on = coalesce(p_expires_on, expires_on)
    where id = v_d.id
    returning * into v_d;
    perform hq_private.audit_context();
    perform set_config('hq.document_verification', '', true);
    v_changed := true;
  end if;

  if v_apply then
    perform hq_private.audit_context('apply_document', left(replace(v_d.document_type::text, '_', ' ') || ' ' || v_d.file_name, 200));
    if v_d.document_type = 'licence' then
      update hq.contractors set licence_verified_at = hq.today(), licence_expires_on = v_d.expires_on where id = v_d.contractor_id;
    else
      update hq.contractors set insurance_verified_at = hq.today(), insurance_expires_on = v_d.expires_on where id = v_d.contractor_id;
    end if;
    perform hq_private.audit_context();
  end if;

  return jsonb_build_object('document_id', v_d.id, 'contractor_id', v_d.contractor_id, 'verification', v_d.verification,
                            'expires_on', v_d.expires_on, 'changed', v_changed, 'applied_to_contractor', v_apply);
end $$;
comment on function hq.verify_contractor_document(uuid, hq.document_verification, date, text, boolean) is 'contractors.documents. Verifies, rejects (note required) or resets a document; optionally applies a verified licence / public liability insurance to the contractor''s verified and expiry dates. Never changes status. Returns {document_id, contractor_id, verification, expires_on, changed, applied_to_contractor}.';

-- ------------------------------------------------------------------ record_contractor_review
-- Feedback on one job. Each rating 1 to 5 or null; at least one rating or a note; the job date cannot
-- be in the future. A job date later than the contractor's last_job_date moves last_job_date forward.
create function hq.record_contractor_review(
  p_contractor uuid,
  p_job_date date default null,
  p_job_reference text default null,
  p_response_time integer default null,
  p_communication integer default null,
  p_work_quality integer default null,
  p_invoice_accuracy integer default null,
  p_tenant_feedback hq.tenant_feedback default null,
  p_rework_required boolean default null,
  p_notes text default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_review uuid;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('contractors.write');
  if exists (select 1 from unnest(array[p_response_time, p_communication, p_work_quality, p_invoice_accuracy]) r where r is not null and r not between 1 and 5) then
    raise exception 'each rating is a whole number from 1 to 5' using errcode = 'invalid_parameter_value';
  end if;
  if num_nonnulls(p_response_time, p_communication, p_work_quality, p_invoice_accuracy) = 0 and v_notes is null then
    raise exception 'give at least one rating or a note' using errcode = 'invalid_parameter_value';
  end if;
  if p_job_date is not null and p_job_date > hq.today() then
    raise exception 'the job date cannot be in the future' using errcode = 'invalid_parameter_value';
  end if;
  perform 1 from hq.contractors c where c.id = p_contractor and c.deleted_at is null for update;
  if not found then
    raise exception 'contractor not found' using errcode = 'no_data_found';
  end if;

  insert into hq.contractor_reviews (contractor_id, job_date, job_reference, response_time, communication, work_quality, invoice_accuracy,
                                     tenant_feedback, rework_required, notes)
  values (p_contractor, p_job_date, nullif(btrim(coalesce(p_job_reference, '')), ''), p_response_time, p_communication, p_work_quality,
          p_invoice_accuracy, p_tenant_feedback, p_rework_required, v_notes)
  returning id into v_review;

  if p_job_date is not null then
    update hq.contractors set last_job_date = p_job_date
    where id = p_contractor and (last_job_date is null or last_job_date < p_job_date);
  end if;
  return jsonb_build_object('review_id', v_review, 'contractor_id', p_contractor);
end $$;
comment on function hq.record_contractor_review(uuid, date, text, integer, integer, integer, integer, hq.tenant_feedback, boolean, text) is 'contractors.write. Records job feedback (ratings 1-5, each optional; at least one rating or a note). Moves last_job_date forward. Returns {review_id, contractor_id}.';

-- ------------------------------------------------------------------ record_contractor_contact
-- One transaction: log the call / meeting / email in interactions (contractor_id), optionally create
-- the follow-up task (related_contractor_id, source interaction), optionally move a PROSPECT to
-- contacted (p_new_status may only be null or contacted; any other status is unchanged, never raised).
create function hq.record_contractor_contact(
  p_contractor uuid,
  p_type hq.interaction_type default null,
  p_occurred_at timestamptz default null,
  p_summary text default null,
  p_next_action text default null,
  p_follow_up_date date default null,
  p_create_task boolean default false,
  p_task_assignee uuid default null,
  p_new_status hq.contractor_status default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_caller uuid := hq_private.require_staff();
  v_c hq.contractors;
  v_when timestamptz := coalesce(p_occurred_at, now());
  v_summary text := btrim(coalesce(p_summary, ''));
  v_interaction uuid;
  v_task uuid;
  v_assignee uuid := coalesce(p_task_assignee, v_caller);
  v_status_changed boolean := false;
begin
  perform hq_private.require_capability('contractors.write');
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
  if v_when > now() + interval '1 hour' then
    raise exception 'a contact cannot have occurred in the future' using errcode = 'invalid_parameter_value';
  end if;
  if p_new_status is not null and p_new_status <> 'contacted' then
    raise exception 'logging a contact can only move a prospect to contacted' using errcode = 'invalid_parameter_value';
  end if;
  select c.* into v_c from hq.contractors c where c.id = p_contractor and c.deleted_at is null for update;
  if not found then
    raise exception 'contractor not found' using errcode = 'no_data_found';
  end if;

  insert into hq.interactions (contractor_id, interaction_type, occurred_at, summary, staff_id, next_action, follow_up_date)
  values (v_c.id, p_type, v_when, v_summary, v_caller, nullif(btrim(coalesce(p_next_action, '')), ''), p_follow_up_date)
  returning id into v_interaction;

  if coalesce(p_create_task, false) then
    insert into hq.tasks (title, assigned_to, due_date, related_contractor_id, source)
    values (left(coalesce(nullif(btrim(coalesce(p_next_action, '')), ''), 'Follow up with ' || v_c.business_name), 200),
            v_assignee, p_follow_up_date, v_c.id, 'interaction')
    returning id into v_task;
    perform hq_private.audit_context('skip');
    update hq.interactions set task_id = v_task where id = v_interaction;
    perform hq_private.audit_context();
  end if;

  if p_new_status = 'contacted' and v_c.status = 'prospect' then
    perform set_config('hq.status_note', left('Contact logged: ' || replace(p_type::text, '_', ' '), 500), true);
    update hq.contractors set status = 'contacted', status_reason = null where id = v_c.id;
    perform set_config('hq.status_note', '', true);
    v_status_changed := true;
  end if;

  return jsonb_build_object('interaction_id', v_interaction, 'task_id', v_task, 'contractor_id', v_c.id,
                            'status', case when v_status_changed then 'contacted'::hq.contractor_status else v_c.status end,
                            'status_changed', v_status_changed);
end $$;
comment on function hq.record_contractor_contact(uuid, hq.interaction_type, timestamptz, text, text, date, boolean, uuid, hq.contractor_status) is 'contractors.write (+ tasks.write for a task). Logs the contact, optionally creates the follow-up task, optionally moves prospect to contacted (never above). Returns {interaction_id, task_id, contractor_id, status, status_changed}.';

-- ------------------------------------------------------------------ contractor_summary
-- Real counts for the dashboard (live contractors only).
--   by_status            every status, zero included
--   awaiting_vetting     status vetting, plus contacted with any of steps 1-8 past not_started
--   expiring_soon / expired            rows of contractor_expiry_watch by state
--   contractors_with_expired_items     distinct contractors with an expired item
--   cleared_with_expired_items         approved / preferred contractors with an expired item (flag loudly)
--   preferred_coverage   per trade (every category, in enum order): approved, preferred, total (= both)
--   trades_without_cover categories other than 'other' with total 0
create function hq.contractor_summary() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_status jsonb;
  v_total bigint;
  v_awaiting bigint;
  v_soon bigint;
  v_expired bigint;
  v_with_expired bigint;
  v_cleared_expired bigint;
  v_coverage jsonb;
  v_none jsonb;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('contractors.read');

  select jsonb_object_agg(e.status::text, coalesce(n.n, 0) order by e.ord), coalesce(sum(n.n), 0)::bigint into v_status, v_total
  from (select s, row_number() over () as ord from unnest(enum_range(null::hq.contractor_status)) s) e(status, ord)
  left join (select c.status, count(*) as n from hq.contractors c where c.deleted_at is null group by 1) n on n.status = e.status;

  select count(*) into v_awaiting from hq.contractors c
  where c.deleted_at is null and (
    c.status = 'vetting'
    or (c.status = 'contacted' and exists (
      select 1 from hq.contractor_vetting_steps s
      where s.contractor_id = c.id and s.step <> 'review_and_approve' and s.status <> 'not_started')));

  select count(*) filter (where w.state = 'expiring_soon'), count(*) filter (where w.state = 'expired'),
         count(distinct w.contractor_id) filter (where w.state = 'expired'),
         count(distinct w.contractor_id) filter (where w.state = 'expired' and w.contractor_status in ('approved', 'preferred'))
    into v_soon, v_expired, v_with_expired, v_cleared_expired
  from hq.contractor_expiry_watch w;

  select jsonb_agg(jsonb_build_object('category', e.cat, 'approved', coalesce(n.approved, 0), 'preferred', coalesce(n.preferred, 0),
                                      'total', coalesce(n.approved, 0) + coalesce(n.preferred, 0)) order by e.ord),
         coalesce(jsonb_agg(to_jsonb(e.cat) order by e.ord) filter (where e.cat <> 'other' and coalesce(n.approved, 0) + coalesce(n.preferred, 0) = 0), '[]'::jsonb)
    into v_coverage, v_none
  from (select k, row_number() over () as ord from unnest(enum_range(null::hq.contractor_category)) k) e(cat, ord)
  left join (
    select k as cat, count(*) filter (where c.status = 'approved') as approved, count(*) filter (where c.status = 'preferred') as preferred
    from hq.contractors c, unnest(c.categories) k
    where c.deleted_at is null and c.status in ('approved', 'preferred')
    group by k
  ) n on n.cat = e.cat;

  return jsonb_build_object(
    'as_of', hq.today(),
    'warning_days', hq_private.setting_int('contractor_expiry_warning_days', 30),
    'total', v_total,
    'by_status', v_status,
    'awaiting_vetting', v_awaiting,
    'expiring_soon', v_soon,
    'expired', v_expired,
    'contractors_with_expired_items', v_with_expired,
    'cleared_with_expired_items', v_cleared_expired,
    'preferred_coverage', v_coverage,
    'trades_without_cover', v_none);
end $$;
comment on function hq.contractor_summary() is 'contractors.read. {as_of, warning_days, total, by_status, awaiting_vetting, expiring_soon, expired, contractors_with_expired_items, cleared_with_expired_items, preferred_coverage[{category, approved, preferred, total}], trades_without_cover[]}.';

-- ------------------------------------------------------------------ create_expiry_tasks
-- The reminder mechanism (section 8): for each row of contractor_expiry_watch with no OPEN task for the
-- same contractor and item (tasks.reminder_key), create one task. Assignee: the relationship owner when
-- they are active staff, else the caller. Due: the expiry date, or today when already expired. Priority:
-- high when expired, normal when expiring soon. Idempotent, also under concurrency (partial unique
-- index tasks_reminder_key_open_uq). A completed or cancelled reminder lets a new one be created.
create function hq.create_expiry_tasks() returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_caller uuid := hq_private.require_staff();
  v_today date := hq.today();
  r record;
  v_task uuid;
  v_ids uuid[] := '{}'::uuid[];
  v_created integer := 0;
  v_skipped integer := 0;
  v_assignee uuid;
  v_item text;
begin
  perform hq_private.require_capability('contractors.write');
  perform hq_private.require_capability('tasks.write');

  for r in select w.* from hq.contractor_expiry_watch w order by w.expires_on, w.business_name, w.item_key loop
    v_assignee := case when r.relationship_owner_id is not null and exists (
                         select 1 from hq.staff_profiles sp where sp.id = r.relationship_owner_id and sp.is_active and sp.employment_status = 'active')
                       then r.relationship_owner_id else v_caller end;
    v_item := case r.kind
                when 'licence' then 'Licence'
                when 'insurance' then 'Insurance'
                else initcap(replace(r.document_type::text, '_', ' ')) || ' document' end;
    v_task := null;
    insert into hq.tasks (title, description, assigned_to, due_date, priority, related_contractor_id, source, reminder_key)
    values (
      left(v_item || ' ' || case when r.state = 'expired' then 'expired ' else 'expires ' end || to_char(r.expires_on, 'FMDD Mon YYYY') || ': ' || r.business_name, 200),
      'Reminder from the contractor expiry watch. Ask the contractor for a current copy, then upload and verify it.',
      v_assignee,
      greatest(r.expires_on, v_today),
      case when r.state = 'expired' then 'high'::hq.task_priority else 'normal'::hq.task_priority end,
      r.contractor_id,
      'manual',
      'contractor-expiry:' || r.contractor_id::text || ':' || r.item_key)
    on conflict (reminder_key) where reminder_key is not null and deleted_at is null and status not in ('completed', 'cancelled')
    do nothing
    returning id into v_task;
    if v_task is null then
      v_skipped := v_skipped + 1;
    else
      v_created := v_created + 1;
      v_ids := v_ids || v_task;
    end if;
  end loop;

  if v_created > 0 then
    perform hq_private.audit_write('expiry_tasks', 'task', null,
      format('Created %s expiry reminder task(s); %s already had an open task', v_created, v_skipped),
      jsonb_build_object('created', v_created, 'skipped', v_skipped));
  end if;
  return jsonb_build_object('created', v_created, 'skipped', v_skipped, 'items', v_created + v_skipped, 'task_ids', to_jsonb(v_ids));
end $$;
comment on function hq.create_expiry_tasks() is 'contractors.write + tasks.write. One open task per expiring or expired item of contractor_expiry_watch (idempotent). Returns {created, skipped, items, task_ids[]}.';

revoke execute on all functions in schema hq_private from public, anon;
revoke execute on all functions in schema hq from public, anon;
