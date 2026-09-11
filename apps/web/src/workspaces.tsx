import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { apiFetch, type ClerkBrowser, type ClerkUser } from "./clerk";

const LOGO_URL = "https://hjerterum.info/member-portal/logo.png";

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

type Booking = {
  id: number;
  teacherName: string;
  teacherEmail?: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  maxAttendees: number | null;
  attendeeCount?: number;
  feeKr: number;
};

type AdminMember = {
  id: number;
  fullName: string;
  email: string;
  phone: string | null;
  tier: string;
  interval: string;
  status: string;
  isTeacher: boolean;
  createdAt: string;
};

type Teacher = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  card_status: string;
};

type AdminOverview = {
  totals: {
    members: number;
    activeMembers: number;
    teachers: number;
    upcomingBookings: number;
  };
  recentMembers: AdminMember[];
  upcomingBookings: Booking[];
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("da-DK", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Copenhagen"
  }).format(new Date(value));
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

function WorkspaceHeader({
  clerk,
  mode,
  path
}: {
  clerk: ClerkBrowser;
  mode: "member" | "admin";
  path: string;
}) {
  const memberLinks = [
    ["/member-portal/", "Overblik"],
    ["/member-portal/events", "Mine events"],
    ["/member-portal/kalender", "Kalender"],
    ["/member-portal/profil", "Profil"],
    ["/member-portal/kontakt", "Kontakt"]
  ];
  const adminLinks = [
    ["/admin/", "Overblik"],
    ["/admin/members", "Medlemmer"],
    ["/admin/bookings", "Events"],
    ["/admin/teachers", "Undervisere"]
  ];
  const links = mode === "admin" ? adminLinks : memberLinks;

  return (
    <header className="workspace-header">
      <a href="/" className="workspace-brand" aria-label="Hjerterum forside">
        <img src={LOGO_URL} alt="Hjerterum" />
      </a>
      <nav aria-label={mode === "admin" ? "Adminnavigation" : "Medlemsnavigation"}>
        {links.map(([href, label]) => (
          <a key={href} href={href} aria-current={path === href || (href.endsWith("/") && path === href.slice(0, -1)) ? "page" : undefined}>
            {label}
          </a>
        ))}
      </nav>
      <UserButton clerk={clerk} />
    </header>
  );
}

function Status({ value }: { value: string }) {
  const active = value === "active" || value === "card_saved";
  return <span className={"workspace-status " + (active ? "is-active" : "")}>{active ? "Aktiv" : value.replaceAll("_", " ")}</span>;
}

function MemberOverview({ member, bookings }: { member: Member | null; bookings: Booking[] }) {
  return (
    <>
      <section className="workspace-hero">
        <p className="kicker">Dit Hjerterum</p>
        <h1>Godt at se dig{member?.fullName ? ", " + member.fullName.split(" ")[0] : ""}.</h1>
        <p>Her har du medlemskab, events og dine oplysninger samlet ét sted.</p>
      </section>
      <div className="workspace-cards">
        <article className="workspace-card">
          <p className="kicker">Medlemskab</p>
          {member ? (
            <>
              <Status value={member.status} />
              <h2>{member.tier}</h2>
              <p>{member.interval === "year" ? "Årlig betaling" : "Månedlig betaling"}</p>
              <a className="text-link" href="/member-portal/dashboard">Se medlemskab →</a>
            </>
          ) : (
            <>
              <h2>Ingen medlemsprofil endnu</h2>
              <p>Din bruger er oprettet, men et medlemskab er endnu ikke knyttet til den.</p>
            </>
          )}
        </article>
        <article className="workspace-card">
          <p className="kicker">Næste event</p>
          {bookings[0] ? (
            <>
              <time>{formatDate(bookings[0].startsAt)}</time>
              <h2>{bookings[0].title}</h2>
              <a className="text-link" href="/member-portal/events">Se mine events →</a>
            </>
          ) : (
            <>
              <h2>Din kalender er åben</h2>
              <p>Du har ingen egne bookinger endnu.</p>
              <a className="text-link" href="/member-portal/kalender">Se kalenderen →</a>
            </>
          )}
        </article>
      </div>
    </>
  );
}

