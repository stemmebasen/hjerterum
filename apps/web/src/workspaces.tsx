import { includesMemberBenefits, membershipName, membershipPlan, membershipPrice } from "../membership";
import { MembershipPlans } from "./membership-plans";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { apiFetch, type ClerkBrowser, type ClerkUser } from "./clerk";
import { MembershipAdmin } from "./membership-admin";

const membershipPlansSupportText = membershipPlan("support")!.description;

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
  source?: "hjerterum" | "membershipworks";
  managedExternally?: boolean;
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
  isAttending?: boolean;
  isOwner?: boolean;
  feeKr: number;
  ticketPriceKr: number;
  handlingFeeKr?: number;
  registrationStatus?: "pending" | "confirmed" | "cancelled" | null;
  status?: string;
};

type ExternalEvent = {
  id: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  host: string | null;
  location: string | null;
  link: string | null;
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
  accessBlocked: boolean;
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
    externalMembers: number;
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
  const memberLinks: Array<readonly [string, string]> = [
    ["/member-portal/", "Overblik"],
    ["/member-portal/medlemskab", "Medlemskab"],
    ["/member-portal/events", "Mine events"],
    ["/member-portal/kalender", "Kalender"],
    ["/member-portal/profil", "Profil"],
    ["/member-portal/kontakt", "Kontakt"]
  ];
  const adminLinks: Array<readonly [string, string]> = [
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
        {links.map(([href, label]) => {
          const isMemberOverview = href === "/member-portal/" && path === "/member-portal/dashboard";
          return (
          <a key={href} href={href} aria-current={path === href || (href.endsWith("/") && path === href.slice(0, -1)) || isMemberOverview ? "page" : undefined}>
            {label}
          </a>
          );
        })}
      </nav>
      <UserButton clerk={clerk} />
    </header>
  );
}

function Status({ value }: { value: string }) {
  const active = value === "active" || value === "card_saved";
  return <span className={"workspace-status " + (active ? "is-active" : "")}>{active ? "Aktiv" : value.replaceAll("_", " ")}</span>;
}

function MemberOverview({ member, calendar }: { member: Member | null; calendar: Booking[] }) {
  const registrations = calendar.filter((booking) => booking.isAttending);
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
          {member && (
            <>
              <Status value={member.status} />
              <h2>{membershipName(member.tier)}</h2>
              <p>{member.managedExternally ? "Eksisterende medlemskab via MembershipWorks" : member.interval === "year" ? "Årlig betaling" : "Månedlig betaling"}</p>
              {member.managedExternally
                ? <span className="workspace-note">Dit eksisterende medlemskab fortsætter uændret.</span>
                : <a className="text-link" href="/member-portal/medlemskab">Betaling og medlemskab →</a>}
            </>
          )}
        </article>
        <article className="workspace-card">
          <p className="kicker">Næste tilmelding</p>
          {registrations[0] ? (
            <>
              <time>{formatDate(registrations[0].startsAt)}</time>
              <h2>{registrations[0].title}</h2>
              <a className="text-link" href="/member-portal/kalender">Se dine tilmeldinger →</a>
            </>
          ) : (
            <>
              <h2>Din kalender er åben</h2>
              <p>Du er ikke tilmeldt et kommende event.</p>
              <a className="text-link" href="/member-portal/kalender">Se kalenderen →</a>
            </>
          )}
        </article>
      </div>
    </>
  );
}

