import { useEffect, useRef, useState } from "react";
import { apiFetch, type ClerkBrowser } from "./clerk";

/** Requested: "Vi skal have en Saga chatwidget på medlemssiden. Hun skal poppe op på Opret event-siden efter 15 sekunder og spørge brugeren,
 * om han/hun har brug for hjælp til at sætte eventet op. Hun skal også tilbyde at gøre det for brugeren." Not on phones by itself
 * ("Chat skal ikke poppe op på mobiler"); once a visit; a draft fills the form on Opret event, and the member still presses Opret. */
export type SagaDraft = { title: string; description: string; date: string; start: string; end: string; booking_type: "standard" | "reduced" | "free";
  max_attendees: number | null; member_price_kr: number | null; non_member_price_kr: number | null };
/** Requested: "Man skal også kunne uploade fotos, som Saga skal godkende i forhold til kvalitet, format og opløsning." The browser
 * measures the photo and sends Saga a smaller copy to look at; an approved photo can become the event's cover on Opret event. */
type Photo = { file: File; preview: string; dataUrl: string; width: number; height: number };
type Message = { role: "user" | "assistant"; text: string; draft?: SagaDraft | null; photo?: Photo; photoOk?: boolean; forPhoto?: Photo };

export const DRAFT_EVENT = "saga-event-draft";
/** An approved photo for the event being created: event-files' cover crop takes it from here (workspaces.tsx). */
export const COVER_EVENT = "saga-event-cover";
const LOOK_SIZE = 1280;

async function preparePhoto(file: File): Promise<Photo | null> {
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); } catch { return null; }
  const scale = Math.min(1, LOOK_SIZE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { file, preview: dataUrl, dataUrl, width: bitmap.width, height: bitmap.height };
}
const PENDING = "saga_pending_draft";
const POPPED = "saga_popped";

export function takePendingDraft(): SagaDraft | null {
  try { const raw = sessionStorage.getItem(PENDING); sessionStorage.removeItem(PENDING); return raw ? JSON.parse(raw) as SagaDraft : null; } catch { return null; }
}

