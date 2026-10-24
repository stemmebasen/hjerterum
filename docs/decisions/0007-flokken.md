# 0007 – The event portal becomes Flokken

Status: accepted (staging), 2026-10-24

## Context

The event portal from [ADR 0006](0006-holistisk-event-portal.md) collected holistic events in Østjylland. The owner
turned it into Flokken: a place where people in Aarhus find local events and others who want to experience the same
thing. The event is the reason to meet; a flock (flok) is a small, informal group going to one event together.

## Decision

- Build Flokken into the existing portal (`apps/holistisk`): the collector, sources, search, filters, city, category
  and event pages and links to the organisers' sign-up stay as they are. Only what visitors see is renamed; code paths,
  the Worker and the D1 database keep their names.
- Members, sessions, flocks and memberships live in the portal's own D1 (migration 0003). Hjerterum's login (Clerk) is
  not reused: it holds Hjerterum's members, and ADR 0006 keeps the portal apart from them.
- A member is a first name and a personal code, nothing else. This keeps the profile as small as the concept needs and
  avoids storing contact data before there is a reason to. The cost: a lost code cannot be recovered.
- Joining is always an active choice; flocks meet at public places; anyone can leave; names are only shown inside a
  flock. Blocking, reporting and verification are not built and the site says so.
- Organiser offers are shown only when confirmed, from a list in code (`PARTNER_OFFERS`), which is empty. Partner
  inquiries are stored in D1 because staging has no contact address.
- The portal can be shown under www.jacobhauge.com/flokken through a Pages Function in that site's repo; the Worker
  trusts only the listed address for the path prefix.

## Open

Domain and production environment for Flokken; e-mail or another way to recover a login; moderation (block, report);
which organisers join and what they offer; whether the holistic categories stay as the main event categories once
other sources are added.
