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
