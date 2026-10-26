import type { D1Database } from "../db.js";
import { organizerBySlug } from "../organizers.js";
import type { EventRow } from "../web/queries.js";
import { html, type SafeHtml } from "../web/html.js";
import { crumbsNav, page, type Crumb, type PageContext } from "../web/layout.js";
import type { View } from "./pages.js";

/** Partners: local associations and venues that offer Flokken's members a ticket benefit and get visibility on the
 * platform in return. Only offers the organiser has actually confirmed are shown; the list is empty until then. */

export type OfferKind = "member_discount" | "reserved_seats" | "meeting_point" | "welcome_drink" | "eftermoede" | "flock_half_price" | "other";

export type PartnerOffer = {
  /** The organiser it applies to (src/organizers.ts slug = the events' organizer_id). */
  organizerSlug: string;
  /** Only these events (their slugs); empty or left out = all the organiser's events. */
  eventSlugs?: string[];
  kind: OfferKind;
  /** As the organiser worded it, e.g. "20 kr. rabat på billetten – vis Flokken ved indgangen". */
  text: string;
  /** Who at the organiser confirmed it, and when (ISO date). An offer without both is never shown. */
  confirmedBy: string;
  confirmedOn: string;
  /** Last day it applies (ISO date), if it ends. */
  validUntil?: string;
};

export const KIND_LABELS: Record<OfferKind, string> = {
  member_discount: "Medlemsrabat",
  reserved_seats: "Reserverede pladser",
  meeting_point: "Mødested før eventet",
  welcome_drink: "Kaffe eller velkomstdrink",
  eftermoede: "Eftermødet",
  flock_half_price: "Gave til flokken: halv pris",
  other: "Ekstra for flokke"
};

/** Confirmed offers. Add one only when the organiser has confirmed it in writing. */
export const PARTNER_OFFERS: PartnerOffer[] = [];

export function offersFor(e: Pick<EventRow, "organizer_id" | "slug" | "starts_at">, offers: PartnerOffer[] = PARTNER_OFFERS): PartnerOffer[] {
  return offers.filter(o => o.confirmedBy.trim() && /^\d{4}-\d{2}-\d{2}$/.test(o.confirmedOn)
    && o.organizerSlug === e.organizer_id
    && (!o.eventSlugs?.length || o.eventSlugs.includes(e.slug))
    && (!o.validUntil || Date.parse(o.validUntil + "T23:59:59Z") >= e.starts_at));
}

// ————————————————————————————————————————— The gift: half price for a flock of five

/** At an event where the organiser offers it, the gift a flock gets when five are gathered is half price on the ticket
 * for those five, through a discount code from the organiser. It is an addition for single events with seats to fill,
 * not the rule: most events have no such offer, and many are free. */
export const GIFT_FLOCK_SIZE = 5;

export const halfPriceOffer = (offers: PartnerOffer[]): PartnerOffer | undefined => offers.find(o => o.kind === "flock_half_price");

/** The organiser who sponsors an offer, by name. */
export const sponsorName = (o: PartnerOffer, fallback?: string | null): string => organizerBySlug(o.organizerSlug)?.name ?? fallback ?? o.organizerSlug;

/** The discount code for an event: from the secret FLOCK_GIFT_CODES ("event-slug=CODE,organizer-slug=CODE"; the event's
 * own slug wins). The codes stay out of the source, which is public. */
export function giftCode(codes: string | undefined, e: Pick<EventRow, "organizer_id" | "slug">): string | null {
  const pairs = new Map((codes ?? "").split(",").map(s => s.split("=").map(p => p.trim())).filter(p => p.length === 2 && p[0] && p[1]) as Array<[string, string]>);
  return pairs.get(e.slug) ?? (e.organizer_id ? pairs.get(e.organizer_id) : undefined) ?? null;
}

export function offersBlock(offers: PartnerOffer[], organizerName?: string | null): SafeHtml {
  if (!offers.length) return html``;
  const gift = halfPriceOffer(offers);
  const others = offers.filter(o => o !== gift);
  return html`${gift ? html`<section class="offer-box gift-box" aria-labelledby="h-gift">
  <h2 id="h-gift">Gave ved dette event: halv pris for flokken</h2>
  <p>Når I er ${GIFT_FLOCK_SIZE} samlet i en flok til eventet, giver vi jer halv pris på billetten – sponsoreret af ${sponsorName(gift, organizerName)}. De ${GIFT_FLOCK_SIZE} i flokken får en rabatkode på flokkens side og bruger den, når de køber billet hos arrangøren.</p>
  ${gift.text ? html`<p>${gift.text}</p>` : ""}
  <p class="small meta-muted">Tilbuddet er bekræftet af arrangøren. Gaven gælder de første ${GIFT_FLOCK_SIZE} i flokken.</p>
</section>` : ""}${others.length ? html`<section class="offer-box" aria-labelledby="h-offers">
  <h2 id="h-offers">For Flokkens medlemmer</h2>
  <ul>${others.map(o => html`<li><strong>${KIND_LABELS[o.kind]}:</strong> ${o.text}</li>`)}</ul>
  <p class="small meta-muted">Tilbuddet er bekræftet af arrangøren.</p>
</section>` : ""}`;
}

