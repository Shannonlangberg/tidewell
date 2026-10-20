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

### Signing in until an email sender is connected

Supabase's built-in email sender cannot send our branded six-digit code on the free plan (it can neither change the template nor send to anyone outside the project team). Until a custom SMTP sender (for example Resend, with a verified domain) is connected:

- The person opens `/hq/sign-in` and enters their address, then goes on to the code screen.
- A director with the project's secret key runs `npm run hq:code -- --email <their address> --confirm`. The six-digit code lands on the clipboard of the machine that ran it, and is given to the person. It is valid for ten minutes, works once, only for active HQ staff, and the person still has to pass multi-factor sign-in.

To connect a sender: add an `[remotes.production.auth.email.smtp]` block to `supabase/config.toml` (host, port, user, `pass = "env(SMTP_PASS)"`, sender), put the password in the environment, run `supabase config push`, and the branded template in `supabase/templates/otp.html` is installed in the same push. Raise `[remotes.production.auth.rate_limit] email_sent` at the same time. Verify a sending domain before inviting anyone other than the account owner, because most providers only deliver to the owner's own address until then.

### What the free Supabase plan does not give you

- **No automatic backups or point-in-time recovery.** HQ will hold personal information; move the project to Pro before relying on it for real records.
- **No session time limits** (Pro and above). The base config asks for a 30-day limit and a 14-day inactivity limit; production overrides them to "none" so the push succeeds. Remove the override on Pro.
- **No password-refusal hook** (Team and Enterprise). Nobody is given a password and sign-up is off, and HQ returns nothing until multi-factor sign-in is complete, so a password route has nothing to unlock.
- **Projects pause after a week of inactivity.**
- **No Cloudflare Turnstile yet.** Captcha is off in production until real keys exist (the local test secret accepts anything). Add the site key to Netlify as `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, put the secret in `supabase/config.toml`'s production override, and turn it on.

## Connecting ChatGPT and Claude (MCP)

HQ is an **MCP server** at **`/mcp`** (`https://tidewellcc.netlify.app/mcp` in production). People chat in ChatGPT or Claude; those apps call HQ's tools, **as the person who connected them, with exactly that person's HQ permissions**. There is no AI model inside HQ and no OpenAI or Anthropic key. Design: [hq-mcp.md](hq-mcp.md).

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

