import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { apiFetch, type ClerkBrowser } from "./clerk";
import { chooseVariant, drawPoster, photoFits, VARIANTS, wordsOf, type Assets, type PosterWords, type VariantKey } from "./event-poster";
import { POSTER_MAX_BYTES, POSTER_SHAPES, posterSizeProblem } from "../site/poster-rules";

/** Requested: "Når man opretter event skal man også kunne vælge en af skabelonerne eller alternativt uploade sit eget. Uploader man
 * sit eget skal Saga tjekke om der er nødvendigt info på, om dimensionerne er rigtige og om kvaliteten er høj nok".
 * In the event form: the system's choice, one of the five designs (drawn live from what the member has written), or their own
 * poster. Its measurements are told at once here; Saga looks at it when the event is saved (worker/event-posters.ts). */

const PAGE = 8;

export type PosterChoiceValue = { choice: "auto" | VariantKey; ownFile: File | null };
export type SavedPoster = { variant: VariantKey | null; poster: { url: string; width: number; height: number; note: string | null } | null };
export const AUTO_POSTER: PosterChoiceValue = { choice: "auto", ownFile: null };

const image = (src: string) => new Promise<HTMLImageElement | null>(resolve => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => resolve(null); img.src = src; });

/** The photo for the previews: the one just chosen in the form, or the event's saved cover (behind the login). */
function usePhoto(clerk: ClerkBrowser, file: File | null, savedUrl: string | null): HTMLImageElement | null {
  const [photo, setPhoto] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    let active = true, url: string | null = null;
    void (async () => {
      if (file) url = URL.createObjectURL(file);
      else if (savedUrl) { const r = await apiFetch(clerk, savedUrl).catch(() => null); if (r?.ok) url = URL.createObjectURL(await r.blob()); }
      const img = url ? await image(url) : null;
      if (active) setPhoto(img);
    })();
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [clerk, file, savedUrl]);
  return photo;
}

function useLogo() {
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    void Promise.all(["400 100px \"Playfair Display\"", "italic 400 100px \"Playfair Display\"", "600 30px Inter"].map(f => document.fonts.load(f).catch(() => [])))
      .then(() => image("/logo.png")).then(setLogo);
  }, []);
  return logo;
}

/** A small preview, drawn a moment after the words last changed and one after the other, so typing and choosing stay quick. */
function Preview({ variant, words, assets, order }: { variant: VariantKey; words: PosterWords; assets: Assets; order: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => { if (ref.current) drawPoster(ref.current, variant, words, assets, "opslag", 0.3); }, 250 + order * 40);
    return () => window.clearTimeout(timer);
  }, [variant, words, assets, order]);
  return <canvas ref={ref} className="poster-choice-canvas" aria-hidden="true" />;
}

/** The member's own poster from the server (behind the login), as a picture. */
function SavedPosterImage({ clerk, url }: { clerk: ClerkBrowser; url: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let active = true, made: string | null = null;
    void apiFetch(clerk, url).then(async r => { if (r.ok && active) { made = URL.createObjectURL(await r.blob()); setSrc(made); } }).catch(() => undefined);
    return () => { active = false; if (made) URL.revokeObjectURL(made); };
  }, [clerk, url]);
  return src ? <img className="poster-choice-own-img" src={src} alt="Dit eget opslag" /> : null;
}

