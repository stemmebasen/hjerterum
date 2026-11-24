# Hjerterum - regler for udvikling

- **Nye admin-funktioner er først kun for formanden** (docs/decisions/0007-new-admin-features-chair-first.md): en ny funktion i
  bestyrelsens admin får en beføjelse i `apps/web/worker/cockpit/authority.ts` (`needs: "personal"`) og åbnes for bestyrelsen, når formanden siger det.
- Suppleanter har kun læseadgang i admin.
- Priser og lejeregler ændres kun efter en bestyrelsesbeslutning eller formandens udtrykkelige ja.
- Saga sender aldrig mail af sig selv; noget, der sendes til mange (fx nyhedsbrevet), kræver en godkendelse i admin.
- Brug kun formandens egne logofiler - tegn aldrig et logo.
- Tilføj aldrig noter eller kildeangivelser til referater eller andre optegnelser uden at blive bedt om det.
- **Forslag til udvikling** (admin → Forslag til udvikling, `apps/web/worker/cockpit/wishes.ts`): når formanden beder om at lave de godkendte forslag,
  hentes de med `curl -s https://admin.hjerterum.info/udvikling/api/forslag` (nøglen `DEV_REQUESTS_TOKEN` sættes på af miljøets netværkshemmelighed).
  Lav hvert forslag som en almindelig ændring, og markér det som lavet med `curl -s -X POST https://admin.hjerterum.info/udvikling/api/forslag/<id>/lavet`,
  først når det er udrullet. Er et forslag uklart eller strider det mod en regel her, så spørg formanden i stedet for at gætte.
