import { HOME_SOURCES, SITE_PAGES, type SitePage } from "./pages.js";

/** Every address of holistisk.org (and the platform's earlier copies of them) leads somewhere: the new page that now
 * carries its content, at the right place on that page. The worker answers these with 301 (worker/config-entry.ts),
 * so old links, bookmarks and search results keep working. Requested: "så vi ikke lader noget gå tabt". */
export const REDIRECTS: Record<string, string> = {
  // Events
  "/kalendervisning": "/events",
  "/nye-community-events-hjerterum-events": "/events#hjerterum-open",
  "/online-events": "/events",
  "/faellesspisning-i-hjerterum": "/events#hjerterum-open",
  // Behandling og Terapi - removed ("skal fjernes helt"): the old addresses, and the platform's own, lead to the practitioners.
  "/behandling-terapi": "/behandlere",
  "/hvad-er-breathwork": "/behandlere",
  "/udtalelser-om-breathwork": "/om-os",
  "/behandling": "/behandlere",
  "/behandling/breathwork": "/om-os",
  // Behandlere & undervisere
  "/faste-laerere-regular-teachers": "/behandlere",
  // Medlemskab
  "/bliv-medlem": "/medlemskab",
  "/fordele-ved-medlemskab": "/medlemskab/fordele",
  "/lav-indkomst-medlemskab-low-income-membership": "/medlemskab",
  "/donationer": "/medlemskab#stoet",
  "/medlemskabs-betingelser": "/medlemskab/vilkaar",
  "/medlems-login": "/sign-in",
  "/log-ud": "/",
  // Brug Hjerterum (until 18 October 2026: Lej Hjerterum, /lej-hjerterum)
  "/brug-centret": "/brug-hjerterum",
  "/lejepriser": "/brug-hjerterum/lejepriser#priser",
  "/book-dit-event": "/brug-hjerterum/booking#book",
  "/guidelines-for-undervisere": "/brug-hjerterum/praktisk",
  "/praktisk-information": "/brug-hjerterum/praktisk",
  "/betingelser-for-leje-af-sal": "/brug-hjerterum/vilkaar",
  "/fakturaer": "/brug-hjerterum/vilkaar#betaling",
  "/hjerterum-betalinger": "/brug-hjerterum/vilkaar#betaling",
  "/markedsforing": "/brug-hjerterum/pr",
  "/administrer-dine-events": "/brug-hjerterum/aendr-event",
  "/lej-hjerterum": "/brug-hjerterum",
  "/lej-hjerterum/praktisk": "/brug-hjerterum/praktisk",
  "/lej-hjerterum/vilkaar": "/brug-hjerterum/vilkaar",
  "/lej-hjerterum/markedsfoering": "/brug-hjerterum/pr",
  "/lej-hjerterum/dine-events": "/brug-hjerterum/aendr-event",
  // Requested (the chair, 3 Nov 2026): "Vi skal generelt have ryddet op og simplificeret processen og beskrivelsesteksterne" - Brug Hjerterum's
  // guides gathered: Kom godt i gang and the guides' page into Sådan booker du; Facebook, eventbillede and markedsføring into PR for dit event;
  // aflys into ændr eller aflys.
  "/brug-hjerterum/kom-i-gang": "/brug-hjerterum/booking",
  "/brug-hjerterum/eventguides": "/brug-hjerterum/booking",
  "/brug-hjerterum/facebook": "/brug-hjerterum/pr#facebook",
  "/brug-hjerterum/eventbillede": "/brug-hjerterum/pr#coverbillede",
  "/brug-hjerterum/markedsfoering": "/brug-hjerterum/pr",
  "/brug-hjerterum/aflys-event": "/brug-hjerterum/aendr-event#aflys",
  // Vision / om os
  "/vision": "/om-os",
  "/teamet": "/om-os/teamet",
  "/historien-bag-hjerterum": "/om-os/historien",
  "/hjerterum-tribes": "/om-os",
  "/generalforsamling-general-assembly": "/om-os/foreningen#generalforsamling",
  "/nyhedsbrev": "/om-os/foreningen#nyhedsbreve",
  // Requested: "Slet https://www.hjerterum.info/om-os/artikler" and ".../om-os/himalayan-hermitage" (10 October 2026).
  "/artikler": "/om-os",
  "/himalayan-hermitage": "/om-os",
  "/himalayan-hermitage-2": "/om-os",
  "/om-os/artikler": "/om-os",
  "/om-os/himalayan-hermitage": "/om-os",
  // Kontakt
  "/kontakt-os": "/kontakt",
  // English
  // The English pages are gone (Douglas' notes: "Translate button, but not English pages"): their addresses lead to the Danish ones.
  "/welcome": "/om-os",
  "/vision-en": "/om-os",
  "/events-en": "/events",
  "/contact-us": "/kontakt",
  "/treatment-and-therapy": "/behandlere",
  "/become-a-member": "/medlemskab",
  "/benefits-of-membership": "/medlemskab/fordele",
  "/conditions-of-membership": "/medlemskab/vilkaar",
  "/donations": "/medlemskab#stoet",
  "/use-hjerterum": "/brug-hjerterum",
  "/price-list": "/brug-hjerterum/lejepriser#priser",
  "/book-your-event": "/brug-hjerterum/booking#book",
  "/guidelines-for-teachers": "/brug-hjerterum/praktisk",
  "/conditions-for-renting-the-room": "/brug-hjerterum/vilkaar",
  "/pay-your-invoice": "/brug-hjerterum/vilkaar#betaling",
  "/managing-your-event": "/brug-hjerterum/aendr-event",
  "/marketing-of-your-event": "/brug-hjerterum/pr",
  "/team": "/om-os/teamet",
  "/tribes": "/om-os/teamet",
  "/en": "/",
  "/en/membership": "/medlemskab",
  "/en/rent": "/brug-hjerterum",
  "/en/team": "/om-os/teamet",
  // holistisk.org's draft front page
  "/test": "/"
};

