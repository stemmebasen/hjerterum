import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { apiFetch, type ClerkBrowser } from "./clerk";
import { cropCover } from "./cover-crop";
import { SIGNUP_URL } from "../site/pages";

/** Requested: "Vi skal have en Saga chatwidget på medlemssiden. Hun skal poppe op på Opret event-siden efter 15 sekunder og spørge brugeren,
 * om han/hun har brug for hjælp til at sætte eventet op. Hun skal også tilbyde at gøre det for brugeren." Not on phones by itself
 * ("Chat skal ikke poppe op på mobiler"); once a visit.
 *
 * Then: "Sørg for at implementer Saga chat widget på alle tre sider - og med de permissions der giver mening for de tre. Saga skal kunne
 * hjælpe med opsætning af event i medlem. og også kunne modtage billeder direkte i chatten. Hun skal være yderst hjælpsom og kunne bringe
 * eventet online (hvis hun vurderer det passer til hjerterum). På den offentlige hjemmeside uden login må hun gerne tilbyde at hjælpe med
 * både medlemskab og event opsætning men skal bede brugeren om at blive medlem og logge ind først. Kan hun huske samtalen før og efter login".
 * - mode "public": the website, no login (worker/web-saga.ts). No photos, no drafts; her answer can carry a button to become a member or log in.
 * - mode "member": the member area (worker/member-saga.ts). A member with benefits gets drafts, photos, and "Opret og læg online"
 *   (worker/member-saga-event.ts); someone logged in without such a membership gets the website's help to become one.
 * The conversation is kept on the server; its id is kept here and rides in the login link (?saga=) from www. to medlem. */
export type SagaDraft = { title: string; description: string; date: string; start: string; end: string; booking_type: "standard" | "reduced" | "free";
  max_attendees: number | null; member_price_kr: number | null; non_member_price_kr: number | null; contact_share?: "email" | "phone" | "both" | null };
/** Requested: "Man skal også kunne uploade fotos, som Saga skal godkende i forhold til kvalitet, format og opløsning." The browser
 * measures the photo and sends Saga a smaller copy to look at; an approved photo can become the event's cover. */
export type Photo = { file: File; preview: string; dataUrl: string; width: number; height: number };
type Action = "login" | "membership";
type Message = { role: "user" | "assistant"; text: string; draft?: SagaDraft | null; photo?: Photo; photoOk?: boolean; forPhoto?: Photo; action?: Action | null; created?: boolean };

export const DRAFT_EVENT = "saga-event-draft";
/** An approved photo for the event being created: event-files' cover crop takes it from here (workspaces.tsx). */
export const COVER_EVENT = "saga-event-cover";
/** Saga created an event: Mine events reloads its list. */
export const CREATED_EVENT = "saga-event-created";
const LOOK_SIZE = 1280;
const CONVERSATION = "saga_conversation";
const CONVERSATION_ID = /^[A-Za-z0-9_-]{22,64}$/;

export function storedConversation(): string | null {
  try { const id = localStorage.getItem(CONVERSATION); return id && CONVERSATION_ID.test(id) ? id : null; } catch { return null; }
}
function storeConversation(id: string | null | undefined) {
  if (!id || !CONVERSATION_ID.test(id)) return;
  try { localStorage.setItem(CONVERSATION, id); } catch { /* the conversation is then kept for this page only */ }
}

/** On every page load: a conversation id in the address (?saga=, from the website's login link) is kept, and taken out of the address. */
export function captureSagaConversation(): void {
  try {
    const url = new URL(window.location.href);
    const id = url.searchParams.get("saga");
    if (!id) return;
    storeConversation(id);
    url.searchParams.delete("saga");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  } catch { /* ignore */ }
}

/** The login link that carries the conversation along to the member area (medlem.), landing on Mine events. */
export function sagaLoginHref(target = "/member-portal/events"): string {
  const id = storedConversation();
  return id ? `${target}${target.includes("?") ? "&" : "?"}saga=${encodeURIComponent(id)}` : target;
}

