-- 0117_hq_contractor_import_search.sql
-- Phase 2: the contractor import (preview and apply share ONE classifier, as the partner import in
-- 0110), global_search extended with contractors, and archive_record / restore_record extended to the
-- contractor records (docs/hq-phase-2.md, section 5).

-- ------------------------------------------------------------------ the contractor classifier
-- Input: a jsonb array of rows
--   {business_name, categories[], primary_contact_name?, phone?, email?, website?, abn?,
--    service_suburbs[]?, service_regions[]?, notes?, flags[]?, confirm_distinct?, status?, needs_verification?}
-- Other keys are ignored. Imported contractors are ALWAYS prospect and needs_verification, so a row
-- whose status is anything but "prospect", or whose needs_verification is anything but true, is
-- invalid (an import can never approve or clear anyone).
-- Each row is classified IN ORDER against the live contractors AND the earlier rows of this batch that
-- would be created:
--   duplicate           the same name_key (hq_private.normalise_name of business_name)   -> skipped
--   possible_duplicate  the same ABN, the same email, the same phone (digits, +61 read as 0), or a
--                       very similar name (pg_trgm similarity of the name keys >= 0.65)
--                       -> skipped unless confirm_distinct is true; always reported
--   new_contractor      otherwise                                                        -> created
--   invalid             a malformed row; preview reports it, apply refuses the whole file
-- Returns a jsonb array of per-row entries. Writes nothing.
create function hq_private.contractor_import_plan(p_rows jsonb) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_labels text[] := (select array_agg(e::text) from unnest(enum_range(null::hq.contractor_category)) e);
  v_similar constant real := 0.65;
  v_out jsonb := '[]'::jsonb;
  v_i integer := 0;
  v_row jsonb;
  v_name text;
  v_key text;
  v_email text;
  v_abn text;
  v_phone text;
  v_confirm boolean;
  v_flags boolean;
  v_class text;
  v_action text;
  v_reason text;
  v_match uuid;
  v_match_name text;
  v_match_row integer;
  v_k integer;
  v_list text;
  -- the contractors this batch WILL create, in order
  b_key text[] := '{}'::text[];
  b_abn text[] := '{}'::text[];
  b_email text[] := '{}'::text[];
  b_phone text[] := '{}'::text[];
  b_row integer[] := '{}'::integer[];
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'rows must be a non-empty JSON array' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'at most 5000 rows per import' using errcode = 'invalid_parameter_value';
  end if;

  for v_row in select e.value from jsonb_array_elements(p_rows) with ordinality as e(value, ord) order by e.ord loop
    v_i := v_i + 1;
    v_class := null; v_action := 'skip'; v_reason := null;
    v_match := null; v_match_name := null; v_match_row := null;
    v_name := null; v_flags := false; v_email := null; v_abn := null; v_phone := null;

    -- ---- validation
    if jsonb_typeof(v_row) <> 'object' then
      v_class := 'invalid'; v_reason := 'the row is not an object';
    else
      v_name := btrim(coalesce(v_row ->> 'business_name', ''));
      v_email := lower(nullif(btrim(coalesce(v_row ->> 'email', '')), ''));
      v_abn := nullif(regexp_replace(coalesce(v_row ->> 'abn', ''), '\s', '', 'g'), '');
      v_phone := nullif(regexp_replace(coalesce(v_row ->> 'phone', ''), '[^0-9]', '', 'g'), '');
      if v_phone ~ '^61[0-9]{9}$' then v_phone := '0' || substr(v_phone, 3); end if;
      v_confirm := coalesce(lower(v_row ->> 'confirm_distinct'), '') = 'true';
      v_flags := case when jsonb_typeof(v_row -> 'flags') = 'array' then jsonb_array_length(v_row -> 'flags') > 0 else false end;
      if v_name = '' then
        v_class := 'invalid'; v_reason := 'business_name is required';
      elsif char_length(v_name) > 200 then
        v_class := 'invalid'; v_reason := 'business_name is limited to 200 characters';
      elsif hq_private.normalise_name(v_name) = '' then
        v_class := 'invalid'; v_reason := 'business_name needs at least one letter or digit';
      elsif (case when jsonb_typeof(v_row -> 'categories') = 'array' then jsonb_array_length(v_row -> 'categories') = 0 else true end) then
        v_class := 'invalid'; v_reason := 'categories must be a non-empty array';
      elsif exists (select 1 from jsonb_array_elements(v_row -> 'categories') c where jsonb_typeof(c) <> 'string' or (c #>> '{}') <> all (v_labels)) then
        v_class := 'invalid'; v_reason := 'unknown category';
      elsif v_row ? 'status' and jsonb_typeof(v_row -> 'status') <> 'null' and (v_row ->> 'status') is distinct from 'prospect' then
        v_class := 'invalid'; v_reason := 'imported contractors are always prospects; a status cannot be imported';
      elsif v_row ? 'needs_verification' and jsonb_typeof(v_row -> 'needs_verification') <> 'null' and (v_row -> 'needs_verification') is distinct from 'true'::jsonb then
        v_class := 'invalid'; v_reason := 'imported contractors always need verification';
      elsif v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
        v_class := 'invalid'; v_reason := 'the email address is not valid';
      elsif v_abn is not null and not hq_private.abn_is_valid(v_abn) then
        v_class := 'invalid'; v_reason := 'the ABN is not valid (11 digits that pass the ATO checksum)';
      else
        for v_list in select unnest(array['service_suburbs', 'service_regions', 'flags']) loop
          if v_row ? v_list and jsonb_typeof(v_row -> v_list) not in ('array', 'null') then
            v_class := 'invalid'; v_reason := v_list || ' must be an array of text';
          elsif jsonb_typeof(v_row -> v_list) = 'array'
                and exists (select 1 from jsonb_array_elements(v_row -> v_list) x where jsonb_typeof(x) <> 'string') then
            v_class := 'invalid'; v_reason := v_list || ' must be an array of text';
          end if;
          exit when v_class is not null;
        end loop;
      end if;
      if v_class is null and exists (
        select 1 from unnest(array['primary_contact_name', 'phone', 'email', 'website', 'abn', 'notes']) f
        where v_row ? f and jsonb_typeof(v_row -> f) not in ('string', 'null')) then
        v_class := 'invalid'; v_reason := 'text fields must be text';
      end if;
    end if;

    if v_class is null then
      v_key := hq_private.normalise_name(v_name);

      -- duplicate: the same name key
      select c.id, c.business_name into v_match, v_match_name
      from hq.contractors c where c.name_key = v_key and c.deleted_at is null limit 1;
      if v_match is not null then
        v_class := 'duplicate'; v_reason := 'Same name as an existing contractor (' || v_match_name || ')';
      else
        v_k := null;
        select i into v_k from generate_subscripts(b_key, 1) i where b_key[i] = v_key limit 1;
        if v_k is not null then
          v_match_row := b_row[v_k];
          v_class := 'duplicate'; v_reason := 'Same name as row ' || v_match_row || ' of this file';
        end if;
      end if;

      -- possible duplicate: same ABN, email or phone, or a very similar name
      if v_class is null then
        select c.id, c.business_name,
               case when v_abn is not null and c.abn = v_abn then 'Same ABN as '
                    when v_email is not null and lower(c.email::text) = v_email then 'Same email as '
                    when v_phone is not null and length(v_phone) >= 8
                         and regexp_replace(regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g'), '^61([0-9]{9})$', '0\1') = v_phone then 'Same phone as '
                    else 'A very similar name to ' end
          into v_match, v_match_name, v_reason
        from hq.contractors c
        where c.deleted_at is null and (
          (v_abn is not null and c.abn = v_abn)
          or (v_email is not null and lower(c.email::text) = v_email)
          or (v_phone is not null and length(v_phone) >= 8
              and regexp_replace(regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g'), '^61([0-9]{9})$', '0\1') = v_phone)
          or similarity(c.name_key, v_key) >= v_similar)
        order by (v_abn is not null and c.abn = v_abn) desc, similarity(c.name_key, v_key) desc
        limit 1;
        if v_match is not null then
          v_class := 'possible_duplicate';
          v_reason := v_reason || 'an existing contractor (' || v_match_name || '); confirm they are different businesses';
        else
          v_reason := null;
          v_k := null;
          select i into v_k from generate_subscripts(b_key, 1) i
          where (v_abn is not null and b_abn[i] = v_abn)
             or (v_email is not null and b_email[i] = v_email)
             or (v_phone is not null and length(v_phone) >= 8 and b_phone[i] = v_phone)
             or similarity(b_key[i], v_key) >= v_similar
          order by i limit 1;
          if v_k is not null then
            v_match_row := b_row[v_k];
            v_class := 'possible_duplicate';
            v_reason := 'Same ABN, email or phone as, or a very similar name to, row ' || v_match_row || ' of this file; confirm they are different businesses';
          end if;
        end if;
      end if;

      if v_class is null then
        v_class := 'new_contractor'; v_reason := 'New contractor';
      end if;

      v_action := case
        when v_class = 'new_contractor' then 'create'
        when v_class = 'possible_duplicate' and v_confirm then 'create'
        else 'skip' end;
      if v_class = 'possible_duplicate' and v_confirm then
        v_reason := v_reason || ' (confirmed distinct)';
      end if;
      if v_action = 'create' then
        b_key := b_key || v_key;
        b_abn := b_abn || v_abn;
        b_email := b_email || v_email;
        b_phone := b_phone || v_phone;
        b_row := b_row || v_i;
      end if;
    end if;

    v_out := v_out || jsonb_build_object(
      'row', v_i,
      'business_name', v_name,
      'classification', v_class,
      'action', v_action,
      'reason', v_reason,
      'match_contractor_id', v_match,
      'match_row', v_match_row,
      'flagged', v_flags or v_class = 'possible_duplicate');
  end loop;
  return v_out;
end $$;

create function hq_private.contractor_import_counts(p_plan jsonb) returns jsonb
language sql immutable set search_path = pg_catalog as $$
  select jsonb_build_object(
    'rows', count(*),
    'new_contractor', count(*) filter (where e ->> 'classification' = 'new_contractor'),
    'duplicate', count(*) filter (where e ->> 'classification' = 'duplicate'),
    'possible_duplicate', count(*) filter (where e ->> 'classification' = 'possible_duplicate'),
    'invalid', count(*) filter (where e ->> 'classification' = 'invalid'),
    'contractors_created', count(*) filter (where e ->> 'action' = 'create'),
    'skipped', count(*) filter (where e ->> 'action' = 'skip'),
    'flagged', count(*) filter (where (e ->> 'flagged')::boolean)
  )
  from jsonb_array_elements(p_plan) e
$$;

-- ------------------------------------------------------------------ preview_contractor_import
create function hq.preview_contractor_import(p_rows jsonb) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_plan jsonb;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('import.run');
  perform hq_private.require_capability('contractors.write');
  v_plan := hq_private.contractor_import_plan(p_rows);
  return jsonb_build_object('dry_run', true, 'counts', hq_private.contractor_import_counts(v_plan), 'rows', v_plan);
end $$;
comment on function hq.preview_contractor_import(jsonb) is 'import.run + contractors.write. Classifies each row (new_contractor, duplicate, possible_duplicate, invalid) against the live contractors and earlier rows. Writes nothing. Returns {dry_run, counts, rows}.';

-- ------------------------------------------------------------------ apply_contractor_import
-- Applies exactly the plan the preview shows, in one transaction. Every created contractor is
-- status prospect, needs_verification true, source = p_source, with ONLY the supplied fields
-- (business_name, categories in order without repeats, and any of primary_contact_name, phone, email,
-- website, abn, service_suburbs, service_regions). notes and each flag ("Verify: <flag>") go to
-- internal_notes. A file with an invalid row is refused whole. Records an import_batches row (kind
-- contractor) and an audit event.
create function hq.apply_contractor_import(p_rows jsonb, p_source text, p_file_name text default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_source text := btrim(coalesce(p_source, ''));
  v_plan jsonb;
  v_counts jsonb;
  v_e jsonb;
  v_row jsonb;
  v_cats hq.contractor_category[];
  v_notes text;
  v_flag text;
  v_made integer := 0;
  v_batch uuid;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('import.run');
  perform hq_private.require_capability('contractors.write');
  if v_source = '' then
    raise exception 'a source is required' using errcode = 'invalid_parameter_value';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('hq.import', 0));
  v_plan := hq_private.contractor_import_plan(p_rows);
  v_counts := hq_private.contractor_import_counts(v_plan);
  if (v_counts ->> 'invalid')::integer > 0 then
    raise exception '% row(s) are invalid; run the preview and fix the file first', v_counts ->> 'invalid'
      using errcode = 'invalid_parameter_value',
            detail = (select string_agg('row ' || (e ->> 'row') || ': ' || (e ->> 'reason'), '; ')
                      from jsonb_array_elements(v_plan) e where e ->> 'classification' = 'invalid');
  end if;

  for v_e in select e.value from jsonb_array_elements(v_plan) with ordinality as e(value, ord) order by e.ord loop
    continue when v_e ->> 'action' <> 'create';
    v_row := p_rows -> ((v_e ->> 'row')::integer - 1);
    v_cats := array(
      select t.c::hq.contractor_category
      from jsonb_array_elements_text(v_row -> 'categories') with ordinality as t(c, o)
      group by t.c order by min(t.o));
    v_notes := nullif(btrim(coalesce(v_row ->> 'notes', '')), '');
    for v_flag in
      select btrim(f) from jsonb_array_elements_text(case when jsonb_typeof(v_row -> 'flags') = 'array' then v_row -> 'flags' else '[]'::jsonb end) f
      where btrim(f) <> ''
    loop
      v_notes := concat_ws(E'\n', v_notes, 'Verify: ' || v_flag);
    end loop;

    insert into hq.contractors (
      business_name, categories, primary_contact_name, phone, email, website, abn, service_suburbs, service_regions,
      status, needs_verification, source, internal_notes)
    values (
      btrim(v_row ->> 'business_name'), v_cats,
      nullif(btrim(coalesce(v_row ->> 'primary_contact_name', '')), ''),
      nullif(btrim(coalesce(v_row ->> 'phone', '')), ''),
      nullif(btrim(coalesce(v_row ->> 'email', '')), ''),
      nullif(btrim(coalesce(v_row ->> 'website', '')), ''),
      nullif(btrim(coalesce(v_row ->> 'abn', '')), ''),
      coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(v_row -> 'service_suburbs') = 'array' then v_row -> 'service_suburbs' else '[]'::jsonb end)), '{}'::text[]),
      coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(v_row -> 'service_regions') = 'array' then v_row -> 'service_regions' else '[]'::jsonb end)), '{}'::text[]),
      'prospect', true, v_source, v_notes);
    v_made := v_made + 1;
  end loop;

  if v_made <> (v_counts ->> 'contractors_created')::integer then
    raise exception 'the import plan and its application disagree' using errcode = 'internal_error';
  end if;

  insert into hq.import_batches (kind, source, file_name, row_count, contractors_created, duplicates_skipped, flagged, applied_by)
  values ('contractor', v_source, nullif(btrim(coalesce(p_file_name, '')), ''), (v_counts ->> 'rows')::integer, v_made,
          (v_counts ->> 'skipped')::integer, (v_counts ->> 'flagged')::integer, auth.uid())
  returning id into v_batch;
  perform hq_private.audit_write('import', 'import_batch', v_batch,
    format('Contractor import %s: %s contractors created, %s rows skipped', coalesce(nullif(btrim(coalesce(p_file_name, '')), ''), v_source), v_made, v_counts ->> 'skipped'),
    v_counts || jsonb_build_object('kind', 'contractor', 'source', v_source, 'file_name', p_file_name));

  return jsonb_build_object('dry_run', false, 'batch_id', v_batch, 'counts', v_counts, 'rows', v_plan);
