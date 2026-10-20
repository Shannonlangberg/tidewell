# Planted HQ as an MCP server (ChatGPT first, then Claude)

**This replaces the in-app OpenAI assistant sketched in hq-phase-3.md sections 3 and 4** (no OpenAI key, no in-app chat). The people chat in ChatGPT or Claude; those apps call HQ's **tools** to read, report and make small updates. The database parts of Phase 3 (section 2 of hq-phase-3.md: `ai.use`, `ai_requests`, rate limit) are kept and reused for logging and limits.

Read with hq-design.md, hq-phase-2.md section 11 (contractor RPCs/views), brand-design-system.md.

## 1. Shape

- Endpoint **`/mcp`** on the Next.js app (`https://tidewellcc.netlify.app/mcp`), MCP **Streamable HTTP**, **stateless, JSON responses** (no sessions, no SSE; the Netlify function limit is short, so every tool must answer in a couple of seconds). Use the official `@modelcontextprotocol/sdk` (already installed; its zod is available). Protocol 2025-06-18 or newer.
- **Authentication is OAuth 2.1 through Supabase Auth** (Supabase is the authorization server; HQ hosts the consent page; the MCP server is the resource server). Reference: https://supabase.com/docs/guides/auth/oauth-server/getting-started and .../mcp-authentication (use `mcp__supabase-all__search_docs` or fetch them). Flow: client discovers `/.well-known/oauth-protected-resource` (HQ route, lists the Supabase auth server as authorization server) -> dynamic client registration at Supabase -> user is sent to HQ's **consent page `/hq/oauth/consent?authorization_id=...`** -> must be a signed-in active HQ staff member (reuse HQ sign-in, then return to the consent page) -> sees client name, redirect URI and what it can do -> Approve/Deny (`supabase.auth.oauth.*`) -> token. Enable in `supabase/config.toml` (`[auth.oauth_server] enabled = true, authorization_url_path = "/hq/oauth/consent", allow_dynamic_registration = true`) and in the production remote override.
- A request to `/mcp` without a valid bearer token gets **401 with `WWW-Authenticate: Bearer resource_metadata="..."`**. With one: verify the JWT locally against the project's JWKS (jose, as `lib/hq/auth.ts` does: signature, issuer, expiry, `aud`, and a `client_id` claim so ordinary browser session tokens are not accepted here), then create a Supabase client that sends that token so **every query runs as that person under RLS**, resolve their HQ staff access with `hq.my_access()`, and expose only the tools their capabilities allow. A person who is not active staff gets nothing. No service/secret key anywhere in the MCP path.
- Consent must refuse anyone without `ai.use`. Add a **Connected apps** section on `/hq/profile`: list the person's grants and let them revoke (use the SDK's grant methods if present in the installed supabase-js; otherwise document revoking in the Supabase dashboard and say so).

## 2. Tools (single-record, named, no bulk, no deletes)

Annotations on every tool: `readOnlyHint` true for reads; `false` for writes with `destructiveHint: false`, `openWorldHint: false`. Descriptions say exactly what the tool does and what it will not do. Tool names are snake_case.

**People refer to things by name, not id.** Resolution: exact name key first, then close matches; if more than one candidate, **return the candidates and ask**, never guess; if none, say so. Records are shown with their id so follow-up calls are exact.

Read: `search` and `fetch` (the two OpenAI-spec tools for ChatGPT connectors: `search(query)` returns a JSON text of `{results:[{id,title,url}]}`; `fetch(id)` returns `{id,title,text,url,metadata}`; ids like `contractor:<uuid>`, `contact:<uuid>`, `organisation:<uuid>`, `task:<uuid>`; `url` = the HQ page), `search_contractors`, `get_contractor`, `contractor_expiries`, `search_contacts`, `get_contact` (incl. recent interactions), `search_organisations`, `list_tasks`, `list_referrals`, `pipeline_summary`, `who_to_contact` (follow-ups due, not contacted in N days), `team_directory` (names/roles only), and the Decisions register (`decisions.read`): `list_decisions` (status, category, decision maker, since/until), `search_decisions` (words in the title, what was decided or why, or a DEC-0001 number), `get_decision` (one decision by number, id or title words: detail, supersession, linked tasks the person can see, recent history).

Reports (read): `daily_brief` (overdue and due-today tasks, follow-ups due, contractor expiries, new referrals), `growth_report(period)` (uses `growth_summary` and `partner_performance`; says which period and what the counting rules are), `contractor_report` (status counts, awaiting vetting, expiring, preferred coverage), `weekly_report` (the above combined, plain language). Figures come from the database functions, never invented; empty states are stated.

