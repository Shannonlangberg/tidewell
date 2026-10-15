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

## The live project

HQ runs on its own Supabase project, `planted-hq` (ref `wnejvqyqqfxdjkbmbrvs`), in **Sydney (ap-southeast-2)**, in a new organisation named PLANTED on the free plan. It holds HQ only: the parked Tidewell schema lives in `supabase/parked-tidewell/` and is never applied to it. The database password and keys are kept in `~/.planted-hq/` on the machine that set it up, outside the repository.

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