function localDateTimeInput(value: string): string {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
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
  const [editing, setEditing] = useState<Booking | null>(null);
  const [payout, setPayout] = useState<{
    configured: boolean;
    account: { status: string; chargesEnabled: boolean; payoutsEnabled: boolean } | null;
  } | null>(null);
  const active = member?.status === "active" && includesMemberBenefits(member.tier);

  useEffect(() => {
    let mounted = true;
    void apiFetch(clerk, "/api/members/payout-account").then(async (response) => {
      if (mounted && response.ok) setPayout(await response.json());
    });
    return () => { mounted = false; };
  }, [clerk]);

  async function startPayoutOnboarding() {
    setSaving(true);
    setMessage("");
    try {
      const response = await apiFetch(clerk, "/api/members/payout-account/onboarding", {
        method: "POST"
      });
      const body = await response.json().catch(() => ({})) as {
        onboardingUrl?: string; error?: string;
      };
      if (!response.ok || !body.onboardingUrl) throw new Error(body.error || "onboarding_failed");
      window.location.assign(body.onboardingUrl);
    } catch {
      setMessage("Stripe-opsætningen kunne ikke startes.");
      setSaving(false);
    }
  }

  async function saveEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!member) return;
    setSaving(true);
    setMessage("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const response = await apiFetch(
        clerk,
        editing ? "/api/room-bookings/" + editing.id : "/api/room-bookings",
        {
          method: editing ? "PUT" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            teacherName: member.fullName,
            teacherEmail: member.email,
            title: String(form.get("title") || ""),
            description: String(form.get("description") || ""),
            startsAt: new Date(String(form.get("startsAt"))).toISOString(),
            endsAt: new Date(String(form.get("endsAt"))).toISOString(),
            maxAttendees: Number(form.get("maxAttendees")) || null,
            ticketPriceKr: Number(form.get("ticketPriceKr")) || 0
          })
        }
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string; checkoutUrl?: string };
        throw new Error(body.error || "event_save_failed");
      }
      formElement.reset();
      setEditing(null);
      setMessage(editing ? "Ændringerne er gemt." : "Eventet er oprettet og salen reserveret.");
      await reload();
    } catch (error) {
      const code = error instanceof Error ? error.message : "event_save_failed";
      setMessage(
        code === "booking_conflict" ? "Tidsrummet er allerede optaget." :
        code === "payout_onboarding_required" ? "Klargør udbetaling med Stripe, før du opretter et betalt event." :
        code === "booking_has_registrations" ? "Prisen kan ikke ændres, når eventet har tilmeldinger." :
        "Eventet kunne ikke gemmes. Tjek tiderne og prøv igen."
      );
    } finally {
      setSaving(false);
    }
  }

  async function cancelEvent(booking: Booking) {
    if (!window.confirm("Vil du annullere “" + booking.title + "”? Tilmeldingerne bevares i historikken, og betalte billetter refunderes ikke automatisk.")) return;
    setMessage("");
    const response = await apiFetch(clerk, "/api/room-bookings/" + booking.id, { method: "DELETE" });
    if (!response.ok) {
      setMessage("Eventet kunne ikke annulleres.");
      return;
    }
    if (editing?.id === booking.id) setEditing(null);
    setMessage("Eventet er annulleret.");
    await reload();
  }

  return (
    <section className="workspace-section">
      <div className="workspace-title-row">
        <div><p className="kicker">Events</p><h1>Mine events</h1></div>
      </div>
      <div className="workspace-two-column">
        <div className="workspace-card">
          <h2>{editing ? "Redigér event" : "Opret event og reservér salen"}</h2>
          {!active ? (
            <p>Du skal have et aktivt betalende medlemskab for at oprette et event.</p>
          ) : (
            <>
            <div className="workspace-message">
              <strong>Udbetaling fra betalte events</strong>
              <p>{!payout?.configured
                ? "Stripe er endnu ikke aktiveret på platformen."
                : payout.account?.chargesEnabled && payout.account?.payoutsEnabled
                  ? "Stripe er klar til at modtage betalinger og udbetale dine billetindtægter."
                  : "Klargør din Stripe-konto, hvis du vil tage betaling for events."}</p>
              {payout?.configured && !(payout.account?.chargesEnabled && payout.account?.payoutsEnabled) &&
                <button type="button" className="pill-button subtle" disabled={saving}
                  onClick={() => void startPayoutOnboarding()}>Klargør udbetaling med Stripe</button>}
            </div>
            <form className="workspace-form" onSubmit={saveEvent} key={editing?.id ?? "new"}>
              <label>Titel<input name="title" defaultValue={editing?.title ?? ""} required /></label>
              <label>Beskrivelse<textarea name="description" rows={4} defaultValue={editing?.description ?? ""} /></label>
              <div className="workspace-form-row">
                <label>Starter<input name="startsAt" type="datetime-local" defaultValue={editing ? localDateTimeInput(editing.startsAt) : ""} required /></label>
                <label>Slutter<input name="endsAt" type="datetime-local" defaultValue={editing ? localDateTimeInput(editing.endsAt) : ""} required /></label>
              </div>
              <div className="workspace-form-row">
                <label>Maks. deltagere<input name="maxAttendees" type="number" min="1" defaultValue={editing?.maxAttendees ?? ""} /></label>
                <label>Billetpris pr. deltager
                  <input name="ticketPriceKr" type="number" min="0" step="0.01" defaultValue={editing?.ticketPriceKr ?? 0} />
                  <small>0 kr. betyder gratis. Håndteringsgebyret lægges oveni ved betaling.</small>
                </label>
              </div>
              <div className="workspace-actions">
                <button className="pill-button dark" disabled={saving}>{saving ? "Gemmer …" : editing ? "Gem ændringer" : "Opret event"}</button>
                {editing && <button type="button" className="text-button" onClick={() => setEditing(null)}>Annullér redigering</button>}
              </div>
              {message && <p className="workspace-message" role="status">{message}</p>}
            </form>
            </>
          )}
        </div>
        <div className="workspace-card">
          <h2>Kommende events</h2>
          {bookings.length ? (
            <div className="workspace-list">
              {bookings.map((booking) => (
                <article key={booking.id}>
                  <time>{formatDate(booking.startsAt)}</time>
                  <strong>{booking.title}</strong>
                  <span>{booking.attendeeCount ?? 0}{booking.maxAttendees ? " / " + booking.maxAttendees : ""} tilmeldte · {booking.feeKr.toLocaleString("da-DK")} kr. i lokaleleje · {booking.ticketPriceKr > 0 ? booking.ticketPriceKr.toLocaleString("da-DK") + " kr. pr. billet" : "Gratis adgang"}</span>
                  <div className="workspace-actions">
                    <button type="button" className="text-button" onClick={() => setEditing(booking)}>Redigér</button>
                    <button type="button" className="text-button is-danger" onClick={() => void cancelEvent(booking)}>Annullér event</button>
                  </div>
                </article>
              ))}
            </div>
          ) : <p>Du har ingen kommende events.</p>}
        </div>
      </div>
    </section>
  );
}

