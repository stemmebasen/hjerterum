# Stripe Connect for member-created paid events

Status: Accepted — 2026-09-11

## Decision

Paid events use Stripe Connect with Accounts v2. Event organizers complete Stripe-hosted onboarding and receive access to the full Stripe Dashboard. Charges are created directly on the organizer's connected account.

Hjerterum receives an application fee consisting of:

- 5 percent of the ticket price
- a configurable fixed handling fee per checkout transaction

The handling fee is displayed separately to the buyer and added to the checkout total. It defaults to 0 DKK until an administrator changes it.

## Registration lifecycle

A paid registration is pending while Stripe Checkout is open. The capacity reservation expires after approximately 31 minutes. Only a signed connected-account webhook with matching booking, member, registration, session and Stripe account identifiers can confirm it.

A member can cancel before the event starts. Cancellation does not automatically issue a refund. Refunds and disputes remain explicit administrative/payment-provider operations.

## Operational requirement

Activation requires a Stripe secret key and a separate Connect webhook secret for connected-account Checkout events. Until those secrets and the Stripe Connect platform profile are configured, free events continue to work and paid-event creation is refused safely.