The tools are in `lib/hq/mcp/tools/` (one file per group). Read tools: `search` and `fetch` (the two tools ChatGPT's connectors expect), contractors, contacts, organisations, tasks, referrals, the pipeline, who to contact, the team directory (names and roles), and reports (daily brief, growth report, contractor report, weekly report). Small single-record writes: tasks, logging a call/meeting/email/note, contacts, organisations, contractor details, contractor reviews, vetting steps, referrals, and moving an opportunity (never to signed). The Decisions register: list, search and open decisions (`decisions.read`), record and update one (`decisions.write`); see [Decisions register](#decisions-register). People refer to records by name; when a name matches more than one record, the tool returns the candidates and asks.

### Deliberately not available through a chat app

Approving, preferring, suspending, reinstating or deactivating a contractor; archiving or deleting anything (decisions included); document upload or download; imports; people and roles; settings; signing a management; anything that needs `people.admin` or `settings.admin`. These stay deliberate actions in the HQ screens.

### Switching it on (production)

1. **Supabase:** the OAuth server is **enabled on the live project**, with authorization path `/hq/oauth/consent` and dynamic registration on. It is recorded in the `[remotes.production.auth.oauth_server]` block in `supabase/config.toml`, which must stay so a later `supabase config push` keeps it (for another project: push that block, or Authentication > OAuth Server in the dashboard). The site URL must be `https://tidewellcc.netlify.app` (it is).
2. **Signing keys:** `/mcp` accepts only asymmetric tokens (ES256/RS256 from the JWKS) in production. Check Authentication > JWT Keys shows an asymmetric current key before connecting anything.
3. **Second step (read this first):** see the MFA limitation below. With `require_mfa` on, connected apps are refused; it is currently off on the live project by the owner's decision (see [The live project](#the-live-project)).
4. **The on/off switch:** `hq.settings.ai_enabled` is `false` by default, and every tool call is refused ("switched off") until a director switches it on. A director does this in **Settings > AI and connected apps** (`/hq/settings/ai`), which also sets the hourly limit and shows the log of every call (directors and administrators see everyone's calls; the database shows anyone else only their own). It writes the settings table as the director, like the other business settings, and the settings trigger audits it. The e2e script makes the same update from a director's session.
5. Optional environment variables on Netlify: `HQ_PUBLIC_ORIGIN` (for example `https://tidewellcc.netlify.app`; the origin the metadata advertises, otherwise taken from the request's host) and `HQ_MCP_WRITE_HOURLY_LIMIT` (see Limits).

### Connecting (at the time of writing; menu names change)

- **ChatGPT:** Settings, Connectors (Apps), Advanced, turn on Developer mode; then Create/Add a connector, MCP server URL `https://tidewellcc.netlify.app/mcp`, authentication **OAuth** (dynamic registration, no client id to paste). Sign in to HQ when asked and Approve.
- **Claude:** Settings, Connectors, Add custom connector, the same URL. Sign in to HQ and Approve.

### Disconnecting

Each person can see and disconnect their own apps on **Profile > Connected apps** in HQ. Disconnecting revokes the grant at Supabase: the app's refresh tokens stop working at once and it must ask again. An access token the app already holds keeps working **until it expires (one hour)**, because `/mcp` verifies tokens locally and cannot see a revocation sooner. To cut someone off immediately, deactivate them in People (their tokens then fail the staff check on the next call), or switch the connection off for everyone in **Settings > AI and connected apps**. A director cannot disconnect another person's app; that screen says so too.

### Limits

- **All calls:** `hq.settings.ai_hourly_limit` per person per rolling hour (default 40, 1 to 1000, set in **Settings > AI and connected apps**), enforced inside the database by `ai_begin_request`. Chat apps can call several tools per question, so a director may want to raise it. A refused call stores nothing.
- **Writes:** a lower cap per person per rolling hour, default 15, set with `HQ_MCP_WRITE_HOURLY_LIMIT` (1 to 200). Counted from the person's own logged write calls. A safety bound, not a business figure.
- Each tool must answer within 8 seconds; results are cut at 20,000 characters (with a note saying so); request bodies over 64 kB are refused; at most 200 argument elements per call.
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

## Known limitations and open decisions

- **`update_staff` cannot clear a field.** A null argument means "leave unchanged", so responsibilities and start date can be changed but not blanked.
- **`management_reference` can only be set at signing.** Add it later through a new database function if wanted.
- **`growth_summary.referrals_received` counts further claims too.** A prospect claimed by two partners counts as two received, so conversion is signed divided by two. The overview says so.
- **Archiving a sole referral leaves its opportunity live.** The opportunity still counts but is invisible on the board.
- **`partner_performance` is per organisation.** Referrals from independent contacts with no organisation appear in the register and pipeline but not there.
- **Global search matches names only.** Categories are not searched.
- **Prospect picker** shows the 300 newest prospects, not a server-side search.
- **Ailo:** not connected. See `lib/hq/integrations/ailo.ts` for the proposed interface and the questions to put to Ailo.

## What was verified, and what was not

Verified: the database from scratch (772 passing tests, including the double-count proof and the import), unit tests, types, lint, a production build, every Server Action replayed as forged requests by read-only and junior personas, MFA on and off, the sign-in flow end to end, layouts at 375, 768 and 1280 widths.

Not verified: the full sign-in and multi-factor flow on the live project; Safari and Firefox; a screen reader (axe-core was used on the design system); the Resend or SMS paths; a real unique-primary race; the effect of a 429 rate-limit from Supabase.
