import { EventCard, calendarMonth } from "./event-card";
import { EventPage, eventPagePath } from "./event-page";
import { MonthSection } from "./month-hero";
import { LanguageSwitch, SiteFooter, SiteHome, SiteNav, SitePageView } from "./site-pages";
import { isPartnerEvent, PARTNER_HEADING } from "../partner-events";
import { redirectFor, sitePage } from "../site/redirects";
import type { Section } from "../site/pages";
import { ProfilePage, PublicProfiles } from "./public-profiles";
import { MembershipPlans } from "./membership-plans";
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { loadClerk, type ClerkBrowser, type ClerkUser } from "./clerk";
import { AdminWorkspace, MemberWorkspace } from "./workspaces";
import { calculateRoomPriceQuote, roomBookingProblems, type RoomBookingType } from "../../../packages/core/src/legacy-room-pricing.js";
import "./styles.css";
import "./lys-spa.css";
import { injectLys, LysTop } from "./lys";
import { countVisit } from "./visits";

injectLys();

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

function useClerk() {
  const [clerk, setClerk] = useState<ClerkBrowser | null>(null);
  const [user, setUser] = useState<ClerkUser | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
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
  }, []);

  return { clerk, user, loaded };
}

/** Requested: "Menuen skal pakkes ind i en hamburger" - on a phone the menu opens from a button beside Log ind. */
function SiteHeader({ current }: { current?: Section | undefined }) {
  const [open, setOpen] = useState(false);
  return <LysTop right={<><LanguageSwitch /><a className="lys-pill" href="/sign-in">Log ind</a>
    <button type="button" className={"site-burger" + (open ? " is-open" : "")} aria-expanded={open} aria-controls="site-menu" aria-label={open ? "Luk menuen" : "Åbn menuen"}
      onClick={() => setOpen(!open)}><span /><span /><span /></button></>}><SiteNav current={current} open={open} /></LysTop>;
}

function AuthPage({
  clerk,
  mode,
  redirectUrl
}: {
  clerk: ClerkBrowser | null;
  mode: "sign-in" | "sign-up";
  redirectUrl?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!clerk || !ref.current) return;
    const node = ref.current;
    if (mode === "sign-in") clerk.mountSignIn(node, redirectUrl ? { forceRedirectUrl: redirectUrl } : undefined);
    else clerk.mountSignUp(node, redirectUrl ? { forceRedirectUrl: redirectUrl } : undefined);
    return () => {
      if (mode === "sign-in") clerk.unmountSignIn(node);
      else clerk.unmountSignUp(node);
    };
  }, [clerk, mode, redirectUrl]);

  return (
    <main className="auth-shell">
      <LysTop />
      <div className="auth-card">
        {!clerk ? (
          <div className="auth-unavailable">
            <p className="kicker">Medlemsområde</p>
            <h1>Login er på vej</h1>
            <p>Den nye medlemsportal er ved at blive koblet til Hjerterums login.</p>
          </div>
        ) : <div ref={ref} />}
      </div>
    </main>
  );
}

function EventSection({ events, reachable, full = false, limit = 6 }: { events: CalendarEvent[]; reachable: boolean; full?: boolean; limit?: number }) {
  const house = events.filter(event => !isPartnerEvent(event)), partners = events.filter(event => isPartnerEvent(event));
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
  const months = [...new Set(visible.map(event => calendarMonth(event.startsAt)))];
  return <section className={"events-section" + (full ? " public-calendar" : "")} id="kalender">
    {reachable && visible.length ? months.map(month => <section className="calendar-month" key={month} aria-label={month}>
      <h2>{month}</h2><div className="member-event-grid">
        {visible.map(event => calendarMonth(event.startsAt) !== month ? null : card(event))}
      </div></section>) : <div className="calendar-empty"><p>{reachable ? "Der er ingen kommende events i kalenderen endnu." : "Kalenderen indlæses."}</p></div>}
    {reachable && partnersShown.length > 0 && <section className="calendar-month partner-events" aria-label={PARTNER_HEADING}>
      <h2>{PARTNER_HEADING}</h2><div className="member-event-grid">{partnersShown.map(card)}</div></section>}
  </section>;
}

