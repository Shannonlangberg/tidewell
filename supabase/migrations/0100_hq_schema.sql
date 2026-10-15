-- 0100_hq_schema.sql
-- Planted HQ (docs/hq-design.md, section 4): schemas, extensions, enums, and normalise_name.
--
-- HQ is self-contained: it does not touch or depend on the parked Tidewell schema (`public`,
-- `private`). Two schemas:
--   hq          exposed to the API (config.toml [api] schemas); tables, views, RPCs.
--   hq_private  NOT exposed; helpers and trigger functions only. No usage for any API role.
--
-- Function privileges: on this Postgres a schema-scoped `alter default privileges ... revoke
-- execute on functions from public` is not stored (see 0000_extensions.sql), so every function
-- created in these schemas is revoked from public and anon explicitly, and 0111_hq_function_acl.sql
-- states the final ACL once, whatever the defaults did.

create extension if not exists btree_gist with schema extensions;
create extension if not exists citext with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create schema if not exists hq authorization postgres;
create schema if not exists hq_private authorization postgres;
comment on schema hq is 'Planted HQ staff portal: tables, views and RPCs. Exposed to the API; every table has forced RLS.';
comment on schema hq_private is 'Planted HQ helpers and trigger functions. Not exposed by the API; no usage for anon, authenticated or service_role.';

revoke all on schema hq from public;
revoke all on schema hq_private from public;
revoke usage on schema hq_private from anon, authenticated, service_role;
-- anon never reaches the schema: with no usage, every hq table or rpc request made with the anon key
-- is DENIED (permission denied for schema hq), not merely empty.
revoke usage on schema hq from anon;
grant usage on schema hq to authenticated, service_role;

-- Enums (section 4, exact value lists).
create type hq.staff_role as enum ('director', 'administrator', 'senior_property_manager', 'property_manager', 'junior_property_manager', 'business_development_manager', 'virtual_assistant', 'read_only');
create type hq.employment_status as enum ('active', 'on_leave', 'ended');
create type hq.partner_category as enum ('real_estate_sales', 'mortgage_broker', 'conveyancer', 'lawyer', 'accountant', 'bank_lending', 'buyers_agent', 'property_developer', 'builder', 'financial_adviser', 'other');
create type hq.relationship_status as enum ('identified', 'contacted', 'meeting_booked', 'met', 'active_relationship', 'referring_partner', 'inactive');
create type hq.priority_level as enum ('high', 'medium', 'low');
create type hq.org_contact_role as enum ('primary', 'secondary', 'other');
create type hq.interaction_type as enum ('phone_call', 'coffee_meeting', 'office_meeting', 'email', 'message', 'note');
create type hq.referral_direction as enum ('received', 'sent');
create type hq.opportunity_stage as enum ('introduction_received', 'contacted', 'qualified', 'appraisal_requested', 'appraisal_completed', 'proposal_sent', 'management_signed', 'lost');
create type hq.sent_referral_outcome as enum ('sent', 'acknowledged', 'converted', 'no_outcome');
create type hq.task_status as enum ('to_do', 'in_progress', 'waiting', 'completed', 'cancelled');
create type hq.task_priority as enum ('low', 'normal', 'high', 'urgent');

-- normalise_name: the key used to recognise the same organisation or person written two ways.
-- Lower-case, `&` becomes `and`, punctuation stripped, whitespace collapsed, a leading `the` and a
-- trailing `pty ltd | pty limited | pty | ltd | limited | inc` removed (never down to nothing).
--   'The Loan Arranger' and 'loan arranger' collide; 'Smith & Co Pty Ltd' = 'smith and co'.
-- IMMUTABLE so generated columns can use it. Execute is granted to authenticated by name (0106):
-- the executor checks execute on a function used in a generated column when a row is written.
create function hq_private.normalise_name(p_name text) returns text
language sql immutable parallel safe strict set search_path = pg_catalog as $$
  select btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(lower(p_name), '&', ' and ', 'g'),
            '[[:punct:]]', '', 'g'),
          '\s+', ' ', 'g'),
        '^\s*the\s+(?=\S)', ''),
      '(?<=\S)\s+(pty\s+ltd|pty\s+limited|pty|ltd|limited|inc)\s*$', ''))
$$;
comment on function hq_private.normalise_name(text) is 'Name key for duplicate detection: lower-case, & to and, punctuation stripped, whitespace collapsed, leading the and trailing pty ltd/pty/ltd/limited/inc removed.';

-- Append-only guard. Raises for every role, including postgres and the secret key. Attached `before
-- update or delete` (row) and `before truncate` (statement; row triggers do not fire on TRUNCATE).
create function hq_private.raise_immutable() returns trigger
language plpgsql set search_path = pg_catalog, public, extensions as $$
begin
  raise exception '%.% is append-only (% refused)', tg_table_schema, tg_table_name, tg_op
    using errcode = 'insufficient_privilege';
end $$;
revoke execute on function hq_private.normalise_name(text), hq_private.raise_immutable() from public, anon;