/** WordPress' own pages with nothing to carry: logging in and out now happens at /sign-in. */
export const RETIRED: Record<string, string> = {
  // Requested: "\"Behandling og Terapi\" skal fjernes helt".
  "behandling-terapi": "Behandling og Terapi er fjernet fra hjemmesiden (4. oktober 2026); adressen fører til Behandlere & undervisere.",
  "hvad-er-breathwork": "Behandling og Terapi er fjernet fra hjemmesiden (4. oktober 2026); adressen fører til Behandlere & undervisere.",
  "udtalelser-om-breathwork": "Beretningen hørte til Behandling og Terapi, som er fjernet (4. oktober 2026); adressen fører til Om Hjerterum.",
  "treatment-and-therapy": "Treatments er fjernet fra den engelske side sammen med Behandling og Terapi (4. oktober 2026).",
  // Requested: "Alt vedrørende Tribes skal væk".
  "hjerterum-tribes": "Tribes er ikke længere en del af Hjerterum (fjernet 4. oktober 2026); adressen fører til Vision / om os.",
  "tribes": "Tribes er ikke længere en del af Hjerterum (fjernet 4. oktober 2026); adressen fører til The team.",
  "artikler": "Artikler er slettet fra hjemmesiden (10. oktober 2026); adressen fører til Om Hjerterum.",
  "himalayan-hermitage": "Himalayan Hermitage er slettet fra hjemmesiden (10. oktober 2026); adressen fører til Om Hjerterum.",
  "himalayan-hermitage-2": "Himalayan Hermitage er slettet fra hjemmesiden (10. oktober 2026); adressen fører til Om Hjerterum.",
  "log-ud": "WordPress' log-ud-side uden indhold; log ud sker nu i medlemsområdet.",
  "medlems-login": "WordPress' login-side uden indhold; login er nu /sign-in."
};

const normalize = (path: string) => (path.replace(/\/+$/, "") || "/").toLowerCase();

export function sitePage(path: string): SitePage | undefined {
  const wanted = normalize(path);
  return SITE_PAGES.find(page => page.path === wanted);
}

export function redirectFor(path: string): string | undefined {
  return REDIRECTS[normalize(path)];
}

/** Which page (path) carries a holistisk.org page now - for the content ledger and its test. */
export function carrierOf(slug: string): string | undefined {
  if (HOME_SOURCES.includes(slug)) return "/";
  return SITE_PAGES.find(page => page.sources.includes(slug))?.path;
}
