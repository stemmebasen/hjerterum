import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { loadClerk, type ClerkBrowser, type ClerkUser } from "./clerk";
import { AdminWorkspace, MemberWorkspace } from "./workspaces";
import { calculateRoomPriceQuote, type RoomBookingType } from "../../../packages/core/src/legacy-room-pricing.js";
import "./styles.css";

const HJERTERUM_LOGO_URL = "https://hjerterum.info/member-portal/logo.png";

type PublicBooking = {
  id: number;
  teacherName: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
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
  source: "hjerterum" | "membershipworks";
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("da-DK", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Copenhagen"
  }).format(new Date(value));
}

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

function UserButton({ clerk }: { clerk: ClerkBrowser }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const node = ref.current;
    clerk.mountUserButton(node);
    return () => clerk.unmountUserButton(node);
  }, [clerk]);
  return <div className="user-button" ref={ref} />;
}

function Brand({ className = "" }: { className?: string }) {
  return (
    <a className={`brand ${className}`.trim()} href="/" aria-label="Hjerterum forside">
      <img
        src={HJERTERUM_LOGO_URL}
        alt="Hjerterum"
        style={{ display: "block", height: "48px", width: "auto", maxWidth: "190px", objectFit: "contain" }}
      />
    </a>
  );
}

function SiteHeader({ member = false, clerk, user }: { member?: boolean; clerk?: ClerkBrowser; user?: ClerkUser }) {
  return (
    <header className="site-header">
      <Brand />
      {member ? (
        <nav className="site-nav member-nav" aria-label="Medlemsnavigation">
          <a href="/member-portal/dashboard">Medlemskab</a>
          <a href="/member-portal/kalender">Kalender</a>
          <a href="/member-portal/kontakt">Kontakt</a>
          <a href="/member-portal/profil">Profil</a>
          {clerk && user && <UserButton clerk={clerk} />}
        </nav>
      ) : (
        <nav className="site-nav" aria-label="Hovednavigation">
          <a href="/events">Events</a>
          <a href="/vision">Om Hjerterum</a>
          <a href="/fordele-ved-medlemskab">Medlemskab</a>
          <a href="/brug-centret">Brug huset</a>
          <a href="/price-list">Prisberegner</a>
          <a href="/behandlere">Behandlere</a>
          <a href="/artikler">Artikler</a>
          <a href="/kontakt-os">Kontakt</a>
          <a className="nav-login" href="/sign-in">Log ind</a>
        </nav>
      )}
    </header>
  );
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
      <Brand className="auth-brand" />
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

function EventSection({ events, reachable }: { events: CalendarEvent[]; reachable: boolean }) {
  return (
    <section className="content-section events-section" id="kalender">
      <div className="section-intro">
        <p className="kicker">Kalender</p>
        <h2>Det sker i Hjerterum</h2>
        <p>Workshops, praksis, meditation, bevægelse, musik og andre arrangementer skabt af mennesker omkring Hjerterum.</p>
      </div>
      {reachable && events.length ? (
        <div className="event-grid">
          {events.slice(0, 6).map((event) => {
            const content = (
              <>
                {event.imageUrl && <img className="event-card-image" src={event.imageUrl} alt="" loading="lazy" />}
                <time>{formatDate(event.startsAt)}</time>
                <h3>{event.title}</h3>
                {(event.location || event.host) && (
                  <p className="event-meta">{[event.location, event.host].filter(Boolean).join(" · ")}</p>
                )}
                <p>{event.description || (event.host ? `Med ${event.host}` : "")}</p>
              </>
            );

            return event.link ? (
              <a className="event-card event-card-link" key={event.key} href={event.link}>
                {content}
              </a>
            ) : (
              <article className="event-card" key={event.key}>{content}</article>
            );
          })}
        </div>
      ) : (
        <div className="calendar-empty">
          <p>{reachable ? "Der er ingen kommende events i kalenderen endnu." : "Kalenderen indlæses."}</p>
        </div>
      )}
      <a className="text-link section-link" href="/member-portal/kalender">Åbn hele kalenderen →</a>
    </section>
  );
}

function RoomPriceCalculator() {
  const [bookingType, setBookingType] = useState<RoomBookingType>("standard");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [start, setStart] = useState("10:00");
  const [hours, setHours] = useState("2");
  const [memberPrice, setMemberPrice] = useState("");
  const dateValue = new Date(`${date}T12:00:00`);
  const [startHour = 10, startMinute = 0] = start.split(":").map(Number);
  const durationHours = Math.max(2, Number(hours) || 2);
  const pricing = calculateRoomPriceQuote({
    bookingType,
    dayOfWeek: dateValue.getDay(),
    startMinutes: startHour * 60 + startMinute,
    durationMinutes: durationHours * 60,
    ...(bookingType === "reduced" ? { memberPriceKr: Number(memberPrice) || 0 } : {})
  });
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
        <label>Varighed i timer<input type="number" min="2" max="24" step="0.5" value={hours} onChange={(event) => setHours(event.target.value)} /></label>
        {bookingType === "reduced" && <label>Medlemspris pr. deltager<input type="number" min="0" step="1" value={memberPrice} onChange={(event) => setMemberPrice(event.target.value)} placeholder="Fx 300" /></label>}
      </div>
      <div className="price-result">
        <p className="kicker">Anslået lejepris</p>
        <strong>{pricing.totalPriceKr.toLocaleString("da-DK")} kr.</strong>
        <p>{bandLabel}. Beregningen bruger pakkepris eller påbegyndte halve timer.</p>
        {bookingType === "reduced" && pricing.memberPriceKr !== null && <p>Medlemspris: {pricing.memberPriceKr.toLocaleString("da-DK")} kr. · ikke-medlemmer: {pricing.nonMemberPriceKr?.toLocaleString("da-DK")} kr.</p>}
        {bookingType === "free" && <p>Ikke-medlemmer skal mindst betale {pricing.minimumNonMemberPriceKr} kr. pr. deltager.</p>}
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
            imageUrl: null,
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
            link: event.link,
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

function PublicHome() {
  const { events, eventsReachable } = usePublicEvents();

  return (
    <main className="page-shell">
      <SiteHeader />

      <section className="home-hero">
        <div className="hero-copy">
          <p className="kicker">Hjerterum i Aarhus</p>
          <h1>Et rum for nærvær, praksis og fællesskab.</h1>
          <p className="hero-lead">Hjerterum tilbyder arrangementer, workshops og fællesskab inden for personlig udvikling, indre transformation og spiritualitet.</p>
          <div className="hero-actions">
            <a className="pill-button dark" href="#kalender">Se kalenderen</a>
            <a className="pill-button light" href="#medlemskab">Bliv medlem</a>
          </div>
        </div>
        <div className="hero-orbit" aria-hidden="true"><span>♡</span></div>
      </section>

      <EventSection events={events} reachable={eventsReachable} />

      <section className="split-section membership-section" id="medlemskab">
        <div className="section-intro">
          <p className="kicker">Medlemskab</p>
          <h2>Hjerterum er noget, vi skaber sammen.</h2>
          <p>Som medlem er du med til at holde huset levende og tilgængeligt. Du bliver en del af fællesskabet og får adgang til medlemsfordele, aktiviteter og mulighed for selv at skabe noget i Hjerterum.</p>
          <a className="pill-button dark" href="/fordele-ved-medlemskab">Læs om medlemskab</a>
        </div>
        <div className="membership-price-card">
          <span>Medlemskab</span>
          <strong>222 kr.</strong>
          <small>pr. måned</small>
          <p>Et enkelt medlemskab til fællesskabet og huset. Aktivering af betaling kommer senere.</p>
        </div>
      </section>

      <section className="content-section" id="huset">
        <div className="section-intro wide">
          <p className="kicker">Huset</p>
          <h2>Plads til mange måder at mødes på.</h2>
        </div>
        <div className="three-grid">
          <article className="story-card"><span className="story-number">01</span><h3>Undervisning & praksis</h3><p>Yoga, meditation, bevægelse, lyd, workshops og andre formater med plads til både fordybelse og nysgerrighed.</p></article>
          <article className="story-card"><span className="story-number">02</span><h3>Terapi & behandling</h3><p>Hjerterum rummer behandlere og terapeuter, der arbejder med mennesket fra forskellige faglige og holistiske perspektiver.</p></article>
          <article className="story-card"><span className="story-number">03</span><h3>Fællesskab</h3><p>Et fysisk sted for møder, samtaler, koncerter, ceremonier, fællesspisning og det, der opstår mellem mennesker.</p></article>
        </div>
      </section>

      <section className="content-section explore-section" id="udforsk">
        <div className="section-intro wide">
          <p className="kicker">Udforsk Hjerterum</p>
          <h2>Find det, du vil vide mere om.</h2>
          <p>Vi samler det vigtigste indhold fra Hjerterums tidligere sider i færre, tydelige destinationer.</p>
        </div>
        <div className="public-link-grid explore-grid">
          <a className="story-card" href="/historien-bag-hjerterum"><span className="story-number">01</span><h3>Historien bag Hjerterum</h3><p>Læs om huset, visionen og fællesskabet, der har skabt Hjerterum.</p></a>
          <a className="story-card" href="/behandlere"><span className="story-number">02</span><h3>Behandlere og undervisere</h3><p>Mød de mennesker og praksisser, der bruger huset.</p></a>
          <a className="story-card" href="/praktisk-information"><span className="story-number">03</span><h3>Praktisk information</h3><p>Find information om at bruge huset, holde event eller blive en del af fællesskabet.</p></a>
          <a className="story-card" href="/artikler"><span className="story-number">04</span><h3>Artikler og inspiration</h3><p>Fordyb dig i temaer fra Hjerterums univers.</p></a>
        </div>
      </section>

      <section className="split-section room-section">
        <div className="room-art" aria-hidden="true"><span>H</span></div>
        <div className="section-intro">
          <p className="kicker">Lej Hjerterum</p>
          <h2>Skab dit eget arrangement i huset.</h2>
          <p>Hjerterums lokaler kan bruges til undervisning, workshops, behandlinger, møder og events. Medlemmer kan oprette arrangementer direkte gennem kalenderen.</p>
          <a className="text-link" href="/member-portal/kalender">Se muligheder og book →</a>
        </div>
      </section>

      <section className="circles-section">
        <div>
          <p className="kicker">CIRKLER</p>
          <h2>Små, faste fællesskaber.</h2>
          <p>CIRKLER er et selvstændigt fællesskabsunivers. Som medlem af Hjerterum kan du møde CIRKLER som en del af de fællesskabsmuligheder, der vokser omkring huset.</p>
        </div>
        <a className="pill-button light" href="https://cirkler.net" rel="noreferrer">Besøg CIRKLER ↗</a>
      </section>

      <section className="content-section vision-section">
        <p className="kicker">Vision</p>
        <blockquote>Vi tror på, at noget vigtigt sker, når mennesker får et sted at mødes uden at skulle være på en bestemt måde.</blockquote>
      </section>

      <section className="contact-section" id="kontakt">
        <div><p className="kicker">Kontakt</p><h2>Kom forbi Hjerterum.</h2><p>Mejlgade 26B, 8000 Aarhus C</p></div>
        <div className="contact-links">
          <a href="mailto:team@holistisk.org">team@holistisk.org</a>
          <a href="#english">English</a>
          <a href="/sign-in">Medlemslogin</a>
        </div>
      </section>

      <section className="english-section" id="english">
        <p className="kicker">English</p>
        <p>Hjerterum is a community space in Aarhus for practice, presence, creativity and connection. You are welcome to explore the calendar or get in touch with us.</p>
      </section>

      <footer className="site-footer"><span>HJERTERUM</span><span>Aarhus · fællesskab · praksis · nærvær</span></footer>
    </main>
  );
}

function PublicContentPage({ path }: { path: string }) {
  const normalizedPath = path.replace(/\/+$/, "") || "/";
  const english = normalizedPath === "/welcome" || normalizedPath === "/events-en" ||
    normalizedPath === "/vision-en" || normalizedPath === "/book-your-event" ||
    normalizedPath === "/become-a-member" || normalizedPath === "/conditions-of-membership" ||
    normalizedPath === "/use-hjerterum" || normalizedPath === "/conditions-for-renting-the-room" ||
    normalizedPath === "/guidelines-for-teachers";
  const { events, eventsReachable } = usePublicEvents();

  useEffect(() => {
    const titles: Record<string, string> = {
      "/welcome": "Welcome to Hjerterum",
      "/events": "Events i Hjerterum",
      "/events-en": "Events at Hjerterum",
      "/vision": "Hvad er Hjerterum?",
      "/vision-en": "What is Hjerterum?",
      "/historien-bag-hjerterum": "Historien bag Hjerterum",
      "/behandlere": "Behandlere og undervisere",
      "/praktisk-information": "Praktisk information",
      "/artikler": "Artikler og inspiration",
      "/team": "Mød Hjerterum",
      "/teamet": "Mød Hjerterum",
      "/kontakt-os": "Kontakt Hjerterum",
      "/fordele-ved-medlemskab": "Fordele ved et medlemskab",
      "/benefits-of-membership": "Benefits of membership",
      "/medlemskabs-betingelser": "Vilkår for medlemskab",
      "/conditions-of-membership": "Terms of membership",
      "/bliv-medlem": "Bliv medlem af Hjerterum",
      "/become-a-member": "Become a member of Hjerterum",
      "/book-dit-event": "Book dit event i Hjerterum",
      "/book-your-event": "Book your event at Hjerterum",
      "/brug-centret": "Brug Hjerterum",
      "/use-hjerterum": "Use Hjerterum",
      "/lejepriser": "Lejepriser",
      "/betingelser-for-leje-af-sal": "Vilkår for leje af sal",
      "/conditions-for-renting-the-room": "Conditions for renting the room",
      "/guidelines-for-undervisere": "Praktisk information",
      "/guidelines-for-teachers": "Practical information",
      "/price-list": "Book Room at Hjerterum"
    };
    document.title = `${titles[normalizedPath] || "Hjerterum"} · Hjerterum`;
  }, [normalizedPath]);

  if (normalizedPath === "/events" || normalizedPath === "/events-en") {
    return (
      <main className="page-shell">
        <SiteHeader />
        <section className="content-section public-page-intro">
          <p className="kicker">{english ? "Calendar" : "Kalender"}</p>
          <h1>{english ? "Events at Hjerterum" : "Events i Hjerterum"}</h1>
          <p className="lead-copy">
            {english
              ? "A varied program of yoga, meditation, breathwork, talks, music, community and inner exploration."
              : "Et levende program med yoga, meditation, åndedræt, musik, fællesskab og plads til indre fordybelse."}
          </p>
        </section>
        <EventSection events={events} reachable={eventsReachable} />
        <section className="soft-panel public-policy">
          <h2>{english ? "A safe and respectful space" : "Et trygt og respektfuldt rum"}</h2>
          <p>{english
            ? "Ask before filming or photographing, and respect a no. We look after each other's safety, privacy and trust."
            : "Spørg før du filmer eller fotograferer, og respekter et nej. Vi passer på hinandens tryghed, privatliv og tillid."}</p>
          <p>{english
            ? "For events arranged by external teachers, Hjerterum acts as mediator and lessor of the premises. Questions about content or agreements should be addressed to the organiser."
            : "Ved events arrangeret af eksterne undervisere fungerer Hjerterum som formidler og udlejer af lokalerne. Spørgsmål om indhold eller aftaler skal rettes til arrangøren."}</p>
        </section>
      </main>
    );
  }

  const page = (() => {
    switch (normalizedPath) {
      case "/vision":
      case "/historien-bag-hjerterum":
        return {
          kicker: "Hjerterum",
          title: normalizedPath === "/historien-bag-hjerterum" ? "Historien bag Hjerterum." : "Et rum for nærvær, praksis og fællesskab.",
          body: normalizedPath === "/historien-bag-hjerterum"
            ? "Hjerterum er vokset frem af et ønske om at skabe et åbent hus i Aarhus for personlig udvikling, indre transformation og fællesskab."
            : "Hjerterum er et levende hus i Aarhus, hvor mennesker mødes om det, der skaber mere kontakt, ro, liv og forbindelse.",
          action: ["Se kalenderen", "/events"]
        };
      case "/vision-en":
        return {
          kicker: "Hjerterum",
          title: "A space for community, creativity and personal development.",
          body: "Hjerterum is an open and safe space in Aarhus for meaningful events, practice, creativity and connection.",
          action: ["Explore events", "/events-en"]
        };
      case "/team":
      case "/teamet":
        return {
          kicker: "Menneskene i huset",
          title: "Mød Hjerterum.",
          body: "Hjerterum er skabt og holdt levende af mennesker, undervisere, behandlere og arrangører, der deler huset og fællesskabet.",
          action: ["Kontakt os", "/kontakt-os"]
        };
      case "/behandlere":
        return {
          kicker: "Menneskene i huset",
          title: "Behandlere og undervisere i Hjerterum.",
          body: "Hjerterum er hjem for undervisere, behandlere og arrangører med forskellige faglige og holistiske perspektiver. Kalenderen viser de aktuelle events og tilbud i huset.",
          action: ["Se aktuelle events", "/events"]
        };
      case "/praktisk-information":
        return {
          kicker: "Brug Hjerterum",
          title: "Praktisk information om huset.",
          body: "Her samler vi den praktiske viden fra Hjerterums tidligere sider: hvordan du holder event, bruger salen, markedsfører dit arrangement og bliver en del af husets fællesskab.",
          action: ["Læs om at bruge huset", "/brug-centret"]
        };
      case "/artikler":
        return {
          kicker: "Inspiration",
          title: "Artikler og inspiration fra Hjerterum.",
          body: "Hjerterums artikler og faglige indhold samles løbende her, så viden om praksis, nærvær og personlig udvikling bliver lettere at finde.",
          action: ["Kontakt os", "/kontakt-os"]
        };
      case "/kontakt-os":
        return {
          kicker: "Kontakt",
          title: "Kom forbi Hjerterum.",
          body: "Har du spørgsmål til huset, medlemskab eller events, er du velkommen til at skrive til os.",
          action: ["Skriv til os", "mailto:team@holistisk.org"]
        };
      case "/fordele-ved-medlemskab":
      case "/benefits-of-membership":
      case "/bliv-medlem":
      case "/become-a-member":
        return {
          kicker: english ? "Membership" : "Medlemskab",
          title: english ? "Be part of Hjerterum." : "Hjerterum er noget, vi skaber sammen.",
          body: english
            ? "Membership connects you to the house, its community and a varied program of events."
            : "Som medlem er du med til at holde huset levende og tilgængeligt. Du bliver en del af fællesskabet og får adgang til aktiviteter og mulighed for selv at skabe noget i Hjerterum.",
          action: [english ? "Contact us about membership" : "Kontakt os om medlemskab", "/kontakt-os"]
        };
      case "/medlemskabs-betingelser":
      case "/conditions-of-membership":
        return {
          kicker: english ? "Membership" : "Medlemskab",
          title: english ? "Membership terms." : "Vilkår for medlemskab.",
          body: english
            ? "Membership is personal and connected to the community around Hjerterum. The current terms are reviewed before any paid membership flow is activated."
            : "Medlemskabet er personligt og knyttet til fællesskabet omkring Hjerterum. Vilkårene gennemgås, før et betalt medlemsflow aktiveres.",
          action: [english ? "Membership overview" : "Se medlemskab", english ? "/become-a-member" : "/bliv-medlem"]
        };
      case "/book-dit-event":
      case "/book-your-event":
        return {
          kicker: english ? "Use the house" : "Brug Hjerterum",
          title: english ? "Create your own event in the house." : "Skab dit eget arrangement i Hjerterum.",
          body: english
            ? "Our rooms can be used for teaching, workshops, treatments, meetings and events. Members can create and reserve events through the member area."
            : "Hjerterums lokaler kan bruges til undervisning, workshops, behandlinger, møder og events. Medlemmer kan oprette og reservere arrangementer gennem medlemsområdet.",
          action: [english ? "Open member area" : "Åbn medlemsområdet", "/member-portal/kalender"]
        };
      case "/brug-centret":
      case "/use-hjerterum":
      case "/lejepriser":
      case "/betingelser-for-leje-af-sal":
      case "/conditions-for-renting-the-room":
      case "/guidelines-for-undervisere":
      case "/guidelines-for-teachers":
        return {
          kicker: english ? "Use the house" : "Brug Hjerterum",
          title: english ? "Create your own event in the house." : "Skab dit eget arrangement i huset.",
          body: english
            ? "Hjerterum's room at Mejlgade 26B can host teaching, workshops, treatments, meetings and events."
            : "Hjerterums sal på Mejlgade 26B kan bruges til undervisning, workshops, behandlinger, møder og events.",
          action: [english ? "Calculate the rental price" : "Beregn lejepris", "/price-list"]
        };
      case "/price-list":
        return {
          kicker: "Brug Hjerterum",
          title: "Beregn prisen for at leje salen.",
          body: "Vælg dato, starttid og varighed for at få et estimat efter Hjerterums aktuelle prisberegner.",
          action: ["Læs om at bruge huset", "/brug-centret"]
        };
      case "/welcome":
        return {
          kicker: "Hjerterum",
          title: "A space for presence, practice and community.",
          body: "Hjerterum is a community space in Aarhus for practice, creativity, connection and inner exploration.",
          action: ["Explore events", "/events-en"]
        };
      default:
        return null;
    }
  })();

  if (!page) return <PublicHome />;

  return (
    <main className="page-shell">
      <SiteHeader />
      <section className="content-section public-page-intro">
        <p className="kicker">{page.kicker}</p>
        <h1>{page.title}</h1>
        <p className="lead-copy">{page.body}</p>
        <a className="pill-button dark" href={page.action[1]}>{page.action[0]}</a>
      </section>
      {normalizedPath === "/price-list" && <RoomPriceCalculator />}
      <section className="three-grid public-link-grid">
        <a className="story-card" href={english ? "/events-en" : "/events"}>
          <span className="story-number">01</span>
          <h3>{english ? "Events" : "Events"}</h3>
          <p>{english ? "Find workshops, practice and community." : "Find workshops, praksis og fællesskab."}</p>
        </a>
        <a className="story-card" href={english ? "/become-a-member" : "/bliv-medlem"}>
          <span className="story-number">02</span>
          <h3>{english ? "Membership" : "Medlemskab"}</h3>
          <p>{english ? "Join the community around the house." : "Bliv en del af fællesskabet omkring huset."}</p>
        </a>
        <a className="story-card" href={english ? "/book-your-event" : "/book-dit-event"}>
          <span className="story-number">03</span>
          <h3>{english ? "Use the house" : "Brug huset"}</h3>
          <p>{english ? "Create an event in Hjerterum." : "Skab dit eget arrangement i Hjerterum."}</p>
        </a>
        {normalizedPath === "/brug-centret" && (
          <>
            <a className="story-card" href="/price-list">
              <span className="story-number">04</span>
              <h3>Prisberegner</h3>
              <p>Beregn et estimat ud fra bookingtype, dato, tidspunkt og varighed.</p>
            </a>
            <a className="story-card" href="/praktisk-information">
              <span className="story-number">05</span>
              <h3>Praktisk information</h3>
              <p>Læs om forberedelse, brug af huset og bookingprocessen.</p>
            </a>
          </>
        )}
      </section>
      <section className="contact-section">
        <div><p className="kicker">{english ? "Get in touch" : "Kontakt"}</p><h2>{english ? "You are welcome." : "Du er velkommen."}</h2><p>Mejlgade 26B, 8000 Aarhus C</p></div>
        <div className="contact-links">        <a href="mailto:team@holistisk.org">team@holistisk.org</a><a href="/">Hjerterum</a></div>
      </section>
    </main>
  );
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