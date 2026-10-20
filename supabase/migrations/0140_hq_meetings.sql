-- 0140_hq_meetings.sql
-- Meetings: what was discussed, decided and agreed at a meeting, saved as minutes with a short summary,
-- attendees, the records it was about (a partner, a lead, a contractor ...) and action items that are
-- REAL TASKS. Same patterns as the decisions register (0125) and the knowledge base (0138).
--
-- HOW MEETINGS GET HERE: a person tells ChatGPT or Claude about a meeting (dictating, or pasting notes
-- or a transcript from a recording tool); the assistant writes the minutes and the summary and saves
-- them with the MCP tool create_meeting, which calls hq.create_meeting below. Or someone types them into
-- the HQ form. HQ itself records no audio and has no AI inside; a transcript is never stored, only the
-- minutes.
--
-- TABLES (schema hq; RLS enabled and forced; the API may only SELECT; every write goes through the
-- security definer RPCs below):
--   meetings            one row per meeting, shown as MTG-0001 (ref_number). Soft deletion only
--                       (archive_record / restore_record, entity 'meeting'); never deleted. `version`
--                       goes up by one with every recorded change (optimistic concurrency for edits).
--                       `staff_attendee_ids` is a copy of the staff attendees, kept by the RPCs, so the
--                       confidential rule can be read by RLS without a policy loop.
--   meeting_attendees   who was there: exactly one of a member of staff, a contact, or a typed name
--                       (someone HQ does not hold). One row per person per meeting; at most 40.
--   meeting_links       the records the meeting was about: exactly one of a contact, organisation,
--                       lead (opportunity), contractor, decision or managed property. One per record.
--                       interaction_id is the touch point the meeting logged on that record (below).
--   meeting_actions     action items: each is a task in hq.tasks (source 'meeting'), linked here, so
--                       assignment, due dates, task visibility and the audit trail all apply.
--   meeting_history     append-only: one row per version (who, when, through HQ or a chat app, the
--                       change note, and a snapshot of the title, summary, minutes and decisions), so
--                       every edit of the minutes can be read back.
--
-- TOUCH POINTS: a meeting linked to a contact, organisation, lead or contractor also logs ONE normal
-- interaction on each (type office_meeting; coffee_meeting when the location says coffee or cafe;
-- phone_call when it says phone or call; occurred_at = held_at, never in the future), so "last
-- contacted" and the referral-partner views see it. Editing the meeting updates that interaction, never
-- a second one. An organisation is not logged twice: when a linked contact belongs to a linked
-- organisation, the contact's interaction carries the organisation (as record_interaction does).
-- Unlinking, or archiving the meeting, archives its touch points. A CONFIDENTIAL meeting's touch point
-- says only "MTG-0001 (confidential meeting: details are in Meetings)": its title and summary never
-- reach the partner timelines.
--
-- CONFIDENTIAL MEETINGS are visible only to their staff attendees, the person who recorded them, and
-- holders of audit.read (directors and administrators). Everything else (the overview, open actions,
-- Today, chat lists and search) reads through RLS, so it cannot see them either. Only the recorder or
-- an audit.read holder can change whether a meeting is confidential.
--
-- CAPABILITIES (data, in hq.role_capabilities; an assumption for the owner to confirm):
--   meetings.read, meetings.write   director, administrator, senior_property_manager, property_manager,
--                                   business_development_manager, virtual_assistant.
--   junior_property_manager and read_only: none.
--   Action items also need tasks.write; adding a meeting decision to the Decisions register needs
--   decisions.write; linking a record needs the right to read it (growth.read, contractors.read,
--   decisions.read, portfolio.read).
--
-- RPCs (security definer, search_path pinned, capability and MFA checked inside, audited as entity
-- meeting): create_meeting, update_meeting, add_meeting_attendee, remove_meeting_attendee,
-- link_meeting, unlink_meeting, add_meeting_action, promote_decision_to_register; archive_record /
-- restore_record gain entity 'meeting'. Function privileges: 0141.

-- ------------------------------------------------------------------ enum
create type hq.meeting_type as enum (
  'partner_referral', 'internal_team', 'contractor', 'landlord_owner', 'supplier_other', 'planning_strategy', 'other');

-- ------------------------------------------------------------------ capabilities (an assumption for the owner to confirm)
insert into hq.role_capabilities (role, capability)
select r.role::hq.staff_role, r.capability
from (values
  ('director', 'meetings.read'), ('director', 'meetings.write'),
  ('administrator', 'meetings.read'), ('administrator', 'meetings.write'),
  ('senior_property_manager', 'meetings.read'), ('senior_property_manager', 'meetings.write'),
  ('property_manager', 'meetings.read'), ('property_manager', 'meetings.write'),
  ('business_development_manager', 'meetings.read'), ('business_development_manager', 'meetings.write'),
  ('virtual_assistant', 'meetings.read'), ('virtual_assistant', 'meetings.write')
) as r(role, capability)
on conflict do nothing;

-- ------------------------------------------------------------------ tasks may come from a meeting
alter table hq.tasks drop constraint tasks_source_known;
alter table hq.tasks add constraint tasks_source_known check (source in ('manual', 'interaction', 'ai_draft', 'website_enquiry', 'meeting'));

-- ------------------------------------------------------------------ meetings
create table hq.meetings (
  id uuid primary key default gen_random_uuid(),
  ref_number bigint generated always as identity,
  title text not null,
  meeting_type hq.meeting_type not null default 'other',
  held_at timestamptz not null,
  duration_minutes integer,
  location text,
  summary text,
  minutes text,
  decisions_text text,
  confidential boolean not null default false,
  staff_attendee_ids uuid[] not null default '{}',
  version integer not null default 1,
  created_via text not null default 'hq',
  mcp_client_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  constraint meetings_title_length check (char_length(btrim(title)) between 1 and 200),
  constraint meetings_duration_sane check (duration_minutes is null or duration_minutes between 1 and 1440),
  constraint meetings_location_length check (location is null or char_length(location) between 1 and 200),
  constraint meetings_summary_length check (summary is null or char_length(summary) between 1 and 2000),
  constraint meetings_minutes_length check (minutes is null or char_length(minutes) between 1 and 50000),
  constraint meetings_decisions_length check (decisions_text is null or char_length(decisions_text) between 1 and 5000),
  constraint meetings_held_sane check (held_at >= timestamptz '2000-01-01 00:00:00+00'),
  constraint meetings_version_positive check (version >= 1),
  constraint meetings_via_known check (created_via in ('hq', 'mcp')),
  constraint meetings_client_iff_mcp check ((created_via = 'mcp') = (mcp_client_id is not null)),
  constraint meetings_client_length check (mcp_client_id is null or char_length(mcp_client_id) between 1 and 200)
);
comment on table hq.meetings is 'Meetings, shown as MTG-0001: summary (lists and Today), minutes (safe markdown), decisions, attendees (meeting_attendees), linked records (meeting_links) and action items (meeting_actions, real tasks). Written only by the meeting RPCs and archive_record / restore_record (entity meeting). Never deleted. A confidential meeting is visible only to its staff attendees, its recorder and audit.read holders.';
comment on column hq.meetings.staff_attendee_ids is 'A copy of the staff ids in meeting_attendees, kept by the meeting RPCs, read by the confidential rule in RLS.';
comment on column hq.meetings.version is 'Goes up by one with every recorded change; update_meeting refuses an edit made against an older version.';
create unique index meetings_ref_number_uq on hq.meetings (ref_number);
create index meetings_held_at_idx on hq.meetings (held_at desc, ref_number desc) where deleted_at is null;
create index meetings_created_by_idx on hq.meetings (created_by);
create index meetings_type_idx on hq.meetings (meeting_type) where deleted_at is null;
create index meetings_staff_attendee_ids_idx on hq.meetings using gin (staff_attendee_ids);
create index meetings_title_trgm_idx on hq.meetings using gin (title extensions.gin_trgm_ops);

-- ------------------------------------------------------------------ meeting_attendees
create table hq.meeting_attendees (
  id bigint generated always as identity primary key,
  meeting_id uuid not null references hq.meetings (id),
  staff_id uuid references hq.staff_profiles (id),
  contact_id uuid references hq.contacts (id),
  external_name text,
  added_by uuid default auth.uid(),
  added_at timestamptz not null default now(),
  constraint meeting_attendees_exactly_one check (num_nonnulls(staff_id, contact_id, external_name) = 1),
  constraint meeting_attendees_name_length check (external_name is null or char_length(btrim(external_name)) between 1 and 120)
);
comment on table hq.meeting_attendees is 'Who was at a meeting: exactly one of a member of staff, a contact, or a typed name. One row per person per meeting, at most 40. Written only by the meeting RPCs.';
create unique index meeting_attendees_staff_uq on hq.meeting_attendees (meeting_id, staff_id) where staff_id is not null;
create unique index meeting_attendees_contact_uq on hq.meeting_attendees (meeting_id, contact_id) where contact_id is not null;
create unique index meeting_attendees_name_uq on hq.meeting_attendees (meeting_id, lower(external_name)) where external_name is not null;
create index meeting_attendees_meeting_id_idx on hq.meeting_attendees (meeting_id);
create index meeting_attendees_staff_id_idx on hq.meeting_attendees (staff_id);
create index meeting_attendees_contact_id_idx on hq.meeting_attendees (contact_id);