export async function preparePhoto(file: File): Promise<Photo | null> {
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
const OPEN = "saga_open";
const LANG = "saga_lang";
type Lang = "da" | "en";
/** Requested: "I chattens top bør være en EN knap (engelsk)". The chosen language is remembered; on the website's English pages she starts in English. */
function startLang(path: string): Lang {
  try { const saved = localStorage.getItem(LANG); if (saved === "da" || saved === "en") return saved; } catch { /* ignore */ }
  return /^\/en(?:\/|$)/.test(path) ? "en" : "da";
}

/** Requested: "De sider hun linker til bør være aktive links og understreget på en tydelig måde". Her [name](address) and bare addresses become
 * links - only to Hjerterum's own pages (a path on this site), hjerterum.info, holistisk.org and cirkler.net. Anything else stays plain text. */
const ALLOWED = /^(?:\/(?!\/)[^\s)]*|https:\/\/(?:[a-z0-9-]+\.)*(?:hjerterum\.info|holistisk\.org|cirkler\.net)(?:[/?#][^\s)]*)?)$/i;
export function withLinks(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /\[([^\]\n]{1,120})\]\(([^)\s]{1,300})\)|(https:\/\/[^\s)]+[^\s).,!?:;])/g;
  let last = 0, match: RegExpExecArray | null, n = 0;
  while ((match = pattern.exec(text))) {
    const [all, label, href, bare] = match;
    const url = (href ?? bare ?? "").trim();
    out.push(text.slice(last, match.index));
    if (ALLOWED.test(url)) {
      const external = url.startsWith("http") && !url.includes(window.location.host);
      out.push(<a key={n++} className="saga-link" href={url} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{label ?? url.replace(/^https:\/\/(www\.)?/, "")}</a>);
    } else out.push(label ?? all);
    last = match.index + all.length;
  }
  out.push(text.slice(last));
  return out.map((part, i) => typeof part === "string" ? <Fragment key={"t" + i}>{part}</Fragment> : part);
}

export function takePendingDraft(): SagaDraft | null {
  try { const raw = sessionStorage.getItem(PENDING); sessionStorage.removeItem(PENDING); return raw ? JSON.parse(raw) as SagaDraft : null; } catch { return null; }
}

/** What she said before, without the notes the server keeps for her ([Udkast: ...], [Foto ...]). */
const shown = (text: string) => text.replace(/\s*\[(?:Udkast|Foto|Trykkede)[^\]]*\]/g, "").trim();

type Props = { mode: "public"; path: string } | { mode: "member"; path: string; clerk: ClerkBrowser; firstName: string; canCreate: boolean };

