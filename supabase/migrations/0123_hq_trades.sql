-- 0123_hq_trades.sql
-- Trades become an owner-editable table (hq.trades) instead of the fixed enum hq.contractor_category.
--
-- WHY: the list of trades (Plumbing, Electrical, ...) is business vocabulary the owner wants to add to,
-- rename, reorder and retire from HQ. A Postgres enum cannot be renamed or retired by a person, so the
-- 22 enum values are moved into hq.trades and contractors.categories becomes text[] of trade SLUGS.
-- The array-of-slugs shape is kept on purpose: the directory filter (`categories cs {plumbing}`), the
-- views, the MCP tools and the import keep working unchanged.
--
-- SAFE ON POPULATED DATA (the live database holds contractors):
--   1. hq.trades is created and seeded with the 22 enum values, slug = the enum value, label = a clean
--      display name, in enum order. Nothing is renamed for the owner.
--   2. contractors.categories is converted in place with an explicit cast (enum[] -> text[]): every
--      value is kept, in order. The one view that names the column is dropped and recreated (same
--      columns plus trade_labels at the end).
--   3. A check refuses to continue if any stored slug is not a trade (it cannot happen, the enum and the
--      seed are the same list, but the migration aborts rather than lose a value).
--   4. Only then are the functions that named the enum replaced and the enum dropped.
--
-- RULES (database-enforced, every writer):
--   * a slug is lower-case snake (a-z, 0-9, _), unique for ever, and immutable once created; labels
--     are editable and unique ignoring case;
--   * a contractor write may only ADD slugs of existing, ACTIVE trades (hq_private.contractor_trades_guard);
--     a slug already on the row stays valid even if its trade is archived later;
--   * a trade that any live (not archived) contractor uses cannot be archived;
--   * trades are written only through the RPCs below (no direct insert / update / delete for the API).
--
-- RPCs (security definer, capability checked inside, audited):
--   create_trade(label, description)                         contractors.write
--   update_trade(trade, label, description, sort_order)      contractors.write
--   move_trade(trade, 'up' | 'down')                         contractors.write
--   set_trade_active(trade, active, reason)                  contractors.approve (archive / restore)
--   mark_contractor_used(contractor, job_date, allow_earlier) contractors.write  ("record a job")

-- ------------------------------------------------------------------ the table
create table hq.trades (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  label text not null,
  description text,
  sort_order integer not null default 0,
  is_active boolean generated always as (archived_at is null) stored,
  archived_at timestamptz,
  archived_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_by uuid,
  constraint trades_slug_key unique (slug),
  constraint trades_slug_shape check (slug ~ '^[a-z][a-z0-9_]{0,59}$'),
  constraint trades_label_not_blank check (btrim(label) <> '' and char_length(label) <= 60),
  constraint trades_description_length check (description is null or char_length(description) <= 500),
  constraint trades_archived_by_needs_archived_at check (archived_by is null or archived_at is not null)
);
comment on table hq.trades is 'The trades (industries) contractors work in. slug is the stable key stored in contractors.categories (immutable); label is the owner-editable display name. Written only through create_trade / update_trade / move_trade / set_trade_active.';
comment on column hq.trades.slug is 'Lower-case snake, unique for ever, never changes. Derived from the label when the trade is created.';
comment on column hq.trades.is_active is 'Generated: archived_at is null. Archived trades stay valid on rows that already carry them.';
create unique index trades_label_uq on hq.trades (lower(label));
create index trades_order_idx on hq.trades (sort_order, label);

-- the 22 values of the old enum, in enum order (labels as the app showed them; the owner can rename)
insert into hq.trades (slug, label, sort_order)
select v.slug, v.label, v.ord * 10
from (values
  (1, 'plumbing', 'Plumbing'), (2, 'electrical', 'Electrical'), (3, 'general_maintenance', 'General maintenance'),
  (4, 'handyman', 'Handyman'), (5, 'carpentry', 'Carpentry'), (6, 'cleaning', 'Cleaning'),
  (7, 'carpet_cleaning', 'Carpet cleaning'), (8, 'gardening', 'Gardening'), (9, 'landscaping', 'Landscaping'),
  (10, 'pest_control', 'Pest control'), (11, 'locksmith', 'Locksmith'), (12, 'painting', 'Painting'),
  (13, 'roofing', 'Roofing'), (14, 'guttering', 'Guttering'), (15, 'air_conditioning', 'Air conditioning'),
  (16, 'appliance_repairs', 'Appliance repairs'), (17, 'garage_doors', 'Garage doors'), (18, 'glazing', 'Glazing'),
  (19, 'tree_services', 'Tree services'), (20, 'building', 'Building'), (21, 'emergency_restoration', 'Emergency restoration'),
  (22, 'other', 'Other')
) as v(ord, slug, label);

