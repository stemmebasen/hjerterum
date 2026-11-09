# 0008 Én rød tråd i bookingen

Dato: 4. november 2026. Besluttet af formanden (Jacob Hauge) efter feedback fra underviseren Douglas ("Actually there is membership from 111kr/md", "Where or how do they send this booking request?", "Cannot type a price for members here, and price for non-members must say at least 150kr for A-time (or did we agree 100kr?)"). Formanden: "It's very important that we think thoroughly about this, there is a silver line and a context all the way through the bookings in both admin and on the front page."

## Beslutninger (ét spørgsmål ad gangen)

1. **Én vej for alle.** Ikke-medlemmer, der booker til standardpris, reserverer også salen direkte i systemet (med et simpelt login via mail). Bookingen står i kalenderen som "afventer godkendelse", og bestyrelsen godkender i admin, i stedet for at en forespørgsel lander som mail i team@. *Ikke bygget endnu.*
2. **Medlemspris:** "Fra 111 kr./md." (det reducerede medlemskab med medlemsfordele). *Bygget:* prisberegneren og forsiden.
3. **Prisreglerne i eventformularen:** Formularen afviser en pris, der bryder lejereglerne, med en klar forklaring ved feltet. Ved gratis leje skal ikke-medlemmer betale mindst 150 kr. i A-tid og 75 kr. i B-tid (0012, som erstatter 0006). Ved reduceret leje er minimum medlemsprisen plus tillægget (100 kr. aften og weekend og 50 kr. om dagen under 400 kr.). Bestyrelsens egne events fra admin er ikke omfattet. *Bygget:* tjekket på serveren (`room-bookings.ts` `nonMemberMinimumKr`), forklaringen ved feltet og i Sagas chat.
4. **Besked til underviseren:** Underviseren får automatisk en mail, når bestyrelsen godkender eller afviser et event. Det er bestyrelsens handling, der sender den. Formanden gav sit udtrykkelige ja til undtagelsen fra reglen om, at Saga aldrig sender mail af sig selv. *Ikke bygget endnu.*
5. **Betaling:** Stripe kobles på nu (billetsalg og leje). Ændret samme dag: trin for trin, og ikke med Connect først. Se 0009. *Ikke bygget endnu.*
6. **Facebook-begivenheden:** Begge dele. Underviseren må gerne selv oprette sin begivenhed, og ellers gør Hjerterum det (Lisbeth og Frederik), så alle events får en. *Teksterne følger med i oprydningen (PR #416).*
7. **Den gamle side (holistisk.org):** "Vi er ikke klar til at tage den nye side i brug. Men den nye side skal formulere sig som om at den er main site." Den gamle side bliver, som den er. Den nye side taler som hovedsiden. *Teksterne følger med i oprydningen.*
