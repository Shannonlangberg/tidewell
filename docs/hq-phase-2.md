# Planted HQ, Phase 2: Contractors

Build contract for Phase 2. It extends [hq-design.md](hq-design.md) (read that first: conventions, security checklist, capability model) and follows the brand rules in [brand-design-system.md](brand-design-system.md). Ailo runs the properties; HQ does not copy work orders, rent or tenancy records. This module holds the **relationships with, and vetting of, maintenance contractors**: who they are, what they cover, whether they are cleared to be sent to a property, and when their paperwork lapses.

Source requirements: master brief sections 10 (contractor management), 11 (initial maintenance partner import), 12 (tasks), 16 (integrity rules).

## 1. Ground rules (non-negotiable)

1. **Nothing is invented.** The 31 researched prospects arrive with a business name, a trade group and a source, and nothing else. No phone, email, ABN, licence, insurance, availability, service area or rate is assumed. Every imported contractor is `prospect` and `needs_verification`.
2. **A contractor is never approved by a document, a checklist or a script.** Only an explicit approval by a person holding `contractors.approve`, through `hq.approve_contractor`, can set `approved` or `preferred`. Uploading or verifying a document never changes status. The database enforces it (a guard trigger), not just the screen.
3. **No overall rating until there is enough feedback.** The rating is computed from recorded reviews, shown only once a contractor has at least `contractor_min_reviews_for_rating` reviews (a `hq.settings` key, default `3`). Below that the screen says "Not enough feedback yet (1 of 3)". Never a placeholder star.
4. **The database decides.** RLS on every new table, capability checks inside every RPC, forged-request tests, audit events, soft delete. Same bar as Phase 1.
5. **No new runtime dependencies** unless unavoidable (state why in the report). Native `<dialog>`, URL-driven tables, `node --test` unit tests (`*.test.mts`), pgTAP.
6. **Documents are private.** Private storage bucket, signed URLs that expire, never a public URL, never in a log line or an AI context. Honest limitation to document: no malware scanning.
7. **Not connected to Ailo.** `external_ids jsonb` exists for later; nothing else.

## 2. Roles and capabilities (a design decision for Courtney and Shannon to confirm)

New capabilities: `contractors.read`, `contractors.write`, `contractors.documents` (upload, view and verify documents), `contractors.approve` (approve, prefer, reinstate).

| Role | Capabilities |
|---|---|
| director | all four |
| administrator | all four |
| senior_property_manager | read, write, documents |
| property_manager | read, write, documents |
| junior_property_manager | read |
| virtual_assistant | read, write, documents |
| business_development_manager | read |
| read_only | read |

A person without `contractors.documents` sees that a document exists (type, expiry, verification status) only if they have `contractors.read`; they cannot open the file. Suspending a contractor needs only `contractors.write` (it is a safety action and must be quick); reinstating needs `contractors.approve`.

## 3. Data model (schema `hq`, migrations `0112` onward)

Same conventions as Phase 1 (uuid keys, `created_at/by`, `updated_at`, soft delete via `deleted_at/by`, cents for money, `hq.today()`, audit triggers, RLS forced).

### Enums

- `hq.contractor_category`: `plumbing, electrical, general_maintenance, handyman, carpentry, cleaning, carpet_cleaning, gardening, landscaping, pest_control, locksmith, painting, roofing, guttering, air_conditioning, appliance_repairs, garage_doors, glazing, tree_services, building, emergency_restoration, other`
- `hq.contractor_status`: `prospect, contacted, vetting, approved, preferred, suspended, inactive`
- `hq.vetting_step`: `identity, abn, licence, insurance, service_areas, pricing, emergency_availability, communication, review_and_approve` (the nine steps, in this order)
- `hq.vetting_step_status`: `not_started, in_progress, done, not_applicable` (`not_applicable` requires a note: for example a trade with no licence requirement)
- `hq.contractor_document_type`: `licence, public_liability_insurance, workers_compensation, professional_indemnity, abn_confirmation, price_list, agreement, other`
- `hq.document_verification`: `pending, verified, rejected` (`rejected` requires a note)
- `hq.tenant_feedback`: `positive, neutral, negative, none_received`

### Tables

- **`contractors`**: `business_name`, `name_key` (generated from `hq.normalise_name`), `primary_contact_name`, `phone`, `email citext`, `website`, `abn` (11 digits, stored without spaces, **checksum-validated**; the ATO modulus-89 rule), `categories hq.contractor_category[]` (at least one), `service_suburbs text[]`, `service_regions text[]`, `emergency_available boolean` (**null means unknown**, never default false), `business_hours text`, `hourly_rate_cents`, `callout_fee_cents`, `after_hours_fee_cents`, `minimum_charge_cents` (all nullable: unknown is not zero), `invoice_terms text`, `licence_details text`, `licence_verified_at date`, `licence_expires_on date`, `insurance_details text`, `insurance_verified_at date`, `insurance_expires_on date`, `status` (default `prospect`), `status_reason text`, `approved_at`, `approved_by` (set only by `approve_contractor`), `relationship_owner_id`, `internal_notes text`, `last_job_date date`, `source`, `needs_verification boolean`, `verified_at`, `verified_by`, `external_ids jsonb`, soft delete. Unique `name_key` and unique `abn` where not deleted. Money columns are non-negative. No stored rating.
- **`contractor_vetting_steps`**: `(contractor_id, step)` primary key, `status`, `note`, `completed_by`, `completed_at`, `updated_at`. A trigger creates the nine rows (`not_started`) when a contractor is created; a backfill is not needed (the table is new). `completed_at/by` set iff status is `done` or `not_applicable`.
- **`contractor_documents`**: `contractor_id`, `document_type`, `file_name`, `storage_path` (unique), `mime_type`, `size_bytes`, `uploaded_by`, `uploaded_at`, `verification` (default `pending`), `verified_by`, `verified_at`, `verification_note`, `expires_on date`, `notes`, soft delete. Verified fields set only by `verify_contractor_document`.
- **`contractor_reviews`**: `contractor_id` (must exist: foreign key), `job_date date`, `job_reference text` (free text the staff member types; HQ never reads Ailo), `response_time smallint 1..5`, `communication 1..5`, `work_quality 1..5`, `invoice_accuracy 1..5`, `tenant_feedback hq.tenant_feedback`, `rework_required boolean`, `notes`, `recorded_by`, soft delete. Each rating is nullable (rate what you know); at least one rating or a note is required.
- **`contractor_status_history`**: `contractor_id, from_status, to_status, changed_by, changed_at, note`. Written by trigger, append-only (mirrors `opportunity_stage_history`).
- **Changes to Phase 1 tables:** `tasks.related_contractor_id` (nullable fk); `interactions.contractor_id` (nullable fk) and the existing "must reference a contact or an organisation" check widened to include a contractor; `tasks.source` unchanged.
- **Settings:** `hq.settings` key `contractor_min_reviews_for_rating = 3`, `contractor_expiry_warning_days = 30`.

