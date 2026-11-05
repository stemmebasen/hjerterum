# 0009 Betaling for events, trin 1: til Hjerterum, ikke direkte til underviseren

Dato: 4.-5. november 2026. Besluttet af formanden (Jacob Hauge) i udviklingssamtalen. Teamet (Douglas) var enigt: "I agree that it might be wise to implement the 'payment directly to teachers' later as it is a big change and also another big area where there could be mistakes. So lets go slowly step by step with this. The other thing, of course, is that some teachers may prefer cash or whatever, but I guess they could choose in the new system how they want to be payed."

Afløser foreløbig 0004 (Stripe Connect med udbetaling direkte til underviseren), som venter til et senere trin.

## Beslutninger

1. **Trin for trin.** "Vi starter ikke med løsningen med Connect og systembaserer udbetaling." Udbetaling direkte til underviserne kommer senere.
2. **Underviseren vælger pr. event, hvordan deltagerne betaler** (sådan som holistisk.org gør i dag, hvor underviseren skriver "hvordan der betales (fx MobilePay eller kontant), og om betaling sker ved fremmøde eller på forhånd"):
   - **Online til Hjerterum:** Deltagerne betaler med kort til Hjerterums egen Stripe-konto, den samme som kontingentet ("det skal indgå i samme kontoregnskab").
   - **Direkte til underviseren** som i dag: Underviseren skriver hvordan, og lejen betales som i dag.
3. **Online-betaling:**
   - Kortet gemmes ved tilmelding, og beløbet trækkes 48 timer før start. Indtil da kan man melde fra uden at betale ("48 timer. Og beløbet reserveres på kortet").
   - Medlemmerne bruger det kort, de allerede betaler kontingent med. Kortene ligger i Hjerterums Stripe-konto gennem MembershipWorks. Ikke-medlemmer gemmer et kort ved tilmelding.
4. **Afregning:** Hjerterum beholder 5 % af billetprisen plus Stripes gebyr, og lejen modregnes. Underviseren får resten senest 30 dage efter eventet.

## Åbne spørgsmål (sendt til teamet 5. november 2026)

1. Hvad sker der, hvis trækket 48 timer før fejler (betalingslink og frigiv pladsen 24 timer før, betalingslink og behold pladsen, eller frigiv med det samme)?
2. Hvem overfører pengene til underviseren, og hvordan?
3. Refusion, når underviseren eller Hjerterum aflyser efter trækket (helt, eller minus Stripes gebyr)?
4. Afmelding under 48 timer før (ingen refusion, efter underviserens ønske, eller hvis pladsen sælges igen)?

Handelsbetingelserne for deltagere skal skrives om, før online-betaling går i luften. Det er en juridisk tekst, som kræver formandens udtrykkelige ja.
