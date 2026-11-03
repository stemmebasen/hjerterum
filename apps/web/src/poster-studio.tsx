import { useEffect, useMemo, useRef, useState } from "react";
import { LOGO_FILE, chooseVariant, drawPoster, OWN_PICTURE, photoFits, SIZES, VARIANTS, wordsOf, type Assets, type Format, type PosterWords, type VariantKey } from "./event-poster";

/** Requested (the chair, 3 Nov 2026): "de designskabeloner, vi har lavet til eventoprettelse, skal kun bruges i cockpittet, så man - eller det vil sige
 * mig til at begynde med - kan bruge dem" and "Det er vigtigt, at jeg i cockpittet kan bruge alt det materiale, der er lagt op i forbindelse med eventet,
 * og også har en sektion med alt fra den pågældende underviser."
 * admin.hjerterum.info/plakater/<id> (behind the chair's login, worker/cockpit/posterStudio.ts): every design in every format, drawn from the picture
 * the chair picks - the event's own (cover, pictures among its files, the teacher's own poster, the calendar's photo) or the teacher's (PR photos,
 * profile photo, pictures from their other events) - to download, and for the house's own events to keep as the design on the website. */

type Picture = { url: string; label: string; width?: number | null; height?: number | null };
type Quotes = { facilitator: string; offering: string; participant: string; participantName: string };
type Data = {
  event: { id: string; title: string; startsAt: string; endsAt: string | null; host: string | null; category: string | null; lines: string[]; bookingId: number | null; design: string | null };
  eventPictures: Picture[];
  files: Array<{ url: string; label: string }>;
  teacher: { name: string; consent: "given" | "withdrawn" | "none"; quotes: Quotes; pictures: Picture[]; events: Array<{ title: string; startsAt: string; picture: string | null }> } | null;
  back: string;
};

const image = (src: string) => new Promise<HTMLImageElement | null>(resolve => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => resolve(null); img.src = src; });
const FONTS = ["400 100px \"Playfair Display\"", "italic 400 100px \"Playfair Display\"", "400 30px Inter", "500 30px Inter", "600 30px Inter", "400 30px \"Space Mono\""];
const slug = (text: string) => text.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 40) || "event";
const DAY = new Intl.DateTimeFormat("da-DK", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Copenhagen" });

function Design({ variant, words, assets, format, chosen, title, onUse }: { variant: VariantKey; words: PosterWords; assets: Assets; format: Format; chosen: boolean; title: string;
  onUse: ((canvas: HTMLCanvasElement) => void) | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (ref.current) drawPoster(ref.current, variant, words, assets, format); }, [variant, words, assets, format]);
  const info = [...VARIANTS, OWN_PICTURE].find(v => v.key === variant)!;
  const save = () => ref.current?.toBlob(blob => {
    if (!blob) return;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `hjerterum-${slug(title)}-${variant}-${format}.png`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 4000);
  }, "image/png");
  return <figure className={"poster-card" + (chosen ? " is-chosen" : "")}>
    <canvas ref={ref} className={"poster-canvas is-" + format} aria-label={`${info.label}: ${title}`} />
    <figcaption>
      <div><b>{info.label}</b>{chosen && <span className="poster-badge">Systemets valg</span>}<p>{info.about}</p></div>
      <p className="studio-actions"><button type="button" className="lys-btn" onClick={save}>Hent billede</button>
        {onUse && <button type="button" className="lys-btn ghost" onClick={() => ref.current && onUse(ref.current)}>Brug på hjemmesiden</button>}</p>
    </figcaption>
  </figure>;
}

function Thumbs({ pictures, picked, onPick }: { pictures: Picture[]; picked: string | null; onPick: (url: string) => void }) {
  return <div className="studio-thumbs">{pictures.map(p => <button key={p.url} type="button" className={"studio-thumb" + (picked === p.url ? " is-picked" : "")} onClick={() => onPick(p.url)} aria-pressed={picked === p.url}>
    <img src={p.url} alt="" loading="lazy" /><span>{p.label}</span></button>)}</div>;
}

