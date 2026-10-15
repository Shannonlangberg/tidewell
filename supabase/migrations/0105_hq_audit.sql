-- 0105_hq_audit.sql
-- The audit trail (design section 6). A generic trigger writes hq.audit_events for every insert,
-- update and soft deletion on the audited tables: who (auth.uid(), null for the system), a snapshot
-- of their name, what, which record, and a small diff of the changed columns. Free text in a diff is
-- cut to 500 characters, so the log never becomes a second copy of the notes.
--
-- An RPC that wants a higher-level action name (invite, bootstrap, ...) or a reason sets the
-- transaction-local settings hq.audit_action / hq.audit_note around the statement it runs, through
-- hq_private.audit_context(); the trigger then writes ONE row carrying them, not two.

create function hq_private.audit_trim(p_value jsonb) returns jsonb
language sql immutable set search_path = pg_catalog as $$
  select case jsonb_typeof(p_value)
    when 'string' then case when char_length(p_value #>> '{}') > 500 then to_jsonb(left(p_value #>> '{}', 500)) else p_value end
    when 'object' then case when char_length(p_value::text) > 500 then to_jsonb(left(p_value::text, 500)) else p_value end
    when 'array' then case when char_length(p_value::text) > 500 then to_jsonb(left(p_value::text, 500)) else p_value end
    else p_value
  end
$$;

-- Set (or clear, with nulls) the action override and note for the statements that follow in this transaction.
create function hq_private.audit_context(p_action text default null, p_note text default null) returns void
language sql volatile set search_path = pg_catalog, public, extensions as $$
  select set_config('hq.audit_action', coalesce(p_action, ''), true),
         set_config('hq.audit_note', coalesce(p_note, ''), true)
$$;

-- A one-off audit row written by an RPC (import, for example).
create function hq_private.audit_write(
  p_action text, p_entity_type text, p_entity_id uuid, p_summary text, p_changes jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_actor uuid := auth.uid();
begin
  insert into hq.audit_events (actor_id, actor_name, action, entity_type, entity_id, summary, changes)
  values (
    v_actor,
    coalesce((select sp.full_name from hq.staff_profiles sp where sp.id = v_actor), case when v_actor is null then 'System' end),
    p_action, p_entity_type, p_entity_id, left(p_summary, 500), coalesce(p_changes, '{}'::jsonb));
end $$;

create function hq_private.audit_row() returns trigger
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
    else 'update'
  end;

  v_label := coalesce(
    case when tg_table_name = 'referrals' then 'REF-' || lpad(v_row ->> 'ref_number', 4, '0') end,
    case when tg_table_name = 'role_capabilities' then (v_row ->> 'role') || ' ' || (v_row ->> 'capability') end,
    case when tg_table_name = 'interactions' then v_row ->> 'interaction_type' end,
    v_row ->> 'name', v_row ->> 'full_name', v_row ->> 'prospect_name', v_row ->> 'title', v_row ->> 'key');

  v_summary := initcap(replace(v_action, '_', ' ')) || ' ' || v_entity
    || coalesce(': ' || v_label, '')
    || case when v_action = 'stage_change' then ' (' || (v_old ->> 'stage') || ' to ' || (v_new ->> 'stage') || ')' else '' end
    || coalesce(' [' || v_note || ']', '');

  insert into hq.audit_events (actor_id, actor_name, action, entity_type, entity_id, summary, changes)
  values (
    v_actor,
    coalesce((select sp.full_name from hq.staff_profiles sp where sp.id = v_actor), case when v_actor is null then 'System' end),
    v_action, v_entity,
    case when v_row ? 'id' then (v_row ->> 'id')::uuid end,
    left(v_summary, 500), v_changes);
  return null;
end $$;

create trigger audit after insert or update or delete on hq.organisations for each row execute function hq_private.audit_row('organisation');
create trigger audit after insert or update or delete on hq.contacts for each row execute function hq_private.audit_row('contact');
create trigger audit after insert or update or delete on hq.interactions for each row execute function hq_private.audit_row('interaction');
create trigger audit after insert or update or delete on hq.opportunities for each row execute function hq_private.audit_row('opportunity');
create trigger audit after insert or update or delete on hq.referrals for each row execute function hq_private.audit_row('referral');
create trigger audit after insert or update or delete on hq.tasks for each row execute function hq_private.audit_row('task');
create trigger audit after insert or update or delete on hq.staff_profiles for each row execute function hq_private.audit_row('staff');
create trigger audit after insert or update or delete on hq.settings for each row execute function hq_private.audit_row('setting');
create trigger audit after insert or update or delete on hq.role_capabilities for each row execute function hq_private.audit_row('role_capability');
create trigger audit after insert or update or delete on hq.pods for each row execute function hq_private.audit_row('pod');

revoke execute on all functions in schema hq_private from public, anon;
