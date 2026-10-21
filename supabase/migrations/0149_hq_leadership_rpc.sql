-- 0149_hq_leadership_rpc.sql
-- The command center RPCs (docs/hq-command-center.md): the task entry and update core (0144) taught the
-- 0148 fields, so update_project_task and bulk_update_tasks can set them with every existing rule,
-- check and history; save_planning_item; set_task_waiting and resolve_task_waiting (the "move training
-- into Waiting on funding" and "Ailo called back" paths); set_milestone_launch_gate. Function
-- privileges in 0150.
--
-- New update fields (all optional; JSON null clears): waiting_on (text, 200), waiting_since,
-- expected_response, next_follow_up, planned_for (dates YYYY-MM-DD within the next five years; past
-- dates allowed for waiting_since), planning_item (id of an anticipated or confirmed funding or
-- dependency item; needs planning.read to link). None of them ever changes priority or due date.

-- A date field from JSON: absent or blank = null; a real date from 2000-01-01 to five years ahead.
create function hq_private.leadership_date(p_value text, p_what text) returns date
language plpgsql stable security definer set search_path = pg_catalog, public, extensions as $$
declare
  v date := hq_private.meeting_date(p_value, p_what);
begin
  if v is not null and (v < date '2000-01-01' or v > hq.today() + 1826) then
    raise exception '% must be within the next five years', p_what using errcode = 'invalid_parameter_value';
  end if;
  return v;
end $$;

-- ------------------------------------------------------------------ task_entry_errors (0144) with the 0148 update fields
create or replace function hq_private.task_entry_errors(p_e jsonb, p_mode text) returns text[]
language plpgsql stable security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_err text[] := '{}';
  v_allowed text[];
  v_key text;
  v_t text;
  v_list text[];
  v_x text;
begin
  if p_e is null or jsonb_typeof(p_e) <> 'object' then
    return array['each entry must be an object'];
  end if;
  v_allowed := case when p_mode = 'create' then
      array['ref', 'title', 'description', 'assignee', 'priority', 'status', 'due_date', 'project', 'milestone', 'parent_ref', 'parent',
            'depends_on', 'checklist', 'linked_contact', 'linked_organisation', 'linked_contractor', 'linked_opportunity', 'sort_order', 'blocked_reason']
    else
      array['id', 'title', 'description', 'assignee', 'priority', 'status', 'due_date', 'project', 'milestone', 'parent',
            'add_dependency', 'remove_dependency', 'complete', 'checklist', 'comment', 'sort_order', 'blocked_reason',
            'waiting_on', 'waiting_since', 'expected_response', 'next_follow_up', 'planned_for', 'planning_item'] end;
  for v_key in select k from jsonb_object_keys(p_e) k loop
    if not v_key = any (v_allowed) then
      v_err := v_err || format('unknown field "%s"', left(v_key, 40));
    end if;
  end loop;
  for v_key in select k from unnest(array['ref', 'title', 'description', 'assignee', 'priority', 'status', 'due_date', 'project', 'milestone',
                                         'parent_ref', 'parent', 'linked_contact', 'linked_organisation', 'linked_contractor', 'linked_opportunity',
                                         'blocked_reason', 'id', 'comment', 'waiting_on', 'waiting_since',
                                         'expected_response', 'next_follow_up', 'planned_for', 'planning_item']) k loop
    if p_e ? v_key and jsonb_typeof(p_e -> v_key) not in ('string', 'null') then
      v_err := v_err || format('%s must be text', v_key);
    end if;
  end loop;
  if v_err <> '{}' then return v_err; end if;

  if p_mode = 'create' then
    if p_e ? 'ref' and (char_length(btrim(coalesce(p_e ->> 'ref', ''))) not between 1 and 80) then
      v_err := v_err || 'ref is 1 to 80 characters'::text;
    end if;
    begin
      if hq_private.knowledge_line(p_e ->> 'title', 200, 'a title') is null then
        v_err := v_err || 'a task needs a title'::text;
      end if;
    exception when others then v_err := v_err || sqlerrm; end;
  else
    begin
      if hq_private.meeting_uuid(p_e ->> 'id', 'the task id') is null then
        v_err := v_err || 'say which task (id)'::text;
      end if;
    exception when others then v_err := v_err || sqlerrm; end;
    if p_e ? 'title' then
      begin
        if hq_private.knowledge_line(p_e ->> 'title', 200, 'a title') is null then
          v_err := v_err || 'a task needs a title'::text;
        end if;
      exception when others then v_err := v_err || sqlerrm; end;
    end if;
    if p_e ? 'complete' and jsonb_typeof(p_e -> 'complete') not in ('boolean', 'null') then
      v_err := v_err || 'complete is true or false'::text;
    end if;
    if p_e ? 'status' and jsonb_typeof(p_e -> 'status') = 'null' then
      v_err := v_err || 'status cannot be cleared'::text;
    end if;
    if p_e ? 'priority' and jsonb_typeof(p_e -> 'priority') = 'null' then
      v_err := v_err || 'priority cannot be cleared'::text;
    end if;
    begin perform hq_private.meeting_text(p_e ->> 'comment', 4000, 'a comment'); exception when others then v_err := v_err || sqlerrm; end;
  end if;
  begin perform hq_private.meeting_text(p_e ->> 'description', 4000, 'the description'); exception when others then v_err := v_err || sqlerrm; end;
  begin perform hq_private.knowledge_line(p_e ->> 'blocked_reason', 500, 'blocked_reason'); exception when others then v_err := v_err || sqlerrm; end;
  begin perform hq_private.task_priority_from(p_e ->> 'priority'); exception when others then v_err := v_err || sqlerrm; end;
  begin perform hq_private.task_status_from(p_e ->> 'status'); exception when others then v_err := v_err || sqlerrm; end;
  begin perform hq_private.task_due_check(hq_private.meeting_date(p_e ->> 'due_date', 'due_date')); exception when others then v_err := v_err || sqlerrm; end;
  begin perform hq_private.task_sort_from(p_e ->> 'sort_order'); exception when others then v_err := v_err || sqlerrm; end;
  foreach v_key in array array['assignee', 'project', 'linked_contact', 'linked_organisation', 'linked_contractor', 'linked_opportunity'] loop
    begin perform hq_private.meeting_uuid(p_e ->> v_key, v_key); exception when others then v_err := v_err || sqlerrm; end;
  end loop;
  if p_mode = 'update' then
    begin perform hq_private.meeting_uuid(p_e ->> 'parent', 'parent'); exception when others then v_err := v_err || sqlerrm; end;
    begin perform hq_private.knowledge_line(p_e ->> 'waiting_on', 200, 'waiting_on'); exception when others then v_err := v_err || sqlerrm; end;
    begin perform hq_private.meeting_uuid(p_e ->> 'planning_item', 'planning_item'); exception when others then v_err := v_err || sqlerrm; end;
    foreach v_key in array array['waiting_since', 'expected_response', 'next_follow_up', 'planned_for'] loop
      begin perform hq_private.leadership_date(p_e ->> v_key, v_key); exception when others then v_err := v_err || sqlerrm; end;
    end loop;
    foreach v_key in array array['add_dependency', 'remove_dependency'] loop
      begin
        v_list := hq_private.json_strings(p_e -> v_key, v_key);
        foreach v_x in array v_list loop
          perform hq_private.meeting_uuid(v_x, v_key);
        end loop;
      exception when others then v_err := v_err || sqlerrm; end;
    end loop;
  else
    begin
      v_list := hq_private.json_strings(p_e -> 'depends_on', 'depends_on');
      if cardinality(v_list) > 50 then
        v_err := v_err || 'depends_on lists at most 50 tasks'::text;
      end if;
    exception when others then v_err := v_err || sqlerrm; end;
  end if;
  if p_e ? 'checklist' and jsonb_typeof(p_e -> 'checklist') <> 'null' then
    if jsonb_typeof(p_e -> 'checklist') <> 'array' then
      v_err := v_err || 'checklist must be a list'::text;
    elsif jsonb_array_length(p_e -> 'checklist') > 50 then
      v_err := v_err || 'a checklist has at most 50 items'::text;
    else
      for v_t in select case when jsonb_typeof(x) = 'string' then x #>> '{}' when jsonb_typeof(x) = 'object' then x ->> 'text' end from jsonb_array_elements(p_e -> 'checklist') x loop
        begin
          if hq_private.knowledge_line(v_t, 300, 'a checklist item') is null then
            v_err := v_err || 'a checklist item needs text'::text;
          end if;
        exception when others then v_err := v_err || sqlerrm; end;
      end loop;
    end if;
  end if;
  return v_err;
end $$;

-- ------------------------------------------------------------------ task_update_core (0144) with the 0148 fields
create or replace function hq_private.task_update_core(p_e jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_caller uuid := auth.uid();
  v_errors text[] := hq_private.task_entry_errors(p_e, 'update');
  v_cur hq.tasks;
  v_new hq.tasks;
  v_changed text[] := '{}';
  v_ms_text text;
  v_ms uuid;
  v_dep text;
  v_comment text;
  v_n integer;
  v_cl jsonb;
begin
  if cardinality(v_errors) > 0 then
    raise exception '%', array_to_string(v_errors, '; ') using errcode = 'invalid_parameter_value';
  end if;
  v_cur := hq_private.task_lock(hq_private.meeting_uuid(p_e ->> 'id', 'the task id'));
  v_new := v_cur;
  if p_e ? 'title' then v_new.title := hq_private.knowledge_line(p_e ->> 'title', 200, 'a title'); end if;
  if p_e ? 'description' then v_new.description := hq_private.meeting_text(p_e ->> 'description', 4000, 'the description'); end if;
  if p_e ? 'priority' then v_new.priority := hq_private.task_priority_from(p_e ->> 'priority'); end if;
  if p_e ? 'status' then v_new.status := hq_private.task_status_from(p_e ->> 'status'); end if;
  if coalesce((p_e ->> 'complete')::boolean, false) then v_new.status := 'completed'; end if;
  if p_e ? 'due_date' then v_new.due_date := hq_private.task_due_check(hq_private.meeting_date(p_e ->> 'due_date', 'due_date')); end if;
  if p_e ? 'blocked_reason' then v_new.blocked_reason := hq_private.knowledge_line(p_e ->> 'blocked_reason', 500, 'blocked_reason'); end if;
  if p_e ? 'waiting_on' then v_new.waiting_on := hq_private.knowledge_line(p_e ->> 'waiting_on', 200, 'waiting_on'); end if;
  if p_e ? 'waiting_since' then v_new.waiting_since := hq_private.leadership_date(p_e ->> 'waiting_since', 'waiting_since'); end if;
  if p_e ? 'expected_response' then v_new.expected_response_date := hq_private.leadership_date(p_e ->> 'expected_response', 'expected_response'); end if;
  if p_e ? 'next_follow_up' then v_new.next_follow_up_date := hq_private.leadership_date(p_e ->> 'next_follow_up', 'next_follow_up'); end if;
  if p_e ? 'planned_for' then v_new.planned_for := hq_private.leadership_date(p_e ->> 'planned_for', 'planned_for'); end if;
  if p_e ? 'planning_item' then
    v_new.planning_item_id := hq_private.meeting_uuid(p_e ->> 'planning_item', 'planning_item');
    if v_new.planning_item_id is not null and v_new.planning_item_id is distinct from v_cur.planning_item_id then
      perform hq_private.require_capability('planning.read');
      if not exists (select 1 from hq.planning_items p where p.id = v_new.planning_item_id and p.kind <> 'context' and p.status in ('anticipated', 'confirmed')) then
        raise exception 'planning item not found, or it has already been received or closed' using errcode = 'no_data_found';
      end if;
    end if;
  end if;
  if p_e ? 'sort_order' then v_new.sort_order := coalesce(hq_private.task_sort_from(p_e ->> 'sort_order'), 0); end if;
  if p_e ? 'assignee' then
    v_new.assigned_to := hq_private.meeting_uuid(p_e ->> 'assignee', 'assignee');
    if v_new.assigned_to is distinct from v_cur.assigned_to then
      perform hq_private.require_active_staff(v_new.assigned_to, 'the person a task is assigned to');
      if v_new.assigned_to is distinct from v_caller and not (v_cur.created_by = v_caller or hq_private.has_capability('tasks.read_all')) then
        raise exception 'only the person who created this task, or someone who can see everyone''s tasks, can give it to someone else'
          using errcode = 'insufficient_privilege', hint = 'task_assign_rule';
      end if;
    end if;
  end if;
  if p_e ? 'project' then
    v_new.project_id := hq_private.meeting_uuid(p_e ->> 'project', 'project');
    if v_new.project_id is distinct from v_cur.project_id then
      perform hq_private.require_capability('projects.write');
      if v_new.project_id is not null and not exists (select 1 from hq.projects p where p.id = v_new.project_id and p.deleted_at is null) then
        raise exception 'project not found' using errcode = 'no_data_found';
      end if;
      if not p_e ? 'milestone' then v_new.milestone_id := null; end if;
    end if;
  end if;
  if p_e ? 'milestone' then
    v_ms_text := nullif(btrim(coalesce(p_e ->> 'milestone', '')), '');
    v_ms := null;
    if v_ms_text is not null then
      if v_new.project_id is null then
        raise exception 'a milestone needs a project' using errcode = 'invalid_parameter_value';
      end if;
      if v_ms_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        select m.id into v_ms from hq.project_milestones m where m.id = v_ms_text::uuid and m.project_id = v_new.project_id;
      else
        select m.id into v_ms from hq.project_milestones m where m.project_id = v_new.project_id and lower(btrim(m.name)) = lower(btrim(regexp_replace(v_ms_text, '\s+', ' ', 'g')));
      end if;
      if v_ms is null then
        raise exception 'there is no milestone "%" in this project', left(v_ms_text, 80) using errcode = 'no_data_found';
      end if;
    end if;
    if v_ms is distinct from v_cur.milestone_id then
      perform hq_private.require_capability('projects.write');
    end if;
    v_new.milestone_id := v_ms;
  end if;
  if p_e ? 'parent' then
    v_new.parent_task_id := hq_private.meeting_uuid(p_e ->> 'parent', 'parent');
    if v_new.parent_task_id is not null and v_new.parent_task_id is distinct from v_cur.parent_task_id
       and not hq_private.task_visible_to_caller(v_new.parent_task_id) then
      raise exception 'parent task not found' using errcode = 'no_data_found';
    end if;
  end if;
  if v_new.title is null then
    raise exception 'a task needs a title' using errcode = 'invalid_parameter_value';
  end if;

  if v_new.title is distinct from v_cur.title then v_changed := v_changed || 'title'::text; end if;
  if v_new.description is distinct from v_cur.description then v_changed := v_changed || 'description'::text; end if;
  if v_new.priority is distinct from v_cur.priority then v_changed := v_changed || 'priority'::text; end if;
  if v_new.status is distinct from v_cur.status then v_changed := v_changed || 'status'::text; end if;
  if v_new.due_date is distinct from v_cur.due_date then v_changed := v_changed || 'due_date'::text; end if;
  if v_new.assigned_to is distinct from v_cur.assigned_to then v_changed := v_changed || 'assignee'::text; end if;
  if v_new.project_id is distinct from v_cur.project_id then v_changed := v_changed || 'project'::text; end if;
  if v_new.milestone_id is distinct from v_cur.milestone_id then v_changed := v_changed || 'milestone'::text; end if;
  if v_new.parent_task_id is distinct from v_cur.parent_task_id then v_changed := v_changed || 'parent'::text; end if;
  if v_new.sort_order is distinct from v_cur.sort_order then v_changed := v_changed || 'sort_order'::text; end if;
  if v_new.blocked_reason is distinct from v_cur.blocked_reason then v_changed := v_changed || 'blocked_reason'::text; end if;
  if v_new.waiting_on is distinct from v_cur.waiting_on then v_changed := v_changed || 'waiting_on'::text; end if;
  if v_new.waiting_since is distinct from v_cur.waiting_since then v_changed := v_changed || 'waiting_since'::text; end if;
  if v_new.expected_response_date is distinct from v_cur.expected_response_date then v_changed := v_changed || 'expected_response'::text; end if;
  if v_new.next_follow_up_date is distinct from v_cur.next_follow_up_date then v_changed := v_changed || 'next_follow_up'::text; end if;
  if v_new.planned_for is distinct from v_cur.planned_for then v_changed := v_changed || 'planned_for'::text; end if;
  if v_new.planning_item_id is distinct from v_cur.planning_item_id then v_changed := v_changed || 'planning_item'::text; end if;

  if cardinality(v_changed) > 0 then
    update hq.tasks set
      title = v_new.title, description = v_new.description, priority = v_new.priority, status = v_new.status, due_date = v_new.due_date,
      assigned_to = v_new.assigned_to, project_id = v_new.project_id, milestone_id = v_new.milestone_id, parent_task_id = v_new.parent_task_id,
      sort_order = v_new.sort_order, blocked_reason = v_new.blocked_reason,
      waiting_on = v_new.waiting_on, waiting_since = v_new.waiting_since, expected_response_date = v_new.expected_response_date,
      next_follow_up_date = v_new.next_follow_up_date, planned_for = v_new.planned_for, planning_item_id = v_new.planning_item_id
    where id = v_cur.id;
  end if;

  foreach v_dep in array hq_private.json_strings(p_e -> 'add_dependency', 'add_dependency') loop
    if hq_private.task_dependency_add(v_cur.id, hq_private.meeting_uuid(v_dep, 'add_dependency')) then
      v_changed := v_changed || 'add_dependency'::text;
    end if;
  end loop;
  foreach v_dep in array hq_private.json_strings(p_e -> 'remove_dependency', 'remove_dependency') loop
    delete from hq.task_dependencies d where d.task_id = v_cur.id and d.depends_on_task_id = hq_private.meeting_uuid(v_dep, 'remove_dependency');
    get diagnostics v_n = row_count;
    if v_n > 0 then
      perform hq_private.task_activity_write(v_cur.id, 'dependency_removed', 'No longer waits for another task', jsonb_build_object('depends_on_task_id', v_dep));
      v_changed := v_changed || 'remove_dependency'::text;
    end if;
  end loop;
  if p_e ? 'checklist' and jsonb_typeof(p_e -> 'checklist') <> 'null' then
    v_cl := hq_private.task_checklist_apply(v_cur.id, p_e -> 'checklist');
    if (v_cl ->> 'changed')::boolean then
      perform hq_private.task_activity_write(v_cur.id, 'checklist', format('Checklist updated (%s of %s done)', v_cl ->> 'done', v_cl ->> 'total'), v_cl);
      v_changed := v_changed || 'checklist'::text;
    end if;
  end if;
  v_comment := hq_private.meeting_text(p_e ->> 'comment', 4000, 'a comment');
  if v_comment is not null then
    insert into hq.task_comments (task_id, author_id, body) values (v_cur.id, v_caller, v_comment);
    perform hq_private.task_activity_write(v_cur.id, 'comment', 'Comment added', '{}'::jsonb);
    v_changed := v_changed || 'comment'::text;
  end if;
  return jsonb_build_object('id', v_cur.id, 'changed', to_jsonb(v_changed));
end $$;

-- ------------------------------------------------------------------ planning items
create function hq_private.planning_item_json(p hq.planning_items) returns jsonb
language sql stable set search_path = pg_catalog, public, extensions as $$
  select jsonb_build_object(
    'id', p.id, 'ref', 'PLN-' || lpad(p.ref_number::text, greatest(4, length(p.ref_number::text)), '0'),
    'kind', p.kind, 'title', p.title, 'detail', p.detail, 'amount_anticipated', p.amount_anticipated,
    'expected_text', p.expected_text, 'expected_by', p.expected_by, 'status', p.status, 'version', p.version,
    'updated_at', p.updated_at)
$$;

-- planning.write. Creates (p_id null: kind and title required; status defaults to anticipated, or current
-- for context) or changes one planning item. Only the values given change; p_clear lists fields to empty
-- (detail, amount_anticipated, expected_text, expected_by). p_version, when given, must match (an edit
-- made against an older version is refused). Returns the item plus {changed}.
create function hq.save_planning_item(
  p_id uuid default null,
  p_kind hq.planning_kind default null,
  p_title text default null,
  p_detail text default null,
  p_amount numeric default null,
  p_expected_text text default null,
  p_expected_by date default null,
  p_status hq.planning_status default null,
  p_clear text[] default null,
  p_version integer default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_cur hq.planning_items;
  v_new hq.planning_items;
  v_clear text[] := coalesce(p_clear, '{}');
  v_c text;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('planning.write');
  foreach v_c in array v_clear loop
    if v_c not in ('detail', 'amount_anticipated', 'expected_text', 'expected_by') then
      raise exception 'only detail, amount_anticipated, expected_text and expected_by can be cleared' using errcode = 'invalid_parameter_value';
    end if;
  end loop;
  if p_expected_by is not null and (p_expected_by < date '2000-01-01' or p_expected_by > hq.today() + 1826) then
    raise exception 'expected_by must be within the next five years' using errcode = 'invalid_parameter_value';
  end if;

  if p_id is null then
    if p_kind is null then
      raise exception 'say what kind of planning item this is (funding, dependency or context)' using errcode = 'invalid_parameter_value';
    end if;
    if hq_private.knowledge_line(p_title, 200, 'a title') is null then
      raise exception 'a planning item needs a title' using errcode = 'invalid_parameter_value';
    end if;
    insert into hq.planning_items (kind, title, detail, amount_anticipated, expected_text, expected_by, status)
    values (p_kind, hq_private.knowledge_line(p_title, 200, 'a title'), hq_private.meeting_text(p_detail, 2000, 'the detail'),
            p_amount, hq_private.knowledge_line(p_expected_text, 200, 'expected_text'), p_expected_by,
            coalesce(p_status, case when p_kind = 'context' then 'current'::hq.planning_status else 'anticipated'::hq.planning_status end))
    returning * into v_new;
    return hq_private.planning_item_json(v_new) || jsonb_build_object('changed', true, 'created', true);
  end if;

  select * into v_cur from hq.planning_items p where p.id = p_id for update;
  if not found then
    raise exception 'planning item not found' using errcode = 'no_data_found';
  end if;
  if p_kind is not null and p_kind is distinct from v_cur.kind then
    raise exception 'the kind of a planning item cannot change' using errcode = 'invalid_parameter_value';
  end if;
  if p_version is not null and p_version <> v_cur.version then
    raise exception 'this planning item was changed by someone else; reload it and try again' using errcode = 'serialization_failure';
  end if;
  v_new := v_cur;
  if p_title is not null then
    v_new.title := hq_private.knowledge_line(p_title, 200, 'a title');
    if v_new.title is null then
      raise exception 'a planning item needs a title' using errcode = 'invalid_parameter_value';
    end if;
  end if;
  if p_detail is not null then v_new.detail := hq_private.meeting_text(p_detail, 2000, 'the detail'); end if;
  if p_amount is not null then v_new.amount_anticipated := p_amount; end if;
  if p_expected_text is not null then v_new.expected_text := hq_private.knowledge_line(p_expected_text, 200, 'expected_text'); end if;
  if p_expected_by is not null then v_new.expected_by := p_expected_by; end if;
  if p_status is not null then v_new.status := p_status; end if;
  if 'detail' = any (v_clear) then v_new.detail := null; end if;
  if 'amount_anticipated' = any (v_clear) then v_new.amount_anticipated := null; end if;
  if 'expected_text' = any (v_clear) then v_new.expected_text := null; end if;
  if 'expected_by' = any (v_clear) then v_new.expected_by := null; end if;

  if (v_new.title, v_new.detail, v_new.amount_anticipated, v_new.expected_text, v_new.expected_by, v_new.status)
     is not distinct from (v_cur.title, v_cur.detail, v_cur.amount_anticipated, v_cur.expected_text, v_cur.expected_by, v_cur.status) then
    return hq_private.planning_item_json(v_cur) || jsonb_build_object('changed', false);
  end if;
  update hq.planning_items set
    title = v_new.title, detail = v_new.detail, amount_anticipated = v_new.amount_anticipated,
    expected_text = v_new.expected_text, expected_by = v_new.expected_by, status = v_new.status
  where id = v_cur.id
  returning * into v_new;
  return hq_private.planning_item_json(v_new) || jsonb_build_object('changed', true);
end $$;
comment on function hq.save_planning_item(uuid, hq.planning_kind, text, text, numeric, text, date, hq.planning_status, text[], integer) is 'planning.write. Creates (no id: kind and title required) or changes one planning item: title, detail, amount_anticipated (funding only; a planning figure, never a balance), expected_text (the founder''s words for timing), expected_by (a real date, only when known), status (anticipated | confirmed | received | closed; context: current | closed). p_clear empties detail, amount_anticipated, expected_text or expected_by; p_version guards against an edit made on an older version. Returns the item json plus {changed}.';

-- ------------------------------------------------------------------ waiting
-- tasks.write, and the task-update rule. Puts ONE task into the waiting status with what it waits on (in
-- words, or a planning item, or both), and optionally since when, when a reply is expected and when to
-- follow up, plus a note for its comments. Only values given are set; nothing else about the task changes.
create function hq.set_task_waiting(
  p_task uuid,
  p_waiting_on text default null,
  p_planning_item uuid default null,
  p_since date default null,
  p_expected date default null,
  p_follow_up date default null,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_patch jsonb;
  v_r jsonb;
  v_t hq.tasks;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('tasks.write');
  if hq_private.knowledge_line(p_waiting_on, 200, 'waiting_on') is null and p_planning_item is null then
    v_t := hq_private.task_lock(p_task);
    if v_t.waiting_on is null and v_t.planning_item_id is null then
      raise exception 'say what the task is waiting on (in words, or a planning item such as the funding)' using errcode = 'invalid_parameter_value';
    end if;
  end if;
  v_patch := jsonb_build_object('id', p_task, 'status', 'waiting');
  if p_waiting_on is not null then v_patch := v_patch || jsonb_build_object('waiting_on', p_waiting_on); end if;
  if p_planning_item is not null then v_patch := v_patch || jsonb_build_object('planning_item', p_planning_item); end if;
  if p_since is not null then v_patch := v_patch || jsonb_build_object('waiting_since', p_since::text); end if;
  if p_expected is not null then v_patch := v_patch || jsonb_build_object('expected_response', p_expected::text); end if;
  if p_follow_up is not null then v_patch := v_patch || jsonb_build_object('next_follow_up', p_follow_up::text); end if;
  if p_note is not null then v_patch := v_patch || jsonb_build_object('comment', p_note); end if;
  v_r := hq_private.task_update_core(v_patch);
  select * into v_t from hq.tasks t where t.id = p_task;
  return hq_private.task_json(v_t) || jsonb_build_object(
    'changed', jsonb_array_length(v_r -> 'changed') > 0, 'changed_fields', v_r -> 'changed',
    'waiting_on', v_t.waiting_on, 'planning_item_id', v_t.planning_item_id, 'waiting_since', v_t.waiting_since,
    'expected_response_date', v_t.expected_response_date, 'next_follow_up_date', v_t.next_follow_up_date);
end $$;
comment on function hq.set_task_waiting(uuid, text, uuid, date, date, date, text) is 'tasks.write (the task-update rule; planning.read to link a planning item). Sets ONE task to waiting with what it waits on (words and/or an anticipated or confirmed planning item) and, only when given, since when, the expected reply and the next follow-up; an optional note becomes a comment. Never changes priority or due date. Returns the task json plus {changed, changed_fields} and the waiting fields.';

-- tasks.write, and the task-update rule. The wait is over ("Ailo has called me back"): ONE task that is
-- waiting (or held up) moves to p_next (in_progress by default; to_do or completed allowed), the waiting
-- fields clear (0148 trigger), and the note goes into its comments. Optionally sets the next follow-up and
-- a new due date, when the person gives them.
create function hq.resolve_task_waiting(
  p_task uuid,
  p_next hq.task_status default 'in_progress',
  p_note text default null,
  p_follow_up date default null,
  p_due date default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_cur hq.tasks;
  v_patch jsonb;
  v_r jsonb;
  v_t hq.tasks;
  v_was text;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('tasks.write');
  if p_next not in ('to_do', 'in_progress', 'completed') then
    raise exception 'after waiting, a task goes to to_do, in_progress or completed' using errcode = 'invalid_parameter_value';
  end if;
  v_cur := hq_private.task_lock(p_task);
  if v_cur.status <> 'waiting' and v_cur.waiting_on is null and v_cur.planning_item_id is null and v_cur.blocked_reason is null then
    raise exception 'that task is not waiting on anything' using errcode = 'invalid_parameter_value', hint = 'not_waiting';
  end if;
  v_was := coalesce(v_cur.waiting_on, (select p.title from hq.planning_items p where p.id = v_cur.planning_item_id), v_cur.blocked_reason);
  v_patch := jsonb_build_object('id', p_task, 'status', p_next, 'waiting_on', null, 'expected_response', null,
                                'planning_item', null, 'waiting_since', null, 'blocked_reason', null);
  if p_note is not null then v_patch := v_patch || jsonb_build_object('comment', p_note); end if;
  if p_follow_up is not null then v_patch := v_patch || jsonb_build_object('next_follow_up', p_follow_up::text); end if;
  if p_due is not null then v_patch := v_patch || jsonb_build_object('due_date', p_due::text); end if;
  if p_next = 'completed' and p_follow_up is null then v_patch := v_patch || jsonb_build_object('next_follow_up', null); end if;
  v_r := hq_private.task_update_core(v_patch);
  select * into v_t from hq.tasks t where t.id = p_task;
  return hq_private.task_json(v_t) || jsonb_build_object(
    'changed', jsonb_array_length(v_r -> 'changed') > 0, 'changed_fields', v_r -> 'changed', 'was_waiting_on', v_was,
    'next_follow_up_date', v_t.next_follow_up_date);
end $$;
comment on function hq.resolve_task_waiting(uuid, hq.task_status, text, date, date) is 'tasks.write (the task-update rule). The wait is over for ONE task that is waiting or held up: status to p_next (in_progress default; to_do or completed), what it waited on is cleared (kept in its history), an optional note becomes a comment, and only when given the next follow-up and a new due date. Refuses a task that is not waiting (hint not_waiting). Returns the task json plus {changed, changed_fields, was_waiting_on}.';

-- ------------------------------------------------------------------ launch requirements
create function hq.set_milestone_launch_gate(p_id uuid, p_gate boolean) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_m hq.project_milestones;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('projects.write');
  if p_gate is null then
    raise exception 'say true or false' using errcode = 'invalid_parameter_value';
  end if;
  v_m := hq_private.milestone_lock(p_id);
  if v_m.launch_gate = p_gate then
    return hq_private.milestone_json(v_m) || jsonb_build_object('launch_gate', v_m.launch_gate, 'changed', false);
  end if;
  update hq.project_milestones set launch_gate = p_gate where id = v_m.id returning * into v_m;
  perform hq_private.project_activity_write(v_m.project_id, 'milestone_launch_gate',
    case when p_gate then 'Marked as required to open: ' else 'No longer required to open: ' end || v_m.name,
    jsonb_build_object('milestone_id', v_m.id, 'launch_gate', p_gate));
  return hq_private.milestone_json(v_m) || jsonb_build_object('launch_gate', v_m.launch_gate, 'changed', true);
end $$;
comment on function hq.set_milestone_launch_gate(uuid, boolean) is 'projects.write. Marks ONE milestone as required (or not) before the business can open. Launch readiness counts these milestones, apart from task completion. Writes project activity. Returns the milestone json plus {launch_gate, changed}.';