### Status rules (guard trigger plus RPCs)

- Direct table updates may move `status` only between `prospect`, `contacted`, `vetting`, `suspended`, `inactive`. Any write that sets `approved` or `preferred`, or moves a contractor out of `suspended` to a cleared state, is rejected unless it comes through `approve_contractor` / `reinstate_contractor`.
- `approve_contractor(contractor, make_preferred boolean, note text)` needs `contractors.approve`, and refuses unless steps 1 to 8 are `done` or `not_applicable`. It completes step 9 (`review_and_approve`), sets `approved_at/by`, writes history and audit. It does **not** require a document, but the response must include warnings the screen shows before the person confirms: no verified insurance on file, insurance or licence expired or expiring within the warning window, no service suburbs, and rates unknown. Warnings inform; they never silently block or silently pass.
- `set_contractor_status(contractor, status, note)` handles the other moves with the rules above (`suspended` needs a note).
- `reinstate_contractor(contractor, note)` needs `contractors.approve`; returns a suspended contractor to `vetting`, never directly to `approved`.
- Expiry never changes status by itself. An `approved` contractor whose insurance has expired is flagged loudly (directory, profile, dashboard) but stays `approved` until a person decides.

## 4. Views (all `security_invoker = true`)

- **`contractor_directory`**: one row per live contractor with the fields the table needs, plus derived `insurance_state` and `licence_state` (`not_recorded`, `unverified`, `current`, `expiring_soon`, `expired`: *current* needs a verified date and an expiry in the future beyond the warning window; no expiry date recorded means `unverified` or `not_recorded`, never `current`), `vetting_done_count` (0 to 9), `review_count`, `rating` (**null unless `review_count >= contractor_min_reviews_for_rating`**), `open_task_count`, `last_contacted_at`.
- **`contractor_expiry_watch`**: one row per licence, insurance and document expiry that is expired or within the warning window (kind, contractor, document id if any, expires_on, days_remaining, state), live contractors only, excluding `inactive`.
- **`contractor_timeline`**: union of status history, vetting step completions, document uploads/verifications, reviews and logged contacts for a contractor, newest first. Built from the underlying tables so each reader's RLS applies (do **not** read `audit_events`, which needs `audit.read`).

## 5. RPCs (security definer, pinned `search_path`, capability check inside, audit event, `execute` revoked from `public` and `anon`)

