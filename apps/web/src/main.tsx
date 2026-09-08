import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
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

function App() {
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
        <span className="preview-badge">Udviklingspreview</span>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">Ny, Replit-uafhængig platform</p>
          <h1>Et sted at lande.<br />Et sted at mødes.</h1>
          <p className="lead">
            Hjerterums nye platform samler medlemskab, kalender, events og rumbooking i én enkel oplevelse.
          </p>
          <div className="actions">
            <a className="button primary" href="#kalender">Se kalender</a>
            <a className="button secondary" href="/member-portal/">Medlemsområde</a>
          </div>
        </div>

        <aside className="status-card" aria-label="Platformstatus">
          <p className="status-kicker">Platformstatus</p>
          <strong>{runtimeLabel}</strong>
          <span className={readiness?.status === "ready" ? "status-dot ready" : "status-dot pending"}>
            {readiness?.status === "ready"
              ? "Database klar"
              : "Database aktiveres i permanent staging"}
          </span>
          <small>Koden kører fra GitHub + Cloudflare. Replit er ikke en del af denne preview-runtime.</small>
        </aside>
      </section>

      <section className="section" id="kalender">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Kalender</p>
            <h2>Det sker i Hjerterum</h2>
          </div>
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
              <p>
                Frontend og API er allerede flyttet. Når den permanente D1-staging er aktiveret, vises events her direkte fra Cloudflare.
              </p>
            </div>
          </div>
        )}
      </section>

      <section className="feature-grid">
        <article className="feature-card">
          <span>01</span>
          <h3>Medlemsområde</h3>
          <p>Profil, medlemskab, Stripe-betalinger og fakturahistorik ligger nu i den nye Worker-backend.</p>
        </article>
        <article className="feature-card">
          <span>02</span>
          <h3>Events & rum</h3>
          <p>Opret, redigér, book, tilmeld og afmeld direkte gennem Cloudflare og D1.</p>
        </article>
        <article className="feature-card">
          <span>03</span>
          <h3>CIRKLER</h3>
          <p>CIRKLER forbliver sit eget univers, men kan kobles til medlemsfordele uden at blande systemerne sammen.</p>
          <a href="https://cirkler.net" rel="noreferrer">Besøg CIRKLER ↗</a>
        </article>
      </section>

      <footer>
        <span>Hjerterum</span>
        <span>GitHub → Cloudflare → D1</span>
      </footer>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing root element");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
