# Planted HQ: design and build contract

Planted HQ is the private operating system for Planted Property Management. It is **not** property management software.

> Ailo runs the properties. Planted HQ runs the company. AI connects the experience.

This document is the plan and the shared contract for building HQ. Phase 1 is the working foundation; later phases are listed at the end.

## 1. What the repository already gave us

| Area | Finding | Consequence |
|---|---|---|
| Framework | Next.js 16.3 (App Router, Turbopack), React 19, TypeScript | HQ extends it. No migration. |
| Public site | `app/(site)` route group, Tailwind v4 under a hand-built token layer | Untouched. HQ gets its own route tree and its own CSS entry. |
| Parked product | `app/app`, `app/stay`, `supabase/migrations/0000-0020` (Tidewell holiday homes) | Stays where it is, noindexed. HQ does not depend on its tables. |
| Auth | Supabase Auth: email six-digit code, TOTP, password sign-in refused by hook, sign-ups disabled, local JWT verification in Server Components, refresh confined to `/api/session` | **Reused.** HQ adds its own staff table and sign-in screens, not a second auth system. |
| Database | Local Supabase stack (Postgres 17), pgTAP, `supabase test db` | Same tooling. HQ migrations are numbered `0100+`. |
| Hosting | Netlify with `@netlify/plugin-nextjs` (load-bearing). Site `hq.plantedproperty.com.au` | `/hq` deploys with the site. A subdomain can be added later. |
| Secrets | `lib/supabase/secret.ts` is the only reader of the secret key, guarded by an ESLint boundary | HQ adds one more allowed file (staff invitation). |

## 2. Architectural decisions and trade-offs

**D1. One Next.js app, HQ at `/hq`.** The simplest secure deployment: one build, one deploy, shared auth cookies, no cross-origin session handling. Moving to `hq.planted.com.au` later needs a Netlify domain alias plus a host-based rewrite; no code in HQ assumes the path prefix beyond a single `HQ_BASE` constant.

**D2. HQ data lives in its own Postgres schema, `hq`.** Not in `public`. Reasons: the parked Tidewell schema already uses names such as `documents`, `events` and `integration_sync`; a schema boundary keeps the two systems separable and lets Tidewell be retired later without touching HQ. Cost: the schema must be added to the API's exposed schemas (`config.toml` locally, project settings when hosted). Helper functions live in a **non-exposed** schema, `hq_private`.

**D3. Authorisation is enforced in the database, not the UI.** Every table has RLS. Policies call `hq_private.has_capability('...')`, which reads the person's live `hq.staff_profiles` row and the `hq.role_capabilities` table. No JWT claim is trusted for authorisation. Hiding a button is never the control. Server Actions run as the signed-in person (the user's own JWT), so RLS applies to every query.

**D4. Roles map to editable capabilities.** Eight roles (director, administrator, senior/standard/junior property manager, business development manager, virtual assistant, read-only) map to capability strings in `hq.role_capabilities`. New roles or a changed matrix is a data change, not a code change.

**D5. MFA required by default.** `hq.settings.require_mfa = true` means every HQ query needs an `aal2` session. The local dev seed turns it off so development is not blocked; production keeps it on.

**D6. The secret key touches auth only.** Inviting a person needs `auth.admin.createUser`. That is the only secret-key use in HQ. The profile row is then created by a `security definer` RPC that checks the caller holds `people.admin`.

**D7. Referrals vs opportunities.** A *referral* is an introduction (who introduced whom, when, in which direction). An *opportunity* is the prospective management. The pipeline stage lives on the opportunity. One opportunity can have several referral records (two partners both claim the introduction), but exactly one is the **attributed** source, enforced by a partial unique index. A signed management is a property of the opportunity, so it is counted once and credited to one source. That is the double-counting guarantee.

**D8. No fabricated data, ever.** Empty states say what to do. Research leads import as `identified`, `needs_verification = true`, with only the fields supplied. Anything illustrative in development is labelled "sample" and cannot exist in production.

**D9. Ailo is an interface, not an integration.** Nothing in Phase 1 calls Ailo. `lib/hq/integrations/ailo.ts` now holds only the reference-only shape (`PropertyRef`: the Ailo reference and set-up status a person typed); the proposed read/sync methods were removed (Day 3). No scraping, no stored credentials, no sync.

**D10. No new runtime dependencies in Phase 1.** Forms use native elements and Server Actions; drawers use native `<dialog>`; tables are server-rendered with URL-driven sort, filter and pagination. Tests use Node's built-in runner and pgTAP.

## 3. Modules and routes

Primary navigation: Dashboard, Growth, Partners, Operations, People, Insights. Plus Settings, Profile, Sign out, and **Ask Planted** reachable from anywhere.