function Quote({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  if (!text) return null;
  return <li><small>{label}</small><q>{text}</q>
    <button type="button" className="text-button" onClick={() => void navigator.clipboard?.writeText(text).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); })}>{copied ? "Kopieret" : "Kopiér"}</button></li>;
}

export function PosterStudio({ id }: { id: string }) {
  const [data, setData] = useState<Data | null | undefined>(undefined);
  const [picked, setPicked] = useState<string | null>(null);
  const [photo, setPhoto] = useState<HTMLImageElement | null>(null);
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  const [format, setFormat] = useState<Format>("opslag");
  const [message, setMessage] = useState("");
  const [design, setDesign] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch(`/plakater/${id}/data`, { headers: { accept: "application/json" } }).then(r => r.ok ? r.json() as Promise<Data> : null).catch(() => null).then(found => {
      if (!active) return;
      setData(found);
      if (!found) return;
      document.title = `Plakater: ${found.event.title} · Hjerterum admin`;
      setDesign(found.event.design);
      setPicked((found.eventPictures[0] ?? found.teacher?.pictures[0])?.url ?? null);
    });
    void Promise.all(FONTS.map(f => document.fonts.load(f).catch(() => []))).then(() => image(LOGO_FILE)).then(img => { if (active) setLogo(img); });
    return () => { active = false; };
  }, [id]);

  useEffect(() => {
    let active = true;
    if (!picked) { setPhoto(null); return; }
    void image(picked).then(img => { if (active) setPhoto(img); });
    return () => { active = false; };
  }, [picked]);

  const assets: Assets = useMemo(() => ({ photo, logo }), [photo, logo]);
  const event = data?.event;
  const words = useMemo(() => event ? wordsOf({ ...event, imageUrl: photo ? "photo" : null }, event.lines) : null, [event, photo]);
  if (data === undefined) return <main className="page-shell site-page poster-page"><p className="poster-empty">Henter eventet …</p></main>;
  if (data === null || !event || !words) return <main className="page-shell site-page poster-page"><p className="poster-empty">Eventet findes ikke, eller du har ikke adgang. <a href="/plakater">Tilbage</a></p></main>;

  const size = photo ? { width: photo.naturalWidth, height: photo.naturalHeight } : null;
  const systems = chooseVariant({ ...event, imageUrl: photo ? "photo" : null }, size, format);
  const order: VariantKey[] = [systems, ...VARIANTS.map(v => v.key).filter(k => k !== systems)];
  if (photo) order.push(OWN_PICTURE.key);
  const house = event.bookingId !== null;

  const use = async (canvas: HTMLCanvasElement) => {
    setMessage("Gemmer designet …");
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.9));
    const response = blob ? await fetch(`/plakater/${id}/design`, { method: "POST", headers: { "content-type": "image/jpeg" }, body: blob }).catch(() => null) : null;
    if (response?.ok) { setDesign(`/plakater/billede/design/${event.bookingId}?v=${Date.now()}`); setMessage("Designet vises nu på hjemmesiden, i programmet og i nyhedsbrevet."); }
    else setMessage("Designet kunne ikke gemmes. Prøv igen.");
  };
  const remove = async () => {
    const response = await fetch(`/plakater/${id}/design?fjern=1`, { method: "POST" }).catch(() => null);
    if (response?.ok) { setDesign(null); setMessage("Designet er fjernet. Hjemmesiden viser eventets eget foto."); }
  };
  const t = data.teacher;

  return <main className="page-shell site-page poster-page studio">
    <section className="lys-intro site-intro">
      <div><p className="lys-kicker"><a href={data.back}>← Plakater og opslag</a></p><h1 className="lys-title">{event.title}</h1>
        <p>{DAY.format(new Date(event.startsAt))}{event.host ? ` · ${event.host}` : ""}</p></div>
      <div className="site-intro-side"><p>Vælg et billede fra eventet eller fra underviseren. Alle designs tegnes med det - hent dem til Instagram og Facebook{house ? ", eller brug et som eventets billede på hjemmesiden (vælg formatet Facebook-cover)" : ""}.</p>
        <div className="poster-format" role="group" aria-label="Format">
          {(Object.keys(SIZES) as Format[]).map(key => <button key={key} type="button" className={"lys-btn" + (format === key ? "" : " ghost")} aria-pressed={format === key} onClick={() => setFormat(key)}>{SIZES[key].label}</button>)}
        </div></div>
    </section>

    <section className="studio-material">
      <div className="studio-box">
        <h2>Fra eventet</h2>
        {data.eventPictures.length ? <Thumbs pictures={data.eventPictures} picked={picked} onPick={setPicked} /> : <p className="studio-muted">Der er ikke lagt billeder op med eventet.</p>}
        {data.files.length > 0 && <ul className="studio-files">{data.files.map(f => <li key={f.url}><a href={f.url}>{f.label}</a></li>)}</ul>}
        {house && <div className="studio-site"><h3>På hjemmesiden</h3>
          {design ? <><img src={design} alt="Eventets design på hjemmesiden" /><button type="button" className="text-button" onClick={() => void remove()}>Fjern designet - vis eventets eget foto</button></>
            : <p className="studio-muted">Hjemmesiden viser eventets eget foto. Vælg formatet Facebook-cover, og tryk "Brug på hjemmesiden" ved et design.</p>}
        </div>}
        <p className="studio-actions"><button type="button" className={"lys-btn" + (picked ? " ghost" : "")} onClick={() => setPicked(null)}>Uden billede</button></p>
      </div>
      {t && <div className="studio-box">
        <h2>Fra underviseren{t.name ? `: ${t.name}` : ""}</h2>
        <p className={"studio-consent is-" + t.consent}>{t.consent === "given" ? "Har givet samtykke til, at Hjerterum bruger billederne og citaterne i PR."
          : t.consent === "withdrawn" ? "Har trukket sit PR-samtykke tilbage. Brug ikke billederne herfra." : "Har ikke givet PR-samtykke endnu. Brug kun billederne efter aftale."}</p>
        {t.pictures.length ? <Thumbs pictures={t.pictures} picked={picked} onPick={setPicked} /> : <p className="studio-muted">Underviseren har ikke delt billeder med os endnu.</p>}
        {(t.quotes.facilitator || t.quotes.offering || t.quotes.participant) && <ul className="studio-quotes">
          <Quote label="Om sig selv" text={t.quotes.facilitator} /><Quote label="Om det, de tilbyder" text={t.quotes.offering} />
          <Quote label={`En deltager${t.quotes.participantName ? ` (${t.quotes.participantName})` : ""}`} text={t.quotes.participant} />
        </ul>}
        {t.events.length > 0 && <><h3>Deres andre events i huset</h3><ul className="studio-files">{t.events.map(e => <li key={e.title + e.startsAt}>{e.title} <small>{DAY.format(new Date(e.startsAt))}</small></li>)}</ul></>}
      </div>}
    </section>

    {message && <p className="studio-message" role="status">{message}</p>}
    {!logo ? <p className="poster-empty">Tegner opslagene …</p> : <div className="poster-grid">
      {order.map(variant => {
        const fits = photoFits(variant, format, size);
        return fits.ok ? <Design key={variant} variant={variant} words={words} assets={assets} format={format} chosen={variant === systems} title={event.title}
          onUse={house && format === "cover" ? (canvas) => void use(canvas) : null} />
          : <figure key={variant} className="poster-card is-refused"><div className="poster-refused" role="note"><b>Passer ikke</b><p>{fits.reason}</p></div>
            <figcaption><div><b>{[...VARIANTS, OWN_PICTURE].find(v => v.key === variant)!.label}</b></div></figcaption></figure>;
      })}
    </div>}
  </main>;
}
