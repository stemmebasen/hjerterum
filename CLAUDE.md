# Hjerterum - regler for udvikling

- **Nye admin-funktioner er først kun for formanden** (docs/decisions/0007-new-admin-features-chair-first.md): en ny funktion i
  bestyrelsens admin får en beføjelse i `apps/web/worker/cockpit/authority.ts` (`needs: "personal"`) og åbnes for bestyrelsen, når formanden siger det.
- Suppleanter har kun læseadgang i admin.
- Priser og lejeregler ændres kun efter en bestyrelsesbeslutning eller formandens udtrykkelige ja.
- Saga sender aldrig mail af sig selv; noget, der sendes til mange (fx nyhedsbrevet), kræver en godkendelse i admin.
- Brug kun formandens egne logofiler - tegn aldrig et logo.
- Tilføj aldrig noter eller kildeangivelser til referater eller andre optegnelser uden at blive bedt om det.
