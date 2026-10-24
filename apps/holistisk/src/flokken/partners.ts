import type { D1Database } from "../db.js";
import type { EventRow } from "../web/queries.js";
import { html, type SafeHtml } from "../web/html.js";
import { crumbsNav, page, type Crumb, type PageContext } from "../web/layout.js";
import type { View } from "./pages.js";

/** Partners: local associations and venues that offer Flokken's members a ticket benefit and get visibility on the
 * platform in return. Only offers the organiser has actually confirmed are shown; the list is empty until then. */

export type OfferKind = "member_discount" | "reserved_seats" | "meeting_point" | "welcome_drink" | "eftermoede" | "other";

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

export function offersBlock(offers: PartnerOffer[]): SafeHtml {
  if (!offers.length) return html``;
  return html`<section class="offer-box" aria-labelledby="h-offers">
  <h2 id="h-offers">For Flokkens medlemmer</h2>
  <ul>${offers.map(o => html`<li><strong>${KIND_LABELS[o.kind]}:</strong> ${o.text}</li>`)}</ul>
  <p class="small meta-muted">Tilbuddet er bekræftet af arrangøren.</p>
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
