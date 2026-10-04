import { useState, type FormEvent } from "react";
import { ENQUIRY_HONEYPOT, ENQUIRY_LIMITS, ENQUIRY_PATH, ENQUIRY_TOPICS, enquiryTopic, type EnquiryTopic } from "../site/enquiries";

/** Requested: "Hjerterum skal dog have flere henvendelsesformularer ligesom på stemmebasen.dk". One form, placed where the
 * question arises with its topic chosen ("{{enquiry-<topic>}}" in a page's text); the topic can be changed. Sent to
 * worker/enquiries.ts, which lays it in team@'s inbox. */

const TEXT = {
  da: { topic: "Hvad drejer det sig om?", name: "Navn", email: "E-mail", phone: "Telefon", optional: "valgfrit", message: "Besked",
    placeholder: "Skriv kort, hvad du gerne vil have hjælp til.", callback: "Ring mig hellere op", callbackNeeds: "Skriv dit telefonnummer, så vi kan ringe.",
    consent: "Vi bruger dine oplysninger til at svare på din henvendelse.", privacy: "Læs om privatliv", send: "Send henvendelse", sending: "Sender …",
    thanks: (name: string) => `Tak, ${name}. Vi har modtaget din henvendelse.`, answer: "Du kan forvente svar inden for 3–5 hverdage.", another: "Send en ny henvendelse",
    errors: { missing_fields: "Udfyld navn, e-mail og besked.", too_many: "Du har sendt flere henvendelser lige nu. Prøv igen om en time.",
      not_delivered: "Beskeden kunne ikke sendes lige nu.", other: "Der skete en fejl." }, fallback: "Skriv i stedet til" },
  en: { topic: "What is it about?", name: "Name", email: "Email", phone: "Phone", optional: "optional", message: "Message",
    placeholder: "Tell us briefly what you would like help with.", callback: "I would rather be called", callbackNeeds: "Add your phone number so we can call you.",
    consent: "We use your details to answer your enquiry.", privacy: "Read about privacy", send: "Send enquiry", sending: "Sending …",
    thanks: (name: string) => `Thank you, ${name}. We have received your enquiry.`, answer: "You can expect an answer within 3–5 working days.", another: "Send another enquiry",
    errors: { missing_fields: "Please fill in name, email and message.", too_many: "You have sent several enquiries just now. Please try again in an hour.",
      not_delivered: "The message could not be sent just now.", other: "Something went wrong." }, fallback: "Please write to" }
};

export function EnquiryForm({ topic: initial, lang = "da" }: { topic: string; lang?: "da" | "en" }) {
  const t = TEXT[lang];
  const [topic, setTopic] = useState<EnquiryTopic>(enquiryTopic(initial)?.key ?? "generel");
  const [started] = useState(() => Date.now());
  const [state, setState] = useState<{ sending?: boolean; sent?: string; error?: string }>({});
  const [callback, setCallback] = useState(false);
  const detail = enquiryTopic(topic)?.detail;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "").trim();
    setState({ sending: true });
    try {
      const response = await fetch(ENQUIRY_PATH, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        topic, name: value("name"), email: value("email"), phone: value("phone"), detail: value("detail"), message: value("message"), callback,
        path: window.location.pathname, lang, started, [ENQUIRY_HONEYPOT]: value(ENQUIRY_HONEYPOT) }) });
      const answer = await response.json().catch(() => ({})) as { error?: keyof typeof t.errors };
      if (!response.ok) throw new Error(t.errors[answer.error ?? "other"] ?? t.errors.other);
      setState({ sent: value("name").split(/\s+/)[0] ?? "" });
    } catch (error) {
      setState({ error: error instanceof Error ? error.message : t.errors.other });
    }
  }

  if (state.sent !== undefined) return <div className="site-enquiry site-enquiry-sent" role="status" aria-live="polite">
    <p className="lys-kicker">{enquiryTopic(topic)?.label[lang]}</p>
    <h3>{t.thanks(state.sent)}</h3>
    <p>{t.answer}</p>
    <button type="button" className="lys-btn ghost" onClick={() => { setState({}); setCallback(false); }}>{t.another}</button>
  </div>;

  return <form className="site-enquiry" onSubmit={submit}>
    <label className="wide">{t.topic}
      <select name="topic" value={topic} onChange={event => setTopic(event.target.value as EnquiryTopic)}>
        {ENQUIRY_TOPICS.map(option => <option key={option.key} value={option.key}>{option.label[lang]}</option>)}
      </select>
    </label>
    <label>{t.name}<input name="name" required maxLength={ENQUIRY_LIMITS.name} autoComplete="name" /></label>
    <label>{t.email}<input type="email" name="email" required maxLength={ENQUIRY_LIMITS.email} autoComplete="email" /></label>
    <label>{t.phone} <span>({callback ? t.callbackNeeds : t.optional})</span>
      <input type="tel" name="phone" required={callback} maxLength={ENQUIRY_LIMITS.phone} autoComplete="tel" /></label>
    {detail ? <label>{detail[lang]} <span>({t.optional})</span><input key={topic} name="detail" maxLength={ENQUIRY_LIMITS.detail} /></label> : <span className="site-enquiry-gap" />}
    <label className="wide">{t.message}<textarea name="message" required maxLength={ENQUIRY_LIMITS.message} rows={5} placeholder={t.placeholder} /></label>
    <label className="site-enquiry-check wide"><input type="checkbox" checked={callback} onChange={event => setCallback(event.target.checked)} /> {t.callback}</label>
    <div aria-hidden="true" className="site-honeypot"><input type="text" name={ENQUIRY_HONEYPOT} tabIndex={-1} autoComplete="off" defaultValue="" /></div>
    <div className="site-enquiry-foot wide">
      <p>{t.consent} <a href="/privatliv#henvendelser">{t.privacy}</a>.</p>
      <button className="lys-btn" type="submit" disabled={state.sending}>{state.sending ? t.sending : t.send}</button>
    </div>
    {state.error && <p className="site-enquiry-error wide" role="alert">{state.error} {t.fallback} <a href="mailto:hjerterum@holistisk.org">hjerterum@holistisk.org</a>.</p>}
  </form>;
}
