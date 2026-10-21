# Planted HQ: setup, deployment and operations

Planted HQ is the private staff portal at `/hq`. It runs in the same Next.js app as the public website and uses Supabase for sign-in and data. The plan and the reasoning behind it are in [hq-design.md](hq-design.md). The brand rules are in [brand-design-system.md](brand-design-system.md).

> Ailo runs the properties. Planted HQ runs the company. HQ does not duplicate property, rent, tenancy or maintenance records, and it is not connected to Ailo.

## What Phase 1 contains

| Area | Where | What it does |
|---|---|---|
| Sign-in | `/hq/sign-in`, `/hq/verify`, `/hq/mfa` | Emailed six-digit code, then an authenticator app. No passwords. |
| Dashboard | `/hq` | Role-aware widgets from real data only. Honest empty states. |
| Growth | `/hq/growth` | Referral partner CRM: contacts, organisations, call and meeting history, referrals sent and received, the opportunity pipeline, partner performance, reviewable import. |
| Operations | `/hq/operations` | Tasks: mine, team, overdue, due today, upcoming, completed. |
| People | `/hq/people` | Staff, roles, pods, invitations, deactivation. |
| Settings, Profile, Audit | `/hq/settings`, `/hq/profile`, `/hq/settings/audit` | Timezone, MFA, connected apps on Profile, audit log for directors and administrators. |
| AI and connected apps | `/hq/settings/ai` | The ChatGPT/Claude connection on or off and the hourly limit (directors), and the log of every call (directors and administrators). |
| Search | `Cmd/Ctrl + K`, `/hq/search` | One search across contacts, organisations, referrals and tasks, limited by what the person may see. |
| Partners, Insights | `/hq/partners`, `/hq/insights` | Honest "planned" pages: contractors are Phase 2, insights Phase 4. |

Not built yet: contractor management (Phase 2), Ask Planted AI (Phase 3), insights and forecasting (Phase 4), Ailo integration (Phase 5). The "Ask Planted" button opens a panel that says so plainly. It does not fake a conversation.

## Run it locally

You need Node 22 or later, the Supabase CLI, and a container runtime (Docker Desktop, or Colima on a Mac).

```bash
colima start --cpu 2 --memory 4        # skip if you use Docker Desktop
supabase start -x logflare,vector      # first run pulls images and takes a few minutes
cp .env.example .env.local             # then fill in the local keys: supabase status -o env
npm install
npm run hq:seed                        # fake staff and the research leads; safe to re-run
npm run dev                            # http://localhost:3210
```

Open `http://localhost:3210/hq/sign-in`. The seed creates these **fake** logins (all `@planted.test`, local only):

| Address | Role |
|---|---|
| `shannon@planted.test`, `courtney@planted.test` | director |
| `va@planted.test` | virtual assistant |
| `readonly@planted.test` | read-only |
| `junior@planted.test` | junior property manager |

Sign-in codes arrive in Mailpit at `http://127.0.0.1:54324`. To skip the email step while developing, run `npm run hq:session -- shannon@planted.test`, paste the printed lines into the browser console on any `localhost` page, and open `/hq`.

The seed turns multi-factor sign-in **off locally** so development is not blocked. The database default is **on**.

### Checks

```bash
npm test                 # unit tests (Node's built-in runner)
supabase test db         # database tests: row level security, referral counting, import (run the whole directory)
npx tsc --noEmit         # types
npm run lint
npm run build            # the production build Netlify runs
```

`supabase db reset` rebuilds the database from the migrations and wipes local users; run `npm run hq:seed` afterwards.

## Security model in one page