function MemberEvents({
  clerk,
  member,
  bookings,
  reload
}: {
  clerk: ClerkBrowser;
  member: Member | null;
  bookings: Booking[];
  reload: () => Promise<void>;
}) {
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const active = member?.status === "active";

  async function createEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!member) return;
    setSaving(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await apiFetch(clerk, "/api/room-bookings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          teacherName: member.fullName,
          teacherEmail: member.email,
          memberName: member.fullName,
          memberEmail: member.email,
          title: String(form.get("title") || ""),
          description: String(form.get("description") || ""),
          startsAt: new Date(String(form.get("startsAt"))).toISOString(),
          endsAt: new Date(String(form.get("endsAt"))).toISOString(),
          maxAttendees: Number(form.get("maxAttendees")) || null
        })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || "event_create_failed");
      }
      event.currentTarget.reset();
      setMessage("Eventet er oprettet og salen reserveret.");
      await reload();
    } catch (error) {
      const code = error instanceof Error ? error.message : "event_create_failed";
      setMessage(code === "booking_conflict" ? "Tidsrummet er allerede optaget." : "Eventet kunne ikke oprettes. Tjek tiderne og prøv igen.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="workspace-section">
      <div className="workspace-title-row">
        <div><p className="kicker">Events</p><h1>Mine events</h1></div>
      </div>
      <div className="workspace-two-column">
        <div className="workspace-card">
          <h2>Opret event og reservér salen</h2>
          {!active ? (
            <p>Du skal have et aktivt betalende medlemskab for at oprette et event.</p>
          ) : (
            <form className="workspace-form" onSubmit={createEvent}>
              <label>Titel<input name="title" required /></label>
              <label>Beskrivelse<textarea name="description" rows={4} /></label>
              <div className="workspace-form-row">
                <label>Starter<input name="startsAt" type="datetime-local" required /></label>
                <label>Slutter<input name="endsAt" type="datetime-local" required /></label>
              </div>
              <label>Maks. deltagere<input name="maxAttendees" type="number" min="1" /></label>
              <button className="pill-button dark" disabled={saving}>{saving ? "Opretter …" : "Opret event"}</button>
              {message && <p className="workspace-message" role="status">{message}</p>}
            </form>
          )}
        </div>
        <div className="workspace-card">
          <h2>Kommende bookinger</h2>
          {bookings.length ? (
            <div className="workspace-list">
              {bookings.map((booking) => (
                <article key={booking.id}>
                  <time>{formatDate(booking.startsAt)}</time>
                  <strong>{booking.title}</strong>
                  <span>{booking.feeKr.toLocaleString("da-DK")} kr. · {booking.maxAttendees ? booking.maxAttendees + " pladser" : "uden deltagergrænse"}</span>
                </article>
              ))}
            </div>
          ) : <p>Du har ingen kommende bookinger.</p>}
        </div>
      </div>
    </section>
  );
}

function MemberProfile({
  clerk,
  member,
  onSaved
}: {
  clerk: ClerkBrowser;
  member: Member | null;
  onSaved: (member: Member) => void;
}) {
  const [message, setMessage] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!member) return;
    const form = new FormData(event.currentTarget);
    const response = await apiFetch(clerk, "/api/members/me", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fullName: String(form.get("fullName") || ""),
        email: String(form.get("email") || ""),
        phone: String(form.get("phone") || ""),
        streetAddress: String(form.get("streetAddress") || ""),
        isTeacher: form.get("isTeacher") === "on"
      })
    });
    if (!response.ok) {
      setMessage("Oplysningerne kunne ikke gemmes.");
      return;
    }
    const result = await response.json() as { member: Member };
    onSaved(result.member);
    setMessage("Dine oplysninger er gemt.");
  }

  return (
    <section className="workspace-section workspace-narrow">
      <p className="kicker">Profil</p>
      <h1>Dine oplysninger</h1>
      {!member ? <div className="workspace-card"><p>Der er endnu ikke en medlemsprofil at redigere.</p></div> : (
        <form className="workspace-card workspace-form" onSubmit={save}>
          <label>Navn<input name="fullName" defaultValue={member.fullName} required /></label>
          <label>E-mail<input name="email" type="email" defaultValue={member.email} required /></label>
          <label>Telefon<input name="phone" defaultValue={member.phone || ""} /></label>
          <label>Adresse<input name="streetAddress" defaultValue={member.streetAddress || ""} /></label>
          <label className="workspace-check"><input name="isTeacher" type="checkbox" defaultChecked={member.isTeacher} /> Jeg underviser eller behandler i Hjerterum</label>
          <button className="pill-button dark">Gem oplysninger</button>
          {message && <p className="workspace-message" role="status">{message}</p>}
        </form>
      )}
    </section>
  );
}

