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
- **Højst 3 om dagen (tilføjet samme aften):** et sent 1. opslag laves kun, når der er plads inden for dagens tre. Ellers får eventet ét opslag 7–9 dage før.
- **Samme dag (tilføjet samme aften):** "Det skal være et nødstilfælde, hvis et event skal promoveres, når det foregår på samme dag." Saga foreslår det aldrig selv.
- **1. opslag forsvinder ikke (6. nov.):** "et opslag om et kursus i mirakler, som skulle sendes i dag, to uger før, men som nu er helt forsvundet." Når et 1. opslag ikke kan få en ny tid inden for dagens tre, senest ti dage før eventet, lægges det ikke til side, så længe påmindelsen står tilbage. Det får i stedet første mulige tid frem til dagen før påmindelsen, og kun hvis der ingen anden vej er, som et fjerde opslag den dag.
- **Dato i teksten (6. nov.):** "Det er en fejl, at der bare står lørdag klokken 10:30, da det først er lørdagen efter." Eventets ugedag står altid med dato ("lørdag d. 21. november kl. 10.30"), både i Sagas tekster og i de ventende opslag.
- **Emojis (6. nov.):** "passende emojis, og gerne nogle, der er baseret i naturen eller begejstring og kærlighed". Facebook får 1-2 og Instagram 2-4, valgt til netop eventet.
- **Op til 5 om dagen (6. nov.):** "Der er stadig en del steder med kun 1 dag til eventet … Husk også at delinger på de sociale medier sagtens kan krydse hinanden i kalenderen." Formandens valg: "Op til 5 om dagen". Normalt gælder dagens tre tider (12, 15 og 19.30). Kommer et event ellers ud mindre end 3 dage før, må Saga bruge to ekstra tider, kl. 9.30 og 17.30, med mindst to timer imellem. Facebook og Instagram må gerne ligge på samme tid. Hver time rykker Saga sine forslag frem: helst 3 dage før, ellers 2 dage før. Tidspunkter, som formanden selv har valgt (flyttet i kalenderen eller gemt), røres ikke.
- **Facebook-begivenheden i stedet (6. nov.):** "Er det muligt at dele selve eventet (altså videresende kan man sige) som et post via systemet?" og "Når der ikke er godkendt et opslag, så deles selve eventet bare". Reglen er en indstilling, som formanden slår til under PR og SoMe → Overblik ("Del Facebook-begivenheden"), så den er godkendt i admin. Når den er slået til, og eventets sidste opslag når sit tidspunkt uden godkendelse, deler Saga i stedet eventets Facebook-begivenhed på Facebook. Det sker kun, når begivenheden er oprettet med link, og ingen af eventets opslag er godkendt. Opslaget får titel og tidspunkt og vises som begivenhedens eget kort. Det sker én gang pr. event, kun på Facebook, og formanden får besked på Telegram.
- **Eventet selv ved både 14 og 7 dage (8. nov.):** "let's simply repost the event itself when nothing else has been planned still working out 7 and 14 days rule". Formandens valg: "Ved både 14 og 7 dage". Med indstillingen slået til gælder reglen nu for hvert af eventets opslag: når opslaget 14-16 dage før eller påmindelsen 7-9 dage før når sit tidspunkt uden godkendelse, deles eventet selv på Facebook på opslagets tid. Det gælder, uanset om et andet af eventets opslag er godkendt. Er Facebook-begivenheden oprettet med link, deles den; ellers deles eventets egen side med titel og tidspunkt. Er der ikke plads til påmindelsen blandt dagens tre, får den et af dagens ekstra tidspunkter ("Op til 5 om dagen"), så eventet også deles 7 dage før. En påmindelse, der laves ud fra et delt første opslag, får det oprindelige link og begge medier igen.
- **Friskere sprog med emojis (7. nov.):** "Sproget er nødt til at være meget mere friskt, og vi skal bruge emojis til opslagene", med formandens eget eksempel ("🎬 Film, fællesskab og gode snakke! …"). Sagas eventopslag og tekstforslag har nu denne form:
  1. En første linje med emoji og et kort udråb.
  2. Et kort afsnit om, hvad man oplever.
  3. Hvem der er vært, med emojis.
  4. "📅 Mandag d. 9. november" og uret med "Kl. 18.45" på hver sin linje (`whenLines`).
  5. En varm, inviterende afslutning med emoji.

  Opslaget er på 50-90 ord med 4-7 emojis. Formandens eksempel er Sagas model for formen, ikke for ordene.
- **Eventet selv uden linkkort (8. nov.):** "Det er ikke et link vi skal dele med repost af opslaget". Formandens valg: "Kort fast tekst + billede". Når et opslag ikke er godkendt i tide, udgives eventet selv på opslagets tid på opslagets egne medier (Facebook og Instagram). Det er eventets billede, design eller video med en kort, fast tekst: titel, dag og tid, vært, Hjerterum og tilmelding ("her 👇" med linket på Facebook, "via linket i bio" på Instagram). Ingen tekst fra Saga går ud ulæst, og det er aldrig et linkkort. Facebook-begivenheden bruges ikke længere til det.
- **Sagas indledning (8. nov.):** "Men kan du komme med nogle eksempler på hvad Saga kan skrive i de linjer". Formandens valg: "Saga skriver indledningen". Over de faste linjer skriver Saga én kort linje (højst 12 ord) med 1-2 emojis (`eventHook`). Linjen går ud, uden at formanden har læst den. En linje med tal, tid, link eller hashtag bruges ikke, og uden Sagas AI er der ingen indledning.
- **Knappen "Del eventet med kort tekst" (8. nov.):** "Jeg vil også gerne kunne omgøre et design så Saga bare viderdeler eventet med en kort tekst som vi lige har skrevet om". Knappen står på et events opslag under PR og SoMe → Ugens opslag (`asEventItself`). Den gør opslaget til eventet selv: eventets eget billede igen (ikke designet og ingen video) med Sagas korte indledning og de faste linjer. Opslaget bliver et forslag igen, som formanden læser og godkender. Eventets eget billede gemmes, når et design lægges på (`eventImage`).