- **The database decides, not the screen.** Every HQ table has row level security. A person's role maps to capabilities in `hq.role_capabilities` (growth read/write/delete, tasks, people admin, audit, import, settings). Hiding a button is a courtesy; a forged request is refused by the database and by the Server Action.
- **Server Actions run as the signed-in person.** The app uses the person's own session token, so row level security applies to every query. The secret key is used in exactly one file, `lib/hq/staff-admin.ts`, only to create a login when an administrator invites someone. ESLint enforces that boundary.
- **Multi-factor sign-in is required by default** (`hq.settings.require_mfa`). Until a person completes it, the database returns them nothing.
- **Sign-in is by invitation only.** Public sign-up is off, and the same reply is given for known and unknown email addresses.
- **Referral counting.** A referral is an introduction. A signed management belongs to the opportunity and is credited to one attributed source, so it is counted once, however many partners claim the introduction. Signing twice changes nothing. This is tested in the database suite.
- **Duplicate-safe import.** Every row is classified before anything is written, and applying the same file twice creates nothing.
- **Audit.** Changes to the core records write append-only audit events that nobody, including the database owner's triggers, can edit or delete.
- **No fabricated data.** Imported leads arrive as "Identified" and "Needs verifying" with only the fields supplied. Nothing is invented.
- **HQ is never indexed** (`robots.txt`, `X-Robots-Tag`, and `Cache-Control: private, no-store`).
- **AI (Phase 3) is ChatGPT or Claude connected over MCP**, not a model inside HQ. The chat app receives only what a validated tool returns, as the signed-in person, never raw tables. See [Connecting ChatGPT and Claude](#connecting-chatgpt-and-claude-mcp).

## The live project

HQ runs on its own Supabase project, `planted-hq` (ref `wnejvqyqqfxdjkbmbrvs`), in **Sydney (ap-southeast-2)**, in a new organisation named PLANTED on the free plan. It holds HQ only: the parked Tidewell schema lives in `supabase/parked-tidewell/` and is never applied to it. The database password and keys are kept in `~/.planted-hq/` on the machine that set it up, outside the repository.

The GitHub repository is now **private**.

**Multi-factor sign-in is currently OFF on the live project** (`require_mfa` = false), by the owner's decision, so that ChatGPT and Claude can connect (see [the MFA limitation](#known-limitations-of-the-connection)). Until it is back on, an emailed code is the only factor for everyone. The planned fix: consent keeps requiring a full two-step HQ session, the database accepts connected-app tokens at the lower assurance level on the connector paths only, and `require_mfa` is switched back on.

What was done, and how to repeat it for another project:

1. **Create the project in Sydney** (`supabase projects create planted-hq --org-id <org> --region ap-southeast-2`). The region cannot be changed later.
2. **Apply the migrations:** `supabase link --project-ref <ref>` then `supabase db push`. Only `supabase/migrations/` (HQ) is applied.
3. **Auth settings** are pushed from `supabase/config.toml` with `supabase config push`. The `[remotes.production]` blocks at the bottom of that file hold the production differences: site URL, captcha off, one code per minute. Sign-ups are off, the six-digit code is ten minutes, and the API exposes only the `hq` schema. Anonymous requests to `hq` are refused (checked against the live project).
4. **Netlify environment variables:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` (mark it secret). These are read at build time, so **redeploy after changing them**. Never put the secret key in client code. `netlify.toml` declares the Next.js plugin, which must stay.
5. **First director:** `npm run hq:bootstrap -- --email you@yourdomain --name "Full Name" --confirm` (with the URL and secret key in the environment). It refuses to run if any staff already exist. Everyone else is invited from **People → Invite**.
6. **Research leads:** sign in, open **Growth → Import**, choose **Load the research leads file**, review, confirm.
7. **Domain:** `hq.planted.com.au` needs the domain, a Netlify alias and a rewrite to `/hq`. Until then HQ lives at `/hq`.

### Sign-in codes by email (SendGrid)

Sign-in codes are emailed through **SendGrid**. The domain **plantedproperty.com.au** is authenticated in SendGrid (DNS records added at the domain host), and the sender is **PLANTED. <hq@plantedproperty.com.au>**. The settings live in `supabase/config.toml` under `[remotes.production.auth.email.smtp]` and were applied with `supabase config push`; the branded template in `supabase/templates/otp.html` is installed by the same push. The SendGrid API key is the SMTP password: it is read from the `SMTP_PASS` environment variable at push time and is never in the repository.

- People sign in themselves at `/hq/sign-in`: enter the address, then type the six-digit code from the email (ten minutes, once).
- **Break-glass:** if email is down, a director with the project's secret key can still issue a code with `npm run hq:code -- --email <address> --confirm`.
- **Rotate the key:** create a new SendGrid key with **Mail Send only** (Restricted Access), update `SMTP_PASS` in `~/.planted-hq/secrets.env`, run `supabase config push`, then delete the old key in SendGrid. (The first key made for this setup had full account access; replace it.)
- **HQ address:** `hq.plantedproperty.com.au` points at the Netlify site (CNAME). Add it as a domain alias in Netlify and update the site URL in the production config when you switch to it.

### What the free Supabase plan does not give you

- **No automatic backups or point-in-time recovery.** HQ will hold personal information; move the project to Pro before relying on it for real records.
- **No session time limits** (Pro and above). The base config asks for a 30-day limit and a 14-day inactivity limit; production overrides them to "none" so the push succeeds. Remove the override on Pro.
- **No password-refusal hook** (Team and Enterprise). Nobody is given a password and sign-up is off, and HQ returns nothing until multi-factor sign-in is complete, so a password route has nothing to unlock.
- **Projects pause after a week of inactivity.**
- **No Cloudflare Turnstile yet.** Captcha is off in production until real keys exist (the local test secret accepts anything). Add the site key to Netlify as `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, put the secret in `supabase/config.toml`'s production override, and turn it on.

## Connecting ChatGPT and Claude (MCP)

HQ is an **MCP server** at **`/mcp`** (`https://hq.plantedproperty.com.au/mcp` in production). People chat in ChatGPT or Claude; those apps call HQ's tools, **as the person who connected them, with exactly that person's HQ permissions**. There is no AI model inside HQ and no OpenAI or Anthropic key. Design: [hq-mcp.md](hq-mcp.md).

### How it works

- **Sign-in is OAuth 2.1 through Supabase Auth.** Supabase is the authorization server, `/mcp` is the resource server, and HQ hosts the consent screen at `/hq/oauth/consent`.
  1. The app calls `/mcp`, gets `401` with `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource/mcp"`.
  2. That document names the Supabase Auth server (`<project url>/auth/v1`). The app reads its metadata, **registers itself** (dynamic client registration) and sends the person to Supabase's authorize endpoint (PKCE).
  3. Supabase sends the browser to HQ's consent screen. The person signs in to HQ if they are not already (the normal emailed code and second step), and comes straight back.
  4. The screen shows the app's name, the address it will return to, and what it can and cannot do. **Approve** or **Cancel**. Only active staff whose role includes `ai.use` see Approve (every role except read-only); anyone else can only cancel.
  5. The app exchanges the code for a token and calls `/mcp` with it.
- **Every request is checked at `/mcp`:** the token's signature is verified locally against the project's JWKS (no call to Supabase, no secret key), with issuer, expiry, `aud`/`role` = `authenticated`, and a `client_id` claim. Supabase only puts `client_id` in tokens issued to an OAuth app, so an ordinary HQ browser session token is refused here. Then `hq.my_access()` is asked, **as the person**, whether they are active staff, have completed any second step that is owed, and hold `ai.use`. If not: `403`, no tools.
- **Each tool runs as the person.** The token is passed to Supabase with the publishable key, so row level security and the database functions decide exactly as they do on screen. The tool list itself is filtered by the person's capabilities.
- **Stateless:** each POST is answered with one JSON response (no sessions, no streaming). `GET` and `DELETE` on `/mcp` answer `405` once authenticated.
- **Every tool call is logged** in `hq.ai_requests` through `ai_begin_request` / `ai_finish_request`: who, when, the tool, the outcome, and a summary made of the **tool name and record ids only** plus the app's client id (for example `mcp write update_task task_id=<id> via <client id>`). Names, notes and search words are never written to the log. Writes are also audited by the existing triggers and functions.

### What it can do

The tools are in `lib/hq/mcp/tools/` (one file per group). Read tools: `search` and `fetch` (the two tools ChatGPT's connectors expect), contractors, contacts, organisations, tasks, referrals, the pipeline, who to contact, the team directory (names and roles), and reports (daily brief, growth report, contractor report, weekly report). Small single-record writes: tasks, logging a call/meeting/email/note, contacts, organisations, contractor details, contractor reviews, vetting steps, referrals, and moving an opportunity (never to signed). The Decisions register: list, search and open decisions (`decisions.read`), record and update one (`decisions.write`); see [Decisions register](#decisions-register). The Knowledge base: everything except hard deletion (there is none), with every edit saved as a draft; see [Knowledge base](#knowledge-base). People refer to records by name; when a name matches more than one record, the tool returns the candidates and asks.

### Deliberately not available through a chat app

Approving, preferring, suspending, reinstating or deactivating a contractor; archiving or deleting anything (decisions included; knowledge documents are the one exception: directors and administrators can archive and restore them from chat, and nothing is ever erased); approving a knowledge draft unless a director has switched it on; document upload or download; imports; people and roles; settings; signing a management; anything that needs `people.admin` or `settings.admin`. These stay deliberate actions in the HQ screens.

### Switching it on (production)

1. **Supabase:** the OAuth server is **enabled on the live project**, with authorization path `/hq/oauth/consent` and dynamic registration on. It is recorded in the `[remotes.production.auth.oauth_server]` block in `supabase/config.toml`, which must stay so a later `supabase config push` keeps it (for another project: push that block, or Authentication > OAuth Server in the dashboard). The site URL must be `https://hq.plantedproperty.com.au` (it is).
2. **Signing keys:** `/mcp` accepts only asymmetric tokens (ES256/RS256 from the JWKS) in production. Check Authentication > JWT Keys shows an asymmetric current key before connecting anything.
3. **Second step (read this first):** see the MFA limitation below. With `require_mfa` on, connected apps are refused; it is currently off on the live project by the owner's decision (see [The live project](#the-live-project)).
4. **The on/off switch:** `hq.settings.ai_enabled` is `false` by default, and every tool call is refused ("switched off") until a director switches it on. A director does this in **Settings > AI and connected apps** (`/hq/settings/ai`), which also sets the hourly limit and shows the log of every call (directors and administrators see everyone's calls; the database shows anyone else only their own). It writes the settings table as the director, like the other business settings, and the settings trigger audits it. The e2e script makes the same update from a director's session.
5. Optional environment variables on Netlify: `HQ_PUBLIC_ORIGIN` (for example `https://hq.plantedproperty.com.au`; the origin the metadata advertises, otherwise taken from the request's host) and `HQ_MCP_WRITE_HOURLY_LIMIT` (see Limits).

### Connecting (at the time of writing; menu names change)

- **ChatGPT:** Settings, Connectors (Apps), Advanced, turn on Developer mode; then Create/Add a connector, MCP server URL `https://hq.plantedproperty.com.au/mcp`, authentication **OAuth** (dynamic registration, no client id to paste). Sign in to HQ when asked and Approve.
- **Claude:** Settings, Connectors, Add custom connector, the same URL. Sign in to HQ and Approve.

### Disconnecting

Each person can see and disconnect their own apps on **Profile > Connected apps** in HQ. Disconnecting revokes the grant at Supabase: the app's refresh tokens stop working at once and it must ask again. An access token the app already holds keeps working **until it expires (one hour)**, because `/mcp` verifies tokens locally and cannot see a revocation sooner. To cut someone off immediately, deactivate them in People (their tokens then fail the staff check on the next call), or switch the connection off for everyone in **Settings > AI and connected apps**. A director cannot disconnect another person's app; that screen says so too.

### Limits

- **All calls:** `hq.settings.ai_hourly_limit` per person per rolling hour (default 40, 1 to 1000, set in **Settings > AI and connected apps**), enforced inside the database by `ai_begin_request`. Chat apps can call several tools per question, so a director may want to raise it. A refused call stores nothing.
- **Writes:** a lower cap per person per rolling hour, default 60 (raised from 15 with Projects), set with `HQ_MCP_WRITE_HOURLY_LIMIT` (1 to 200). Counted from the person's own logged single-record write calls. A safety bound, not a business figure.
- **Bulk task calls** (`bulk_create_tasks`, `bulk_update_tasks`, up to 50 tasks each): one log row and one request against `ai_hourly_limit` per call, not counted by the write cap. Their limit is the database's bulk budget: 6 calls and 300 tasks per person per rolling hour (settings `bulk_calls_per_hour` 1 to 60, `bulk_items_per_hour` 1 to 2000). See docs/hq-mcp.md section 13.
- Each tool must answer within 8 seconds; results are cut at 20,000 characters (with a note saying so); request bodies over 192 KiB are refused; at most 2,500 argument elements per call (a full 50-task plan fits).
- **Netlify's synchronous function limit is short** (10 seconds by default). The endpoint is stateless and every tool is a few small queries, but a cold start plus a slow report could approach it.

### Known limitations of the connection

- **Multi-factor sign-in blocks it today.** Supabase issues OAuth app tokens at `aal1` even when the person approved from a session that had completed the second step (checked locally: consent given at `aal2`, the token says `aal1` with method `oauth_provider/authorization_code`). HQ's database requires an `aal2` session when `require_mfa` is on, and `/mcp` follows it. So **with `require_mfa` on (the database default) every connected app gets `403`**. The owner's decision for now: `require_mfa` is off on the live project, so the connection works but HQ is single-factor for everyone. The planned fix is targeted: the database accepts OAuth-app tokens at `aal1` on the connector (`ai.use`) paths only, consent itself still needs a full two-step HQ session, and `require_mfa` goes back on. The AI screen warns when the connection is on while `require_mfa` is on.
- **Not exercised from the real ChatGPT or Claude apps.** Everything was tested locally with the official MCP SDK client doing the same discovery, registration, PKCE and token exchange (`scripts/hq/mcp-e2e.mts`). A person must add the connector in each app and try it.
- The token's audience is `authenticated` (Supabase does not bind tokens to a resource with RFC 8707 `resource`), so `/mcp` relies on the `client_id` claim and issuer to tell OAuth-app tokens from browser sessions. The token is passed on to Supabase (the same project that issued it) so RLS runs as the person.
- Supabase's OAuth server is in beta; free-plan rate limits on registration and token endpoints apply.
- No CORS on `/mcp` (ChatGPT and Claude call it server to server); browser-based MCP inspectors cannot call it directly.

### Local testing

```bash
NEXT_DIST_DIR=.next-m1 HQ_MCP_WRITE_HOURLY_LIMIT=30 npx next dev -p 3350
node --env-file=.env.local scripts/hq/mcp-e2e.mts http://mcp.localhost:3350
```

The local stack's `[auth.oauth_server]` is on (restart with `supabase stop && supabase start -x logflare,vector` after changing it). Supabase sends consent to `site_url` + `/hq/oauth/consent`, which locally is port 3210; the test script reads the `authorization_id` from that redirect and opens the consent page on whichever server it is testing.

## Decisions register

**What it is.** `/hq/decisions` (nav: **Decisions**) is the record of what the business has decided, why, who decided, when, and whether it still stands. Each decision gets a number (`DEC-0001`), a category, a status and a full history of every change. It is for business decisions (strategy, pricing, people, service offering, partners, compliance...), not for tasks: a decision can lead to tasks, and those tasks are linked to it.

**Statuses.** `Proposed`, `Decided`, `In effect` (open: a director can move between them), `Superseded` (replaced by a later decision, which is named) and `Reversed` (undone, with the reason). Superseded and reversed are **closed**: the status never changes again, so the register stays an honest record. To change course, record a new decision and supersede the old one with it.

**Who can do what** (the matrix is data in `hq.role_capabilities`; change it there, by migration, not in code). **This split is an assumption for the owner to confirm.**

| Role | `decisions.read` (see the register, search, history) | `decisions.write` (record, edit, supersede, reverse, link tasks, archive) |
|---|---|---|
| Director | yes | yes |
| Administrator | yes | yes |
| Senior Property Manager | yes | no |
| Business Development Manager | yes | no |
| Read-only | yes | no |
| Property Manager, Junior Property Manager, Virtual Assistant | no (no nav item; the pages send them back to Today) | no |

**How to use it.**

- **Record a decision:** Decisions, **Record a decision**. Write it in one sentence, choose a category, the date (default today; at most a week ahead) and who decided (default you; any active member of staff), then what was decided and why. An optional note goes into the history ("Agreed at the planning day").
- **Find one:** the search box matches words in the decision, what was decided and why, or a number such as `DEC-0004`. **Filter** reveals category, status, decision maker and a date range. Newest decision first, 25 per page; one card per decision on a phone.
- **On a decision's page:** what was decided and why, what it replaces and what replaced it (with links), its tasks, and the full **History** (who changed what, when, and the note). **Edit** corrects the wording, category, date or decision maker. **Supersede this decision** (choose the decision that replaces it; a note is required) and **Reverse this decision** (a note is required). **Create a task from this decision** opens New task with the title filled in, and links the task to the decision when it is saved; **Link an existing task** links one of your open tasks. A linked task is shown only to people who can see that task (others see a count). **Archive** is for a decision recorded by mistake (refused while another decision is superseded by it); a director or administrator can restore it.
- **Through ChatGPT or Claude:** `list_decisions`, `search_decisions`, `get_decision` (with `decisions.read`), `create_decision`, `update_decision` (with `decisions.write`). No archiving or deleting through chat. See [hq-mcp.md](hq-mcp.md#testing-the-decisions-tools-from-chatgpt). Read-only staff cannot connect a chat app at all (their role has no `ai.use`), so in chat the register is for directors and administrators (read and write) and senior property managers and BDMs (read).

**How it is protected.** Tables `hq.decisions`, `hq.decision_history` (append-only for every role), `hq.decision_tasks`; view `hq.decision_overview` (security invoker). RLS is enabled and forced; the API may only read them; every write goes through `create_decision`, `update_decision`, `supersede_decision`, `link_decision_task`, `unlink_decision_task` and `archive_record` / `restore_record` (entity `decision`), which check the capability and the second sign-in step, validate, write the history and an audit event (`entity_type = 'decision'`). Migrations `0125_hq_decisions.sql`, `0126_hq_function_acl_decisions.sql`; tests `supabase/tests/hq_09_decisions.sql`.

**Not yet:** a link to **projects** (HQ has no projects yet; add a nullable `project_id` to `hq.decisions`, or a `decision_projects` table like `decision_tasks`, when it does); decisions in the global search (`Cmd/Ctrl+K`) and on Reports (left out to keep this change small; the register's own search covers it).

## Portfolio (managed properties and the Ailo handover)

**What it is.** `/hq/portfolio` (nav: **Properties**) lists the properties Planted manages. Each gets a number (`MP-0001`), a light record and a nine-step handover checklist. The page header reads "Managed 3 of 20" from the goal.

**What HQ stores, and what stays in Ailo.** Ailo is the system of record for rent, trust accounting, tenancies, maintenance, inspections and owner communications. HQ does not copy any of that, has no connection to Ailo, builds no sync and stores no Ailo credentials (no public Ailo API is known; see `lib/hq/integrations/ailo.ts`). For each property HQ holds only: the address and suburb, the owner (a contact, or a typed name), the service (**long-term residential** or **short-term accommodation**, always counted separately), the fee basis (a percentage of rent, a flat fee, or other, with notes), the agreement date, managed-from and ended-on dates, the status (`Onboarding`, `Active`, `Offboarding`, `Ended`), the **Ailo reference** (typed by a person, exactly as Ailo shows it) and the **Ailo status** (`Not set up`, `Set up`, `Live`), plus business notes.

**How a property gets in.**

- **From a signed lead:** on the lead's page (`/hq/growth/opportunities/[id]`), **Make this a managed property** (shown only once the lead is at Management signed, to people with `portfolio.write`). The address, suburb and owner come from the lead unless changed, so nothing is typed twice. One property per lead. While the property is live, the lead cannot be moved out of Management signed or archived (archive the property first).
- **Signed before HQ:** Properties, **Add a property signed before HQ**. Needs the address, the owner and a note saying where it came from.

**Rules (the database enforces them).** Active needs the managed-from date (today or earlier: keep a future start onboarding). Ended needs the end date; an end date is only for an ended property. Ailo **Live** needs the Ailo reference, and a reference is used by one property only. The same address cannot be managed twice at once. Reopening an ended property needs a director or administrator. Edits are refused if someone else changed the property since it was opened.

**The handover checklist** (nine steps, created with the property): Owner onboarded; Management agreement signed; Owner ID verified; Bank and payment details in Ailo; Property created in Ailo; Owner invited to Ailo; Condition report or inspection booked; Keys and access arranged; Welcome pack sent. Each is Not started, In progress, Done or Not applicable (which needs a note); Done and Not applicable record who and when. Finishing every step never changes the property's status: mark it active yourself. HQ never stores bank details: that step only records that they were entered in Ailo.

**The goal.** Settings, **Business goal** (directors, `settings.admin`): the number of managed properties (20 to start) and the date to reach it. **The date is empty until the owner sets it**; HQ never invents one, and without it no pace is shown.

**Business at a glance** (top of Reports; one line on Today for directors and administrators; `business_summary` over MCP), from `hq.business_summary()`. Every figure is labelled: **Actual** (counted from HQ records: managed means active or onboarding, split long-term / short-term accommodation; open leads; leads needing attention), **Signed** (managements marked signed in HQ this month and this financial year, from HQ records), **Estimate** (the yearly values people typed on open leads; never income), and the **pace** (needed per month to reach the goal by its date, against managements signed per month over the last three months) only when a goal date is set. With nothing recorded it says "No managed properties recorded yet".

**Who can do what** (data in `hq.role_capabilities`; **an assumption for the owner to confirm**): `portfolio.read` director, administrator, senior property manager, property manager, BDM, read-only; `portfolio.write` (create, edit, checklist, archive, restore) director, administrator, senior property manager. Junior property managers and virtual assistants do not see Properties (a virtual assistant still sees the signed and pipeline figures in Business at a glance, through `growth.read`).

**Through ChatGPT or Claude:** `list_managed_properties`, `get_managed_property` (portfolio.read), `create_managed_property` (from a signed lead), `update_managed_property`, `set_handover_step` (portfolio.write), `business_summary` (growth.read or portfolio.read). Not through chat: archiving, restoring, adding a property signed before HQ, setting the goal. See [hq-mcp.md](hq-mcp.md#testing-the-portfolio-tools-from-chatgpt).

**How it is protected.** Tables `hq.managed_properties`, `hq.property_handover_steps`; view `hq.portfolio_overview` (security invoker). RLS enabled and forced; the API may only read; every write goes through `convert_to_managed_property`, `add_existing_managed_property`, `update_managed_property`, `set_handover_step`, `set_business_goal` and `archive_record` / `restore_record` (entity `managed_property`), which check the capability and the second sign-in step, validate and write audit events (`managed_property`, `property_handover_step`, `setting`). Migrations `0129_hq_managed_properties.sql`, `0130_hq_portfolio_rpc.sql`, `0131_hq_function_acl_portfolio.sql`; tests `supabase/tests/hq_11_portfolio.sql`.

**Not yet:** fee run-rate or income forecasts (needs the owner's fee figures; the summary deliberately shows only estimates people typed), properties in the global search, any Ailo integration (only if Ailo confirms an authorised route).

## Leads pipeline (Day 2: leads that are not referrals)

**What changed.** The pipeline (`/hq/growth/pipeline`, title "Pipeline") now runs every lead, not only partner referrals. **Add a lead** (`/hq/growth/pipeline/new`) records a landlord or owner from our own marketing, the website, a direct approach or other; a partner's introduction is still **Record a referral**, so the partner is credited and a signed management is counted once. Each lead has a page (`/hq/growth/opportunities/[id]`, shown as `LEAD-0007`): the landlord and how to reach them, the stage with the same Move stage drawer as before, the **next step** (owner, next action, follow-up date, editable), where it came from, expected close, the estimated yearly value (labelled an estimate), the credited partner if any, and one timeline of calls, meetings, notes, stage changes and tasks. **Log a call or note** records activity on the lead (optionally a new next step and a follow-up task linked to the lead); **Create follow-up task** opens the task form already linked to the lead (tasks now link back to the lead's page). Board cards show the owner's initials, the next action and its date (overdue in red) and open the lead's page; the board filters by source and "needs attention".

**Lead rules (the database enforces them, migration `0127_hq_leads_pipeline.sql`).**
- An **open** lead (any stage but Management signed or Lost) always has an **owner**, a **next action** (up to 300 characters) and a **follow-up date**. This holds for every writer: a lead created without them gets the caller as owner, "Make first contact" and tomorrow (that is how `record_referral` keeps working), and clearing one on an open lead is refused. A follow-up date set by a person is today to two years ahead; an expected close date today to three years ahead.
- **Source** is one of website enquiry, referral partner, our own marketing, direct approach, other. A lead added by hand cannot claim referral partner; a lead introduced by a referral keeps it.
- **Lost** needs a reason from the list (price or fees, chose another manager, managing it themselves, not ready yet, stopped responding, outside our area, other) **and** a few words. Reopening clears both and keeps the next step.
- **Duplicates:** adding a lead with the same phone (0400 and +61 400 match), the same email, or the same name in the same suburb as a live lead or landlord contact is refused with a link to the existing record; "This is someone else" adds it anyway.
- Stage still moves only through Move stage, and signing only there.

**Landlord contacts.** Contacts now have a **kind**: Partner (the default, every existing contact), Landlord, Other. Adding a lead adds the person as a Landlord contact (flagged to verify), or links the contact that already has that email. Landlords appear in the contacts list only when asked (Contacts, filter **Kind of contact**: Landlords / Other contacts / Everyone; the default is partners), with a Landlord chip, and their page lists their leads. **A landlord is never a referral partner:** the Referral partners page, its counts, Today's "Gone quiet", `who_to_contact`, the partner pickers and the Growth overview's contact figures (by status, not contacted in 30 days) count partner contacts only, so no partner number changes.

**Today.** "Call today" also lists your own leads whose follow-up date is today or past (name, next action, overdue, suburb) with Call, Log (opens the lead with the call form open) and Snooze (a week). One quiet line says how many leads need attention (no owner, no next step, overdue) and links to the pipeline filtered; nothing is shown when none do.

**Through ChatGPT or Claude:** `create_opportunity`, `get_opportunity`, `list_opportunities`, `update_opportunity`, `log_opportunity_activity`, `list_interactions`; `move_opportunity` still refuses signed and lost. Prompts to try: [hq-mcp.md section 8](hq-mcp.md#8-testing-the-pipeline-tools-from-chatgpt).

**How it is protected.** New RPCs `create_opportunity`, `update_opportunity`, `log_opportunity_activity` and the seven-argument `move_opportunity` (all security definer, growth.write checked inside with the second sign-in step, pinned search path, audited, execute for `authenticated` only: `0128_hq_function_acl_leads.sql`); views `opportunity_overview` and `overdue_opportunities` (security invoker). Tests `supabase/tests/hq_10_leads.sql` (135 tests: forged callers, the open-lead rule, duplicates, source and lost-reason rules, partner views unchanged by landlords, overdue boundaries, RLS).

**Not yet:** leads in the global search (`Cmd/Ctrl+K`); a conversion figure for direct leads (the Growth overview's conversion is still managements signed over referrals received, and now includes signed direct leads in the numerator).

## Email (branded drafts, approved sending)

**What it sends.** One branded PLANTED. email at a time, to ONE person: a live contact with an email on record, an active member of staff, or someone new whose address is typed in (HQ: **Draft an email > Email someone new**; chat: `draft_email` with `to_email` and `to_name`). A typed address is added to **Contacts** first, in the same step, marked **needs verification** (source "email draft", kind other; nothing else is filled in), and the draft points at that contact. An address HQ already holds is reused (no duplicate). Typing an address needs `growth.write` as well as `email.draft` (director, administrator, business development manager, virtual assistant; property managers cannot) and is limited to 10 new contacts per person per hour. There is no cc, bcc or attachments. The address is copied from the record when the draft is made and checked against the record again at approval and at send; if the record changed, the send is refused (discard and redraft). The look matches the sign-in code email (`lib/hq/email/render.ts`): charcoal header with the wordmark, a soft-white card, plain-text paragraphs, a signature of the sender's name, HQ role and "PLANTED. Property Management" (no phone, address, ABN or licence is added), and a footer that identifies the sender and says how to opt out. No remote images, no tracking pixel; SendGrid's open, click and subscription tracking are switched off in each request. Both an HTML and a plain-text part are sent.

**From and replies.** From **PLANTED. <hq@plantedproperty.com.au>** (override with `EMAIL_FROM_ADDRESS` / `EMAIL_FROM_NAME`). Reply-To is the drafter's own HQ address, so answers go to them.

**Approval model.** `email.draft` (director, administrator, senior property manager, property manager, business development manager, virtual assistant) drafts, edits and discards their own drafts. `email.send` (director, administrator, business development manager) approves and sends: **Approve and send** on the email's page or on Today, after a dialog naming the exact recipient and address. The creator may approve their own draft (the person tapping is the human check). A draft is approved only in HQ: the database refuses an approval made with a connected-app token. Sent emails appear on the contact's timeline ("Email sent: <subject>"). Status machine and double-send protection: migration `0132_hq_email.sql`; a failed send (including a timeout, when it may have been delivered) is retried only by a new approval.

**Limits.** At most `email_daily_limit` sends per person per business day (default 20, 1 to 200, failed attempts count) and 30 drafts and 10 new contacts (typed addresses) per person per hour, all enforced in the database. Chat writes also count against the hourly write cap.

**Chat sending (warning).** `email_chat_send_enabled` is **off** by default. A director can switch it on in **Settings > AI and connected apps > Email**. When on, ChatGPT or Claude can send a draft it made in the last 30 minutes, for the same person through the same app, without anyone tapping Approve and send in HQ, once the person confirms the address in the chat. It is still limited to one recipient, the daily limit and roles with `email.send`, and it is refused for a contact that still needs verification (every address typed into a draft, and any imported or enquiry contact not yet verified: approve those in HQ, or open the contact and **Mark as verified** first), but nobody in HQ reviews the wording first. Leave it off unless the owner decides otherwise.

**Netlify environment variables.** `SENDGRID_API_KEY` (mark it **secret**; a key with Mail Send access only), optionally `EMAIL_FROM_ADDRESS` and `EMAIL_FROM_NAME`. Redeploy after changing them. Without the key, production refuses to send ("Email sending is not set up"). `lib/hq/email/sendgrid.ts` is the only file that reads the key (ESLint refuses `process.env.SENDGRID_API_KEY` elsewhere, and only `lib/hq/email/send.ts`, `enquiry-notify.ts` and `enquiry-ack.ts` may import that file); the key is never logged or returned. The email list is **Communications > Emails** (`/hq/communications/emails`; `/hq/email` redirects there).

**Local development** never sends: outside production the **fake provider** is used unless `HQ_EMAIL_PROVIDER=sendgrid` is set explicitly. It writes each email (JSON and the rendered HTML) to `HQ_EMAIL_OUTBOX_DIR` (default `<os temp dir>/planted-hq-email-outbox`). `HQ_EMAIL_FAKE_FAIL=timeout` (or another failure code) makes it fail, to see the failed screens.

**Legal review needed.** The footer wording ("Sent by PLANTED. Property Management on behalf of <name>. Reply to this email to reach <name>. If you would rather not receive emails from us, reply with the word unsubscribe.") is a Spam Act 2003 style identification and opt-out, written without legal advice. Have it reviewed before relying on it. HQ has no unsubscribe list yet: when someone replies "unsubscribe", remove the email address from their record (HQ then refuses to draft to them) and note why.

**Not verified:** a real send through SendGrid. Everything was tested locally with the fake provider; the live send is unverified until deployed and tried with a real address the owner controls.

Tables, RPCs and tests: `hq.email_drafts`, `create_email_draft`, `update_email_draft`, `discard_email_draft`, `approve_email_draft`, `begin_email_send`, `finish_email_send` (0132, privileges 0133; typed addresses and the unverified-contact chat rule 0146, privileges 0147); `supabase/tests/hq_12_email.sql`, `supabase/tests/hq_12b_email_new_recipient.sql`; unit tests in `lib/hq/email/*.test.mts`.

## Communications (enquiries and emails in one place)

The **Communications** item in the navigation (sidebar, and the More sheet on a phone) replaces **Email**. It is shown to anyone with `growth.read` OR `email.draft`, and carries a small count of website enquiries that are still New and unhandled (one head-only count per page load, for people who can see enquiries; nothing when there are none; the More tab shows a dot). `/hq/communications` opens on the person's first tab:

- **Enquiries** (`/hq/communications/enquiries`, `growth.read`; the default): the website enquiries list, with the number still New on the tab.
- **Emails** (`/hq/communications/emails`, `email.draft`): drafts waiting for approval, sent, and not sent or discarded.

Each tab's page calls `requireStaff(capability)` first; someone with only one of the two capabilities sees only that tab, and someone with neither (the junior property manager) has no Communications item and is refused at the address. The old lists `/hq/growth/enquiries` and `/hq/email` redirect to the tabs (query kept). An enquiry's page (`/hq/growth/enquiries/<id>`) and an email's pages (`/hq/email/<id>`, `/new`, `/<id>/edit`) keep their addresses, because the staff notice and the chat tools link to them; their breadcrumbs and the highlighted nav item say Communications. Today's "new website enquiries" line, the Growth links and the chat tools' list links point to the hub. Helpers and the rules: `lib/hq/communications.ts`.

## Website enquiries (the public forms into HQ)

**How it works.** The two forms on plantedproperty.com.au (Rental appraisal at `/rental-appraisal`, Contact at `/contact`) post to Server Actions on the same site (`app/(site)/enquiry-actions.ts`). Each submission is read and validated again on the server, then screened (a hidden honeypot field, a too-fast timing check, and Turnstile when its keys are set). Only then is it stored in HQ: `lib/hq/enquiry-intake.ts` calls `hq.submit_enquiry` with the secret key, and that function is executable by `service_role` only (never by a browser, anon or a signed-in person). In one transaction it:

- validates and caps every field again (name 200, email 254, phone 40, suburb 120, message 5000, the other form fields 300 each, at most 30);
- **dedupes**: the same email with the same submission within 10 minutes returns the enquiry already stored (a double tap makes one enquiry, one lead and one task);
- **rate-limits**: at most 5 enquiries per email address and 5 per connection per hour; the sixth is refused and the person is told honestly it was not sent;
- links the live contact that already uses that email (never changed; a referral partner stays a partner), or creates a **landlord contact** flagged to verify (source "website enquiry");
- attaches to that person's **open lead** if there is one (a message on its timeline), otherwise creates a new lead: source Website enquiry, stage Introduction received, next action "Reply to the website enquiry", due **today** (business timezone), the message in its notes, owned by the person in **Settings > Who gets website enquiries** (or, when nobody is chosen or that person has left, the earliest-created active director);
- puts the message on the lead's timeline and creates one task for the owner, due today: "Reply to website enquiry ENQ-0001";
- writes an audit event with the actor "System" (no message text in it).

**Delivery rule.** A person is told their enquiry was sent only when HQ stored it (or, if HQ could not, when an older adapter, Resend or the webhook, delivered it). If HQ fails and nothing else delivered, they see the existing "something went wrong, it didn't reach us" message and nothing is stored. Both forms work with and without JavaScript.

**Staff notification email (best effort).** After HQ stores a new enquiry (not a duplicate), one email goes to `ENQUIRY_TO_EMAIL` only, never to the enquirer: "New website enquiry ENQ-0001: Rental appraisal request (Wallaroo)", with the form, the ENQ number, the name and suburb as typed, when it arrived, and links to the enquiry and the lead in HQ (`https://hq.plantedproperty.com.au/...`). The message, email address and phone number stay in HQ. From `PLANTED. <hq@plantedproperty.com.au>` (`EMAIL_FROM_ADDRESS` / `EMAIL_FROM_NAME`, as for HQ email), Reply-To the notification address itself. If the email fails, the enquiry still counts as received (it is in HQ) and the failure is only logged. Outside production the fake provider writes it to the local outbox instead (`HQ_EMAIL_OUTBOX_DIR`), exactly as for HQ email.

**In HQ.** **Communications > Enquiries** (`/hq/communications/enquiries`, `growth.read`; the old `/hq/growth/enquiries` redirects there, filters kept): newest first, with the ENQ number, Appraisal or Contact, name, suburb, when it arrived, status (New, In progress, Spam, Archived), owner and the lead; filters by status and form; cards on a phone. An enquiry's page shows exactly what was submitted, as plain text, with **Open the lead**. People with `growth.write` can mark it In progress, Archive it, or **Mark as spam** (confirmed): spam keeps the enquiry and archives the lead and contact it created, with its reply task and timeline entry, when nobody has worked on them yet (a call, a note, a task, a stage change); a lead it joined, or a partner contact, is never touched. Leads from the website carry a **Website enquiry** chip on their page and pipeline card, and the lead's page links back to its ENQ numbers. **Today** shows one quiet line, "2 new website enquiries", when there are any. A director chooses **Who gets website enquiries** in Settings.

**Through ChatGPT or Claude:** `list_enquiries` and `get_enquiry` (read only; enquiry text is returned as untrusted data; both say whether the thank-you email went). Prompts: [hq-mcp.md section 10](hq-mcp.md#10-testing-website-enquiries-from-chatgpt).

**The thank-you email to the enquirer (a touch point).** After HQ stores a NEW enquiry (never a duplicate) and after the staff notice, the site sends ONE short branded email to the address the person typed (`lib/hq/email/enquiry-ack.ts`, through the same SendGrid path; the fake provider and local outbox outside production). What it says, and nothing else:

> Subject: Thank you for contacting PLANTED.
> Hello Jeff, (the first name only when it is plain: letters, spaces, hyphens and apostrophes, at most 40 characters; otherwise "Hello,")
> Thank you for getting in touch with PLANTED. We have received your message and will be in touch.
> You can also reach us here: Email: info@plantedproperty.com.au / Phone: 0424 156 023 (each line only while it is set in `CONTACT` in `lib/planted.ts`)
> If you did not send this enquiry, you can ignore this email.
> PLANTED. Property Management, then the same identification and opt-out footer as every HQ email.

It never repeats what they wrote (no message, phone, suburb or ENQ number) and promises no response time, hours, prices or services. Same look as HQ email (charcoal header with the wordmark, ivory card), plain-text and HTML parts, no images, links or tracking. From `PLANTED. <hq@plantedproperty.com.au>` (`EMAIL_FROM_ADDRESS` / `EMAIL_FROM_NAME`); Reply-To the lead owner's HQ address (else the From address), so a reply reaches a person.

**Abuse limits (in the database, because the address was typed by an unauthenticated visitor).** `hq.begin_enquiry_auto_reply` (service_role only, migration `0136`, privileges `0137`) refuses, and records why, unless: the switch is on; the enquiry is still New and arrived within the hour; its thank-you was never started (so a double tap, a replay or a retry never sends twice); the address passes a plain shape check; no thank-you was sent, started or failed to the same address in the last 24 hours (a failure counts, as a timeout may still have been delivered); and fewer than 30 were attempted across HQ in the last hour. Spam-marked, honeypot, too-fast, invalid and refused submissions never get one. `hq.finish_enquiry_auto_reply` records sent (with the provider's message id) or failed (a short code), once. A sent thank-you adds an **Email** entry, "Automatic thank-you email sent to the enquirer", to the lead's and the contact's timeline (actor System), and both steps are audited without the address. Any failure is logged (ENQ number and a short code only) and never changes what the visitor is told: "told sent only when stored" still holds. The step adds a little time to the form's answer (bounded at about 9 seconds in the worst case; normally well under a second).

**Where you see it.** A **Thank-you sent** / **Thank-you not sent** chip, with the time, on Communications > Enquiries, on the enquiry's page ("Thank-you email", with the reason when not sent) and on the lead's timeline (on the enquiry's message and on the thank-you entry). "Thank-you not confirmed" means the email service did not confirm it (it is never retried). Enquiries from before this change show nothing.

**The switch.** **Settings > Who gets website enquiries > Thank-you email to the enquirer** (`enquiry_auto_reply_enabled`, **on** by default). Directors switch it; anyone with `growth.read` sees whether it is on. Switching it back on never sends thank-yous for enquiries that arrived while it was off.

**Legal review needed.** The footer wording (as for HQ email, pending review) and the fact that this email is sent automatically to an address typed on the website: it is a reply to the person's own enquiry, carries no marketing, identifies PLANTED. and says how to opt out, but it has not been reviewed by a lawyer. Have both checked before relying on them.

**Netlify environment variables (production).**
- `ENQUIRY_TO_EMAIL`: **set this**: the address that gets the notification email (for example the shared inbox the owner reads). Without it enquiries are still stored in HQ, but no email is sent.
- `ENQUIRY_IP_SALT` (optional, mark it secret): 16 or more random characters, used to hash the visitor's IP for the hourly limit. Without it a value derived from the secret key is used. Changing it only resets the hourly counts.
- Already set: `SENDGRID_API_KEY` (the notification and the thank-you use it through `lib/hq/email/sendgrid.ts`, still the only file that reads it), `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY` (the intake uses them through `lib/supabase/secret.ts`).
- Redeploy after changing any of them.

**Spam protection today.** Turnstile is still **off** (no keys set), so protection is the honeypot field, the timing check, the dedupe and the two hourly limits, plus Mark as spam in HQ. Turning Turnstile on needs `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` (the CSP already allows it on both form pages).

**Privacy and retention.** No IP address is stored: only a salted SHA-256 of it, used for the hourly limit. Server logs carry the outcome and the ENQ number, never a name, email, phone or message. Enquiries are never deleted by HQ (spam is marked, not removed), and the message is also copied to the lead's notes and timeline. **There is no automatic retention period yet:** the owner should decide how long enquiries that never became a management are kept, and the privacy policy should say what happens to what people submit. Deleting an enquiry is blocked for every role by design, so a retention clean-up needs a new migration that the owner approves.

**Security boundary.** `lib/hq/enquiry-intake.ts` is the only file on the public site's path allowed to import `lib/supabase/secret.ts` (ESLint allow-list), and it only calls `submit_enquiry`, `begin_enquiry_auto_reply` and `finish_enquiry_auto_reply`. `lib/hq/email/enquiry-notify.ts` and `lib/hq/email/enquiry-ack.ts` are the only files besides `lib/hq/email/send.ts` allowed to import the SendGrid provider (`lib/hq/email/sendgrid.ts` is still the only reader of the key; the thank-you file never sees the secret key). Migrations `0134_hq_enquiries.sql` (table `hq.enquiries`, RLS forced, readable with `growth.read`, no direct writes by any API role; the RPCs; view `enquiry_overview`) and `0135_hq_function_acl_enquiries.sql` (privileges); the thank-you: `0136_hq_enquiry_auto_reply.sql` (columns `auto_reply_*` on `hq.enquiries`, the setting, the two RPCs, `mark_enquiry_spam` updated, `enquiry_overview` extended) and `0137_hq_function_acl_enquiry_auto_reply.sql`; tests `supabase/tests/hq_13_enquiries.sql` and `hq_14_enquiry_ack.sql`, unit tests `lib/hq/email/enquiry-ack*.test.mts`.

**Site links.** `CONTACT.url` in `lib/planted.ts` is `https://plantedproperty.com.au` (confirmed), so canonical URLs, the Open Graph base, the sitemap, robots.txt and the area pages' structured data use it. The footer's **Staff login** goes to `https://hq.plantedproperty.com.au/`. No other contact detail is published.

**Not verified until deployed:** the real notification email and the real thank-you email through SendGrid (delivery, how it looks in Gmail and Outlook, and whether replies reach the lead owner), and the live path (the Netlify function reaching the hosted database with the secret key, Netlify's client IP header). Everything was tested locally (fake email provider). To try it live after deploying: set `ENQUIRY_TO_EMAIL`, redeploy, submit the Contact form on plantedproperty.com.au with a clearly fake name ("[test] ...") and an address you control, check you see the thank-you page, the notification arrives at `ENQUIRY_TO_EMAIL` with working links, and in HQ the enquiry, the lead (Website enquiry chip, owner, next action due today), the reply task on the owner's Today and the message on the lead's timeline; submit the same form again straight away and check there is still one lead; check the address you used got ONE thank-you email ("Thank you for contacting PLANTED.", greeting by your first name, the contact details, the footer) and that the enquiry shows **Thank-you sent** in Communications and on the lead's timeline; submit a DIFFERENT message from the same address and check no second thank-you arrives and that enquiry shows **Thank-you not sent** (already one in 24 hours); switch **Settings > Thank-you email to the enquirer** off, submit from a second address you control and check nothing arrives, then switch it back on; reply to the thank-you and check the reply reaches the lead owner; then mark the test enquiries as spam.

## Knowledge base

**What it is.** `/hq/knowledge` (nav: **Knowledge**, in the sidebar and the phone's More sheet; every role) is where PLANTED. writes down how it does things: company procedures, contractor vetting procedures, referral partner procedures, landlord onboarding guidance, staff policies, operational checklists, and how PLANTED. speaks. Each document has a number (`KB-0001`), a title, a category, a summary, an owner, an optional review date, a version history and an approval status.

**Categories** (`hq.knowledge_category`): Company procedures (`company_procedure`), Contractor vetting (`contractor_vetting`), Referral partners (`referral_partner`), Landlord onboarding (`landlord_onboarding`), Staff policies (`staff_policy`), Operational checklists (`operational_checklist`), **Brand, voice and vision** (`brand_voice`: voice and tone, vision, mission and values, the words we use and avoid, how we write emails, key messages), General (`general`).

**The rule: approved content never changes silently.** Every edit, in HQ or from a chat app, is saved as a **new version, as a draft**. Staff keep reading the last **approved** version until a director or administrator approves the draft; then the previous approved version is kept in the history as "Previously approved". A brand-new document starts as a draft and is marked **Draft, not yet approved** everywhere (the list, its page, Today and every chat answer). The database enforces this for every writer: a saved version's words can never be changed, and the approved title and summary change only together with a newly approved version.

**Who can do what** (data in `hq.role_capabilities`; **an assumption for the owner to confirm**):

| Role | `knowledge.read` | `knowledge.write` (write, edit drafts, restore an older version as a draft, discard own draft, owner / review date / category) | `knowledge.approve` (approve, discard anyone's draft, archive, restore) |
|---|---|---|---|
| Director, Administrator | yes | yes | yes |
| Senior Property Manager, Property Manager, Business Development Manager, Virtual Assistant | yes | yes | no |
| Junior Property Manager, Read-only | yes | no | no |

A reader sees the approved text (or the draft of a never-approved document, marked as a draft) and the approved and previously approved versions. People who can write also see waiting drafts, replaced and discarded versions. Archived documents are seen only by approvers (to restore them).

**Using it.**

- **Find:** a search box (title, summary and the approved text, or a number like `KB-0004`) and a **Filter** button: category, status (approved, draft never approved, waiting for approval), owner, "review due" (overdue or within 30 days). One row per document from 768px; one card per document on a phone.
- **Write a document:** Knowledge, **Write a document**. Title, category, summary, owner (default you), review date, the text (headings `#`/`##`/`###`, `- bullets`, `1. steps`, `- [ ] checklist items`, `**bold**`, `*italic*`, `[links](https://...)`, `---`; nothing else is formatted, raw HTML and images are shown as text). It is saved as a draft.
- **A document's page:** the approved text (rendered safely: no HTML is ever inserted, links only to http, https and mailto), a banner when a newer draft is waiting (**View draft** for writers, **Review and approve** for approvers) or when the document has never been approved, the details (owner, review date with Overdue / Due soon, approved version and by whom), and the **Version history** (who, when, in HQ or through a chat app, the note, status, approver).
- **Edit:** shows which version you are editing and saves the next version as a draft. A note saying what changed is required. If someone else saved meanwhile, nothing is saved and you are asked to reload.
- **A version's page** (`/hq/knowledge/<id>/versions/<n>`): what changed since the version before it (a plain summary and a line-by-line diff), and its text. From here: **Approve** (the waiting draft; approvers), **Discard draft** (your own, or any for approvers), **Restore as draft** (copies an older version into a new draft; nothing approved changes).
- **Archive / Restore** (approvers): reversible; nothing is erased and every version is kept.
- **Today:** approvers get one line, "Needs approval: ...", when a written draft is waiting (unwritten starter templates are not counted).

**Starter templates.** Migration 0138 adds one clearly labelled draft per category, titled `[Template] ... (replace me)`, plus five for brand, voice and vision (Voice and tone; Vision, mission and values; Words we use and words we avoid; How we write emails; Our key messages). They contain headings and prompts in square brackets only: **no policy, price, legal or compliance content was invented**. A template cannot be approved until someone has replaced its text; archive any that are not wanted.

**Approving from chat (warning).** `knowledge_chat_approve_enabled` is **off** by default. A director can switch it on in **Settings > AI and connected apps > Knowledge base** (the owner intends to at deploy). When on, a director or administrator can approve a knowledge draft from ChatGPT or Claude after the chat shows what changed and they say yes; nobody looks at the document in HQ first, and an approved document is what every member of staff follows. Edits from chat are always drafts either way. Off, `approve_knowledge` changes nothing and returns the HQ link, and the database refuses an approval made with a connected-app token.

**Through ChatGPT or Claude:** twelve tools let the owner keep the whole knowledge base up to date from chat (list, search, open, versions and diffs, write, update by section, restore a version, discard a draft, approve when switched on, archive and restore), and the assistants check the approved `brand_voice` documents before drafting an email. See [hq-mcp.md section 11](hq-mcp.md#11-testing-the-knowledge-base-from-chatgpt).

**How it is protected.** Tables `hq.knowledge_documents` and `hq.knowledge_versions` (append-only words; only the status moves), view `hq.knowledge_overview` (security invoker). RLS enabled and forced; the API may only read; every write goes through `create_knowledge_document`, `edit_knowledge_document`, `approve_knowledge_version`, `discard_knowledge_draft`, `set_knowledge_review`, `restore_knowledge_version` and `archive_record` / `restore_record` (entity `knowledge_document`), which check the capability and the second sign-in step, pin their search path and write audit events (`entity_type = 'knowledge_document'`: create, edit, approve, discard_draft, restore_version, update, archive, restore). Migrations `0138_hq_knowledge.sql`, `0139_hq_function_acl_knowledge.sql`; tests `supabase/tests/hq_15_knowledge.sql` (155 tests), `lib/hq/knowledge/*.test.mts` (renderer, diff, targeted edits, rules, form), `lib/hq/mcp/tools/knowledge-schemas.test.mts`.

**Not yet:** knowledge documents in the global search (`Cmd/Ctrl+K`; the Knowledge page and `search_knowledge` cover it), attachments and images, nested lists and tables in the text, notifications when a review date passes (it shows as Overdue in the list and on the page).

## Meetings

**What it does.** HQ > Meetings keeps meetings: a short summary (shown in lists and on Today), the minutes, decisions, who was there, the records it was about, and actions that are real tasks. The top of the page shows this week's meetings as cards and the open actions from meetings (with Done); below is every meeting with search and a Filter button. Each linked contact, organisation, lead or contractor page shows a small Meetings list, and Today shows one "Recent meetings" line.

**How meetings get in.** Mostly from chat: tell ChatGPT or Claude about the meeting (or paste notes or a transcript from your own recording tool) and ask it to save the minutes to Planted HQ (docs/hq-mcp.md section 12). The assistant writes the minutes and summary; HQ stores them. Or use Record a meeting in HQ. **HQ does not record audio, has no AI of its own, and never stores a transcript: only the minutes.**

**Consent.** Recording a conversation can need the consent of the people in it (South Australia has a surveillance devices law). Check what applies before recording a meeting with any tool. This is a note, not legal advice.

**Roles (an assumption to confirm).** `meetings.read` and `meetings.write`: director, administrator, senior property manager, property manager, business development manager, virtual assistant. Junior property managers and read-only: no access. Actions also need `tasks.write`; adding a meeting decision to the Decisions register needs `decisions.write` (directors and administrators). Archiving and restoring a meeting is on its HQ page, never from chat.

**Confidential meetings** are visible only to the team members who attended, the person who saved it, and directors and administrators (`audit.read`). They do not appear for anyone else in Meetings, Today, record pages or chat lists. Only the person who saved it, or a director or administrator, can change the setting. Their action tasks stay visible to the person they are assigned to (in Tasks, as tasks).

**Touch points.** Saving a meeting linked to a contact, organisation, lead or contractor logs ONE normal interaction on each (an office meeting; a coffee meeting when the location says coffee or cafe; a phone call when it says phone or call), so last contact and the referral partner views update. Editing the meeting updates that interaction; it never adds a second. An organisation whose linked contact belongs to it is logged through that contact (one row, not two). A confidential meeting's interaction says only that a confidential meeting happened. Unlinking or archiving archives the interaction. Saving a meeting is allowed to log these interactions even for a role that cannot log calls itself (for example a senior property manager): the meeting is the record.

**History.** Every change is a new version (who, when, through HQ or a chat app, the note, and a copy of the summary and minutes), readable on the meeting page. An edit is refused if someone saved a newer version first.

Database: migrations `0140_hq_meetings.sql` and `0141_hq_function_acl_meetings.sql`; tests `supabase/tests/hq_16_meetings.sql`.

## Known limitations and open decisions

- **`update_staff` cannot clear a field.** A null argument means "leave unchanged", so responsibilities and start date can be changed but not blanked.
- **`management_reference` can only be set at signing.** Add it later through a new database function if wanted.
- **`growth_summary.referrals_received` counts further claims too.** A prospect claimed by two partners counts as two received, so conversion is signed divided by two. The overview says so.
- **Archiving a sole referral leaves its opportunity live.** The opportunity still counts but is invisible on the board.
- **`partner_performance` is per organisation.** Referrals from independent contacts with no organisation appear in the register and pipeline but not there.
- **Global search matches names only.** Categories are not searched.
- **Prospect picker** shows the 300 newest prospects, not a server-side search.
- **Ailo:** not connected, and no public API is known. HQ stores only the Ailo reference and set-up status typed by a person (see Portfolio above and `lib/hq/integrations/ailo.ts`).

## What was verified, and what was not

Verified: the database from scratch (772 passing tests, including the double-count proof and the import), unit tests, types, lint, a production build, every Server Action replayed as forged requests by read-only and junior personas, MFA on and off, the sign-in flow end to end, layouts at 375, 768 and 1280 widths.

Not verified: the full sign-in and multi-factor flow on the live project; Safari and Firefox; a screen reader (axe-core was used on the design system); the Resend or SMS paths; a real unique-primary race; the effect of a 429 rate-limit from Supabase.
