# Partner events: phase 1 of the Partnerplan

Status: Accepted (2026-10-02)

## Context

The Partnerplan (`docs/PARTNERPLAN.md`) lets Hjerterum grow from a single community into a hub between local communities. In phase 1 a partner agrees to one thing: a member discount on its own events. Hjerterum shows those events in its calendar, and signup, payment, tickets, members and data stay with the partner. After the partner says yes, the partner should have almost nothing left to do.

Before building, we reviewed what already exists:

- `external-events.ts` parses MembershipWorks-style RSS (`ev:startdate` and so on), and `cockpit/events.ts` syncs Hjerterum's own calendar into `house_events` every hour, using content hashes, removal marking and `job_claims`.
- The public calendar (`main.tsx`) and the member calendar (`workspaces.tsx`) already merge native and external events through `EventCard`.
- `resolveActiveMembership(..., requireBenefits = true)` is the server-side rule for member benefits. Support members do not get them.
- The board's cockpit already has an "Arrangementer" area with sub-pages (Undervisere), and Saga's jobs run from the Worker's five-minute cron.

## Decision

Phase 1 reuses these parts. Nothing from phases 2-4 is built.

1. **The partner agreement is data** (`partners`). It holds the name, website, contact, the discount (a percentage from 1 to 90, or a fixed amount in DKK minor units), how a member redeems it, the partner's calendar address, and a status (`active`, `paused` or `ended`). The board records it in the cockpit under *Arrangementer → Partnere*.
2. **Saga fetches the events.** Each active partner's calendar is read once an hour (`runPartnerSync`, claim key `partner_events`). The board can also fetch at once, and a partner's calendar is read as soon as it is created or its address changes. Two source types are supported, recognised by content:
   - iCal/ICS (Google Calendar, Outlook, WordPress and most booking systems), handled by a small parser in `worker/partners/feed.ts`. It covers TZID, UTC, floating and all-day times, DURATION, line folding and escaping.
   - RSS, handled by the existing MembershipWorks parser.
   Saga stores only what changed (`partner_events`, keyed by partner and source uid). She handles changed events, cancellations (`STATUS:CANCELLED`), events that disappear from the partner's calendar, and past events, which drop out on their own. Events are shown 180 days ahead. A failing calendar never deletes events that are already shown, and the error is shown on the partner's cockpit page.
3. **Prices are never guessed.** The normal price comes from the event text only when it is stated plainly next to a label and a currency, for example "Pris: 250 kr." (`extractPriceMinor` in `packages/core`). The member price is computed from that price and the agreed discount. When the price is unknown, the calendar shows only the discount ("20 % rabat for Hjerterum-medlemmer").
4. **Who sees what:**
   - The public calendar (`GET /api/events/partners`) shows the event marked as a partner event, with the partner's name, the normal price, the member price, the discount and a "become a member" link.
   - How to redeem the discount (a code, for example) is shown only to members with member benefits (`GET /api/members/partner-events`). Support members and anonymous visitors do not see it.
5. **Signup stays at the partner.** Every link goes through `GET /api/events/partners/:id/go`. That endpoint redirects only to the address the partner's own feed gave for the event, or to the partner's website, and counts the click. It is never an open redirect.
6. **The board stays in control, but by exception only.** The board can hide a single event (a new sync does not undo this), pause a partner, or end the partnership. Events are not approved one by one.
7. **Out of scope for phase 1, by choice:**
   - Repeating series (`RRULE`) are not expanded. They are counted and named in the sync status, so the board can see them.
   - Private and confidential iCal events are never published.
   - There is no manual entry of single events, and no AI extraction.
   - There is no booking, payment or member identity exchange with partners.
   - The reverse direction (phase 3) is not built.

## Measurements (phase 2)

Counted per Copenhagen day in `partner_metrics`, without personal data, and shown in the cockpit over the last 30 days:

| Plan's measurement | Where it comes from |
| --- | --- |
| Active partners | `partners.status = 'active'` (cockpit overview) |
| Partner events | Coming, visible `partner_events` per partner |
| Views | `member_view`: a member's calendar showed the partner's events (authenticated, so no bots). Public page views are not counted. They would be dominated by bots and caching. |
| Clicks to the partner | `click` (public calendar) and `member_click` (member calendar), per event |
| Discounts used | Only the partner knows. The board asks at follow-up, for example how many times the code was used. |
| Event types that work best | Clicks per event on the partner's page |
| Member value / partner value | Qualitative: ask members and partners when following up |

## Consequences

Bringing a partner in now takes one form in the cockpit. The partner only has to send a calendar address. New partner events reach the calendar within an hour, without anyone acting. The member's discount instructions sit behind the existing member-benefit rule. Each step that phase 2's results may call for is a separate decision: expanding repeating series, manual events, partner self-service, and the reverse direction.
