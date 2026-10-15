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