| RPC | Purpose |
|---|---|
| `create_contractor(...)` / direct insert under RLS | Creates a `prospect` with the nine vetting rows. (Builder's choice, but status can never be set above `vetting` at creation.) |
| `set_vetting_step(contractor, step, status, note)` | `contractors.write`. Idempotent. `not_applicable` needs a note. |
| `approve_contractor(contractor, make_preferred, note) -> jsonb {status, warnings[]}` | See section 3. `contractors.approve`. |
| `set_contractor_status(contractor, status, note)`, `reinstate_contractor(contractor, note)` | See section 3. |
| `add_contractor_document(contractor, type, file_name, storage_path, mime, size, expires_on, notes)` | `contractors.documents`. Verifies the object exists in the private bucket under `<contractor_id>/` and that size and type match what was declared. |
| `verify_contractor_document(document, verification, expires_on, note, apply_to_contractor boolean)` | `contractors.documents`. Sets verified by/date. When verified and `apply_to_contractor`, records `licence_verified_at/expires_on` or `insurance_verified_at/expires_on` on the contractor (explicit, audited, never touches status). |
| `record_contractor_review(...)` | `contractors.write`. |
| `record_contractor_contact(contractor, type, occurred_at, summary, next_action, follow_up_date, create_task, task_assignee, new_status)` | Logs a call/meeting/email in `interactions` (with `contractor_id`), optionally creates the follow-up task (`related_contractor_id`), optionally moves `prospect` to `contacted` (never above). |
| `contractor_summary() -> jsonb` | Counts by status, awaiting vetting (`vetting` status plus `contacted` with steps in progress), expiring/expired counts, **preferred coverage** (per trade: number of `approved` + `preferred`; list the trades with none). |
| `create_expiry_tasks() -> jsonb` | Idempotent: for each row in `contractor_expiry_watch` with no open task for the same contractor and item, creates one task (assignee = relationship owner, else caller). Returns how many it created and how many it skipped. This is the reminder mechanism (see section 8). |
| `preview_contractor_import(rows)` / `apply_contractor_import(rows, source, file_name)` | Same pattern as the partner import: classify, never write on preview, transactional apply, idempotent, `import_batches` row. Needs a new capability or reuse `import.run` **and** `contractors.write`. Classification: `new_contractor`, `duplicate` (same `name_key`), `possible_duplicate` (same ABN, email or phone, or very similar name via trigram), with an explicit `confirm_distinct` override as in Phase 1. |
| `global_search` (extend) | Include contractors (business name, primary contact, trade labels, suburbs) for callers with `contractors.read`. |

## 6. Storage

Private bucket `contractor-documents`, created **by migration** (not `config.toml` only), with `file_size_limit` 10 MiB and `allowed_mime_types` `application/pdf, image/jpeg, image/png`. Object path: `<contractor_id>/<document uuid>-<sanitised file name>`. `storage.objects` policies: authenticated staff with `contractors.documents` may select and insert under that bucket; nobody may update or delete through the API (archiving a document is a soft delete of the row, the object is retained). No policy for `anon`.

**Upload flow (does not push file bytes through a Server Action or the Netlify function, which has a request-size limit of about 6 MB):**
1. A Server Action `prepareDocumentUpload` runs `requireStaff("contractors.documents")`, validates name, type and size, and returns a signed upload URL and token created with the caller's own session.
2. The browser uploads directly to Supabase Storage with the token.
3. A Server Action `registerDocument` calls `add_contractor_document`, which re-checks the stored object.
Download: a Server Action or route handler checks the row under RLS, then returns a signed URL valid for 60 seconds. Never expose storage paths as public URLs.

## 7. Screens

All routes under `/hq/partners` (the Partners module; remove the "Phase 2" badge and the planned landing).

- **Directory** `/hq/partners`: URL-driven table (desktop) and cards (mobile). Search; filters for trade, suburb, service region, status, preferred, emergency availability, insurance state, licence state; chips for "Awaiting vetting", "Expiring soon", "Preferred". Columns: business, trades, service areas (first few plus "+n"), status, vetting progress ("5 of 9"), insurance state, licence state, relationship owner, rating (or "Not enough feedback yet"). The example from the brief must work: approved plumbers who service Moonta.
- **Profile** `/hq/partners/[id]`: header with status chip, "Needs verifying" chip, and the action row (Log contact, Create follow-up task, Record job feedback, Edit, Archive, Approve or Suspend per capability). Sections: details and rates (unknowns say "Not recorded"), service areas, **vetting checklist** (nine interactive steps with status, note, who and when), **documents** (upload, list, verify, expiry badge, open), **performance** (feedback list; summary only when enough), tasks, timeline.
- **Approve flow**: a dialog that lists the checklist state and the warnings from `approve_contractor`, asks for a note, and states plainly that the person is approving. Preferred is a second explicit choice.
- **New / edit** `/hq/partners/new`, `/hq/partners/[id]/edit`: ABN checksum feedback in plain language, money fields in dollars on screen and cents in storage, categories multi-select.
- **Import** `/hq/partners/import`: same review-before-save pattern as `/hq/growth/import`, with "Load the maintenance prospects file". The seed file is `hq/seed/maintenance-contractors.json` (and `.csv`), 31 rows from the master brief section 11.
- **Dashboard** (replace the "planned" placeholders for contractor widgets): *Contractors awaiting vetting*, *Expiring contractor documents* (with "Create reminder tasks"), *Preferred contractor coverage* (trades with no approved contractor are named), *Recent contractor activity* (from `contractor_timeline`). Respect widget visibility by capability and the existing customise panel.
- **Tasks**: related contractor picker and chip; "Create follow-up task" from the contractor profile.
- **Search / Cmd+K**: contractors in results with a trade label.
- Brand rules apply (docs/brand-design-system.md): DM Sans in data, Cormorant only in the empty-state titles, status as dot plus label, 4/6 px radii, no card grids.

## 8. Reminders: what exists and what does not

Reminders are: (a) the expiry watch list and dashboard widget, always live; (b) `create_expiry_tasks`, which turns expiries into tasks on demand, idempotently. **Not built:** scheduled emails or SMS. State this plainly in the UI copy where reminders are mentioned and in `docs/hq-setup.md`. A scheduled job can be added later (it needs a service identity and an email sender).

## 9. The initial import (the 31 prospects)

Exactly the names in master brief section 11, grouped as given. Categories are taken **only from the group heading** (Plumbing, Electrical, General Maintenance, Cleaning, Pest Control, Locksmith). The seven names listed under "Other" get category `other`: do not infer a trade from a business name. Every row: `status = prospect`, `needs_verification = true`, `source = 'research-maintenance-2026-10'`, no other fields. The names are: Copper Coast Plumbing; Peninsula Plumbing SA; Bennett & Co Industries; Dean Trevor Todd; Moonta Plumbing; Mildwaters Electrical; Electrical NRG Solutions; Lamshed Electrical; Baden Napier Electrical & Solar; AH Electrical & Solar; BradZ Electrical; WJC Electrical; Copper Coast Property Maintenance; Challenge Garden & Home Maintenance; Bungendore Handyman Service; Copper Coast Garden Care; TC Constructions; Northern York Peninsula Cleaning; Hamiltons Pest & Weed Control; Laidlaw Pest Control; SMS Eco Pest Management; Murray Pest Control Yorke Peninsula; Yorke Peninsula Locksmiths; Leaney The Locksmith; YP Energy Solutions; Kadina Retravision; Inside and Out Painting; Yorkes Home Improvements; Peninsula Tree and Stump; Copper Coast Garage Doors; Roof Replacement and Gutters SA.

"Dean Trevor Todd" reads like a person rather than a business; import it as listed and flag it in the seed file's notes for review.

## 10. Acceptance (Phase 2 is done when all of these are shown, not claimed)

- Migrations apply from scratch on the HQ-only database; the whole pgTAP suite passes (Phase 1's 594 plus the new tests).
- Database tests prove: a read-only and a junior caller cannot write; a caller without `contractors.documents` cannot read document rows' files; **no path sets `approved`/`preferred` except `approve_contractor`** (direct update, insert with that status, document verification, step completion, import: all refused); approval is refused with an incomplete checklist; a suspended contractor cannot go straight to approved; rating is null below the threshold and present at it; expiry states are correct on the boundary days; `create_expiry_tasks` twice creates nothing the second time; import preview writes nothing, apply is idempotent, and a duplicate name is skipped; ABN checksum accepts a known valid ABN and rejects a one-digit change; the storage bucket is private and `anon` can do nothing.
- Forged Server Action requests (wrong role, wrong id, other capability) are refused by the action and by the database.
- Unit tests for formatting, ABN validation, expiry state helpers, import row parsing, and form parsing.
- `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build` all pass.
- Screens checked at 375, 768 and 1280 widths against the brand system, with real screenshots viewed.
- `docs/hq-setup.md` updated: what Phase 2 adds, the roles table, the storage setup, the limitations (no virus scanning, no scheduled reminders, ABN checksum only and not looked up against the ABR, documents archived not erased).

## 11. As built (database)

This section is the exact contract the UI codes against, together with `lib/hq/database.types.ts` (regenerated with `supabase gen types typescript --local --schema hq`). Migrations `0112` to `0118`; tests `supabase/tests/hq_05_contractors_*.sql` (with `hq_contractor_fixture.inc`).

### 11.1 Capabilities and settings

- Capabilities: `contractors.read`, `contractors.write`, `contractors.documents`, `contractors.approve`, seeded exactly per the section 2 matrix (20 rows). `hq.my_access().capabilities` and `hq.can()` now include them. `lib/hq/constants.ts` `CAPABILITIES` does not list them yet (UI work).
- Settings (`hq.settings`, whole JSON numbers, validated by the settings trigger): `contractor_min_reviews_for_rating` = `3` (1 to 100), `contractor_expiry_warning_days` = `30` (1 to 365).

### 11.2 Enums (exact, in order)

| Enum | Values |
|---|---|
| `hq.contractor_category` | `plumbing, electrical, general_maintenance, handyman, carpentry, cleaning, carpet_cleaning, gardening, landscaping, pest_control, locksmith, painting, roofing, guttering, air_conditioning, appliance_repairs, garage_doors, glazing, tree_services, building, emergency_restoration, other` |
| `hq.contractor_status` | `prospect, contacted, vetting, approved, preferred, suspended, inactive` |
| `hq.vetting_step` | `identity, abn, licence, insurance, service_areas, pricing, emergency_availability, communication, review_and_approve` |
| `hq.vetting_step_status` | `not_started, in_progress, done, not_applicable` |
| `hq.contractor_document_type` | `licence, public_liability_insurance, workers_compensation, professional_indemnity, abn_confirmation, price_list, agreement, other` |
| `hq.document_verification` | `pending, verified, rejected` |
| `hq.tenant_feedback` | `positive, neutral, negative, none_received` |

Interactions with contractors reuse `hq.interaction_type` (`phone_call, coffee_meeting, office_meeting, email, message, note`).

### 11.3 Tables and what the API may write

| Table | Columns (bookkeeping: `created_at, updated_at, created_by, deleted_at, deleted_by` where noted) | API writes (role `authenticated`) |
|---|---|---|
| `contractors` | as section 3, plus bookkeeping. `service_suburbs` / `service_regions` are `text[] not null default '{}'`. | **Direct insert and update** (RLS: `contractors.write`; update only of live rows) of exactly these columns: `business_name, primary_contact_name, phone, email, website, abn, categories, service_suburbs, service_regions, emergency_available, business_hours, hourly_rate_cents, callout_fee_cents, after_hours_fee_cents, minimum_charge_cents, invoice_terms, licence_details, licence_expires_on, insurance_details, insurance_expires_on, status, status_reason, relationship_owner_id, internal_notes, last_job_date, source, needs_verification`. Naming any other column (`id`, `approved_*`, `*_verified_at`, `verified_*`, `external_ids`, `deleted_*`) is refused with 42501. |
| `contractor_vetting_steps` | `contractor_id, step, status, note, completed_by, completed_at, updated_at` (no bookkeeping) | none (use `set_vetting_step`) |
| `contractor_documents` | `id, contractor_id, document_type, file_name, storage_path, mime_type, size_bytes, uploaded_by, uploaded_at, verification, verified_by, verified_at, verification_note, expires_on, notes` + bookkeeping | update of `notes` only (`contractors.documents`) |
| `contractor_reviews` | `id, contractor_id, job_date, job_reference, response_time, communication, work_quality, invoice_accuracy, tenant_feedback, rework_required, notes, recorded_by` + bookkeeping (ratings `smallint` 1..5) | update of `job_date, job_reference, response_time, communication, work_quality, invoice_accuracy, tenant_feedback, rework_required, notes` by the recorder (or `contractors.approve`) |
| `contractor_status_history` | `id bigint, contractor_id, from_status, to_status, changed_by, changed_at, note` | none (append-only, written by trigger) |
| `tasks` (Phase 1) | adds `related_contractor_id uuid`, `reminder_key text` | `related_contractor_id` writable as any task column. `reminder_key` is ignored on direct writes (kept by the database). |
| `interactions` (Phase 1) | adds `contractor_id uuid` | unchanged column grants. A contractor interaction names the contractor ONLY (`interactions_contractor_alone`). |
| `import_batches` (Phase 1) | adds `kind text` (`partner` / `contractor`), `contractors_created integer` | none |

On write the database: strips whitespace from `abn` (so `51 824 753 556` is stored `51824753556`; any other punctuation fails the checksum); trims `service_suburbs` / `service_regions`, collapses inner spaces, drops blanks and case-insensitive repeats (first spelling kept); stamps `created_by`, `updated_at`, `verified_at/by` (clearing `needs_verification`), `deleted_by`, `completed_at/by` (steps), `uploaded_by/at` (documents), `recorded_by` (reviews). Editing `licence_expires_on` or `insurance_expires_on` directly CLEARS the matching `*_verified_at` (a verification attests to the date it saw).

Read access (RLS): every contractor table needs `contractors.read`; archived contractors and archived reviews are visible only to `contractors.approve`; archived documents only to `contractors.documents`; vetting steps, documents, reviews and history only for a contractor the reader can see. Contractor interactions are read with `contractors.read` (partner interactions still need `growth.read`).

Constraint names the UI should map to plain language (SQLSTATE in brackets):

| Constraint / index | When |
|---|---|
| `contractors_abn_valid` (23514) | ABN is not 11 digits starting 1-9 that pass the ATO modulus-89 checksum |
| `contractors_abn_uq` (23505) | another live contractor has that ABN |
| `contractors_name_key_uq` (23505) | another live contractor has the same name key (`The X Pty Ltd` = `x`) |
| `contractors_categories_not_empty` (23514) | no category |
| `contractors_email_shape` (23514) | email is not `a@b` shaped |
| `contractors_rates_not_negative` (23514) | a negative money value |
| `contractors_suspended_needs_reason` (23514) | status `suspended` without a `status_reason` |
| `contractors_business_name_not_blank` (23514) | blank name |

### 11.4 Status rules as enforced (trigger `hq_private.contractor_guard`, every writer including the table owner)

- Insert: status must be `prospect`, `contacted` or `vetting` (else 42501).
- `approved` / `preferred` are entered ONLY inside `approve_contractor` (else 42501 `only hq.approve_contractor can make a contractor approved`).
- Leaving `suspended` is possible ONLY inside `reinstate_contractor`, and only to `vetting` (else 42501). This includes `suspended -> inactive`: there is no side door.
- A direct (API) update may move status among `prospect, contacted, vetting, suspended (with status_reason), inactive`; it may NOT move a contractor out of `approved` / `preferred` (42501: use `set_contractor_status`). A direct status change that does not restate `status_reason` clears it.
- `approved_at` / `approved_by` exist exactly while status is `approved` / `preferred` (constraint `contractors_approval_iff_cleared`); they are cleared when the contractor leaves, and any other attempt to change them is silently ignored.
- Leaving `approved` / `preferred` resets step `review_and_approve` to `not_started`. Step `review_and_approve` leaves `not_started` only inside `approve_contractor`.
- Every creation and status change writes `contractor_status_history` (note = the RPC note, else `status_reason`) and an audit row: action `create`, `status_change`, or the RPC's action (`approve`, `prefer`, `suspend`, `reinstate`).
- Expiry never changes status.

Recommendation for the UI: change status only through the RPCs (`set_contractor_status`, `approve_contractor`, `reinstate_contractor`, `record_contractor_contact`); never by a direct update.

### 11.5 RPCs (schema `hq`; all `security definer`, `search_path` pinned, execute for `authenticated` only)

Errors: `42501` permission denied (capability, or a guarded transition), `22023` invalid argument, `P0002` not found, `23505` already exists, `23514` a rule refuses it. The message text is safe to show; RPC messages are plain English.

**`set_vetting_step(p_contractor uuid, p_step hq.vetting_step, p_status hq.vetting_step_status, p_note text default null) -> jsonb`** — `contractors.write`. Sets status and note to exactly what is given (a null or blank note CLEARS the note). Idempotent (same status and note: `changed: false`). `not_applicable` needs a note (22023). `p_step = 'review_and_approve'` is refused (22023). Never changes the contractor's status.
Returns `{contractor_id, step, status, note, completed_at, completed_by, changed, vetting_done_count}`.

**`preview_contractor_approval(p_contractor uuid) -> jsonb`** (added; see deviations) — `contractors.read`. Writes nothing.
Returns `{contractor_id, status, can_approve boolean, blocked_by: text[], missing_steps: text[], warnings: Warning[]}`; `blocked_by` values: `not_permitted` (caller lacks `contractors.approve`), `suspended`, `inactive`, `checklist_incomplete`. `missing_steps` lists steps 1 to 8 that are neither `done` nor `not_applicable`, in checklist order.

**`approve_contractor(p_contractor uuid, p_make_preferred boolean default false, p_note text default null) -> jsonb`** — `contractors.approve`. Refused: suspended (23514), inactive (23514), blank note (22023), checklist incomplete (23514 `the vetting checklist is not complete`, `detail` = `not done: abn, insurance, ...`). `p_make_preferred` true sets `preferred`, false sets `approved` (so it also moves `preferred` back to `approved`). Same status as now: nothing changes (`changed: false`). Completes `review_and_approve` (note = the approval note), stamps `approved_at/by`.
Returns `{contractor_id, status, previous_status, changed, warnings: Warning[]}`.

`Warning` = `{code, message}` plus `expires_on` (date) and `days_remaining` (integer) for the expiry codes. Codes, in this order when present:

| code | when |
|---|---|
| `insurance_not_verified` | no verified insurance on file: neither the contractor's insurance (`insurance_verified_at` set and `insurance_expires_on >= today`) nor a live `verified` `public_liability_insurance` document with `expires_on >= today` |
| `insurance_expired` / `insurance_expiring_soon` | the contractor's `insurance_state` |
| `licence_expired` / `licence_expiring_soon` | the contractor's `licence_state` |
| `no_service_suburbs` | `service_suburbs` is empty |
| `rates_unknown` | all four money fields are null |

**`set_contractor_status(p_contractor uuid, p_status hq.contractor_status, p_note text default null) -> jsonb`** — `contractors.write`. Target `approved` / `preferred` refused (42501). From `suspended` refused (42501). `suspended` needs a note (22023). The note becomes `status_reason` (null clears it). Same status: `changed: false`.
Returns `{contractor_id, status, previous_status, changed}`.

**`reinstate_contractor(p_contractor uuid, p_note text default null) -> jsonb`** — `contractors.approve`. Only from `suspended` (else 22023); always to `vetting`. The note becomes `status_reason`.
Returns `{contractor_id, status: "vetting", previous_status: "suspended", changed: true}`.

**`add_contractor_document(p_contractor uuid, p_document_type hq.contractor_document_type, p_file_name text, p_storage_path text, p_mime_type text, p_size_bytes bigint, p_expires_on date default null, p_notes text default null) -> jsonb`** — `contractors.documents`. Checks: `p_file_name` 1..255 chars; `p_mime_type` in `application/pdf, image/jpeg, image/png`; `0 < p_size_bytes <= 10485760`; `p_storage_path` matches `^<p_contractor>/<uuid>-[A-Za-z0-9._-]{1,120}$` (lower-case uuids); not already registered (23505); the object exists in bucket `contractor-documents` (P0002 `the uploaded file was not found in storage`); its stored `metadata.size` equals `p_size_bytes` and its stored `metadata.mimetype` equals `p_mime_type` (22023). The uuid in the path becomes the document id. New documents are `pending`.
Returns `{document_id, contractor_id, storage_path, verification: "pending"}`.

**`verify_contractor_document(p_document uuid, p_verification hq.document_verification, p_expires_on date default null, p_note text default null, p_apply_to_contractor boolean default false) -> jsonb`** — `contractors.documents`. `verified` or `rejected` stamps `verified_by/at` (the reviewer, also for a rejection); `pending` clears them. `rejected` needs a note. A non-null `p_expires_on` records the document's expiry (null leaves it). `p_apply_to_contractor` is allowed only with `verified` and a `licence` or `public_liability_insurance` document (22023 otherwise) and sets `licence_verified_at = hq.today(), licence_expires_on = <document expires_on>` (or the `insurance_*` pair). Never changes status. Unchanged verification, note and date: the document is not rewritten (`changed: false`); the apply still happens if asked.
Returns `{document_id, contractor_id, verification, expires_on, changed, applied_to_contractor}`.

**`record_contractor_review(p_contractor uuid, p_job_date date default null, p_job_reference text default null, p_response_time integer default null, p_communication integer default null, p_work_quality integer default null, p_invoice_accuracy integer default null, p_tenant_feedback hq.tenant_feedback default null, p_rework_required boolean default null, p_notes text default null) -> jsonb`** — `contractors.write`. Ratings 1..5 or null (22023); at least one rating or a non-blank note (22023); `p_job_date <= hq.today()` (22023). A job date later than `last_job_date` moves it forward.
Returns `{review_id, contractor_id}`.

**`record_contractor_contact(p_contractor uuid, p_type hq.interaction_type default null, p_occurred_at timestamptz default null, p_summary text default null, p_next_action text default null, p_follow_up_date date default null, p_create_task boolean default false, p_task_assignee uuid default null, p_new_status hq.contractor_status default null) -> jsonb`** — `contractors.write` (+ `tasks.write` when `p_create_task`; the assignee must be active staff, default the caller). Type and summary required; `p_occurred_at` defaults to now and may not be more than an hour ahead. `p_new_status` may be only null or `contacted` (22023 otherwise) and moves ONLY a `prospect` to `contacted`. The task: title = `p_next_action` or `Follow up with <business name>`, due `p_follow_up_date`, `related_contractor_id`, `source = 'interaction'`.
Returns `{interaction_id, task_id (null if none), contractor_id, status, status_changed}`.

**`contractor_summary() -> jsonb`** — `contractors.read`. Live contractors only.
Returns `{as_of: date, warning_days: int, total: int, by_status: {prospect, contacted, vetting, approved, preferred, suspended, inactive: int}, awaiting_vetting: int, expiring_soon: int, expired: int, contractors_with_expired_items: int, cleared_with_expired_items: int, preferred_coverage: [{category, approved, preferred, total}] (all 22 categories, enum order), trades_without_cover: text[]}`. `awaiting_vetting` = status `vetting` + status `contacted` with any of steps 1-8 past `not_started`. `expiring_soon` / `expired` count rows of `contractor_expiry_watch`. `cleared_with_expired_items` = approved/preferred contractors with an expired item (flag loudly). `trades_without_cover` = categories with `total = 0`, never `other`.

**`create_expiry_tasks() -> jsonb`** — `contractors.write` and `tasks.write`. One task per `contractor_expiry_watch` row that has no OPEN task (status not completed/cancelled, not archived) with the same `reminder_key` = `contractor-expiry:<contractor id>:<item_key>`. Assignee: the relationship owner if active staff, else the caller. Title `Licence|Insurance|<Document type> document expired|expires <D Mon YYYY>: <business name>`; due = expiry date, or today if expired; priority `high` if expired, `normal` if expiring soon; `source = 'manual'`; `related_contractor_id` set. Idempotent, also under concurrency. Writes one audit row (`expiry_tasks`) when it created anything.
Returns `{created: int, skipped: int, items: int, task_ids: uuid[]}`.

**`preview_contractor_import(p_rows jsonb) -> jsonb`** and **`apply_contractor_import(p_rows jsonb, p_source text, p_file_name text default null) -> jsonb`** — both `import.run` AND `contractors.write` (directors and administrators). Row: `{business_name (required, <=200), categories (required, non-empty, contractor_category values), primary_contact_name?, phone?, email?, website?, abn?, service_suburbs?: text[], service_regions?: text[], notes?, flags?: text[], confirm_distinct?: boolean, status?: "prospect" only, needs_verification?: true only}`; other keys are ignored. At most 5000 rows. Classification (in order, against live contractors and earlier rows of the same file): `invalid` | `duplicate` (same name key; skipped) | `possible_duplicate` (same ABN, same email (any case), same phone (digits, `+61` read as `0`, 8+ digits), or `similarity(name_key) >= 0.65`; skipped unless `confirm_distinct`) | `new_contractor`. Apply refuses the whole file if any row is invalid (22023, `detail` lists them), runs in one transaction, creates `status = prospect`, `needs_verification = true`, `source = p_source`, only the supplied fields; `notes` and each flag (`Verify: <flag>`) go to `internal_notes`; records `import_batches` (`kind = 'contractor'`) and an `import` audit row.
Both return `{dry_run: boolean, batch_id?: uuid (apply only), counts: {rows, new_contractor, duplicate, possible_duplicate, invalid, contractors_created, skipped, flagged}, rows: [{row, business_name, classification, action: "create"|"skip", reason, match_contractor_id, match_row, flagged}]}`.

**`global_search(p_query text, p_limit integer default 8) -> jsonb`** (extended, still security invoker). Now ALWAYS returns `{contacts, organisations, referrals, tasks, contractors}`. A contractor hit: `{id, title (= business_name), business_name, status, categories, primary_contact_name, subtitle}` where `subtitle` = `<categories with _ as space> - <first three suburbs>[ +n] - <status>` (empty parts dropped). Matches business name (substring or trigram), primary contact, trade label (`pest` finds `pest_control`) and service suburb. Ranking: prefix matches first, then similarity. `lib/hq/search.ts` / `SearchResults` do not read `contractors` yet (UI work).

**`archive_record(p_entity text, p_id uuid, p_reason text default null)` / `restore_record(p_entity text, p_id uuid)`** (extended): new entities `contractor` (`contractors.approve`), `contractor_document` (`contractors.documents`; the stored file is kept), `contractor_review` (archive: the recorder with `contractors.write`, or `contractors.approve`; restore: `contractors.approve`). Phase 1 entities unchanged.

### 11.6 Views (all `security_invoker`; none reads `audit_events`)

Derived state values: `not_recorded | unverified | current | expiring_soon | expired` with `days = expires_on - hq.today()`: `days < 0` expired; `0 <= days <= W` expiring_soon (W = `contractor_expiry_warning_days`; the expiry date itself is still valid); `days > W` current only when verified, else unverified; no expiry date: `unverified` if details or a verified date exist, else `not_recorded` (never current). The generated types show these as `string`; narrow them in the UI.

**`contractor_directory`** (live contractors): `id, business_name, primary_contact_name, phone, email, website, abn, categories, service_suburbs, service_suburb_keys (lower-case), service_regions, service_region_keys (lower-case), emergency_available, business_hours, hourly_rate_cents, callout_fee_cents, after_hours_fee_cents, minimum_charge_cents, invoice_terms, licence_details, licence_verified_at, licence_expires_on, licence_state, licence_days_remaining, insurance_details, insurance_verified_at, insurance_expires_on, insurance_state, insurance_days_remaining, status, status_reason, approved_at, approved_by, approved_by_name, relationship_owner_id, relationship_owner_name, internal_notes, last_job_date, source, needs_verification, verified_at, created_at, updated_at, vetting_done_count (0-9), review_count, rated_review_count, rating_threshold, rating, rating_response_time, rating_communication, rating_work_quality, rating_invoice_accuracy, document_count, open_task_count, last_contacted_at`.
`rating` (numeric, 1 decimal) is null unless `rated_review_count >= rating_threshold`; a review's score is the mean of the ratings it carries and `rating` is the mean of those scores; `rating_*` are per-dimension means under the same gate. Notes-only feedback counts in `review_count` but not in `rated_review_count`: show "Not enough feedback yet (`rated_review_count` of `rating_threshold`)". `open_task_count` counts open related tasks THE READER CAN SEE. `last_contacted_at` = latest contractor interaction. Example (the brief): approved plumbers who service Moonta = `status in (approved, preferred)`, `categories cs {plumbing}`, `service_suburb_keys cs {moonta}`.

**`contractor_expiry_watch`**: `contractor_id, business_name, contractor_status, relationship_owner_id, relationship_owner_name, kind ('licence'|'insurance'|'document'), item_key ('licence'|'insurance'|'document:<id>'), document_id, document_type, file_name, expires_on, days_remaining, state ('expired'|'expiring_soon'), verified`. Live contractors that are not `inactive`. Documents: live, not `rejected`, with an expiry date, and not superseded (a newer live non-rejected document of the same type, other than `other`, expiring later hides the older one). A licence or insurance recorded on the contractor AND as a document appears twice (one row each).

**`contractor_timeline`** (newest first; still add `order=occurred_at.desc`): `event_key (unique), contractor_id, business_name, kind, occurred_at, actor_id, actor_name, summary, detail, entity_id, from_status, to_status, step, step_status, document_type, interaction_type`. `kind`: `status_change` (from history; `from_status` null = creation), `vetting_step` (current completion of a done / not_applicable step), `document_uploaded`, `document_verified`, `document_rejected` (`entity_id` = document), `review` (`entity_id` = review), `contact` (`entity_id` = interaction). `summary` is a plain-English one-liner built in SQL; `detail` is the note, verification note, review notes or contact summary.

### 11.7 Storage (verified end to end against the local Storage API)

Bucket `contractor-documents`, created by migration 0114: private, `file_size_limit` 10485760, `allowed_mime_types` `application/pdf, image/jpeg, image/png`. `storage.objects` policies `hq_contractor_documents_select` / `hq_contractor_documents_insert`, both `to authenticated`, both requiring `contractors.documents`, a name matching `<contractor uuid>/<uuid>-[A-Za-z0-9._-]{1,120}` and a contractor the caller can see (insert: a live one). No update or delete policy; nothing for anon.

The flow, as run locally with supabase-js under each person's own session:
1. Path: `${contractorId}/${crypto.randomUUID()}-${sanitised}` where `sanitised` is 1-120 of `A-Za-z0-9._-` (lower-case uuids).
2. `storage.from('contractor-documents').createSignedUploadUrl(path)` with the CALLER's session (a person without `contractors.documents` is refused: RLS).
3. Browser: `uploadToSignedUrl(path, token, file, { contentType: file.type })`. Do NOT use `upsert` (refused: no update policy). The bucket refuses other types and files over 10 MiB. The stored object's `owner` is the person who created the signed URL; `metadata.size` and `metadata.mimetype` are set by Storage.
4. `rpc('add_contractor_document', {..., p_storage_path: path, p_mime_type: file.type, p_size_bytes: file.size})`.
5. Download: check the row (RLS), then `createSignedUrl(path, 60)` with the caller's session. Without `contractors.documents` Storage answers "Object not found". The public URL returns 400.
6. `remove()` returns `[]` and deletes nothing: archive with `archive_record('contractor_document', id)` instead.

### 11.8 Deviations from sections 1 to 10, and why

1. **Added `preview_contractor_approval`.** The warnings must be shown before the person confirms; a read-only preview computes exactly the list `approve_contractor` returns (one private function, `hq_private.contractor_approval_warnings`).
2. **`approve_contractor` needs a non-blank note, refuses `inactive` as well as `suspended`, and returns more than `{status, warnings}`** (`contractor_id, previous_status, changed`). Approval from `prospect` or `contacted` is allowed once the checklist is complete.
3. **Leaving `suspended` goes only through `reinstate_contractor`, even to `inactive`.** Otherwise `suspended -> inactive -> vetting` would reinstate without `contractors.approve`.
4. **`tasks.reminder_key`** (new nullable column with a partial unique index) makes `create_expiry_tasks` idempotent under concurrency. `tasks.source` is unchanged: expiry reminders use `source = 'manual'` and are recognised by `reminder_key is not null`.
5. **`import_batches.kind` and `contractors_created`** were needed to record a contractor import.
6. **Contractors are created and edited by direct insert / update** (column grants + guard trigger), not a `create_contractor` RPC (the contract leaves this to the builder).
7. **Archiving** reuses `archive_record` / `restore_record` with per-entity capabilities (section 11.5); the contract did not name one.
8. **Expired and expiring_soon do not depend on verification**; "verified but no expiry date" is `unverified` (never current). `insurance_not_verified` means "no verified record with an expiry today or later".
9. **Rating gate counts rated reviews** (`rated_review_count`), so a notes-only review never unlocks a rating.
10. **Editing a licence / insurance expiry by hand clears its verified date**; verified dates are written only by `verify_contractor_document`.
11. **The expiry watch leaves out rejected and superseded documents.**
12. **`set_vetting_step` refuses `review_and_approve`**, and leaving approved / preferred resets that step: it is `done` exactly while the contractor is cleared.
13. **An import row with any `status` other than `prospect`, or `needs_verification` other than `true`, is invalid** (an import can never clear anyone).
14. **`global_search` always returns a `contractors` key**, so five Phase 1 assertions on the exact empty shape were updated. Other Phase 1 assertions that state exact totals (tables, functions, views, capability rows, the per-role `my_access` arrays, three `columns_are`) were updated to the Phase 2 totals; the test count is unchanged (594) and no Phase 1 behaviour test changed.

### 11.9 Limitations (database side)

- No malware scanning; no ABR lookup (checksum only); no scheduled reminders (only the watch and `create_expiry_tasks`).
- Rejecting or resetting a document that was applied to the contractor does not undo the contractor's verified date; edit the expiry date (which clears it) if needed.
- `service_role` cannot read the contractor views (they call `hq_private.expiry_state` and `hq.today()`, which only `authenticated` may execute), the same as the Phase 1 views.
- The Phase 1 pgTAP files `hq_02` and `hq_04` assume a freshly reset database and fail after `npm run hq:seed` (pre-existing; the `hq_05` files pass either way).

### 11.10 Trades (migrations 0123, 0124): an editable list instead of the enum

The owner asked for a dedicated Trades section with one container per trade and a list she can change. `hq.contractor_category` (22 fixed values) is replaced by the table **`hq.trades`** and the enum is **dropped** (nothing names it any more; a pgTAP test checks `pg_proc`).

- **`hq.trades`**: `id, slug, label, description, sort_order, is_active (generated: archived_at is null), archived_at, archived_by, created_at, updated_at, created_by, updated_by`. `slug` is lower snake (`^[a-z][a-z0-9_]{0,59}$`), unique for ever (archived included) and **immutable** (trigger, every writer); `label` 1-60 characters, unique ignoring case; `description` up to 500. No delete or truncate for anyone. RLS: select with `contractors.read`; no direct writes for the API. Audited (`entity_type = 'trade'`, labelled by `label`; archive/restore actions).
- Seeded with the 22 former enum values (slug = enum value, label = the display names the app used, enum order, `sort_order` 10..220). Nothing renamed for the owner; no descriptions invented.
- **`contractors.categories` is now `text[]` of trade slugs** (converted in place with `categories::text[]`; same values, same order; `updated_at` and audit untouched by the conversion). `hq_private.contractor_trades_guard` (every writer): trims and lower-cases slugs, drops blanks and repeats (order kept), and refuses (23514, message contains `contractors_trades_known`) any slug the row did not already carry that is not an existing **active** trade. A slug already on a row stays valid after its trade is archived. The guard share-locks the trades it checks, so archiving cannot race a contractor write.
- **Archiving a trade is refused (23514) while any live contractor uses it**, whoever writes.
- `contractor_directory` gains `trade_labels text[]` (current labels, in `categories` order). `contractor_summary().preferred_coverage` is now one entry per active trade in the owner's order (plus any archived trade a cleared contractor still carries), each `{category (slug), label, approved, preferred, total}`; `trades_without_cover` lists active trades other than `other`. The import classifier accepts active trade slugs (any case) and names the bad value (`unknown category: X is not a current trade`). `global_search` matches a trade by slug or current label and shows labels in the subtitle.

RPCs (security definer, `search_path` pinned, capability inside, audited, execute for `authenticated` only):

| RPC | Capability | What |
|---|---|---|
| `create_trade(p_label, p_description)` | contractors.write | slug derived from the label (`Solar & Batteries` -> `solar_and_batteries`; taken -> `_2`, `_3`), added at the end. 23505 for a label in use (says so if that trade is archived). |
| `update_trade(p_trade, p_label, p_description, p_sort_order)` | contractors.write | null leaves a field; a blank description clears it; never the slug. |
| `move_trade(p_trade, 'up' \| 'down')` | contractors.write | renumbers the active trades 10, 20 ... and swaps; one `reorder` audit row; archived trades cannot move. |
| `set_trade_active(p_trade, p_active, p_reason)` | contractors.approve | archive / restore; archive refused while in use. |
| `mark_contractor_used(p_contractor, p_job_date default today, p_allow_earlier default false)` | contractors.write | "Record a job": sets `last_job_date` (recorded by staff; HQ is not connected to Ailo); never in the future; never earlier than the recorded date unless `p_allow_earlier` (23514 otherwise); audited as `record_use`. |

Screens: `/hq/partners/trades` (tab next to the Directory) shows one container per trade (counts, coverage line, last used across the trade, contractors with status, areas, paperwork, rating when there is enough feedback, last used and "Record a job", "Show all n"), sortable by status, name or last used; `?edit=1` (contractors.write) adds, renames, describes and reorders trades, and archives / restores them (contractors.approve). The directory trade filter, the contractor form, the import, the dashboard coverage widget and the MCP tools read trades from the table (`lib/hq/trades/`); `lib/hq/constants.ts` keeps the 22 seeded values only as a fallback. The directory has a sortable "Last used" column; the profile has "Record a job". MCP: `search_contractors.trade` is free text matched loosely ("electricians" -> Electrical; none or several -> the available trades), plus `not_used_days` and `sort: last_used`; `get_contractor` shows labels and last used; new write tool `record_contractor_job`.

Tests: `supabase/tests/hq_08_trades.sql` (124). Phase 1/2 totals updated: 20 tables, 37 RPCs; the enum assertion became "the 22 seeded trades in order"; coverage rows carry `label`; the search subtitle shows labels.

**Applying to the live database**: apply 0123 and 0124 together, in a transaction (I did not confirm whether the hosted push wraps each file in one; if it does not and 0123 fails part-way, `hq.trades` may exist and must be dropped before a retry). It drops and recreates `contractor_directory` and alters `contractors.categories` (an `ACCESS EXCLUSIVE` lock on `hq.contractors` for the length of the rewrite: milliseconds for 33 rows). It aborts, changing nothing, if any stored value is not one of the seeded trades. Verified locally by applying 0100-0122, inserting contractors with several enum categories (one approved, one archived), then applying 0123 and 0124: every row kept its categories in order, status, `updated_at` and archived state.