-- ------------------------------------------------------------------ meeting_links
create table hq.meeting_links (
  id bigint generated always as identity primary key,
  meeting_id uuid not null references hq.meetings (id),
  contact_id uuid references hq.contacts (id),
  organisation_id uuid references hq.organisations (id),
  opportunity_id uuid references hq.opportunities (id),
  contractor_id uuid references hq.contractors (id),
  decision_id uuid references hq.decisions (id),
  managed_property_id uuid references hq.managed_properties (id),
  interaction_id uuid references hq.interactions (id),
  linked_by uuid default auth.uid(),
  linked_at timestamptz not null default now(),
  constraint meeting_links_exactly_one check (num_nonnulls(contact_id, organisation_id, opportunity_id, contractor_id, decision_id, managed_property_id) = 1),
  constraint meeting_links_touch_point_kinds check (interaction_id is null or (decision_id is null and managed_property_id is null))
);
comment on table hq.meeting_links is 'The records a meeting was about: exactly one of a contact, organisation, lead (opportunity), contractor, decision or managed property per row, one row per record. interaction_id is the touch point logged on a contact, organisation, lead or contractor. Written only by the meeting RPCs.';
create unique index meeting_links_contact_uq on hq.meeting_links (meeting_id, contact_id) where contact_id is not null;
create unique index meeting_links_organisation_uq on hq.meeting_links (meeting_id, organisation_id) where organisation_id is not null;
create unique index meeting_links_opportunity_uq on hq.meeting_links (meeting_id, opportunity_id) where opportunity_id is not null;
create unique index meeting_links_contractor_uq on hq.meeting_links (meeting_id, contractor_id) where contractor_id is not null;
create unique index meeting_links_decision_uq on hq.meeting_links (meeting_id, decision_id) where decision_id is not null;
create unique index meeting_links_managed_property_uq on hq.meeting_links (meeting_id, managed_property_id) where managed_property_id is not null;
create index meeting_links_meeting_id_idx on hq.meeting_links (meeting_id);
create index meeting_links_contact_id_idx on hq.meeting_links (contact_id);
create index meeting_links_organisation_id_idx on hq.meeting_links (organisation_id);
create index meeting_links_opportunity_id_idx on hq.meeting_links (opportunity_id);
create index meeting_links_contractor_id_idx on hq.meeting_links (contractor_id);
create index meeting_links_decision_id_idx on hq.meeting_links (decision_id);
create index meeting_links_managed_property_id_idx on hq.meeting_links (managed_property_id);
create unique index meeting_links_interaction_uq on hq.meeting_links (interaction_id) where interaction_id is not null;

