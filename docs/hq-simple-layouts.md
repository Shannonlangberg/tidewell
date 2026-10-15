# HQ layouts: simple, by role

Owner brief: "I want it to read super well and super simple. Think like a property manager or think like a BDM." Approved direction: all five points below. Brand rules still apply (docs/brand-design-system.md): DM Sans for data, Cormorant only for the welcome heading and the occasional empty-state title, status as dot plus label, 4/6 px radii, hairlines rather than card grids, soft white background, charcoal nav.

## Principles (apply everywhere)

1. **Lead with the next action, not statistics.** The first thing on every screen answers "what should I do now?"
2. **Only show what is different.** If every row says the same thing ("Needs verifying", "Never", "Unassigned", "Not recorded"), say it once above the list ("All 19 partners are research leads not yet contacted") and leave rows clean. A chip appears on a row only when that row is the exception.
3. **No empty boxes.** A section with nothing in it collapses to one quiet line, or disappears, unless it is the main purpose of the page.
4. **Plain words.** "Contact" not "relationship status"; "Last spoke" not "last contacted at"; no "Phase 2/4" badges in the nav; no mention of Ailo until it is connected; no counting-rule essays on the page (one short "How these are counted" disclosure at most).
5. **Phone first.** Big tap targets (min 44 px), labelled buttons (Call, Text, Log, Task) instead of unlabelled icons; `tel:` and `sms:` links where a number exists; one column on a phone.
6. **Numbers are real and come from the database.** Never fake, never pad. A zero is shown only when it is meaningful.

## The five changes

1. **Today (the home screen, `/hq`).** Role-aware, from the person's capabilities and role:
   - **BDM / growth view** (anyone with `growth.read`): "Call today" (follow-ups due today and overdue, oldest first, each with Call / Log / Snooze buttons), "Gone quiet" (partners not spoken to in 30+ days, top 5, with a link to the full list), "New referrals" (if any).
   - **Property manager / operations view** (anyone with `contractors.read` or `tasks.write`): "Overdue and due today" tasks, "Paperwork expiring" (licence/insurance within the warning window or expired), "Trades with no approved contractor" as a short count with the trade names as small links, "Not used lately" only if last-used data exists.
   - A director sees both, growth first. A short greeting line (Cormorant) and today's date; a single row of 3-4 compact figures only if they are non-zero and useful (e.g. "3 follow-ups due", "2 documents expiring"); otherwise none.
   - Empty sections collapse to one line ("No follow-ups due today."). The old widget grid and Customise panel can stay available but must not be the default; the old reporting widgets move to Reports.
2. **Reports (`/hq/reports`, new nav item replacing "Insights Phase 4").** The referral figures band, period tabs, growth overview numbers, partner performance and contractor coverage that used to crowd the dashboard. Same data, plain headings.
3. **Referral partners (`/hq/growth/partners`).** Group rows into "Call first" (follow-up due or overdue), "Warm" (spoken in the last 30 days), "Quiet" (31+ days), "Never spoken" (collapsed by default with a count when large). Row: partner name, person, phone (tap to call), "Last spoke 3 days ago" or nothing when the group heading already says never, referrals only when > 0 ("Referred 2 · 1 signed"), next follow-up only when set. Labelled buttons Call / Log / Follow up. The 6-number summary band becomes one sentence ("19 partners · 0 spoken to in the last 30 days · 0 referrals so far"). Repeated chips are removed per principle 2; "Needs verifying" becomes one line above the list when all or most rows share it, and a small marker only on rows that are the exception. Filters collapse to a search box plus a "Filter" button.
4. **Trades (`/hq/partners/trades`).** A compact list, one row per trade: name, counts in words ("5 prospects, none approved"), last used across the trade, expand/collapse to show its contractors. Trades with no contractors are grouped under one collapsed "No contractors yet (14)" line. Inside a trade, each contractor row is one line: name, status (dot+label), phone (tap), "Used 3 days ago" if known, and a single "Details missing" marker instead of three "not recorded" lines. The "no approved contractor" warning appears once per trade row as a small marker, not as a paragraph. Edit mode (add/rename/reorder/archive) stays, behind an "Edit trades" button.
5. **Plain language and phone-first pass across the shell:** nav labels (Today, Growth, Partners → keep but consider "Trades & contractors", Operations → "Tasks", People, Reports, Settings: choose labels a property manager would use, keep routes stable or redirect), remove Phase badges, labelled buttons on mobile, top bar search stays.

## Constraints

- No data model changes are needed; reuse existing views/RPCs/loaders (`referral_partner_overview`, `contractor_directory`, `contractor_expiry_watch`, trades loaders, tasks loaders, `growth_summary`, `partner_performance`, `contractor_summary`). If something truly needs a new view, ask in the report rather than adding a migration.
- Keep every capability check (`requireStaff(capability)` first) and RLS behaviour unchanged; a restricted role sees only its sections.
- Keep routes working (redirect if renamed). Keep all tests green; update tests that assert old copy only where the copy deliberately changed.
- Screenshots at 375 and 1280 for every changed screen, viewed and fixed.
