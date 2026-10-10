import { EventCard, calendarMonth } from "./event-card";
import { includesMemberBenefits, membershipName, membershipPlan, membershipPrice } from "../membership";
import { MembershipPlans } from "./membership-plans";
import { EventPlanner } from "./event-planner";
import { AuthImage, EventFilesField, FileLinks, fileProblems, uploadEventFiles, type EventFile } from "./event-files";
import { planFromBooking, planInstants, todayKey, DEFAULT_BUFFER, PROBLEM_TEXT, type Plan } from "./event-planner-logic";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { apiFetch, type ClerkBrowser, type ClerkUser } from "./clerk";
import { MembershipAdmin } from "./membership-admin";
import { ProfileFeatures } from "./profile-features";
import { CirklerCard } from "./cirkler-card";
import { ProgramGuide } from "./program-guide";
import { COVER_EVENT, DRAFT_EVENT, SagaWidget, takePendingDraft, type SagaDraft } from "./saga-widget";
import { cropCover } from "./cover-crop";
import { LegalLine } from "./site-pages";
import { isPartnerEvent, PARTNER_HEADING } from "../partner-events";
import { SitePageInner } from "./site-pages";
import { BENEFITS, SITE_PAGES } from "../site/pages";
import { LysArt, LysTop } from "./lys";

const membershipPlansSupportText = membershipPlan("support")!.description;

type Member = {
  id: number;
  tier: string;
  interval: string;
  status: string;
  fullName: string;
  email: string;
  phone: string | null;
  streetAddress: string | null;
  birthday?: string | null;
  isTeacher: boolean;
  source?: "hjerterum" | "membershipworks";
  managedExternally?: boolean;
  /** "manual": given by Hjerterum in admin → Medlemmer, with no card payment (worker/member-admin.ts). */
  billing?: "stripe" | "manual";
  paysInMembershipworks?: boolean;
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
  nonMemberPriceKr?: number | null;
  setupMinutes?: number;
  cleanupMinutes?: number;
  bookingType?: "standard" | "reduced" | "free";
  reviewStatus?: "pending" | "approved" | "needs_board" | "rejected";
  reviewNote?: string | null;
  /** The cover photo's address once the event is approved. */
  imageUrl?: string | null;
  /** The photo and files the member may open: all of the organiser's own, the registered member's event files. */
  files?: EventFile[];
  handlingFeeKr?: number;
  registrationStatus?: "pending" | "confirmed" | "cancelled" | null;
  status?: string;
};

type ExternalEvent = {
  imageUrl?: string | null;
  category?: string | null;
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
    // Requested: "Under Konto kan vi også have medlemsskab-info": a "Medlemskab" link in the account menu and in "Administrer konto".
    const icon = (el: HTMLDivElement) => { el.textContent = "◎"; };
    const membership = { label: "Medlemskab", mountIcon: icon, unmountIcon: () => undefined };
    try {
      clerk.mountUserButton(node, {
        customMenuItems: [{ ...membership, href: "/member-portal/profil#medlemskab" }],
        userProfileProps: { customPages: [{ ...membership, url: "/member-portal/profil#medlemskab" }] }
      });
    } catch {
      clerk.mountUserButton(node);
    }
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
    // Requested: "Mine events -> Opret event".
    ["/member-portal/events", "Opret event"],
    ["/member-portal/kalender", "Kalender"],
    // Requested: "Lad Medlemskab blive knyttet ind under Min profil".
    ["/member-portal/profil", "Min profil"],
    // Requested: one "Om Hjerterum" page, the same here and on the website (site/pages.ts).
    ["/member-portal/kontakt", "Om Hjerterum"]
  ];
  const adminLinks: Array<readonly [string, string]> = [
    ["/admin/", "Overblik"],
    ["/admin/members", "Medlemmer"],
    ["/admin/bookings", "Events"],
    ["/admin/teachers", "Undervisere"]
  ];
  const links = mode === "admin" ? adminLinks : memberLinks;

  return (
    <LysTop right={<UserButton clerk={clerk} />}>
      <nav className="lys-nav" aria-label={mode === "admin" ? "Adminnavigation" : "Medlemsnavigation"}>
        {links.map(([href, label]) => {
          const isMemberOverview = href === "/member-portal/" && path === "/member-portal/dashboard";
          return (
          <a key={href} href={href} aria-current={path === href || (href === "/member-portal/profil" && path.startsWith("/member-portal/medlemskab")) || (href.endsWith("/") && path === href.slice(0, -1)) || isMemberOverview ? "page" : undefined}>
            {label}
          </a>
          );
        })}
      </nav>
    </LysTop>
  );
}

