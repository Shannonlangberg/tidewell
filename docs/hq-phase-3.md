# Planted HQ, Phase 3: Ask Planted (AI assistant)

Contract. Read with [hq-design.md](hq-design.md), [hq-phase-2.md](hq-phase-2.md) (section 11 as built) and [brand-design-system.md](brand-design-system.md). Master brief Phase 3: assistant interface, secure server-side integration, read-only database tools, permission-aware responses, natural-language contractor and contact search, task and referral queries, draft actions requiring confirmation.

## 1. Ground rules

1. **The model never touches the database.** It can only call a fixed set of **tools** we define. Each tool runs on the server **as the signed-in person** (their own session, so RLS and capability checks apply exactly as on screen), validates its arguments, and returns a small, explicit set of fields. Never raw tables, never `select *`, never document files or storage paths, never `internal_notes` of other records beyond a short excerpt cap, never anything the person could not open on screen.
2. **Read-only first.** No tool writes. "Draft" tools return a structured proposal (a task, a logged call); nothing is saved until the person presses **Confirm** on a card, which calls the same validated server action the normal screens use, as that person. The model cannot confirm.
3. **Tool results and record text are data, never instructions.** The system prompt says so, and tool output is wrapped/labelled as data. A contact note that says "ignore your rules" changes nothing.
4. **Off until a director switches it on, and until a key exists.** `hq.settings.ai_enabled` (default false) and the server env `OPENAI_API_KEY` + `HQ_AI_MODEL` (no default model name; do not guess one). If either is missing the panel says so plainly and nothing is sent anywhere. **There is no OpenAI key yet**: everything must be built and tested against a **fake provider** that implements the same interface, and the docs must say that the live OpenAI path is unverified until a key is supplied.
5. **No new runtime dependency.** Call OpenAI's HTTP API with `fetch` from the server only. The key is read only in one server module (`lib/hq/ai/openai.ts`) and never reaches the browser, logs, or errors. Add it to the ESLint secret boundary the way `staff-admin.ts` is.
6. **Accountable and bounded.** Every request is logged (who, when, the question, tools used, status, token counts). Per-person hourly limit (setting, default 40), maximum 4 tool rounds, capped tool result sizes and output tokens, a request timeout. Errors shown to people are generic.
7. **Honest.** The panel says answers can be wrong and to check before acting; it cites which tools/records an answer is based on; it says "I couldn't find that" rather than guessing; no invented contractors, numbers or contacts.
8. Data handling: what leaves HQ is exactly the question plus tool results, sent to OpenAI's API. Document this in `docs/hq-setup.md` and tell the reader to check OpenAI's current API data-retention terms before enabling.

## 2. Database (migrations `0119` onward)