-- every enum value must be a trade before anything is converted
do $$
begin
  if exists (select 1 from unnest(enum_range(null::hq.contractor_category)) e where e::text not in (select slug from hq.trades)) then
    raise exception 'trades seed does not cover hq.contractor_category; migration aborted';
  end if;
end $$;

-- ------------------------------------------------------------------ helpers
-- The slug a label would get: lower case, & read as "and", anything else not a-z / 0-9 becomes _,
-- repeats and ends trimmed, at most 40 characters, starting with a letter ("t_" is put in front of a
-- leading digit), "trade" when nothing is left. Mirrored by lib/hq/trades/rules.ts tradeSlugBase.
create function hq_private.trade_slug_base(p_label text) returns text
language sql immutable parallel safe set search_path = pg_catalog as $$
  select case
    when s = '' then 'trade'
    when s ~ '^[0-9]' then left('t_' || s, 40)
    else s end
  from (
    select btrim(left(btrim(regexp_replace(replace(lower(coalesce(p_label, '')), '&', ' and '), '[^a-z0-9]+', '_', 'g'), '_'), 40), '_') as s
  ) x
$$;
comment on function hq_private.trade_slug_base(text) is 'The slug a label would get before collision handling (lower snake, max 40, starts with a letter).';

-- A slug no trade has (archived ones included): the base, else base_2, base_3, ...
create function hq_private.trade_unique_slug(p_label text) returns text
language plpgsql stable security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_base text := hq_private.trade_slug_base(p_label);
  v_try text := v_base;
  v_n integer := 1;
begin
  while exists (select 1 from hq.trades t where t.slug = v_try) loop
    v_n := v_n + 1;
    v_try := v_base || '_' || v_n;
  end loop;
  return v_try;
end $$;

-- Label as stored: trimmed, inner whitespace collapsed.
create function hq_private.trade_clean_label(p_label text) returns text
language sql immutable parallel safe set search_path = pg_catalog as $$
  select regexp_replace(btrim(coalesce(p_label, '')), '\s+', ' ', 'g')
$$;

-- ------------------------------------------------------------------ trades: guard
-- Holds for every writer: the slug never changes; label and description are tidied; archived_by is
-- stamped; archiving is refused while a live contractor uses the trade.
create function hq_private.trade_guard() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_in_use bigint;
begin
  new.label := hq_private.trade_clean_label(new.label);
  new.description := nullif(btrim(coalesce(new.description, '')), '');
  if tg_op = 'UPDATE' then
    if new.slug is distinct from old.slug then
      raise exception 'a trade''s slug cannot change (rename its label instead)' using errcode = 'insufficient_privilege';
    end if;
    if old.archived_at is null and new.archived_at is not null then
      select count(*) into v_in_use from hq.contractors c where c.deleted_at is null and new.slug = any (c.categories);
      if v_in_use > 0 then
        raise exception '% contractor(s) still use this trade; move them to another trade or remove it from them first', v_in_use
          using errcode = 'check_violation', hint = 'trade_in_use';
      end if;
    end if;
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  end if;
  new.archived_by := case when new.archived_at is null then null
                          when tg_op = 'UPDATE' and old.archived_at is not null then old.archived_by
                          else coalesce(auth.uid(), new.archived_by) end;
  return new;
end $$;

create trigger row_stamp before insert or update on hq.trades for each row execute function hq_private.row_stamp();
create trigger trade_guard before insert or update on hq.trades for each row execute function hq_private.trade_guard();
create trigger no_delete before delete on hq.trades for each row execute function hq_private.raise_immutable();
create trigger no_truncate before truncate on hq.trades for each statement execute function hq_private.raise_immutable();

