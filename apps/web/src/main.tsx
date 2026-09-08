import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  apiFetch,
  loadClerk,
  type ClerkBrowser,
  type ClerkUser
} from "./clerk";
import "./styles.css";

type Health = {
  status?: string;
  environment?: string;
  database?: string;
};

type PublicBooking = {
  id: number;
  teacherName: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
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
    weekday: "short",
    day: "numeric",
    month: "short",
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
      <a className="brand auth-brand" href="/">Hjerterum</a>
      <div className="auth-card">
        {!clerk ? (
          <div className="auth-unavailable">
            <p className="eyebrow">Udviklingspreview</p>
            <h1>Login aktiveres i permanent staging</h1>
            <p>Clerk-konfigurationen findes ikke i den anonyme preview-runtime. Selve login-flowet er flyttet til Cloudflare.</p>
          </div>
        ) : (
          <div ref={ref} />
        )}
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
    setLoading(true);

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
    <main className="site-shell portal-shell">
      <header className="topbar">
        <a className="brand" href="/">Hjerterum</a>
        <div className="portal-user">
          <span>{displayName}</span>
          <UserButton clerk={clerk} />
        </div>
      </header>

      <section className="portal-hero">
        <div>
          <p className="eyebrow">Medlemsområde</p>
          <h1>Hej {displayName.split(" ")[0]}</h1>
          <p className="lead">Her samles dit medlemskab, dine events og dine bookinger.</p>
        </div>
        {member && (
          <div className="membership-pill">
            <span className={member.status === "active" ? "status-dot ready" : "status-dot pending"}>
              {member.status === "active" ? "Aktivt medlemskab" : member.status}
            </span>
            <strong>{member.tier}</strong>
          </div>
        )}
      </section>

      {loading ? (
        <section className="portal-panel"><p>Henter dit Hjerterum …</p></section>
      ) : (
        <div className="portal-grid">
          <section className="portal-panel">
            <p className="eyebrow">Din profil</p>
            <h2>{displayName}</h2>
            {email && <p>{email}</p>}
            {member?.phone && <p>{member.phone}</p>}
            {member?.streetAddress && <p>{member.streetAddress}</p>}
            {memberMissing && (
              <div className="notice">
                <strong>Du er logget ind.</strong>
                <p>Der er endnu ikke knyttet et medlemskab til denne Clerk-bruger i den nye udviklingsdatabase.</p>
              </div>
            )}
            <div className="portal-actions">
              <a className="button secondary" href="/member-portal/profil">Profil</a>
              {member && <a className="button secondary" href="/member-portal/dashboard">Medlemskab</a>}
            </div>
          </section>

          <section className="portal-panel portal-bookings">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Dine events</p>
                <h2>{bookings.length ? `${bookings.length} bookinger` : "Ingen bookinger endnu"}</h2>
              </div>
              <a className="button primary small" href="/member-portal/kalender">Åbn kalender</a>
            </div>
            {bookings.length > 0 ? (
              <div className="booking-list">
                {bookings.slice(0, 5).map((booking) => (
                  <article key={booking.id}>
                    <time>{formatDate(booking.startsAt)}</time>
                    <div>
                      <strong>{booking.title}</strong>
                      <span>{booking.feeKr} kr.</span>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="muted">Når du opretter eller booker et event, dukker det op her.</p>
            )}
          </section>
        </div>
      )}

      <footer>
        <span>Hjerterum medlemsområde</span>
        <span>Cloudflare + D1 + Clerk</span>
      </footer>
    </main>
  );
}

function PublicHome() {
  const [health, setHealth] = useState<Health | null>(null);
  const [readiness, setReadiness] = useState<Health | null>(null);
  const [events, setEvents] = useState<PublicBooking[]>([]);
  const [eventsReachable, setEventsReachable] = useState(false);

  useEffect(() => {
    void fetch("/api/health")
      .then((response) => response.json())
      .then((data: Health) => setHealth(data))
      .catch(() => setHealth({ status: "offline" }));

    void fetch("/api/readiness")
      .then(async (response) => (await response.json()) as Health)
      .then(setReadiness)
      .catch(() => setReadiness({ status: "degraded" }));

    void fetch("/api/room-bookings/public")
      .then(async (response) => {
        if (!response.ok) throw new Error("events_unavailable");
        return (await response.json()) as PublicBooking[];
      })
      .then((data) => {
        setEvents(data);
        setEventsReachable(true);
      })
      .catch(() => setEventsReachable(false));
  }, []);

  const runtimeLabel = useMemo(() => {
    if (!health) return "Kontrollerer runtime …";
    if (health.status !== "ok") return "Runtime utilgængelig";
    return `Cloudflare runtime · ${health.environment ?? "preview"}`;
  }, [health]);

  return (
    <main className="site-shell">
      <header className="topbar">
        <a className="brand" href="/">Hjerterum</a>
        <nav className="topnav">
          <a href="#kalender">Kalender</a>
          <a href="/member-portal/">Medlemsområde</a>
          <a href="/sign-in">Log ind</a>
        </nav>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">Ny, Replit-uafhængig platform</p>
          <h1>Et sted at lande.<br />Et sted at mødes.</h1>
          <p className="lead">Hjerterums nye platform samler medlemskab, kalender, events og rumbooking i én enkel oplevelse.</p>
          <div className="actions">
            <a className="button primary" href="#kalender">Se kalender</a>
            <a className="button secondary" href="/member-portal/">Medlemsområde</a>
          </div>
        </div>

        <aside className="status-card" aria-label="Platformstatus">
          <p className="status-kicker">Platformstatus</p>
          <strong>{runtimeLabel}</strong>
          <span className={readiness?.status === "ready" ? "status-dot ready" : "status-dot pending"}>
            {readiness?.status === "ready" ? "Database klar" : "Database aktiveres i permanent staging"}
          </span>
          <small>Koden kører fra GitHub + Cloudflare. Replit er ikke en del af denne preview-runtime.</small>
        </aside>
      </section>

      <section className="section" id="kalender">
        <div className="section-heading">
          <div><p className="eyebrow">Kalender</p><h2>Det sker i Hjerterum</h2></div>
          <span className="quiet-label">Europe/Copenhagen</span>
        </div>

        {eventsReachable && events.length > 0 ? (
          <div className="event-grid">
            {events.slice(0, 6).map((event) => (
              <article className="event-card" key={event.id}>
                <time>{formatDate(event.startsAt)}</time>
                <h3>{event.title}</h3>
                <p>{event.description || `Med ${event.teacherName}`}</p>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <span className="empty-mark">○</span>
            <div>
              <h3>{eventsReachable ? "Ingen kommende events endnu" : "Kalenderen venter på staging-databasen"}</h3>
              <p>Frontend og API er allerede flyttet. Når den permanente D1-staging er aktiveret, vises events her direkte fra Cloudflare.</p>
            </div>
          </div>
        )}
      </section>

      <section className="feature-grid">
        <article className="feature-card"><span>01</span><h3>Medlemsområde</h3><p>Profil, medlemskab, Stripe-betalinger og fakturahistorik ligger i den nye Worker-backend.</p></article>
        <article className="feature-card"><span>02</span><h3>Events & rum</h3><p>Opret, redigér, book, tilmeld og afmeld gennem Cloudflare og D1.</p></article>
        <article className="feature-card"><span>03</span><h3>CIRKLER</h3><p>CIRKLER forbliver sit eget univers, men kan kobles til medlemsfordele uden at blande systemerne sammen.</p><a href="https://cirkler.net" rel="noreferrer">Besøg CIRKLER ↗</a></article>
      </section>

      <footer><span>Hjerterum</span><span>GitHub → Cloudflare → D1</span></footer>
    </main>
  );
}

function App() {
  const { clerk, user, loaded } = useClerk();
  const path = window.location.pathname;

  if (path === "/sign-in" || path.startsWith("/sign-in/")) {
    return <AuthPage clerk={clerk} mode="sign-in" />;
  }
  if (path === "/sign-up" || path.startsWith("/sign-up/")) {
    return <AuthPage clerk={clerk} mode="sign-up" />;
  }
  if (path === "/login" || path.startsWith("/login/")) {
    window.history.replaceState(null, "", "/sign-in");
    return <AuthPage clerk={clerk} mode="sign-in" />;
  }
  if (path === "/signup" || path.startsWith("/signup/")) {
    window.history.replaceState(null, "", "/sign-up");
    return <AuthPage clerk={clerk} mode="sign-up" />;
  }

  if (path === "/member-portal" || path.startsWith("/member-portal/")) {
    if (!loaded) return <main className="auth-shell"><p>Åbner Hjerterum …</p></main>;
    if (!clerk) return <AuthPage clerk={null} mode="sign-in" />;
    if (!user) {
      window.history.replaceState(null, "", "/sign-in");
      return <AuthPage clerk={clerk} mode="sign-in" />;
    }
    return <MemberPortal clerk={clerk} user={user} />;
  }

  return <PublicHome />;
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing root element");

createRoot(root).render(<StrictMode><App /></StrictMode>);
