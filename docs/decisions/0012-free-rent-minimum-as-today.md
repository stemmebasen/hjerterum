# 0012 Gratis leje: mindst 150 kr. i A-tid og 75 kr. i B-tid

Dato: 9. november 2026. Besluttet af formanden (Jacob Hauge) i udviklingssamtalen. Erstatter 0006.

## Beslutning

"Brug priserne som i dag" – priserne for gratis leje er de samme som på holistisk.org:

- Medlemmer deltager gratis.
- Ikke-medlemmer betaler mindst 150 kr. pr. person i A-tid (hverdage fra kl. 18.30 og weekender) og mindst 75 kr. pr. person i B-tid (hverdage før kl. 18.30).
- Underviseren opkræver selv betalingen.

## Baggrund

Douglas spurgte (9. november 2026), hvorfor den nye hjemmeside sagde mindst 75 kr. uanset tidspunkt, når holistisk.org siger 150 kr. i A-tid. Det kom fra 0006 (31. oktober 2026). Formanden valgte at beholde de nuværende priser.

## I koden

`FREE_RENT_MIN_NON_MEMBER_KR` i `packages/core/src/legacy-room-pricing.ts` (`{ A: 150, B: 75 }`). Prisberegneren, eventformularen, tjekket på serveren, Sagas regler og hjemmesidens lejepriser følger den.