- Capability `ai.use` for every role except `read_only` (tools still filter by each person's own capabilities).
- Settings keys: `ai_enabled = false`, `ai_hourly_limit = 40`.
- Table **`hq.ai_requests`**: `id, staff_id, asked_at, question (<=2000), tools_used text[], status ('started'|'answered'|'refused'|'error'|'rate_limited'), input_tokens, output_tokens, finished_at`. RLS: a person sees their own; `audit.read` sees all. No direct writes by API roles; no delete.
- RPCs (security definer, capability checked, audited as for Phase 1): `ai_status() -> jsonb {enabled, hourly_limit, remaining}` (callable by `ai.use`); `ai_begin_request(p_question text) -> uuid` (raises a clear error when disabled or over the limit, inserts `started`); `ai_finish_request(p_id uuid, p_tools text[], p_status text, p_input_tokens int, p_output_tokens int)` (only the owner of the row, only once).
- pgTAP tests (`supabase/tests/hq_06_ai.sql`): forged callers, rate limit boundary, disabled refusal, finish-once, owner-only, `read_only` refused, append-only.

## 3. Server (`lib/hq/ai/`)

- `provider.ts`: interface `{ complete(messages, tools, opts) -> {text?, toolCalls?, usage} }`; `openai.ts` (HTTP, tool calling); `fake.ts` (scripted, for tests and local development).
- `tools.ts`: the registry. Read tools (each: name, JSON-schema args, capability required, handler, result cap): `search_contractors` (trade, suburb, region, status, preferred, emergency, insurance/licence state, text), `get_contractor` (details, vetting progress, expiry, rating only if the view gives one), `contractor_expiries`, `search_contacts`, `get_contact`, `list_organisations`, `list_tasks` (mine/overdue/due this week/by contractor or contact), `list_referrals`, `pipeline_summary`, `growth_summary`. Draft tools: `draft_task`, `draft_interaction` (log a call/meeting, optional follow-up), returning `{kind:'draft', ...validated fields}` only.
- `loop.ts`: the bounded tool loop, system prompt, injection stance, citations (tool names and counts), token accounting, begin/finish logging.
- Route handler `POST /hq/ask` (or a Server Action): `requireStaff('ai.use')` first, `ai_begin_request`, run, `ai_finish_request`. Netlify function time limits are short: keep rounds and payloads small and stream if the platform allows; say what you chose.
- Confirmation action `confirmDraft`: re-validates the draft with the existing task / interaction validators and calls the existing RPC (`record_interaction`, task create) as the person.
- Unit tests with the fake provider: tool allow-list, argument validation, capability refusal (a junior asking for contractor documents gets nothing), result caps, injection text in a note does not change behaviour, draft never saves, key never in any returned value.

## 4. Screens

- The existing **Ask Planted** panel (opened from the top bar) becomes the assistant: message list, input, example prompts ("Which contractors are waiting for approval?", "Whose insurance expires in the next 30 days?", "Find approved plumbers who service Moonta", "Who haven't I contacted in 30 days?"), source chips under each answer, draft cards with Confirm / Discard, loading and error states, the "can be wrong" line, mobile layout. When disabled or unconfigured it says exactly why and who can switch it on.
- **Settings**: a director-only "Ask Planted" section: on/off, hourly limit, whether a server key is detected (never show it), a short data-handling statement.
- Brand system only. No new colours.

## 5. Acceptance

Migrations apply from scratch and the whole pgTAP suite passes; unit tests, `tsc`, `lint`, `build` pass; the panel works end to end locally against the fake provider (scripted answers that call real tools against the local database) as director and as a restricted role, screenshots viewed at 375 and 1280; docs updated, including: **the OpenAI path is unverified until a key and model are supplied**, what leaves HQ, the Netlify time-limit consideration, and the env variables to set.

## 6. As built: database

The exact contract the server codes against, together with `lib/hq/database.types.ts` (regenerated with `supabase gen types typescript --local --schema hq`). Migrations `0119_hq_ai_tables_access.sql`, `0120_hq_ai_rpc.sql`, `0121_hq_function_acl_phase3.sql`; tests `supabase/tests/hq_06_ai.sql` (139 tests; whole suite 1241).

### Capability and settings

- `ai.use`: director, administrator, senior_property_manager, property_manager, junior_property_manager, business_development_manager, virtual_assistant. **Not** read_only. Shows in `my_access().capabilities` and `can('ai.use')`.
- `hq.settings`: `ai_enabled` = `false` (JSON boolean; anything else is refused with 22023 `ai_enabled must be true or false`; a missing or non-`true` value means off), `ai_hourly_limit` = `40` (JSON whole number 1 to 1000; otherwise 22023 `ai_hourly_limit must be a whole number from 1 to 1000`; 1000 is a sanity bound, not a business figure). Changed by a director with a plain `update hq.settings set value = ... where key = ...` (policy `settings.admin`), audited by the existing settings trigger. Anyone with a staff session can read them.

### Table `hq.ai_requests`

| column | type | notes |
|---|---|---|
| `id` | uuid | primary key |
| `staff_id` | uuid not null | references `hq.staff_profiles(id)`; the caller, set by the RPC |
| `asked_at` | timestamptz not null | `now()` at begin |
| `question` | text not null | trimmed, 1 to 2000 characters (CHECK) |
| `tools_used` | text[] not null | `{}` until finished |
| `status` | text not null | `started`, `answered`, `refused`, `error`, `rate_limited` (CHECK) |
| `input_tokens`, `output_tokens` | integer | null = unknown; never negative |
| `finished_at` | timestamptz | null iff `status = 'started'` (CHECK) |

- RLS (enabled and forced), one policy `ai_requests_select`: `audit.read` holders see every row; otherwise a person sees **their own** rows in a staff session that satisfies MFA. read_only, non-staff and aal1 sessions (when MFA is required) see nothing; anon is denied at the schema.
- Grants: `select` only, to `authenticated` and `service_role`. No insert, update, delete or truncate for any API role.
- Append-only for every role (including postgres and the secret key), except the one finishing update: `started` (finished_at null) to a final status with finished_at set, with `id`, `staff_id`, `asked_at` and `question` unchanged. Anything else raises 42501 `hq.ai_requests is append-only (UPDATE|DELETE|TRUNCATE refused)`.
- Indexes: `(staff_id, asked_at desc)` for the limit, `(asked_at desc)` for an audit listing.
- Reading the log in the app: `from('ai_requests').select('id, staff_id, asked_at, question, tools_used, status, input_tokens, output_tokens, finished_at')` with the person's session; RLS decides own-vs-all.

### RPCs (schema `hq`, security definer, `search_path` pinned, execute for `authenticated` only)

Every call first requires an active staff row, an MFA-satisfying session and `ai.use`; otherwise **42501 `permission denied`** (non-staff, deactivated, read_only, aal1 under `require_mfa`). Anon is denied at the schema (42501).

**`hq.ai_status() returns jsonb`**

```json
{ "enabled": true, "hourly_limit": 40, "remaining": 37 }
```

`enabled` is true only when `ai_enabled` is JSON `true`. `remaining = greatest(hourly_limit - requests the caller began in the rolling hour, 0)`, computed whether or not it is enabled. Writes nothing.

**`hq.ai_begin_request(p_question text) returns uuid`**: the new request's id; inserts `{staff_id: caller, question: trimmed, status: 'started'}` and one audit event. Checks, in this order:

| order | condition | SQLSTATE | message | hint |
|---|---|---|---|---|
| 1 | not staff / no MFA / no `ai.use` | 42501 | `permission denied` | |
| 2 | `ai_enabled` not true | 55000 | `Ask Planted is switched off` | `ai_disabled` (detail: `a director can switch it on in Settings`) |
| 3 | blank or null question | 22023 | `a question is required` | |
| 4 | over 2000 characters after trimming | 22023 | `a question is at most 2000 characters` | |
| 5 | the caller already began `ai_hourly_limit` requests with `asked_at > now() - 1 hour` | 54000 | `hourly limit reached` | `ai_rate_limited` (detail: `at most N questions per hour`) |

The limit counts every request begun in the rolling hour, whatever its status (finishing does not give one back). With limit N, the N-th request in the hour is accepted and the (N+1)-th refused; a request begun exactly one hour ago no longer counts. A per-person advisory lock makes the count exact under concurrent calls. **A refused call stores nothing** (the transaction rolls back), so HQ's own limit never produces a `rate_limited` row; nothing should be sent to the model after a refusal. In supabase-js the SQLSTATE is `error.code` and the hint `error.hint`.

**`hq.ai_finish_request(p_id uuid, p_tools text[], p_status text, p_input_tokens integer, p_output_tokens integer) returns void`**: finishes the caller's own started request exactly once: sets `status`, `tools_used` (null becomes `{}`; order and repeats kept as given), the token counts (null allowed = unknown) and `finished_at = now()`; one audit event. Works even if Ask Planted was switched off after the request began (always close what you opened). All five arguments are positional and required (no defaults); pass `null` for unknown tokens or no tools (the generated TS types show `number` / `string[]`; cast when passing null).

| order | condition | SQLSTATE | message |
|---|---|---|---|
| 1 | not staff / no MFA / no `ai.use` | 42501 | `permission denied` |
| 2 | status not one of `answered`, `refused`, `error`, `rate_limited` (incl. null, `started`) | 22023 | `status must be answered, refused, error or rate_limited` |
| 3 | more than 64 tool names | 22023 | `at most 64 tool names` |
| 4 | a tool name null or not `^[a-z][a-z0-9_]{0,63}$` | 22023 | `each tool name is lower-case letters, digits and underscores` |
| 5 | a negative token count | 22023 | `token counts cannot be negative` |
| 6 | no such id, **or it belongs to someone else** (even for `audit.read` holders) | P0002 | `ai request not found` |
| 7 | already finished | 23514 | `this request is already finished` |

Use `rate_limited` for the model provider refusing on rate (for example HTTP 429), `error` for timeouts and other failures, `refused` when the assistant declined (for example a capability refusal or an injection attempt), `answered` otherwise.

### Audit

`hq.audit_events` rows written by the RPCs (actor = the person), entity_type `ai_request`, entity_id = the request id:

- `ai_begin`: summary `Asked Planted a question`, changes `{status: {to: 'started'}, question_length: {to: n}}`. The question text is **not** copied into the audit log.
- `ai_finish`: summary `Ask Planted request <status>`, changes `{status: {from: 'started', to}, tools_used: {to}, input_tokens: {to}, output_tokens: {to}}`.
- Setting changes (`ai_enabled`, `ai_hourly_limit`) are audited by the existing settings trigger (entity_type `setting`).

### Deviations and notes

- Section 2's status `rate_limited` is kept, but HQ's own hourly limit is enforced by raising in `ai_begin_request` (as the contract says), which cannot also store a row, so `rate_limited` rows come only from `ai_finish_request` (the provider's limit).
- `ai_status` is also refused (42501) for read_only, as section 2 says ("callable by `ai.use`"); the panel should read `my_access().capabilities` first and explain that read-only access does not include Ask Planted.
- Bounds chosen here (not given by the contract): `ai_hourly_limit` 1 to 1000, at most 64 tool names per request, tool names `^[a-z][a-z0-9_]{0,63}$`.
- `0121` restates the whole function ACL (as `0111` and `0118` did). The hq_private helpers `ai_enabled`, `ai_hourly_limit`, `ai_used_this_hour` and the trigger `ai_request_guard` are executable by no API role.
- Phase 1 tests updated for the new totals (19 tables, 33 hq functions / 32 RPCs, 68 role_capabilities rows, director 15 capabilities, `ai.use` in each role's `my_access` list except read_only); `ai_requests` was added to the RPC-only "no direct insert" list and to the non-staff "sees zero rows" check.