-- ------------------------------------------------------------------ trades: access
alter table hq.trades enable row level security;
alter table hq.trades force row level security;
-- Everyone who can read contractors reads every trade (archived ones too: they still label old rows).
create policy trades_select on hq.trades for select to authenticated
  using ((select hq_private.has_capability('contractors.read')));
revoke all on hq.trades from public, anon, authenticated, service_role;
grant select on hq.trades to authenticated, service_role;

-- ------------------------------------------------------------------ audit: trades are labelled by their label
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
    when tg_table_name = 'trades' and v_old ->> 'archived_at' is null and v_new ->> 'archived_at' is not null then 'archive'
    when tg_table_name = 'trades' and v_old ->> 'archived_at' is not null and v_new ->> 'archived_at' is null then 'restore'
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
    case when tg_table_name = 'trades' then v_row ->> 'label' end,
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

create trigger audit after insert or update or delete on hq.trades for each row execute function hq_private.audit_row('trade');

-- ------------------------------------------------------------------ contractors.categories: enum[] -> text[] (data kept)
drop view hq.contractor_directory;
alter table hq.contractors alter column categories type text[] using categories::text[];
comment on column hq.contractors.categories is 'Trade slugs (hq.trades.slug), at least one, in the order chosen. A write may only add slugs of active trades (contractor_trades_guard).';

do $$
begin
  if exists (select 1 from hq.contractors c, unnest(c.categories) k where k not in (select slug from hq.trades)) then
    raise exception 'a stored contractor category is not a trade; migration aborted';
  end if;
end $$;

-- Every writer: slugs are trimmed and lower-cased, blanks and repeats dropped (first kept, order kept);
-- any slug the row did not already carry must be an existing, active trade. The trades it names are
-- share-locked, so a trade cannot be archived between this check and the commit.
create function hq_private.contractor_trades_guard() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_added text[];
  v_bad text[];
begin
  new.categories := array(
    select d.v from (
      select distinct on (t.v) t.v, t.o
      from (select lower(btrim(x)) as v, o from unnest(coalesce(new.categories, '{}'::text[])) with ordinality as u(x, o)) t
      where t.v is not null and t.v <> ''
      order by t.v, t.o) d
    order by d.o);
  if tg_op = 'UPDATE' and new.categories is not distinct from old.categories then
    return new;
  end if;
  v_added := array(select x from unnest(new.categories) x
                   where tg_op = 'INSERT' or not (x = any (coalesce(old.categories, '{}'::text[]))));
  if cardinality(v_added) = 0 then
    return new;
  end if;
  perform 1 from hq.trades t where t.slug = any (v_added) for share;
  v_bad := array(select x from unnest(v_added) x
                 where not exists (select 1 from hq.trades t where t.slug = x and t.archived_at is null));
  if cardinality(v_bad) > 0 then
    raise exception 'not a current trade: % (contractors_trades_known)', array_to_string(v_bad, ', ')
      using errcode = 'check_violation', hint = 'contractors_trades_known';
  end if;
  return new;
end $$;
create trigger contractor_trades_guard before insert or update on hq.contractors for each row execute function hq_private.contractor_trades_guard();

-- ------------------------------------------------------------------ contractor_directory (0115, plus trade_labels)
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
  i.last_contacted_at,
  array(select coalesce(tr.label, k.slug) from unnest(c.categories) with ordinality as k(slug, o)
        left join hq.trades tr on tr.slug = k.slug order by k.o) as trade_labels
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
comment on view hq.contractor_directory is 'Live contractors with licence_state / insurance_state (not_recorded, unverified, current, expiring_soon, expired), vetting_done_count (0-9), review counts, rating (null below the threshold), document and open task counts, last_contacted_at, last_job_date (recorded by staff) and trade_labels (the current labels of categories, in order). security_invoker.';
revoke all on hq.contractor_directory from public, anon, authenticated, service_role;
grant select on hq.contractor_directory to authenticated, service_role;

