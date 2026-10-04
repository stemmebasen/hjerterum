import { carrierOf, redirectFor, RETIRED } from "./redirects.js";

/** docs/CONTENT_LEDGER.md, written from the code: where each holistisk.org page's content stands now, and what was
 * tidied. worker/website.test.ts fails when the document and the site disagree. */

export type LegacyPage = { slug: string; title: string; url: string; modified: string };

/** What was tidied, moved or left out - and why. Everything else was carried over in full, in cleaner words. */
export const NOTES: Record<string, string> = {
  "administrer-dine-events": "Vejledningen er skrevet om til medlemsområdet (Mine events); den gamle vejledning er bevaret for events i den tidligere kalender.",
  "behandling-terapi": "Behandlerne er fra 2021–2024 (Aurora Gayatri, Soroush Zand); Douglas Crawford er tilføjet fra den engelske side. Bør bekræftes af bestyrelsen.",
  "book-dit-event": "Formularerne gjaldt kun til 30. april 2026; booking sker nu via prisberegneren.",
  "book-your-event": "Formularerne gjaldt kun til 30. april 2026; booking sker nu via prisberegneren.",
  "bliv-medlem": "Indmeldelse sker fortsat på holistisk.org (som fra hjerterum.info), indtil betaling kører på platformen.",
  "faellesspisning-i-hjerterum": "De 8 billeder fra 2019 vises som galleri under Hjerterum Open.",
  "fakturaer": "WordPress' fakturalogin er udgået; faktura sendes pr. mail.",
  "guidelines-for-undervisere": "WiFi-koden står ikke på den offentlige side; den følger bookingen.",
  "guidelines-for-teachers": "WiFi-koden står ikke på den offentlige side; den følger bookingen.",
  "hjerterum-betalinger": "Tom side; betaling via faktura pr. mail.",
  "hjerterum-tribes": "Sætningen om opstart i august/september er fjernet som forældet; ansøgning via tribes.dk.",
  "himalayan-hermitage": "Den engelske udgave er samlet med den danske på én side.",
  "kontakt": "Kontaktside fra 2019 (Mejlgade 95, daværende team); erstattet af den nuværende kontaktside.",
  "nyhedsbrev": "Mailchimp-links uden sporings-id; efteråret 2024 kopieret som PDF. Tilmelding til nyhedsbrevet er på forsiden, kontakt- og foreningssiden.",
  "online-events": "Online events fra 2020 tilbydes ikke længere; nævnt i historien.",
  "pay-your-invoice": "WordPress' fakturalogin er udgået; faktura sendes pr. mail.",
  "test": "Udkastet til holistisk.org's nye forside; indholdet indgår i den nye forside.",
  "vision": "Vedtægterne er flyttet ordret til foreningssiden (/om-os/foreningen#vedtaegter).",
  "welcome": "Mailchimp-tilmeldingen er genskabt som formular på siden.",
  ...RETIRED
};

export function buildLedger(pages: LegacyPage[]): string {
  const rows = pages.map(page => {
    const target = redirectFor(`/${page.slug}`) ?? `/${page.slug}`;
    const carrier = carrierOf(page.slug);
    const where = carrier ? `[${target}](${target})` : `– (${target})`;
    return `| [${page.slug}](${page.url}) | ${page.title.replace(/\|/g, "/") || "–"} | ${page.modified} | ${where} | ${NOTES[page.slug] ?? ""} |`;
  });
  return `# Indholdsregnskab: holistisk.org → hjerterum

Requested: "tag al indholdet fra holistisk.org og importér og restrukturér det - ryd op - så vi ikke lader noget gå tabt".
Every one of holistisk.org's ${pages.length} pages is listed with the place that now carries its content. The old address
answers with a permanent redirect to that place (\`apps/web/site/redirects.ts\`), so links and bookmarks keep working.
The untouched originals are archived in \`docs/legacy/holistisk-org/pages/\`; this document is written from
\`apps/web/site/ledger.ts\` and checked by \`apps/web/worker/website.test.ts\`.

## Struktur

The menu follows hjerterum.info: Events · Behandling & terapi · Behandlere & undervisere · Medlemskab · Lej Hjerterum ·
Vision / om os · Kontakt · English. The content pages live in \`apps/web/site/pages.ts\` and \`pages-en.ts\`.

## Medier

- The 73 pictures and 8 PDF documents shown on the pages are copied into the platform (\`apps/web/public/media\`,
  \`apps/web/public/dokumenter\`); \`docs/legacy/holistisk-org/media-copied.json\` maps each original address to its copy.
- The whole WordPress media library (603 files, mostly event posters) is listed in
  \`docs/legacy/holistisk-org/media-library.json\`. Those files still live on holistisk.org - download them before
  holistisk.org is closed.

## Sider

| holistisk.org | Titel | Ændret | Står nu | Note |
|---|---|---|---|---|
${rows.join("\n")}
`;
}
