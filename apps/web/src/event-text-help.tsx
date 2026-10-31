import { useEffect, useState, type RefObject } from "react";
import { apiFetch, type ClerkBrowser } from "./clerk";
import { MIN_EVENT_WORDS, wordCount } from "../site/event-text";

/** Requested: "Saga skal gå ind og vurdere eventet både i forhold til indhold og sprog, men ikke mindst i forhold til, at vi får en
 * flot eventtekst med et minimumsantal på 75 ord." Under the description: the words so far against the minimum, and Saga's reading
 * of the text (content and language) with a better version to use if the member likes it (worker/event-text.ts). */
export function EventTextHelp({ clerk, field, title }: { clerk: ClerkBrowser; field: RefObject<HTMLTextAreaElement | null>; title: string }) {
  const [words, setWords] = useState(0);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<{ notes: string[]; improved: string; improvedWords: number } | null>(null);
  const [problem, setProblem] = useState("");
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    const count = () => setWords(wordCount(el.value));
    count();
    el.addEventListener("input", count);
    return () => el.removeEventListener("input", count);
  }, [field]);

  const ask = async () => {
    const description = field.current?.value ?? "";
    if (!description.trim() && !title.trim()) { setProblem("Skriv titel og et par linjer om eventet først."); return; }
    setBusy(true); setProblem(""); setReview(null);
    try {
      const r = await apiFetch(clerk, "/api/members/saga/event-text", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, description }) });
      const body = await r.json().catch(() => ({})) as { notes?: string[]; improved?: string; improvedWords?: number };
      if (r.ok && body.improved) setReview({ notes: body.notes ?? [], improved: body.improved, improvedWords: body.improvedWords ?? wordCount(body.improved) });
      else setProblem("Saga kan ikke se på teksten lige nu. Prøv igen om lidt.");
    } catch { setProblem("Saga kan ikke se på teksten lige nu. Prøv igen om lidt."); }
    finally { setBusy(false); }
  };
  const use = () => {
    const el = field.current;
    if (!el || !review) return;
    el.value = review.improved;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    setReview(null);
  };

  const enough = words >= MIN_EVENT_WORDS;
  return <div className="event-text-help">
    <div className="event-text-bar">
      <span className={"event-text-count" + (enough ? " is-ok" : "")}>{words} / {MIN_EVENT_WORDS} ord{enough ? " ✓" : ""}</span>
      <button type="button" className="pill-button subtle" disabled={busy} onClick={() => void ask()}>{busy ? "Saga læser …" : "Lad Saga se på teksten"}</button>
    </div>
    {problem && <p className="event-note is-danger" role="alert">{problem}</p>}
    {review && <div className="event-text-review" role="status">
      <p className="lys-kicker">Sagas vurdering</p>
      {review.notes.length > 0 && <ul>{review.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
      <p className="event-text-suggestion">{review.improved}</p>
      <div className="event-text-bar">
        <button type="button" className="pill-button dark" onClick={use}>Brug Sagas tekst ({review.improvedWords} ord)</button>
        <button type="button" className="text-button" onClick={() => setReview(null)}>Behold min egen</button>
      </div>
    </div>}
  </div>;
}
