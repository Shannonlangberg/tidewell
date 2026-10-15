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
| Settings, Profile, Audit | `/hq/settings`, `/hq/profile`, `/hq/settings/audit` | Timezone, MFA, dashboard layout, audit log for directors and administrators. |
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
- **AI is not part of Phase 1.** When it arrives it will receive only what a validated tool returns, never raw tables.

## Going live (nothing here has been done)

Do these in order. Nothing in HQ requires production access until you choose to do this.

1. **Create the Supabase project in the Sydney region (`ap-southeast-2`).** The region cannot be changed later, and HQ holds personal information. Choose the organisation deliberately.
2. **Apply the migrations:** `supabase link --project-ref <ref>` then `supabase db push`.
3. **Expose the `hq` schema:** in the project's API settings add `hq` to the exposed schemas. Confirm an anonymous request to it is **denied** (the test suite proves this locally).
4. **Auth settings** (the dashboard does not read `supabase/config.toml`):
   - Turn **off** public sign-ups.
   - Email sign-in with a six-digit code, ten-minute expiry. Copy the subject and body from `supabase/templates/otp.html` into the *Magic link* email template.
   - Connect your own SMTP (for example Resend). The built-in sender allows only a couple of emails an hour.
   - Turn on **TOTP** multi-factor.
   - Add Cloudflare Turnstile keys (the local ones are test keys that always pass).
   - Enable the **password verification hook** (it refuses password sign-in). It currently lives in the parked Tidewell migrations (see below).
   - Use **asymmetric JWT signing keys**. In production HQ rejects tokens signed with a shared secret.
5. **Netlify environment variables:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. Never put the secret key in client code. `netlify.toml` already declares the Next.js plugin, which must stay.
6. **Create the first director:**
   ```bash
   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SECRET_KEY=<secret> \
     npm run hq:bootstrap -- --email you@yourdomain --name "Full Name" --confirm
   ```
   It refuses to run if any staff already exist. Everyone else is invited from **People → Invite**.
7. **Load the research leads:** sign in, open **Growth → Import**, choose **Load the research leads file**, review, and confirm. They arrive as "Identified" and "Needs verifying".
8. **Domain:** `hq.planted.com.au` needs the domain, a Netlify domain alias and a rewrite to `/hq`. Until then HQ lives at `/hq`.

## Known limitations and open decisions

- **The parked Tidewell schema ships alongside.** HQ's database objects are in their own schemas and depend on nothing in Tidewell's tables, **except** the password-refusal hook, which lives in a Tidewell migration. If you retire Tidewell, move that hook into an HQ migration first. A fresh hosted project for HQ alone is the cleaner option.
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

Not verified: behaviour on a real hosted Supabase project and on Netlify; Safari and Firefox; a screen reader (axe-core was used on the design system); the Resend or SMS paths; a real unique-primary race; the effect of a 429 rate-limit from Supabase.
