import { cropCover } from "./cover-crop";
import { useEffect, useState } from "react";
import { apiFetch, type ClerkBrowser } from "./clerk";

/** The cover photo and the other files on a member's event (requested; the photo rules follow the booking form):
 * one photo that is public once the event is approved, and up to five documents or pictures for the registered. */

export type EventFile = { id: number; kind: "cover" | "file"; filename: string; contentType: string; sizeBytes: number; url: string };

export const COVER_MAX = 8 * 1024 * 1024;
export const FILE_MAX = 10 * 1024 * 1024;
export const OTHER_MAX = 5;
const COVER_EXT = ["jpg", "jpeg", "png"];
const FILE_EXT = [...COVER_EXT, "webp", "gif", "pdf", "txt", "doc", "docx", "odt", "xls", "xlsx", "ods", "ppt", "pptx", "odp"];
export const COVER_ACCEPT = COVER_EXT.map((e) => "." + e).join(",");
export const FILE_ACCEPT = FILE_EXT.map((e) => "." + e).join(",");
const extensionOf = (name: string) => (/\.([A-Za-z0-9]{1,5})$/.exec(name)?.[1] ?? "").toLowerCase();
const megabytes = (bytes: number) => bytes < 1024 * 1024 ? Math.max(1, Math.round(bytes / 1024)) + " KB" : (bytes / 1024 / 1024).toLocaleString("da-DK", { maximumFractionDigits: 1 }) + " MB";

/** What is wrong with the chosen files, in plain Danish; an empty list means all is well. */
export function fileProblems(cover: File | null, extra: File[], alreadyThere: number): string[] {
  const problems: string[] = [];
  if (cover) {
    if (!COVER_EXT.includes(extensionOf(cover.name))) problems.push(`Eventfotoet “${cover.name}” skal være jpg eller png.`);
    else if (cover.size > COVER_MAX) problems.push(`Eventfotoet “${cover.name}” er ${megabytes(cover.size)} - højst ${megabytes(COVER_MAX)}.`);
  }
  if (alreadyThere + extra.length > OTHER_MAX) problems.push(`Der kan være højst ${OTHER_MAX} filer på et event.`);
  for (const file of extra) {
    if (!FILE_EXT.includes(extensionOf(file.name))) problems.push(`“${file.name}” har en filtype, vi ikke tager imod.`);
    else if (file.size > FILE_MAX) problems.push(`“${file.name}” er ${megabytes(file.size)} - højst ${megabytes(FILE_MAX)}.`);
  }
  return problems;
}

const UPLOAD_ERRORS: Record<string, string> = {
  file_too_large: "er for stor", cover_size: "har ikke målene 1920 × 1005 px", file_type: "har en filtype, vi ikke tager imod eller som ikke passer til filens indhold", empty_file: "er tom",
  too_many_files: "kan ikke komme med, for der er allerede fem filer", uploads_not_configured: "kunne ikke gemmes, fordi upload ikke er slået til endnu"
};

/** Sends the chosen photo and files to an event, one at a time; returns what went wrong, if anything. */
export async function uploadEventFiles(clerk: ClerkBrowser, bookingId: number, cover: File | null, extra: File[]): Promise<string[]> {
  const queue: Array<{ file: File; kind: "cover" | "file" }> = [...(cover ? [{ file: cover, kind: "cover" as const }] : []), ...extra.map((file) => ({ file, kind: "file" as const }))];
  const problems: string[] = [];
  for (const { file, kind } of queue) {
    const form = new FormData();
    form.set("kind", kind);
    form.set("file", file);
    try {
      const response = await apiFetch(clerk, `/api/room-bookings/${bookingId}/files`, { method: "POST", body: form });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        problems.push(`“${file.name}” ${UPLOAD_ERRORS[body.error ?? ""] ?? "kunne ikke gemmes"}.`);
      }
    } catch {
      problems.push(`“${file.name}” kunne ikke sendes. Tjek forbindelsen og prøv igen.`);
    }
  }
  return problems;
}

/** A picture that needs the member's login to load (the organiser's own, not yet public photo). */
export function AuthImage({ clerk, file, alt }: { clerk: ClerkBrowser; file: EventFile; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null, live = true;
    void apiFetch(clerk, file.url).then(async (response) => {
      if (!response.ok || !live) return;
      url = URL.createObjectURL(await response.blob());
      setSrc(url);
    }).catch(() => undefined);
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [clerk, file.url]);
  return src ? <img className="event-file-preview" src={src} alt={alt} /> : <span className="event-file-preview event-file-empty" aria-hidden="true" />;
}

/** Files that need the member's login: fetched with it and handed to the browser as a download. */
export function FileLinks({ clerk, files, title = "Filer" }: { clerk: ClerkBrowser; files: EventFile[]; title?: string }) {
  const [error, setError] = useState("");
  const others = files.filter((file) => file.kind === "file");
  if (!others.length) return null;
  async function open(file: EventFile) {
    setError("");
    try {
      const response = await apiFetch(clerk, file.url);
      if (!response.ok) throw new Error("download_failed");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = file.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setError(`“${file.filename}” kunne ikke hentes lige nu.`);
    }
  }
  return (
    <div className="event-files">
      <p className="event-files-title">{title}</p>
      <ul>{others.map((file) => <li key={file.id}><button type="button" className="text-link" onClick={() => void open(file)}>{file.filename}</button> <span className="lys-meta">{megabytes(file.sizeBytes)}</span></li>)}</ul>
      {error && <p className="workspace-message" role="alert">{error}</p>}
    </div>
  );
}