export function PosterChoice({ clerk, title, startsAt, endsAt, teacher, cover, coverUrl, saved, value, onChange, onRemoveSaved }: {
  clerk: ClerkBrowser; title: string; startsAt: string | null; endsAt: string | null; teacher: string;
  cover: File | null; coverUrl: string | null; saved: SavedPoster | null; value: PosterChoiceValue; onChange: (next: PosterChoiceValue) => void; onRemoveSaved: () => void;
}) {
  const photo = usePhoto(clerk, cover, coverUrl);
  const logo = useLogo();
  const [ownProblem, setOwnProblem] = useState("");
  const [ownSize, setOwnSize] = useState<string>("");
  // The same objects until something the posters show has changed - a new object would redraw all six.
  const assets: Assets = useMemo(() => ({ photo, logo }), [photo, logo]);
  const slowTitle = useDeferredValue(title);
  const [fallbackStart] = useState(() => new Date(Date.now() + 7 * 86_400_000).toISOString());
  const start = startsAt ?? fallbackStart;
  const event = useMemo(() => ({ id: slowTitle || "nyt-event", title: slowTitle.trim() || "Dit event", startsAt: start, endsAt, host: teacher, category: null, imageUrl: photo ? "photo" : null }),
    [slowTitle, start, endsAt, teacher, photo]);
  const words = useMemo(() => wordsOf(event), [event]);
  const size = photo ? { width: photo.naturalWidth, height: photo.naturalHeight } : null;
  const systems = chooseVariant(event, size, "opslag");
  // Requested: "Nej, 8 der vises. Og så kan man få 8 nye." The sixteen designs, eight at a time; the one picked stays in view.
  const [page, setPage] = useState(0);
  const pages = Math.ceil(VARIANTS.length / PAGE);
  const shown = VARIANTS.slice(page * PAGE, page * PAGE + PAGE);
  const picked = VARIANTS.find(v => v.key === value.choice);
  const visible = picked && !shown.includes(picked) ? [picked, ...shown] : shown;

  const pickOwn = async (file: File | null) => {
    setOwnProblem(""); setOwnSize("");
    if (!file) return onChange({ choice: "eget", ownFile: null });
    if (!/\.(jpe?g|png)$/i.test(file.name)) { setOwnProblem("Opslaget skal være et billede i jpg eller png."); return onChange({ choice: "eget", ownFile: null }); }
    if (file.size > POSTER_MAX_BYTES) { setOwnProblem(`Filen fylder ${(file.size / 1024 / 1024).toFixed(1).replace(".", ",")} MB - højst 4,5 MB. Gem det som jpg.`); return onChange({ choice: "eget", ownFile: null }); }
    const url = URL.createObjectURL(file);
    const img = await image(url);
    URL.revokeObjectURL(url);
    const problem = posterSizeProblem(img?.naturalWidth ?? 0, img?.naturalHeight ?? 0);
    if (problem) { setOwnProblem(problem); return onChange({ choice: "eget", ownFile: null }); }
    setOwnSize(`${img!.naturalWidth} × ${img!.naturalHeight} px - målene er i orden. Saga ser på indholdet og kvaliteten, når du gemmer.`);
    onChange({ choice: "eget", ownFile: file });
  };

  const option = (key: "auto" | VariantKey, label: string, body: ReactNode, disabled = false, note?: string) =>
    <label key={key} className={"poster-choice-option" + (value.choice === key ? " is-picked" : "") + (disabled ? " is-disabled" : "")}>
      <input type="radio" name="posterChoice" value={key} checked={value.choice === key} disabled={disabled} onChange={() => onChange({ choice: key, ownFile: null })} />
      {body}<span className="poster-choice-label">{label}</span>{note && <small>{note}</small>}
    </label>;

  return <fieldset className="event-section poster-choice">
    <legend>Opslag til de sociale medier</legend>
    <p className="poster-choice-help">Vælg, hvordan dit event skal se ud på Instagram og Facebook. Forhåndsvisningerne bruger din titel, dato og dit eventfoto. Du kan også sende dit eget færdige opslag.</p>
    <div className="poster-choice-grid">
      {option("auto", "Systemets valg", <Preview variant={systems} words={words} assets={assets} order={0} />, false, VARIANTS.find(v => v.key === systems)?.label)}
      {visible.map((v, i) => {
        const fits = photoFits(v.key, "opslag", size);
        return option(v.key, v.label, <Preview variant={v.key} words={words} assets={assets} order={i + 1} />, !fits.ok, fits.ok ? undefined : size ? "Fotoet er for lille" : "Kræver et eventfoto");
      })}
      <label className={"poster-choice-option poster-choice-own" + (value.choice === "eget" ? " is-picked" : "")}>
        <input type="radio" name="posterChoice" value="eget" checked={value.choice === "eget"} onChange={() => onChange({ choice: "eget", ownFile: value.ownFile })} />
        {saved?.poster && !value.ownFile ? <SavedPosterImage clerk={clerk} url={saved.poster.url} /> : <span className="poster-choice-own-box" aria-hidden="true">Dit eget<br />opslag</span>}
        <span className="poster-choice-label">Mit eget opslag</span>
      </label>
    </div>
    {pages > 1 && <p className="poster-choice-more">
      <button type="button" className="pill-button subtle" onClick={() => setPage(p => (p + 1) % pages)}>Vis {PAGE} nye designs</button>
      <small>{page * PAGE + 1}–{Math.min(VARIANTS.length, page * PAGE + PAGE)} af {VARIANTS.length}</small>
    </p>}
    {value.choice === "eget" && <div className="poster-choice-upload">
      <label>Vælg dit opslag
        <input type="file" accept=".jpg,.jpeg,.png" onChange={e => void pickOwn(e.target.files?.[0] ?? null)} />
      </label>
      <small>Jpg eller png, højst 4,5 MB, i formatet {POSTER_SHAPES.map(s => `${s.example} (${s.label})`).join(", ")} px. Titel, dato og tid skal stå på opslaget. Saga ser på det, når du gemmer, og afviser det, hvis noget mangler, ikke passer med eventet, eller kvaliteten ikke er god nok.</small>
      {ownProblem && <p className="poster-choice-problem" role="alert">{ownProblem}</p>}
      {ownSize && <p className="poster-choice-ok" role="status">{ownSize}</p>}
      {saved?.poster && !value.ownFile && <p className="poster-choice-ok">Dit opslag er godkendt af Saga{saved.poster.note ? `: ${saved.poster.note}` : "."} <button type="button" className="text-button" onClick={onRemoveSaved}>Fjern det</button></p>}
    </div>}
  </fieldset>;
}

