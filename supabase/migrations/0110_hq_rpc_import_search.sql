-- 0110_hq_rpc_import_search.sql
-- Partner import (preview and apply share ONE classifier, so they agree exactly), global_search and
-- growth_summary (design section 5).

-- ------------------------------------------------------------------ the shared classifier
-- Input: a jsonb array of rows
--   {organisation, full_name, categories[], service_region, position?, phone?, email?, website?,
--    location?, notes?, flags?[], confirm_distinct?}
-- Each row is classified IN ORDER against the database AND the earlier rows of the same batch that
-- would be inserted (so the first of two near-matches is not flagged; the later one is):
--   duplicate           same organisation (by normalised name) AND same contact name, OR the same
--                       non-null email                                     -> skipped
--   possible_duplicate  same organisation, same surname (last name token), different first name
--                       -> skipped unless confirm_distinct is true; always reported
--   new_contact         the organisation exists (database or earlier in the batch)
--   new_organisation    the organisation is new: it is created, then the contact
--   invalid             a malformed row; preview reports it, apply refuses the whole file
-- Returns a jsonb array of per-row entries. Writes nothing.
create function hq_private.import_plan(p_rows jsonb) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_labels text[] := (select array_agg(e::text) from unnest(enum_range(null::hq.partner_category)) e);
  v_out jsonb := '[]'::jsonb;
  v_i integer := 0;
  v_row jsonb;
  v_org text;
  v_full text;
  v_org_key text;
  v_name_key text;
  v_email text;
  v_surname text;
  v_multi boolean;
  v_confirm boolean;
  v_org_id uuid;
  v_class text;
  v_action text;
  v_reason text;
  v_match_contact uuid;
  v_match_name text;
  v_match_row integer;
  v_flags boolean;
  -- the contacts this batch WILL add, in order
  b_org text[] := '{}'::text[];
  b_name text[] := '{}'::text[];
  b_surname text[] := '{}'::text[];
  b_email text[] := '{}'::text[];
  b_row integer[] := '{}'::integer[];
  b_orgs text[] := '{}'::text[];
  v_k integer;
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
    v_match_contact := null; v_match_name := null; v_match_row := null; v_org_id := null;
    v_org := null; v_full := null; v_flags := false;

    -- ---- validation
    if jsonb_typeof(v_row) <> 'object' then
      v_class := 'invalid'; v_reason := 'the row is not an object';
    else
      v_org := btrim(coalesce(v_row ->> 'organisation', ''));
      v_full := btrim(coalesce(v_row ->> 'full_name', ''));
      v_email := lower(nullif(btrim(coalesce(v_row ->> 'email', '')), ''));
      v_confirm := coalesce(lower(v_row ->> 'confirm_distinct'), '') = 'true';
      v_flags := case when jsonb_typeof(v_row -> 'flags') = 'array' then jsonb_array_length(v_row -> 'flags') > 0 else false end;
      if v_org = '' or v_full = '' then
        v_class := 'invalid'; v_reason := 'organisation and full_name are required';
      elsif char_length(v_org) > 200 or char_length(v_full) > 200 then
        v_class := 'invalid'; v_reason := 'organisation and full_name are limited to 200 characters';
      elsif hq_private.normalise_name(v_org) = '' or hq_private.normalise_name(v_full) = '' then
        v_class := 'invalid'; v_reason := 'organisation and full_name need at least one letter or digit';
      elsif (case when jsonb_typeof(v_row -> 'categories') = 'array' then jsonb_array_length(v_row -> 'categories') = 0 else true end) then
        v_class := 'invalid'; v_reason := 'categories must be a non-empty array';
      elsif exists (select 1 from jsonb_array_elements_text(v_row -> 'categories') c where c <> all (v_labels)) then
        v_class := 'invalid'; v_reason := 'unknown category';
      elsif v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
        v_class := 'invalid'; v_reason := 'the email address is not valid';
      elsif v_row ? 'flags' and jsonb_typeof(v_row -> 'flags') not in ('array', 'null') then
        v_class := 'invalid'; v_reason := 'flags must be an array of text';
      end if;
    end if;

    if v_class is null then
      v_org_key := hq_private.normalise_name(v_org);
      v_name_key := hq_private.normalise_name(v_full);
      v_multi := position(' ' in v_name_key) > 0;
      v_surname := case when v_multi then (regexp_match(v_name_key, '(\S+)$'))[1] end;
      select o.id into v_org_id from hq.organisations o where o.name_key = v_org_key and o.deleted_at is null;

      -- duplicate: same organisation and name ...
      if v_org_id is not null then
        select c.id, c.full_name into v_match_contact, v_match_name
        from hq.contacts c
        where c.organisation_id = v_org_id and c.name_key = v_name_key and c.deleted_at is null limit 1;
      end if;
      if v_match_contact is not null then
        v_class := 'duplicate'; v_reason := 'Same organisation and name as an existing contact (' || v_match_name || ')';
      else
        select i into v_k from generate_subscripts(b_org, 1) i where b_org[i] = v_org_key and b_name[i] = v_name_key limit 1;
        if v_k is not null then
          v_match_row := b_row[v_k];
          v_class := 'duplicate'; v_reason := 'Same organisation and name as row ' || v_match_row || ' of this file';
        end if;
      end if;
      -- ... or the same email
      if v_class is null and v_email is not null then
        select c.id, c.full_name into v_match_contact, v_match_name
        from hq.contacts c where c.email = v_email::extensions.citext and c.deleted_at is null limit 1;
        if v_match_contact is not null then
          v_class := 'duplicate'; v_reason := 'Same email as an existing contact (' || v_match_name || ')';
        else
          v_k := null;
          select i into v_k from generate_subscripts(b_email, 1) i where b_email[i] = v_email limit 1;
          if v_k is not null then
            v_match_row := b_row[v_k];
            v_class := 'duplicate'; v_reason := 'Same email as row ' || v_match_row || ' of this file';
          end if;
        end if;
      end if;
      -- possible duplicate: same organisation, same surname, different first name
      if v_class is null and v_multi then
        if v_org_id is not null then
          select c.id, c.full_name into v_match_contact, v_match_name
          from hq.contacts c
          where c.organisation_id = v_org_id and c.deleted_at is null and c.name_key <> v_name_key
            and position(' ' in c.name_key) > 0 and (regexp_match(c.name_key, '(\S+)$'))[1] = v_surname
          limit 1;
        end if;
        if v_match_contact is not null then
          v_class := 'possible_duplicate';
          v_reason := 'Same organisation and surname as ' || v_match_name || '; confirm they are different people';
        else
          v_k := null;
          select i into v_k from generate_subscripts(b_org, 1) i
          where b_org[i] = v_org_key and b_surname[i] = v_surname and b_name[i] <> v_name_key limit 1;
          if v_k is not null then
            v_match_row := b_row[v_k];
            v_class := 'possible_duplicate';
            v_reason := 'Same organisation and surname as row ' || v_match_row || ' of this file; confirm they are different people';
          end if;
        end if;
      end if;
      -- new
      if v_class is null then
        if v_org_id is null and not (v_org_key = any (b_orgs)) then
          v_class := 'new_organisation'; v_reason := 'New organisation and contact';
        else
          v_class := 'new_contact'; v_reason := 'New contact at an existing organisation';
        end if;
      end if;

      v_action := case
        when v_class in ('new_organisation', 'new_contact') then 'create'
        when v_class = 'possible_duplicate' and v_confirm then 'create'
        else 'skip' end;
      if v_class = 'possible_duplicate' and v_confirm then
        v_reason := v_reason || ' (confirmed distinct)';
      end if;
      if v_action = 'create' then
        b_org := b_org || v_org_key;
        b_name := b_name || v_name_key;
        b_surname := b_surname || v_surname;
        b_email := b_email || v_email;
        b_row := b_row || v_i;
        if v_class = 'new_organisation' then
          b_orgs := b_orgs || v_org_key;
        end if;
      end if;
    end if;

    v_out := v_out || jsonb_build_object(
      'row', v_i,
      'organisation', v_org,
      'full_name', v_full,
      'classification', v_class,
      'action', v_action,
      'reason', v_reason,
      'organisation_id', v_org_id,
      'match_contact_id', v_match_contact,
      'match_row', v_match_row,
      'flagged', v_flags or v_class = 'possible_duplicate');
  end loop;
  return v_out;
