# 0013 Nye minimumspriser for ikke-medlemmer (reduceret pris og gratis leje)

Dato: 26. november 2026. Besluttet af bestyrelsen (oplyst af Douglas i "Forslag til udvikling", bekræftet af formanden samme dag). Erstatter 0012 og
beslutningerne fra 6. og 27. august, som bestyrelsen 10. november beholdt indtil den nye hjemmeside.

## Beslutning

- **Reduceret pris:** ikke-medlemmer betaler mindst medlemsprisen + 100 kr. i A-tid og + 75 kr. i B-tid (var 50 kr.), når medlemsprisen er under 400 kr.
  De højere trin i prisberegneren er uændrede.
- **Gratis leje:** ikke-medlemmer betaler mindst 100 kr. pr. person i A-tid (var 150 kr.) og 75 kr. i B-tid (uændret).
- Sætter en underviser en lavere pris, bliver eventet ikke afvist, når det gemmes. Planlæggeren advarer med minimumsbeløbet, og Saga godkender det ikke
  selv: bestyrelsen beslutter (Douglas: "Maybe only warn them, and then we can approve or not as we wish").

## Bemærk

I B-tid er trinnet 400-799 kr. stadig 12,5 %, min. 50 kr. Derfor falder det krævede tillæg fra 75 kr. (medlemspris 399 kr.) til 50 kr. (400 kr.).
Det valgte Douglas.

## I koden

`FREE_RENT_MIN_NON_MEMBER_KR` og `REDUCED_MIN_SURCHARGE_KR` i `packages/core/src/legacy-room-pricing.ts`. Prisberegneren, lejeprissiden, planlæggerens
tekst og advarsel (`nonMemberWarning`), Sagas regler og hendes gennemgang af events (`belowNonMemberMinimum`) følger dem.
