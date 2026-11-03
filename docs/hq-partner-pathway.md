# Planted HQ: the referral partner pathway

Every referral partner is on one pathway: **Not yet connected**, then **Connect**, **Cultivate** and **Champion**. HQ shows where each partner is, lets you filter by step, and moves a partner to the next or previous step.

Code: `lib/hq/growth/pathway.ts` (the reading and the move rules; pure, tested), `lib/hq/growth/pathway-queries.ts` (reads, counts and the move, shared by the pages and chat), `components/hq/features/referral-partners/Pathway.tsx` and `PathwayMove.tsx` (the panel and its confirmation), `pathway-actions.ts` (the Server Action), `lib/hq/mcp/tools/pathway.ts` (chat). Tests: `lib/hq/growth/pathway.test.mts`, `lib/hq/growth/params.test.mts` (the `?stage=` filter), `lib/hq/leadership/rules.test.mts` (the command center reads it the same way), and the pathway section of `scripts/hq/mcp-tools-smoke.mts`. **No migration**: nothing new is stored.

## 1. A reading of the status HQ already keeps

The step is read from each contact's existing `relationship_status`. There is no second field.

| Step | Relationship status |
|---|---|
| Not yet connected | identified (also a business with nobody recorded yet) |
| Connect | contacted, meeting booked |
| Cultivate | met, active relationship |
| Champion | referring partner |
| Not active | inactive (everyone at the business is inactive) |

A business is at the step of its furthest-along live person, the same "most advanced status" `hq.referral_partner_overview` already gives the list. An independent partner, a partner contact with no organisation, is at their own step.

Until now, "identified" was counted under Connect on the command center. It now has its own step, Not yet connected, so the command center shows four numbers, and each one opens the list at that step.

## 2. Where it shows

- **A partner's page** (the organisation page, or an independent partner's contact page): a **Referral pathway** panel with the four steps, the current one marked "Here now". It names who sets the step ("Cultivate, set by Alice Anders (Met), the furthest along of the 2 people here") and links to everyone else at that step.
- **Referral partners list**: a row of step chips with counts (Whole pathway, Not yet connected, Connect, Cultivate, Champion, and Not active when anyone is). `?stage=` filters the list and works with every other filter and group. Each partner row carries its step.
- **Command center** (Growth and relationships): the four steps, each linking to the filtered list.
- **Chat**: `partner_pathway` (counts, the partners at a step, or one partner's place and people) and `move_partner_stage`.

## 3. Moving a partner

"Move to Cultivate" and "Move back to Connect" are on the panel for people with `growth.write`. Each first shows exactly who will change, and only then saves. Who changes is worked out again on the server from the people as they are now:

- **Forward**: only the partner's main person moves, to the new step's first status (Connect: contacted; Cultivate: met; Champion: referring partner). The main person is the primary contact, or else the furthest along. Everyone else keeps their status.
- **Back**: everyone further along than the new step moves back to that step's first status, so the business really is at that step. Everyone else keeps theirs.
- Inactive people are never touched. A partner with nobody recorded, or with everyone inactive, cannot be moved, and the panel says why.

Every move is an ordinary contact update of `relationship_status`, through the same path as the contact page's status field. The audit trail records each person changed. Nothing else changes: no priority, follow-up, owner or note. The finer statuses within a step (meeting booked, active relationship) are still set on the person's page.

## 4. Chat

| Tool | Capability | Kind | Phrase it answers |
|---|---|---|---|
| `partner_pathway` | `growth.read` | read | "How many partners are at each stage?", "Which partners are not yet connected?", "Where is Alpha Realty on the pathway?" |
| `move_partner_stage` | `growth.write` | write | "Move Alpha Realty to Cultivate", "Move Beta Broking back a step" |

`update_contact` can still set one person's relationship status directly.
