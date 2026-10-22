-- 0158_hq_enquiry_delete.sql
-- Deleting a website enquiry (spam, a test), for directors, in HQ and from chat (docs/hq-setup.md
-- "Website enquiries"). Until now no role could delete an enquiry (the no_delete trigger, 0134); the
-- owner asked to be able to remove spam and test enquiries for good.
--
-- hq.delete_enquiry(id, confirm_ref)   directors only (growth.delete AND the director role)
--   * p_confirm_ref must be the enquiry's number exactly as HQ shows it (ENQ-0001; case and spaces
--     ignored): the person typed it in HQ, or read it back and said yes in chat;
--   * first the enquiry is marked as spam, exactly as hq.mark_enquiry_spam does (when it is not spam
--     already): the lead and contact it created are archived when nobody has worked on them, with its
--     reply task and timeline entries; a lead it joined, or anything someone worked on, is kept;
--   * then the enquiry row itself is deleted. What the person typed (name, email, phone, message, the
--     form's fields) is gone from the enquiry. Copies kept elsewhere are NOT erased: the archived lead's
--     notes and the archived timeline entry keep the message, and the archived contact keeps the name
--     and email, as every archived record in HQ does;
--   * one audit event, 'delete', with the ENQ number, the form, when it arrived and what was archived,
--     never the name, email or message. The number is never reused.
--
-- The no_delete trigger now lets a row go only inside delete_enquiry (a transaction-local marker naming
-- that row); every other delete, by any role, is still refused. Truncate is still refused.

-- ------------------------------------------------------------------ the guard
create function hq_private.enquiry_no_delete() returns trigger
language plpgsql set search_path = pg_catalog, public, extensions as $$
begin
  if coalesce(current_setting('hq.enquiry_delete', true), '') = old.id::text then
    return old;
  end if;
  raise exception '%.% is append-only (% refused)', tg_table_schema, tg_table_name, tg_op
    using errcode = 'insufficient_privilege';
end $$;

drop trigger no_delete on hq.enquiries;
create trigger no_delete before delete on hq.enquiries for each row execute function hq_private.enquiry_no_delete();

-- ------------------------------------------------------------------ delete_enquiry (directors)
create function hq.delete_enquiry(p_id uuid, p_confirm_ref text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_caller uuid := hq_private.require_staff();
  v_e hq.enquiries;
  v_ref text;
  v_spam jsonb;
  v_lead boolean := false;
  v_contact boolean := false;
begin
  perform hq_private.require_capability('growth.delete');
  if hq_private.staff_role() is distinct from 'director' then
    raise exception 'only a director can delete a website enquiry' using errcode = 'insufficient_privilege', hint = 'enquiry_delete_director';
  end if;
  select * into v_e from hq.enquiries e where e.id = p_id for update;
  if not found then
    raise exception 'enquiry not found' using errcode = 'no_data_found';
  end if;
  v_ref := hq_private.enquiry_ref(v_e.ref_number);
  if upper(regexp_replace(coalesce(p_confirm_ref, ''), '[[:space:]]', '', 'g')) <> v_ref then
    raise exception 'to delete it, confirm with its number, %', v_ref using errcode = 'invalid_parameter_value', hint = 'enquiry_delete_confirm';
  end if;

  -- tidy up exactly as marking spam does (archives the untouched lead, contact, task and timeline entries)
  if v_e.status <> 'spam' then
    v_spam := hq.mark_enquiry_spam(v_e.id, 'Deleted in HQ');
    v_lead := coalesce((v_spam ->> 'lead_archived')::boolean, false);
    v_contact := coalesce((v_spam ->> 'contact_archived')::boolean, false);
  end if;

  perform set_config('hq.enquiry_delete', v_e.id::text, true);
  delete from hq.enquiries where id = v_e.id;
  perform set_config('hq.enquiry_delete', '', true);

  perform hq_private.audit_write('delete', 'enquiry', v_e.id,
    'Deleted website enquiry ' || v_ref || ' (' || v_e.kind::text || ', received ' || to_char(v_e.received_at at time zone 'UTC', 'YYYY-MM-DD') || ')',
    jsonb_build_object('ref', v_ref, 'kind', v_e.kind, 'received_at', v_e.received_at, 'status', v_e.status,
                       'opportunity_id', v_e.opportunity_id, 'contact_id', v_e.contact_id,
                       'lead_archived', v_lead, 'contact_archived', v_contact));

  return jsonb_build_object('enquiry_id', v_e.id, 'ref', v_ref, 'deleted', true, 'lead_archived', v_lead, 'contact_archived', v_contact);
end $$;
comment on function hq.delete_enquiry(uuid, text) is 'Directors only (growth.delete and the director role). Deletes a website enquiry for good, after confirming with its ENQ number (p_confirm_ref; 22023 hint enquiry_delete_confirm otherwise). First marks it spam as mark_enquiry_spam does (archiving the untouched lead, contact, task and timeline entries it created), then deletes the row. Copies on the archived lead, contact and timeline are kept. Audited without personal data. Returns {enquiry_id, ref, deleted, lead_archived, contact_archived}.';