export function MemberWorkspace({
  clerk,
  user,
  path
}: {
  clerk: ClerkBrowser;
  user: ClerkUser;
  path: string;
}) {
  const [member, setMember] = useState<Member | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [publicBookings, setPublicBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadBookings() {
    const response = await apiFetch(clerk, "/api/room-bookings");
    if (response.ok) setBookings(await response.json() as Booking[]);
  }

  useEffect(() => {
    let active = true;
    void Promise.all([
      apiFetch(clerk, "/api/members/me"),
      apiFetch(clerk, "/api/room-bookings"),
      fetch("/api/room-bookings/public")
    ]).then(async ([memberResponse, bookingResponse, publicResponse]) => {
      if (!active) return;
      if (memberResponse.ok) setMember(await memberResponse.json() as Member);
      if (bookingResponse.ok) setBookings(await bookingResponse.json() as Booking[]);
      if (publicResponse.ok) setPublicBookings(await publicResponse.json() as Booking[]);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [clerk, user.id]);

  const normalized = path.replace(/\/+$/, "") || "/member-portal";
  return (
    <main className="workspace-shell">
      <WorkspaceHeader clerk={clerk} mode="member" path={path} />
      {loading ? <section className="workspace-loading">Henter dit medlemsområde …</section> :
        normalized === "/member-portal/events" ? (
          <MemberEvents clerk={clerk} member={member} bookings={bookings} reload={loadBookings} />
        ) : normalized === "/member-portal/profil" || normalized === "/member-portal/kontakt" ? (
          normalized === "/member-portal/profil" ? <MemberProfile clerk={clerk} member={member} onSaved={setMember} /> :
          <section className="workspace-section workspace-narrow"><p className="kicker">Kontakt</p><h1>Vi er her.</h1><div className="workspace-card"><p>Spørgsmål om huset, medlemskab eller et event?</p><a className="text-link" href="mailto:team@holistisk.org">team@holistisk.org →</a><p>Mejlgade 26B, 8000 Aarhus C</p></div></section>
        ) : normalized === "/member-portal/kalender" ? (
          <section className="workspace-section"><p className="kicker">Kalender</p><h1>Det sker i huset</h1><div className="workspace-list workspace-calendar">{publicBookings.length ? publicBookings.map((booking) => <article key={booking.id}><time>{formatDate(booking.startsAt)}</time><strong>{booking.title}</strong><span>{booking.teacherName}</span></article>) : <p>Der er ingen kommende events i kalenderen.</p>}</div></section>
        ) : <MemberOverview member={member} bookings={bookings} />}
    </main>
  );
}

export function AdminWorkspace({
  clerk,
  path
}: {
  clerk: ClerkBrowser;
  user: ClerkUser;
  path: string;
}) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [members, setMembers] = useState<AdminMember[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [error, setError] = useState("");
  const normalized = path.replace(/\/+$/, "") || "/admin";

  useEffect(() => {
    let active = true;
    void Promise.all([
      apiFetch(clerk, "/api/admin/overview"),
      apiFetch(clerk, "/api/admin/members"),
      apiFetch(clerk, "/api/admin/room-bookings"),
      apiFetch(clerk, "/api/teachers")
    ]).then(async (responses) => {
      if (!active) return;
      const forbidden = responses.some((response) => response.status === 403);
      if (forbidden) {
        setError("Du har ikke adgang til administrationen.");
        return;
      }
      if (responses.some((response) => !response.ok)) {
        setError("Administrationen kunne ikke indlæses.");
        return;
      }
      setOverview(await responses[0].json() as AdminOverview);
      setMembers(await responses[1].json() as AdminMember[]);
      setBookings(await responses[2].json() as Booking[]);
      setTeachers(await responses[3].json() as Teacher[]);
    }).catch(() => active && setError("Administrationen kunne ikke indlæses."));
    return () => { active = false; };
  }, [clerk]);

  return (
    <main className="workspace-shell admin-workspace">
      <WorkspaceHeader clerk={clerk} mode="admin" path={path} />
      {error ? <section className="workspace-section workspace-narrow"><h1>Adgang kræves</h1><div className="workspace-card"><p>{error}</p><a className="text-link" href="/">Tilbage til Hjerterum →</a></div></section> :
        !overview ? <section className="workspace-loading">Henter administrationen …</section> :
        normalized === "/admin/members" ? (
          <AdminTable title="Medlemmer" kicker="Administration" headings={["Navn", "Medlemskab", "Status", "Kontakt"]} rows={members.map((member) => [member.fullName, member.tier + " · " + (member.interval === "year" ? "årligt" : "månedligt"), <Status value={member.status} />, member.email])} />
        ) : normalized === "/admin/bookings" ? (
          <AdminTable title="Events og reservationer" kicker="Administration" headings={["Event", "Tid", "Arrangør", "Deltagere", "Leje"]} rows={bookings.map((booking) => [booking.title, formatDate(booking.startsAt), booking.teacherName, String(booking.attendeeCount || 0) + (booking.maxAttendees ? " / " + booking.maxAttendees : ""), booking.feeKr.toLocaleString("da-DK") + " kr."])} />
        ) : normalized === "/admin/teachers" ? (
          <AdminTable title="Undervisere" kicker="Administration" headings={["Navn", "Kontakt", "Kortstatus"]} rows={teachers.map((teacher) => [teacher.name, teacher.email || teacher.phone || "—", <Status value={teacher.card_status} />])} />
        ) : (
          <section className="workspace-section">
            <p className="kicker">Administration</p><h1>Overblik</h1>
            <div className="metric-grid">
              <article><strong>{overview.totals.activeMembers}</strong><span>aktive medlemmer</span></article>
              <article><strong>{overview.totals.members}</strong><span>medlemmer i alt</span></article>
              <article><strong>{overview.totals.upcomingBookings}</strong><span>kommende events</span></article>
              <article><strong>{overview.totals.teachers}</strong><span>undervisere</span></article>
            </div>
            <div className="workspace-two-column">
              <div className="workspace-card"><h2>Næste events</h2><div className="workspace-list">{overview.upcomingBookings.map((booking) => <article key={booking.id}><time>{formatDate(booking.startsAt)}</time><strong>{booking.title}</strong><span>{booking.teacherName}</span></article>)}</div></div>
              <div className="workspace-card"><h2>Nye medlemmer</h2><div className="workspace-list">{overview.recentMembers.map((member) => <article key={member.id}><strong>{member.fullName}</strong><span>{member.email}</span><Status value={member.status} /></article>)}</div></div>
            </div>
          </section>
        )}
    </main>
  );
}

function AdminTable({
  title,
  kicker,
  headings,
  rows
}: {
  title: string;
  kicker: string;
  headings: string[];
  rows: Array<Array<ReactNode>>;
}) {
  return (
    <section className="workspace-section">
      <p className="kicker">{kicker}</p><h1>{title}</h1>
      <div className="workspace-table-wrap">
        <table className="workspace-table">
          <thead><tr>{headings.map((heading) => <th key={heading}>{heading}</th>)}</tr></thead>
          <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}
