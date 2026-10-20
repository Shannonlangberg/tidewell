# PLANTED.

The marketing website for **PLANTED.** — long-term residential property management on the
Copper Coast, South Australia.

The business is not yet trading. Nothing on the public site is invented: no phone number, no
email address, no ABN, no licence number, no statistics, no testimonials, no fees. Anything
that is not yet confirmed is held as `null` in `lib/planted.ts` and every component that would
show it hides itself instead. That rule is the point of the whole setup — read
[Contact details and business facts](#contact-details-and-business-facts) before changing
anything.

Personal project. Not connected to any Futures Church accounts, repos or services.

The repository is still named `tidewell` because it began as one: Tidewell was a holiday-home
management business, and its product app is deliberately kept here, parked. See
[Project structure](#project-structure).

---

## Planted HQ (staff portal)

The private operating system for the company lives at `/hq`: referral partner CRM, referral tracking, the leads pipeline (direct leads, landlord contacts, next steps), tasks, people and a role-aware dashboard. It is separate from the public site and requires a staff login.

- Setup, deployment and security model: [docs/hq-setup.md](docs/hq-setup.md)
- The plan and the reasoning: [docs/hq-design.md](docs/hq-design.md)
- The brand, which every screen follows: [docs/brand-design-system.md](docs/brand-design-system.md)

Quick start: `supabase start -x logflare,vector`, `npm run hq:seed`, `npm run dev`, then open `/hq/sign-in`.

## The stack

| | |
| --- | --- |
| Framework | Next.js 16, App Router, React 19, TypeScript (strict) |
| Styling | Tailwind CSS v4, configured entirely in `app/(site)/planted.css` via `@theme` |
| Type | Cormorant Garamond (display) and DM Sans (text), loaded with `next/font/google` |
| Forms | React Server Actions; delivery by Resend or a webhook (see [Connecting the enquiry forms](#connecting-the-enquiry-forms)) |
| Spam | Honeypot, a fill-timer, and Cloudflare Turnstile when its keys are set |
| Hosting | Netlify, via `@netlify/plugin-nextjs` |
| Database | Supabase — used only by the parked Tidewell app, not by this site |

There is no CMS. Content lives in the page files and in `lib/planted.ts`.

> **Read `AGENTS.md` first if you are an AI agent working in here.** This version of Next.js has
> breaking changes relative to most training data; the bundled docs in `node_modules/next/dist/docs/`
> are the authority.

---

## Run it locally

```bash
npm install
npm run dev
```

Then open <http://localhost:3210>. (Port 3210, not 3000 — it is set in `package.json`.)

```bash
npm run build && npm start   # the production build, also on 3210
npx tsc --noEmit             # type-check
npm run lint                 # ESLint
```

No environment variables are needed to run the marketing site. Copy `.env.example` to
`.env.local` when you want enquiry delivery, Turnstile, or the parked app's Supabase stack —
that file documents every variable the project reads and what happens when each is absent.

---

## Project structure

```
app/
  (site)/              THE PUBLIC PLANTED. SITE — everything below is this
    layout.tsx         header, footer, shared metadata
    planted.css        the whole design system (Tailwind v4 @theme + custom classes)
    page.tsx           /
    property-management/
    why-planted/
    our-approach/
    areas-we-serve/    index + [slug] template, driven by AREAS
    about/
    rental-appraisal/  the appraisal form
    contact/           the general enquiry form
    enquiry-received/  shared success page (noindex)
    privacy/  terms/   the legal pages
    enquiry-actions.ts the Server Actions both forms post to

  sitemap.ts           public routes only — excludes /app, /stay, /api, /enquiry-received
  robots.ts            allows the site, disallows the same four
  manifest.ts          name, colours and icons for the PLANTED. site
  icon.tsx             the "P." monogram favicon (ImageResponse)
  apple-icon.tsx       the same monogram at 180px
  layout.tsx           minimal root: the document and the two typefaces, nothing visual

  app/   stay/   api/  pwa-icon/     ── THE PARKED TIDEWELL APP, see below ──

components/planted/    every component the public site uses
  ui.tsx               Section, SectionHead, Label, Button, RuleLink, PhotoPlaceholder
  Header.tsx  Footer.tsx  Logo.tsx  Icons.tsx
  AreaCard.tsx         the suburb card and the photograph registry
  AppraisalForm.tsx  ContactForm.tsx  form-fields.tsx
  FAQ.tsx  Testimonials.tsx

lib/
  planted.ts           ★ the single place business facts live
  enquiries.ts         validation, spam screening and delivery for both forms
  supabase/  auth.ts  roles.ts  demo.ts  …   the parked app

public/photos/         the four real photographs
design/                the original Tidewell handoff bundle (historical)
docs/                  the Supabase backend design for the parked app
supabase/              migrations, seed and tests for the parked app
```

### The design system

`app/(site)/planted.css` is imported by `app/(site)/layout.tsx` and **only** by it, so Tailwind's
preflight never reaches the parked app. It defines the palette as `@theme` tokens (`charcoal`,
`ivory`, `stone`, `taupe`, `clay`, `softwhite`, `line`, plus the contrast-safe `ink-muted` and
`clay-deep`) and a short list of classes: `shell`, `section`, `display`, `label`, `lede`,
`prose-measure`, `rule`, `btn`, `link-rule`.

Two rules worth knowing before you write markup:

- **Body text on a light background is `text-ink-muted` or `text-charcoal`.** `grey`, `clay` and
  `taupe` fail WCAG AA at body size on ivory; the CSS says so in a comment, and `ink-muted` and
  `clay-deep` exist to do that job.
- **The custom classes are unlayered CSS and Tailwind utilities are in `@layer utilities`, so the
  custom class wins.** `className="section pt-36"` will not change the top padding, and
  `className="lede text-charcoal"` will not change the colour. Where a page needs to override
  one of them — the legal pages need `pt-36` on their first section to clear the fixed header —
  use a plain `<section>` with Tailwind classes rather than the `Section` component.

### The parked Tidewell app

`app/app/`, `app/stay/`, `app/api/`, `app/pwa-icon/`, `components/app/`,
`components/SessionKeeper.tsx`, `lib/supabase/`, `lib/auth.ts`, `lib/site.ts`, `lib/demo.ts`,
`lib/humanTouch*.ts`, `docs/` and `supabase/` are **Tidewell**, the earlier holiday-home
management product. It is kept here **on purpose**:

- It is behind sign-in and is **not part of the marketing site**. No PLANTED. page links to it.
- It is **not indexed**: `app/robots.ts` disallows `/app` and `/stay`, and `next.config.mjs`
  and `netlify.toml` send `X-Robots-Tag: noindex, nofollow` on the guest stay pages.
- It keeps its own styling (`app/app/app.css`), outside the `(site)` route group, so the two
  design systems never collide.
- It has its own Supabase schema, documented in `docs/backend-design.md`.

Do not delete it, do not restyle it, and do not link to it from the public site. If you are
working on the marketing site, you never need to touch any of it.

---

## How to update content

There is no CMS, and that is deliberate for a site this size. Content lives in two places:

1. **`lib/planted.ts`** — the brand, the contact facts and the list of service areas. Anything
   stated as fact about the business belongs here, not in a page.
2. **The page files under `app/(site)/`** — the prose. Each page is a single server component
   with its own copy inline and its own `export const metadata`.

When you edit a page, keep the rhythm the rest of the site uses: a `Label` eyebrow, a
`display display-lg` heading, prose inside `prose-measure`, hairline rules instead of cards, and
sharp corners throughout. `components/planted/ui.tsx` has the pieces; `app/(site)/page.tsx` is
the reference for how they go together.

Before you add a sentence, check it against the honesty rule: **if it is a claim, it has to be
true on the day it is published, and provable.** No statistics without a source. No "trusted by",
"leading", "award-winning" or "years of experience" until each is a fact.

---

## Contact details and business facts

Everything the site asserts about the business is in **`lib/planted.ts`**:

```ts
export const CONTACT = {
  phone: null,          // e.g. "0400 000 000"
  email: null,          // e.g. "hello@plantedgroup.com.au"
  url: null,            // e.g. "https://plantedgroup.com.au"
  legalName: null,      // e.g. "Planted Property Group Pty Ltd"
  abn: null,            // e.g. "ABN 00 000 000 000"
  licenceNumber: null,  // South Australian land agent registration
  businessHours: null,
  address: null,
};
```

**`null` means hidden.** Every component that would display one of these checks it first: the
footer drops the contact column, the legal pages point at `/contact` instead of a privacy
address, the terms page lists the business details it does not yet have, and
`hasPublicContact` turns off anything that needs a phone or an email.

**Nothing may be invented.** Not as a placeholder, not "just for the design", not "we'll fix it
before launch". A fabricated ABN or licence number on a property management website is a false
representation about a regulated business. Set a value only when it is real.

Two values turn on more than text when you set them:

- `CONTACT.url` sets `metadataBase`, which makes canonical and Open Graph URLs absolute, and is
  the first choice for `app/sitemap.ts` and `app/robots.ts`. (`NEXT_PUBLIC_SITE_URL` is the
  fallback; if neither is set, both fall back to the obviously-fake placeholder origin
  `https://planted.invalid` so that a missing domain cannot quietly produce a broken link.)
- `CONTACT.legalName`, `abn` and `licenceNumber` add the legal line to the footer and populate
  clause 10 of `/terms`.

`BRAND` holds the name, the descriptor and the tagline. **The tagline is fixed:**
*A better place for your property.* Do not reword it.

`SOCIAL` is an empty array and stays empty until an account actually exists.

---

## Photography

Real photographs live in `public/photos/`. There are **four**:

| File | Used on |
| --- | --- |
| `12-bayview-road.jpg` | the homepage hero, and the Moonta Bay area card |
| `port-hughes.jpg` | the homepage feature band, and the Port Hughes area card |
| `wallaroo.jpg` | `/our-approach`, and the Wallaroo area card |
| `north-beach.jpg` | the North Beach area card |

`components/planted/AreaCard.tsx` holds the registry that maps a suburb slug to a photograph,
together with its alt text. **Four photographs for six areas**, so Kadina and Moonta get
`PhotoPlaceholder` — a visibly striped block that reads unmistakably as a placeholder. That is
on purpose: a coastal photograph next to an inland town would be a quiet lie, and no stock image
is ever passed off as the business's own work. `/about` uses a placeholder for the founder
portrait for the same reason.

### Replacing or adding photography

1. Drop the file into `public/photos/` as a web-sized JPEG (roughly 2000px on the long edge).
2. Add or update the entry in `AREA_PHOTOS` in `components/planted/AreaCard.tsx`, including
   **alt text that describes what is actually in the frame** — not what we would like a visitor
   to believe about it.
3. Replace the matching `PhotoPlaceholder` where one is standing in.
4. Record where the photograph was taken and who owns it. The current four are identified only
   by their file names; confirm them, particularly `12-bayview-road.jpg`, before launch.

### Image direction

Contemporary Australian coastal residential architecture. Warm natural light — early morning or
the hour before dusk. Real houses in real streets, photographed straight. Texture: limestone,
weathered timber, iron roofs, salt-tolerant planting, sand and sea where it is honestly there.

Not: handshakes, people in suits holding keys, sold stickers, families jumping on a lawn,
front-door-key close-ups, model homes, or anything that looks like it came off a stock library.
No photograph may be captioned or implied to be a property PLANTED. manages until one is.

---

## Connecting the enquiry forms

Both forms — `/rental-appraisal` and `/contact` — post to Server Actions in
`app/(site)/enquiry-actions.ts`, which validate and screen the submission with `lib/enquiries.ts`
and then try the delivery adapters **in order**. The first that is configured and succeeds wins.

| Variable | What it does | When it is absent |
| --- | --- | --- |
| `RESEND_API_KEY` | Resend key (`re_…`); with `ENQUIRY_TO_EMAIL`, enquiries are emailed | email adapter skipped |
| `ENQUIRY_TO_EMAIL` | the address enquiries go to; required for the email adapter | email adapter skipped |
| `ENQUIRY_FROM_EMAIL` | the sender; its domain must be verified in Resend | falls back to Resend's shared `onboarding@resend.dev`, which only delivers to the Resend account owner |
| `ENQUIRY_WEBHOOK_URL` | HTTPS endpoint that receives the enquiry as JSON — the hook for a CRM later | webhook adapter skipped |
| `ENQUIRY_WEBHOOK_SECRET` | sent as the `X-Enquiry-Secret` header so the receiver can authenticate | posted without that header |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Cloudflare Turnstile site key, read by the form pages | the widget is not rendered |
| `TURNSTILE_SECRET_KEY` | verified server-side on every submission | the Turnstile check is skipped entirely |
| `NEXT_PUBLIC_SITE_URL` | the site's origin, for `sitemap.ts` and `robots.ts` | falls back to `CONTACT.url`, then to the `https://planted.invalid` placeholder |

**With none of them set:**

- In **development**, the enquiry is printed to the server console and treated as delivered, so
  the forms can be exercised end to end.
- In **production**, delivery **fails**. The person is told the form is not connected yet, and
  the server logs exactly which variables are missing.

**The rule: the form must never show success when delivery is not configured.** `lib/enquiries.ts`
returns an explicit `{ ok: false }` rather than a cheerful message, and the forms honour it. If
you add an adapter, keep that property — a lost enquiry that looked like it sent is worse than
a form that admits it is not ready.

One thing to fix before the Turnstile keys go live: `next.config.mjs` currently allows the
Turnstile script and iframe on `/app` only. `/rental-appraisal` and `/contact` need the same
Content-Security-Policy exception, or the widget will be blocked.

---

## Adding a new suburb page

Add an entry to `AREAS` in `lib/planted.ts`:

```ts
{
  slug: "paskeville",
  name: "Paskeville",
  intro: "One sentence of genuine local context.",
  character: "What makes managing here specific. Qualitative only.",
}
```

That is the whole job. The `[slug]` template renders the page, the index at `/areas-we-serve`
lists it, the footer and the homepage pick it up, and `app/sitemap.ts` publishes it — all from
the same array.

Two things it does **not** do automatically:

- **A photograph.** Add one to `AREA_PHOTOS` in `components/planted/AreaCard.tsx` if a real one
  exists; otherwise the page shows a placeholder, which is the correct outcome.
- **The suburb's dropdown entry on the appraisal form.** That list is derived from `AREAS` in
  `lib/enquiries.ts`, so it follows — but check the form after adding one.

No rental yields, vacancy rates, median rents or growth figures. Qualitative local knowledge
only, unless there is a cited, current source and a reason to publish it.

---

## Adding a future division

PLANTED. is intended to grow into a group: **PLANTED. STAYS**, **PLANTED. SERVICES**,
**PLANTED. DEVELOPMENTS**, **PLANTED. CAPITAL**. The site is built so that each one can arrive
without a redesign.

Add a route group beside `(site)`:

```
app/
  (site)/      the property management site
  (stays)/     a new division — its own layout.tsx, importing the same planted.css
```

Reuse `components/planted/` and the design system unchanged. `BRAND.groupDescriptor`
("Property Group") exists for the group-level wordmark when there is a group. The division's own
facts go in a new constant beside `CONTACT`, following the same `null` means hidden rule.

**Do not advertise a division until it is a real business.** Not a "coming soon" panel, not a
greyed-out nav item, not a footer link. Each of those four names implies a licensed or
capitalised activity — short-stay management, trade services, development, finance — and listing
one before it exists is a claim about the business that is not true. They are a structural plan,
not marketing copy.

---

## Deploying on Netlify

1. **Add new site → Import an existing project**, connect the GitHub repo (it is private, so give
   Netlify access to it).
2. Build command `npm run build`, publish directory `.next`. Both are already set in
   `netlify.toml`.
3. **`netlify.toml` declares `@netlify/plugin-nextjs` explicitly, and that declaration is
   load-bearing.** The site was created before Next.js was in the repo, so Netlify never
   auto-enabled the runtime. Without the plugin, Netlify uploads the raw `.next` folder as static
   files and **every page 404s**. Do not remove it, and do not assume auto-detection will cover it.
4. Set the environment variables under **Site configuration → Environment variables** — at
   minimum `NEXT_PUBLIC_SITE_URL`, and the enquiry delivery variables. See `.env.example`.
5. Add the custom domain under **Domain management**, then set `CONTACT.url` in `lib/planted.ts`
   to the same origin and redeploy so canonical URLs, the sitemap and `robots.txt` all agree.
6. After the first deploy, check `/sitemap.xml`, `/robots.txt` and `/manifest.webmanifest`, and
   send a real test enquiry through `/contact`.

Security headers are set in two places and should be kept in step: `next.config.mjs` (the
Content-Security-Policy and the no-index headers on `/stay`) and `netlify.toml` (the same
`/stay` headers plus `X-Content-Type-Options`, `X-Frame-Options` and `Referrer-Policy`). There is
no `proxy.ts` — see the comment at the top of `next.config.mjs` for why.

---

## Pre-launch checklist

Nothing goes live until every box here is ticked. The site is honest by construction; this is the
list that keeps it that way once there are real facts to put in it.

### The business exists

- [ ] Business name registered, and trade mark availability for **PLANTED.** confirmed
- [ ] **South Australian land agent registration / property manager registration obtained.** This
      must be granted before managed services are *offered or advertised*, not merely before they
      are delivered — the site itself is an advertisement
- [ ] Trust account arrangements in place, with the audit and reporting obligations that come
      with them understood
- [ ] Professional indemnity insurance in force (and public liability, if the advisers say so)
- [ ] Legal entity and ABN confirmed, and the entity is the one named on the site

### The site tells the truth

- [ ] Every value in `lib/planted.ts` set: `phone`, `email`, `url`, `legalName`, `abn`,
      `licenceNumber`, `businessHours`, `address`
- [ ] `/privacy` and `/terms` reviewed by a qualified adviser, every "Before launch" note on both
      pages resolved, and the `LAST_UPDATED` constant on each page updated
- [ ] A dedicated privacy contact published — an address for access, correction and complaints
- [ ] The overseas-disclosure clause names the actual providers and the countries they store in
- [ ] Every claim on every page read through and confirmed true on launch day
- [ ] **No statistics, testimonials, fees or licence numbers appear anywhere on this site, and
      none may be added without a verifiable source.** A number without a citation, a quote
      without a named client who agreed to it, or a licence number that has not been granted is
      not a draft — it is a false claim

### The site works

- [ ] `NEXT_PUBLIC_SITE_URL` set in Netlify and the custom domain connected, with `CONTACT.url`
      matching; confirm `/sitemap.xml` and `/robots.txt` no longer mention `planted.invalid`
- [ ] Enquiry delivery connected (`RESEND_API_KEY` + `ENQUIRY_TO_EMAIL`, or
      `ENQUIRY_WEBHOOK_URL`) with a verified `ENQUIRY_FROM_EMAIL`, and **a real test enquiry sent
      and received** from both `/rental-appraisal` and `/contact`
- [ ] Turnstile keys set, and the CSP exception in `next.config.mjs` extended to
      `/rental-appraisal` and `/contact`
- [ ] Open Graph image added (`app/(site)/opengraph-image.png`, 1200×630) — there is none yet
- [ ] Real photography added, every placeholder replaced or deliberately kept, and the
      provenance of all four existing photographs confirmed
- [ ] `/app` and `/stay` confirmed absent from `/sitemap.xml` and disallowed in `/robots.txt`
- [ ] `npx tsc --noEmit`, `npm run lint` and `npm run build` all clean

---

## Still open

- **Links from the parked app into the public site.** `components/app/SignInForm.tsx` and
  `app/app/more/page.tsx` both link to `/privacy`, which is now the PLANTED. policy. Clause 01 of
  that policy says it covers the public website and not the signed-in area, so the statement is
  true, but the parked app arguably needs its own policy or those links need to change.
- **`app/pwa-icon/route.tsx`** still draws the Tidewell tag mark via `lib/icon.tsx`. It is no
  longer referenced by `app/manifest.ts`, which is now the PLANTED. site's manifest. Left in
  place; the parked app's install story is a separate decision.
- **`lib/site.ts`** is the old Tidewell facts file. Still imported by the parked app
  (`app/stay/[token]/page.tsx`, `app/app/more/page.tsx`); superseded by `lib/planted.ts` for
  everything public.
- **`components/Mark.tsx`** has no importers left. It was the Tidewell logo mark used by the
  retired `/privacy` and `/thanks` marketing pages, which are now deleted. Safe to remove, but
  it is the parked app's mark, so that is the lead's call.
- **`docs/backend-design*.md`** still describe the Tidewell enquiry flow redirecting to
  `/thanks`. That route no longer exists. The documents are a historical record of the parked
  app's design, so they have been left as they are.
- The money-flow question carried over from Tidewell is unresolved and does not appear anywhere
  on the PLANTED. site.
