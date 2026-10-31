import { useEffect, useRef, useState } from "react";
import { apiFetch, type ClerkBrowser } from "./clerk";
import { cropCover } from "./cover-crop";
import { preparePhoto, withLinks, type Photo, type SagaDraft } from "./saga-widget";

/** Requested: "Dette skal føles mere intuitivt og moderne. Man skal have mulighed for blot at skrive et brief og så få Saga til at
 * hjælpe med at færdiggøre eventet. En alternativ oprettelse hvor Saga bare stiller nødvendige spørgsmål (titel, indhold, pris,
 * tidspunkt, skal det deles på sociale medier, upload billeder) og så til sidst kommer med forslag til tekst og beskrivelse."
 * "Opret med Saga": a brief, then her questions one at a time (worker/member-saga.ts GUIDED), a checklist that fills as she learns,
 * and at the end her proposal - created at once, or put in the form to finish by hand. */

type Step = "brief" | "titel" | "indhold" | "tid" | "pris" | "sociale" | "billeder";
const STEPS: Array<[Step, string]> = [["brief", "Dit brief"], ["titel", "Titel"], ["indhold", "Indhold"], ["tid", "Tidspunkt"], ["pris", "Pris og pladser"], ["sociale", "Sociale medier"], ["billeder", "Billeder"]];
type Guide = { progress: Record<Step, boolean>; social: boolean | null; suggestions: string[] };
type Message = { role: "user" | "assistant"; text: string; photo?: string };

const KEY = "hjerterum-saga-guide";
const EMPTY: Guide = { progress: { brief: false, titel: false, indhold: false, tid: false, pris: false, sociale: false, billeder: false }, social: null, suggestions: [] };
const BRIEF_EXAMPLE = "Fx: En aften med yin yoga og lydbad en onsdag i november, ca. to timer, for begyndere. Gratis for medlemmer, 120 kr. for andre.";

