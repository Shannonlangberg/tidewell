# Tidewell

Marketing site and app for Tidewell: holiday home management on the Copper Coast, South Australia.
Personal project; not connected to any Futures Church accounts, repos or services.

Next.js 16, React 19, TypeScript. No database yet.

## Run it locally

```bash
npm install
```

```bash
npm run dev
```

Then open http://localhost:3210. `npm run build` then `npm start` runs the production build.

## What's where

- `app/page.tsx` — the homepage
- `app/layout.tsx` — page title, description, Open Graph
- `app/globals.css` — design tokens and styles (tokens come from `design/README.md`)
- `lib/site.ts` — **the facts the site states about the business.** Phone, email, URL, legal name and ABN are `null` until confirmed, and anything null is hidden everywhere it would appear.
- `components/EnquiryForm.tsx` — enquiry form, submitted to Netlify Forms (form name `enquiry`)
- `public/__forms.html` — hidden copy of the form so Netlify detects it at deploy time. Keep its field names in sync with the component.
- `app/thanks/page.tsx` — where the form lands without JavaScript
- `app/privacy/page.tsx` — draft privacy page
- `app/app/` — **the Tidewell app** (one app, one login; tabs change with role). Installable web app, not indexed by search engines.
  - `/app` — sign in (demo: pick a person)
  - `/app/owner` — Home, Bookings, Repairs, Money
  - `/app/tenant` — Home, Rent, Repairs, Papers
  - `/app/crew` — Jobs (cleans + trade jobs), Pay. A clean can't be marked done until every room is photographed.
  - `/app/manager` — Today, Inbox, Homes (+ 8-week pricing pass), Jobs (roster + repairs board), Owners, Month close
  - `/app/more` — shared across roles
- `app/stay/[token]` — guest stay link, no login (`/stay/demo`)
- `lib/demo.ts` — all sample data, dates relative to today. The app shows a "Demo" flag while this is the source.
- `design/` — the original handoff bundle. Read `design/README.md` first.

## Deploy on Netlify

1. In Netlify choose **Add new site, Import an existing project** and connect the GitHub repo. The repo is private, so give Netlify access to it.
2. Build command `npm run build`, publish directory `.next` (both set in `netlify.toml`). Netlify's Next.js runtime is detected automatically.
3. After the first deploy, open **Forms** and confirm the `enquiry` form is listed. If it isn't, enable form detection and redeploy.
4. Under **Forms, Form notifications**, add an email notification so enquiries reach Shannon and Court. Without this they only sit in the Netlify dashboard.
5. Add the custom domain under **Domain management** once it's chosen.

The form only sends once deployed. Locally it shows "That didn't send", which is expected.
Without JavaScript the form posts normally and Netlify redirects to `/thanks`.

## Try the app on a phone

Open `/app` in Safari, then Share, Add to Home Screen. More › switch person to see each role.
Owner's More › Demo season switches busy / quiet. More › Appearance forces light/dark.

## Pre-launch checklist

Nothing on the public site is invented. Everything below is either confirmed or hidden.

- [ ] Domain and business name decided and registered
- [ ] `lib/site.ts`: set `url` (turns on canonical Open Graph URLs and the JSON-LD `url`)
- [ ] `lib/site.ts`: set `phone` and `email` (adds the "or just get in touch" block and the footer contact column)
- [ ] `lib/site.ts`: set `legalName` and `abn` (adds the legal line in the footer)
- [ ] Any licence or council registration wording added to the footer **only once it is true**
- [ ] Every promise on the page is true on launch day:
  - [ ] Live dashboard exists and owners can use it
  - [ ] Photos of every room after every clean
  - [ ] Replies inside the hour, 8am to 10pm
  - [ ] No lock-in after the first Easter
- [ ] Prices confirmed: 18% of accommodation revenue plus GST, setup $3,000 to $5,000
- [ ] FAQ answers read through and confirmed (especially "Can I keep my existing listing?")
- [ ] Hero photo confirmed as one you have the right to use, and more real photos added
- [ ] Privacy page checked, and the business name and a contact address added to it
- [ ] Open Graph image added (`app/opengraph-image.png`, 1200×630) and `twitter.card` switched to `summary_large_image`
- [ ] Netlify form notification tested with a real enquiry
- [ ] A real send tested with JavaScript off (should land on `/thanks`)

## Still open

- The app has no real login or backend. Approvals and questions live only in that browser (localStorage).
- Photo tiles in the app are striped placeholders until the cleaner app supplies real room photos.
- Statements / Tax pack buttons are disabled placeholders.
- Tradie as a job type inside the crew app (built that way) vs its own role.
- Can one person be both manager and owner and switch without logging out? (demo lets anyone switch)
- Money flow: the site says "we never hold your money", but the Owner money screen nets off our fee and repairs. Which is it?
- Logo tide-fill (see `design/README.md`).
- Long-term letting and property care were on the design handoff but are off the public site until the agent's licence is granted and the price is set.

## Brand notes

Tokens, type and voice are in `design/README.md`. The tagline is fixed: **Holiday homes, kept well.**
Never the word "shack". Never invent statistics, addresses, prices or contact details.