function Status({ value }: { value: string }) {
  const active = value === "active" || value === "card_saved";
  return <span className={"workspace-status " + (active ? "is-active" : "")}>{active ? "Aktiv" : value.replaceAll("_", " ")}</span>;
}

const REVIEW_LABEL: Record<NonNullable<Booking["reviewStatus"]>, [string, string]> = {
  pending: ["Afventer godkendelse", "clay"],
  needs_board: ["Hos bestyrelsen", "clay"],
  approved: ["Godkendt", "sage"],
  rejected: ["Ikke godkendt", "rose"]
};

/** Hjerterum Lys (apps/web/lys.ts), in the website's layout: kicker, a serif headline with its italic line, the text
 * beside it; then the figures and the two lists a member comes for. */
function MemberOverview({ member, calendar, clerk }: { member: Member | null; calendar: Booking[]; clerk: ClerkBrowser }) {
  const registrations = calendar.filter((booking) => booking.isAttending);
  const owned = calendar.filter((booking) => booking.isOwner);
  const awaiting = owned.filter((booking) => booking.reviewStatus === "pending" || booking.reviewStatus === "needs_board").length;
  const benefits = includesMemberBenefits(member?.tier ?? null);
  const firstName = member?.fullName.trim().split(/\s+/)[0];
  // Requested: a fourth box, "Medlemsbesparelse xxx kr. Siden <dato>" (member-savings.ts).
  const [savings, setSavings] = useState<{ savedKr: number; since: string | null } | null>(null);
  useEffect(() => {
    if (!member || !benefits) return;
    let active = true;
    apiFetch(clerk, "/api/members/me/savings").then(async (r) => { if (active && r.ok) setSavings(await r.json()); }).catch(() => undefined);
    return () => { active = false; };
  }, [clerk, member?.id, benefits]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="lys-page member-overview">
      <div className="lys-intro">
        <div>
          <p className="lys-kicker">Dit Hjerterum</p>
          <h1 className="lys-title">{firstName ? "Hej " + firstName + "." : "Velkommen."}<em>Godt at se dig.</em></h1>
        </div>
        <div className="member-overview-side">
          <LysArt size="mini" />
          {/* Requested: the two sentences were "for langt på forsiden" - one short line. */}
          <p>{benefits ? "Dit medlemskab samlet ét sted: events med rabat, dine egne events, CIRKLER og din offentlige profil." : "Dit medlemskab og dine tilmeldinger samlet ét sted."}</p>
        </div>
      </div>
      {member && (
        <div className="lys-tiles">
          <div className="lys-tile"><span>Medlemskab</span><b>{membershipName(member.tier)}</b>
            <small>{member.managedExternally ? "via MembershipWorks" : <>{member.status === "active" || member.status === "card_saved" ? "aktivt" : member.status.replaceAll("_", " ")} · <a href="/member-portal/profil#medlemskab">betaling →</a></>}</small></div>
          {benefits && <div className="lys-tile"><span>Tilmeldt</span><b>{registrations.length}</b>
            <small>{registrations[0] ? "næste: " + formatDate(registrations[0].startsAt) : "ingen kommende"}</small></div>}
          {benefits && <div className="lys-tile"><span>Mine events</span><b>{owned.length}</b>
            <small>{awaiting ? awaiting + " afventer godkendelse" : owned.length ? "alle behandlet" : "ingen endnu"}</small></div>}
          {benefits && savings && <div className="lys-tile"><span>Medlemsbesparelse</span><b>{savings.savedKr.toLocaleString("da-DK")} kr.</b>
            <small>{savings.since ? "siden " + new Date(savings.since + "T12:00:00").toLocaleDateString("da-DK", { day: "numeric", month: "long", year: "numeric" }) : "som medlem"}</small></div>}
        </div>
      )}
      <ProgramGuide />
      <div className="lys-grid">
        {benefits ? (
          <>
            <article className="lys-card">
              <p className="lys-kicker">Kalender</p>
              <h2>Mine tilmeldinger</h2>
              {registrations.length ? (
                <ul className="lys-list">
                  {registrations.slice(0, 4).map((booking) => (
                    <li key={booking.id}><span>{booking.title}<span className="lys-meta">{formatDate(booking.startsAt)}</span></span>
                      {booking.registrationStatus === "pending" ? <span className="lys-chip clay">Afventer</span> : <span className="lys-chip sage">Tilmeldt</span>}</li>
                  ))}
                </ul>
              ) : <p className="lys-sub">Du er ikke tilmeldt et kommende event.</p>}
              <p className="member-overview-more"><a className="lys-link" href="/member-portal/kalender">{registrations.length ? "Se kalenderen og afmeld →" : "Find et event i kalenderen →"}</a></p>
            </article>
            <article className="lys-card sage">
              <p className="lys-kicker">Salen</p>
              <h2>Mine events</h2>
              {owned.length ? (
                <ul className="lys-list">
                  {owned.slice(0, 4).map((booking) => {
                    const [label, tone] = REVIEW_LABEL[booking.reviewStatus ?? "approved"];
                    return <li key={booking.id}><span>{booking.title}<span className="lys-meta">{formatDate(booking.startsAt)}</span></span><span className={"lys-chip " + tone}>{label}</span></li>;
                  })}
                </ul>
              ) : <p className="lys-sub">Som medlem kan du leje salen og lægge dit event i Hjerterums kalender.</p>}
              <p className="member-overview-more"><a className="lys-btn" href="/member-portal/events">{owned.length ? "Administrér dine events" : "Opret et event"}</a></p>
            </article>
            <CirklerCard clerk={clerk} />
          </>
        ) : (
          <>
            <article className="lys-card sage">
              <p className="lys-kicker">Støttemedlem</p>
              <h2>Tak fordi du støtter Hjerterum</h2>
              <p className="lys-sub">{membershipPlansSupportText}</p>
              <p className="lys-sub">{BENEFITS.upgrade}</p>
            </article>
            <article className="lys-card">
              <p className="lys-kicker">Medlemskab</p>
              <h2>{member ? membershipName(member.tier) : "Dit medlemskab"}</h2>
              <p className="lys-sub">{member?.managedExternally ? "Dit eksisterende medlemskab via MembershipWorks fortsætter uændret." : "Betaling, kort og opsigelse finder du samlet ét sted."}</p>
              {!member?.managedExternally && <a className="lys-link" href="/member-portal/profil#medlemskab">Betaling og medlemskab →</a>}
            </article>
          </>
        )}
      </div>
    </section>
  );
}