end $$;
comment on function hq.apply_contractor_import(jsonb, text, text) is 'import.run + contractors.write. Applies the preview''s classification transactionally (prospect, needs_verification, source = p_source, supplied fields only), skipping duplicates, recording an import_batches row (kind contractor) and an audit event. An invalid row refuses the file. Returns {dry_run, batch_id, counts, rows}.';

-- ------------------------------------------------------------------ global_search (0110 extended)
-- Same function plus a `contractors` list: business name, primary contact, trade label (category with
-- _ read as a space, so "pest" finds pest_control) and service suburb. SECURITY INVOKER: RLS decides
-- (contractors.read). Every key is always present.
create or replace function hq.global_search(p_query text, p_limit integer default 8) returns jsonb
language plpgsql stable security invoker set search_path = pg_catalog, public, extensions as $$
declare
  v_q text := btrim(coalesce(p_query, ''));
  v_limit integer := greatest(1, least(coalesce(p_limit, 8), 25));
  v_like text;
  v_contacts jsonb;
  v_orgs jsonb;
  v_refs jsonb;
  v_tasks jsonb;
  v_contractors jsonb;
begin
  if char_length(v_q) < 2 then
    return jsonb_build_object('contacts', '[]'::jsonb, 'organisations', '[]'::jsonb, 'referrals', '[]'::jsonb, 'tasks', '[]'::jsonb, 'contractors', '[]'::jsonb);
  end if;
  v_q := left(v_q, 100);
  v_like := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');

  select coalesce(jsonb_agg(s.item order by s.prefix desc, s.score desc, s.name), '[]'::jsonb) into v_contacts
  from (
    select jsonb_build_object('id', c.id, 'title', c.full_name, 'full_name', c.full_name, 'organisation_name', o.name,
             'subtitle', coalesce(nullif(concat_ws(' - ', c.position, o.name), ''), replace(c.relationship_status::text, '_', ' '))) as item,
           (c.full_name ilike v_like || '%') as prefix,
           similarity(c.full_name, v_q) as score,
           c.full_name as name
    from hq.contacts c
    left join hq.organisations o on o.id = c.organisation_id
    where c.deleted_at is null
      and (c.full_name ilike '%' || v_like || '%' or c.full_name % v_q or c.email::text ilike v_like || '%')
    order by 2 desc, 3 desc, 4
    limit v_limit
  ) s;

  select coalesce(jsonb_agg(s.item order by s.prefix desc, s.score desc, s.name), '[]'::jsonb) into v_orgs
  from (
    select jsonb_build_object('id', o.id, 'title', o.name, 'name', o.name,
             'subtitle', replace(array_to_string(o.categories, ', '), '_', ' ')) as item,
           (o.name ilike v_like || '%') as prefix,
           similarity(o.name, v_q) as score,
           o.name as name
    from hq.organisations o
    where o.deleted_at is null and (o.name ilike '%' || v_like || '%' or o.name % v_q)
    order by 2 desc, 3 desc, 4
    limit v_limit
  ) s;

  select coalesce(jsonb_agg(s.item order by s.prefix desc, s.score desc, s.name), '[]'::jsonb) into v_refs
  from (
    select jsonb_build_object('id', r.id, 'title', r.ref_label || ' ' || coalesce(r.prospect_name, ''), 'ref_label', r.ref_label,
             'direction', r.direction, 'prospect_name', r.prospect_name, 'partner_organisation_name', r.partner_organisation_name,
             'subtitle', concat_ws(' - ', r.direction::text, r.partner_organisation_name, replace(r.stage::text, '_', ' '))) as item,
           (r.ref_label ilike v_like || '%' or r.prospect_name ilike v_like || '%') as prefix,
           greatest(similarity(coalesce(r.prospect_name, ''), v_q), similarity(coalesce(r.partner_organisation_name, ''), v_q)) as score,
           r.ref_label as name
    from hq.referral_overview r
    where r.ref_label ilike v_like || '%'
       or r.prospect_name ilike '%' || v_like || '%'
       or r.partner_organisation_name ilike '%' || v_like || '%'
       or r.partner_contact_name ilike '%' || v_like || '%'
    order by 2 desc, 3 desc, 4
    limit v_limit
  ) s;

  select coalesce(jsonb_agg(s.item order by s.prefix desc, s.score desc, s.name), '[]'::jsonb) into v_tasks
  from (
    select jsonb_build_object('id', t.id, 'title', t.title, 'status', t.status, 'due_date', t.due_date,
             'subtitle', concat_ws(' - ', replace(t.status::text, '_', ' '), 'due ' || t.due_date::text)) as item,
           (t.title ilike v_like || '%') as prefix,
           similarity(t.title, v_q) as score,
           t.title as name
    from hq.tasks t
    where t.deleted_at is null and (t.title ilike '%' || v_like || '%' or t.title % v_q)
    order by 2 desc, 3 desc, 4
    limit v_limit
  ) s;

  select coalesce(jsonb_agg(s.item order by s.prefix desc, s.score desc, s.name), '[]'::jsonb) into v_contractors
  from (
    select jsonb_build_object('id', c.id, 'title', c.business_name, 'business_name', c.business_name,
             'status', c.status, 'categories', to_jsonb(c.categories), 'primary_contact_name', c.primary_contact_name,
             'subtitle', concat_ws(' - ',
               nullif(replace(array_to_string(c.categories, ', '), '_', ' '), ''),
               nullif(array_to_string(c.service_suburbs[1:3], ', ') || case when cardinality(c.service_suburbs) > 3 then ' +' || (cardinality(c.service_suburbs) - 3) else '' end, ''),
               replace(c.status::text, '_', ' '))) as item,
           (c.business_name ilike v_like || '%') as prefix,
           greatest(similarity(c.business_name, v_q), similarity(coalesce(c.primary_contact_name, ''), v_q)) as score,
           c.business_name as name
    from hq.contractors c
    where c.deleted_at is null
      and (c.business_name ilike '%' || v_like || '%' or c.business_name % v_q
           or c.primary_contact_name ilike '%' || v_like || '%'
           or exists (select 1 from unnest(c.categories) k where replace(k::text, '_', ' ') ilike '%' || v_like || '%' or replace(k::text, '_', ' ') % v_q)
           or exists (select 1 from unnest(c.service_suburbs) sb where sb ilike '%' || v_like || '%'))
    order by 2 desc, 3 desc, 4
    limit v_limit
  ) s;

  return jsonb_build_object('contacts', v_contacts, 'organisations', v_orgs, 'referrals', v_refs, 'tasks', v_tasks, 'contractors', v_contractors);
