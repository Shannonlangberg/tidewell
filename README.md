# Tidewell

Marketing site for Tidewell — property management on the Copper Coast. Personal project; not connected to any Futures Church accounts, repos or services.

```
npm install
npm run dev     # http://localhost:3210
```

- `app/page.tsx` — the homepage (built from `design/Tidewell Home.dc.html`)
- `app/globals.css` — design tokens + styles
- `components/EnquiryForm.tsx` — enquiry form, submitted to Netlify Forms (form name `enquiry`)
- `public/__forms.html` — hidden copy of the form so Netlify detects it at deploy time. Keep its field names in sync with the component.
- `app/app/` — **the Tidewell app** (one app, one login; tabs change with role). Installable web app.
  - `/app` — sign in (demo: pick a person)
  - `/app/owner` — Home, Bookings, Repairs, Money
  - `/app/tenant` — Home, Rent, Repairs, Papers
  - `/app/crew` — Jobs (cleans + trade jobs), Pay. A clean can't be marked done until every room is photographed.
  - `/app/manager` — Today, Inbox, Homes (+ 8-week pricing pass), Jobs (roster + repairs board), Owners, Month close
  - `/app/more` — shared across roles
- `app/stay/[token]` — guest stay link, no login (`/stay/demo`)
- `lib/demo.ts` — all sample data, dates relative to today. The app shows a "Demo" flag while this is the source.
- `design/` — the original handoff bundle. Read `design/README.md` first.

## Enquiries (Netlify Forms)
The form only sends once deployed on Netlify — locally it shows "That didn't send", which is expected.
After the first deploy: Netlify → Site configuration → Forms → enable form detection if it's off, then add an
email notification under Form notifications so enquiries reach Shannon and Court. Spam is filtered with a honeypot field.

## Try the app on a phone
Open `/app` in Safari → Share → Add to Home Screen. More › switch person to see each role. Owner's More › Demo season switches busy / quiet. More › Appearance forces light/dark.

## Before this goes public
- Addresses, rates, phone number and ABN on the page are placeholder
- About-strip photo is a striped placeholder
- Links to #login, #allhomes, #aboutpage go nowhere yet (pages not designed)
- Logo "tide fill" decision is open (see design/README.md)
- The app has no real login or backend yet — approvals and questions are stored only in that browser (localStorage)
- Photo tiles in the app are striped placeholders until the cleaner app supplies real room photos
- Statements / Tax pack buttons are disabled placeholders

## Open decisions
- Tradie as a job type inside the crew app (built that way) vs its own role
- Can one person be both manager and owner and switch without logging out? (demo lets anyone switch)
- Money flow: site says "we never hold your money", but the Owner money screen nets off our fee and repairs. Which is it?
- Logo tide-fill (see design/README.md)