| Route | Module | Phase 1 |
|---|---|---|
| `/hq` | Dashboard (role-aware widgets) | Built |
| `/hq/sign-in`, `/hq/verify`, `/hq/mfa` | Authentication | Built |
| `/hq/growth` | Growth overview and partner performance | Built |
| `/hq/growth/partners` | Referral partners: last contacted, next follow-up, referrals per partner (not the contractor Partners module) | Built |
| `/hq/growth/contacts`, `/hq/growth/contacts/[id]` | Contacts and relationship profile | Built |
| `/hq/growth/organisations`, `/hq/growth/organisations/[id]` | Organisations | Built |
| `/hq/growth/referrals`, `/hq/growth/referrals/[id]` | Referral register and detail | Built |
| `/hq/growth/pipeline` | Opportunity pipeline board | Built |
| `/hq/growth/import` | Reviewable partner import | Built |
| `/hq/partners` | Contractors | Phase 2 (landing states this plainly) |
| `/hq/operations` | Tasks (my, team, overdue, today, upcoming, done) | Built |
| `/hq/people`, `/hq/people/[id]` | Staff, roles, pods, invitations | Built (foundation) |
| `/hq/insights` | Business intelligence | Phase 4 (landing states this plainly) |
| `/hq/settings`, `/hq/profile` | Preferences, MFA, timezone | Built (basic) |

Cross-cutting in Phase 1: global search (also `Cmd/Ctrl+K`), a quick-add menu (add contact, log call, new task, record referral), and an **Ask Planted** entry point that opens a panel stating plainly that the assistant arrives in Phase 3. It does not fake a conversation.

## 4. Data model (schema `hq`)

Conventions: `id uuid primary key default gen_random_uuid()`, `created_at`/`updated_at timestamptz`, `created_by uuid` defaulting to the caller, soft deletion through `deleted_at`/`deleted_by` on records people can archive, money in integer cents (AUD), dates in the configured timezone (`Australia/Adelaide` by default, never hard-coded in queries; use `hq.today()`).

### Enums

- `hq.staff_role`: `director, administrator, senior_property_manager, property_manager, junior_property_manager, business_development_manager, virtual_assistant, read_only`
- `hq.employment_status`: `active, on_leave, ended`
- `hq.partner_category`: `real_estate_sales, mortgage_broker, conveyancer, lawyer, accountant, bank_lending, buyers_agent, property_developer, builder, financial_adviser, other`
- `hq.relationship_status`: `identified, contacted, meeting_booked, met, active_relationship, referring_partner, inactive`
- `hq.priority_level`: `high, medium, low`
- `hq.org_contact_role`: `primary, secondary, other`
- `hq.interaction_type`: `phone_call, coffee_meeting, office_meeting, email, message, note`
- `hq.referral_direction`: `received, sent`
- `hq.opportunity_stage`: `introduction_received, contacted, qualified, appraisal_requested, appraisal_completed, proposal_sent, management_signed, lost`
- `hq.sent_referral_outcome`: `sent, acknowledged, converted, no_outcome`
- `hq.task_status`: `to_do, in_progress, waiting, completed, cancelled`
- `hq.task_priority`: `low, normal, high, urgent`

### Tables

- **`pods`**: `name unique, region, is_active`.
- **`staff_profiles`**: `id` = `auth.users.id` (restrict, never cascade: history must survive), `full_name, first_name, email citext unique, role, pod_id, employment_status, start_date, responsibilities, timezone default 'Australia/Adelaide', dashboard_widgets text[] (null = role default), is_active, invited_by, invited_at`. At least one active director must always remain (trigger).
- **`role_capabilities`**: `(role, capability)` primary key.
- **`settings`**: `key primary key, value jsonb, updated_by, updated_at`. Seeded: `require_mfa = true`, `timezone = "Australia/Adelaide"`.
- **`organisations`**: `name, name_key` (generated from `hq.normalise_name`), `categories hq.partner_category[]` (at least one), `website, phone, email, location, service_region, relationship_owner_id, notes, source, needs_verification, verified_at, verified_by, external_ids jsonb`, soft delete. Unique `name_key` where not deleted.
- **`contacts`**: `organisation_id` (nullable for independents), `full_name, name_key, position, categories, phone, email, website, location, service_region, org_contact_role, relationship_owner_id, relationship_status, priority, last_contact_at, next_follow_up_date, notes, source, needs_verification, verified_at, verified_by, external_ids`, soft delete. Unique `(organisation_id, name_key)` and unique `email` where not deleted. **One primary contact per organisation** (partial unique index).
- **`interactions`**: `contact_id, organisation_id, interaction_type, occurred_at, summary, staff_id, next_action, follow_up_date, task_id`, soft delete. Must reference a contact or an organisation.
- **`opportunities`**: `display_number` (identity), `prospect_name, prospect_phone, prospect_email, property_suburb, property_address, stage, stage_changed_at, estimated_annual_value_cents, assigned_to, signed_at, management_reference, lost_reason, notes`, soft delete. Constraints: `stage = 'management_signed'` iff `signed_at` is set; unique `management_reference` where set.
- **`opportunity_stage_history`**: `opportunity_id, from_stage, to_stage, changed_by, changed_at, note`. Written by trigger.
- **`referrals`**: `ref_number` (identity, shown as `REF-0001`), `direction`, `referring_contact_id, referring_organisation_id, receiving_contact_id, receiving_organisation_id, opportunity_id, referral_date, assigned_to, is_attributed, sent_outcome, prospect_name, prospect_phone, prospect_email, property_suburb, property_address, notes`, soft delete. Received: needs an opportunity and a referring contact or organisation. Sent: needs a receiving contact or organisation, no opportunity, and carries its own prospect fields. At most one `is_attributed` referral per opportunity.
- **`tasks`**: `title, description, assigned_to, due_date, priority, status, related_contact_id, related_organisation_id, related_referral_id, related_opportunity_id, source ('manual'|'interaction'|'ai_draft'), completed_at, completed_by`. `completed_at` set iff status is completed. Phase 2 adds `related_contractor_id`.
- **`audit_events`**: `bigint identity, at, actor_id, actor_name, action, entity_type, entity_id, summary, changes jsonb`. Append-only: no update or delete for any role.
- **`import_batches`**: `source, file_name, row_count, organisations_created, contacts_created, duplicates_skipped, flagged, applied_by, applied_at`.