end $$;
comment on function hq.global_search(text, integer) is 'SECURITY INVOKER: RLS decides what the caller finds. {contacts, organisations, referrals, tasks, contractors}, each [{id, title, subtitle, ...}]. LIKE metacharacters are escaped.';

-- ------------------------------------------------------------------ archive_record / restore_record (0109 extended)
-- Phase 1 entities unchanged (growth.delete; a task also by its assignee or creator holding tasks.write).
-- Contractor entities have their own capabilities:
--   contractor           contractors.approve
--   contractor_document  contractors.documents   (the stored object is retained)
--   contractor_review    contractors.approve, or contractors.write when the caller recorded it
-- Archiving does not cascade.
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
begin
  v_table := case p_entity
    when 'organisation' then 'organisations' when 'contact' then 'contacts' when 'referral' then 'referrals'
    when 'task' then 'tasks' when 'opportunity' then 'opportunities' when 'interaction' then 'interactions'
    when 'contractor' then 'contractors' when 'contractor_document' then 'contractor_documents'
    when 'contractor_review' then 'contractor_reviews' end;
  if v_table is null then
    raise exception 'unknown entity %; expected organisation, contact, referral, task, opportunity, interaction, contractor, contractor_document or contractor_review', p_entity
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

  perform hq_private.audit_context(null, left(nullif(btrim(coalesce(p_reason, '')), ''), 200));
  execute format('update hq.%I set deleted_at = now() where id = $1', v_table) using p_id;
  perform hq_private.audit_context();
  return jsonb_build_object('entity', p_entity, 'id', p_id, 'archived', true, 'changed', true);