/** On a flock's own page, for its members: how far the flock is from the gift, or the code once five are gathered. */
export function flockGiftBox(gift: PartnerOffer, opts: { sponsor: string; memberCount: number; maxSize: number; place: number | null; code: string | null; contactEmail: string | null }): SafeHtml {
  const { sponsor, memberCount, maxSize, place, code, contactEmail } = opts;
  const missing = GIFT_FLOCK_SIZE - memberCount;
  const content = maxSize < GIFT_FLOCK_SIZE
    ? html`<p>Flokken har plads til ${maxSize}. Gaven kræver ${GIFT_FLOCK_SIZE} – den, der står for flokken, kan gøre plads til flere under <strong>Ret mødested og tidspunkt</strong>.</p>`
    : missing > 0
    ? html`<p>I er ${memberCount}. Mangler I ${missing === 1 ? "1 mere" : `${missing} mere`}, så får I halv pris på billetten. Del flokken med nogen, der også vil med.</p>`
    : place === null || place >= GIFT_FLOCK_SIZE
    ? html`<p>Gaven gælder de første ${GIFT_FLOCK_SIZE} i flokken, og de er samlet. Du er meget velkommen med alligevel.</p>`
    : code
    ? html`<p>I er samlet! Brug koden, når du køber billet hos arrangøren:</p><p class="code">${code}</p><p class="small meta-muted">Koden er til jer ${GIFT_FLOCK_SIZE} i flokken. Del den ikke med andre.</p>`
    : html`<p>I er samlet! Vi sender jer rabatkoden, så snart vi har den fra arrangøren.${contactEmail ? html` Spørgsmål: <a href="mailto:${contactEmail}">${contactEmail}</a>.` : ""}</p>`;
  return html`<section class="offer-box gift-box" aria-labelledby="h-gift">
  <h2 id="h-gift">Gave: halv pris for flokken</h2>
  <p class="small">Sponsoreret af ${sponsor}, når ${GIFT_FLOCK_SIZE} er samlet.</p>
  ${content}
</section>`;
}

// ————————————————————————————————————————— /samarbejde

export type InquiryForm = { organisation: string; contactName: string; email: string; website: string; message: string };
export type InquiryErrors = Partial<Record<keyof InquiryForm, string>>;

export function readInquiry(data: FormData): InquiryForm {
  const s = (k: string) => String(data.get(k) ?? "").trim();
  return { organisation: s("organisation"), contactName: s("navn"), email: s("email"), website: s("hjemmeside"), message: s("besked") };
}

export function validateInquiry(f: InquiryForm): InquiryErrors {
  const e: InquiryErrors = {};
  if (f.organisation.length < 2 || f.organisation.length > 120) e.organisation = "Skriv foreningens eller stedets navn.";
  if (f.contactName.length < 2 || f.contactName.length > 80) e.contactName = "Skriv dit navn.";
  if (!/^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(f.email) || f.email.length > 160) e.email = "Skriv en gyldig e-mail.";
  if (f.website && (!/^https?:\/\/\S+$/i.test(f.website) || f.website.length > 200)) e.website = "Skriv hele adressen, fx https://eksempel.dk";
  if (f.message.length > 2000) e.message = "Højst 2000 tegn.";
  return e;
}

