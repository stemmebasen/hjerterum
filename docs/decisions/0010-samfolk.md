# 0010 – Foreningen Samfolk: ture that members create, for all

Status: accepted (staging), 2026-10-26. Replaces [ADR 0009](0009-flokk-udflugter.md) and the concept parts of
[ADR 0008](0008-flokken-forening.md).

## Context

The owner turned Flokk into Foreningen Samfolk: an association that is only about experiencing things together with
like-minded people. Instead of tickets agreed with organisers, the members create the ture themselves. Samfolk is to
become a whole universe that is built out later.

## Decisions (the owner's)

- The name is Foreningen Samfolk ("Samfolk" for short). An experience is still called a "tur" for now.
- Members create ture themselves, and other members can sign up for them. A new tur is shown at once; the association
  can hide it afterwards.
- To use the site, a member fills in their profile: first name, e-mail, what they would like to experience, and where
  they live.
- No discrimination: anyone can sign up for a tur, whatever their age, gender and ethnicity. The profile does not ask
  about them.
- Only members can sign up. Members pay their own costs (tickets and the like).
- Membership costs 50 kr. a month or 500 kr. a year. Paying is not open yet: members choose month or year now and pay
  nothing.
- The one who creates a tur sets the number of places and the deadline for sign-up. Places go first come, first served,
  then an automatic waiting list; a member can cancel until the deadline.
- Once a month Samfolk holds an event of its own, free for members.
- Anyone can sign up for the weekly Samfolk-brev with the coming week's ture.
- Members log in with their personal code; a fuller login comes later.

## Choices made in building it (can be changed)

- Address www.jacobhauge.com/samfolk; /flokk and /flokken send on to it.
- Without a deadline, sign-up and cancellation stay open until the tur starts.
- The creator sees the first names of those signed up; those with a place see the meeting place, programme and each
  other's first names. Only volunteers see e-mails.
- The creator, or a volunteer, can change and cancel a tur. A member who leaves has their coming ture cancelled, so
  those signed up can see it.
- Members from before Samfolk complete their profile (interests, area, membership) before they can sign up or create.
- Volunteers can start a Samfolk event from an event the collector found; it stays hidden until they have checked it.

## Not decided

- How the membership is paid.
- Sending Samfolk-brevet (the list is kept; no mail is sent yet).

## Consequences

- Migration 0007: `members.plan`, `picks.kind` ('member' | 'samfolk') and `picks.closes_at`, and the `newsletter`
  table. Columns keep names from earlier versions (`picks`, `flokk_joined_at`, `flokk_cancelled_at`).
- The organisers page and its inquiry form are gone from the association's pages (`/for-arrangoerer` sends on to
  `/om`); earlier inquiries and the earlier interest list stay readable in admin and deletable on request.