end $$;
comment on function hq.archive_record(text, uuid, text) is 'Soft-deletes organisation, contact, referral, task, opportunity, interaction (growth.delete; a task also by its assignee or creator holding tasks.write), contractor (contractors.approve), contractor_document (contractors.documents), contractor_review (contractors.approve, or its recorder with contractors.write).';

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
    when 'contractor_review' then 'contractor_reviews' end;
  if v_table is null then
    raise exception 'unknown entity %; expected organisation, contact, referral, task, opportunity, interaction, contractor, contractor_document or contractor_review', p_entity
      using errcode = 'invalid_parameter_value';
  end if;
  perform hq_private.require_capability(case p_entity
    when 'contractor' then 'contractors.approve'
    when 'contractor_document' then 'contractors.documents'
    when 'contractor_review' then 'contractors.approve'
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
    -- a unique name, email, ABN or primary contact that was taken meanwhile fails the restore (23505)
    execute format('update hq.%I set deleted_at = null where id = $1', v_table) using p_id;
  end if;
  return jsonb_build_object('entity', p_entity, 'id', p_id, 'archived', false, 'changed', true);
end $$;
comment on function hq.restore_record(text, uuid) is 'Restores a soft-deleted record: growth.delete for the Phase 1 entities, contractors.approve for contractor and contractor_review, contractors.documents for contractor_document. A restored referral takes attribution back only when the opportunity has none.';

revoke execute on all functions in schema hq_private from public, anon;
revoke execute on all functions in schema hq from public, anon;