const kr = (n: number | null) => n === null ? "–" : n === 0 ? "gratis" : `${n} kr.`;
const longDay = (date: string) => capital(new Intl.DateTimeFormat("da-DK", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Copenhagen" }).format(new Date(`${date}T12:00:00`)));
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function SagaEventGuide({ clerk, firstName, onFillForm, onCreated }: {
  clerk: ClerkBrowser; firstName: string; onFillForm: (draft: SagaDraft, photo: File | null) => void; onCreated: (id: number) => void;
}) {
  const [conversation, setConversation] = useState<string | null>(() => { try { return sessionStorage.getItem(KEY); } catch { return null; } });
  const [messages, setMessages] = useState<Message[]>([]);
  const [guide, setGuide] = useState<Guide>(EMPTY);
  const [draft, setDraft] = useState<SagaDraft | null>(null);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ id: number; text: string } | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" }); }, [messages, busy, draft]);

  async function ask(question: string, attached?: Photo) {
    const said = question.trim() || (attached ? "Her er et foto til eventet." : "");
    if (!said || busy) return;
    setMessages((m) => [...m, { role: "user", text: said, ...(attached ? { photo: attached.preview } : {}) }]);
    setText(""); setBusy(true);
    try {
      const response = await apiFetch(clerk, "/api/members/saga/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        conversation, text: said, page: "/member-portal/events", lang: "da", guided: true,
        ...(attached ? { photo: { dataUrl: attached.dataUrl, name: attached.file.name, type: attached.file.type, bytes: attached.file.size, width: attached.width, height: attached.height } } : {})
      }) });
      const body = await response.json().catch(() => ({})) as { conversation?: string; reply?: string; draft?: SagaDraft | null; photo?: { ok: boolean } | null; guide?: Guide };
      if (body.conversation) { setConversation(body.conversation); try { sessionStorage.setItem(KEY, body.conversation); } catch { /* ignore */ } }
      if (attached && body.photo?.ok) setPhoto(attached);
      if (body.guide) setGuide({ ...body.guide, progress: { ...body.guide.progress, brief: true, ...(attached && body.photo?.ok ? { billeder: true } : {}) } });
      if (body.draft) setDraft(body.draft);
      setMessages((m) => [...m, { role: "assistant", text: body.reply ?? "Jeg kan ikke svare lige nu. Prøv igen om lidt." }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", text: "Jeg kan ikke svare lige nu. Prøv igen om lidt." }]);
    } finally { setBusy(false); }
  }

  async function attach(file: File | undefined) {
    if (!file || busy) return;
    const prepared = await preparePhoto(file);
    if (!prepared) { setMessages((m) => [...m, { role: "assistant", text: "Det billede kan jeg ikke åbne. Prøv med en jpg eller png." }]); return; }
    await ask(text, prepared);
  }

  /** "Opret og læg online": Saga creates the event with the approved photo and judges at once whether it goes online (member-saga-event.ts). */
  async function create() {
    if (!draft || busy) return;
    setBusy(true);
    try {
      const form = new FormData();
      if (conversation) form.append("conversation", conversation);
      form.append("draft", JSON.stringify(draft));
      if (photo) { const cropped = await cropCover(photo.file); if (cropped.ok) form.append("cover", cropped.file); }
      const response = await apiFetch(clerk, "/api/members/saga/event", { method: "POST", body: form });
      const body = await response.json().catch(() => ({})) as { reply?: string; id?: number };
      if (body.id) {
        setCreated({ id: body.id, text: body.reply ?? "Eventet er oprettet." });
        try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
        onCreated(body.id);
      } else setMessages((m) => [...m, { role: "assistant", text: body.reply ?? "Eventet kunne ikke oprettes lige nu. Prøv igen om lidt." }]);
    } catch { setMessages((m) => [...m, { role: "assistant", text: "Eventet kunne ikke oprettes lige nu. Prøv igen om lidt." }]); }
    finally { setBusy(false); }
  }

  function restart() {
    try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
    setConversation(null); setMessages([]); setGuide(EMPTY); setDraft(null); setPhoto(null); setCreated(null); setText("");
  }

  const started = messages.length > 0;
  const done = STEPS.filter(([key]) => guide.progress[key]).length;

  if (created) return <section className="guide guide-done">
    <p className="lys-kicker">Opret med Saga</p>
    <h2>Dit event er oprettet</h2>
    <p className="guide-lead">{created.text}</p>
    <div className="guide-buttons">
      {guide.social !== false && <a className="pill-button dark" href={`/plakat/h${created.id}`}>Se dine opslag til Instagram og Facebook</a>}
      <button type="button" className="pill-button" onClick={restart}>Opret et nyt event</button>
    </div>
  </section>;

  return <section className="guide" aria-label="Opret med Saga">
    <div className="guide-main">
      {!started ? <form className="guide-brief" onSubmit={(e) => { e.preventDefault(); void ask(text); }}>
        <p className="lys-kicker">Opret med Saga</p>
        <h2>{firstName ? `Hej ${firstName} – fortæl om dit event` : "Fortæl om dit event"}</h2>
        <p className="guide-lead">Skriv frit, som du ville fortælle det til en ven: hvad det er, hvornår, for hvem og hvad det koster. Saga spørger om det, der mangler, finder en ledig tid og skriver teksten til dig.</p>
        <textarea rows={5} value={text} placeholder={BRIEF_EXAMPLE} onChange={(e) => setText(e.target.value)} autoFocus />
        <div className="guide-buttons"><button className="pill-button dark" disabled={!text.trim() || busy}>{busy ? "Saga læser …" : "Start med Saga"}</button></div>
      </form> : <>
        <div className="guide-messages" ref={list} aria-live="polite">
          {messages.map((m, i) => <div key={i} className={"guide-msg " + m.role}>{m.photo && <img src={m.photo} alt="" />}<p>{m.role === "assistant" ? withLinks(m.text) : m.text}</p></div>)}
          {busy && <div className="guide-msg assistant"><p className="guide-typing"><span /><span /><span /></p></div>}
          {draft && !busy && <article className="guide-proposal">
            <p className="lys-kicker">Sagas forslag</p>
            {photo && <img className="guide-proposal-photo" src={photo.preview} alt="" />}
            <h3>{draft.title}</h3>
            <p className="guide-when">{longDay(draft.date)} · kl. {draft.start.replace(":", ".")}–{draft.end.replace(":", ".")}</p>
            <dl className="guide-facts">
              <div><dt>Medlemmer</dt><dd>{kr(draft.member_price_kr ?? 0)}</dd></div>
              <div><dt>Ikke-medlemmer</dt><dd>{kr(draft.non_member_price_kr ?? draft.member_price_kr ?? 0)}</dd></div>
              <div><dt>Pladser</dt><dd>{draft.max_attendees ?? "ingen grænse"}</dd></div>
              <div><dt>Sociale medier</dt><dd>{guide.social === false ? "Nej" : guide.social ? "Ja" : "–"}</dd></div>
            </dl>
            <p className="guide-description">{draft.description}</p>
            <div className="guide-buttons">
              <button type="button" className="pill-button dark" disabled={busy} onClick={() => void create()}>Opret og læg online</button>
              <button type="button" className="pill-button" onClick={() => onFillForm(draft, photo?.file ?? null)}>Ret selv i formularen</button>
            </div>
            <small>Passer eventet til Hjerterum, kommer det online med det samme - ellers ser bestyrelsen på det. Du kan altid rette det under Mine events.</small>
          </article>}
        </div>
        {guide.suggestions.length > 0 && !busy && <div className="guide-chips">{guide.suggestions.map((s) => <button key={s} type="button" onClick={() => void ask(s)}>{s}</button>)}</div>}
        <form className="guide-input" onSubmit={(e) => { e.preventDefault(); void ask(text); }}>
          <input ref={picker} type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void attach(f); }} />
          <button type="button" className="guide-attach" disabled={busy} onClick={() => picker.current?.click()}>Tilføj foto</button>
          <textarea rows={1} value={text} placeholder="Svar Saga …" onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(text); } }} />
          <button className="pill-button dark" disabled={busy || !text.trim()}>Send</button>
        </form>
      </>}
    </div>
    <aside className="guide-steps" aria-label="Det skal Saga vide">
      <p className="lys-kicker">{started ? `${done} af ${STEPS.length} på plads` : "Det spørger Saga om"}</p>
      <ol>{STEPS.map(([key, label]) => <li key={key} className={guide.progress[key] ? "is-done" : ""}><span aria-hidden="true">{guide.progress[key] ? "✓" : ""}</span>{label}</li>)}</ol>
      {photo && <img className="guide-steps-photo" src={photo.preview} alt="Det godkendte eventfoto" />}
      {started && <button type="button" className="text-button" onClick={restart}>Start forfra</button>}
    </aside>
  </section>;
}