function localDateTimeInput(value: string): string {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

const EMPTY_PLAN: Plan = { date: "", start: "10:00", end: "12:00", type: "standard", setup: DEFAULT_BUFFER, cleanup: DEFAULT_BUFFER };

function MemberEvents({
  clerk,
  member,
  bookings,
  markedDates,
  reload
}: {
  clerk: ClerkBrowser;
  member: Member | null;
  bookings: Booking[];
  markedDates: Set<string>;
  reload: () => Promise<void>;
}) {
  const [plan, setPlan] = useState<Plan>(EMPTY_PLAN);
  const [cover, setCover] = useState<File | null>(null);
  const [extraFiles, setExtraFiles] = useState<File[]>([]);
  const [planProblemCode, setPlanProblemCode] = useState<string | null>("no_date");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Booking | null>(null);
  // A draft from Saga fills the form (saga-widget.tsx); the member still checks it and presses the button.
  const [prefill, setPrefill] = useState<{ n: number; draft: SagaDraft } | null>(() => { const d = takePendingDraft(); return d ? { n: 1, draft: d } : null; });
  useEffect(() => {
    const take = (event: Event) => { const draft = (event as CustomEvent<SagaDraft>).detail; setEditing(null); setPrefill((p) => ({ n: (p?.n ?? 0) + 1, draft })); };
    window.addEventListener(DRAFT_EVENT, take);
    return () => window.removeEventListener(DRAFT_EVENT, take);
  }, []);
  // A photo Saga approved becomes the cover, cut to 1920 × 1005 like a picked one.
  useEffect(() => {
    const take = async (event: Event) => {
      const cropped = await cropCover((event as CustomEvent<File>).detail);
      if (cropped.ok) setCover(cropped.file); else setMessage(cropped.reason);
    };
    window.addEventListener(COVER_EVENT, take);
    return () => window.removeEventListener(COVER_EVENT, take);
  }, []);
  useEffect(() => {
    if (!prefill) return;
    const d = prefill.draft;
    setPlan({ date: d.date, start: d.start, end: d.end, type: d.booking_type, setup: DEFAULT_BUFFER, cleanup: DEFAULT_BUFFER });
  }, [prefill]);
  const [payout, setPayout] = useState<{
    configured: boolean;
    uploads?: boolean;
    account: { status: string; chargesEnabled: boolean; payoutsEnabled: boolean } | null;
  } | null>(null);
  const active = member?.status === "active" && includesMemberBenefits(member.tier);

  useEffect(() => {
    setPlan(editing ? planFromBooking(editing.startsAt, editing.endsAt, editing.bookingType ?? "standard", editing.setupMinutes ?? 0, editing.cleanupMinutes ?? 0)
      : prefill ? { date: prefill.draft.date, start: prefill.draft.start, end: prefill.draft.end, type: prefill.draft.booking_type, setup: DEFAULT_BUFFER, cleanup: DEFAULT_BUFFER } : EMPTY_PLAN);
    setCover(null);
    setExtraFiles([]);
  }, [editing]);
  // The files already on the event being edited, as the calendar last reported them (so a removal shows at once).
  const existingFiles = editing ? bookings.find((booking) => booking.id === editing.id)?.files ?? [] : [];

  async function removeExistingFile(file: EventFile) {
    if (!editing || !window.confirm("Vil du fjerne “" + file.filename + "” fra eventet?")) return;
    const response = await apiFetch(clerk, `/api/room-bookings/${editing.id}/files/${file.id}`, { method: "DELETE" });
    setMessage(response.ok ? "Filen er fjernet." : "Filen kunne ikke fjernes.");
    if (response.ok) await reload();
  }

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
    const fileIssues = fileProblems(cover, extraFiles, existingFiles.filter((file) => file.kind === "file").length);
    if (fileIssues.length) { setMessage(fileIssues[0]!); setSaving(false); return; }
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
            ...planInstants(plan),
            maxAttendees: Number(form.get("maxAttendees")) || null,
            ticketPriceKr: Number(form.get("ticketPriceKr")) || 0,
            nonMemberPriceKr: String(form.get("nonMemberPriceKr") ?? "").trim() === "" ? null : Number(form.get("nonMemberPriceKr")),
            bookingType: plan.type,
            setupMinutes: plan.setup,
            cleanupMinutes: plan.cleanup
          })
        }
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string; checkoutUrl?: string };
        throw new Error(body.error || "event_save_failed");
      }
      const saved = await response.json().catch(() => ({})) as { id?: number };
      const bookingId = editing ? editing.id : saved.id;
      const uploadProblems = bookingId && (cover || extraFiles.length) ? await uploadEventFiles(clerk, bookingId, cover, extraFiles) : [];
      formElement.reset();
      setPlan(EMPTY_PLAN);
      setCover(null);
      setExtraFiles([]);
      setEditing(null);
      setMessage((editing ? "Ændringerne er gemt. Ændrede events godkendes igen, før de vises offentligt." : "Eventet er oprettet og salen reserveret. Det vises offentligt, når det er godkendt.")
        + (uploadProblems.length ? " Men: " + uploadProblems.join(" ") + " Redigér eventet for at prøve igen." : ""));
      await reload();
    } catch (error) {
      const code = error instanceof Error ? error.message : "event_save_failed";
      setMessage(
        code === "booking_conflict" ? "Tidsrummet er allerede optaget." :
        code === "payout_onboarding_required" ? "Klargør udbetaling med Stripe, før du opretter et betalt event." :
        code === "payments_not_configured" ? "Betalte events kan ikke oprettes endnu, fordi betalingen ikke er koblet til. Sæt billetprisen til 0 kr., så oprettes eventet som gratis." :
        code === "booking_has_registrations" ? "Prisen kan ikke ændres, når eventet har tilmeldinger." :
        code === "invalid_duration_too_short" || code === "invalid_duration_too_long" ? "Salen lejes mindst 2 og højst 10 timer med klargøring og oprydning." :
        code === "invalid_duration_not_half_hours" ? "Bookingen skal gå op i halve timer." :
        code === "invalid_crosses_a_time_boundary" ? "Med medlemsrabat eller gratis leje kan en booking på en hverdag ikke gå hen over kl. 18.30. Læg den helt før eller helt efter - eller book to gange." :
        "Eventet kunne ikke gemmes. Prøv igen om lidt, eller skriv til hjerterum@holistisk.org, hvis det bliver ved."
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
    <section className="workspace-section member-page">
      <div className="workspace-title-row">
        <div><p className="kicker">Events</p><h1>Mine events</h1></div>
      </div>
      <div className="workspace-two-column events-columns">
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
            <form className="workspace-form" onSubmit={saveEvent} key={editing?.id ?? "new-" + (prefill?.n ?? 0)}>
              <label>Titel<input name="title" defaultValue={editing?.title ?? prefill?.draft.title ?? ""} required /></label>
              <label>Beskrivelse<textarea name="description" rows={4} defaultValue={editing?.description ?? prefill?.draft.description ?? ""} /></label>
              <EventPlanner clerk={clerk} plan={plan} onChange={setPlan} markedDates={markedDates}
                ignoreId={editing?.id ?? null} onProblem={setPlanProblemCode} />
              <div className="workspace-form-row event-numbers">
                <label>Maks. deltagere<input name="maxAttendees" type="number" min="1" placeholder="Valgfri" defaultValue={editing?.maxAttendees ?? prefill?.draft.max_attendees ?? ""} /></label>
                <label>Billetpris pr. deltager (kr.)
                  <input name="ticketPriceKr" type="number" min="0" step="0.01" defaultValue={editing?.ticketPriceKr ?? 0} readOnly={payout?.configured === false} />
                  <small>{payout?.configured === false
                    ? "Betalte events kan oprettes, når betalingen er koblet til. Indtil da er billetprisen 0 kr. (gratis)."
                    : "0 kr. betyder gratis. Håndteringsgebyret lægges oveni ved betaling."}</small>
                </label>
                <label>Pris for ikke-medlemmer (kr.)
                  <input name="nonMemberPriceKr" type="number" min="0" step="1" placeholder="Valgfri" defaultValue={editing?.nonMemberPriceKr ?? prefill?.draft.non_member_price_kr ?? ""} />
                  <small>Det, et ikke-medlem betaler. Bruges til at vise medlemmerne, hvad de sparer.</small>
                </label>
              </div>
              <EventFilesField clerk={clerk} enabled={payout?.uploads === true} existing={existingFiles} cover={cover} extra={extraFiles}
                onCover={setCover} onExtra={setExtraFiles} onRemoveExisting={(file) => void removeExistingFile(file)} />
              <div className="workspace-actions">
                <button className="pill-button dark" disabled={saving || planProblemCode !== null} title={planProblemCode && planProblemCode !== "loading" ? PROBLEM_TEXT[planProblemCode as keyof typeof PROBLEM_TEXT] : undefined}>{saving ? "Gemmer …" : editing ? "Gem ændringer" : "Opret event"}</button>
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
                  {booking.files?.find((file) => file.kind === "cover") && <AuthImage clerk={clerk} file={booking.files.find((file) => file.kind === "cover")!} alt="" />}
                  <time>{formatDate(booking.startsAt)}</time>
                  <strong>{booking.title}</strong>
                  <span className="member-event-review">{booking.reviewStatus === "approved" || !booking.reviewStatus ? "Godkendt og offentligt" : booking.reviewStatus === "rejected" ? "Ikke godkendt" + (booking.reviewNote ? ": " + booking.reviewNote : "") : "Afventer godkendelse - vises først offentligt, når det er godkendt"}</span>
                  <span>{booking.attendeeCount ?? 0}{booking.maxAttendees ? " / " + booking.maxAttendees : ""} tilmeldte · {booking.feeKr.toLocaleString("da-DK")} kr. i lokaleleje{booking.bookingType === "reduced" ? " (reduceret pris)" : booking.bookingType === "free" ? " (gratis leje)" : ""} · {booking.ticketPriceKr > 0 ? booking.ticketPriceKr.toLocaleString("da-DK") + " kr. pr. billet" : "Gratis adgang"}</span>
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

  const entries = [
    ...bookings.map(booking => ({ key: "native-" + booking.id, startsAt: booking.startsAt, booking, external: null })),
    ...externalEvents.filter(external => !isPartnerEvent(external)).map(external => ({ key: "external-" + external.id, startsAt: external.startsAt, booking: null, external }))
  ].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const partnerEvents = externalEvents.filter(external => isPartnerEvent(external)).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const months = [...new Set(entries.map(event => calendarMonth(event.startsAt)))];

  return (
    <section className="workspace-section member-page member-calendar-page">
      <div className="calendar-intro"><div><p className="kicker">Kalender</p>
        <h1>Find dit næste pusterum</h1>
        <p>Bevægelse, fordybelse og fællesskab. Se, hvad der sker i Hjerterum.</p>
      </div><a className="pill-button subtle" href="/member-portal/events">Opret dit eget event →</a></div>
      {message && <p className="workspace-message" role="status">{message}</p>}
      {!entries.length && <div className="calendar-empty"><h2>Plads til nye oplevelser</h2><p>Der er ingen kommende events at vise lige nu.</p></div>}
      {months.map(month => <section className="calendar-month" key={month} aria-label={month}>
        <h2>{month}</h2>
        <div className="member-event-grid">
          {entries.filter(entry => calendarMonth(entry.startsAt) === month).map(({ key, booking, external }) => {
            const event = booking ?? external!;
            const full = booking ? booking.maxAttendees !== null && (booking.attendeeCount ?? 0) >= booking.maxAttendees : false;
            return <EventCard key={key} title={event.title} description={event.description} startsAt={event.startsAt} endsAt={event.endsAt}
              host={booking?.teacherName || external?.host || null} location={external?.location || "Hjerterum"}
              imageUrl={booking?.imageUrl || external?.imageUrl || null} category={external?.category} attending={booking?.isAttending} expandDescription={!!booking}>
                  {booking ? <>
                    <p className="member-event-price">{booking.ticketPriceKr > 0 ? (booking.ticketPriceKr + (booking.handlingFeeKr ?? 0)).toLocaleString("da-DK") + " kr. inkl. " + (booking.handlingFeeKr ?? 0).toLocaleString("da-DK") + " kr. gebyr" : "Gratis"}<small>{booking.attendeeCount ?? 0}{booking.maxAttendees ? " / " + booking.maxAttendees : ""} tilmeldte</small></p>
              {booking.files && booking.files.some((file) => file.kind === "file") && <FileLinks clerk={clerk} files={booking.files} />}
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
                  </> : external?.link ? <a className="text-link" href={external.link} target="_blank" rel="noreferrer">Læs mere og tilmeld ↗</a> : <p>Kontakt arrangøren for mere information.</p>}
            </EventCard>;
          })}
        </div>
      </section>)}
      {partnerEvents.length > 0 && <section className="calendar-month partner-events" aria-label={PARTNER_HEADING}>
        <h2>{PARTNER_HEADING}</h2>
        <div className="member-event-grid">
          {partnerEvents.map((external) => <EventCard key={"partner-" + external.id} title={external.title} description={external.description} startsAt={external.startsAt} endsAt={external.endsAt}
            host={external.host || null} location={external.location || null} imageUrl={external.imageUrl || null} category={external.category}>
            {external.link ? <a className="text-link" href={external.link} target="_blank" rel="noreferrer">Læs mere og tilmeld ↗</a> : <p>Kontakt arrangøren for mere information.</p>}
          </EventCard>)}
        </div>
      </section>}
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
  const [subscription, setSubscription] = useState<{ amountMinor: number | null; interval: string | null; nextChargeAt: string | null; cancelAtPeriodEnd: boolean; endsAt: string | null } | null>(null);

  useEffect(() => {
    if (!member || member.managedExternally || member.billing === "manual") return;
    let active = true;
    setBillingState("loading");
    setInvoices([]);
    void (async () => {
      try {
        const response = await apiFetch(clerk, "/api/members/me/payments");
        void apiFetch(clerk, "/api/members/me/subscription").then(async (sub) => { if (active && sub.ok) setSubscription(await sub.json()); }).catch(() => undefined);
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

  if (member?.billing === "manual") {
    return (
      <section className="workspace-section member-page workspace-narrow">
        <p className="kicker">Medlemskab</p>
        <h1>Dit medlemskab</h1>
        <div className="workspace-card">
          <Status value={member.status} />
          <h2>{membershipName(member.tier)}</h2>
          <p>{membershipPlan(member.tier)?.description}</p>
          <p>{member.paysInMembershipworks ? "Dit medlemskab er flyttet til Hjerterums nye system. Din betaling fortsætter indtil videre uændret via MembershipWorks." : "Dit medlemskab er givet af Hjerterum, og der trækkes ingen betaling via kort."}</p>
          <a className="text-link" href="mailto:hjerterum@holistisk.org">Kontakt os om medlemskabet →</a>
        </div>
      </section>
    );
  }

  if (member?.managedExternally) {
    return (
      <section className="workspace-section member-page workspace-narrow">
        <p className="kicker">Medlemskab</p>
        <h1>Dit medlemskab</h1>
        <div className="workspace-card">
          <Status value={member.status} />
          <h2>{membershipName(member.tier)}</h2>
          <p>{membershipPlan(member.tier)?.description}</p>
          <p>Dit nuværende medlemskab og din betaling fortsætter uændret i MembershipWorks.</p>
          <a className="text-link" href="mailto:hjerterum@holistisk.org">Kontakt os om medlemskabet →</a>
        </div>
        <MembershipPlans />
      </section>
    );
  }

  return (
    <section className="workspace-section member-page workspace-narrow">
      <p className="kicker">Medlemskab</p>
      <h1>Betaling og medlemskab</h1>
      <div className="workspace-card">
        <Status value={member?.status ?? "unknown"} />
        <h2>{membershipName(member?.tier ?? "")}</h2>
        <p>{membershipPlan(member?.tier ?? "")?.description}</p>
        {/* Requested: "Pris for det pågældende medlemsskab, hvornår der trækkes sidste gang, og en lille Afmeld-knap." */}
        <dl className="membership-facts">
          <div><dt>Pris</dt><dd>{subscription?.amountMinor != null
            ? (subscription.amountMinor / 100).toLocaleString("da-DK") + " kr. " + (subscription.interval === "year" ? "pr. år" : "pr. måned")
            : member && membershipPlan(member.tier) ? membershipPrice(membershipPlan(member.tier)![member.interval === "year" ? "year" : "month"]) + " " + (member.interval === "year" ? "pr. år" : "pr. måned") : "–"}</dd></div>
          <div><dt>Sidst trukket</dt><dd>{(() => { const paid = invoices.find((invoice) => invoice.status === "paid" && invoice.amountPaidMinor > 0); return paid ? new Date(paid.createdAt).toLocaleDateString("da-DK", { day: "numeric", month: "long", year: "numeric" }) : billingState === "ready" ? "Intet trukket endnu" : "–"; })()}</dd></div>
          <div><dt>{subscription?.cancelAtPeriodEnd ? "Ophører" : "Næste træk"}</dt><dd>{subscription?.cancelAtPeriodEnd
            ? (subscription.endsAt ? new Date(subscription.endsAt).toLocaleDateString("da-DK", { day: "numeric", month: "long", year: "numeric" }) : "ved periodens udløb")
            : subscription?.nextChargeAt ? new Date(subscription.nextChargeAt).toLocaleDateString("da-DK", { day: "numeric", month: "long", year: "numeric" }) : "–"}</dd></div>
        </dl>
        {billingState === "ready" ? (
        <div className="workspace-actions">
          <button type="button" className="pill-button dark" disabled={busy} onClick={() => void openPortal()}>Administrér betaling</button>
          {!subscription?.cancelAtPeriodEnd && <button type="button" className="text-button is-danger membership-cancel" disabled={busy} onClick={() => void cancelMembership()}>Afmeld</button>}
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

/** Requested: '"Dit medlemskab" sektionen skal have en mere dominant plads under "Min profil"' - first on the page: the plan, its
 * status, the price and the next charge, and the way to the membership page. */
type SubscriptionSummary = { amountMinor: number | null; interval: string | null; nextChargeAt: string | null; cancelAtPeriodEnd: boolean; endsAt: string | null };
function MembershipHero({ clerk, member }: { clerk: ClerkBrowser; member: Member }) {
  const [subscription, setSubscription] = useState<SubscriptionSummary | null>(null);
  const card = !member.managedExternally && member.billing !== "manual";
  useEffect(() => {
    if (!card) return;
    let active = true;
    void apiFetch(clerk, "/api/members/me/subscription").then(async (r) => { if (active && r.ok) setSubscription(await r.json() as SubscriptionSummary); }).catch(() => undefined);
    return () => { active = false; };
  }, [clerk, member.id, card]);
  const plan = membershipPlan(member.tier);
  const longDate = (iso: string) => new Date(iso).toLocaleDateString("da-DK", { day: "numeric", month: "long", year: "numeric" });
  const per = (interval: string | null) => interval === "year" ? "pr. år" : "pr. måned";
  const price = subscription?.amountMinor != null ? `${membershipPrice(subscription.amountMinor)} ${per(subscription.interval)}`
    : plan && member.billing !== "manual" ? `${membershipPrice(plan[member.interval === "year" ? "year" : "month"])} ${per(member.interval)}` : null;
  const payment = member.managedExternally || member.paysInMembershipworks ? "Betales indtil videre via MembershipWorks"
    : member.billing === "manual" ? "Givet af Hjerterum - ingen betaling"
    : subscription?.cancelAtPeriodEnd ? `Ophører ${subscription.endsAt ? longDate(subscription.endsAt) : "ved periodens udløb"}`
    : subscription?.nextChargeAt ? `Næste træk ${longDate(subscription.nextChargeAt)}` : null;
  return (
    <section className="profile-membership" aria-label="Dit medlemskab">
      <div className="profile-membership-head"><p className="kicker">Dit medlemskab</p><Status value={member.status} /></div>
      <h2>{membershipName(member.tier)}</h2>
      {plan?.description && <p>{plan.description}</p>}
      {(price || payment) && <dl className="membership-facts">
        {price && <div><dt>Pris</dt><dd>{price}</dd></div>}
        {payment && <div><dt>Betaling</dt><dd>{payment}</dd></div>}
      </dl>}
      <a className="pill-button dark" href="/member-portal/medlemskab">Se og administrér medlemskab</a>
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
        birthday: String(form.get("birthday") || "")
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
    <section className="workspace-section member-page">
      <p className="kicker">Min profil</p>
      <h1>Dig i Hjerterum</h1>
      <p className="profile-lead">Dine oplysninger, det du deler — og de fællesskaber, du vælger.</p>
      {member && <MembershipHero clerk={clerk} member={member} />}
      <details className="profile-basics">
        <summary>
          <span><strong>Dine medlemsoplysninger</strong><small>Navn, e-mail, telefon og fødselsdag · kun til administration</small></span>
          <span className="profile-badge">Privat</span>
        </summary>
        {member?.managedExternally ? <div className="profile-basics-content">
          <h2>{member.fullName}</h2><p>{member.email}</p>
          <p>Dit medlemskab administreres fortsat i MembershipWorks og ændres ikke her.</p>
        </div> : !member ? <p>Der er endnu ikke en medlemsprofil at redigere.</p> :
          <form className="workspace-form profile-basics-content" onSubmit={save}>
            <div className="workspace-form-row">
              <label>Navn<input name="fullName" defaultValue={member.fullName} required /></label>
              <label>E-mail<input name="email" type="email" defaultValue={member.email} required /></label>
              <label>Telefon<input name="phone" defaultValue={member.phone || ""} /></label>
              <label>Fødselsdag<input name="birthday" type="date" max={new Date().toISOString().slice(0, 10)} defaultValue={member.birthday || ""} /></label>
            </div>
            <button className="pill-button dark">Gem oplysninger</button>
            {message && <p className="workspace-message" role="status">{message}</p>}
          </form>}
      </details>
      <ProfileFeatures clerk={clerk} fullName={member?.fullName ?? ""} />
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
  const markedDates = new Set([...calendar, ...externalEvents].map((entry) => todayKey(new Date(entry.startsAt))));
  return (
    <main className="workspace-shell profile-workspace">
      <WorkspaceHeader clerk={clerk} mode="member" path={path} />
      {loading ? <section className="workspace-loading">Henter dit medlemsområde …</section> :
        accessError && normalized !== "/member-portal/profil" ? <>
          <section className="workspace-section member-page workspace-narrow"><p className="kicker">Medlemsområde</p><h1>Medlemskab kræves</h1><div className="workspace-card"><p>{accessError}</p><p>Er du allerede medlem, så skriv til os, så kobler vi dit medlemskab på din e-mail.</p><a className="text-link" href="mailto:hjerterum@holistisk.org">Kontakt Hjerterum →</a></div></section>
          <section className="workspace-section member-page"><p className="kicker">Bliv medlem</p><h2>Vælg dit medlemskab</h2><p>Du melder dig til i det nuværende medlemssystem. Bruger du samme e-mail, får du adgang her, så snart medlemskabet er aktivt.</p><MembershipPlans /></section>
        </> :
        normalized === "/member-portal/medlemskab" ? (
          <><MemberProfile clerk={clerk} member={member} onSaved={setMember} /><div id="medlemskab"><MemberBilling clerk={clerk} member={member} /></div></>
        ) : !includesMemberBenefits(member?.tier ?? null) && (normalized === "/member-portal/events" || normalized === "/member-portal/kalender") ? (
          <section className="workspace-section member-page workspace-narrow"><h1>Support medlemskab</h1><p>{membershipPlansSupportText}</p></section>
        ) : normalized === "/member-portal/events" ? (
          <MemberEvents clerk={clerk} member={member} bookings={ownedBookings} markedDates={markedDates} reload={loadCalendar} />
        ) : normalized === "/member-portal/profil" || normalized === "/member-portal/kontakt" ? (
          normalized === "/member-portal/profil" ? <><MemberProfile clerk={clerk} member={member} onSaved={setMember} />{member && !accessError && <div id="medlemskab"><MemberBilling clerk={clerk} member={member} /></div>}</> :
          <section className="workspace-section member-page site-page member-about"><SitePageInner page={SITE_PAGES.find((page) => page.path === "/om-hjerterum")!} widgets={{}} /></section>
        ) : normalized === "/member-portal/kalender" ? (
          <MemberCalendar clerk={clerk} bookings={calendar} externalEvents={externalEvents} reload={loadCalendar} />
        ) : <MemberOverview member={member} calendar={calendar} clerk={clerk} />}
      <footer className="member-foot"><LegalLine /></footer>
      {member && !loading && includesMemberBenefits(member.tier) && <SagaWidget clerk={clerk} path={path} firstName={member.fullName.trim().split(/\s+/)[0] ?? ""} />}
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

