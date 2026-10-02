# Partnerplanen · Hjerterum Community Network

Status: Fase 1 implementeret 2026-10-02 (se `docs/decisions/0006-partner-events.md` og Blueprint, afsnit "Partnerplanen"). Fase 2-4 er ikke bygget og bygges først, når fase 1 er valideret.

## Formål

Udvikl Hjerterum gradvist fra at være et enkeltstående fællesskab til også at være et knudepunkt mellem lokale fællesskaber.

Målet er ikke i første omgang at sælge et medlemssystem til andre foreninger. Målet er at skabe et enkelt win-win-netværk, hvor Hjerterums medlemmer får adgang til flere relevante oplevelser og medlemsfordele, mens partnerne får ekstra synlighed og potentielt flere deltagere.

## Fase 1 · Partner-events

Start ekstremt simpelt. Invitér relevante foreninger, centre, fællesskaber og arrangører til at blive Hjerterum-partnere.

Partneren skal som udgangspunkt kun tage stilling til én ting:

> Vil I tilbyde Hjerterums medlemmer en særlig medlemsrabat på jeres events?

Partneren vælger selv rabatniveauet. Eksempel: normalpris 250 kr., Hjerterum-medlemspris 200 kr.

**Hjerterum leverer**

- Partnerens relevante events vises i Hjerterums eventkalender.
- Events præsenteres som partner-events.
- Hjerterums medlemmer kan se medlemsprisen.
- Tilmelding og betaling kan i første fase fortsat foregå hos partneren.
- Partnerens eget brand og billetsystem bevares.

**Partneren leverer**

- Tilladelse til at vise relevante events.
- En aftalt medlemsrabat.
- En kilde eller information, som gør det muligt at hente/oprette events.

Partneren skal ikke tvinges til at bruge Hjerterums administrationssystem.

## Saga · Automatisering

Brug Saga til at minimere den administrative belastning. Saga skal på sigt kunne:

1. hente eller modtage nye partner-events
2. oprette events i Hjerterums system
3. identificere relevante informationer
4. præsentere eventet korrekt
5. markere det som partner-event
6. vise normalpris og medlemspris
7. opdatere ændringer
8. håndtere udløbne events

Målet er: partneren skal næsten ikke gøre noget efter det første ja. Undgå manuel administration, hvor automatisering kan løse opgaven sikkert.

## Fase 2 · Mål og validering

Før der bygges større funktionalitet, skal den første model afprøves. Mål blandt andet:

- antal aktive partnere
- antal partner-events
- antal visninger
- antal klik videre til partneren
- antal medlemsrabatter anvendt
- hvilke typer events der fungerer bedst
- om medlemmer oplever større værdi af deres Hjerterum-medlemskab
- om partnerne oplever flere relevante deltagere

Brug resultaterne til at beslutte næste fase. Byg ikke videre alene fordi teknologien gør det muligt.

## Fase 3 · Krydsvejen

Når fase 1 fungerer, undersøges den omvendte model: partnernes medlemmer kan få særlige priser eller medlemsfordele på udvalgte Hjerterum-events.

Hjerterum-medlem → rabat hos partner, og senere: partner-medlem → rabat hos Hjerterum.

Det kan efterfølgende håndteres gennem Hjerterums platform, men først når der er et dokumenteret behov.

## Fase 4 · Fællesskab på tværs

Når netværket er etableret, kan platformen gradvist udvides med fælles eventunivers, events arrangeret af flere organisationer, krydspromovering, fælles medlemsfordele, anbefalinger på tværs, fælles temauger og arrangementer, eventuelt fælles medlemskab og eventuelt adgang til partner-events direkte gennem Hjerterum-platformen.

Dette er en mulig fremtidig retning, ikke noget der skal bygges nu.

## Principper

1. **Lav friktion.** En partner skal kunne sige "Ja, vi giver Hjerterums medlemmer 10 % rabat", og derefter skal systemet gøre mest muligt af arbejdet.
2. **Partneren beholder sin selvstændighed:** eget brand, eget medlemskab, egne medlemmer, eget billetsystem, egen betaling, egne data og egen administration. Hjerterum er et netværks- og distributionslag, ikke en tvangsmæssig erstatning for partnerens eksisterende system.
3. **Start med distribution, ikke software.** Den første værdi er flere relevante events og dermed flere muligheder for Hjerterums medlemmer.
4. **Rabatten er mekanismen, ikke produktet.** Det egentlige produkt er fællesskab på tværs.
5. **Hjerterum skal blive mere attraktivt som medlemskab.** Et medlemskab skal gradvist betyde: "Jeg får adgang til mere end Hjerterums egne aktiviteter."
6. **Ingen big-bang.** Implementér i små trin. Først når der er reel brug og dokumenteret værdi, bygges næste lag.

## Visionen

På længere sigt kan Hjerterum blive et digitalt knudepunkt for fællesskaber: mange selvstændige fællesskaber, én fælles måde at opdage relevante events og fællesskaber på. Organisationerne beholder deres identitet, medlemmerne får flere muligheder, og Hjerterum bliver mere værdifuldt, fordi det forbinder mennesker med et større fællesskab end sit eget.

## Udviklingsregel

Når Partnerplanen aktiveres i et udviklingsprojekt:

1. Gennemgå først det eksisterende Hjerterum-system.
2. Kontrollér, hvad der allerede findes, før noget nyt bygges.
3. Opdater Blueprint som den primære tekniske sandhed.
4. Implementér kun den næste nødvendige fase.
5. Genbrug eksisterende arkitektur og komponenter, hvor det er muligt.
6. Automatisér med Saga, hvor det er sikkert og meningsfuldt.
7. Undgå at bygge fremtidige faser, før de er valideret.
8. Test hele brugerflowet fra partner → event → medlem → rabat → ekstern tilmelding.
9. Dokumentér beslutninger og målepunkter.
10. Fortsæt gennem analyse, implementering, test og verificering uden at behandle checkpoints som slutpunkter.

**Første konkrete mål:** Få én ekstern partner til at sige ja til medlemsrabat og få partnerens første events automatisk ind i Hjerterums kalender. Derefter må virkeligheden afgøre, hvor vi går hen.