export function SagaWidget({ clerk, firstName, path }: { clerk: ClerkBrowser; firstName: string; path: string }) {
  const onEvents = path.replace(/\/+$/, "") === "/member-portal/events";
  const greeting = `Hej${firstName ? " " + firstName : ""}! Har du brug for hjælp til at sætte dit event op? Jeg kan også gøre det for dig – fortæl mig bare, hvad du har i tankerne: hvad, hvornår og for hvem.`;
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([{ role: "assistant", text: onEvents ? greeting : `Hej${firstName ? " " + firstName : ""}! Jeg er Saga. Spørg mig om alt i Hjerterum – medlemskab, events, salen, foreningen – eller lad mig sætte et event op for dig.` }]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!onEvents || window.matchMedia("(max-width: 760px)").matches) return;
    try { if (sessionStorage.getItem(POPPED)) return; } catch { /* no storage: still pop once */ }
    const timer = window.setTimeout(() => { setOpen(true); try { sessionStorage.setItem(POPPED, "1"); } catch { /* ignore */ } }, 15_000);
    return () => window.clearTimeout(timer);
  }, [onEvents]);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }); }, [messages, open]);
  async function send(photo?: Photo) {
    const question = text.trim() || (photo ? "Kan du se på dette foto til mit event?" : "");
    if (!question || busy) return;
    const next: Message[] = [...messages, { role: "user", text: question, ...(photo ? { photo } : {}) }];
    setMessages(next); setText(""); setBusy(true);
    try {
      const response = await apiFetch(clerk, "/api/members/saga/chat", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          // Earlier photos are only named, so each one is looked at once.
          page: path,
          messages: next.map(({ role, text, photo: p }) => ({ role, text: p && p !== photo ? `${text} [Foto: ${p.file.name}, ${p.width} × ${p.height} px]` : text })),
          ...(photo ? { photo: { dataUrl: photo.dataUrl, name: photo.file.name, type: photo.file.type, bytes: photo.file.size, width: photo.width, height: photo.height } } : {})
        }) });
      const body = await response.json().catch(() => ({})) as { reply?: string; draft?: SagaDraft | null; photo?: { ok: boolean } | null; error?: string };
      setMessages([...next, { role: "assistant", text: body.reply ?? (body.error === "membership_required" ? "Jeg kan hjælpe, når dit medlemskab med medlemsfordele er aktivt." : "Jeg kan ikke svare lige nu. Prøv igen om lidt."),
        draft: body.draft ?? null, ...(photo && body.photo ? { photoOk: body.photo.ok, forPhoto: photo } : {}) }]);
    } catch { setMessages([...next, { role: "assistant", text: "Jeg kan ikke svare lige nu. Prøv igen om lidt." }]); }
    finally { setBusy(false); }
  }
  async function pickPhoto(file: File | undefined) {
    if (!file || busy) return;
    const photo = await preparePhoto(file);
    if (!photo) { setMessages((m) => [...m, { role: "assistant", text: "Det billede kan jeg ikke åbne. Prøv med en jpg eller png." }]); return; }
    await send(photo);
  }
  function applyCover(photo: Photo) {
    window.dispatchEvent(new CustomEvent(COVER_EVENT, { detail: photo.file }));
    setMessages((m) => [...m, { role: "assistant", text: "Så er fotoet sat på som eventfoto og beskåret til 1920 × 1005 px. Kig det igennem i formularen." }]);
  }
  function fill(draft: SagaDraft) {
    if (onEvents) { window.dispatchEvent(new CustomEvent(DRAFT_EVENT, { detail: draft })); setMessages((m) => [...m, { role: "assistant", text: "Så er formularen udfyldt. Kig den igennem, tilføj gerne et billede, og tryk på knappen nederst, når du er klar." }]); return; }
    try { sessionStorage.setItem(PENDING, JSON.stringify(draft)); } catch { /* ignore */ }
    window.location.assign("/member-portal/events");
  }
  return (
    <div className={"saga-widget" + (open ? " is-open" : "")}>
      {open && <section className="saga-panel" aria-label="Spørg Saga">
        <header><strong>Spørg Saga</strong><span>Hjerterums assistent</span><button type="button" aria-label="Luk" onClick={() => setOpen(false)}>×</button></header>
        <div className="saga-messages" ref={list}>
          {messages.map((m, i) => <div key={i} className={"saga-msg " + m.role}>{m.photo && <img className="saga-photo" src={m.photo.preview} alt="" />}<p>{m.text}</p>
            {m.forPhoto && m.photoOk && onEvents && <div className="saga-draft"><span>Fotoet er godkendt.</span>
              <button type="button" className="pill-button dark" onClick={() => applyCover(m.forPhoto!)}>Brug som eventfoto</button></div>}
            {m.draft && <div className="saga-draft"><b>{m.draft.title}</b><span>{m.draft.date} · {m.draft.start}–{m.draft.end}</span>
              <button type="button" className="pill-button dark" onClick={() => fill(m.draft!)}>Udfyld formularen</button></div>}</div>)}
          {busy && <div className="saga-msg assistant"><p className="saga-typing">Saga skriver …</p></div>}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <input ref={picker} type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void pickPhoto(f); }} />
          <button type="button" className="saga-attach" disabled={busy} onClick={() => picker.current?.click()} aria-label="Vedhæft foto til Saga" title="Vedhæft et foto, så ser Saga på det">Foto</button>
          <textarea rows={2} value={text} placeholder="Spørg Saga …" onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
          <button className="pill-button dark" disabled={busy || !text.trim()}>Send</button>
        </form>
      </section>}
      {!open && <button type="button" className="saga-bubble" onClick={() => setOpen(true)} aria-label="Spørg Saga">Spørg Saga</button>}
    </div>
  );
}
