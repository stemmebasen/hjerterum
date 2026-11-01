import { EventCard } from "./event-card";
import { EventPage, eventPagePath } from "./event-page";
import { ComingUp, comingUp, MonthSection } from "./month-hero";
import { isKind, kindOf } from "./event-kinds";
import { CategoryNav, LanguageSwitch, SiteFooter, SiteHome, SiteNav, SitePageView } from "./site-pages";
import { isPartnerEvent, PARTNER_HEADING } from "../partner-events";
import { redirectFor, sitePage } from "../site/redirects";
import { SIGNUP_URL, type Section } from "../site/pages";
import { membershipPlans } from "../membership";
import { ProfilePage, PublicProfiles } from "./public-profiles";
import { MembershipPlans } from "./membership-plans";
import { StrictMode, useEffect, useRef, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { loadClerk, type ClerkBrowser, type ClerkUser } from "./clerk";
import { AdminWorkspace, MemberWorkspace } from "./workspaces";
import { CodeSignIn, CodeSignInPlaceholder } from "./code-sign-in";
import { PosterPage } from "./poster-page";
import { resetLogin } from "./code-login";
import { calculateRoomPriceQuote, roomBookingProblems, type RoomBookingType } from "../../../packages/core/src/legacy-room-pricing.js";
import "./styles.css";
import "./lys-spa.css";
import { injectLys, LysTop } from "./lys";
import { countVisit } from "./visits";
import { captureSagaConversation, SagaWidget, sagaLoginHref } from "./saga-widget";

injectLys();
// Requested: "Kan hun huske samtalen før og efter login" - the conversation's id from the website's login link (saga-widget.tsx).
captureSagaConversation();

type PublicBooking = {
  id: number;
  teacherName: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  imageUrl?: string | null;
};

type ExternalEvent = {
  id: string;
  source: "membershipworks";
  title: string;
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  imageUrl: string | null;
  link: string | null;
  host: string | null;
  description: string | null;
  category: string | null;
};

type CalendarEvent = {
  key: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  host: string | null;
  location: string | null;
  imageUrl: string | null;
  link: string | null;
  /** The event's own page on hjerterum.info (event-page.tsx), for events from the membership system's calendar. */
  page?: string | null;
  source: "hjerterum" | "membershipworks";
  category?: string | null;
};

/** Reported: "Der er så mange problemer med login" ("You are signed out"). The login (Clerk) belongs to medlem.<domain>, so it is
 * loaded only where it is used - signing in and up, the member area and admin - and never on the public website's pages. */
const CLERK_PATHS = /^\/(?:sign-in|login|sign-up|signup|admin|member-portal)(?:\/|$)/;

function useClerk(wanted: boolean) {
  const [clerk, setClerk] = useState<ClerkBrowser | null>(null);
  const [user, setUser] = useState<ClerkUser | null>(null);
  const [loaded, setLoaded] = useState(!wanted);

  useEffect(() => {
    if (!wanted) return;
    let active = true;
    let unsubscribe: (() => void) | undefined;

    void loadClerk()
      .then((instance) => {
        if (!active) return;
        setClerk(instance);
        setUser(instance?.user ?? null);
        setLoaded(true);
        if (instance) {
          unsubscribe = instance.addListener((state) => {
            if (active) setUser(state.user ?? null);
          });
        }
      })
      .catch(() => {
        if (active) setLoaded(true);
      });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [wanted]);

  return { clerk, user, loaded };
}

/** Requested: "Menuen skal pakkes ind i en hamburger" - on a phone the menu opens from a button beside Log ind. */
function SiteHeader({ current }: { current?: Section | undefined }) {
  const [open, setOpen] = useState(false);
  return <LysTop right={<><LanguageSwitch english={current === "en"} /><a className="lys-pill" href={sagaLoginHref("/sign-in")}>Log ind</a>
    <button type="button" className={"site-burger" + (open ? " is-open" : "")} aria-expanded={open} aria-controls="site-menu" aria-label={open ? "Luk menuen" : "Åbn menuen"}
      onClick={() => setOpen(!open)}><span /><span /><span /></button></>}><SiteNav current={current} open={open} /></LysTop>;
}

/** Clerk's own forms (password, sign-up) inside Hjerterum's login card: no card, frame or heading of their own, so the box keeps
 * its place, width and look when the member switches between the code and the password. Reported: "Login boksen og login
 * vinduet flytter sig også og skifter størrelse" - "Og skifter design". */
const CLERK_IN_CARD = { elements: {
  rootBox: { width: "100%" },
  cardBox: { width: "100%", maxWidth: "100%", boxShadow: "none", border: "none", borderRadius: "0", background: "transparent" },
  card: { width: "100%", padding: "0", boxShadow: "none", border: "none", background: "transparent", gap: "18px" },
  header: { display: "none" },
  footer: { background: "transparent", padding: "8px 0 0", margin: "0" },
  footerAction: { padding: "0" },
  // The code login's own field and button (lys-spa.css .code-signin-field, .code-signin-btn).
  formFieldLabel: { font: "600 13px/1.2 var(--lys-sans)", letterSpacing: ".04em", color: "var(--lys-muted)" },
  formFieldInput: { minHeight: "54px", padding: "0 16px", fontSize: "17px", borderRadius: "12px" },
  formButtonPrimary: { minHeight: "52px", borderRadius: "999px", fontSize: "16px", fontWeight: "600" }
} };

function AuthPage({
  clerk,
  loaded = true,
  mode,
  redirectUrl
}: {
  clerk: ClerkBrowser | null;
  loaded?: boolean;
  mode: "sign-in" | "sign-up";
  redirectUrl?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Requested: "Maybe just with a code" - signing in starts with a code by e-mail; the usual login with a password is one click away.
  const [password, setPassword] = useState(false);
  const clerkForm = mode === "sign-up" || password;
  useEffect(() => {
    if (!clerk || !ref.current || !clerkForm) return;
    const node = ref.current;
    if (mode === "sign-in") clerk.mountSignIn(node, { appearance: CLERK_IN_CARD, ...(redirectUrl ? { forceRedirectUrl: redirectUrl } : {}) });
    else {
      // From "Opret dig med <e-mail>" on the code login: the e-mail is filled in already.
      const emailAddress = new URLSearchParams(window.location.search).get("email")?.trim() ?? "";
      clerk.mountSignUp(node, { appearance: CLERK_IN_CARD, ...(redirectUrl ? { forceRedirectUrl: redirectUrl } : {}), ...(emailAddress ? { initialValues: { emailAddress } } : {}) });
    }
    return () => {
      if (mode === "sign-in") clerk.unmountSignIn(node);
      else clerk.unmountSignUp(node);
    };
  }, [clerk, mode, redirectUrl, clerkForm]);

  const restart = async () => { await resetLogin(clerk); window.location.assign("/sign-in"); };

  return (
    <main className="auth-shell">
      {/* Reported: "er der nogen grund til, at man ikke ser den almindelige menu" - the website's own top, with its menu. */}
      <SiteHeader />
      <div className="auth-card">
        {!loaded ? <CodeSignInPlaceholder />
        : !clerk ? <CodeSignInPlaceholder message="Login kan ikke åbnes lige nu. Prøv igen om lidt." />
        : clerkForm ? <div className="code-signin code-signin-clerk">
          <p className="lys-kicker">Medlemsområde</p>
          <h1>{mode === "sign-up" ? "Opret dig" : "Log ind"}</h1>
          <p className="code-signin-lead">{mode === "sign-up" ? "Det tager et øjeblik. Bagefter logger du ind med en kode på mail." : "Med din e-mail og adgangskode."}</p>
          <div ref={ref} className="code-signin-clerk-form" />
          <p className="code-signin-foot">
            {mode === "sign-up" ? <a className="code-signin-link" href="/sign-in">Har du en bruger? Log ind</a>
              : <button type="button" className="code-signin-link" onClick={() => setPassword(false)}>← Log ind med en kode i stedet</button>}
            <button type="button" className="code-signin-link" onClick={() => void restart()}>Problemer? Nulstil login</button>
          </p>
        </div> : <CodeSignIn clerk={clerk} signedIn={Boolean(clerk.user)} redirectUrl={redirectUrl} onPassword={() => setPassword(true)} />}
      </div>
    </main>
  );
}

function EventSection({ events, reachable, full = false, limit = 6 }: { events: CalendarEvent[]; reachable: boolean; full?: boolean; limit?: number }) {
  // The front page's icons open the full calendar with one kind (event-kinds.ts): /events?vis=koncerter.
  const kind = full && typeof window !== "undefined" ? kindOf(new URLSearchParams(window.location.search).get("vis")) : null;
  const shown = kind ? events.filter(event => isKind(event, kind.key)) : events;
  const house = shown.filter(event => !isPartnerEvent(event)), partners = shown.filter(event => isPartnerEvent(event));
  const visible = full ? house : house.slice(0, limit);
  // Requested: "Hjerteland events skal ikke være på forsiden" - partners' events only in the full calendar.
  const partnersShown = full ? partners : [];
  const card = (event: CalendarEvent) => <EventCard key={event.key}
    title={event.title} description={event.description} startsAt={event.startsAt} endsAt={event.endsAt}
    host={event.host} location={event.location} imageUrl={event.imageUrl} category={event.category}
    expandDescription={event.source === "hjerterum"}>
    {event.page ? <a className="text-link" href={event.page}>Læs mere og tilmeld →</a>
      : event.link ? <a className="text-link" href={event.link} target="_blank" rel="noreferrer">Læs mere og tilmeld ↗</a>
      : <a className="text-link" href="/member-portal/kalender">Log ind og tilmeld →</a>}
  </EventCard>;
  // Requested: "Her skal vi det ikke inddeles efter måneder - men bare 3 på stribe hele vejen ned" - the date is on every card.
  return <section className={"events-section" + (full ? " public-calendar" : "")} id="kalender">
    {full && <CategoryNav current={kind?.key ?? null} />}
    {reachable && visible.length ? <div className="member-event-grid calendar-all">{visible.map(card)}</div> : <div className="calendar-empty"><p>{!reachable ? "Kalenderen indlæses." : kind ? `Der er ingen kommende ${kind.label.toLocaleLowerCase("da-DK")} i kalenderen lige nu.` : "Der er ingen kommende events i kalenderen endnu."}</p></div>}
    {reachable && partnersShown.length > 0 && <section className="calendar-month partner-events" aria-label={PARTNER_HEADING}>
      <h2>{PARTNER_HEADING}</h2><div className="member-event-grid">{partnersShown.map(card)}</div></section>}
  </section>;
}

/** Requested: "Det bør være muligt at booke lokalet uden at være medlem så i dette bookingvindue skal man også se prisen for de to andre medlem
 * løsninger med de skal være inaktive og det skal gøres tydeligt at man ved at være medlem får disse fordele." - the calculator on
 * /brug-hjerterum/lejepriser. Everyone books at the standard price; what the same booking costs a member is shown beside it, locked,
 * with the saving in kroner, the benefits and the way to become a member or log in. */
const MEMBER_PERKS = ["Reduceret eller gratis leje", "Opret selv events – Saga hjælper", "Dit event på hjemmesiden og SoMe", "Profil som underviser", "Rabat på husets events"];
const MEMBER_EVENTS_URL = "https://medlem.hjerterum.info/member-portal/events";
// Reported: "Den er meget ukøn, stor og klodset. Den må kunne laves pænere og mere moderne" - one compact card in the site's own colours (light and dark).
const START_TIMES = Array.from({ length: 36 }, (_, i) => `${String(6 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);

/** Asked: "Hvorfor videresendes man til https://www.hjerterum.info/beregner?" - the booking request opens right here, under the price, with the
 * date and time already chosen; it goes to the same place as the calculator's form (worker/beregner/handler.ts → team@'s inbox). */
const BOOKING_ERRORS: Record<string, string> = { missing_fields: "Udfyld de felter, der er markeret med *.", too_many: "Der er sendt mange forespørgsler herfra. Prøv igen om en time.",
  image_too_large: "Billedet er for stort (højst 8 MB).", image_type: "Billedet skal være JPG, PNG, WebP eller GIF.", not_delivered: "Forespørgslen kunne ikke sendes lige nu. Prøv igen om lidt, eller skriv til team@hjerterum.info." };

function RoomBookingForm({ date, start, end, hours, dayOfWeek, priceKr, onClose }: { date: string; start: string; end: string; hours: number; dayOfWeek: number; priceKr: number; onClose: () => void }) {
  const [opened] = useState(() => Date.now());
  const [state, setState] = useState<{ busy?: boolean; error?: string; sent?: boolean }>({});
  const [dates, setDates] = useState<string[]>([date]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    form.delete("dates");
    dates.filter(Boolean).forEach((d) => form.append("dates", d));
    for (const [k, v] of Object.entries({ day: String(dayOfWeek), start, hours: String(hours), type: "standard", started: String(opened) })) form.set(k, v);
    setState({ busy: true });
    const response = await fetch("/beregner/foresporgsel", { method: "POST", body: form }).catch(() => null);
    const body = response ? await response.json().catch(() => ({})) as { ok?: boolean; error?: string } : {};
    setState(response?.ok && body.ok ? { sent: true } : { error: BOOKING_ERRORS[body.error ?? ""] ?? "Noget gik galt. Prøv igen." });
  }
  if (state.sent) return <div className="rc-form rc-sent" role="status"><b>Tak – din bookingforespørgsel er sendt.</b><p>Vi vender tilbage på mail. Salen er først booket, når vi har bekræftet.</p><button type="button" className="rc-login" onClick={onClose}>Luk</button></div>;
  return (
    <form className="rc-form" onSubmit={(event) => void submit(event)}>
      <div className="rc-form-head"><b>Bookingforespørgsel · standardpris {priceKr.toLocaleString("da-DK")} kr.</b><button type="button" className="rc-x" onClick={onClose} aria-label="Luk">×</button></div>
      <p className="rc-sub">{new Date(`${date}T12:00:00`).toLocaleDateString("da-DK", { weekday: "long", day: "numeric", month: "long" })} kl. {start.replace(":", ".")}–{end.replace(":", ".")} · husk tid til klargøring og oprydning.</p>
      <label>Eventnavn *<input name="eventName" required maxLength={160} /></label>
      <div className="rc-dates"><span>Dato *</span>{dates.map((d, i) => <input key={i} type="date" value={d} required={i === 0} onChange={(e) => setDates(dates.map((x, j) => j === i ? e.target.value : x))} />)}
        <button type="button" className="rc-more" onClick={() => setDates([...dates, ""])}>+ Flere datoer</button></div>
      <label>Beskrivelse *<textarea name="description" required maxLength={5000} rows={5} /></label>
      <div className="rc-two"><label>Navn *<input name="name" required maxLength={120} autoComplete="name" /></label><label>E-mail *<input name="email" type="email" required maxLength={200} autoComplete="email" /></label></div>
      <div className="rc-two"><label>Telefon<input name="phone" maxLength={40} autoComplete="tel" /></label><label>Max. deltagere<input name="maxParticipants" inputMode="numeric" maxLength={6} /></label></div>
      <div className="rc-two"><label>Tilmelding<select name="signup"><option>Online via Hjerterum</option><option>Direkte til dig/underviser</option></select></label>
        <label>Betaling<select name="payment"><option value="">Vælg</option><option>Online via Hjerterum</option><option>MobilePay</option><option>Bankoverførsel</option><option>Kontant</option><option>Andet</option></select></label></div>
      <label>Hjemmeside / sociale medier<input name="links" maxLength={1500} placeholder="https://" /></label>
      <label>Billede til dit event<input name="image" type="file" accept="image/jpeg,image/png,image/webp,image/gif" /><span className="rc-sub">Uden ophavsret, helst ikke AI – gerne 1920 × 1005 px.</span></label>
      <label>Bemærkninger<textarea name="notes" maxLength={3000} rows={2} /></label>
      <input className="rc-trap" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" />
      {state.error && <p className="rc-error" role="alert">{state.error}</p>}
      <div className="rc-form-actions"><button type="button" className="rc-login" onClick={onClose}>Annullér</button><button className="rc-book" disabled={state.busy}>{state.busy ? "Sender …" : "Send forespørgsel"}</button></div>
    </form>
  );
}

function RoomPriceCalculator() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [start, setStart] = useState("10:00");
  const [hours, setHours] = useState(2);
  const [booking, setBooking] = useState(false);
  const dateValue = new Date(`${date}T12:00:00`);
  const [startHour = 10, startMinute = 0] = start.split(":").map(Number);
  const when = { dayOfWeek: dateValue.getDay(), startMinutes: startHour * 60 + startMinute, durationMinutes: hours * 60 };
  const quote = (bookingType: RoomBookingType) => calculateRoomPriceQuote({ bookingType, ...when, ...(bookingType === "reduced" ? { memberPriceKr: 0 } : {}) });
  const standard = quote("standard"), reduced = quote("reduced"), free = quote("free");
  // A member's booking on a weekday lies wholly before or after 18.30.
  const crosses = roomBookingProblems({ bookingType: "reduced", ...when }).includes("crosses_a_time_boundary");
  const saving = crosses ? null : standard.totalPriceKr - reduced.totalPriceKr;
  const monthKr = membershipPlans.standard.month / 100;
  const kr = (n: number) => `${n.toLocaleString("da-DK")} kr.`;
  const band = standard.band === "A" ? "A-tid · weekend eller fra kl. 18.30" : "B-tid · hverdage før kl. 18.30";
  const lock = <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>;

  return (
    <section className="rent-calc" aria-label="Prisberegner for leje af sal">
      <div className="rc-when">
        <label>Dato<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label>Start<select value={start} onChange={(event) => setStart(event.target.value)}>{START_TIMES.map((t) => <option key={t} value={t}>{t.replace(":", ".")}</option>)}</select></label>
        <div className="rc-hours"><span id="rc-hours-label">Varighed</span>
          <div role="group" aria-labelledby="rc-hours-label"><button type="button" onClick={() => setHours(Math.max(2, hours - 0.5))} disabled={hours <= 2} aria-label="Kortere">−</button>
            <b aria-live="polite">{String(hours).replace(".", ",")} t</b><button type="button" onClick={() => setHours(Math.min(10, hours + 0.5))} disabled={hours >= 10} aria-label="Længere">+</button></div></div>
      </div>
      <p className="rc-band">{band}</p>
      <div className="rc-prices">
        <article className="rc-tile open">
          <span className="rc-label">Standardpris</span>
          <strong>{kr(standard.totalPriceKr)}</strong>
          <span className="rc-sub">For alle · også uden medlemskab</span>
          <button type="button" className="rc-book" onClick={() => setBooking(true)} aria-expanded={booking}>Book →</button>
        </article>
        <article className="rc-tile locked" aria-disabled="true">
          <span className="rc-label">{lock} Reduceret pris</span>
          <strong>{crosses ? "–" : kr(reduced.totalPriceKr)}</strong>
          <span className="rc-sub">{crosses ? "Medlemmer booker før eller efter kl. 18.30" : "Kun for medlemmer"}</span>
        </article>
        <article className="rc-tile locked" aria-disabled="true">
          <span className="rc-label">{lock} Gratis leje</span>
          <strong>{kr(free.totalPriceKr)}</strong>
          <span className="rc-sub">Kun for medlemmer · én gang om ugen</span>
        </article>
      </div>
      {booking && <RoomBookingForm date={date} start={start} hours={hours} dayOfWeek={dateValue.getDay()} priceKr={standard.totalPriceKr}
        end={`${String(Math.floor((startHour * 60 + startMinute + hours * 60) / 60) % 24).padStart(2, "0")}:${String((startMinute + hours * 60) % 60).padStart(2, "0")}`} onClose={() => setBooking(false)} />}
      <div className="rc-member">
        <div className="rc-member-text">
          <b>{saving && saving > 0 ? <>Spar {kr(saving)} som medlem</> : "Lej gratis som medlem"}</b>
          <span>{saving !== null && saving >= monthKr ? `Medlemskab ${kr(monthKr)}/md. – tjent hjem på én booking.` : `Medlemskab fra ${kr(monthKr)}/md.`}</span>
          <ul>{MEMBER_PERKS.map((perk) => <li key={perk}>{perk}</li>)}</ul>
        </div>
        <div className="rc-member-actions">
          <a className="rc-join" href={SIGNUP_URL}>Bliv medlem</a>
          <a className="rc-login" href={MEMBER_EVENTS_URL}>Medlem? Log ind og book</a>
        </div>
      </div>
      <p className="rc-note">Alle priser er inkl. moms. Prisen er en beregning, ikke en bookingbekræftelse.</p>
    </section>
  );
}

function usePublicEvents() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [eventsReachable, setEventsReachable] = useState(false);

  useEffect(() => {
    let active = true;

    void Promise.allSettled([
      fetch("/api/room-bookings/public").then(async (response) => {
        if (!response.ok) throw new Error("room_events_unavailable");
        return (await response.json()) as PublicBooking[];
      }),
      fetch("/api/events/external").then(async (response) => {
        if (!response.ok) throw new Error("external_events_unavailable");
        return (await response.json()) as ExternalEvent[];
      })
    ]).then(([roomResult, externalResult]) => {
      if (!active) return;

      const roomEvents: CalendarEvent[] = roomResult.status === "fulfilled"
        ? roomResult.value.map((event) => ({
            key: `room-${event.id}`,
            title: event.title,
            description: event.description,
            startsAt: event.startsAt,
            endsAt: event.endsAt,
            host: event.teacherName,
            location: "Hjerterum",
            imageUrl: event.imageUrl ?? null,
            link: null,
            source: "hjerterum" as const
          }))
        : [];

      const externalEvents: CalendarEvent[] = externalResult.status === "fulfilled"
        ? externalResult.value.map((event) => ({
            key: `mw-${event.id}`,
            title: event.title,
            description: event.description,
            startsAt: event.startsAt,
            endsAt: event.endsAt,
            host: event.host,
            location: event.location,
            imageUrl: event.imageUrl,
            category: event.category,
            link: event.link,
            page: eventPagePath(event.id),
            source: "membershipworks" as const
          }))
        : [];

      setEvents([...roomEvents, ...externalEvents].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)));
      setEventsReachable(roomResult.status === "fulfilled" || externalResult.status === "fulfilled");
    });

    return () => { active = false; };
  }, []);

  return { events, eventsReachable };
}


/** The front page (src/site-pages.tsx): hjerterum.info's structure in Hjerterum Lys, with the living geometry and
 * "Lige om lidt" - the next three events - floating over it. */
function PublicHome() {
  const { events, eventsReachable } = usePublicEvents();
  useEffect(countVisit, []);
  const now = Date.now();
  const house = events.filter((event) => !isPartnerEvent(event));
  return <SiteHome
    header={<SiteHeader />}
    month={<MonthSection events={house} now={now} reachable={eventsReachable} />}
    coming={<ComingUp event={comingUp(house, now)} />}
    plans={<MembershipPlans />}
  />;
}

/** Every content page lives in site/pages.ts; the old holistisk.org addresses are moved there by the worker (301)
 * and, when the app itself is served without it, here. */
function PublicContentPage({ path }: { path: string }) {
  // Requested: "man skal så kunne klikke ind på en behandler" - /behandlere/<navn>.
  const profileMatch = /^\/behandlere\/([a-z0-9-]+)\/?$/.exec(path);
  const eventMatch = /^\/events\/([0-9a-f]{24})\/?$/.exec(path);
  if (eventMatch) return <EventPage id={eventMatch[1]!} header={<SiteHeader current="events" />} footer={<SiteFooter />} />;
  const posterMatch = /^\/plakat\/([0-9a-f]{24}|h\d+)\/?$/.exec(path);
  if (posterMatch) return <PosterPage id={posterMatch[1]!} header={<SiteHeader current="events" />} footer={<SiteFooter />} />;
  if (profileMatch) return <ProfilePage slug={profileMatch[1]!} header={<SiteHeader current="om-os" />} footer={<SiteFooter />} />;
  return <SiteContentPage path={path} />;
}

function SiteContentPage({ path }: { path: string }) {
  const page = sitePage(path);
  const target = page ? undefined : redirectFor(path);
  const { events, eventsReachable } = usePublicEvents();
  useEffect(() => { if (target) window.location.replace(target); }, [target]);
  useEffect(() => { if (page) countVisit(); }, [page]);
  if (target) return <main className="page-shell"><SiteHeader /></main>;
  if (!page) return <NotFound />;
  return <SitePageView page={page} header={<SiteHeader current={page.section} />} widgets={{
    events: <EventSection events={events} reachable={eventsReachable} full />,
    "membership-plans": <MembershipPlans lang={page.lang} />,
    "price-calculator": <RoomPriceCalculator />,
    profiles: <PublicProfiles bare />
  }} />;
}

function NotFound() {
  useEffect(() => { document.title = "Siden findes ikke · Hjerterum"; }, []);
  return <main className="page-shell site-page">
    <SiteHeader />
    <section className="lys-intro site-intro">
      <div><p className="lys-kicker">Hjerterum</p><h1 className="lys-title">Siden findes<em>ikke længere</em></h1></div>
      <div className="site-intro-side"><p>Måske er den flyttet, da vi samlede hjemmesiden. Prøv forsiden, kalenderen eller menuen øverst.</p>
        <p className="lys-hero-actions"><a className="lys-btn" href="/">Til forsiden</a><a className="lys-btn ghost" href="/events">Se kalenderen</a></p></div>
    </section>
  </main>;
}

function App() {
  const path = window.location.pathname;
  const { clerk, user, loaded } = useClerk(CLERK_PATHS.test(path));

  if (path === "/sign-in" || path.startsWith("/sign-in/") || path === "/login" || path.startsWith("/login/")) {
    return <AuthPage clerk={clerk} loaded={loaded} mode="sign-in" />;
  }
  if (path === "/sign-up" || path.startsWith("/sign-up/") || path === "/signup" || path.startsWith("/signup/")) {
    return <AuthPage clerk={clerk} loaded={loaded} mode="sign-up" />;
  }

  if (path === "/admin" || path.startsWith("/admin/")) {
    if (!loaded) return <main className="auth-shell"><p>Åbner administrationen …</p></main>;
    if (!clerk) return <AuthPage clerk={null} loaded mode="sign-in" redirectUrl="/admin/" />;
    if (!user) return <AuthPage clerk={clerk} loaded mode="sign-in" redirectUrl="/admin/" />;
    return <AdminWorkspace clerk={clerk} user={user} path={path} />;
  }

  if (path === "/member-portal" || path.startsWith("/member-portal/")) {
    if (!loaded) return <main className="auth-shell"><p>Åbner Hjerterum …</p></main>;
    if (!clerk) return <AuthPage clerk={null} loaded mode="sign-in" />;
    if (!user) return <AuthPage clerk={clerk} loaded mode="sign-in" redirectUrl={path} />;
    return <MemberWorkspace clerk={clerk} user={user} path={path} />;
  }

  // Requested: "Sørg for at implementer Saga chat widget på alle tre sider" - on the website without login (saga-widget.tsx, worker/web-saga.ts).
  if (path !== "/") return <><PublicContentPage path={path} /><SagaWidget mode="public" path={path} /></>;
  return <><PublicHome /><SagaWidget mode="public" path="/" /></>;
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing root element");
createRoot(root).render(<StrictMode><App /></StrictMode>);