-- ------------------------------------------------------------------ contractor_summary (0116, coverage from hq.trades)
-- preferred_coverage: one entry per ACTIVE trade (sort_order, then label), plus any archived trade that a
-- cleared contractor still carries; {category (slug), label, approved, preferred, total}.
-- trades_without_cover: active trades other than 'other' with no approved or preferred contractor.
create or replace function hq.contractor_summary() returns jsonb
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

  with n as (
    select k as cat, count(*) filter (where c.status = 'approved') as approved, count(*) filter (where c.status = 'preferred') as preferred
    from hq.contractors c, unnest(c.categories) k
    where c.deleted_at is null and c.status in ('approved', 'preferred')
    group by k
  ), e as (
    select t.slug as cat, t.label, t.archived_at is null as active,
           row_number() over (order by t.sort_order, lower(t.label), t.slug) as ord
    from hq.trades t
    where t.archived_at is null or t.slug in (select cat from n)
  )
  select jsonb_agg(jsonb_build_object('category', e.cat, 'label', e.label, 'approved', coalesce(n.approved, 0), 'preferred', coalesce(n.preferred, 0),
                                      'total', coalesce(n.approved, 0) + coalesce(n.preferred, 0)) order by e.ord),
         coalesce(jsonb_agg(to_jsonb(e.cat) order by e.ord) filter (where e.active and e.cat <> 'other' and coalesce(n.approved, 0) + coalesce(n.preferred, 0) = 0), '[]'::jsonb)
    into v_coverage, v_none
  from e left join n on n.cat = e.cat;

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
    'preferred_coverage', coalesce(v_coverage, '[]'::jsonb),
    'trades_without_cover', v_none);
end $$;
comment on function hq.contractor_summary() is 'contractors.read. {as_of, warning_days, total, by_status, awaiting_vetting, expiring_soon, expired, contractors_with_expired_items, cleared_with_expired_items, preferred_coverage[{category, label, approved, preferred, total}] (active trades in their order), trades_without_cover[] (active trades but other)}.';

