-- 0119_hq_ai_tables_access.sql
-- Planted HQ Phase 3, Ask Planted (docs/hq-phase-3.md, section 2): the ai.use capability, the two
-- settings, the request log hq.ai_requests with its guard, RLS and table privileges.
--
-- hq.ai_requests is the accountability log: one row per question put to the assistant. Rows are
-- created ONLY by hq.ai_begin_request and finished ONLY by hq.ai_finish_request (0120), both security
-- definer. No API role holds insert, update, delete or truncate. The table is append-only apart from
-- the one finishing update (status started -> a final status), which the guard trigger below enforces
-- for every role, including postgres and the secret key: a finished row never changes again, the
-- identity columns (id, staff_id, asked_at, question) never change, and no row is ever deleted.

-- ------------------------------------------------------------------ the capability (section 2)
-- Every role except read_only. The tools still filter by each person's own capabilities.
insert into hq.role_capabilities (role, capability)
select r.role::hq.staff_role, 'ai.use'
from (values
  ('director'), ('administrator'), ('senior_property_manager'), ('property_manager'),
  ('junior_property_manager'), ('business_development_manager'), ('virtual_assistant')
) as r(role)
on conflict do nothing;

-- ------------------------------------------------------------------ settings (section 2)
-- Off until a director switches it on. The limit is per person, per rolling hour.
insert into hq.settings (key, value) values
  ('ai_enabled', 'false'::jsonb),
  ('ai_hourly_limit', '40'::jsonb)
on conflict (key) do nothing;

-- settings_guard (0113) with the two Ask Planted keys: ai_enabled is true or false; ai_hourly_limit is
-- a whole number from 1 to 1000 (1000 is a sanity bound, not a business figure).
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
  if new.key = 'ai_enabled' and jsonb_typeof(new.value) is distinct from 'boolean' then
    raise exception 'ai_enabled must be true or false' using errcode = 'invalid_parameter_value';
  end if;
  if new.key = 'timezone' and (
       jsonb_typeof(new.value) is distinct from 'string'
       or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = new.value #>> '{}')) then
    raise exception 'timezone must be an IANA timezone name' using errcode = 'invalid_parameter_value';
  end if;
  if new.key in ('contractor_min_reviews_for_rating', 'contractor_expiry_warning_days', 'ai_hourly_limit') then
    v_max := case new.key when 'contractor_min_reviews_for_rating' then 100 when 'ai_hourly_limit' then 1000 else 365 end;
    if jsonb_typeof(new.value) is distinct from 'number' or (new.value #>> '{}') !~ '^[0-9]{1,4}$' then
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

-- ------------------------------------------------------------------ the request log
create table hq.ai_requests (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references hq.staff_profiles (id),
  asked_at timestamptz not null default now(),
  question text not null,
  tools_used text[] not null default '{}'::text[],
  status text not null default 'started',
  input_tokens integer,
  output_tokens integer,
  finished_at timestamptz,
  constraint ai_requests_question_length check (char_length(btrim(question)) between 1 and 2000),
  constraint ai_requests_status_known check (status in ('started', 'answered', 'refused', 'error', 'rate_limited')),
  constraint ai_requests_finished_iff_not_started check ((status = 'started') = (finished_at is null)),
  constraint ai_requests_tokens_not_negative check (coalesce(input_tokens, 0) >= 0 and coalesce(output_tokens, 0) >= 0),
  constraint ai_requests_tools_bounded check (cardinality(tools_used) <= 64)
);
comment on table hq.ai_requests is 'Ask Planted request log: who asked what, when, which tools ran, the outcome and token counts. Written only by hq.ai_begin_request / hq.ai_finish_request; append-only apart from the one finishing update; never deleted.';
comment on column hq.ai_requests.status is 'started (begun, not finished) | answered | refused | error | rate_limited (the model provider refused for rate; HQ''s own hourly limit raises in ai_begin_request and stores no row).';
create index ai_requests_staff_id_asked_at_idx on hq.ai_requests (staff_id, asked_at desc);
create index ai_requests_asked_at_idx on hq.ai_requests (asked_at desc);

-- Append-only apart from the finishing update. Not security definer: it inspects the row, not the caller.
create function hq_private.ai_request_guard() returns trigger
language plpgsql set search_path = pg_catalog, public, extensions as $$
begin
  if tg_op = 'UPDATE'
     and old.status = 'started' and old.finished_at is null
     and new.status <> 'started' and new.finished_at is not null
     and new.id = old.id and new.staff_id = old.staff_id
     and new.asked_at = old.asked_at and new.question = old.question then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    raise exception '%.% is append-only (% refused)', tg_table_schema, tg_table_name, tg_op
      using errcode = 'insufficient_privilege', detail = 'only an unfinished request can be finished, once';
  end if;
  raise exception '%.% is append-only (% refused)', tg_table_schema, tg_table_name, tg_op
    using errcode = 'insufficient_privilege';
end $$;
create trigger append_only before update or delete on hq.ai_requests
  for each row execute function hq_private.ai_request_guard();
create trigger append_only_truncate before truncate on hq.ai_requests
  for each statement execute function hq_private.raise_immutable();

-- ------------------------------------------------------------------ RLS (same rules as 0106)
alter table hq.ai_requests enable row level security;
alter table hq.ai_requests force row level security;

-- A person sees their own requests; audit.read holders see everyone's. No insert, update or delete
-- policy: the RPCs write as the owner.
create policy ai_requests_select on hq.ai_requests for select to authenticated
  using ((select hq_private.has_capability('audit.read'))
         or (staff_id = (select auth.uid()) and (select hq_private.staff_session())));

-- ------------------------------------------------------------------ table privileges
revoke all on hq.ai_requests from public, anon, authenticated, service_role;
grant select on hq.ai_requests to authenticated, service_role;

revoke execute on all functions in schema hq_private from public, anon;