export async function saveInquiry(db: D1Database, f: InquiryForm, now: number): Promise<void> {
  await db.prepare("INSERT INTO partner_inquiries (id, organisation, contact_name, email, website, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), f.organisation, f.contactName, f.email, f.website || null, f.message || null, now).run();
}

export async function listInquiries(db: D1Database): Promise<unknown[]> {
  const { results } = await db.prepare("SELECT * FROM partner_inquiries ORDER BY created_at DESC LIMIT 500").all();
  return results;
}

export function partnerPage(ctx: PageContext, state: { form?: InquiryForm; errors?: InquiryErrors; sent?: boolean; status?: number } = {}): View {
  const f = state.form ?? { organisation: "", contactName: "", email: "", website: "", message: "" };
  const errors = state.errors ?? {};
  const err = (k: keyof InquiryForm) => errors[k] ? html`<span class="field-error" id="err-${k}">${errors[k]}</span>` : "";
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "For arrangører", path: "/samarbejde" }];
  const body = html`
<div class="wrap narrow prose">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <p class="kicker">For foreninger og kultursteder</p>
    <h1>Få flere med – sammen med Flokken</h1>
    <p class="standfirst">Flokken hjælper folk i Aarhus med at finde events og nogen at følges med. Det er lettere at tage af sted, når man har nogen at følges med – og en flok kan blive til flere besøg hos jer.</p>
  </header>
  <h2>Sådan er modellen tænkt</h2>
  <ol class="steps">
    <li><strong>I tilbyder Flokkens medlemmer en billetfordel</strong> – fx en rabat eller et par reserverede pladser til et event.</li>
    <li><strong>I får synlighed på Flokken</strong> – jeres events og fordelen vises på eventsiderne, hvor flokkene bliver dannet.</li>
    <li><strong>Mulighed for radioomtale og anden promovering</strong> – vi er ved at bygge samarbejder op og aftaler det konkret med hver enkelt.</li>
  </ol>
  <p>Fordelen og formen aftaler vi sammen. Vi viser kun tilbud, som I har bekræftet.</p>
  <h2>Har I et event med ledige pladser?</h2>
  <p>Hos os får en flok en gave, når ${GIFT_FLOCK_SIZE} er samlet. Har I et event, hvor der er plads til flere, kan I gøre gaven til halv pris på billetten. Byttehandlen er enkel:</p>
  <ol class="steps">
    <li><strong>Vi sætter eventet på Flokken</strong> og fortæller, at gaven ved netop det event er halv pris, sponsoreret af jer.</li>
    <li><strong>Vi samler flokken.</strong> Først når ${GIFT_FLOCK_SIZE} er samlet, gælder tilbuddet.</li>
    <li><strong>I giver os en rabatkode</strong> på halv pris. De ${GIFT_FLOCK_SIZE} i flokken får koden og køber billet hos jer som altid.</li>
  </ol>
  <p>I fylder pladser, der ellers ville stå tomme, og får nye gæster, der kommer sammen. Det er et tilbud for enkelte events – ikke noget, I binder jer til.</p>
  <h2>Valgfrie oplevelser for flokke</h2>
  <p>Ud over billetfordelen kan I vælge at gøre det lettere at komme som flok:</p>
  <ul>
    <li>Reserverede pladser til flokke</li>
    <li>Et fast mødested før eventet</li>
    <li>Kaffe eller en velkomstdrink</li>
    <li>Et frivilligt Eftermøde – et sted at blive hængende bagefter</li>
  </ul>
  <h2>Jeres events er måske allerede her</h2>
  <p>Flokken henter hver nat events fra arrangørernes egne kalendere. Har I en offentlig kalender (fx et iCal-link), et RSS-feed eller strukturerede eventdata på jeres hjemmeside, kan vi tage den med.</p>
  <h2 id="kontakt">Skriv til os</h2>
  ${state.sent ? html`<p class="flash" role="status">Tak for jeres henvendelse. Vi vender tilbage.</p>` : html`
  ${Object.keys(errors).length ? html`<p class="flash flash-error" role="alert">Ret de markerede felter.</p>` : ""}
  <form class="form-card" method="post" action="/samarbejde" novalidate>
    <div class="field"><label for="p-org">Forening eller sted</label><input id="p-org" name="organisation" type="text" maxlength="120" required value="${f.organisation}">${err("organisation")}</div>
    <div class="field"><label for="p-name">Dit navn</label><input id="p-name" name="navn" type="text" maxlength="80" autocomplete="name" required value="${f.contactName}">${err("contactName")}</div>
    <div class="field"><label for="p-email">E-mail</label><input id="p-email" name="email" type="email" maxlength="160" autocomplete="email" required value="${f.email}">${err("email")}</div>
    <div class="field"><label for="p-web">Hjemmeside <span class="meta-muted">(valgfrit)</span></label><input id="p-web" name="hjemmeside" type="url" maxlength="200" value="${f.website}">${err("website")}</div>
    <div class="field"><label for="p-msg">Besked <span class="meta-muted">(valgfrit)</span></label><textarea id="p-msg" name="besked" rows="4" maxlength="2000">${f.message}</textarea>${err("message")}</div>
    <div class="hp" aria-hidden="true"><label>Lad dette felt stå tomt <input name="website_url" type="text" tabindex="-1" autocomplete="off"></label></div>
    <div class="form-actions"><button type="submit">Send</button></div>
    <p class="small meta-muted">Vi gemmer kun det, I skriver her, for at kunne svare jer.</p>
  </form>`}
</div>`;
  return { status: state.status ?? 200, ...(state.sent || state.errors ? { headers: { "cache-control": "no-store" } } : {}), body: page(ctx, { title: "For foreninger og kultursteder – Flokken", description: "Tilbyd Flokkens medlemmer en billetfordel og få synlighed på Flokken – og mulighed for radioomtale.", canonical: "/samarbejde", breadcrumbs: crumbs }, body) };
}
