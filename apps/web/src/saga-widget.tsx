import { useEffect, useRef, useState } from "react";
import { apiFetch, type ClerkBrowser } from "./clerk";

/** Requested: "Vi skal have en Saga chatwidget på medlemssiden. Hun skal poppe op på Opret event-siden efter 15 sekunder og spørge brugeren,
 * om han/hun har brug for hjælp til at sætte eventet op. Hun skal også tilbyde at gøre det for brugeren." Not on phones by itself
 * ("Chat skal ikke poppe op på mobiler"); once a visit; a draft fills the form on Opret event, and the member still presses Opret. */
export type SagaDraft = { title: string; description: string; date: string; start: string; end: string; booking_type: "standard" | "reduced" | "free";
  max_attendees: number | null; member_price_kr: number | null; non_member_price_kr: number | null };
type Message = { role: "user" | "assistant"; text: string; draft?: SagaDraft | null };

export const DRAFT_EVENT = "saga-event-draft";
const PENDING = "saga_pending_draft";
const POPPED = "saga_popped";

export function takePendingDraft(): SagaDraft | null {
  try { const raw = sessionStorage.getItem(PENDING); sessionStorage.removeItem(PENDING); return raw ? JSON.parse(raw) as SagaDraft : null; } catch { return null; }
}

export function SagaWidget({ clerk, firstName, path }: { clerk: ClerkBrowser; firstName: string; path: string }) {
  const onEvents = path.replace(/\/+$/, "") === "/member-portal/events";
  const greeting = `Hej${firstName ? " " + firstName : ""}! Har du brug for hjælp til at sætte dit event op? Jeg kan også gøre det for dig – fortæl mig bare, hvad du har i tankerne: hvad, hvornår og for hvem.`;
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([{ role: "assistant", text: onEvents ? greeting : `Hej${firstName ? " " + firstName : ""}! Jeg er Saga. Spørg mig om events, salen eller dit medlemskab – eller lad mig sætte et event op for dig.` }]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!onEvents || window.matchMedia("(max-width: 760px)").matches) return;
    try { if (sessionStorage.getItem(POPPED)) return; } catch { /* no storage: still pop once */ }
    const timer = window.setTimeout(() => { setOpen(true); try { sessionStorage.setItem(POPPED, "1"); } catch { /* ignore */ } }, 15_000);
    return () => window.clearTimeout(timer);
  }, [onEvents]);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }); }, [messages, open]);
  async function send() {
    const question = text.trim();
    if (!question || busy) return;
    const next: Message[] = [...messages, { role: "user", text: question }];
    setMessages(next); setText(""); setBusy(true);
    try {
      const response = await apiFetch(clerk, "/api/members/saga/chat", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next.map(({ role, text }) => ({ role, text })) }) });
      const body = await response.json().catch(() => ({})) as { reply?: string; draft?: SagaDraft | null; error?: string };
      setMessages([...next, { role: "assistant", text: body.reply ?? (body.error === "membership_required" ? "Jeg kan hjælpe, når dit medlemskab med medlemsfordele er aktivt." : "Jeg kan ikke svare lige nu. Prøv igen om lidt."), draft: body.draft ?? null }]);
    } catch { setMessages([...next, { role: "assistant", text: "Jeg kan ikke svare lige nu. Prøv igen om lidt." }]); }
    finally { setBusy(false); }
  }
  function fill(draft: SagaDraft) {
    if (onEvents) { window.dispatchEvent(new CustomEvent(DRAFT_EVENT, { detail: draft })); setMessages((m) => [...m, { role: "assistant", text: "Så er formularen udfyldt. Kig den igennem, tilføj gerne et billede, og tryk på knappen nederst, når du er klar." }]); return; }
    try { sessionStorage.setItem(PENDING, JSON.stringify(draft)); } catch { /* ignore */ }
    window.location.assign("/member-portal/events");
  }
  return (
    <div className={"saga-widget" + (open ? " is-open" : "")}>
      {open && <section className="saga-panel" aria-label="Chat med Saga">
        <header><strong>Saga</strong><span>Hjerterums assistent</span><button type="button" aria-label="Luk" onClick={() => setOpen(false)}>×</button></header>
        <div className="saga-messages" ref={list}>
          {messages.map((m, i) => <div key={i} className={"saga-msg " + m.role}><p>{m.text}</p>
            {m.draft && <div className="saga-draft"><b>{m.draft.title}</b><span>{m.draft.date} · {m.draft.start}–{m.draft.end}</span>
              <button type="button" className="pill-button dark" onClick={() => fill(m.draft!)}>Udfyld formularen</button></div>}</div>)}
          {busy && <div className="saga-msg assistant"><p className="saga-typing">Saga skriver …</p></div>}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <textarea rows={2} value={text} placeholder="Skriv til Saga …" onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
          <button className="pill-button dark" disabled={busy || !text.trim()}>Send</button>
        </form>
      </section>}
      {!open && <button type="button" className="saga-bubble" onClick={() => setOpen(true)} aria-label="Chat med Saga">Saga</button>}
    </div>
  );
}