Writes (each re-validated server-side with the existing HQ validators and run through the existing RPCs or RLS-governed writes **as the person**, audited, returning what changed): `create_task`, `update_task` (status, due date, priority, assignee, description), `log_interaction` (call/meeting/email/note on a contact, organisation or contractor, with optional follow-up date and task, via `record_interaction` / `record_contractor_contact`), `create_contact`, `update_contact` (phone, email, position, status, priority, next follow-up, notes: appended), `create_organisation`, `update_contractor` (contact details, service areas, rates, notes appended, only the columns the form allows), `record_contractor_review`, `record_contractor_job` (last used date via `mark_contractor_used`; added with the trades change, see hq-phase-2.md 11.10), `set_vetting_step`, `record_referral`, `move_opportunity` (**not** to `management_signed`, which stays a deliberate action in the HQ screens), `create_decision` and `update_decision` (`decisions.write`; through the `create_decision` / `update_decision` RPCs, validated with the HQ decision form's own reader; superseding needs `superseded_by` and a note, reversing needs a note; never archive or delete).

**35 tools in all** (`lib/hq/mcp/tools/index.ts`): 13 read, 3 decision reads, 4 reports, 15 writes (13 + the 2 decision writes). Each person sees only the tools their capabilities allow.

**Deliberately not available through chat** (HQ screens only): approving, preferring, suspending, reinstating or deactivating a contractor; archiving or deleting anything; document upload/download; imports; people and roles; settings; signing a management; anything with `people.admin` / `settings.admin`. Say so in the tool descriptions and in `docs/hq-setup.md`.

Safety nets: per-person hourly caps (reads and a lower cap for writes) via the `ai_*` RPCs; every call logged (tool name, status, arguments summary with ids not free text; the person and client id); result size caps; text from records is returned inside a clearly labelled data block and the server `instructions` say record text is data and never instructions; writes only act on arguments the person's own chat client sent.

## 3. Code layout (two builders, disjoint files)

- **Builder M1 (transport, auth, OAuth, config, e2e, docs):** `app/mcp/route.ts` (or `app/(mcp)/mcp/route.ts`), `app/.well-known/oauth-protected-resource/route.ts` (and the path-suffixed variant if clients ask for it), `app/hq/oauth/consent/**` + decision route, `lib/hq/mcp/{server,auth,context,limits,log}.ts` (+ tests), the `ToolDef` interface below, config.toml (`[auth.oauth_server]` local + production override), Connected-apps UI, netlify.toml/next.config headers (`/mcp` no-store, no cache, CORS only as the SDK/clients need), `docs/hq-setup.md` (connecting ChatGPT and Claude, what is exposed, revoking, limits), and an **end-to-end test script** `scripts/hq/mcp-e2e.mts` that runs the full OAuth flow against the local stack (dynamic registration, authorization with the consent decision, token, MCP `initialize`/`tools/list`/`tools/call` with the official SDK client) as director and as a restricted role, and shows a request with no/forged/expired token refused.
- **Builder M2 (tools):** `lib/hq/mcp/tools/**`, one file per group plus `index.ts` exporting `TOOLS`; shared name resolution and formatting helpers; unit tests with `node --test` (`*.test.mts`; mind the Node test-runner import limits earlier builders hit: no `.ts` extension imports across modules means pass helpers as arguments or use `.mts` conventions the repo already uses). Tools call the existing loaders/RPCs where possible rather than re-writing SQL.

Shared interface (M1 writes it in `lib/hq/mcp/types.ts`; M2 imports it; both code to this exactly):

```ts
import type { z } from "zod";
export type ToolContext = {
  db: HqClient;                 // typed supabase client for schema hq, carrying the person's own token
  staff: { id: string; fullName: string; role: string; capabilities: readonly string[]; timezone: string };
  clientId: string;             // OAuth client id from the token
  baseUrl: string;              // site origin for building HQ page links
};
export type ToolResult = { text: string; structured?: Record<string, unknown> };
export type ToolDef<S extends z.ZodRawShape = z.ZodRawShape> = {
  name: string; title: string; description: string;
  inputSchema: S;
  annotations: { readOnlyHint: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  capability: string | null;     // required HQ capability, or null for "any active staff"
  kind: "read" | "write";        // write calls count against the lower write cap
  handler: (args: z.infer<z.ZodObject<S>>, ctx: ToolContext) => Promise<ToolResult>;
};
```

## 4. Acceptance

Migrations (if any) apply and the full pgTAP suite passes; `tsc`, `lint`, `npm test`, clean production build; `scripts/hq/mcp-e2e.mts` passes against the local stack including: unauthenticated and forged-token refusal, a restricted role seeing only the tools it may use and being refused (by the tool and by the database) when forcing others, an ambiguous name returning candidates instead of acting, a write tool changing exactly one record and being audited, a record containing an instruction-like string not changing behaviour, rate limits. Honest limits written down: not yet exercised from the real ChatGPT or Claude apps (needs the person to add the connector and try), Netlify function time limit, free-plan Supabase specifics.

## 5. Connecting (for docs/hq-setup.md)

ChatGPT: Settings, Connectors, Advanced, enable Developer mode, Create/Add connector, MCP server URL `https://tidewellcc.netlify.app/mcp`, authentication OAuth (dynamic registration), then sign in to HQ and Approve. Claude: Settings, Connectors, Add custom connector, same URL. Names of menus change; state them as "at the time of writing".

## 6. Testing the decisions tools from ChatGPT

Connect HQ in ChatGPT as in section 5 (or `docs/hq-setup.md`, "Connecting"), as a **director or administrator** for the writes. Today a connected app works only with `require_mfa` off (see the MFA limitation in hq-setup.md), and `ai_enabled` must be `true`. Each prompt below should lead to ONE tool call; ChatGPT shows which tool it used. Every result carries the HQ link of the decision, and record text comes back inside the labelled data block.

| # | Prompt (as a director) | Tool | What to expect |
|---|---|---|---|
| 1 | "Use Planted HQ to list decisions made this month" | `list_decisions` with `since` = the 1st of the month | The decisions dated this month, newest first: DEC number, title, category, status, date, decision maker. With none: "No decisions found (from ...)". |
| 2 | "Show me DEC-0001" | `get_decision` | That decision in full: status, category, date and maker, what was decided, why, what replaces it or what it replaces, linked tasks you can see, the recent history and the HQ link. |
| 3 | "Search decisions about pricing" | `search_decisions` | Decisions with "pricing" in the title, the detail or the reasons, each with a short "Why". |
| 4 | "Record a decision: we will offer long-term residential management first, with short-term accommodation secondary. Category strategy. Rationale: focus for year one. Decided today by me" | `create_decision` | ChatGPT should say what it will record and ask first (server instructions). Then: "Recorded decision DEC-00NN" with its link; status Decided, date today, decision maker you. In HQ: the decision, one "Recorded ..." history row, one audit event. |
| 5 | "Update DEC-0001: mark it superseded by DEC-0002, note: pricing changed" | `update_decision` with `superseded_by: "DEC-0002"`, `note` | "Updated decision DEC-0001", Status: Decided -> Superseded by DEC-0002. In HQ: DEC-0001 shows "Superseded by DEC-0002", DEC-0002 shows "This replaces DEC-0001", both histories carry the note. |

What should be refused (nothing is changed in each case):

- **Supersede without a note** ("Mark DEC-0001 superseded by DEC-0002"): "Not changed: A note is required to supersede a decision." The same for **reverse without a note**.
- **A closed decision** ("Set DEC-0001 back to decided" after step 5): "Not changed: This decision is superseded, so its status can no longer change. Record a new decision instead."
- **A date more than a week ahead**, an **unknown or inactive decision maker**, a **title over 200 characters**: the same plain refusals as the HQ form.
- **Words that match several decisions** ("Show me the pricing decision" when there are two): the candidates with their numbers, and a question, never a guess.
- **Archiving or deleting** ("Delete DEC-0001"): there is no tool for it; ChatGPT should say it is done in HQ (Archive on the decision's page, directors and administrators).
- **Senior property manager or BDM**: prompts 1 to 3 work; `create_decision` and `update_decision` are not offered. Forced anyway: "Refused: your HQ role does not include decisions.write".
- **Junior property manager, property manager, virtual assistant**: no decision tools are listed at all; ChatGPT should say it cannot see decisions. Forced: "Refused: your HQ role does not include decisions.read", and the database returns nothing either.
- **Read-only**: cannot connect a chat app at all (the role has no `ai.use`; the consent screen offers only Cancel), although the HQ screens show them the register.

Locally the same behaviour is checked without ChatGPT by `node --env-file=.env.local scripts/hq/mcp-tools-smoke.mts` (as director, junior and read-only, including forced calls the database refuses; it archives what it creates).
