import type { PrQuotes } from "../pr-material";
import { useEffect, useState } from "react";
import { parsePublicProfile, isCompleteProfile, type OwnPublicProfile, type PublicProfile } from "../public-profile";
import { apiFetch, type ClerkBrowser } from "./clerk";
import { PhotoCropper } from "./photo-cropper";
import { slugify } from "../site/markdown";

/** Requested: "man skal så kunne klikke ind på en behandler". Each published visit card has its own page, /behandlere/<navn>. */
export function profileSlug(profile: { name: string; id: string }, all: Array<{ name: string; id: string }>): string {
  const base = slugify(profile.name) || "behandler";
  return all.filter(other => (slugify(other.name) || "behandler") === base).length > 1 ? `${base}-${profile.id.slice(0, 6)}` : base;
}

/** Requested (Gitta): "at events, bliver connected til underviseren på en måde (måske har de hver deres side, man kan trykke ind på, ved at trykke på deres
 * navn?)". The published visit card behind an event's host: the same name, or a name the host line holds in full (two words or more) - "Anna & Bo". */
export function teacherFor(host: string, profiles: SiteProfile[]): { profile: SiteProfile; href: string } | null {
  const norm = (s: string) => s.toLocaleLowerCase("da-DK").replace(/\s+/g, " ").trim();
  const h = norm(host);
  const profile = profiles.find(p => norm(p.name) === h) ?? profiles.find(p => norm(p.name).includes(" ") && h.includes(norm(p.name)));
  return profile ? { profile, href: `/behandlere/${profileSlug(profile, profiles)}` } : null;
}

export function ProfileCard({ profile, href }: { profile: PublicProfile; href?: string }) {
  let contact: Partial<PublicProfile> = {};
  try { contact = parsePublicProfile(profile); } catch { /* Incomplete contact input is never rendered as a link. */ }
  return <article className="profile-preview">
    {profile.photoUrl ? <img className="profile-portrait profile-portrait-photo" src={profile.photoUrl} alt={profile.name} loading="lazy" />
      : <div className="profile-portrait" aria-hidden="true">{profile.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("") || "?"}</div>}
    <div><h3>{href ? <a href={href}>{profile.name}</a> : profile.name || "Dit navn"}</h3><p>{profile.title || "Din faglige titel"}</p>
      <p className="profile-badge">{[profile.teaching && "Undervisning", profile.treatment && "Behandling"].filter(Boolean).join(" · ") || "Dit tilbud"}</p>
      <p className="profile-bio">{profile.bio || "Din korte præsentation vises her."}</p><p>{profile.topics}</p>
      {href && <p><a className="text-link" href={href}>Læs mere om {profile.name.split(/\s+/)[0]} →</a></p>}
      <div className="profile-contact-links">
        {contact.publicEmail && <a href={"mailto:" + encodeURIComponent(contact.publicEmail)}>{contact.publicEmail}</a>}
        {contact.publicPhone && <a href={"tel:" + contact.publicPhone.replace(/[ ()-]/g, "")}>{contact.publicPhone}</a>}
        {contact.websiteUrl && <a className="text-link" href={contact.websiteUrl} target="_blank" rel="noopener noreferrer">{contact.linkLabel} ↗</a>}
      </div>
    </div>
  </article>;
}

