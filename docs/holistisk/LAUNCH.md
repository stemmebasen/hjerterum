# Launching holistisk.org (not done – needs separate approval)

Nothing here is done by the development work. holistisk.org keeps serving Hjerterum until these steps are approved and carried out in order.

## Before

1. Hjerterum runs on hjerterum.info with its old holistisk.org addresses redirected (Hjerterum's `site/redirects.ts`), and members, payments, logins and mail no longer depend on holistisk.org. Check especially: Clerk's allowed origins, Stripe webhooks and return URLs, MembershipWorks event links, Resend sender domain, `team@holistisk.org` (MX records must stay as they are, or the mailbox must have moved).
2. The portal's staging (`holistisk-portal-staging`) has run its nightly collection for at least a week without failures (`/api/status`).
3. Hjerterum's board has confirmed in writing that its texts and pictures may be shown (docs/holistisk/SOURCES.md).
4. Decide the contact address for organisers (`HOLISTISK_CONTACT_EMAIL`).

## Production

1. Add a `production` environment to `apps/holistisk/wrangler.jsonc`: `name: holistisk-portal-production`, vars `ENVIRONMENT=production`, `ACTIVE_REGIONS=ostjylland`, its own D1 database `holistisk-portal-production`, the same crons, and `routes: [{ "pattern": "holistisk.org", "custom_domain": true }, { "pattern": "www.holistisk.org", "custom_domain": true }]`.
2. Create the database, apply migrations, deploy, set `PUBLIC_BASE_URL=https://holistisk.org` and `INGEST_TOKEN`, and run one collection.
3. Move the domain: remove holistisk.org (and www) from Hjerterum's Worker, attach them to the portal. Leave MX/TXT mail records untouched. This is the moment holistisk.org changes; do it at a quiet time.
4. Check: `/api/health`, the front page, an event page, `robots.txt` now allows indexing and lists the sitemap, and that old Hjerterum paths still reach Hjerterum (redirect from the portal or from hjerterum.info as decided).
5. Submit `https://holistisk.org/sitemap.xml` in Google Search Console.

## Rollback

Re-attach holistisk.org to Hjerterum's Worker. The portal's data is untouched and can stay running on workers.dev.