function RoomPriceCalculator() {
  const [bookingType, setBookingType] = useState<RoomBookingType>("standard");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [start, setStart] = useState("10:00");
  const [hours, setHours] = useState("2");
  const [memberPrice, setMemberPrice] = useState("");
  const dateValue = new Date(`${date}T12:00:00`);
  const [startHour = 10, startMinute = 0] = start.split(":").map(Number);
  const durationHours = Math.min(10, Math.max(2, Number(hours) || 2));
  const pricing = calculateRoomPriceQuote({
    bookingType,
    dayOfWeek: dateValue.getDay(),
    startMinutes: startHour * 60 + startMinute,
    durationMinutes: durationHours * 60,
    ...(bookingType === "reduced" ? { memberPriceKr: Number(memberPrice) || 0 } : {})
  });
  const crosses = roomBookingProblems({ bookingType, dayOfWeek: dateValue.getDay(), startMinutes: startHour * 60 + startMinute, durationMinutes: durationHours * 60 })
    .includes("crosses_a_time_boundary");
  const bandLabel = pricing.band === "A"
    ? "A-pris (weekend eller fra kl. 18.30)"
    : "B-pris (hverdage før kl. 18.30)";

  return (
    <section className="price-calculator" aria-label="Prisberegner for leje af sal">
      <div className="booking-type-grid">
      <button className={bookingType === "standard" ? "selected" : ""} onClick={() => setBookingType("standard")}><strong>Standard</strong><span>Pakkepris uden medlemsrabat</span></button>
      <button className={bookingType === "reduced" ? "selected" : ""} onClick={() => setBookingType("reduced")}><strong>Reduceret pris</strong><span>Medlemsrabat og pris for ikke-medlemmer</span></button>
      <button className={bookingType === "free" ? "selected" : ""} onClick={() => setBookingType("free")}><strong>Gratis leje</strong><span>Medlemmer gratis; underviser opkræver deltagere</span></button>
      </div>
      <div className="price-form">
        <label>Dato<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label>Starttid<input type="time" value={start} onChange={(event) => setStart(event.target.value)} /></label>
        <label>Varighed i timer<input type="number" min="2" max="10" step="0.5" value={hours} onChange={(event) => setHours(event.target.value)} /></label>
        {bookingType === "reduced" && <label>Medlemspris pr. deltager<input type="number" min="0" step="1" value={memberPrice} onChange={(event) => setMemberPrice(event.target.value)} placeholder="Fx 300" /></label>}
      </div>
      <div className="price-result">
        <p className="kicker">Anslået lejepris</p>
        <strong>{pricing.totalPriceKr.toLocaleString("da-DK")} kr.</strong>
        <p>{bandLabel}. Beregningen bruger pakkepris eller påbegyndte halve timer.</p>
        {bookingType === "reduced" && pricing.memberPriceKr !== null && <p>Medlemspris: {pricing.memberPriceKr.toLocaleString("da-DK")} kr. · ikke-medlemmer: {pricing.nonMemberPriceKr?.toLocaleString("da-DK")} kr.</p>}
        {bookingType === "free" && <p>Ikke-medlemmer skal mindst betale {pricing.minimumNonMemberPriceKr} kr. pr. deltager.</p>}
        {crosses && <p role="alert">Med medlemsrabat eller gratis leje kan en booking på en hverdag ikke gå hen over kl. 18.30 - læg den helt før eller helt efter, eller book to gange.</p>}
        <small>Prisen er en beregning og udgør ikke en onlinebetaling eller endelig bookingbekræftelse.</small>
      </div>
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
  if (profileMatch) return <ProfilePage slug={profileMatch[1]!} header={<SiteHeader current="behandlere" />} footer={<SiteFooter />} />;
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
  const { clerk, user, loaded } = useClerk();
  const path = window.location.pathname;

  if (path === "/sign-in" || path.startsWith("/sign-in/") || path === "/login" || path.startsWith("/login/")) {
    return <AuthPage clerk={clerk} mode="sign-in" />;
  }
  if (path === "/sign-up" || path.startsWith("/sign-up/") || path === "/signup" || path.startsWith("/signup/")) {
    return <AuthPage clerk={clerk} mode="sign-up" />;
  }

  if (path === "/admin" || path.startsWith("/admin/")) {
    if (!loaded) return <main className="auth-shell"><p>Åbner administrationen …</p></main>;
    if (!clerk) return <AuthPage clerk={null} mode="sign-in" redirectUrl="/admin/" />;
    if (!user) return <AuthPage clerk={clerk} mode="sign-in" redirectUrl="/admin/" />;
    return <AdminWorkspace clerk={clerk} user={user} path={path} />;
  }

  if (path === "/member-portal" || path.startsWith("/member-portal/")) {
    if (!loaded) return <main className="auth-shell"><p>Åbner Hjerterum …</p></main>;
    if (!clerk) return <AuthPage clerk={null} mode="sign-in" />;
    if (!user) return <AuthPage clerk={clerk} mode="sign-in" />;
    return <MemberWorkspace clerk={clerk} user={user} path={path} />;
  }

  if (path !== "/") return <PublicContentPage path={path} />;
  return <PublicHome />;
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing root element");
createRoot(root).render(<StrictMode><App /></StrictMode>);
