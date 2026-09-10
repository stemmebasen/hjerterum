import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { apiFetch, loadClerk, type ClerkBrowser, type ClerkUser } from "./clerk";
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

type Member = {
  id: number;
  tier: string;
  interval: string;
  status: string;
  fullName: string;
  email: string;
  phone: string | null;
  streetAddress: string | null;
  isTeacher: boolean;
};

type OwnedBooking = {
  id: number;
  teacherName: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  maxAttendees: number | null;
  feeKr: number;
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
          <a href="#kalender">Kalender</a>
          <a href="#medlemskab">Medlemskab</a>
          <a href="#huset">Huset</a>
          <a href="#kontakt">Kontakt</a>
          <a className="nav-login" href="/sign-in">Log ind</a>
        </nav>
      )}
    </header>
  );
}

function AuthPage({ clerk, mode }: { clerk: ClerkBrowser | null; mode: "sign-in" | "sign-up" }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!clerk || !ref.current) return;
    const node = ref.current;
    if (mode === "sign-in") clerk.mountSignIn(node);
    else clerk.mountSignUp(node);
    return () => {
      if (mode === "sign-in") clerk.unmountSignIn(node);
      else clerk.unmountSignUp(node);
    };
  }, [clerk, mode]);

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

function MemberPortal({ clerk, user }: { clerk: ClerkBrowser; user: ClerkUser }) {
  const [member, setMember] = useState<Member | null>(null);
  const [memberMissing, setMemberMissing] = useState(false);
  const [bookings, setBookings] = useState<OwnedBooking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void Promise.all([
      apiFetch(clerk, "/api/members/me").then(async (response) => {
        if (response.status === 404) return null;
        if (!response.ok) throw new Error("member_load_failed");
        return (await response.json()) as Member;
      }),
      apiFetch(clerk, "/api/room-bookings").then(async (response) => {
        if (!response.ok) throw new Error("booking_load_failed");
        return (await response.json()) as OwnedBooking[];
      })
    ])
      .then(([memberData, bookingData]) => {
        if (!active) return;
        setMember(memberData);
        setMemberMissing(memberData === null);
        setBookings(bookingData);
      })
      .catch(() => {
        if (active) setMemberMissing(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [clerk, user.id]);

  const displayName = member?.fullName || user.fullName || user.firstName || "Medlem";
  const email = member?.email || user.primaryEmailAddress?.emailAddress || "";

  return (
    <main className="page-shell portal-shell">
      <SiteHeader member clerk={clerk} user={user} />
      <section className="portal-welcome">
        <p className="kicker">Dit Hjerterum</p>
        <h1>Velkommen, {displayName.split(" ")[0]}</h1>
        <p>Her finder du dit medlemskab, dine tilmeldinger, kalenderen og dine oplysninger.</p>
      </section>

      {loading ? (
        <section className="soft-panel"><p>Henter dit medlemsområde …</p></section>
      ) : (
        <div className="portal-grid">
          <section className="soft-panel membership-card">
            <p className="kicker">Medlemskab</p>
            {member ? (
              <>
                <div className="member-state"><span className={member.status === "active" ? "dot active" : "dot"} />{member.status === "active" ? "Aktivt medlem" : member.status}</div>
                <h2>{member.tier}</h2>
                <p>{member.interval === "year" ? "Årligt medlemskab" : "Månedligt medlemskab"}</p>
                <a className="text-link" href="/member-portal/dashboard">Administrér medlemskab →</a>
              </>
            ) : (
              <>
                <h2>Du er logget ind</h2>
                <p>Der er endnu ikke knyttet et medlemskab til din bruger i den nye udviklingsdatabase.</p>
              </>
            )}
          </section>

          <section className="soft-panel profile-card">
            <p className="kicker">Dine oplysninger</p>
            <h2>{displayName}</h2>
            {email && <p>{email}</p>}
            {member?.phone && <p>{member.phone}</p>}
            {member?.streetAddress && <p>{member.streetAddress}</p>}
            {memberMissing && <p className="small-note">Profilen kan stadig administreres via Clerk, mens medlemsdata flyttes.</p>}
            <a className="text-link" href="/member-portal/kontakt">Redigér oplysninger →</a>
          </section>

          <section className="soft-panel booking-panel">
            <div className="panel-title-row">
              <div><p className="kicker">Dine events</p><h2>Mine tilmeldinger</h2></div>
              <a className="pill-button" href="/member-portal/kalender">Se kalender</a>
            </div>
            {bookings.length ? (
              <div className="booking-list">
                {bookings.slice(0, 5).map((booking) => (
                  <article key={booking.id}>
                    <time>{formatDate(booking.startsAt)}</time>
                    <strong>{booking.title}</strong>
                  </article>
                ))}
              </div>
            ) : <p className="muted">Du har ingen kommende bookinger eller tilmeldinger endnu.</p>}
          </section>
        </div>
      )}
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
          <p className="kicker">Holistisk fællesskab i Aarhus</p>
          <h1>Et rum for nærvær, praksis og fællesskab.</h1>
          <p className="hero-lead">Hjerterum er et levende hus, hvor mennesker mødes om det, der skaber mere kontakt, ro, liv og forbindelse.</p>
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
        <div><p className="kicker">Kontakt</p><h2>Kom forbi Hjerterum.</h2></div>
        <div className="contact-links">
          <a href="mailto:jh@holistisk.org">jh@holistisk.org</a>
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
    normalizedPath === "/book-your-event" || normalizedPath === "/become-a-member";
  const { events, eventsReachable } = usePublicEvents();

  useEffect(() => {
    const titles: Record<string, string> = {
      "/welcome": "Welcome to Hjerterum",
      "/events": "Events i Hjerterum",
      "/events-en": "Events at Hjerterum",
      "/vision": "Hvad er Hjerterum?",
      "/kontakt-os": "Kontakt Hjerterum",
      "/fordele-ved-medlemskab": "Fordele ved et medlemskab",
      "/bliv-medlem": "Bliv medlem af Hjerterum",
      "/become-a-member": "Become a member of Hjerterum",
      "/book-dit-event": "Book dit event i Hjerterum",
      "/book-your-event": "Book your event at Hjerterum",
      "/brug-centret": "Brug Hjerterum",
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
        return {
          kicker: "Hjerterum",
          title: "Et rum for nærvær, praksis og fællesskab.",
          body: "Hjerterum er et levende hus i Aarhus, hvor mennesker mødes om det, der skaber mere kontakt, ro, liv og forbindelse.",
          action: ["Se kalenderen", "/events"]
        };
      case "/kontakt-os":
        return {
          kicker: "Kontakt",
          title: "Kom forbi Hjerterum.",
          body: "Har du spørgsmål til huset, medlemskab eller events, er du velkommen til at skrive til os.",
          action: ["Skriv til os", "mailto:jh@holistisk.org"]
        };
      case "/fordele-ved-medlemskab":
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
      case "/book-dit-event":
      case "/book-your-event":
      case "/brug-centret":
      case "/price-list":
        return {
          kicker: english ? "Use the house" : "Brug Hjerterum",
          title: english ? "Create your own event in the house." : "Skab dit eget arrangement i Hjerterum.",
          body: english
            ? "Our rooms can be used for teaching, workshops, treatments, meetings and events. Members can create and reserve events through the member area."
            : "Hjerterums lokaler kan bruges til undervisning, workshops, behandlinger, møder og events. Medlemmer kan oprette og reservere arrangementer gennem medlemsområdet.",
          action: [english ? "Open member area" : "Åbn medlemsområdet", "/member-portal/kalender"]
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
      </section>
      <section className="contact-section">
        <div><p className="kicker">{english ? "Get in touch" : "Kontakt"}</p><h2>{english ? "You are welcome." : "Du er velkommen."}</h2></div>
        <div className="contact-links"><a href="mailto:jh@holistisk.org">jh@holistisk.org</a><a href="/">Hjerterum</a></div>
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

  if (path === "/member-portal" || path.startsWith("/member-portal/")) {
    if (!loaded) return <main className="auth-shell"><p>Åbner Hjerterum …</p></main>;
    if (!clerk) return <AuthPage clerk={null} mode="sign-in" />;
    if (!user) return <AuthPage clerk={clerk} mode="sign-in" />;
    return <MemberPortal clerk={clerk} user={user} />;
  }

  if (path !== "/") return <PublicContentPage path={path} />;
  return <PublicHome />;
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing root element");
createRoot(root).render(<StrictMode><App /></StrictMode>);