### Views (all `security_invoker = true`, so RLS applies to the reader)

`contact_directory`, `organisation_directory`, `referral_overview` (flattens direction, partner, prospect, stage), `partner_performance` (per organisation: received, sent, qualified, signed, conversion, estimated value of signed, reciprocal flag; **qualified means "ever reached qualified", read from stage history**), `overdue_followups`. Added later: `referral_partner_overview` (0122): one row per live organisation plus one per independent contact (no organisation), with last contacted (contacts and organisation-level interactions), next open follow-up, most advanced status, and referral figures read from `partner_performance` (independents by the same rules, so every referral and signing is counted once).

### Capabilities

`growth.read, growth.write, growth.delete, tasks.read_all, tasks.write, people.read, people.admin, audit.read, import.run, settings.admin`.

| Role | Capabilities |
|---|---|
| director | all |
| administrator | all except `settings.admin`; cannot create or modify a director |
| business_development_manager | growth.read/write, tasks.read_all, tasks.write, people.read, import.run |
| senior_property_manager | growth.read, tasks.read_all, tasks.write, people.read |
| property_manager | growth.read, tasks.write, people.read |
| junior_property_manager | tasks.write, people.read |
| virtual_assistant | growth.read/write, tasks.write, people.read |
| read_only | growth.read, tasks.read_all, people.read |

A task is visible to its assignee, its creator, and anyone with `tasks.read_all`.

## 5. RPC contract (schema `hq`, `security definer`, callable by `authenticated`)

Each RPC pins `search_path`, checks the capability itself, writes an audit event, and revokes `execute` from `public` and `anon`.

| RPC | Purpose |
|---|---|
| `record_interaction(contact, organisation, type, occurred_at, summary, next_action, follow_up_date, create_task, task_assignee, new_status) -> jsonb {interaction_id, task_id}` | One transaction: log it, update `contacts.last_contact_at` and `next_follow_up_date`, optionally create the follow-up task, optionally move the relationship status. |
| `record_referral(direction, referring_contact, referring_organisation, receiving_contact, receiving_organisation, referral_date, prospect_*, property_*, assigned_to, estimated_value_cents, notes, existing_opportunity) -> jsonb {referral_id, opportunity_id}` | Received: creates the opportunity at `introduction_received` and attributes it, or attaches to an existing opportunity as a non-attributed claim. Sent: records the outbound referral. |
| `move_opportunity(opportunity, stage, note, signed_at, management_reference, lost_reason)` | Stage change with history. Signing is idempotent: re-signing changes nothing and counts nothing. Leaving `management_signed` needs a director or administrator. |
| `set_attributed_referral(opportunity, referral)` | Move credit to a different referral for the same opportunity. |
| `archive_record(entity, id, reason)` / `restore_record(entity, id)` | Soft deletion for organisations, contacts, referrals and tasks. |
| `preview_partner_import(rows jsonb) -> jsonb` | Classifies each row: `new_organisation`, `new_contact`, `duplicate`, `possible_duplicate` (same organisation and surname, or same email). Writes nothing. |
| `apply_partner_import(rows jsonb, source, file_name) -> jsonb` | Applies the same classification transactionally, skipping duplicates, recording an `import_batches` row. Requires `import.run`. |
| `global_search(query, limit) -> jsonb` | Contacts, organisations, referrals, tasks (trigram plus prefix). Runs as the caller, so RLS limits results. |
| `growth_summary(since date) -> jsonb` | Counts for the dashboard and Growth overview, computed from real rows. |
| `add_staff(user_id, email, full_name, role, pod, ...)`, `update_staff(...)`, `deactivate_staff(...)` | `people.admin`. Directors only may create or change directors. |
| `my_access() -> jsonb` | `{staff_id, full_name, first_name, role, timezone, mfa_required, aal, capabilities text[]}`, or `null` when the caller is not active staff. **Callable at `aal1`** so the app can tell "must complete MFA" from "no access". `capabilities` is empty unless the session satisfies the MFA requirement. This is the only HQ function that works before MFA. |
| `can(capability) -> boolean` | For the app to decide what to show; the database still enforces. |
| `today() -> date` | Today in the configured timezone. |