end $$;

create function hq_private.import_counts(p_plan jsonb) returns jsonb
language sql immutable set search_path = pg_catalog as $$
  select jsonb_build_object(
    'rows', count(*),
    'new_organisation', count(*) filter (where e ->> 'classification' = 'new_organisation'),
    'new_contact', count(*) filter (where e ->> 'classification' = 'new_contact'),
    'duplicate', count(*) filter (where e ->> 'classification' = 'duplicate'),
    'possible_duplicate', count(*) filter (where e ->> 'classification' = 'possible_duplicate'),
    'invalid', count(*) filter (where e ->> 'classification' = 'invalid'),
    'organisations_created', count(*) filter (where e ->> 'classification' = 'new_organisation'),
    'contacts_created', count(*) filter (where e ->> 'action' = 'create'),
    'skipped', count(*) filter (where e ->> 'action' = 'skip'),
    'flagged', count(*) filter (where (e ->> 'flagged')::boolean)
  )
  from jsonb_array_elements(p_plan) e
$$;

-- ------------------------------------------------------------------ preview_partner_import
create function hq.preview_partner_import(p_rows jsonb) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_plan jsonb;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('import.run');
  v_plan := hq_private.import_plan(p_rows);
  return jsonb_build_object('dry_run', true, 'counts', hq_private.import_counts(v_plan), 'rows', v_plan);
