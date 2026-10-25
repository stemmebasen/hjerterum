# 0008 – Flokk: an association that takes people out

Status: accepted (staging), 2026-10-25

## Context

Flokken ([ADR 0007](0007-flokken.md)) was an event portal where members could create and join flocks for any of the
collected events. The owner refocused it: Flokken is an association (under formation, financed by membership fees)
for people who do not find meeting new people the easiest thing in the world – people new in town, shy, living alone,
or finding it hard to reach out. Each month Flokken hand-picks cultural events from associations it works with, puts
together small flocks with a host, and takes care of planning, the ticket and "a little something" afterwards.

## Decision

- Two editions in one Worker. At www.jacobhauge.com/flokken (and at the Worker's own address unless `EDITION=portal`)
  Flokken is the association; at www.jacobhauge.com/socialklubben the event portal stays as it was (ADR 0007). The
  mount decides (`MOUNTS` in `src/index.ts`).
- Only approved events are shown ("picks", migration 0004). A volunteer approves one from the collector's events (the
  collector keeps running as a suggestion list) or types one in, and edits it before it is shown. The portal's
  calendar, map, city and activity pages are not part of Flokken; the map comes back later.
- For now an interest list instead of member profiles: first name and e-mail, optionally age group, area, interests,
  an event to come along to and whether a friend comes too, with consent. No mails are sent yet; the volunteers read
  the list (and a CSV) behind login. Contact is through forms only; there is no public address.
- The volunteers log in with a personal code as in ADR 0007; a member is an admin when `is_admin = 1`, set by hand
  (`scripts/new-admin.mjs`).
- The site talks about the situation ("not the easiest thing in the world to meet new people"), not about labels.
  It makes four promises the association has chosen to keep: no surprises, the host meets you, no pressure, calm
  settings. Flocks are 4–6 people and a host; one friend may come along.
- Membership fee plus a small payment per event; the amounts are not set and the site says so. Nothing is charged.
- A calmer version of the design: the same colours and mark, thin lines, soft shadows, no tilted tickets.

- Named Flokk (www.jacobhauge.com/flokk) with its own mark and type, so it does not look like Socialklubben; the
  colours are shared. The mark, the open circle, says the promise: there is always room for one more. Headline: "Nye
  oplevelser, nye mennesker – i trygge rammer."

## Open

Amounts and payment; member profiles and the "jeg vil gerne med" flow for members; sending mails; composing flocks
(host, meeting place and time) in the admin pages; statutes, board and CVR once the association is founded; the map
for approved events.