/** The photo and file fields of the event form. */
export function EventFilesField({ clerk, enabled, existing, cover, extra, onCover, onExtra, onRemoveExisting }: {
  clerk: ClerkBrowser;
  enabled: boolean;
  existing: EventFile[];
  cover: File | null;
  extra: File[];
  onCover: (file: File | null) => void;
  onExtra: (files: File[]) => void;
  onRemoveExisting: (file: EventFile) => void;
}) {
  const existingCover = existing.find((file) => file.kind === "cover");
  const existingOthers = existing.filter((file) => file.kind === "file");
  const [preview, setPreview] = useState<string | null>(null);
  const [cropIssue, setCropIssue] = useState("");
  useEffect(() => {
    if (!cover) { setPreview(null); return; }
    const url = URL.createObjectURL(cover);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [cover]);
  const room = OTHER_MAX - existingOthers.length;
  const problems = fileProblems(cover, extra, existingOthers.length);

  const pickCover = async (picked: File | null) => {
    if (!picked) { onCover(null); return; }
    const cropped = await cropCover(picked);
    setCropIssue(cropped.ok ? "" : cropped.reason);
    onCover(cropped.ok ? cropped.file : null);
  };

  // Reported: "Dette layout er ikke kønt" and "Eventfoto dimensionerne skal passe alle steder": the photo is chosen in a frame
  // of its own size (1920 × 1005, Facebook's event cover) - what you see is what the website and Facebook show.
  return (
    <fieldset className="event-section event-files-field" disabled={!enabled}>
      <legend>Eventfoto og filer</legend>
      {!enabled && <p className="lys-sub">Upload af foto og filer er ikke slået til endnu.</p>}
      <label className={"event-cover-drop" + (preview || existingCover ? " has-photo" : "")}
        onDragOver={(e) => { e.preventDefault(); }} onDrop={(e) => { e.preventDefault(); void pickCover(e.dataTransfer.files?.[0] ?? null); }}>
        <input type="file" accept={COVER_ACCEPT} onChange={(e) => { const picked = e.target.files?.[0] ?? null; e.target.value = ""; void pickCover(picked); }} />
        {preview ? <img src={preview} alt="Det valgte eventfoto" />
          : existingCover ? <AuthImage clerk={clerk} file={existingCover} alt="Eventets foto" />
            : <span className="event-cover-empty"><b>Vælg et eventfoto</b><span>eller træk det hertil</span></span>}
        {(preview || existingCover) && <span className="event-cover-change">Skift foto</span>}
      </label>
      {cropIssue && <p className="event-note is-danger" role="alert">{cropIssue}</p>}
      <p className="event-note">1920 × 1005 px (Facebooks størrelse til events), jpg eller png, højst 8 MB. Et større billede beskæres fra midten; et mindre afvises. Brug et foto, du selv har rettighederne til - helst ikke AI-genereret. Det vises offentligt, når eventet er godkendt.
        {existingCover && !cover && <> <button type="button" className="text-button is-danger" onClick={() => onRemoveExisting(existingCover)}>Fjern fotoet</button></>}</p>
      {/* Asked (Gitta): "'Andre filer (0/5)' under Opret event: Er det til PR-materiale til PR-arkivet? - Det må gerne stå tydeligere". It is for the attendees. */}
      <div className="event-attach">
        <label className={"pill-button" + (room <= 0 ? " is-disabled" : "")}>Tilføj filer til deltagerne
          <input type="file" multiple accept={FILE_ACCEPT} disabled={room <= 0}
            onChange={(e) => { onExtra([...extra, ...Array.from(e.target.files ?? [])].slice(0, Math.max(room, 0))); e.target.value = ""; }} />
        </label>
        <span className="event-note">{existingOthers.length + extra.length} af {OTHER_MAX} · fx program og praktisk info, højst 10 MB hver. Kun for dig, bestyrelsen og de tilmeldte - PR-billeder deler du under Min profil → PR-materiale.</span>
      </div>
      {(existingOthers.length > 0 || extra.length > 0) && <ul className="event-file-list">
        {existingOthers.map((file) => <li key={file.id}><span>{file.filename} <span className="lys-meta">{megabytes(file.sizeBytes)}</span></span>
          <button type="button" className="text-button is-danger" onClick={() => onRemoveExisting(file)}>Fjern</button></li>)}
        {extra.map((file, index) => <li key={file.name + index}><span>{file.name} <span className="lys-meta">{megabytes(file.size)} · sendes, når du gemmer</span></span>
          <button type="button" className="text-button" onClick={() => onExtra(extra.filter((_, i) => i !== index))}>Fortryd</button></li>)}
      </ul>}
      {problems.length > 0 && <ul className="planner-problem" role="alert">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
    </fieldset>
  );
}
