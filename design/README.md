# Handoff: Tidewell — brand identity, marketing site, owner app

## Overview
Tidewell is a property management brand on South Australia's Copper Coast — short-stay holiday letting, long-term residential letting, and property care for vacant/absentee-owned homes. This bundle covers the finished brand identity, the marketing homepage, and the first role of the app (Owner). Tenant, Guest, Cleaner/Tradie and Manager are designed conceptually in chat but not yet built as screens — see "Not yet built" below.

## About the design files
The `.dc.html` files in this bundle are **design references built in a prototyping tool**, not production code. They are plain HTML with inline styles, streamed and rendered by a proprietary component runtime (`support.js`, referenced in each file's `<head>`) that will not run in a normal app. **Do not copy the HTML/DOM structure or `support.js` into the target codebase.** The task is to recreate these designs — layout, copy, color, type, spacing, states — in whatever the target codebase already uses (React, Vue, SwiftUI, native, etc.), following its existing patterns and component library. If no environment exists yet, choose the framework that best fits: a Next.js/React site for the marketing pages and an installable PWA (or React Native) for the app is a reasonable default given the brief called for an installed iOS web app.

`ios-frame.jsx` is a throwaway device-bezel mockup used only to preview the app screens at iPhone scale in the prototype. It is not part of the product and should not be ported.

## Fidelity
**High-fidelity.** Every screen uses final colors (exact hex, see Design Tokens), final type (Bricolage Grotesque + Instrument Sans + JetBrains Mono, see below), final spacing, and close-to-final copy. Recreate pixel-close, not approximate. Where a screen shows placeholder photography (striped diagonal blocks with a monospace caption like "house photo"), that is intentionally a placeholder — keep the same aspect ratio and crop shape and swap in real photography later; do not ship the striped placeholder to production.

## Brand identity
Source file: `Tidewell Identity.dc.html`. Read it top to bottom — it is written as a spec, not just a mood board.

- **Name / tagline (fixed):** Tidewell. "Your place, kept well."
- **Wordmark:** Bricolage Grotesque, weight 700 only, all lowercase, letter-spacing −5%. Never capitalized, outlined, stretched, or set on a photo without a flood color behind it. Primary lockup is verdigris-on-bone; the inverse (bone-on-verdigris) is for dark surfaces.
- **Mark ("the tag"):** a key-tag silhouette — arch top (radius = exactly half the width, a true semicircle), flat/near-square bottom (fixed 8px radius at 152px reference width), one centred circular hole (diameter = width ÷ 4.5, positioned one hole-diameter from the top). Height is always 1.4 × width. This shape is reused as: the app icon, the physical door plaque, the physical key tag, primary buttons (fully rounded / pill), photo crop masks, and bar-chart bars (arch-topped). It is never used arch-down, nested, or duplicated more than once per screen as a literal tag shape. The team discussed but did not finalize giving the tag a "tide level" fill (a horizontal colour fill from the bottom, at ~38%, that can represent occupancy/progress) — flagged as an open decision, see below.
- **App icon:** iOS corner radius = 22.37% of width (e.g. 40.3px at 180px). The tag graphic is bottom-anchored and bleeds off the lower edge so it still reads as an arch at 40px; the hole is allowed to drop out below 40px.
- **Colour system** — see Design Tokens below for exact hex. Rule of thumb: verdigris and bone are the only two "surface" colours; copper is reserved for one decision or money-related element per screen and is a **fill**, never small text, on any light surface — copper text uses the darker "Copper deep" token. Text on a copper fill is always the dark ink/deep-green colour, never white (white-on-copper fails contrast). Verdigris floods are edge-to-edge sections, never a floating card; at most two flood sections per page.
- **Type scale:** Bricolage Grotesque 700 for all display/headline text (32px and up, always lowercase, never a full paragraph); Instrument Sans 400/500/600 for everything else (400 body, 500 labels, 600 buttons/numbers, tabular figures on); JetBrains Mono 400/500 at 10–12px only, for section labels, reference numbers, ABNs — never a sentence. Body text: 17/1.65 on web, 19/1.6 in the app (larger in-app because the owner persona is 50–65 reading at night). Floor size across the whole system is 15px — nothing smaller, anywhere.
- **Voice:** plain, warm, first person plural, Australian English, sentence case. Buttons name their outcome and amount ("Approve $245", not "Submit"). Every screen opens with a status sentence, not a generic greeting. Never the words "shack", "AI", "leverage", "solutions", "seamless", "portfolio". Never "contact us for a quote" — prices are published or explicitly flagged as "price to confirm" with a stated reason.
- **Honesty constraint (important, carried from chat):** the client explicitly rejected fabricated statistics and specifics mid-project (a fake "17 min median reply" stat, an invented "kept since 2024" caption, invented house addresses/rates, an invented "nine places" portfolio count). The pattern to follow in production: state policies/promises ("inside the hour, every message"), never invent measurements or specifics you don't have. Any placeholder data in the app screens is marked with a visible flag in the design (e.g. a dashed-border tag reading "Price to confirm" or "Photos are real · addresses and rates are placeholder") — carry equivalent flags through to any staging/demo build so nobody mistakes placeholder content for real claims.
- **Physical objects (for reference, not build):** a door plaque (90×140mm, verdigris powder-coat, copper rule, engraved town), a key tag (32×45mm anodised aluminium, copper for short-stay properties / verdigris for long-term), and a car-door decal. Not part of the digital handoff but shown in the identity file for brand consistency if a print vendor asks.

### Open decision — logo
The user considered giving the tag mark a "tide" treatment (a copper rule or copper fill rising to ~38% inside the tag, to literally connect the mark to the word "tide" and to double as a data device — occupancy level, checklist progress). This was explored (three options, `Tidewell Brand Directions.dc.html`, turn 2, ids `2a`/`2b`/`2c`) but **left undecided** — the plain key-tag mark (no tide fill) is what shipped everywhere else. Flag this to design leadership before finalizing the app-icon/brand asset; don't quietly pick one.

## Marketing homepage
Source file: `Tidewell Home.dc.html`. Single scrolling page, desktop-first but fully fluid (grid tracks wrap via `auto-fit`/`minmax`, no fixed widths) — resize/test down to ~360px.

Sections top to bottom:
1. **Sticky header** — verdigris bar, wordmark left, nav links (What we do / Pricing / Our homes / About), Owner login (outline pill) + Talk to us (copper pill) right.
2. **Hero** — verdigris flood, two-column (text left, photo right on desktop; stacks on mobile). Headline "someone is always looking after your place" (product-first — deliberately not "two hours from Adelaide"; that framing was cut per client direction to stop over-indexing on founder distance/story). Real photo of "12 Bayview Road" used as the arch-cropped hero image (see Assets).
3. **Four promises** — plain bone background, 4-column grid, each with a copper rule, a Bricolage sub-headline, one paragraph: published prices, live dashboard, a photo of every room, a reply inside the hour.
4. **Services / pricing** — heading "what we do, and what it costs". 4 cards in a 2×2 (wraps to 1 column on mobile): short-stay (18% + GST, verdigris fill card), long-term (8% + GST, flagged "licence application lodged"), property care (price explicitly flagged "Price to confirm" — dashed border, not hidden), setup-only ($3,000–$5,000 once). Below the grid: three short trust lines (no lock-in after first Easter; we only take our stated fee, nothing else; "ask what your place would earn" link to the enquiry form). **No worked dollar examples/tables on this page** — a detailed two-column revenue breakdown was built and then deliberately removed because it put too much money math on a first visit; keep pricing to the published rate, not a projected P&L.
5. **Availability** — dune-coloured band, headline "we answer inside the hour. we'd rather you check.", a 2×2 stat grid — all four stats are **promises/policies, not measured statistics** ("Inside the hour", "8am–10pm", "365 days", "Same day") per the honesty constraint above.
6. **Our homes** — 4 sample property cards (arch-cropped photos, address, town, sleeps count, nightly rate or tenancy status) under a visible flag "Photos are real · addresses and rates are placeholder" — the photos are genuine user-supplied images (see Assets), the addresses/rates are placeholder copy to replace with the real portfolio.
7. **Where we work** — town grid (Moonta Bay, Port Hughes, Wallaroo, North Beach) plus a "Somewhere else? Ask us" tile — deliberately no house-counts or mileage/radius claims (client asked not to "limit it" with that language; scope is short-stay + long-term + property care, Copper Coast–wide, not fixed to four towns).
8. **Enquiry form** — address + service-type chip select + free-text, "we'll reply inside the hour" — plus phone/email as a fallback.
9. **About strip** — one photo + two sentences ("we live here... we take on what we can get to, and we say no to the rest"), linking out to a fuller About page (not yet built). Kept deliberately short — no fabricated years-of-experience claim, no founder names on the homepage (client asked to de-emphasize the two-founder story in favour of an always-on brand voice).
10. **Footer** — wordmark, towns, page links, phone/email/hours, legal line (ABN, council short-stay registration, pending SA property agent's licence).

## Owner app
Source file: `Tidewell App - Owner.dc.html`. iPhone 15 Pro frame (393×852), 5 tabs: Home, Bookings, Repairs, Money, More. Five screens built:
1. **Home — decision waiting.** Status sentence ("Nine of the next fourteen nights are booked. One thing needs you."), a verdigris "needs a decision" card for a $150+ repair (photo, description, Approve $[amount] as a copper pill + Ask as an outline pill), the next-14-nights bar chart (arch-topped bars, the signature device, filled = booked), today's changeover status with 6 room-clean photos and the cleaner's handover note.
2. **Home — empty state (a July with nothing booked).** Same layout skeleton, all 14 night-bars empty, an honest "what we're doing about it" list (rate drop, minimum-stay change, new photos) instead of a fabricated stat, plus a same-month-last-year comparison and a prompt to block dates for personal use.
3. **Repairs — decision detail.** Full-screen drill-down from the Home decision card: before/after-style photos, itemized quote table, the $245 total, an explanation of the $150 approval threshold and bond-recovery process, Approve/Ask buttons, and a timeline history.
4. **Money — dark mode.** This month's figure to the dollar with a full breakdown (bookings, guest-paid cleaning, platform commission, our fee, repairs), a year bar chart (paid vs this-month vs forecast, three-colour legend), Statements/Tax pack buttons.
5. **Bookings.** List of upcoming bookings each tagged with its source platform (colour-coded left bar: Airbnb / Stayz / a personal-use block / Direct), plus **two features added after initial build, per explicit client request:**
   - **"Where they come from"** — one row per platform (Airbnb, Stayz, Booking.com, Direct) showing rating, review count, live price, last-synced time, and an **"Open ↗" link out to the actual listing** on that platform. One row (Booking.com) is shown stale (3hrs since sync, called out in copper) to demonstrate the out-of-sync state.
   - **"Your calendar"** — a read-only iCal/webcal feed combining all platforms' bookings + blocks + cleans into one calendar the owner can subscribe to on their phone ("Add to my calendar" button, "Copy link", and the literal `webcal://` URL shown). Changes are made in the app, not in the subscribed calendar.

All 5 screens sit inside an `<IOSDevice>` mockup frame for iPhone-scale preview only (see `ios-frame.jsx` note above) — do not port the frame chrome. Do note the **safe-area handling that IS part of the design and must be replicated**: every screen's top header has 62px of top padding so content clears the iOS status bar / dynamic island, and every tab bar has 34px of bottom padding plus 20px horizontal padding so labels clear the home indicator and aren't clipped by the device's rounded corners. This is a real requirement for the "installed iOS web app" brief (safe-area-inset-top / safe-area-inset-bottom in production CSS), not just a mockup artifact.

## Not yet built
Discussed in chat / in the original spec but not designed as screens in this bundle:
- **Tenant** app role (5 screens per spec: home/status, house, rent, repairs, documents — analogous to Owner/Guest but for long-term tenancies).
- **Guest** app role (signed link, no login: before-arrival, arrival-day code reveal, house guide, ask-us, leaving/checkout).
- **Cleaner** app role (Jobs list, per-job checklist with one photo slot per room, Done button gated on all rooms photographed, Pay/payout screen). The client's working assumption (not finalized) is that **Tradie is a job-type inside the Cleaner app**, not a separate fifth app — flagged as an open decision, confirm before building.
- **Manager** app role (Today, Inbox with draft-reply, Properties incl. 8-week pricing pass, Calendar, Repairs kanban, Cleaning roster/payout run, Owners & pipeline, Money reconciliation, Reports, Settings) — by far the largest remaining surface area per the original spec; expect this to be multiple sprints on its own.
- **Login / role-switch:** confirmed in chat to be **one app, one login** — the bottom nav and home screen change based on the logged-in user's role, except Guest which uses a signed link with no account. Not yet decided: whether a single person who is both a manager and an owner (plausible for the two founders) can switch roles without logging out — raise this with the client before building auth.
- Marketing site: For Owners detail page, Our Homes full listing/detail pages, individual public house "Guest guide" pages, and the About page are referenced by links on the homepage but not yet designed.

## Design tokens

### Colour — light
| Token | Hex | Usage |
|---|---|---|
| Bone | `#F1EBD9` | page background |
| Bone light | `#F7F2E2` | raised surface / cards |
| Dune | `#D8C9A8` | sunken surface / section band |
| Verdigris | `#10382F` | flood surface, primary dark |
| Shallow | `#2F5F55` | secondary green (good/booked) |
| Copper | `#E2622E` | action fill (buttons, accents) — fill only, not small text |
| Copper deep | `#8A3A12` | copper text colour — passes AA on Bone, Bone light and Dune |
| Ink | `#0C2B25` | primary text |
| Driftwood | `#55645C` | secondary text |
| Hairline | `#D9D0B8` | borders/dividers |

### Colour — dark
| Token | Hex | Usage |
|---|---|---|
| Deep | `#0A211C` | page background (dark) |
| Deep raised | `#173A32` | raised surface (dark) |
| Deep line | `#234038` | borders (dark) |
| Shallow light | `#4E8C7C` | secondary green (dark) |
| Copper bright | `#F07A42` | action fill / small copper text on verdigris (dark) — use this, not `#E2622E`, for any small copper text on a dark/verdigris ground |
| Bone (dark ink) | `#F1EBD9` | primary text (dark) |
| Sea mist | `#7FA093` | secondary text (dark) |

Full contrast rules and validated pairs are documented inline in `Tidewell Identity.dc.html` §04 — every pairing in this bundle has been checked against WCAG AA (4.5:1 body text / 3:1 headline-scale) and corrected at least twice during the project; don't reintroduce `#9E4318` or `#6E8078`-style mid-greys without re-checking contrast on every surface they'll sit on, not just one.

### Type
- Display: **Bricolage Grotesque**, weight 700 only. Sizes: 100px (identity showcase) / 64px / 44px / 32px, all at line-height ~1–1.05 and letter-spacing −4% to −5.5%, lowercase.
- Body/UI: **Instrument Sans**, weights 400/500/600. Body 17px (web) / 19px (app), line-height 1.6–1.65. Labels 15px/500. Buttons 15–19px/600. Tabular numerals on for all money/counts.
- Mono/labels: **JetBrains Mono**, weights 400/500, 10–12px only, letter-spacing +14–18%, uppercase for section labels.
- Google Fonts URLs used throughout: `Bricolage+Grotesque:opsz,wght@12..96,400;12..96,500;12..96,700`, `Instrument+Sans:wght@400;500;600` (site) / `ital,wght@0,400;0,500;0,600;1,400` (identity sheet), `JetBrains+Mono:wght@400;500`.

### Spacing / shape
- The tag/mark shape: top radius = 50% of width (true semicircle), bottom radius fixed ~8px at reference scale, height = 1.4 × width, hole diameter = width ÷ 4.5.
- Buttons: fully rounded pills (`border-radius: 999px`), ~15–17px vertical padding, 26–32px horizontal.
- App icon corner radius: 22.37% of width (iOS standard).
- Card/section corner radius: mostly 0 (sharp) on marketing site and identity sheet — the tag shape is the only rounded motif, used sparingly, not a generic "rounded card" style.

## Assets
- `photos/12-bayview-road.png` — user-supplied real photo, used as the homepage hero (arch-cropped, `center 62%` focal point) and in the first "our homes" card.
- `photos/port-hughes.png`, `photos/wallaroo.png`, `photos/north-beach.png` — user-supplied real photos of three more houses, used in the remaining "our homes" cards (arch-cropped, focal points `58%`/`55%`/`52%` respectively — re-check crop on the real photo dimensions if these change).
- All other imagery in every file (house photos in the identity sheet, direction tiles, etc.) is a **striped-gradient placeholder with a monospace caption** describing what real photography should go there (e.g. "house at 6pm · golden hour · no drone") — do not ship these placeholders; the identity sheet's §07 "in the world" section and the original brief include a photography direction (golden hour, no drone shots, no staged styling) to hand to whoever shoots the real photography.
- No icon font or SVG icon set is used — all "icons" in the design (tab bar glyphs, nav chevrons, etc.) are drawn as plain divs/borders or the `ios-frame.jsx` mockup's inline SVGs (status bar glyphs, keyboard icons) — the latter should be replaced with the target platform's native chrome, not recreated.

## Files in this bundle
- `Tidewell Identity.dc.html` — full brand identity spec (wordmark, mark, colour, type, voice, physical objects).
- `Tidewell Brand Directions.dc.html` — the three original direction explorations plus the "tide mark" logo variant explorations (turn 2, undecided — see Open decision above). Kept for context on why direction 1b ("Copper Coast") was chosen over the other two.
- `Tidewell Home.dc.html` — marketing homepage.
- `Tidewell App - Owner.dc.html` — Owner app, 5 screens.
- `photos/` — the four real house photos listed under Assets.

Open the `.dc.html` files in any browser to view them directly — they are self-contained aside from the Google Fonts links and the `support.js` runtime file referenced in `<head>` (needed only to render the preview; not needed to read the design).
