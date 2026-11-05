# 0011 To opslag pr. event på hvert medie

- **Dato:** 5. november 2026
- **Besluttet af:** formanden

## Formandens ord

"Hvert event får to shouts på hvert medie - 14-15 dage før og 7-8 dage før - altså i alt fire shouts (2 på insta og 2 på facebook). Dette skal planlægges. Hvis et event ikke er blevet delt ifølge planen (fordi jeg ikke har godkendt det) skal Saga replanlægge kommende events."

Bagefter: "Det er også fint, hvis du udvider intervallerne med en dag, både den, der vedrører en uge, og den, der vedrører to uger før."

## Svar på spørgsmålene

- **Faste ugentlige hold:** "Hver 4. uge". Et hold, der har haft egne opslag inden for de sidste tre uger, er kun med i Ugens events.
- **Events, der kommer sent i kalenderen:** "Hurtigst muligt + 7 dage". Er der under en uge tilbage, får eventet ét opslag hurtigst muligt.
- **Godkendelse:** "Alle fire på én gang". Når formanden godkender, springer over eller fortryder ét af eventets opslag, gælder det dem begge.

## Regler (`social/plan.ts` shoutWindows, `social/social.ts`)

- **1. opslag** går ud 14–16 dage før eventet.
  - Kommer eventet senere i kalenderen, går det ud så hurtigt som muligt og senest 10 dage før.
- **2. opslag (påmindelsen)** går ud 7–9 dage før med sin egen tekst ("Om en uge …").
- **Under 7 dage før eventet** får det ét opslag hurtigst muligt og senest dagen før.
- **Instagram** har sin egen tid inden for samme vindue.
- **Højst 3 opslag om dagen** pr. medie, fordelt jævnt. Det opslag, der skal ud først, placeres først.
- **Ikke godkendt i tide:** opslaget får næste ledige tid inden for sit vindue. Er vinduet passeret, lægges det til side, og påmindelsen står tilbage.
- **Én gang** er de ventende forslag planlagt om efter de nye regler (`replanForShouts`). Godkendte opslag er urørte.
- **Godkendte opslag:** fik et event sit 1. opslag godkendt før denne ordning, laves påmindelsen som et udkast, som formanden selv godkender.