end $$;
comment on function hq.preview_partner_import(jsonb) is 'import.run. Classifies each row (new_organisation, new_contact, duplicate, possible_duplicate, invalid) against the database and earlier rows. Writes nothing.';

-- ------------------------------------------------------------------ apply_partner_import
-- Applies exactly the plan the preview shows, in one transaction. Imported rows are research leads:
-- relationship_status identified, needs_verification true, source = p_source, the supplied
-- categories and region, and nothing else invented. The first contact of an organisation that has
-- no primary contact becomes primary; later ones are secondary. flags[] are kept in the contact's
-- notes, each prefixed 'Verify: '. A file with an invalid row is refused whole.
create function hq.apply_partner_import(p_rows jsonb, p_source text, p_file_name text default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_source text := btrim(coalesce(p_source, ''));
  v_plan jsonb;
  v_counts jsonb;
  v_e jsonb;
  v_row jsonb;
  v_org_key text;
  v_org_id uuid;
  v_cats hq.partner_category[];
  v_notes text;
  v_flag text;
  v_made_orgs integer := 0;
  v_made_contacts integer := 0;
  v_batch uuid;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('import.run');
  if v_source = '' then
    raise exception 'a source is required' using errcode = 'invalid_parameter_value';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('hq.import', 0));
  v_plan := hq_private.import_plan(p_rows);
  v_counts := hq_private.import_counts(v_plan);
  if (v_counts ->> 'invalid')::integer > 0 then
    raise exception '% row(s) are invalid; run the preview and fix the file first', v_counts ->> 'invalid'
      using errcode = 'invalid_parameter_value',
            detail = (select string_agg('row ' || (e ->> 'row') || ': ' || (e ->> 'reason'), '; ')
                      from jsonb_array_elements(v_plan) e where e ->> 'classification' = 'invalid');
  end if;

  for v_e in select e.value from jsonb_array_elements(v_plan) with ordinality as e(value, ord) order by e.ord loop
    continue when v_e ->> 'action' <> 'create';
    v_row := p_rows -> ((v_e ->> 'row')::integer - 1);
    v_org_key := hq_private.normalise_name(btrim(v_row ->> 'organisation'));
    v_cats := array(
      select t.c::hq.partner_category
      from jsonb_array_elements_text(v_row -> 'categories') with ordinality as t(c, o)
      group by t.c order by min(t.o));

    -- the organisation: an earlier row of this batch may already have created it
    select o.id into v_org_id from hq.organisations o where o.name_key = v_org_key and o.deleted_at is null;
    if v_org_id is null then
      insert into hq.organisations (name, categories, website, location, service_region, source, needs_verification)
      values (btrim(v_row ->> 'organisation'), v_cats,
              nullif(btrim(coalesce(v_row ->> 'website', '')), ''), nullif(btrim(coalesce(v_row ->> 'location', '')), ''),
              nullif(btrim(coalesce(v_row ->> 'service_region', '')), ''), v_source, true)
      returning id into v_org_id;
      v_made_orgs := v_made_orgs + 1;
    end if;

    v_notes := nullif(btrim(coalesce(v_row ->> 'notes', '')), '');
    for v_flag in
      select btrim(f) from jsonb_array_elements_text(case when jsonb_typeof(v_row -> 'flags') = 'array' then v_row -> 'flags' else '[]'::jsonb end) f
      where btrim(f) <> ''
    loop
      v_notes := concat_ws(E'\n', v_notes, 'Verify: ' || v_flag);
    end loop;

    insert into hq.contacts (
      organisation_id, full_name, position, categories, phone, email, website, location, service_region,
      org_contact_role, relationship_status, needs_verification, source, notes)
    values (
      v_org_id, btrim(v_row ->> 'full_name'), nullif(btrim(coalesce(v_row ->> 'position', '')), ''), v_cats,
      nullif(btrim(coalesce(v_row ->> 'phone', '')), ''), nullif(btrim(coalesce(v_row ->> 'email', '')), ''),
      nullif(btrim(coalesce(v_row ->> 'website', '')), ''), nullif(btrim(coalesce(v_row ->> 'location', '')), ''),
      nullif(btrim(coalesce(v_row ->> 'service_region', '')), ''),
      case when exists (select 1 from hq.contacts c where c.organisation_id = v_org_id and c.org_contact_role = 'primary' and c.deleted_at is null)
           then 'secondary'::hq.org_contact_role else 'primary'::hq.org_contact_role end,
      'identified', true, v_source, v_notes);
    v_made_contacts := v_made_contacts + 1;
  end loop;

  if v_made_orgs <> (v_counts ->> 'organisations_created')::integer or v_made_contacts <> (v_counts ->> 'contacts_created')::integer then
    raise exception 'the import plan and its application disagree' using errcode = 'internal_error';
  end if;

  insert into hq.import_batches (source, file_name, row_count, organisations_created, contacts_created, duplicates_skipped, flagged, applied_by)
  values (v_source, nullif(btrim(coalesce(p_file_name, '')), ''), (v_counts ->> 'rows')::integer, v_made_orgs, v_made_contacts,
          (v_counts ->> 'skipped')::integer, (v_counts ->> 'flagged')::integer, auth.uid())
  returning id into v_batch;
  perform hq_private.audit_write('import', 'import_batch', v_batch,
    format('Import %s: %s organisations and %s contacts created, %s rows skipped', coalesce(nullif(btrim(coalesce(p_file_name, '')), ''), v_source), v_made_orgs, v_made_contacts, v_counts ->> 'skipped'),
    v_counts || jsonb_build_object('source', v_source, 'file_name', p_file_name));

  return jsonb_build_object('dry_run', false, 'batch_id', v_batch, 'counts', v_counts, 'rows', v_plan);