export function SagaWidget(props: Props) {
  const { mode, path } = props;
  const member = props.mode === "member" ? props : null;
  const canCreate = Boolean(member?.canCreate);
  const firstName = member?.firstName ?? "";
  const onEvents = mode === "member" && path.replace(/\/+$/, "") === "/member-portal/events";
  const [lang, setLang] = useState<Lang>(() => startLang(path));
  const en = lang === "en";
  const t = (da: string, english: string) => en ? english : da;
  const greetingFor = (english: boolean) => english
    ? mode === "public" ? "Hi! I'm Saga, Hjerterum's assistant. Ask me about the house, events, membership or renting the hall – and if you'd like to host your own event, I'll gladly help you get started."
      : onEvents && canCreate ? `Hi${firstName ? " " + firstName : ""}! Do you need help setting up your event? I can also do all of it for you – just tell me what you have in mind: what, when and for whom.`
      : `Hi${firstName ? " " + firstName : ""}! I'm Saga. Ask me anything about Hjerterum – membership, events, the hall, the association${canCreate ? " – or let me set up an event for you" : ""}.`
    : mode === "public" ? "Hej! Jeg er Saga, Hjerterums assistent. Spørg mig om huset, events, medlemskab eller leje af salen – og vil du lave dit eget event, hjælper jeg dig gerne i gang."
      : onEvents && canCreate ? `Hej${firstName ? " " + firstName : ""}! Har du brug for hjælp til at sætte dit event op? Jeg kan også gøre det hele for dig – fortæl mig bare, hvad du har i tankerne: hvad, hvornår og for hvem.`
      : `Hej${firstName ? " " + firstName : ""}! Jeg er Saga. Spørg mig om alt i Hjerterum – medlemskab, events, salen, foreningen${canCreate ? " – eller lad mig sætte et event op for dig" : ""}.`;
  const greeting = greetingFor(en);
  // Requested: "Saga samtalen skal stadig ses når man kommer på ny side" - open on one page, open on the next, with the conversation.
  const [open, setOpen] = useState(() => { try { return sessionStorage.getItem(OPEN) === "1"; } catch { return false; } });
  useEffect(() => { try { if (open) sessionStorage.setItem(OPEN, "1"); else sessionStorage.removeItem(OPEN); } catch { /* ignore */ } }, [open]);
  const [messages, setMessages] = useState<Message[]>([{ role: "assistant", text: greeting }]);
  const [conversation, setConversation] = useState<string | null>(() => storedConversation());
  const [loaded, setLoaded] = useState(false);
  const [approved, setApproved] = useState<Photo | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  /** EN / DA: the window switches, and her answers follow (the server is told the language). Her greeting changes with it. */
  function switchLang() {
    const next: Lang = en ? "da" : "en";
    setLang(next);
    try { localStorage.setItem(LANG, next); } catch { /* ignore */ }
    setMessages((m) => m.length && m[0]!.role === "assistant" && m[0]!.text === greetingFor(en) ? [{ ...m[0]!, text: greetingFor(!en) }, ...m.slice(1)] : m);
  }
  const list = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const endpoint = mode === "public" ? "/api/site/saga/chat" : "/api/members/saga/chat";
  const call = (input: string, init: RequestInit = {}) => member ? apiFetch(member.clerk, input, init) : fetch(input, init);

  // Reported: "Chat widget springer op ad sig selv" - it opened by itself after 15 seconds on Mine events. "Opret med Saga" is on
  // that page now, so the bubble only opens when it is pressed.
  // Requested: "Kan hun huske samtalen før og efter login": the conversation so far, from the server, the first time she opens.
  useEffect(() => {
    if (!open || loaded) return;
    setLoaded(true);
    if (mode === "public" && !conversation) return;
    void call(`${endpoint}${conversation ? `?conversation=${encodeURIComponent(conversation)}` : ""}`).then(async (response) => {
      if (!response.ok) return;
      const body = await response.json().catch(() => ({})) as { conversation?: string | null; messages?: Array<{ role: "user" | "assistant"; text: string }> };
      if (body.conversation) { storeConversation(body.conversation); setConversation(body.conversation); }
      const before = (body.messages ?? []).map((m) => ({ role: m.role, text: shown(m.text) })).filter((m) => m.text);
      if (before.length) setMessages((now) => [...before, ...now.slice(1), ...(now.length === 1 ? [{ role: "assistant" as const, text: mode === "member" ? "Velkommen tilbage – vi kan fortsætte, hvor vi slap." : "Velkommen tilbage!" }] : [])]);
    }).catch(() => undefined);
  }, [open]);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }); }, [messages, open]);

  async function send(photo?: Photo) {
    const question = text.trim() || (photo ? "Kan du se på dette foto til mit event?" : "");
    if (!question || busy) return;
    const next: Message[] = [...messages, { role: "user", text: question, ...(photo ? { photo } : {}) }];
    setMessages(next); setText(""); setBusy(true);
    try {
      const response = await call(endpoint, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversation, text: question, page: path, lang,
          ...(photo ? { photo: { dataUrl: photo.dataUrl, name: photo.file.name, type: photo.file.type, bytes: photo.file.size, width: photo.width, height: photo.height } } : {})
        }) });
      const body = await response.json().catch(() => ({})) as { conversation?: string; reply?: string; draft?: SagaDraft | null; photo?: { ok: boolean } | null; action?: Action | null; error?: string };
      if (body.conversation) { storeConversation(body.conversation); setConversation(body.conversation); }
      if (photo && body.photo?.ok) setApproved(photo);
      setMessages([...next, { role: "assistant", text: body.reply ?? t("Jeg kan ikke svare lige nu. Prøv igen om lidt.", "I can't answer right now. Please try again in a moment."),
        draft: canCreate ? body.draft ?? null : null, action: body.action ?? null, ...(photo && body.photo ? { photoOk: body.photo.ok, forPhoto: photo } : {}) }]);
    } catch { setMessages([...next, { role: "assistant", text: t("Jeg kan ikke svare lige nu. Prøv igen om lidt.", "I can't answer right now. Please try again in a moment.") }]); }
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
  /** "Opret og læg online": the member's yes. Saga creates the event with the approved photo, and judges at once whether it goes online. */
  async function create(draft: SagaDraft, index: number) {
    if (!member || busy) return;
    setBusy(true);
    setMessages((m) => m.map((x, i) => i === index ? { ...x, created: true } : x));
    try {
      const form = new FormData();
      if (conversation) form.append("conversation", conversation);
      form.append("draft", JSON.stringify(draft));
      let photoNote = "";
      if (approved) {
        const cropped = await cropCover(approved.file);
        if (cropped.ok) form.append("cover", cropped.file); else photoNote = ` (Fotoet kunne ikke beskæres: ${cropped.reason})`;
      }
      const response = await apiFetch(member.clerk, "/api/members/saga/event", { method: "POST", body: form });
      const body = await response.json().catch(() => ({})) as { conversation?: string; reply?: string; id?: number; error?: string };
      if (body.conversation) { storeConversation(body.conversation); setConversation(body.conversation); }
      if (body.id) { setApproved(null); window.dispatchEvent(new CustomEvent(CREATED_EVENT, { detail: body.id })); }
      else setMessages((m) => m.map((x, i) => i === index ? { ...x, created: false } : x));
      setMessages((m) => [...m, { role: "assistant", text: (body.reply ?? "Eventet kunne ikke oprettes lige nu. Prøv igen om lidt.") + photoNote }]);
    } catch {
      setMessages((m) => [...m.map((x, i) => i === index ? { ...x, created: false } : x), { role: "assistant", text: "Eventet kunne ikke oprettes lige nu. Prøv igen om lidt." }]);
    } finally { setBusy(false); }
  }
  return (
    <div className={"saga-widget" + (open ? " is-open" : "")}>
      {open && <section className="saga-panel" aria-label={t("Spørg Saga", "Ask Saga")} lang={lang}>
        <header><strong>{t("Spørg Saga", "Ask Saga")}</strong><span>{t("Hjerterums assistent", "Hjerterum's assistant")}</span>
          <button type="button" className="saga-lang" onClick={switchLang} aria-label={en ? "Skift til dansk" : "Switch to English"} title={en ? "Dansk" : "English"}>{en ? "DA" : "EN"}</button>
          <button type="button" className="saga-close" aria-label={t("Luk", "Close")} onClick={() => setOpen(false)}>×</button></header>
        <div className="saga-messages" ref={list}>
          {messages.map((m, i) => <div key={i} className={"saga-msg " + m.role}>{m.photo && <img className="saga-photo" src={m.photo.preview} alt="" />}<p>{m.role === "assistant" ? withLinks(m.text) : m.text}</p>
            {m.forPhoto && m.photoOk && <div className="saga-draft"><span>{t("Fotoet er godkendt", "The photo is approved")}{canCreate ? t(" og kommer med, når du opretter eventet her", " and comes along when you create the event here") : ""}.</span>
              {onEvents && <button type="button" className="pill-button dark" onClick={() => applyCover(m.forPhoto!)}>{t("Brug i formularen", "Use in the form")}</button>}</div>}
            {m.draft && <div className="saga-draft"><b>{m.draft.title}</b><span>{m.draft.date} · {m.draft.start}–{m.draft.end}</span>
              <span className="saga-note">{en ? `"Create and publish" books the hall${approved ? " with the approved photo" : ""}. If the event fits Hjerterum, it goes online right away.` : `"Opret og læg online" reserverer salen${approved ? " med det godkendte foto" : ""}. Passer eventet til Hjerterum, kommer det online med det samme.`}</span>
              <div className="saga-actions">
                <button type="button" className="pill-button dark" disabled={busy || m.created} onClick={() => void create(m.draft!, i)}>{m.created ? t("Oprettet", "Created") : t("Opret og læg online", "Create and publish")}</button>
                <button type="button" className="pill-button" disabled={busy} onClick={() => fill(m.draft!)}>{t("Udfyld formularen", "Fill in the form")}</button>
              </div></div>}
            {m.action && <div className="saga-actions">
              {m.action === "membership" && <a className="pill-button dark" href={en ? "https://holistisk.org/become-a-member/" : SIGNUP_URL} target="_blank" rel="noopener noreferrer">{t("Bliv medlem", "Become a member")}</a>}
              {(m.action === "login" || (m.action === "membership" && mode === "public")) && <a className="pill-button" href={sagaLoginHref()}>{t("Log ind", "Log in")}</a>}
            </div>}</div>)}
          {busy && <div className="saga-msg assistant"><p className="saga-typing">{t("Saga skriver …", "Saga is writing …")}</p></div>}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); void send(); }}>
          {canCreate && <>
            <input ref={picker} type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void pickPhoto(f); }} />
            <button type="button" className="saga-attach" disabled={busy} onClick={() => picker.current?.click()} aria-label={t("Vedhæft foto til Saga", "Attach a photo for Saga")} title={t("Vedhæft et foto, så ser Saga på det", "Attach a photo and Saga will look at it")}>{t("Foto", "Photo")}</button>
          </>}
          <textarea rows={2} value={text} placeholder={t("Spørg Saga …", "Ask Saga …")} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
          <button className="pill-button dark" disabled={busy || !text.trim()}>Send</button>
        </form>
        <p className="saga-privacy">{t("Saga er en AI. Hun husker samtalen i op til 30 dage – også når du logger ind – men ikke dine fotos.", "Saga is an AI. She remembers the conversation for up to 30 days – also when you log in – but not your photos.")}</p>
      </section>}
      {!open && <button type="button" className="saga-bubble" onClick={() => setOpen(true)} aria-label={t("Spørg Saga", "Ask Saga")}>{t("Spørg Saga", "Ask Saga")}</button>}
    </div>
  );
}
