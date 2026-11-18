import type { D1Database } from "../db.js";
import type { EventRow } from "../web/queries.js";
import { html, type SafeHtml } from "../web/html.js";
import { crumbsNav, organiserEmail, page, type Crumb, type PageContext } from "../web/layout.js";
import type { View } from "./pages.js";
import { contactFormBlock, emptyContact } from "./contact.js";

/** Partners: local associations and venues that have their events on the site, and may offer flocks
 * something extra. There are no ticket discounts. Only offers the organiser has actually confirmed are shown; the list
 * is empty until then. */

export type OfferKind = "reserved_seats" | "meeting_point" | "welcome_drink" | "other";

export type PartnerOffer = {
  /** The organiser it applies to (src/organizers.ts slug = the events' organizer_id). */
  organizerSlug: string;
  /** Only these events (their slugs); empty or left out = all the organiser's events. */
  eventSlugs?: string[];
  kind: OfferKind;
  /** As the organiser worded it, e.g. "Kaffe til flokke, der kommer før kl. 19". */
  text: string;
  /** Who at the organiser confirmed it, and when (ISO date). An offer without both is never shown. */
  confirmedBy: string;
  confirmedOn: string;
  /** Last day it applies (ISO date), if it ends. */
  validUntil?: string;
};

export const KIND_LABELS: Record<OfferKind, string> = {
  reserved_seats: "Reserverede pladser",
  meeting_point: "Mødested før arrangementet",
  welcome_drink: "Kaffe eller velkomstdrink",
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

// ————————————————————————————————————————— /samarbejde (messages now come through the contact form; older ones are kept)

export async function listInquiries(db: D1Database): Promise<unknown[]> {
  const { results } = await db.prepare("SELECT * FROM partner_inquiries ORDER BY created_at DESC LIMIT 500").all();
  return results;
}

export function partnerPage(ctx: PageContext, state: { now: number }): View {
  const crumbs: Crumb[] = [{ name: "Forside", path: "/" }, { name: "For arrangører", path: "/samarbejde" }];
  const body = html`
<div class="wrap narrow prose">
  <header class="page-head">
    ${crumbsNav(crumbs)}
    <p class="kicker">For foreninger og kultursteder</p>
    <h1>Få flere med til jeres arrangementer i Aarhus</h1>
    <p class="standfirst">Flokken hjælper folk i Aarhus med at finde arrangementer og nogen at følges med. Det er lettere at tage af sted, når man ikke skal gå alene – og en flok kan blive til flere besøg hos jer.</p>
  </header>
  <h2>Sådan er modellen tænkt</h2>
  <ol class="steps">
    <li><strong>Vil I være med på siden, så <a href="#kontakt">skriv til os</a></strong> via formularen herunder eller på <a href="mailto:${organiserEmail(ctx)}">${organiserEmail(ctx)}</a> – så viser vi jeres arrangementer i kalenderen, på kortet og på arrangementssiderne, hvor flokkene bliver dannet.</li>
    <li><strong>Mulighed for radioomtale og anden promovering</strong> – vi er ved at bygge samarbejder op og aftaler det konkret med hver enkelt.</li>
  </ol>
  <h2>Valgfrie oplevelser for flokke</h2>
  <p>I kan også vælge at gøre det lettere at komme som flok. Vi viser kun det, som I har bekræftet:</p>
  <ul>
    <li>Reserverede pladser til flokke</li>
    <li>Et fast mødested før arrangementet</li>
    <li>Kaffe eller en velkomstdrink</li>
  </ul>
  <h2>Sådan kommer jeres arrangementer med</h2>
  <p>Flokken henter hver nat arrangementer fra arrangørernes egne kalendere. Har I en offentlig kalender (fx et iCal-link), et RSS-feed eller strukturerede data om jeres arrangementer på hjemmesiden, kan vi tage den med – så I ikke skal skrive noget to steder.</p>
  <h2 id="kontakt">Skriv til os</h2>
  ${contactFormBlock(ctx, { form: emptyContact("arrangoer"), now: state.now })}
</div>`;
  return { status: 200, body: page(ctx, { title: "For foreninger og kultursteder – Flokken", description: "Vil I have jeres arrangementer med på Flokken? Skriv til os – og hør om mulighed for radioomtale.", canonical: "/samarbejde", breadcrumbs: crumbs }, body) };
}
