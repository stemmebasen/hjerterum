# 0006 Gratis leje: mindst 75 kr. pr. ikke-medlem

Dato: 31. oktober 2026. Besluttet af formanden (Jacob Hauge) i udviklingssamtalen.

## Beslutning

Gratis leje – underviseren opkræver selv:

- Gratis for medlemmer.
- Mindst 75 kr. pr. person for ikke-medlemmer, uanset A- eller B-tid.

Før stod der 150 kr. i A-tid og weekender og 75 kr. i B-tid. Gratis entré for alle giver ikke gratis leje; det er standardleje.

## Tilføjet samme dag

Formanden: "Som underviser kan man booke et gratis event om ugen". Højst ét event med gratis leje pr. underviser i en uge (mandag-søndag). Bestyrelsens egne events fra admin er ikke omfattet. Reglen tjekkes i `apps/web/worker/room-bookings.ts`, når et event oprettes eller rettes.

## Hvor reglen bor

`FREE_RENT_MIN_NON_MEMBER_KR` i `packages/core/src/legacy-room-pricing.ts`. Prisberegneren, eventformularen, Sagas regler og
eventtjekket (`worker/cockpit/eventDesk.ts`) læser den derfra. Teksterne på hjemmesiden og i beregneren er rettet med.
