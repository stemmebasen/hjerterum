import { useEffect, useState } from "react";
import { apiFetch, type ClerkBrowser } from "./clerk";
import { EMPTY_QUOTES, PR_CONSENT_TEXT, PR_MAX_PHOTOS, PR_MIN_PHOTOS, PR_MIN_SIDE, readyForPr, type PrMaterial, type PrQuotes } from "../pr-material";

/** Requested (Gitta, via the chair): "At de udtrykkeligt bliver opfordret til at dele minimun 3 billeder af dem selv/relevante billeder til PR. At det ligger
 * inde på deres siden. At de vinger noget ala det her af ..." and "Citater til brug i PR" - "måske vi må nøjes med en kraftig opfordring? Måske gøre det
 * helt klart at vi ikke kan reklamere for dem uden?" The teacher's own page for it: what it takes is said plainly, nothing is required. */
const DAY = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "long", year: "numeric" });

export function PrMaterialEditor({ clerk, onBack }: { clerk: ClerkBrowser; onBack: () => void }) {
  const [material, setMaterial] = useState<PrMaterial | null>(null);
  const [quotes, setQuotes] = useState<PrQuotes>(EMPTY_QUOTES);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const take = (m: PrMaterial) => { setMaterial(m); setQuotes(m.quotes); setConsent(false); };
  useEffect(() => {
    let active = true;
    void apiFetch(clerk, "/api/members/me/pr-material", { cache: "no-store" }).then(async r => { if (!r.ok) throw new Error(); const m = await r.json() as PrMaterial; if (active) take(m); })
      .catch(() => { if (active) setMessage("Dit PR-materiale kunne ikke hentes. Prøv igen."); });
    return () => { active = false; };
  }, [clerk]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true); setMessage("");
    let added = 0, failed = false;
    for (const file of [...files]) {
      const form = new FormData(); form.set("photo", file);
      const r = await apiFetch(clerk, "/api/members/me/pr-material/photos", { method: "POST", body: form }).catch(() => null);
      const body = r ? await r.json().catch(() => null) as (PrMaterial & { error?: string; width?: number; height?: number }) | null : null;
      if (r?.ok && body) { take(body); added++; continue; }
      setMessage(body?.error === "photo_too_small" ? `"${file.name}" er for lille (${body.width} × ${body.height}). Billederne skal være mindst ${PR_MIN_SIDE} pixels på den korte led, så de står skarpt på Instagram og Facebook.`
        : body?.error === "file_type" ? `"${file.name}" er ikke et billede, vi kan bruge. Brug jpg, png eller webp.`
        : body?.error === "file_too_large" ? `"${file.name}" fylder mere end 10 MB.`
        : body?.error === "too_many_photos" ? `Du kan have op til ${PR_MAX_PHOTOS} billeder.` : `"${file.name}" kunne ikke gemmes. Prøv igen.`);
      failed = true;
      break;
    }
    if (added && !failed) setMessage(added === 1 ? "Billedet er gemt." : `${added} billeder er gemt.`);
    setBusy(false);
  }
  async function remove(id: string) {
    setBusy(true);
    const r = await apiFetch(clerk, `/api/members/me/pr-material/photos/${id}`, { method: "DELETE" }).catch(() => null);
    if (r?.ok) take(await r.json() as PrMaterial); else setMessage("Billedet kunne ikke fjernes. Prøv igen.");
    setBusy(false);
  }
  async function save(change: { consent?: boolean } = {}) {
    setBusy(true); setMessage("");
    const r = await apiFetch(clerk, "/api/members/me/pr-material", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ quotes, ...change }) }).catch(() => null);
    if (r?.ok) {
      take(await r.json() as PrMaterial);
      setMessage(change.consent === true ? "Tak! Dit samtykke er gemt, og vi kan nu bruge dit materiale i vores PR." : change.consent === false ? "Dit samtykke er trukket tilbage. Vi bruger ikke længere dine billeder og citater." : "Dine citater er gemt.");
    } else setMessage(r?.status === 403 ? "Det kræver et aktivt medlemskab at give samtykke." : "Det kunne ikke gemmes. Prøv igen.");
    setBusy(false);
  }

  const photos = material?.photos ?? [], ready = material ? readyForPr(material) : false;
  const missing = [photos.length < PR_MIN_PHOTOS ? `${PR_MIN_PHOTOS - photos.length} ${PR_MIN_PHOTOS - photos.length === 1 ? "billede" : "billeder"} mere` : "", material && !material.consentAt ? "dit samtykke" : ""].filter(Boolean);
  const field = (key: keyof PrQuotes, label: string, placeholder: string, max = 200) =>
    <label>{label}<input value={quotes[key]} maxLength={max} placeholder={placeholder} onChange={e => { setQuotes(q => ({ ...q, [key]: e.target.value })); setMessage(""); }} /></label>;

  return <section className="profile-editor pr-editor" aria-label="Mit PR-materiale" aria-busy={busy}>
    <button className="text-button" disabled={busy} onClick={onBack}>← Tilbage til min profil</button>
    <p className="kicker">Til undervisere · PR</p><h2>Lad os fortælle om dig</h2>
    <p>Hjerterum deler events på Instagram, Facebook og i nyhedsbrevet. <strong>Vi kan kun reklamere for dine events, når du har delt mindst {PR_MIN_PHOTOS} billeder og givet dit samtykke herunder.</strong> Uden dem kommer dine events stadig i kalenderen, men vi kan ikke lave opslag om dem.</p>
    <p className={`profile-badge${ready ? " ok" : ""}`}>{!material ? "Henter …" : ready ? "✓ Klar til PR" : `Mangler: ${missing.join(" og ")}`}</p>

    <h3>Billeder ({photos.length}/{PR_MAX_PHOTOS})</h3>
    <p className="profile-note">Del mindst {PR_MIN_PHOTOS} billeder af dig selv eller af det, du laver - gerne lyse, skarpe og med mennesker i. Mindst {PR_MIN_SIDE} pixels på den korte led.</p>
    <div className="pr-photos">{photos.map(p => <figure key={p.id}><img src={p.url} alt="" loading="lazy" /><button type="button" className="text-button" disabled={busy} onClick={() => void remove(p.id)}>Fjern</button></figure>)}
      {photos.length < PR_MAX_PHOTOS && <label className="pr-add pill-button">+ Tilføj billeder<input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden disabled={busy} onChange={e => { const f = e.target.files; void upload(f); e.target.value = ""; }} /></label>}</div>

    <h3>Citater til PR</h3>
    <p className="profile-note">Én linje hver er nok. Vi bruger dem i opslag om dine events.</p>
    <fieldset className="profile-fields workspace-form" disabled={busy}>
      {field("facilitator", "Om dig som facilitator", "Fx: Anna holder rummet med en rolig og varm tilstedeværelse.")}
      {field("offering", "Det, deltagerne får med", "Fx: Du går hjem med mere ro i kroppen og nye værktøjer til hverdagen.")}
      <div className="workspace-form-row">{field("participant", "Fra en tidligere deltager", "Fx: Det bedste, jeg har gjort for mig selv i år.")}{field("participantName", "Deltagerens navn (valgfrit)", "Fx: Mette, 42", 80)}</div>
    </fieldset>
    <div className="workspace-actions"><button className="pill-button" disabled={busy || !material} onClick={() => void save()}>Gem citater</button></div>

    <div className="profile-publication">
      {material?.consentAt ? <>
        <p>✓ Du gav samtykke {DAY.format(material.consentAt)}:<br /><em>"{PR_CONSENT_TEXT}"</em></p>
        <button className="text-button" disabled={busy} onClick={() => { if (window.confirm("Vil du trække dit samtykke tilbage? Så bruger vi ikke længere dine billeder og citater i vores PR.")) void save({ consent: false }); }}>Træk mit samtykke tilbage</button>
      </> : <>
        <label className="profile-consent"><input type="checkbox" checked={consent} disabled={busy || !material} onChange={e => setConsent(e.target.checked)} /> {PR_CONSENT_TEXT}</label>
        <button className="pill-button dark" disabled={busy || !consent} onClick={() => void save({ consent: true })}>Giv samtykke</button>
      </>}
    </div>
    {message && <p className="workspace-message" role="status">{message}</p>}
  </section>;
}

/** On "Mine events": whether Hjerterum can promote them, and the way to the PR material when not. */
export function PrNudge({ clerk }: { clerk: ClerkBrowser }) {
  const [m, setM] = useState<PrMaterial | null>(null);
  useEffect(() => {
    let active = true;
    void apiFetch(clerk, "/api/members/me/pr-material", { cache: "no-store" }).then(async r => { if (r.ok && active) setM(await r.json() as PrMaterial); }).catch(() => undefined);
    return () => { active = false; };
  }, [clerk]);
  if (!m) return null;
  return readyForPr(m)
    ? <div className="workspace-message"><strong>✓ Dit PR-materiale er klar</strong><p>Vi kan reklamere for dine events med dine billeder og citater.</p></div>
    : <div className="workspace-message pr-nudge"><strong>Skal vi hjælpe med at fylde dit event?</strong>
      <p>Vi kan kun reklamere for dit event på Instagram, Facebook og i nyhedsbrevet, når du har delt mindst {PR_MIN_PHOTOS} billeder og givet dit samtykke. Det tager et par minutter.</p>
      <a className="pill-button subtle" href="/member-portal/profil#pr">Del mit PR-materiale</a></div>;
}
