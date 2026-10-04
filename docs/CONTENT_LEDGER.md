# Indholdsregnskab: holistisk.org → hjerterum

Requested: "tag al indholdet fra holistisk.org og importér og restrukturér det - ryd op - så vi ikke lader noget gå tabt".
Every one of holistisk.org's 56 pages is listed with the place that now carries its content. The old address
answers with a permanent redirect to that place (`apps/web/site/redirects.ts`), so links and bookmarks keep working.
The untouched originals are archived in `docs/legacy/holistisk-org/pages/`; this document is written from
`apps/web/site/ledger.ts` and checked by `apps/web/worker/website.test.ts`.

## Struktur

The menu follows hjerterum.info: Events · Behandling & terapi · Behandlere & undervisere · Medlemskab · Lej Hjerterum ·
Vision / om os · Kontakt · English. The content pages live in `apps/web/site/pages.ts` and `pages-en.ts`.

## Medier

- The 73 pictures and 8 PDF documents shown on the pages are copied into the platform (`apps/web/public/media`,
  `apps/web/public/dokumenter`); `docs/legacy/holistisk-org/media-copied.json` maps each original address to its copy.
- The whole WordPress media library (603 files, mostly event posters) is listed in
  `docs/legacy/holistisk-org/media-library.json`. Those files still live on holistisk.org - download them before
  holistisk.org is closed.

## Sider

