# 0007 Nye admin-funktioner er først kun for formanden

Dato: 2. november 2026. Besluttet af formanden (Jacob Hauge) i udviklingssamtalen.

## Beslutning

"Generelt når vi udvikler ny admin funktion skal det til start kun være tilgængelig for mig."

En ny funktion i bestyrelsens admin (admin.hjerterum.info) er fra start kun for formanden som superadmin, logget ind med sit
personlige login fra Saga. Den åbnes for resten af bestyrelsen, når formanden siger det.

## Sådan gøres det

- Funktionen får en linje i `POWERS` i `apps/web/worker/cockpit/authority.ts` med `needs: "personal"`, og ruterne spørger
  `may("…")` / `denied("…")`. Links og kort til funktionen vises kun, når `may` siger ja.
- Rører den andre menneskers data, skrives brugen i formandens log med `audit(...)`.
- Saga giver kun formanden besked om funktionen (privat på Telegram), ikke bestyrelsens gruppe.
- Når formanden åbner den for bestyrelsen, fjernes linjen fra `POWERS` (og testen ændres med).

Suppleanter har altid kun læseadgang (se `apps/web/worker/cockpit/deputies.ts`).

## Status 2. november 2026

- Kun formanden: nyhedsbrevet "Månedens events" (`newsletter.manage`).
- Kun formanden (3. november): PR og sociale medier (`social.manage`).
- Kun formanden (3. november): Plakater og opslag med designskabelonerne (`posters.design`).
- Åbnet for bestyrelsen: ret og slet af events oprettet i systemet ("Nej kun nyhedsbrevet delen").