const REASONS: Record<string, string> = { uploads_not_configured: "upload er ikke slået til endnu", booking_not_found: "eventet blev ikke fundet" };

/** After the event is saved: the chosen design, or the member's own poster for Saga to look at. Returns a line for the form's message. */
export async function savePosterChoice(clerk: ClerkBrowser, bookingId: number, value: PosterChoiceValue, saved: SavedPoster | null): Promise<string> {
  try {
    if (value.choice === "eget" && value.ownFile) {
      const form = new FormData();
      form.append("file", value.ownFile);
      const response = await apiFetch(clerk, `/api/room-bookings/${bookingId}/poster`, { method: "POST", body: form });
      const body = await response.json().catch(() => ({})) as { error?: string; reason?: string; poster?: { note?: string | null } };
      if (!response.ok) return ` Dit eget opslag blev ikke godkendt: ${body.reason ?? REASONS[body.error ?? ""] ?? "det kunne ikke gemmes"}. Redigér eventet for at prøve igen, eller vælg en af skabelonerne.`;
      return ` Saga har godkendt dit opslag${body.poster?.note ? `: ${body.poster.note}` : "."}`;
    }
    if (value.choice === "eget") return saved?.poster ? "" : " Du valgte dit eget opslag, men sendte ingen fil - systemet vælger et design, indtil du gør.";
    const variant = value.choice === "auto" ? null : value.choice;
    if ((saved?.variant ?? null) === variant) return "";
    await apiFetch(clerk, `/api/room-bookings/${bookingId}/poster-variant`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ variant }) });
    return "";
  } catch {
    return " Opslaget kunne ikke gemmes lige nu - prøv igen ved at redigere eventet.";
  }
}