## 6. Security checklist (Phase 1 acceptance)

- RLS enabled and forced on every `hq` table; no table is readable by `anon`.
- Every policy carries a scoping predicate; none is a bare role check.
- `truncate` revoked from all API roles; `audit_events` and `opportunity_stage_history` are append-only.
- `hq_private` is not exposed and `usage` is revoked from API roles.
- No secret in client code. `lib/supabase/secret.ts` is imported only by `lib/hq/staff-admin.ts` (allowed in `eslint.config.mjs`).
- Server Actions authenticate with `requireStaff()`, never trust form fields for identity (`created_by` is set by the database), and validate every input on the server.
- Rate limiting on sign-in code requests comes from Supabase Auth (one code per 60 seconds, verification attempt limits) plus Turnstile.
- `/hq` is `noindex`, disallowed in `robots.txt`, and carries `X-Robots-Tag` headers.
- Errors shown to people are generic; details go to the server log without personal data.
- Privacy: AI is not part of Phase 1. When it arrives (Phase 3) it receives only the fields a tool returns, never raw tables.

## 7. Design system

**The source of truth is [docs/brand-design-system.md](brand-design-system.md)** (the official PLANTED. brand system, v1.0), and its tokens are in `app/planted-tokens.css`. Nothing in HQ introduces a colour, radius or typeface that is not in that file.

How the brand system applies to HQ (its section 7):

- **Soft white** (`--planted-white`) application background. **Charcoal** navigation. **Ivory and stone** surfaces. Hairline borders (`--planted-border`).
- **DM Sans** for everything interactive and operational: navigation, tables, forms, task lists, statistics and every figure. **Cormorant Garamond only** for the wordmark, the welcome heading, sign-in and empty-state titles. Never a serif in data.
- **Radius 4px** on buttons and inputs, **6px** on panels and cards. Shadows are very subtle and used only for menus, drawers and the command palette. No floating card grids: separation comes from hairlines and spacing.
- **Buttons:** primary is charcoal with ivory text and a slightly lighter charcoal hover; secondary is transparent with a charcoal border. Small labels are uppercase with increased letter spacing.
- **Clay** is used sparingly: a selected-item marker, a small accent. Never for small text (use `--planted-clay-text`).
- **Status** uses the functional colours defined in the tokens file (the one explicit exception to the neutral palette), always as a dot plus a label, never colour alone.
- **Contrast:** body-size secondary text uses `--planted-grey-text`, not `--planted-grey` (which is 4.4:1 on soft white). On stone, use charcoal. See the implementation notes in the brand system.
- **Mobile:** a purpose-built layout with a bottom tab bar, a floating quick add and contact cards rather than a table, not the desktop shrunk down.

## 8. Phases

1. **Foundation** (this build): schema, auth, shell, dashboard, organisations, contacts, interactions, tasks, referrals, pipeline, import, people, search.
2. **Contractors**: directory, vetting checklist, secure documents, expiry reminders, import of the maintenance prospects.
3. **Ask Planted**: OpenAI via server functions, read-only tools first, then confirmed draft actions. Needs an API key and a decision on data handling.
4. **Insights**: growth dashboard, editable forecast assumptions, pod reporting, knowledge base search.
5. **Integrations**: Ailo, only if a supported, contractual route exists.

## 9. Open decisions (none block Phase 1)

1. **Hosted project and region.** HQ will hold personal information, so the hosted Supabase project should be in Sydney. Create it when you are ready to deploy; nothing here needs it.
2. **Retire the parked Tidewell schema?** It shares the local database harmlessly. A fresh hosted project for HQ alone is the cleaner option.
3. **Domain.** `hq.planted.com.au` needs the domain and a Netlify alias.
4. **OpenAI key and data handling** before Phase 3.
5. **Ailo.** Whether a supported API exists is a question for Ailo, not for code.