-- ------------------------------------------------------------------ the contractor import (0117): categories are active trade slugs
create or replace function hq_private.contractor_import_plan(p_rows jsonb) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_labels text[] := (select coalesce(array_agg(t.slug), '{}'::text[]) from hq.trades t where t.archived_at is null);
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
  v_badcat text;
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
      v_badcat := null;
      if jsonb_typeof(v_row -> 'categories') = 'array' then
        select coalesce(c #>> '{}', c::text) into v_badcat
        from jsonb_array_elements(v_row -> 'categories') with ordinality as x(c, o)
        where jsonb_typeof(c) <> 'string' or lower(btrim(c #>> '{}')) <> all (v_labels)
        order by o limit 1;
      end if;
      if v_name = '' then
        v_class := 'invalid'; v_reason := 'business_name is required';
      elsif char_length(v_name) > 200 then
        v_class := 'invalid'; v_reason := 'business_name is limited to 200 characters';
      elsif hq_private.normalise_name(v_name) = '' then
        v_class := 'invalid'; v_reason := 'business_name needs at least one letter or digit';
      elsif (case when jsonb_typeof(v_row -> 'categories') = 'array' then jsonb_array_length(v_row -> 'categories') = 0 else true end) then
        v_class := 'invalid'; v_reason := 'categories must be a non-empty array';
      elsif v_badcat is not null then
        v_class := 'invalid'; v_reason := 'unknown category: ' || left(v_badcat, 60) || ' is not a current trade';
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

create or replace function hq.apply_contractor_import(p_rows jsonb, p_source text, p_file_name text default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_source text := btrim(coalesce(p_source, ''));
  v_plan jsonb;
  v_counts jsonb;
  v_e jsonb;
  v_row jsonb;
  v_cats text[];
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
      select lower(btrim(t.c))
      from jsonb_array_elements_text(v_row -> 'categories') with ordinality as t(c, o)
      group by lower(btrim(t.c)) order by min(t.o));
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
comment on function hq.apply_contractor_import(jsonb, text, text) is 'import.run + contractors.write. Applies the preview''s classification transactionally (prospect, needs_verification, source = p_source, supplied fields only; categories must be active trade slugs), skipping duplicates, recording an import_batches row (kind contractor) and an audit event. An invalid row refuses the file. Returns {dry_run, batch_id, counts, rows}.';

-- ------------------------------------------------------------------ global_search (0117): trades by their current label
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

  -- a contractor's trades as their current labels (the slug with _ as a space if a label is missing)
  select coalesce(jsonb_agg(s.item order by s.prefix desc, s.score desc, s.name), '[]'::jsonb) into v_contractors
  from (
    select jsonb_build_object('id', c.id, 'title', c.business_name, 'business_name', c.business_name,
             'status', c.status, 'categories', to_jsonb(c.categories), 'primary_contact_name', c.primary_contact_name,
             'subtitle', concat_ws(' - ',
               nullif(array_to_string(tl.labels, ', '), ''),
               nullif(array_to_string(c.service_suburbs[1:3], ', ') || case when cardinality(c.service_suburbs) > 3 then ' +' || (cardinality(c.service_suburbs) - 3) else '' end, ''),
               replace(c.status::text, '_', ' '))) as item,
           (c.business_name ilike v_like || '%') as prefix,
           greatest(similarity(c.business_name, v_q), similarity(coalesce(c.primary_contact_name, ''), v_q)) as score,
           c.business_name as name
    from hq.contractors c
    cross join lateral (
      select array(select coalesce(tr.label, replace(k.slug, '_', ' ')) from unnest(c.categories) with ordinality as k(slug, o)
                   left join hq.trades tr on tr.slug = k.slug order by k.o) as labels
    ) tl
    where c.deleted_at is null
      and (c.business_name ilike '%' || v_like || '%' or c.business_name % v_q
           or c.primary_contact_name ilike '%' || v_like || '%'
           or exists (select 1 from unnest(c.categories) k where replace(k, '_', ' ') ilike '%' || v_like || '%' or replace(k, '_', ' ') % v_q)
           or exists (select 1 from unnest(tl.labels) lb where lb ilike '%' || v_like || '%' or lb % v_q)
           or exists (select 1 from unnest(c.service_suburbs) sb where sb ilike '%' || v_like || '%'))
    order by 2 desc, 3 desc, 4
    limit v_limit
  ) s;

  return jsonb_build_object('contacts', v_contacts, 'organisations', v_orgs, 'referrals', v_refs, 'tasks', v_tasks, 'contractors', v_contractors);
end $$;
comment on function hq.global_search(text, integer) is 'SECURITY INVOKER: RLS decides what the caller finds. {contacts, organisations, referrals, tasks, contractors}, each [{id, title, subtitle, ...}]. Contractors match by name, contact, trade (slug or current label) and suburb; the subtitle shows trade labels. LIKE metacharacters are escaped.';

-- ------------------------------------------------------------------ the enum is gone
-- Nothing names it any more (the three functions above were its last users; a test checks pg_proc).
drop type hq.contractor_category;

-- ------------------------------------------------------------------ trade RPCs
create function hq_private.trade_json(p_trade hq.trades) returns jsonb
language sql stable set search_path = pg_catalog, public, extensions as $$
  select jsonb_build_object('trade_id', p_trade.id, 'slug', p_trade.slug, 'label', p_trade.label, 'description', p_trade.description,
                            'sort_order', p_trade.sort_order, 'is_active', p_trade.archived_at is null)
$$;

-- Label rules shared by create and update: 1-60 characters after tidying, at least one letter or digit,
-- not the label of another trade (ignoring case; archived ones count: restore it instead).
create function hq_private.trade_check_label(p_label text, p_except uuid) returns text
language plpgsql stable security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_label text := hq_private.trade_clean_label(p_label);
  v_other hq.trades;
begin
  if v_label = '' then
    raise exception 'a trade needs a name' using errcode = 'invalid_parameter_value';
  end if;
  if char_length(v_label) > 60 then
    raise exception 'a trade name is at most 60 characters' using errcode = 'invalid_parameter_value';
  end if;
  if v_label !~ '[[:alnum:]]' then
    raise exception 'a trade name needs at least one letter or digit' using errcode = 'invalid_parameter_value';
  end if;
  select t.* into v_other from hq.trades t where lower(t.label) = lower(v_label) and t.id is distinct from p_except limit 1;
  if found then
    raise exception '%', 'there is already a trade called ' || v_other.label
      || case when v_other.archived_at is not null then ' (archived: restore it instead)' else '' end
      using errcode = 'unique_violation', hint = 'trade_label_taken';
  end if;
  return v_label;
end $$;

create function hq.create_trade(p_label text, p_description text default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_label text;
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
  v_t hq.trades;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('contractors.write');
  -- one trade created at a time, so two people adding "Solar" get solar and solar_2, never a clash
  perform pg_advisory_xact_lock(hashtextextended('hq.trades', 0));
  v_label := hq_private.trade_check_label(p_label, null);
  if v_desc is not null and char_length(v_desc) > 500 then
    raise exception 'a trade description is at most 500 characters' using errcode = 'invalid_parameter_value';
  end if;
  insert into hq.trades (slug, label, description, sort_order)
  values (hq_private.trade_unique_slug(v_label), v_label, v_desc,
          coalesce((select max(t.sort_order) from hq.trades t where t.archived_at is null), 0) + 10)
  returning * into v_t;
  return hq_private.trade_json(v_t) || jsonb_build_object('changed', true);
end $$;
comment on function hq.create_trade(text, text) is 'contractors.write. Adds a trade at the end of the order. The slug is derived from the label (lower snake; a taken slug gets _2, _3 ...) and never changes. Returns {trade_id, slug, label, description, sort_order, is_active, changed}.';

-- null leaves a field as it is; a blank description clears it.
create function hq.update_trade(p_trade uuid, p_label text default null, p_description text default null, p_sort_order integer default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_t hq.trades;
  v_label text;
  v_desc text;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('contractors.write');
  perform pg_advisory_xact_lock(hashtextextended('hq.trades', 0));
  select t.* into v_t from hq.trades t where t.id = p_trade for update;
  if not found then
    raise exception 'trade not found' using errcode = 'no_data_found';
  end if;
  v_label := case when p_label is null then v_t.label else hq_private.trade_check_label(p_label, v_t.id) end;
  v_desc := case when p_description is null then v_t.description else nullif(btrim(p_description), '') end;
  if v_desc is not null and char_length(v_desc) > 500 then
    raise exception 'a trade description is at most 500 characters' using errcode = 'invalid_parameter_value';
  end if;
  if p_sort_order is not null and (p_sort_order < 0 or p_sort_order > 1000000) then
    raise exception 'sort_order must be between 0 and 1000000' using errcode = 'invalid_parameter_value';
  end if;
  if v_label = v_t.label and v_desc is not distinct from v_t.description and coalesce(p_sort_order, v_t.sort_order) = v_t.sort_order then
    return hq_private.trade_json(v_t) || jsonb_build_object('changed', false);
  end if;
  update hq.trades set label = v_label, description = v_desc, sort_order = coalesce(p_sort_order, sort_order)
  where id = v_t.id returning * into v_t;
  return hq_private.trade_json(v_t) || jsonb_build_object('changed', true);
end $$;
comment on function hq.update_trade(uuid, text, text, integer) is 'contractors.write. Renames (label), describes or re-positions a trade; null leaves a field unchanged, a blank description clears it. The slug never changes. Returns {trade_id, slug, label, description, sort_order, is_active, changed}.';

-- Swaps an active trade with its neighbour in the order (sort_order, then label). The active trades are
-- renumbered 10, 20, 30 ... first, so ties and gaps never stop a move. One audit row.
create function hq.move_trade(p_trade uuid, p_direction text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_t hq.trades;
  v_ids uuid[];
  v_pos integer;
  v_other integer;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('contractors.write');
  if p_direction is null or p_direction not in ('up', 'down') then
    raise exception 'direction must be up or down' using errcode = 'invalid_parameter_value';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('hq.trades', 0));
  select t.* into v_t from hq.trades t where t.id = p_trade for update;
  if not found then
    raise exception 'trade not found' using errcode = 'no_data_found';
  end if;
  if v_t.archived_at is not null then
    raise exception 'an archived trade has no place in the order; restore it first' using errcode = 'invalid_parameter_value';
  end if;
  v_ids := array(select t.id from hq.trades t where t.archived_at is null order by t.sort_order, lower(t.label), t.slug);
  v_pos := array_position(v_ids, p_trade);
  v_other := case when p_direction = 'up' then v_pos - 1 else v_pos + 1 end;
  if v_other < 1 or v_other > cardinality(v_ids) then
    return hq_private.trade_json(v_t) || jsonb_build_object('changed', false);
  end if;
  v_ids[v_pos] := v_ids[v_other];
  v_ids[v_other] := p_trade;

  perform hq_private.audit_context('skip');
  update hq.trades t set sort_order = x.o * 10
  from unnest(v_ids) with ordinality as x(id, o)
  where t.id = x.id and t.sort_order is distinct from (x.o * 10)::integer;
  perform hq_private.audit_context();
  perform hq_private.audit_write('reorder', 'trade', p_trade,
    format('Moved trade %s %s', v_t.label, p_direction), jsonb_build_object('direction', p_direction, 'position', jsonb_build_object('from', v_pos, 'to', v_other)));

  select t.* into v_t from hq.trades t where t.id = p_trade;
  return hq_private.trade_json(v_t) || jsonb_build_object('changed', true);
end $$;
comment on function hq.move_trade(uuid, text) is 'contractors.write. Moves an active trade one place up or down (renumbering the active trades 10, 20, ...). At the end already: changed false. Returns {trade_id, slug, label, description, sort_order, is_active, changed}.';

-- Archive (p_active false) or restore (true). Archiving is refused while a live contractor uses the trade
-- (23514, hint trade_in_use). Restoring puts it back where it was in the order.
create function hq.set_trade_active(p_trade uuid, p_active boolean, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_t hq.trades;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('contractors.approve');
  if p_active is null then
    raise exception 'say whether the trade is active' using errcode = 'invalid_parameter_value';
  end if;
  select t.* into v_t from hq.trades t where t.id = p_trade for update;
  if not found then
    raise exception 'trade not found' using errcode = 'no_data_found';
  end if;
  if (v_t.archived_at is null) = p_active then
    return hq_private.trade_json(v_t) || jsonb_build_object('changed', false);
  end if;
  perform hq_private.audit_context(null, left(nullif(btrim(coalesce(p_reason, '')), ''), 200));
  update hq.trades set archived_at = case when p_active then null else now() end where id = v_t.id returning * into v_t;
  perform hq_private.audit_context();
  return hq_private.trade_json(v_t) || jsonb_build_object('changed', true);
end $$;
comment on function hq.set_trade_active(uuid, boolean, text) is 'contractors.approve. Archives (false) or restores (true) a trade. Archiving is refused (23514) while any live contractor uses it. Returns {trade_id, slug, label, description, sort_order, is_active, changed}.';

-- ------------------------------------------------------------------ mark_contractor_used ("record a job")
-- Sets last_job_date (recorded by staff; HQ is not connected to Ailo) to p_job_date, default today in
-- the configured timezone. Never in the future. Never moves the date BACKWARDS unless p_allow_earlier
-- is true (the person confirmed it). Same date: changed false. Audited as record_use.
create function hq.mark_contractor_used(p_contractor uuid, p_job_date date default null, p_allow_earlier boolean default false) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_date date := coalesce(p_job_date, hq.today());
  v_c hq.contractors;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('contractors.write');
  if v_date > hq.today() then
    raise exception 'a job date cannot be in the future' using errcode = 'invalid_parameter_value';
  end if;
  if v_date < date '1990-01-01' then
    raise exception 'that job date is too far in the past' using errcode = 'invalid_parameter_value';
  end if;
  select c.* into v_c from hq.contractors c where c.id = p_contractor and c.deleted_at is null for update;
  if not found then
    raise exception 'contractor not found' using errcode = 'no_data_found';
  end if;
  if v_c.last_job_date = v_date then
    return jsonb_build_object('contractor_id', v_c.id, 'last_job_date', v_c.last_job_date, 'previous_last_job_date', v_c.last_job_date, 'changed', false);
  end if;
  if v_c.last_job_date is not null and v_date < v_c.last_job_date and not coalesce(p_allow_earlier, false) then
    raise exception 'that date is earlier than the last job already recorded (%); confirm to move it back', to_char(v_c.last_job_date, 'FMDD Mon YYYY')
      using errcode = 'check_violation', hint = 'job_date_earlier';
  end if;
  perform hq_private.audit_context('record_use', null);
  update hq.contractors set last_job_date = v_date where id = v_c.id;
  perform hq_private.audit_context();
  return jsonb_build_object('contractor_id', v_c.id, 'last_job_date', v_date, 'previous_last_job_date', v_c.last_job_date, 'changed', true);
end $$;
comment on function hq.mark_contractor_used(uuid, date, boolean) is 'contractors.write. Records that a contractor was used (last_job_date, recorded by staff): default today, never in the future, never earlier than the recorded date unless p_allow_earlier. Returns {contractor_id, last_job_date, previous_last_job_date, changed}.';

revoke execute on all functions in schema hq_private from public, anon;
revoke execute on all functions in schema hq from public, anon;