end $$;
comment on function hq.apply_partner_import(jsonb, text, text) is 'import.run. Applies the preview''s classification transactionally, skipping duplicates, recording an import_batches row and an audit event. Imported rows: identified, needs_verification, source = p_source. An invalid row refuses the file.';

-- ------------------------------------------------------------------ global_search
-- SECURITY INVOKER: it reads the tables as the caller, so RLS decides what each person finds
-- (a junior property manager finds only their own tasks). Trigram similarity plus substring match;
-- LIKE metacharacters in the query are escaped, so "100%" or "a_b" match literally.
create function hq.global_search(p_query text, p_limit integer default 8) returns jsonb
language plpgsql stable security invoker set search_path = pg_catalog, public, extensions as $$
declare
  v_q text := btrim(coalesce(p_query, ''));
  v_limit integer := greatest(1, least(coalesce(p_limit, 8), 25));
  v_like text;
  v_contacts jsonb;
  v_orgs jsonb;
  v_refs jsonb;
  v_tasks jsonb;
begin
  if char_length(v_q) < 2 then
    return jsonb_build_object('contacts', '[]'::jsonb, 'organisations', '[]'::jsonb, 'referrals', '[]'::jsonb, 'tasks', '[]'::jsonb);
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

  return jsonb_build_object('contacts', v_contacts, 'organisations', v_orgs, 'referrals', v_refs, 'tasks', v_tasks);
end $$;
comment on function hq.global_search(text, integer) is 'SECURITY INVOKER: RLS decides what the caller finds. {contacts, organisations, referrals, tasks}, each [{id, title, subtitle, ...}]. LIKE metacharacters are escaped.';

-- ------------------------------------------------------------------ growth_summary
-- Real counts only. p_since defaults to 30 days ago (in the configured timezone).
--   managements_signed  DISTINCT opportunities signed on or after p_since
--   referrals_received / referrals_sent   live referral rows dated on or after p_since
--   active_opportunities  live opportunities not signed and not lost (now)
--   qualified   live opportunities that first reached qualified-or-later (history or stage) since p_since
--   conversion  managements_signed / referrals_received, null when no referrals were received
--   overdue_followups, contacts_by_status, contacts_not_contacted_30d   (now; inactive contacts excluded
--     from the follow-up and not-contacted counts)
--   estimated_value_signed_cents  sum of the estimated annual value of the opportunities signed since
create function hq.growth_summary(p_since date default null) returns jsonb
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
  where c.deleted_at is null and c.relationship_status <> 'inactive'
    and (c.last_contact_at is null or c.last_contact_at < now() - interval '30 days');

  select jsonb_object_agg(e.status::text, coalesce(n.n, 0) order by e.ord) into v_status
  from (select s, row_number() over () as ord from unnest(enum_range(null::hq.relationship_status)) s) e(status, ord)
  left join (select c.relationship_status, count(*) as n from hq.contacts c where c.deleted_at is null group by 1) n
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
comment on function hq.growth_summary(date) is 'growth.read. Real counts only: managements_signed (distinct opportunities), referrals_received / sent, active_opportunities, qualified, conversion (null when none received), overdue_followups, contacts_by_status, contacts_not_contacted_30d, estimated_value_signed_cents.';
