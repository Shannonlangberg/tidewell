-- 0000_extensions.sql
-- Phase 0 (Foundations): extensions and the `private` schema. Design 3.1 and 3.6.
--
-- Extensions live in `extensions`, so every pinned search_path is `pg_catalog, public, extensions`.
-- pgaudit is deferred to phase 8 (hardening). pgtap is installed by `supabase test db` locally and
-- is deliberately not part of the schema.

create extension if not exists btree_gist with schema extensions;
create extension if not exists citext with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
create extension if not exists supabase_vault with schema vault;

-- The `private` schema: not exposed by the API (config.toml keeps schemas = ["public", "graphql_public"]).
-- Holds the RLS helpers, the event emitter and router, the auth hooks and every secret function.
-- `usage` goes only to postgres and (in 0017_auth_hooks.sql) supabase_auth_admin.
create schema if not exists private authorization postgres;
comment on schema private is
  'Not exposed by the API. RLS helpers, event emitter/router, auth hooks and secret functions. '
  'No usage for anon, authenticated or service_role; helpers used in policies get execute explicitly.';

revoke all on schema private from public;
revoke usage on schema private from anon, authenticated, service_role;
grant usage on schema private to postgres;

-- Postgres gives PUBLIC execute on every new function, and a schema-scoped
-- `alter default privileges ... revoke execute on functions from public` is not stored (verified on
-- 17.6: the function's ACL stays null and PUBLIC keeps execute). So function privileges in `private`
-- are set explicitly: 0013_helpers.sql grants the policy helpers to authenticated by name, and
-- 0020_function_acl.sql revokes execute on every function in `private` from public, anon,
-- authenticated and service_role before re-granting exactly those helpers and the two auth hooks.

-- Row triggers do not fire on TRUNCATE, so truncate is never granted on public tables to the API
-- roles (3.1). This changes the default ACL for every table postgres creates in public from here on;
-- 0015_grants.sql also revokes it on the tables created in between.
alter default privileges for role postgres in schema public revoke truncate on tables from anon, authenticated, service_role;

-- `anon` reaches the database only through the two public views (3.6); it is never granted a table.
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke all on functions from anon;