export function PublicProfileEditor({ clerk, fullName, onBack }: { clerk: ClerkBrowser; fullName: string; onBack: () => void }) {
  const [saved, setSaved] = useState<OwnPublicProfile | null>(null);
  const [draft, setDraft] = useState<PublicProfile>({ name: fullName, title: "", bio: "", topics: "", teaching: false, treatment: false });
  const [preview, setPreview] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState(false);
  const [reload, setReload] = useState(0);
  const [picked, setPicked] = useState<File | null>(null);
  async function usePhoto(blob: Blob) {
    setPicked(null); setBusy(true); setMessage("");
    try {
      const form = new FormData();
      form.set("photo", new File([blob], "portraet.jpg", { type: "image/jpeg" }));
      const response = await apiFetch(clerk, "/api/members/me/public-profile/photo", { method: "POST", body: form });
      const body = await response.json().catch(() => ({})) as { photoUrl?: string };
      if (!response.ok || !body.photoUrl) throw new Error();
      change({ photoUrl: body.photoUrl });
      setMessage("Billedet er klar. Husk at gemme visitkortet.");
    } catch { setMessage("Billedet kunne ikke gemmes. Prøv igen."); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    let active = true;
    setBusy(true);
    void apiFetch(clerk, "/api/members/me/public-profile", { cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error();
      const data = await response.json() as OwnPublicProfile;
      if (active) { setSaved(data); if (data.draft) setDraft(data.draft); setConflict(false); setMessage(""); }
    }).catch(() => { if (active) setMessage("Visitkortet kunne ikke hentes. Prøv igen."); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [clerk, reload]);
  const dirty = saved !== null && JSON.stringify(draft) !== JSON.stringify(saved.draft ?? { name: fullName, title: "", bio: "", topics: "", teaching: false, treatment: false });
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    if (dirty) window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function change(patch: Partial<PublicProfile>) { setDraft(current => ({ ...current, ...patch })); setConsent(false); setMessage(""); }
  async function save(action: "save" | "publish" | "hide") {
    if (!saved || busy || conflict) return;
    if (action !== "hide") {
      try { parsePublicProfile(draft); } catch {
        setMessage("Kontrollér kontaktoplysningerne: skriv en gyldig e-mail, et telefonnummer og en hjemmeside (fx www.ditnavn.dk). Felterne må gerne være tomme.");
        return;
      }
    }
    setBusy(true); setMessage("");
    try {
      const response = await apiFetch(clerk, "/api/members/me/public-profile", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, revision: saved.revision, ...(action === "hide" ? {} : { profile: draft, consent }) })
      });
      if (response.status === 409) { setConflict(true); setMessage("Visitkortet er ændret i en anden fane. Hent den gemte version, før du fortsætter."); return; }
      if (response.status === 403) { setMessage("Du skal have et aktivt medlemskab med medlemsfordele for at offentliggøre visitkortet."); return; }
      if (!response.ok) throw new Error();
      const result = await response.json() as { revision: number; profile?: PublicProfile };
      const nextDraft = result.profile ?? draft;
      setSaved({ ...saved, revision: result.revision, draft: action === "hide" ? saved.draft : nextDraft,
        published: action === "publish" ? nextDraft : action === "hide" ? null : saved.published });
      if (action !== "hide") setDraft(nextDraft);
      setConsent(false);
      setMessage(action === "save" ? "Din kladde er gemt. Den offentlige version er uændret." : action === "publish" ? "Dit visitkort er offentliggjort på hjemmesiden." : "Dit visitkort er nu skjult fra hjemmesiden. Din kladde er bevaret.");
    } catch { setMessage("Ændringen kunne ikke bekræftes. Hent den gemte version, og prøv igen."); setConflict(true); }
    finally { setBusy(false); }
  }
  return <section className="profile-editor" aria-label="Mit offentlige visitkort" aria-busy={busy}>
    <button className="text-button" disabled={busy} onClick={() => { if (!dirty || window.confirm("Du har ændringer, der ikke er gemt. Vil du forlade visitkortet?")) onBack(); }}>← Tilbage til min profil</button>
    <p className="kicker">Underviser & behandler</p><h2>{preview ? "Sådan ser besøgende dig" : "Lad folk møde dig"}</h2>
    <p>Gem dit visitkort som kladde, og offentliggør det, når du er klar.</p>
    <p className="profile-badge">{!saved ? "Henter visitkort …" : saved.published && saved.canPublish ? "Offentlig" : saved.published ? "Skjult · medlemskab kræves" : "Ikke offentlig"}{dirty ? " · Ændringer er ikke gemt" : ""}</p>
    {!saved ? <button className="text-button" disabled={busy} onClick={() => setReload(n => n + 1)}>Prøv igen</button> : <>
      {preview ? <ProfileCard profile={draft} /> : <fieldset className="profile-fields workspace-form" disabled={busy || conflict}>
        <div className="profile-photo-field">
          {picked ? <PhotoCropper file={picked} onDone={(blob) => void usePhoto(blob)} onCancel={() => setPicked(null)} /> : <>
            {draft.photoUrl ? <img className="profile-portrait profile-portrait-photo" src={draft.photoUrl} alt="Dit billede" /> : <div className="profile-portrait" aria-hidden="true">{draft.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("") || "?"}</div>}
            <div><label className="pill-button">{draft.photoUrl ? "Skift billede" : "Upload et billede"}<input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) setPicked(f); }} /></label>
              {draft.photoUrl && <button type="button" className="text-button" onClick={() => change({ photoUrl: "" })}>Fjern billedet</button>}
              <p className="profile-note">Billedet vises rundt på visitkortet. Du kan flytte og zoome, før du gemmer.</p></div>
          </>}
        </div>
        <div className="workspace-form-row">
          <label>Navn på visitkortet<input value={draft.name} maxLength={80} onChange={e => change({ name: e.target.value })} /></label>
          <label>Faglig titel<input value={draft.title} maxLength={120} placeholder="Fx yogalærer og kropsterapeut" onChange={e => change({ title: e.target.value })} /></label>
        </div>
        <fieldset className="profile-roles"><legend>Jeg tilbyder</legend>
          <label><input type="checkbox" checked={draft.teaching} onChange={e => change({ teaching: e.target.checked })} /> Undervisning</label>
          <label><input type="checkbox" checked={draft.treatment} onChange={e => change({ treatment: e.target.checked })} /> Behandling</label>
        </fieldset>
        <label>Kort præsentation<textarea rows={4} value={draft.bio} maxLength={600} onChange={e => change({ bio: e.target.value })} /></label>
        <label>Specialer<input value={draft.topics} maxLength={160} placeholder="Fx yoga · kropsterapi · nærvær" onChange={e => change({ topics: e.target.value })} /></label>
        <fieldset className="profile-fields workspace-form">
          <legend>Offentlig kontaktinfo · valgfrit</legend>
          <p className="profile-note">Udfyld kun det, du vil dele med besøgende. Vi henter ikke kontaktinfo fra dine private medlemsoplysninger.</p>
          <div className="workspace-form-row">
            <label>Offentlig e-mail<input type="email" autoComplete="off" value={draft.publicEmail ?? ""} maxLength={254} onChange={e => change({ publicEmail: e.target.value })} /></label>
            <label>Offentligt telefonnummer<input type="tel" autoComplete="off" value={draft.publicPhone ?? ""} maxLength={40} onChange={e => change({ publicPhone: e.target.value })} /></label>
          </div>
          <label>Hjemmeside eller bookinglink<input type="url" placeholder="https://" value={draft.websiteUrl ?? ""} maxLength={512} onChange={e => change({ websiteUrl: e.target.value })} /></label>
          <label>Tekst på linket<select value={draft.linkLabel ?? "Læs mere"} onChange={e => change({ linkLabel: e.target.value as "Læs mere" | "Book en tid" })}><option>Læs mere</option><option>Book en tid</option></select></label>
        </fieldset>
      </fieldset>}
      <p className="profile-note">Kun oplysningerne i visitkortet bliver offentlige. Dine private medlemsoplysninger, medlemsbetaling og CIRKLER-profil vises ikke her.</p>
      <div className="workspace-actions">
        <button className="pill-button" disabled={busy || conflict} onClick={() => void save("save")}>Gem kladde</button>
        <button className="text-button" disabled={busy} onClick={() => setPreview(!preview)}>{preview ? "Redigér visitkortet" : "Se forhåndsvisning →"}</button>
      </div>
      <div className="profile-publication">
        {!saved.canPublish ? <p>Offentliggørelse kræver et aktivt medlemskab med medlemsfordele.</p> : <>
          {!isCompleteProfile(draft) && <p>Udfyld navn, faglig titel og præsentation, og vælg mindst ét tilbud.</p>}
          <label className="profile-consent"><input type="checkbox" checked={consent} disabled={busy || conflict} onChange={e => setConsent(e.target.checked)} /> Jeg ønsker at vise dette visitkort offentligt på Hjerterums hjemmeside.</label>
          <button className="pill-button dark" disabled={busy || conflict || !consent || !isCompleteProfile(draft)} onClick={() => void save("publish")}>{saved.published ? "Offentliggør ændringer" : "Offentliggør visitkort"}</button>
        </>}
        {saved.published && <button className="text-button" disabled={busy || conflict} onClick={() => void save("hide")}>Skjul fra hjemmesiden</button>}
        <a className="text-link" href="https://www.hjerterum.info/behandlere" target="_blank" rel="noreferrer">Se oversigten på hjemmesiden ↗</a>
      </div>
    </>}
    {message && <p className="workspace-message" role="status">{message}</p>}
    {conflict && <button className="text-button" disabled={busy} onClick={() => { if (!dirty || window.confirm("Vil du erstatte dine ændringer med den gemte version?")) { setConsent(false); setReload(n => n + 1); } }}>Hent den gemte version</button>}
  </section>;
}

