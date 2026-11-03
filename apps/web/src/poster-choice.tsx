import { useEffect, useState } from "react";
import { apiFetch, type ClerkBrowser } from "./clerk";
import { POSTER_MAX_BYTES, POSTER_SHAPES, posterSizeProblem } from "../site/poster-rules";
import type { VariantKey } from "./event-poster";

/** Requested: "Når man opretter event skal man også kunne vælge en af skabelonerne eller alternativt uploade sit eget. Uploader man
 * sit eget skal Saga tjekke om der er nødvendigt info på, om dimensionerne er rigtige og om kvaliteten er høj nok". The templates have since
 * moved to admin (poster-studio.tsx); the member's own poster stays here. Its measurements are told at once; Saga looks at it when the
 * event is saved (worker/event-posters.ts). */

export type PosterChoiceValue = { choice: "auto" | "eget"; ownFile: File | null };
export type SavedPoster = { variant: VariantKey | "eget" | null; poster: { url: string; width: number; height: number; note: string | null } | null };
export const AUTO_POSTER: PosterChoiceValue = { choice: "auto", ownFile: null };

const image = (src: string) => new Promise<HTMLImageElement | null>(resolve => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => resolve(null); img.src = src; });

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

/** Requested (the chair, 3 Nov 2026): "de designskabeloner, vi har lavet til eventoprettelse, skal kun bruges i cockpittet". The member no longer
 * sees or picks a design - the chair makes them in admin (Plakater og opslag) from the event's and the teacher's material. What stays here is the
 * member's own finished poster, if they have one: Saga looks at it when the event is saved, and the chair can use it. */
export function PosterChoice({ clerk, saved, value, onChange, onRemoveSaved }: {
  clerk: ClerkBrowser; saved: SavedPoster | null; value: PosterChoiceValue; onChange: (next: PosterChoiceValue) => void; onRemoveSaved: () => void;
}) {
  const [ownProblem, setOwnProblem] = useState("");
  const [ownSize, setOwnSize] = useState<string>("");
  const pickOwn = async (file: File | null) => {
    setOwnProblem(""); setOwnSize("");
    if (!file) return onChange(AUTO_POSTER);
    if (!/\.(jpe?g|png)$/i.test(file.name)) { setOwnProblem("Opslaget skal være et billede i jpg eller png."); return onChange(AUTO_POSTER); }
    if (file.size > POSTER_MAX_BYTES) { setOwnProblem(`Filen fylder ${(file.size / 1024 / 1024).toFixed(1).replace(".", ",")} MB - højst 4,5 MB. Gem det som jpg.`); return onChange(AUTO_POSTER); }
    const url = URL.createObjectURL(file);
    const img = await image(url);
    URL.revokeObjectURL(url);
    const problem = posterSizeProblem(img?.naturalWidth ?? 0, img?.naturalHeight ?? 0);
    if (problem) { setOwnProblem(problem); return onChange(AUTO_POSTER); }
    setOwnSize(`${img!.naturalWidth} × ${img!.naturalHeight} px - målene er i orden. Saga ser på indholdet og kvaliteten, når du gemmer.`);
    onChange({ choice: "eget", ownFile: file });
  };
  return <fieldset className="event-section poster-choice">
    <legend>Dit eget opslag (valgfrit)</legend>
    <p className="poster-choice-help">Hjerterum laver selv opslag til Instagram og Facebook ud fra dit eventfoto og det PR-materiale, du har delt under Min profil. Har du et færdigt opslag, du gerne vil have brugt, kan du sende det her.</p>
    {saved?.poster && !value.ownFile && <p className="poster-choice-ok"><SavedPosterImage clerk={clerk} url={saved.poster.url} />Dit opslag er godkendt af Saga{saved.poster.note ? `: ${saved.poster.note}` : "."} <button type="button" className="text-button" onClick={onRemoveSaved}>Fjern det</button></p>}
    <div className="poster-choice-upload">
      <label>{saved?.poster ? "Send et nyt opslag" : "Vælg dit opslag"}
        <input type="file" accept=".jpg,.jpeg,.png" onChange={e => void pickOwn(e.target.files?.[0] ?? null)} />
      </label>
      <small>Jpg eller png, højst 4,5 MB, i formatet {POSTER_SHAPES.map(s => `${s.example} (${s.label})`).join(", ")} px. Titel, dato og tid skal stå på opslaget. Saga ser på det, når du gemmer, og afviser det, hvis noget mangler, ikke passer med eventet, eller kvaliteten ikke er god nok.</small>
      {ownProblem && <p className="poster-choice-problem" role="alert">{ownProblem}</p>}
      {ownSize && <p className="poster-choice-ok" role="status">{ownSize}</p>}
    </div>
  </fieldset>;
}

const REASONS: Record<string, string> = { uploads_not_configured: "upload er ikke slået til endnu", booking_not_found: "eventet blev ikke fundet" };

/** After the event is saved: the chosen design, or the member's own poster for Saga to look at. Returns a line for the form's message. */
export async function savePosterChoice(clerk: ClerkBrowser, bookingId: number, value: PosterChoiceValue, _saved: SavedPoster | null): Promise<string> {
  if (value.choice !== "eget" || !value.ownFile) return "";
  try {
    const form = new FormData();
    form.append("file", value.ownFile);
    const response = await apiFetch(clerk, `/api/room-bookings/${bookingId}/poster`, { method: "POST", body: form });
    const body = await response.json().catch(() => ({})) as { error?: string; reason?: string; poster?: { note?: string | null } };
    if (!response.ok) return ` Dit eget opslag blev ikke godkendt: ${body.reason ?? REASONS[body.error ?? ""] ?? "det kunne ikke gemmes"}. Redigér eventet for at prøve igen.`;
    return ` Saga har godkendt dit opslag${body.poster?.note ? `: ${body.poster.note}` : "."}`;
  } catch {
    return " Opslaget kunne ikke gemmes lige nu - prøv igen ved at redigere eventet.";
  }
}