-- ------------------------------------------------------------------ meeting_actions
create table hq.meeting_actions (
  task_id uuid primary key references hq.tasks (id),
  meeting_id uuid not null references hq.meetings (id),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
comment on table hq.meeting_actions is 'Action items from a meeting: each is a task (hq.tasks, source meeting) created by the meeting RPCs. A task belongs to one meeting. The task itself is completed, reassigned or archived like any other task.';
create index meeting_actions_meeting_id_idx on hq.meeting_actions (meeting_id, created_at);

-- ------------------------------------------------------------------ meeting_history (append-only)
create table hq.meeting_history (
  id bigint generated always as identity primary key,
  meeting_id uuid not null references hq.meetings (id),
  version integer not null,
  action text not null,
  change_summary text not null,
  edited_by uuid,
  edited_by_name text,
  edited_at timestamptz not null default now(),
  via text not null default 'hq',
  mcp_client_id text,
  change_note text,
  title text not null,
  summary text,
  minutes text,
  decisions_text text,
  changes jsonb not null default '{}'::jsonb,
  constraint meeting_history_action_known check (action in ('create', 'update', 'add_attendee', 'remove_attendee', 'link', 'unlink', 'add_action', 'promote_decision', 'archive', 'restore')),
  constraint meeting_history_summary_length check (char_length(change_summary) between 1 and 500),
  constraint meeting_history_note_length check (change_note is null or char_length(change_note) <= 300),
  constraint meeting_history_via_known check (via in ('hq', 'mcp')),
  constraint meeting_history_client_iff_mcp check ((via = 'mcp') = (mcp_client_id is not null)),
  constraint meeting_history_changes_object check (jsonb_typeof(changes) = 'object'),
  constraint meeting_history_version_positive check (version >= 1)
);
comment on table hq.meeting_history is 'Append-only history of each meeting: one row per version (who, when, hq or mcp, the change note, what changed, and a snapshot of the title, summary, minutes and decisions at that version). Written inside the meeting RPCs and archive_record / restore_record.';
create unique index meeting_history_version_uq on hq.meeting_history (meeting_id, version);

-- ------------------------------------------------------------------ guards (every writer, including the table owner)
create function hq_private.meeting_guard() returns trigger
language plpgsql set search_path = pg_catalog, public, extensions as $$
begin
  new.title := btrim(new.title);
  new.location := nullif(btrim(coalesce(new.location, '')), '');
  if tg_op = 'UPDATE' then
    if new.ref_number is distinct from old.ref_number then
      raise exception 'a meeting''s number cannot change' using errcode = 'insufficient_privilege';
    end if;
    if (new.created_via, new.mcp_client_id) is distinct from (old.created_via, old.mcp_client_id) then
      raise exception 'how a meeting was recorded cannot change' using errcode = 'insufficient_privilege';
    end if;
    if new.version < old.version then
      raise exception 'a meeting''s version never goes back' using errcode = 'insufficient_privilege';
    end if;
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  else
    new.updated_by := null;
  end if;
  if (tg_op = 'INSERT' or new.held_at is distinct from old.held_at) and new.held_at > now() + interval '1 day' then
    raise exception 'a meeting is recorded after it is held: the date cannot be more than a day ahead' using errcode = 'invalid_parameter_value';
  end if;
  return new;
end $$;

create function hq_private.meeting_attendee_guard() returns trigger
language plpgsql set search_path = pg_catalog, public, extensions as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'an attendee is added or removed, never changed' using errcode = 'insufficient_privilege';
  end if;
  new.external_name := nullif(btrim(regexp_replace(coalesce(new.external_name, ''), '\s+', ' ', 'g')), '');
  if (select count(*) from hq.meeting_attendees a where a.meeting_id = new.meeting_id) >= 40 then
    raise exception 'a meeting can have at most 40 attendees' using errcode = 'check_violation', hint = 'meeting_attendee_limit';
  end if;
  return new;
end $$;

create function hq_private.meeting_link_guard() returns trigger
language plpgsql set search_path = pg_catalog, public, extensions as $$
begin
  if (new.id, new.meeting_id, new.contact_id, new.organisation_id, new.opportunity_id, new.contractor_id, new.decision_id, new.managed_property_id, new.linked_by, new.linked_at)
     is distinct from
     (old.id, old.meeting_id, old.contact_id, old.organisation_id, old.opportunity_id, old.contractor_id, old.decision_id, old.managed_property_id, old.linked_by, old.linked_at) then
    raise exception 'a link is added or removed, never changed' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

create trigger row_stamp before insert or update on hq.meetings for each row execute function hq_private.row_stamp();
create trigger soft_delete_guard before insert or update on hq.meetings for each row execute function hq_private.soft_delete_guard();
create trigger meeting_guard before insert or update on hq.meetings for each row execute function hq_private.meeting_guard();
create trigger no_delete before delete on hq.meetings for each row execute function hq_private.raise_immutable();
create trigger no_truncate before truncate on hq.meetings for each statement execute function hq_private.raise_immutable();
create trigger audit after insert or update or delete on hq.meetings for each row execute function hq_private.audit_row('meeting');

create trigger meeting_attendee_guard before insert or update on hq.meeting_attendees for each row execute function hq_private.meeting_attendee_guard();
create trigger no_truncate before truncate on hq.meeting_attendees for each statement execute function hq_private.raise_immutable();

create trigger meeting_link_guard before update on hq.meeting_links for each row execute function hq_private.meeting_link_guard();
create trigger no_truncate before truncate on hq.meeting_links for each statement execute function hq_private.raise_immutable();

create trigger no_change before update or delete on hq.meeting_actions for each row execute function hq_private.raise_immutable();
create trigger no_truncate before truncate on hq.meeting_actions for each statement execute function hq_private.raise_immutable();

create trigger append_only before update or delete on hq.meeting_history for each row execute function hq_private.raise_immutable();
create trigger append_only_truncate before truncate on hq.meeting_history for each statement execute function hq_private.raise_immutable();

-- ------------------------------------------------------------------ access
alter table hq.meetings enable row level security;           alter table hq.meetings force row level security;
alter table hq.meeting_attendees enable row level security;  alter table hq.meeting_attendees force row level security;
alter table hq.meeting_links enable row level security;      alter table hq.meeting_links force row level security;
alter table hq.meeting_actions enable row level security;    alter table hq.meeting_actions force row level security;
alter table hq.meeting_history enable row level security;    alter table hq.meeting_history force row level security;

-- Readers see live meetings; archived ones only meetings.write holders (who can restore them). A
-- confidential meeting: only its staff attendees, its recorder and audit.read holders.
create policy meetings_select on hq.meetings for select to authenticated
  using ((select hq_private.has_capability('meetings.read'))
         and (deleted_at is null or (select hq_private.has_capability('meetings.write')))
         and (not confidential
              or created_by = (select auth.uid())
              or (select auth.uid()) = any (staff_attendee_ids)
              or (select hq_private.has_capability('audit.read'))));
-- Attendees, links, actions and history of a meeting the reader can see (the subquery runs under the reader's RLS).
create policy meeting_attendees_select on hq.meeting_attendees for select to authenticated
  using ((select hq_private.has_capability('meetings.read')) and exists (select 1 from hq.meetings m where m.id = meeting_id));
create policy meeting_links_select on hq.meeting_links for select to authenticated
  using ((select hq_private.has_capability('meetings.read')) and exists (select 1 from hq.meetings m where m.id = meeting_id));
create policy meeting_actions_select on hq.meeting_actions for select to authenticated
  using ((select hq_private.has_capability('meetings.read')) and exists (select 1 from hq.meetings m where m.id = meeting_id));
create policy meeting_history_select on hq.meeting_history for select to authenticated
  using ((select hq_private.has_capability('meetings.read')) and exists (select 1 from hq.meetings m where m.id = meeting_id));

revoke all on hq.meetings, hq.meeting_attendees, hq.meeting_links, hq.meeting_actions, hq.meeting_history from public, anon, authenticated, service_role;
grant select on hq.meetings, hq.meeting_attendees, hq.meeting_links, hq.meeting_actions, hq.meeting_history to authenticated, service_role;

-- ------------------------------------------------------------------ views
-- security_invoker: the reader's RLS applies to every table read, so a confidential meeting the reader
-- may not see is not a row; attendee and linked names come only from records the reader may read; the
-- action counts include ONLY tasks the reader can see.
create view hq.meeting_overview with (security_invoker = true) as
select
  m.id,
  m.ref_number,
  'MTG-' || lpad(m.ref_number::text, greatest(4, length(m.ref_number::text)), '0') as ref,
  m.title,
  m.meeting_type,
  m.held_at,
  m.duration_minutes,
  m.location,
  m.summary,
  m.minutes,
  m.decisions_text,
  m.confidential,
  m.version,
  m.staff_attendee_ids,
  coalesce(att.names, '') as attendee_names,
  coalesce(att.n, 0) as attendee_count,
  coalesce(lk.names, '') as linked_names,
  coalesce(ac.open, 0) as open_action_count,
  coalesce(ac.done, 0) as done_action_count,
  coalesce(ac.total, 0) as action_count,
  m.created_by,
  cb.full_name as created_by_name,
  m.created_via,
  m.created_at,
  m.updated_at,
  m.deleted_at
from hq.meetings m
left join hq.staff_profiles cb on cb.id = m.created_by
left join lateral (
  select string_agg(coalesce(sp.full_name, c.full_name, a.external_name), ', ' order by a.id) as names, count(*) as n
  from hq.meeting_attendees a
  left join hq.staff_profiles sp on sp.id = a.staff_id
  left join hq.contacts c on c.id = a.contact_id
  where a.meeting_id = m.id
) att on true
left join lateral (
  select string_agg(coalesce(c.full_name, o.name, opp.prospect_name, ctr.business_name,
                             'DEC-' || lpad(d.ref_number::text, greatest(4, length(d.ref_number::text)), '0') || ' ' || d.title,
                             mp.property_address), ', ' order by l.id) as names
  from hq.meeting_links l
  left join hq.contacts c on c.id = l.contact_id
  left join hq.organisations o on o.id = l.organisation_id
  left join hq.opportunities opp on opp.id = l.opportunity_id
  left join hq.contractors ctr on ctr.id = l.contractor_id
  left join hq.decisions d on d.id = l.decision_id
  left join hq.managed_properties mp on mp.id = l.managed_property_id
  where l.meeting_id = m.id
) lk on true
left join lateral (
  select count(*) as total,
         count(*) filter (where t.status not in ('completed', 'cancelled')) as open,
         count(*) filter (where t.status = 'completed') as done
  from hq.meeting_actions ma
  join hq.tasks t on t.id = ma.task_id and t.deleted_at is null
  where ma.meeting_id = m.id
) ac on true;
comment on view hq.meeting_overview is 'One row per meeting the reader can see (confidential ones only for their staff attendees, recorder and audit.read): MTG-0001 ref, type, when, summary, minutes, decisions, attendee and linked names (from records the reader may read), and counts of action tasks the reader can see (open, done, total). Filter deleted_at is null for the live list.';
revoke all on hq.meeting_overview from public, anon, authenticated, service_role;
grant select on hq.meeting_overview to authenticated;

create view hq.open_meeting_actions with (security_invoker = true) as
select
  t.id as task_id,
  t.title,
  t.status,
  t.priority,
  t.due_date,
  t.assigned_to,
  sp.full_name as assignee_name,
  m.id as meeting_id,
  'MTG-' || lpad(m.ref_number::text, greatest(4, length(m.ref_number::text)), '0') as meeting_ref,
  m.title as meeting_title,
  m.held_at as meeting_held_at,
  m.confidential as meeting_confidential,
  ma.created_at
from hq.meeting_actions ma
join hq.tasks t on t.id = ma.task_id and t.deleted_at is null and t.status not in ('completed', 'cancelled')
join hq.meetings m on m.id = ma.meeting_id and m.deleted_at is null
left join hq.staff_profiles sp on sp.id = t.assigned_to;
comment on view hq.open_meeting_actions is 'Open action items (tasks not completed or cancelled) from live meetings, with the meeting ref and title. Rows only where the reader can see BOTH the task (tasks RLS) and the meeting (meetings RLS).';
revoke all on hq.open_meeting_actions from public, anon, authenticated, service_role;
grant select on hq.open_meeting_actions to authenticated;

-- ------------------------------------------------------------------ RPC helpers (not granted to any API role: 0141)
create function hq_private.meeting_ref(p_n bigint) returns text
language sql immutable parallel safe set search_path = pg_catalog as $$
  select 'MTG-' || lpad(p_n::text, greatest(4, length(p_n::text)), '0')
$$;

create function hq_private.meeting_json(p_m hq.meetings) returns jsonb
language sql stable set search_path = pg_catalog, public, extensions as $$
  select jsonb_build_object(
    'meeting_id', p_m.id, 'ref', hq_private.meeting_ref(p_m.ref_number), 'ref_number', p_m.ref_number,
    'title', p_m.title, 'meeting_type', p_m.meeting_type, 'held_at', p_m.held_at, 'duration_minutes', p_m.duration_minutes,
    'location', p_m.location, 'confidential', p_m.confidential, 'version', p_m.version, 'updated_at', p_m.updated_at)
$$;

-- Several lines a person typed (summary, decisions, an action's description): CR LF -> LF, control
-- characters other than tab and line feed out, trimmed, blank = null, bounded (22023 with a plain message).
create function hq_private.meeting_text(p_value text, p_max integer, p_what text) returns text
language plpgsql immutable set search_path = pg_catalog as $$
declare
  v text := nullif(btrim(regexp_replace(regexp_replace(coalesce(p_value, ''), E'\r\n?', E'\n', 'g'), E'[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]', '', 'g'), E' \t\n'), '');
begin
  if v is not null and char_length(v) > p_max then
    raise exception '% is at most % characters', p_what, p_max using errcode = 'invalid_parameter_value';
  end if;
  return v;
end $$;

-- A uuid from a JSON field: absent or blank = null; anything else that is not a uuid is refused (22023).
create function hq_private.meeting_uuid(p_value text, p_what text) returns uuid
language plpgsql immutable set search_path = pg_catalog as $$
declare
  v text := nullif(btrim(coalesce(p_value, '')), '');
begin
  if v is null then return null; end if;
  if v !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception '% is not a valid id', p_what using errcode = 'invalid_parameter_value';
  end if;
  return v::uuid;
end $$;

-- The confidential rule (meetings_select, restated for the security definer RPCs).
create function hq_private.meeting_visible(p_m hq.meetings) returns boolean
language sql stable security definer set search_path = pg_catalog, public, extensions as $$
  select hq_private.has_capability('meetings.read')
     and (not p_m.confidential or p_m.created_by = auth.uid() or auth.uid() = any (p_m.staff_attendee_ids) or hq_private.has_capability('audit.read'))
$$;

-- The meeting locked for a change, if live and visible to the caller; anything else is "not found".
create function hq_private.meeting_lock(p_id uuid) returns hq.meetings
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_m hq.meetings;
begin
  select * into v_m from hq.meetings m where m.id = p_id and m.deleted_at is null for update;
  if not found or not hq_private.meeting_visible(v_m) then
    raise exception 'meeting not found' using errcode = 'no_data_found';
  end if;
  return v_m;
end $$;

create function hq_private.meeting_history_write(p_m hq.meetings, p_action text, p_summary text, p_note text default null, p_changes jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_actor uuid := auth.uid();
  v_client text := hq_private.email_app_client();
begin
  insert into hq.meeting_history (meeting_id, version, action, change_summary, edited_by, edited_by_name, via, mcp_client_id, change_note,
                                  title, summary, minutes, decisions_text, changes)
  values (p_m.id, p_m.version, p_action, left(p_summary, 500), v_actor,
          coalesce((select sp.full_name from hq.staff_profiles sp where sp.id = v_actor), case when v_actor is null then 'System' end),
          case when v_client is null then 'hq' else 'mcp' end, v_client, left(p_note, 300),
          p_m.title, p_m.summary, p_m.minutes, p_m.decisions_text, coalesce(p_changes, '{}'::jsonb));
end $$;

-- The next version of a meeting after a change to its attendees, links or actions (the staff attendee
-- copy refreshed with it). Audited with the given action and note.
create function hq_private.meeting_bump(p_id uuid, p_action text, p_note text default null) returns hq.meetings
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_m hq.meetings;
begin
  perform hq_private.audit_context(p_action, left(p_note, 200));
  update hq.meetings m set
    version = m.version + 1,
    staff_attendee_ids = coalesce((select array_agg(a.staff_id order by a.staff_id) from hq.meeting_attendees a where a.meeting_id = m.id and a.staff_id is not null), '{}')
  where m.id = p_id
  returning * into v_m;
  perform hq_private.audit_context();
  return v_m;
end $$;

-- Refresh the staff attendee copy without a new version (inside create_meeting).
create function hq_private.meeting_sync_staff(p_id uuid) returns hq.meetings
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_m hq.meetings;
begin
  perform hq_private.audit_context('skip');
  update hq.meetings m set
    staff_attendee_ids = coalesce((select array_agg(a.staff_id order by a.staff_id) from hq.meeting_attendees a where a.meeting_id = m.id and a.staff_id is not null), '{}')
  where m.id = p_id
  returning * into v_m;
  perform hq_private.audit_context();
  return v_m;
end $$;

-- Adds one attendee (exactly one of staff, contact, name). Returns {attendee_id, added, kind, label}.
create function hq_private.meeting_add_attendee(p_meeting uuid, p_staff uuid, p_contact uuid, p_name text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_name text := hq_private.knowledge_line(p_name, 120, 'an attendee''s name');
  v_label text;
  v_kind text;
  v_id bigint;
begin
  if num_nonnulls(p_staff, p_contact, v_name) <> 1 then
    raise exception 'an attendee is one person: a member of staff, a contact, or a name' using errcode = 'invalid_parameter_value', hint = 'meeting_attendee_one';
  end if;
  if p_staff is not null then
    perform hq_private.require_active_staff(p_staff, 'an attendee from the team');
    select sp.full_name into v_label from hq.staff_profiles sp where sp.id = p_staff;
    v_kind := 'staff';
  elsif p_contact is not null then
    if not hq_private.has_capability('growth.read') then
      raise exception 'contact not found' using errcode = 'no_data_found';
    end if;
    select c.full_name into v_label from hq.contacts c where c.id = p_contact and c.deleted_at is null;
    if not found then
      raise exception 'contact not found' using errcode = 'no_data_found';
    end if;
    v_kind := 'contact';
  else
    v_label := v_name;
    v_kind := 'name';
  end if;
  insert into hq.meeting_attendees (meeting_id, staff_id, contact_id, external_name)
  values (p_meeting, p_staff, p_contact, v_name)
  on conflict do nothing
  returning id into v_id;
  return jsonb_build_object('attendee_id', v_id, 'added', v_id is not null, 'kind', v_kind, 'label', v_label);
end $$;

-- Which column a link kind is, or null.
create function hq_private.meeting_link_column(p_kind text) returns text
language sql immutable parallel safe set search_path = pg_catalog as $$
  select case p_kind when 'contact' then 'contact_id' when 'organisation' then 'organisation_id' when 'opportunity' then 'opportunity_id'
    when 'contractor' then 'contractor_id' when 'decision' then 'decision_id' when 'managed_property' then 'managed_property_id' end
$$;

-- Adds one link to a record the caller may read (anything else is "not found"). Returns {link_id, added, kind, record_id, label}.
create function hq_private.meeting_add_link(p_meeting uuid, p_kind text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_label text;
  v_id bigint;
  v_noun text := replace(coalesce(p_kind, ''), '_', ' ');
begin
  if hq_private.meeting_link_column(p_kind) is null then
    raise exception 'a link is to a contact, organisation, opportunity, contractor, decision or managed_property' using errcode = 'invalid_parameter_value';
  end if;
  if p_id is null then
    raise exception 'say which % the meeting was about', v_noun using errcode = 'invalid_parameter_value';
  end if;
  if p_kind = 'contact' and hq_private.has_capability('growth.read') then
    select c.full_name into v_label from hq.contacts c where c.id = p_id and c.deleted_at is null;
  elsif p_kind = 'organisation' and hq_private.has_capability('growth.read') then
    select o.name into v_label from hq.organisations o where o.id = p_id and o.deleted_at is null;
  elsif p_kind = 'opportunity' and hq_private.has_capability('growth.read') then
    select coalesce(o.prospect_name, 'Lead') into v_label from hq.opportunities o where o.id = p_id and o.deleted_at is null;
  elsif p_kind = 'contractor' and hq_private.has_capability('contractors.read') then
    select c.business_name into v_label from hq.contractors c where c.id = p_id and c.deleted_at is null;
  elsif p_kind = 'decision' and hq_private.has_capability('decisions.read') then
    select hq_private.decision_ref(d.ref_number) || ' ' || d.title into v_label from hq.decisions d where d.id = p_id and d.deleted_at is null;
  elsif p_kind = 'managed_property' and hq_private.has_capability('portfolio.read') then
    select p.property_address into v_label from hq.managed_properties p where p.id = p_id and p.deleted_at is null;
  end if;
  if v_label is null then
    raise exception '% not found', v_noun using errcode = 'no_data_found';
  end if;
  insert into hq.meeting_links (meeting_id, contact_id, organisation_id, opportunity_id, contractor_id, decision_id, managed_property_id)
  values (p_meeting,
          case when p_kind = 'contact' then p_id end, case when p_kind = 'organisation' then p_id end,
          case when p_kind = 'opportunity' then p_id end, case when p_kind = 'contractor' then p_id end,
          case when p_kind = 'decision' then p_id end, case when p_kind = 'managed_property' then p_id end)
  on conflict do nothing
  returning id into v_id;
  return jsonb_build_object('link_id', v_id, 'added', v_id is not null, 'kind', p_kind, 'record_id', p_id, 'label', v_label);
end $$;

-- Creates one action item: a task (source meeting) through the normal tasks table, so its triggers,
-- RLS visibility and audit apply, linked to the meeting. Needs tasks.write; the assignee (default the
-- caller) must be active staff; a due date from 2000 to two years ahead. Returns {task_id, title, assigned_to, due_date, priority}.
create function hq_private.meeting_add_task(p_m hq.meetings, p_title text, p_assignee uuid, p_due date, p_priority hq.task_priority, p_description text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_caller uuid := auth.uid();
  v_title text := hq_private.knowledge_line(p_title, 200, 'an action');
  v_desc text := hq_private.meeting_text(p_description, 2000, 'an action''s description');
  v_assignee uuid := coalesce(p_assignee, v_caller);
  v_from text;
  v_task uuid;
begin
  perform hq_private.require_capability('tasks.write');
  if v_title is null then
    raise exception 'an action needs a title' using errcode = 'invalid_parameter_value';
  end if;
  perform hq_private.require_active_staff(v_assignee, 'the person an action is assigned to');
  if p_due is not null and (p_due < date '2000-01-01' or p_due > hq.today() + 730) then
    raise exception 'an action''s due date must be within the next two years' using errcode = 'invalid_parameter_value';
  end if;
  if (select count(*) from hq.meeting_actions a where a.meeting_id = p_m.id) >= 50 then
    raise exception 'a meeting can have at most 50 actions' using errcode = 'check_violation', hint = 'meeting_action_limit';
  end if;
  v_from := 'From meeting ' || hq_private.meeting_ref(p_m.ref_number) || case when p_m.confidential then ' (confidential)' else ': ' || p_m.title end || '.';
  insert into hq.tasks (title, description, assigned_to, due_date, priority, source)
  values (v_title, left(concat_ws(E'\n\n', v_desc, v_from), 4000), v_assignee, p_due, coalesce(p_priority, 'normal'), 'meeting')
  returning id into v_task;
  insert into hq.meeting_actions (task_id, meeting_id) values (v_task, p_m.id);
  return jsonb_build_object('task_id', v_task, 'title', v_title, 'assigned_to', v_assignee, 'due_date', p_due, 'priority', coalesce(p_priority, 'normal'));
end $$;

-- Keeps one touch-point interaction per linked contact, organisation, lead and contractor in step with
-- the meeting (see the header). Returns [{kind, record_id, interaction_id, change}] where change is
-- created | updated | unchanged | archived | covered (an organisation covered by a linked contact).
create function hq_private.meeting_sync_touchpoints(p_meeting uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_m hq.meetings;
  v_type hq.interaction_type;
  v_text text;
  v_when timestamptz;
  v_out jsonb := '[]'::jsonb;
  v_live boolean;
  v_need boolean;
  v_kind text;
  v_rec uuid;
  v_org uuid;
  v_i hq.interactions;
  v_new uuid;
  v_change text;
  l record;
begin
  select * into v_m from hq.meetings m where m.id = p_meeting;
  if not found then return v_out; end if;
  v_live := v_m.deleted_at is null;
  v_type := case when coalesce(v_m.location, '') ~* '(coffee|caf[eé])' then 'coffee_meeting'
                 when coalesce(v_m.location, '') ~* '\m(phone|call)\M' then 'phone_call'
                 else 'office_meeting' end;
  v_text := case when v_m.confidential
                 then hq_private.meeting_ref(v_m.ref_number) || ' (confidential meeting: details are in Meetings)'
                 else left('Meeting ' || hq_private.meeting_ref(v_m.ref_number) || ': ' || v_m.title || coalesce(E'. ' || v_m.summary, ''), 4000) end;
  v_when := least(v_m.held_at, now());

  for l in select * from hq.meeting_links x where x.meeting_id = v_m.id and x.decision_id is null and x.managed_property_id is null order by x.id loop
    v_kind := case when l.contact_id is not null then 'contact' when l.organisation_id is not null then 'organisation'
                   when l.opportunity_id is not null then 'opportunity' else 'contractor' end;
    v_rec := coalesce(l.contact_id, l.organisation_id, l.opportunity_id, l.contractor_id);
    v_need := v_live;
    v_change := 'unchanged';
    -- an organisation is covered when a linked (live) contact belongs to it: that contact's interaction carries it
    if v_need and l.organisation_id is not null and exists (
         select 1 from hq.meeting_links y join hq.contacts c on c.id = y.contact_id and c.deleted_at is null
         where y.meeting_id = v_m.id and c.organisation_id = l.organisation_id) then
      v_need := false;
      v_change := 'covered';
    end if;

    if v_need then
      v_i := null;
      if l.interaction_id is not null then
        select * into v_i from hq.interactions i where i.id = l.interaction_id;
      end if;
      if l.interaction_id is null then
        v_org := null;
        if l.contact_id is not null then
          select c.organisation_id into v_org from hq.contacts c where c.id = l.contact_id and c.deleted_at is null;
          if not found then continue; end if;
        elsif l.organisation_id is not null then
          if not exists (select 1 from hq.organisations o where o.id = l.organisation_id and o.deleted_at is null) then continue; end if;
          v_org := l.organisation_id;
        elsif l.opportunity_id is not null then
          if not exists (select 1 from hq.opportunities o where o.id = l.opportunity_id and o.deleted_at is null) then continue; end if;
        else
          if not exists (select 1 from hq.contractors c where c.id = l.contractor_id and c.deleted_at is null) then continue; end if;
        end if;
        insert into hq.interactions (contact_id, organisation_id, opportunity_id, contractor_id, interaction_type, occurred_at, summary, staff_id)
        values (l.contact_id, v_org, l.opportunity_id, l.contractor_id, v_type, v_when, v_text, auth.uid())
        returning id into v_new;
        update hq.meeting_links set interaction_id = v_new where id = l.id;
        v_change := 'created';
        l.interaction_id := v_new;
      elsif v_i.deleted_at is null and (v_i.interaction_type, v_i.occurred_at, v_i.summary) is distinct from (v_type, v_when, v_text) then
        perform hq_private.audit_context(null, 'From meeting ' || hq_private.meeting_ref(v_m.ref_number));
        update hq.interactions set interaction_type = v_type, occurred_at = v_when, summary = v_text where id = v_i.id;
        perform hq_private.audit_context();
        v_change := 'updated';
      end if;
      -- "last contacted" / "last activity" move forward, never back
      if v_change in ('created', 'updated') then
        if l.contact_id is not null then
          update hq.contacts set last_contact_at = greatest(coalesce(last_contact_at, v_when), v_when)
          where id = l.contact_id and (last_contact_at is null or last_contact_at < v_when);
        elsif l.opportunity_id is not null then
          update hq.opportunities set last_activity_at = greatest(coalesce(last_activity_at, v_when), v_when)
          where id = l.opportunity_id and (last_activity_at is null or last_activity_at < v_when);
        end if;
      end if;
    elsif l.interaction_id is not null then
      perform hq_private.audit_context(null, 'From meeting ' || hq_private.meeting_ref(v_m.ref_number));
      update hq.interactions set deleted_at = now() where id = l.interaction_id and deleted_at is null;
      perform hq_private.audit_context();
      update hq.meeting_links set interaction_id = null where id = l.id;
      v_change := 'archived';
      l.interaction_id := null;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('kind', v_kind, 'record_id', v_rec, 'interaction_id', l.interaction_id, 'change', v_change));
  end loop;
  return v_out;
end $$;

-- A date and time that can be a meeting's: from 2000, at most a day ahead.
create function hq_private.meeting_when_check(p_when timestamptz) returns void
language plpgsql stable set search_path = pg_catalog as $$
begin
  if p_when < timestamptz '2000-01-01 00:00:00+00' then
    raise exception 'that meeting date is too far in the past' using errcode = 'invalid_parameter_value';
  end if;
  if p_when > now() + interval '1 day' then
    raise exception 'a meeting is recorded after it is held: the date cannot be more than a day ahead' using errcode = 'invalid_parameter_value';
  end if;
end $$;

create function hq_private.meeting_duration_check(p_minutes integer) returns void
language plpgsql immutable set search_path = pg_catalog as $$
begin
  if p_minutes is not null and (p_minutes < 1 or p_minutes > 1440) then
    raise exception 'a duration is from 1 to 1440 minutes' using errcode = 'invalid_parameter_value';
  end if;
end $$;

-- A JSON list argument: null or an array of at most p_max objects.
create function hq_private.meeting_list(p_value jsonb, p_max integer, p_what text) returns jsonb
language plpgsql immutable set search_path = pg_catalog as $$
declare
  v jsonb := coalesce(p_value, '[]'::jsonb);
begin
  if jsonb_typeof(v) <> 'array' then
    raise exception '% must be a list', p_what using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_array_length(v) > p_max then
    raise exception 'at most % % at a time', p_max, p_what using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from jsonb_array_elements(v) e where jsonb_typeof(e) <> 'object') then
    raise exception 'each of the % must be an object', p_what using errcode = 'invalid_parameter_value';
  end if;
  return v;
end $$;

-- A date from a JSON field ("YYYY-MM-DD"); blank = null; anything else refused (22023).
create function hq_private.meeting_date(p_value text, p_what text) returns date
language plpgsql immutable set search_path = pg_catalog as $$
declare
  v text := nullif(btrim(coalesce(p_value, '')), '');
begin
  if v is null then return null; end if;
  if v !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception '% must be a date (YYYY-MM-DD)', p_what using errcode = 'invalid_parameter_value';
  end if;
  begin
    return v::date;
  exception when others then
    raise exception '% must be a real date', p_what using errcode = 'invalid_parameter_value';
  end;
end $$;

-- A task priority from a JSON field; blank = normal.
create function hq_private.meeting_priority(p_value text) returns hq.task_priority
language plpgsql immutable set search_path = pg_catalog, public, extensions as $$
declare
  v text := lower(nullif(btrim(coalesce(p_value, '')), ''));
begin
  if v is null then return 'normal'; end if;
  if v not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'an action''s priority is low, normal, high or urgent' using errcode = 'invalid_parameter_value';
  end if;
  return v::hq.task_priority;
end $$;

-- ------------------------------------------------------------------ create_meeting
-- One transaction: the meeting, its attendees, links, action tasks, touch points and the first history
-- row. Any refusal keeps nothing.
--   p_attendees  [{"staff_id": uuid} | {"contact_id": uuid} | {"name": "Tim from the bank"}]   (at most 40)
--   p_links      [{"kind": "contact|organisation|opportunity|contractor|decision|managed_property", "id": uuid}]   (at most 20)
--   p_actions    [{"title": text, "assignee_id": uuid (default the caller), "due_date": "YYYY-MM-DD",
--                  "priority": "low|normal|high|urgent", "description": text}]   (at most 20; needs tasks.write)
create function hq.create_meeting(
  p_title text,
  p_type hq.meeting_type,
  p_held_at timestamptz,
  p_duration_minutes integer default null,
  p_location text default null,
  p_summary text default null,
  p_minutes text default null,
  p_decisions_text text default null,
  p_confidential boolean default false,
  p_attendees jsonb default '[]'::jsonb,
  p_links jsonb default '[]'::jsonb,
  p_actions jsonb default '[]'::jsonb,
  p_change_note text default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_caller uuid := hq_private.require_staff();
  v_client text := hq_private.email_app_client();
  v_title text;
  v_location text;
  v_summary text;
  v_minutes text;
  v_decisions text;
  v_note text;
  v_att jsonb;
  v_links jsonb;
  v_actions jsonb;
  v_m hq.meetings;
  e jsonb;
  v_att_out jsonb := '[]'::jsonb;
  v_link_out jsonb := '[]'::jsonb;
  v_task_out jsonb := '[]'::jsonb;
  v_tp jsonb;
begin
  perform hq_private.require_capability('meetings.write');
  v_title := hq_private.knowledge_line(p_title, 200, 'a title');
  if v_title is null then
    raise exception 'a meeting needs a title' using errcode = 'invalid_parameter_value';
  end if;
  if p_type is null then
    raise exception 'choose the kind of meeting' using errcode = 'invalid_parameter_value';
  end if;
  if p_held_at is null then
    raise exception 'say when the meeting was held' using errcode = 'invalid_parameter_value';
  end if;
  perform hq_private.meeting_when_check(p_held_at);
  perform hq_private.meeting_duration_check(p_duration_minutes);
  v_location := hq_private.knowledge_line(p_location, 200, 'the location');
  v_summary := hq_private.meeting_text(p_summary, 2000, 'the summary');
  v_minutes := hq_private.knowledge_body(p_minutes);
  v_decisions := hq_private.meeting_text(p_decisions_text, 5000, 'the decisions');
  v_note := hq_private.knowledge_line(p_change_note, 300, 'a change note');
  v_att := hq_private.meeting_list(p_attendees, 40, 'attendees');
  v_links := hq_private.meeting_list(p_links, 20, 'links');
  v_actions := hq_private.meeting_list(p_actions, 20, 'actions');
  if jsonb_array_length(v_actions) > 0 then
    perform hq_private.require_capability('tasks.write');
  end if;

  perform hq_private.audit_context(null, left(v_note, 200));
  insert into hq.meetings (title, meeting_type, held_at, duration_minutes, location, summary, minutes, decisions_text, confidential, created_via, mcp_client_id)
  values (v_title, p_type, p_held_at, p_duration_minutes, v_location, v_summary, v_minutes, v_decisions, coalesce(p_confidential, false),
          case when v_client is null then 'hq' else 'mcp' end, v_client)
  returning * into v_m;
  perform hq_private.audit_context();

  for e in select x from jsonb_array_elements(v_att) x loop
    v_att_out := v_att_out || jsonb_build_array(hq_private.meeting_add_attendee(v_m.id,
      hq_private.meeting_uuid(e ->> 'staff_id', 'an attendee''s staff id'), hq_private.meeting_uuid(e ->> 'contact_id', 'an attendee''s contact id'), e ->> 'name'));
  end loop;
  v_m := hq_private.meeting_sync_staff(v_m.id);

  for e in select x from jsonb_array_elements(v_links) x loop
    v_link_out := v_link_out || jsonb_build_array(hq_private.meeting_add_link(v_m.id, e ->> 'kind', hq_private.meeting_uuid(e ->> 'id', 'a linked record''s id')));
  end loop;

  for e in select x from jsonb_array_elements(v_actions) x loop
    v_task_out := v_task_out || jsonb_build_array(hq_private.meeting_add_task(v_m, e ->> 'title',
      hq_private.meeting_uuid(e ->> 'assignee_id', 'an action''s assignee'), hq_private.meeting_date(e ->> 'due_date', 'an action''s due date'),
      hq_private.meeting_priority(e ->> 'priority'), e ->> 'description'));
  end loop;

  v_tp := hq_private.meeting_sync_touchpoints(v_m.id);
  perform hq_private.meeting_history_write(v_m, 'create', 'Recorded ' || hq_private.meeting_ref(v_m.ref_number), coalesce(v_note, case when v_client is null then null else 'Saved from a chat app' end),
    jsonb_build_object('attendees', jsonb_array_length(v_att_out), 'links', jsonb_array_length(v_link_out), 'actions', jsonb_array_length(v_task_out)));
  return hq_private.meeting_json(v_m) || jsonb_build_object('changed', true, 'attendees', v_att_out, 'links', v_link_out, 'tasks', v_task_out, 'touch_points', v_tp);
end $$;
comment on function hq.create_meeting(text, hq.meeting_type, timestamptz, integer, text, text, text, text, boolean, jsonb, jsonb, jsonb, text) is 'meetings.write (+ tasks.write for actions). One transaction: the meeting (title 1-200, type, held_at from 2000 to a day ahead, duration 1-1440, location up to 200, summary up to 2000, minutes up to 50000, decisions up to 5000, confidential), attendees [{staff_id|contact_id|name}] (max 40), links [{kind, id}] to records the caller can read (max 20), actions [{title, assignee_id, due_date, priority, description}] as tasks (max 20), one touch-point interaction per linked contact / organisation / lead / contractor, and history version 1. Returns the meeting json plus {attendees, links, tasks, touch_points, changed}.';

-- ------------------------------------------------------------------ update_meeting
-- Patch semantics: null leaves a field; p_clear empties optional fields (duration_minutes, location,
-- summary, minutes, decisions_text). p_expected_version must be the meeting's current version (else
-- 23514 meeting_stale). Changing confidential: only the recorder or an audit.read holder. Nothing to
-- change: {changed: false}, nothing written.
create function hq.update_meeting(
  p_meeting uuid,
  p_expected_version integer,
  p_title text default null,
  p_type hq.meeting_type default null,
  p_held_at timestamptz default null,
  p_duration_minutes integer default null,
  p_location text default null,
  p_summary text default null,
  p_minutes text default null,
  p_decisions_text text default null,
  p_confidential boolean default null,
  p_clear text[] default null,
  p_change_note text default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_caller uuid := hq_private.require_staff();
  v_cur hq.meetings;
  v_new hq.meetings;
  v_note text;
  v_clear text[] := coalesce(p_clear, '{}');
  v_bad text;
  v_changes jsonb := '{}'::jsonb;
  v_parts text[] := '{}';
  v_tp jsonb := '[]'::jsonb;
begin
  perform hq_private.require_capability('meetings.write');
  v_note := hq_private.knowledge_line(p_change_note, 300, 'a change note');
  select c into v_bad from unnest(v_clear) c where c not in ('duration_minutes', 'location', 'summary', 'minutes', 'decisions_text') limit 1;
  if v_bad is not null then
    raise exception 'only duration_minutes, location, summary, minutes and decisions_text can be cleared' using errcode = 'invalid_parameter_value';
  end if;
  v_cur := hq_private.meeting_lock(p_meeting);
  if p_expected_version is null then
    raise exception 'say which version of the meeting you are changing' using errcode = 'invalid_parameter_value';
  end if;
  if v_cur.version <> p_expected_version then
    raise exception 'this meeting was changed by someone else (it is at version %, not version %); reload it and try again', v_cur.version, p_expected_version
      using errcode = 'check_violation', hint = 'meeting_stale';
  end if;

  v_new := v_cur;
  if p_title is not null then
    v_new.title := hq_private.knowledge_line(p_title, 200, 'a title');
    if v_new.title is null then
      raise exception 'a meeting needs a title' using errcode = 'invalid_parameter_value';
    end if;
  end if;
  if p_type is not null then v_new.meeting_type := p_type; end if;
  if p_held_at is not null then
    perform hq_private.meeting_when_check(p_held_at);
    v_new.held_at := p_held_at;
  end if;
  if p_duration_minutes is not null then
    perform hq_private.meeting_duration_check(p_duration_minutes);
    v_new.duration_minutes := p_duration_minutes;
  end if;
  if p_location is not null then v_new.location := hq_private.knowledge_line(p_location, 200, 'the location'); end if;
  if p_summary is not null then v_new.summary := hq_private.meeting_text(p_summary, 2000, 'the summary'); end if;
  if p_minutes is not null then v_new.minutes := hq_private.knowledge_body(p_minutes); end if;
  if p_decisions_text is not null then v_new.decisions_text := hq_private.meeting_text(p_decisions_text, 5000, 'the decisions'); end if;
  if 'duration_minutes' = any (v_clear) then v_new.duration_minutes := null; end if;
  if 'location' = any (v_clear) then v_new.location := null; end if;
  if 'summary' = any (v_clear) then v_new.summary := null; end if;
  if 'minutes' = any (v_clear) then v_new.minutes := null; end if;
  if 'decisions_text' = any (v_clear) then v_new.decisions_text := null; end if;
  if p_confidential is not null and p_confidential is distinct from v_cur.confidential then
    if not (v_cur.created_by = v_caller or hq_private.has_capability('audit.read')) then
      raise exception 'only the person who recorded this meeting, or a director or administrator, can change whether it is confidential'
        using errcode = 'insufficient_privilege', hint = 'meeting_confidential_owner';
    end if;
    v_new.confidential := p_confidential;
  end if;

  if v_new.title is distinct from v_cur.title then
    v_changes := v_changes || jsonb_build_object('title', jsonb_build_object('from', v_cur.title, 'to', v_new.title));
    v_parts := v_parts || 'the title'::text;
  end if;
  if v_new.meeting_type is distinct from v_cur.meeting_type then
    v_changes := v_changes || jsonb_build_object('meeting_type', jsonb_build_object('from', v_cur.meeting_type, 'to', v_new.meeting_type));
    v_parts := v_parts || 'the kind of meeting'::text;
  end if;
  if v_new.held_at is distinct from v_cur.held_at then
    v_changes := v_changes || jsonb_build_object('held_at', jsonb_build_object('from', v_cur.held_at, 'to', v_new.held_at));
    v_parts := v_parts || 'when it was held'::text;
  end if;
  if v_new.duration_minutes is distinct from v_cur.duration_minutes then
    v_changes := v_changes || jsonb_build_object('duration_minutes', jsonb_build_object('from', v_cur.duration_minutes, 'to', v_new.duration_minutes));
    v_parts := v_parts || 'the duration'::text;
  end if;
  if v_new.location is distinct from v_cur.location then
    v_changes := v_changes || jsonb_build_object('location', jsonb_build_object('from', v_cur.location, 'to', v_new.location));
    v_parts := v_parts || 'the location'::text;
  end if;
  if v_new.summary is distinct from v_cur.summary then
    v_changes := v_changes || jsonb_build_object('summary', jsonb_build_object('from', left(v_cur.summary, 300), 'to', left(v_new.summary, 300)));
    v_parts := v_parts || 'the summary'::text;
  end if;
  if v_new.minutes is distinct from v_cur.minutes then
    v_changes := v_changes || jsonb_build_object('minutes', jsonb_build_object('from_length', coalesce(char_length(v_cur.minutes), 0), 'to_length', coalesce(char_length(v_new.minutes), 0)));
    v_parts := v_parts || 'the minutes'::text;
  end if;
  if v_new.decisions_text is distinct from v_cur.decisions_text then
    v_changes := v_changes || jsonb_build_object('decisions_text', jsonb_build_object('from', left(v_cur.decisions_text, 300), 'to', left(v_new.decisions_text, 300)));
    v_parts := v_parts || 'the decisions'::text;
  end if;
  if v_new.confidential is distinct from v_cur.confidential then
    v_changes := v_changes || jsonb_build_object('confidential', jsonb_build_object('from', v_cur.confidential, 'to', v_new.confidential));
    v_parts := v_parts || case when v_new.confidential then 'made it confidential' else 'made it visible to the team' end;
  end if;

  if v_changes = '{}'::jsonb then
    return hq_private.meeting_json(v_cur) || jsonb_build_object('changed', false, 'changed_fields', '[]'::jsonb, 'touch_points', '[]'::jsonb);
  end if;

  perform hq_private.audit_context(null, left(v_note, 200));
  update hq.meetings set
    title = v_new.title, meeting_type = v_new.meeting_type, held_at = v_new.held_at, duration_minutes = v_new.duration_minutes,
    location = v_new.location, summary = v_new.summary, minutes = v_new.minutes, decisions_text = v_new.decisions_text,
    confidential = v_new.confidential, version = v_cur.version + 1
  where id = v_cur.id
  returning * into v_new;
  perform hq_private.audit_context();

  perform hq_private.meeting_history_write(v_new, 'update', 'Changed ' || array_to_string(v_parts, ', '), v_note, v_changes);
  if v_changes ?| array['title', 'held_at', 'location', 'summary', 'confidential'] then
    v_tp := hq_private.meeting_sync_touchpoints(v_new.id);
  end if;
  return hq_private.meeting_json(v_new) || jsonb_build_object('changed', true, 'changed_fields', to_jsonb(array(select jsonb_object_keys(v_changes))), 'touch_points', v_tp);
end $$;
comment on function hq.update_meeting(uuid, integer, text, hq.meeting_type, timestamptz, integer, text, text, text, text, boolean, text[], text) is 'meetings.write. Changes one live meeting the caller can see (null leaves a field; p_clear empties duration_minutes, location, summary, minutes or decisions_text). p_expected_version must be the current version (else 23514 meeting_stale). Confidential changes only by the recorder or audit.read (42501 meeting_confidential_owner). Writes the next version''s history row (with a snapshot), an audit event, and updates the touch points when the title, date, location, summary or confidentiality changed. Nothing to change: {changed: false}. Returns the meeting json plus {changed, changed_fields, touch_points}.';

-- ------------------------------------------------------------------ attendees
create function hq.add_meeting_attendee(p_meeting uuid, p_staff uuid default null, p_contact uuid default null, p_name text default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_m hq.meetings;
  v_out jsonb;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('meetings.write');
  v_m := hq_private.meeting_lock(p_meeting);
  v_out := hq_private.meeting_add_attendee(v_m.id, p_staff, p_contact, p_name);
  if not (v_out ->> 'added')::boolean then
    return hq_private.meeting_json(v_m) || v_out || jsonb_build_object('changed', false);
  end if;
  v_m := hq_private.meeting_bump(v_m.id, 'add_attendee', v_out ->> 'label');
  perform hq_private.meeting_history_write(v_m, 'add_attendee', 'Added ' || (v_out ->> 'label') || ' as an attendee', null,
    jsonb_build_object('attendee', jsonb_build_object('to', v_out ->> 'label')));
  return hq_private.meeting_json(v_m) || v_out || jsonb_build_object('changed', true);
end $$;
comment on function hq.add_meeting_attendee(uuid, uuid, uuid, text) is 'meetings.write. Adds one attendee to a live meeting the caller can see: exactly one of an active member of staff, a contact (growth.read) or a typed name (1-120). At most 40. Already there: {changed: false}. History, audit. Returns the meeting json plus {attendee_id, added, kind, label, changed}.';

create function hq.remove_meeting_attendee(p_meeting uuid, p_attendee bigint) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_m hq.meetings;
  v_label text;
  v_n integer;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('meetings.write');
  v_m := hq_private.meeting_lock(p_meeting);
  select coalesce(sp.full_name, c.full_name, a.external_name) into v_label
  from hq.meeting_attendees a
  left join hq.staff_profiles sp on sp.id = a.staff_id
  left join hq.contacts c on c.id = a.contact_id
  where a.id = p_attendee and a.meeting_id = v_m.id;
  delete from hq.meeting_attendees a where a.id = p_attendee and a.meeting_id = v_m.id;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return hq_private.meeting_json(v_m) || jsonb_build_object('changed', false);
  end if;
  v_m := hq_private.meeting_bump(v_m.id, 'remove_attendee', v_label);
  perform hq_private.meeting_history_write(v_m, 'remove_attendee', 'Removed ' || coalesce(v_label, 'an attendee') || ' from the attendees', null,
    jsonb_build_object('attendee', jsonb_build_object('from', v_label)));
  return hq_private.meeting_json(v_m) || jsonb_build_object('changed', true, 'label', v_label);
end $$;
comment on function hq.remove_meeting_attendee(uuid, bigint) is 'meetings.write. Removes one attendee (by meeting_attendees.id) from a live meeting the caller can see. Not there: {changed: false}. History, audit. A staff member removed from a confidential meeting no longer sees it (unless they recorded it or hold audit.read).';

-- ------------------------------------------------------------------ links
create function hq.link_meeting(p_meeting uuid, p_kind text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_m hq.meetings;
  v_out jsonb;
  v_tp jsonb;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('meetings.write');
  v_m := hq_private.meeting_lock(p_meeting);
  v_out := hq_private.meeting_add_link(v_m.id, p_kind, p_id);
  if not (v_out ->> 'added')::boolean then
    return hq_private.meeting_json(v_m) || v_out || jsonb_build_object('changed', false, 'touch_points', '[]'::jsonb);
  end if;
  v_m := hq_private.meeting_bump(v_m.id, 'link', replace(p_kind, '_', ' ') || ' ' || (v_out ->> 'label'));
  perform hq_private.meeting_history_write(v_m, 'link', 'Linked ' || replace(p_kind, '_', ' ') || ' ' || (v_out ->> 'label'), null,
    jsonb_build_object(p_kind, jsonb_build_object('to', p_id)));
  v_tp := hq_private.meeting_sync_touchpoints(v_m.id);
  return hq_private.meeting_json(v_m) || v_out || jsonb_build_object('changed', true, 'touch_points', v_tp);
end $$;
comment on function hq.link_meeting(uuid, text, uuid) is 'meetings.write. Links a live meeting the caller can see to a contact, organisation, opportunity, contractor, decision or managed_property the caller can read (else P0002). Already linked: {changed: false}. Logs the touch point on a contact, organisation, lead or contractor. History, audit. Returns the meeting json plus {link_id, added, kind, record_id, label, changed, touch_points}.';

create function hq.unlink_meeting(p_meeting uuid, p_kind text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_m hq.meetings;
  v_col text := hq_private.meeting_link_column(p_kind);
  v_link hq.meeting_links;
  v_tp jsonb;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('meetings.write');
  if v_col is null then
    raise exception 'a link is to a contact, organisation, opportunity, contractor, decision or managed_property' using errcode = 'invalid_parameter_value';
  end if;
  v_m := hq_private.meeting_lock(p_meeting);
  execute format('select * from hq.meeting_links where meeting_id = $1 and %I = $2', v_col) into v_link using v_m.id, p_id;
  if v_link.id is null then
    return hq_private.meeting_json(v_m) || jsonb_build_object('changed', false, 'touch_points', '[]'::jsonb);
  end if;
  if v_link.interaction_id is not null then
    perform hq_private.audit_context(null, 'Unlinked from meeting ' || hq_private.meeting_ref(v_m.ref_number));
    update hq.interactions set deleted_at = now() where id = v_link.interaction_id and deleted_at is null;
    perform hq_private.audit_context();
  end if;
  delete from hq.meeting_links where id = v_link.id;
  v_m := hq_private.meeting_bump(v_m.id, 'unlink', replace(p_kind, '_', ' '));
  perform hq_private.meeting_history_write(v_m, 'unlink', 'Unlinked a ' || replace(p_kind, '_', ' '), null,
    jsonb_build_object(p_kind, jsonb_build_object('from', p_id)));
  -- an organisation that a removed contact covered gets its own touch point now
  v_tp := hq_private.meeting_sync_touchpoints(v_m.id);
  return hq_private.meeting_json(v_m) || jsonb_build_object('changed', true, 'touch_points', v_tp);
end $$;
comment on function hq.unlink_meeting(uuid, text, uuid) is 'meetings.write. Removes the link between a live meeting the caller can see and a record; its touch-point interaction is archived. Not linked: {changed: false}. History, audit.';

-- ------------------------------------------------------------------ add_meeting_action
create function hq.add_meeting_action(
  p_meeting uuid,
  p_title text,
  p_assignee uuid default null,
  p_due_date date default null,
  p_priority hq.task_priority default 'normal',
  p_description text default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_m hq.meetings;
  v_task jsonb;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('meetings.write');
  perform hq_private.require_capability('tasks.write');
  v_m := hq_private.meeting_lock(p_meeting);
  v_task := hq_private.meeting_add_task(v_m, p_title, p_assignee, p_due_date, p_priority, p_description);
  v_m := hq_private.meeting_bump(v_m.id, 'add_action', v_task ->> 'title');
  perform hq_private.meeting_history_write(v_m, 'add_action', 'Added an action: ' || (v_task ->> 'title'), null,
    jsonb_build_object('task_id', jsonb_build_object('to', v_task ->> 'task_id')));
  return hq_private.meeting_json(v_m) || jsonb_build_object('changed', true, 'task', v_task);
end $$;
comment on function hq.add_meeting_action(uuid, text, uuid, date, hq.task_priority, text) is 'meetings.write + tasks.write. Adds one action item to a live meeting the caller can see: a task (source meeting; title 1-200, assignee default the caller and active staff, due date within two years, priority, description up to 2000) linked to the meeting. History, audit. Returns the meeting json plus {task, changed}.';

-- ------------------------------------------------------------------ promote_decision_to_register
create function hq.promote_decision_to_register(
  p_meeting uuid,
  p_title text,
  p_category hq.decision_category,
  p_description text default null,
  p_rationale text default null,
  p_decision_date date default null,
  p_status hq.decision_status default 'decided'
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_m hq.meetings;
  v_tz text;
  v_d jsonb;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('meetings.write');
  perform hq_private.require_capability('decisions.write');
  v_m := hq_private.meeting_lock(p_meeting);
  v_tz := coalesce((select s.value #>> '{}' from hq.settings s where s.key = 'timezone'), 'Australia/Adelaide');
  v_d := hq.create_decision(p_title, p_category, coalesce(p_decision_date, (v_m.held_at at time zone v_tz)::date), coalesce(p_status, 'decided'),
                            p_description, p_rationale, null, 'From meeting ' || hq_private.meeting_ref(v_m.ref_number));
  perform hq_private.meeting_add_link(v_m.id, 'decision', (v_d ->> 'decision_id')::uuid);
  v_m := hq_private.meeting_bump(v_m.id, 'promote_decision', v_d ->> 'ref');
  perform hq_private.meeting_history_write(v_m, 'promote_decision', 'Added ' || (v_d ->> 'ref') || ' to the Decisions register', null,
    jsonb_build_object('decision_id', jsonb_build_object('to', v_d ->> 'decision_id')));
  return hq_private.meeting_json(v_m) || jsonb_build_object('changed', true, 'decision', v_d);
end $$;
comment on function hq.promote_decision_to_register(uuid, text, hq.decision_category, text, text, date, hq.decision_status) is 'meetings.write + decisions.write. Records one decision from a live meeting the caller can see in the Decisions register (hq.create_decision: same rules, history and audit; date defaults to the meeting day; note "From meeting MTG-0001") and links it to the meeting. Returns the meeting json plus {decision, changed}.';

-- ------------------------------------------------------------------ archive_record / restore_record (0138 extended with 'meeting')
create or replace function hq.archive_record(p_entity text, p_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_table text;
  v_caller uuid := hq_private.require_staff();
  v_deleted timestamptz;
  v_allowed boolean;
  v_needs text;
  v_ref hq.referrals;
  v_mtg hq.meetings;
  v_n integer;
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 200);
begin
  v_table := case p_entity
    when 'organisation' then 'organisations' when 'contact' then 'contacts' when 'referral' then 'referrals'
    when 'task' then 'tasks' when 'opportunity' then 'opportunities' when 'interaction' then 'interactions'
    when 'contractor' then 'contractors' when 'contractor_document' then 'contractor_documents'
    when 'contractor_review' then 'contractor_reviews' when 'decision' then 'decisions'
    when 'managed_property' then 'managed_properties' when 'knowledge_document' then 'knowledge_documents'
    when 'meeting' then 'meetings' end;
  if v_table is null then
    raise exception 'unknown entity %; expected organisation, contact, referral, task, opportunity, interaction, contractor, contractor_document, contractor_review, decision, managed_property, knowledge_document or meeting', p_entity
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
  elsif p_entity = 'decision' then
    v_needs := 'decisions.write';
    v_allowed := hq_private.has_capability('decisions.write');
  elsif p_entity = 'managed_property' then
    v_needs := 'portfolio.write';
    v_allowed := hq_private.has_capability('portfolio.write');
  elsif p_entity = 'knowledge_document' then
    v_needs := 'knowledge.approve';
    v_allowed := hq_private.has_capability('knowledge.approve');
  elsif p_entity = 'meeting' then
    v_needs := 'meetings.write';
    v_allowed := hq_private.has_capability('meetings.write');
    if v_allowed then
      -- a confidential meeting the caller may not see is "not found", never a hint that it exists
      select m.* into v_mtg from hq.meetings m where m.id = p_id;
      if found and not hq_private.meeting_visible(v_mtg) then
        raise exception 'meeting not found' using errcode = 'no_data_found';
      end if;
    end if;
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

  perform hq_private.audit_context(null, v_reason);
  if p_entity = 'meeting' then
    update hq.meetings set deleted_at = now(), version = version + 1 where id = p_id returning * into v_mtg;
  else
    execute format('update hq.%I set deleted_at = now() where id = $1', v_table) using p_id;
  end if;
  perform hq_private.audit_context();
  if p_entity = 'decision' then
    perform hq_private.decision_history_write(p_id, 'archive', 'Archived', '{}'::jsonb, v_reason);
  elsif p_entity = 'meeting' then
    perform hq_private.meeting_history_write(v_mtg, 'archive', 'Archived', v_reason);
    perform hq_private.meeting_sync_touchpoints(p_id);
  end if;
  return jsonb_build_object('entity', p_entity, 'id', p_id, 'archived', true, 'changed', true);
end $$;
comment on function hq.archive_record(text, uuid, text) is 'Soft-deletes organisation, contact, referral, task, opportunity, interaction (growth.delete; a task also by its assignee or creator holding tasks.write; an opportunity that is a live managed property is refused), contractor (contractors.approve), contractor_document (contractors.documents), contractor_review (contractors.approve, or its recorder with contractors.write), decision (decisions.write; refused while a live decision is superseded by it; recorded in its history), managed_property (portfolio.write), knowledge_document (knowledge.approve), meeting (meetings.write and able to see it; recorded in its history; its touch points are archived, its action tasks are not).';

create or replace function hq.restore_record(p_entity text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_table text;
  v_deleted timestamptz;
  v_mtg hq.meetings;
  v_n integer;
begin
  perform hq_private.require_staff();
  v_table := case p_entity
    when 'organisation' then 'organisations' when 'contact' then 'contacts' when 'referral' then 'referrals'
    when 'task' then 'tasks' when 'opportunity' then 'opportunities' when 'interaction' then 'interactions'
    when 'contractor' then 'contractors' when 'contractor_document' then 'contractor_documents'
    when 'contractor_review' then 'contractor_reviews' when 'decision' then 'decisions'
    when 'managed_property' then 'managed_properties' when 'knowledge_document' then 'knowledge_documents'
    when 'meeting' then 'meetings' end;
  if v_table is null then
    raise exception 'unknown entity %; expected organisation, contact, referral, task, opportunity, interaction, contractor, contractor_document, contractor_review, decision, managed_property, knowledge_document or meeting', p_entity
      using errcode = 'invalid_parameter_value';
  end if;
  perform hq_private.require_capability(case p_entity
    when 'contractor' then 'contractors.approve'
    when 'contractor_document' then 'contractors.documents'
    when 'contractor_review' then 'contractors.approve'
    when 'decision' then 'decisions.write'
    when 'managed_property' then 'portfolio.write'
    when 'knowledge_document' then 'knowledge.approve'
    when 'meeting' then 'meetings.write'
    else 'growth.delete' end);
  if p_entity = 'meeting' then
    select m.* into v_mtg from hq.meetings m where m.id = p_id;
    if found and not hq_private.meeting_visible(v_mtg) then
      raise exception 'meeting not found' using errcode = 'no_data_found';
    end if;
  end if;
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
  elsif p_entity = 'meeting' then
    update hq.meetings set deleted_at = null, version = version + 1 where id = p_id returning * into v_mtg;
  else
    -- a unique name, email, ABN, primary contact, address, Ailo reference or knowledge title that was
    -- taken meanwhile fails the restore (23505); a decision superseded by an archived decision is
    -- refused (restore that one first); a managed property whose opportunity is no longer signed and
    -- live is refused (23514)
    execute format('update hq.%I set deleted_at = null where id = $1', v_table) using p_id;
  end if;
  if p_entity = 'decision' then
    perform hq_private.decision_history_write(p_id, 'restore', 'Restored');
  elsif p_entity = 'meeting' then
    perform hq_private.meeting_history_write(v_mtg, 'restore', 'Restored');
    perform hq_private.meeting_sync_touchpoints(p_id);
  end if;
  return jsonb_build_object('entity', p_entity, 'id', p_id, 'archived', false, 'changed', true);
end $$;
comment on function hq.restore_record(text, uuid) is 'Restores a soft-deleted record: growth.delete for the Phase 1 entities, contractors.approve for contractor and contractor_review, contractors.documents for contractor_document, decisions.write for decision, portfolio.write for managed_property (refused when its opportunity is no longer signed and live), knowledge.approve for knowledge_document (refused when another live document took its title), meetings.write for meeting (one the caller can see; its touch points are logged again). A restored referral takes attribution back only when the opportunity has none.';

revoke execute on all functions in schema hq_private from public, anon;
revoke execute on all functions in schema hq from public, anon;