export function PublicProfiles({ bare = false }: { bare?: boolean }) {
  const [profiles, setProfiles] = useState<Array<PublicProfile & { id: string }> | null>(null);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setError(false);
    void fetch("/api/public-profiles", { cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error();
      const data = await response.json() as Array<PublicProfile & { id: string }>;
      if (active) setProfiles(data.sort((a, b) => a.name.localeCompare(b.name, "da")));
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [reload]);
  const list = error ? <p role="alert">Profilerne kunne ikke hentes. <button className="text-button" onClick={() => setReload(n => n + 1)}>Prøv igen</button></p> : !profiles ? <p role="status">Henter profiler …</p> : profiles.length ?
    <div className="public-profile-grid">{profiles.map(profile => <ProfileCard key={profile.id} profile={profile} href={`/behandlere/${profileSlug(profile, profiles)}`} />)}</div> :
    bare ? null : <div className="profile-editor"><h2>Her er plads til mennesker</h2><p>De første offentlige profiler kommer snart. Indtil da kan du møde husets undervisere gennem vores events.</p><a className="text-link" href="/events">Se kommende events →</a></div>;
  // On the website's page the heading and the regular teachers come from site/pages.ts.
  if (bare) return <div className="profile-workspace public-profile-directory">{list}</div>;
  return <section className="workspace-section member-profile-page public-profile-directory">
    <p className="kicker">Menneskene i huset</p><h1>Undervisere & behandlere</h1>
    <p className="profile-lead">Mød dem, der deler deres faglighed i Hjerterum.</p>
    {list}
  </section>;
}

/** One teacher's or practitioner's page: the photo, who they are, what they offer, how to reach them. */
/** A published visit card as the website gets it: with the teacher's PR material when they have consented to it (pr-material.ts). */
export type SiteProfile = PublicProfile & { id: string; pr?: { photos: string[]; quotes: PrQuotes } };

export function ProfilePage({ slug, header, footer }: { slug: string; header: React.ReactNode; footer: React.ReactNode }) {
  const [profiles, setProfiles] = useState<SiteProfile[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    void fetch("/api/public-profiles", { cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error();
      const data = await response.json() as SiteProfile[];
      if (active) setProfiles(data);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, []);
  const profile = profiles?.find(p => profileSlug(p, profiles) === slug) ?? null;
  useEffect(() => { if (profile) document.title = `${profile.name} · Hjerterum`; }, [profile]);
  let contact: Partial<PublicProfile> = {};
  try { if (profile) contact = parsePublicProfile(profile); } catch { /* not rendered as links */ }
  const offer = profile ? [profile.teaching && "Undervisning", profile.treatment && "Behandling"].filter(Boolean).join(" · ") : "";
  return <main className="page-shell site-page profile-page">
    {header}
    {!profiles && !error ? <section className="lys-intro site-intro"><p className="lys-sub" role="status">Henter …</p></section>
      : !profile ? <section className="lys-intro site-intro"><div><p className="lys-kicker">Undervisere & behandlere</p><h1 className="lys-title">Profilen findes<em>ikke længere</em></h1></div>
          <div className="site-intro-side"><p><a className="lys-link" href="/behandlere">← Se alle undervisere og behandlere</a></p></div></section>
      : <>
        <section className="lys-intro site-intro">
          <div>
            <a className="site-back" href="/behandlere">← Undervisere & behandlere</a>
            <p className="lys-kicker">{offer}</p>
            <h1 className="lys-title">{profile.name}<em>{profile.title}</em></h1>
          </div>
          <div className="site-intro-side profile-page-side">
            {profile.photoUrl ? <img className="profile-page-photo" src={profile.photoUrl} alt={profile.name} /> : <div className="profile-page-photo profile-page-initials" aria-hidden="true">{profile.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("")}</div>}
          </div>
        </section>
        <div className="site-body"><div className="site-prose">
          <p className="profile-page-bio">{profile.bio}</p>
          {profile.topics && <><h2>Specialer</h2><p>{profile.topics}</p></>}
          {/* Requested (Gitta): the teacher's photos and quotes on their page - shown only with their consent. */}
          {profile.pr?.quotes.facilitator && <blockquote className="profile-quote">{profile.pr.quotes.facilitator}</blockquote>}
          {profile.pr?.quotes.offering && <><h2>Det får du med</h2><p>{profile.pr.quotes.offering}</p></>}
          {profile.pr?.quotes.participant && <><h2>Det siger deltagerne</h2><blockquote className="profile-quote">{profile.pr.quotes.participant}{profile.pr.quotes.participantName && <cite> - {profile.pr.quotes.participantName}</cite>}</blockquote></>}
          {!!profile.pr?.photos.length && <div className="profile-gallery">{profile.pr.photos.map(src => <img key={src} src={src} alt={profile.name} loading="lazy" />)}</div>}
          {(contact.publicEmail || contact.publicPhone || contact.websiteUrl) && <><h2>Kontakt</h2>
            <ul>
              {contact.publicEmail && <li><a href={"mailto:" + encodeURIComponent(contact.publicEmail)}>{contact.publicEmail}</a></li>}
              {contact.publicPhone && <li><a href={"tel:" + contact.publicPhone.replace(/[ ()-]/g, "")}>{contact.publicPhone}</a></li>}
              {contact.websiteUrl && <li><a href={contact.websiteUrl} target="_blank" rel="noopener noreferrer">{contact.linkLabel ?? "Læs mere"} ↗</a></li>}
            </ul></>}
        </div></div>
      </>}
    {footer}
  </main>;
}