function MemberCalendar({
  clerk,
  bookings,
  externalEvents,
  reload
}: {
  clerk: ClerkBrowser;
  bookings: Booking[];
  externalEvents: ExternalEvent[];
  reload: () => Promise<void>;
}) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [message, setMessage] = useState(() => {
    const payment = new URLSearchParams(window.location.search).get("payment");
    return payment === "success" ? "Tak. Din tilmelding bekræftes, så snart Stripe har registreret betalingen." :
      payment === "cancelled" ? "Betalingen blev afbrudt, og pladsen frigives automatisk." : "";
  });

  async function toggleAttendance(booking: Booking) {
    if (booking.isAttending && booking.ticketPriceKr > 0 &&
        !window.confirm("Vil du afmelde dig? En betalt billet refunderes ikke automatisk.")) return;
    setBusyId(booking.id);
    setMessage("");
    const response = await apiFetch(clerk, "/api/room-bookings/" + booking.id + "/attend", {
      method: booking.isAttending ? "DELETE" : "POST"
    });
    const body = await response.json().catch(() => ({})) as { error?: string; checkoutUrl?: string };
    if (!response.ok) {
      setMessage(body.error === "booking_full" ? "Eventet er desværre fyldt." : "Tilmeldingen kunne ikke ændres.");
    } else if (body.checkoutUrl) {
      window.location.assign(body.checkoutUrl);
      return;
    } else {
      setMessage(booking.isAttending ? "Du er nu afmeldt." : "Du er nu tilmeldt.");
      await reload();
    }
    setBusyId(null);
  }

  return (
    <section className="workspace-section">
      <p className="kicker">Kalender</p>
      <h1>Det sker i huset</h1>
      {message && <p className="workspace-message" role="status">{message}</p>}
      <div className="workspace-list workspace-calendar">
        {bookings.length ? bookings.map((booking) => {
          const full = booking.maxAttendees !== null && (booking.attendeeCount ?? 0) >= booking.maxAttendees;
          return (
            <article key={booking.id}>
              <time>{formatDate(booking.startsAt)}</time>
              <strong>{booking.title}</strong>
              <span>{booking.teacherName} · {booking.attendeeCount ?? 0}{booking.maxAttendees ? " / " + booking.maxAttendees : ""} tilmeldte · {booking.ticketPriceKr > 0 ? (booking.ticketPriceKr + (booking.handlingFeeKr ?? 0)).toLocaleString("da-DK") + " kr. inkl. " + (booking.handlingFeeKr ?? 0).toLocaleString("da-DK") + " kr. gebyr" : "Gratis"}</span>
              {booking.description && <p>{booking.description}</p>}
              {booking.isOwner ? (
                <a className="text-link" href="/member-portal/events">Administrér dit event →</a>
              ) : (
                <button
                  type="button"
                  className={booking.isAttending ? "pill-button subtle" : "pill-button dark"}
                  disabled={busyId === booking.id || booking.registrationStatus === "pending" || (!booking.isAttending && full)}
                  onClick={() => void toggleAttendance(booking)}
                >
                  {busyId === booking.id ? "Arbejder …" : booking.registrationStatus === "pending" ? "Betaling afventer" : booking.isAttending ? "Afmeld" : full ? "Fuldt booket" : booking.ticketPriceKr > 0 ? "Tilmeld og betal" : "Tilmeld"}
                </button>
              )}
            </article>
          );
        }) : <p>Der er ingen kommende Hjerterum-events i kalenderen.</p>}
      </div>
      {externalEvents.length > 0 && (
        <>
          <h2 className="membership-list-title">Øvrige events i Hjerterum</h2>
          <div className="workspace-list workspace-calendar">
            {externalEvents.map((event) => (
              <article key={event.id}>
                <time>{formatDate(event.startsAt)}</time>
                <strong>{event.title}</strong>
                <span>{[event.host, event.location].filter(Boolean).join(" · ")}</span>
                {event.description && <p>{event.description}</p>}
                {event.link && <a className="text-link" href={event.link} target="_blank" rel="noreferrer">Læs mere og tilmeld →</a>}
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

type MemberInvoice = {
  id: string;
  status: string | null;
  amountPaidMinor: number;
  amountDueMinor: number;
  currency: string;
  createdAt: string;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
};

function MemberBilling({ clerk, member }: { clerk: ClerkBrowser; member: Member | null }) {
  const [invoices, setInvoices] = useState<MemberInvoice[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [billingState, setBillingState] = useState<"loading" | "ready" | "unavailable" | "error">("loading");

  useEffect(() => {
    if (!member || member.managedExternally) return;
    let active = true;
    setBillingState("loading");
    setInvoices([]);
    void (async () => {
      try {
        const response = await apiFetch(clerk, "/api/members/me/payments");
        if (response.ok) {
          const result = await response.json() as MemberInvoice[];
          if (active) {
            setInvoices(result);
            setBillingState("ready");
          }
        } else {
          const result = await response.json().catch(() => ({})) as { error?: string };
          if (active) setBillingState(result.error === "payments_not_configured" ? "unavailable" : "error");
        }
      } catch {
        if (active) setBillingState("error");
      }
    })();
    return () => { active = false; };
  }, [clerk, member?.id, member?.managedExternally]);

  async function openPortal() {
    setBusy(true);
    setMessage("");
    const response = await apiFetch(clerk, "/api/members/portal-url");
    const body = await response.json().catch(() => ({})) as { portalUrl?: string };
    if (response.ok && body.portalUrl) {
      window.location.assign(body.portalUrl);
      return;
    }
    setMessage("Betalingsadministrationen er ikke tilgængelig endnu.");
    setBusy(false);
  }

  async function cancelMembership() {
    if (!window.confirm("Vil du opsige medlemskabet ved udgangen af den nuværende betalingsperiode?")) return;
    setBusy(true);
    setMessage("");
    const response = await apiFetch(clerk, "/api/members/me/cancel", { method: "POST" });
    setMessage(response.ok
      ? "Opsigelsen er registreret. Medlemskabet fortsætter til periodens udløb."
      : "Opsigelsen kunne ikke gennemføres.");
    setBusy(false);
  }

  if (member?.managedExternally) {
    return (
      <section className="workspace-section workspace-narrow">
        <p className="kicker">Medlemskab</p>
        <h1>Dit medlemskab</h1>
        <div className="workspace-card">
          <Status value={member.status} />
          <h2>{membershipName(member.tier)}</h2>
          <p>{membershipPlan(member.tier)?.description}</p>
          <p>Dit nuværende medlemskab og din betaling fortsætter uændret i MembershipWorks.</p>
          <a className="text-link" href="mailto:team@holistisk.org">Kontakt os om medlemskabet →</a>
        </div>
        <MembershipPlans />
      </section>
    );
  }

  return (
    <section className="workspace-section workspace-narrow">
      <p className="kicker">Medlemskab</p>
      <h1>Betaling og medlemskab</h1>
      <div className="workspace-card">
        <Status value={member?.status ?? "unknown"} />
        <h2>{membershipName(member?.tier ?? "")}</h2>
        <p>{membershipPlan(member?.tier ?? "")?.description}</p>
        {member && membershipPlan(member.tier) && <p>{membershipPrice(membershipPlan(member.tier)![member.interval === "year" ? "year" : "month"])} {member.interval === "year" ? "pr. år" : "pr. måned"}</p>}
        <p>{member?.interval === "year" ? "Årlig betaling" : "Månedlig betaling"}</p>
        {billingState === "ready" ? (
        <div className="workspace-actions">
          <button type="button" className="pill-button dark" disabled={busy} onClick={() => void openPortal()}>Administrér betaling</button>
          <button type="button" className="text-button is-danger" disabled={busy} onClick={() => void cancelMembership()}>Opsig medlemskab</button>
        </div>
        ) : <p role="status">{billingState === "loading"
          ? "Henter betalingsoplysninger …"
          : billingState === "unavailable"
            ? "Betaling er endnu ikke aktiveret. Du kan derfor ikke administrere betaling eller opsige et abonnement her endnu."
            : "Betalingsoplysningerne kunne ikke hentes. Prøv at genindlæse siden, eller kontakt os."}</p>}
        {message && <p className="workspace-message" role="status">{message}</p>}
      </div>
      <div className="workspace-card">
        <h2>Betalingshistorik</h2>
        {billingState !== "ready" ? <p>{billingState === "loading" ? "Henter betalingshistorik …" : billingState === "unavailable" ? "Betalingshistorik bliver tilgængelig, når betaling er aktiveret." : "Betalingshistorikken kunne ikke hentes."}</p> : invoices.length ? (
          <div className="workspace-list">
            {invoices.map((invoice) => (
              <article key={invoice.id}>
                <time>{new Date(invoice.createdAt).toLocaleDateString("da-DK")}</time>
                <strong>{(invoice.amountPaidMinor / 100).toLocaleString("da-DK")} {invoice.currency.toUpperCase()}</strong>
                <span>{invoice.status ?? "Ukendt status"}</span>
                {(invoice.hostedInvoiceUrl || invoice.invoicePdf) && <a className="text-link" href={invoice.hostedInvoiceUrl || invoice.invoicePdf || "#"} target="_blank" rel="noreferrer">Åbn faktura →</a>}
              </article>
            ))}
          </div>
        ) : <p>Der er ingen fakturaer at vise endnu.</p>}
      </div>
      <MembershipPlans />
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
        streetAddress: String(form.get("streetAddress") || "")
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

  if (member?.managedExternally) {
    return (
      <section className="workspace-section workspace-narrow">
        <p className="kicker">Profil</p>
        <h1>Dine oplysninger</h1>
        <div className="workspace-card">
          <h2>{member.fullName}</h2>
          <p>{member.email}</p>
          <p>Dit medlemskab administreres fortsat i MembershipWorks og ændres ikke her.</p>
        </div>
      </section>
    );
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
  const [calendar, setCalendar] = useState<Booking[]>([]);
  const [externalEvents, setExternalEvents] = useState<ExternalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessError, setAccessError] = useState("");

  async function loadCalendar() {
    const response = await apiFetch(clerk, "/api/room-bookings/calendar");
    if (response.ok) setCalendar(await response.json() as Booking[]);
  }

  useEffect(() => {
    let active = true;
    void apiFetch(clerk, "/api/members/me").then(async (memberResponse) => {
      if (!active) return;
      if (memberResponse.ok) {
        const loadedMember = await memberResponse.json() as Member;
        setMember(loadedMember);
        if (!includesMemberBenefits(loadedMember.tier)) return;
        const [calendarResponse, externalResponse] = await Promise.all([
          apiFetch(clerk, "/api/room-bookings/calendar"),
          fetch("/api/events/external")
        ]);
        if (active && calendarResponse.ok) setCalendar(await calendarResponse.json() as Booking[]);
        if (active && externalResponse.ok) setExternalEvents(await externalResponse.json() as ExternalEvent[]);
      } else if (memberResponse.status === 403) {
        setAccessError("Der er ikke knyttet et aktivt medlemskab til din verificerede e-mail.");
      } else {
        setAccessError("Medlemsområdet kunne ikke indlæses.");
      }
    }).catch(() => {
      if (active) setAccessError("Medlemsområdet kunne ikke indlæses.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [clerk, user.id]);

  const normalized = path.replace(/\/+$/, "") || "/member-portal";
  const ownedBookings = calendar.filter((booking) => booking.isOwner);
  return (
    <main className="workspace-shell">
      <WorkspaceHeader clerk={clerk} mode="member" path={path} />
      {loading ? <section className="workspace-loading">Henter dit medlemsområde …</section> :
        accessError ? <section className="workspace-section workspace-narrow"><p className="kicker">Medlemsområde</p><h1>Medlemskab kræves</h1><div className="workspace-card"><p>{accessError}</p><a className="text-link" href="mailto:team@holistisk.org">Kontakt Hjerterum →</a></div></section> :
        normalized === "/member-portal/medlemskab" ? (
          <MemberBilling clerk={clerk} member={member} />
        ) : !includesMemberBenefits(member?.tier ?? null) && (normalized === "/member-portal/events" || normalized === "/member-portal/kalender") ? (
          <section className="workspace-section workspace-narrow"><h1>Support medlemskab</h1><p>{membershipPlansSupportText}</p></section>
        ) : normalized === "/member-portal/events" ? (
          <MemberEvents clerk={clerk} member={member} bookings={ownedBookings} reload={loadCalendar} />
        ) : normalized === "/member-portal/profil" || normalized === "/member-portal/kontakt" ? (
          normalized === "/member-portal/profil" ? <MemberProfile clerk={clerk} member={member} onSaved={setMember} /> :
          <section className="workspace-section workspace-narrow"><p className="kicker">Kontakt</p><h1>Vi er her.</h1><div className="workspace-card"><p>Spørgsmål om huset, medlemskab eller et event?</p><a className="text-link" href="mailto:team@holistisk.org">team@holistisk.org →</a><p>Mejlgade 26B, 8000 Aarhus C</p></div></section>
        ) : normalized === "/member-portal/kalender" ? (
          <MemberCalendar clerk={clerk} bookings={calendar} externalEvents={externalEvents} reload={loadCalendar} />
        ) : <MemberOverview member={member} calendar={calendar} />}
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
  const [paymentSettings, setPaymentSettings] = useState({ handlingFeeMinor: 0, platformFeePercent: 5 });
  const [error, setError] = useState("");
  const normalized = path.replace(/\/+$/, "") || "/admin";

  useEffect(() => {
    let active = true;
    void Promise.all([
      apiFetch(clerk, "/api/admin/overview"),
      apiFetch(clerk, "/api/admin/members"),
      apiFetch(clerk, "/api/admin/room-bookings"),
      apiFetch(clerk, "/api/teachers"),
      apiFetch(clerk, "/api/admin/event-payment-settings")
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
      setPaymentSettings(await responses[4].json() as { handlingFeeMinor: number; platformFeePercent: number });
    }).catch(() => active && setError("Administrationen kunne ikke indlæses."));
    return () => { active = false; };
  }, [clerk]);

  async function savePaymentSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const handlingFeeMinor = Math.round(Number(form.get("handlingFeeKr")) * 100);
    const response = await apiFetch(clerk, "/api/admin/event-payment-settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handlingFeeMinor })
    });
    if (!response.ok) {
      setError("Håndteringsgebyret kunne ikke gemmes.");
      return;
    }
    setPaymentSettings(await response.json());
  }

  async function cancelAdminBooking(booking: Booking) {
    if (!window.confirm("Vil du annullere “" + booking.title + "”? Betalte billetter refunderes ikke automatisk.")) return;
    const response = await apiFetch(clerk, "/api/admin/room-bookings/" + booking.id, { method: "DELETE" });
    if (!response.ok) {
      setError("Eventet kunne ikke annulleres.");
      return;
    }
    setBookings((current) => current.map((item) =>
      item.id === booking.id ? { ...item, status: "cancelled" } : item
    ));
  }

  return (
    <main className="workspace-shell admin-workspace">
      <WorkspaceHeader clerk={clerk} mode="admin" path={path} />
      {error ? <section className="workspace-section workspace-narrow"><h1>Adgang kræves</h1><div className="workspace-card"><p>{error}</p><a className="text-link" href="/">Tilbage til Hjerterum →</a></div></section> :
        !overview ? <section className="workspace-loading">Henter administrationen …</section> :
        normalized === "/admin/members" ? (
          <MembershipAdmin clerk={clerk} members={members} />
        ) : normalized === "/admin/bookings" ? (
          <section className="workspace-section">
            <p className="kicker">Administration</p>
            <h1>Events og reservationer</h1>
            <div className="workspace-card">
              <h2>Betaling</h2>
              <p>Hjerterum modtager {paymentSettings.platformFeePercent} % af billetprisen samt dette gebyr pr. transaktion.</p>
              <form className="workspace-form" onSubmit={savePaymentSettings}>
                <label>Håndteringsgebyr
                  <input name="handlingFeeKr" type="number" min="0" step="0.01"
                    defaultValue={paymentSettings.handlingFeeMinor / 100} />
                </label>
                <button className="pill-button dark">Gem gebyr</button>
              </form>
            </div>
            <div className="workspace-table-wrap">
              <table className="workspace-table">
                <thead><tr><th>Event</th><th>Tid</th><th>Arrangør</th><th>Deltagere</th><th>Billet</th><th>Leje</th><th>Status</th><th>Handling</th></tr></thead>
                <tbody>{bookings.map((booking) => (
                  <tr key={booking.id}>
                    <td>{booking.title}</td>
                    <td>{formatDate(booking.startsAt)}</td>
                    <td>{booking.teacherName}</td>
                    <td>{String(booking.attendeeCount || 0) + (booking.maxAttendees ? " / " + booking.maxAttendees : "")}</td>
                    <td>{booking.ticketPriceKr > 0 ? booking.ticketPriceKr.toLocaleString("da-DK") + " kr." : "Gratis"}</td>
                    <td>{booking.feeKr.toLocaleString("da-DK")} kr.</td>
                    <td>{booking.status === "cancelled" ? "Annulleret" : "Planlagt"}</td>
                    <td>{booking.status !== "cancelled" && <button type="button" className="text-button is-danger" onClick={() => void cancelAdminBooking(booking)}>Annullér</button>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </section>
        ) : normalized === "/admin/teachers" ? (
          <AdminTable title="Undervisere" kicker="Administration" headings={["Navn", "Kontakt", "Kortstatus"]} rows={teachers.map((teacher) => [teacher.name, teacher.email || teacher.phone || "—", <Status value={teacher.card_status} />])} />
        ) : (
          <section className="workspace-section">
            <p className="kicker">Administration</p><h1>Overblik</h1>
            <div className="metric-grid">
              <article><strong>{overview.totals.activeMembers}</strong><span>aktive medlemmer</span></article>
              <article><strong>{overview.totals.members}</strong><span>medlemmer i alt</span><small>{overview.totals.externalMembers} fra MembershipWorks</small></article>
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