| holistisk.org | Titel | Ændret | Står nu | Note |
|---|---|---|---|---|
| [administrer-dine-events](https://holistisk.org/administrer-dine-events/) | Administrer dine events | 2026-08-24 | [/lej-hjerterum/dine-events](/lej-hjerterum/dine-events) | Vejledningen er skrevet om til medlemsområdet (Mine events); den gamle vejledning er bevaret for events i den tidligere kalender. |
| [artikler](https://holistisk.org/artikler/) | Artikler | 2026-04-10 | [/om-os/artikler](/om-os/artikler) |  |
| [become-a-member](https://holistisk.org/become-a-member/) | Become a member of Hjerterum | 2026-09-29 | [/en/membership](/en/membership) |  |
| [behandling-terapi](https://holistisk.org/behandling-terapi/) | Behandlere i Hjerterum | 2024-02-04 | [/behandling](/behandling) | Aurora Gayatri og Soroush Zand er ikke længere med (besluttet 4. oktober 2026); Douglas Crawford er tilføjet fra den engelske side. Introduktionen til breathwork er bevaret. |
| [benefits-of-membership](https://holistisk.org/benefits-of-membership/) | Benefits of membership | 2026-08-16 | [/en/membership#benefits](/en/membership#benefits) |  |
| [betingelser-for-leje-af-sal](https://holistisk.org/betingelser-for-leje-af-sal/) | Vilkår for leje af sal | 2026-06-05 | [/lej-hjerterum/vilkaar](/lej-hjerterum/vilkaar) |  |
| [bliv-medlem](https://holistisk.org/bliv-medlem/) | Bliv medlem af Hjerterum | 2026-09-29 | [/medlemskab](/medlemskab) | Indmeldelse sker fortsat på holistisk.org (som fra hjerterum.info), indtil betaling kører på platformen. |
| [book-dit-event](https://holistisk.org/book-dit-event/) | Book dit event | 2026-04-24 | [/lej-hjerterum#booking](/lej-hjerterum#booking) | Formularerne gjaldt kun til 30. april 2026; booking sker nu via prisberegneren. |
| [book-your-event](https://holistisk.org/book-your-event/) | Book your Event | 2026-03-25 | [/en/rent#booking](/en/rent#booking) | Formularerne gjaldt kun til 30. april 2026; booking sker nu via prisberegneren. |
| [brug-centret](https://holistisk.org/brug-centret/) | Om Vores Sal | 2026-08-28 | [/lej-hjerterum](/lej-hjerterum) |  |
| [conditions-for-renting-the-room](https://holistisk.org/conditions-for-renting-the-room/) | Conditions for renting the room | 2026-06-05 | [/en/rent#conditions](/en/rent#conditions) |  |
| [conditions-of-membership](https://holistisk.org/conditions-of-membership/) | Terms and Conditions of Membership | 2026-07-25 | [/en/membership#terms](/en/membership#terms) |  |
| [contact-us](https://holistisk.org/contact-us/) | Contact Us | 2026-06-04 | [/en#contact](/en#contact) |  |
| [donationer](https://holistisk.org/donationer/) | Donationer | 2026-05-16 | [/medlemskab#stoet](/medlemskab#stoet) |  |
| [donations](https://holistisk.org/donations/) | Donations | 2026-05-04 | [/en/membership#donations](/en/membership#donations) |  |
| [events](https://holistisk.org/events/) | Events | 2026-09-29 | [/events](/events) |  |
| [events-en](https://holistisk.org/events-en/) | Events | 2026-09-29 | [/en#events](/en#events) |  |
| [faellesspisning-i-hjerterum](https://holistisk.org/faellesspisning-i-hjerterum/) | Fællesspisning i Hjerterum | 2019-08-26 | [/events#hjerterum-open](/events#hjerterum-open) | De 8 billeder fra 2019 vises som galleri under Hjerterum Open. |
| [fakturaer](https://holistisk.org/fakturaer/) | Betal din faktura | 2026-04-24 | [/lej-hjerterum/vilkaar#betaling](/lej-hjerterum/vilkaar#betaling) | WordPress' fakturalogin er udgået; faktura sendes pr. mail. |
| [faste-laerere-regular-teachers](https://holistisk.org/faste-laerere-regular-teachers/) | Faste undervisere / Regular teachers | 2026-06-23 | [/behandlere#faste-undervisere](/behandlere#faste-undervisere) |  |
| [fordele-ved-medlemskab](https://holistisk.org/fordele-ved-medlemskab/) | Fordele ved et medlemskab | 2026-09-29 | [/medlemskab#fordele](/medlemskab#fordele) |  |
| [generalforsamling-general-assembly](https://holistisk.org/generalforsamling-general-assembly/) | Generalforsamling/møder | 2026-05-17 | [/om-os/foreningen#generalforsamling](/om-os/foreningen#generalforsamling) |  |
| [guidelines-for-teachers](https://holistisk.org/guidelines-for-teachers/) | Practical Information | 2026-08-24 | [/en/rent#practical](/en/rent#practical) | WiFi-koden står ikke på den offentlige side; den følger bookingen. |
| [guidelines-for-undervisere](https://holistisk.org/guidelines-for-undervisere/) | Praktisk Information | 2026-06-05 | [/lej-hjerterum/praktisk](/lej-hjerterum/praktisk) | WiFi-koden står ikke på den offentlige side; den følger bookingen. |
| [himalayan-hermitage](https://holistisk.org/himalayan-hermitage/) | Himalayan Hermitage | 2026-03-03 | [/om-os/himalayan-hermitage](/om-os/himalayan-hermitage) | Den engelske udgave er samlet med den danske på én side. |
| [himalayan-hermitage-2](https://holistisk.org/himalayan-hermitage-2/) | Himalayan Hermitage | 2020-11-23 | [/om-os/himalayan-hermitage](/om-os/himalayan-hermitage) |  |
| [historien-bag-hjerterum](https://holistisk.org/historien-bag-hjerterum/) | Historien bag Hjerterum | 2026-05-17 | [/om-os/historien](/om-os/historien) |  |
| [hjerterum-betalinger](https://holistisk.org/hjerterum-betalinger/) | Hjerterum payments | 2019-12-13 | [/lej-hjerterum/vilkaar#betaling](/lej-hjerterum/vilkaar#betaling) | Tom side; betaling via faktura pr. mail. |
| [hjerterum-tribes](https://holistisk.org/hjerterum-tribes/) | Hjerterum Tribes! | 2026-06-13 | [/om-os/tribes](/om-os/tribes) | Sætningen om opstart i august/september er fjernet som forældet; ansøgning via tribes.dk. |
| [hvad-er-breathwork](https://holistisk.org/hvad-er-breathwork/) | Hvad er breathwork? | 2020-11-23 | [/behandling#breathwork](/behandling#breathwork) |  |
| [kalendervisning](https://holistisk.org/kalendervisning/) | Kalender | 2024-10-03 | [/events](/events) |  |
| [kontakt](https://holistisk.org/kontakt/) | Tag Kontakt | 2019-08-28 | [/kontakt](/kontakt) | Kontaktside fra 2019 (Mejlgade 95, daværende team); erstattet af den nuværende kontaktside. |
| [kontakt-os](https://holistisk.org/kontakt-os/) | Kontakt os | 2026-08-05 | [/kontakt](/kontakt) |  |
| [lav-indkomst-medlemskab-low-income-membership](https://holistisk.org/lav-indkomst-medlemskab-low-income-membership/) | – | 2026-04-29 | [/medlemskab#reduceret](/medlemskab#reduceret) |  |
| [lejepriser](https://holistisk.org/lejepriser/) | Lej Sal | 2026-08-28 | [/lej-hjerterum#priser](/lej-hjerterum#priser) |  |
| [log-ud](https://holistisk.org/log-ud/) | Log out | 2024-10-03 | – (/) | WordPress' log-ud-side uden indhold; log ud sker nu i medlemsområdet. |
| [managing-your-event](https://holistisk.org/managing-your-event/) | Managing Your Event | 2026-08-24 | [/en/rent#your-events](/en/rent#your-events) |  |
| [markedsforing](https://holistisk.org/markedsforing/) | Markedsføring af dit event | 2026-05-17 | [/lej-hjerterum/markedsfoering](/lej-hjerterum/markedsfoering) |  |
| [marketing-of-your-event](https://holistisk.org/marketing-of-your-event/) | Marketing of your Event | 2026-05-17 | [/en/rent#marketing](/en/rent#marketing) |  |
| [medlems-login](https://holistisk.org/medlems-login/) | Members-login | 2026-05-17 | – (/sign-in) | WordPress' login-side uden indhold; login er nu /sign-in. |
| [medlemskabs-betingelser](https://holistisk.org/medlemskabs-betingelser/) | Vilkår for medlemskab | 2026-07-25 | [/medlemskab/vilkaar](/medlemskab/vilkaar) |  |
| [nye-community-events-hjerterum-events](https://holistisk.org/nye-community-events-hjerterum-events/) | Hjerterum Open Events | 2026-08-13 | [/events#hjerterum-open](/events#hjerterum-open) |  |
| [nyhedsbrev](https://holistisk.org/nyhedsbrev/) | Nyhedsbrev / Newsletter | 2026-05-17 | [/om-os/foreningen#nyhedsbreve](/om-os/foreningen#nyhedsbreve) | Mailchimp-links uden sporings-id; efteråret 2024 kopieret som PDF. Tilmelding til nyhedsbrevet er på forsiden, kontakt- og foreningssiden. |
| [online-events](https://holistisk.org/online-events/) | Online Events | 2020-11-26 | [/events](/events) | Online events fra 2020 tilbydes ikke længere; nævnt i historien. |
| [pay-your-invoice](https://holistisk.org/pay-your-invoice/) | Pay your invoice | 2026-04-24 | [/en/rent#payment](/en/rent#payment) | WordPress' fakturalogin er udgået; faktura sendes pr. mail. |
| [price-list](https://holistisk.org/price-list/) | Book Room | 2026-08-28 | [/en/rent#prices](/en/rent#prices) |  |
| [team](https://holistisk.org/team/) | The Team | 2026-05-16 | [/en/team](/en/team) |  |
| [teamet](https://holistisk.org/teamet/) | Teamet bag | 2026-05-16 | [/om-os/teamet](/om-os/teamet) |  |
| [test](https://holistisk.org/) | – | 2026-09-29 | [/](/) | Udkastet til holistisk.org's nye forside; indholdet indgår i den nye forside. |
| [treatment-and-therapy](https://holistisk.org/treatment-and-therapy/) | Therapists | 2022-12-21 | [/en#treatments](/en#treatments) | Som den danske side: kun Douglas Crawford er med. |
| [tribes](https://holistisk.org/tribes/) | Hjerterum Tribes | 2026-06-11 | [/en/team#tribes](/en/team#tribes) |  |
| [udtalelser-om-breathwork](https://holistisk.org/udtalelser-om-breathwork/) | En journaliststuderendes beretning | 2021-04-20 | [/behandling/breathwork](/behandling/breathwork) |  |
| [use-hjerterum](https://holistisk.org/use-hjerterum/) | About Our Room | 2026-08-28 | [/en/rent](/en/rent) |  |
| [vision](https://holistisk.org/vision/) | Hvad er Hjerterum? | 2026-06-05 | [/om-os](/om-os) | Vedtægterne er flyttet ordret til foreningssiden (/om-os/foreningen#vedtaegter). |
| [vision-en](https://holistisk.org/vision-en/) | What is Hjerterum? | 2026-06-05 | [/en#about](/en#about) |  |
| [welcome](https://holistisk.org/welcome/) | – | 2026-09-29 | [/en](/en) | Mailchimp-tilmeldingen er genskabt som formular på siden. |
