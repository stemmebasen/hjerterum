import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { LOGO_FILE, chooseVariant, drawPoster, OWN_PICTURE, photoFits, SIZES, VARIANTS, wordsOf, type Assets, type Format, type PosterWords, type VariantKey } from "./event-poster";

/** Requested (the chair, 3 Nov 2026): "de designskabeloner, vi har lavet til eventoprettelse, skal kun bruges i cockpittet, så man - eller det vil sige
 * mig til at begynde med - kan bruge dem" and "Det er vigtigt, at jeg i cockpittet kan bruge alt det materiale, der er lagt op i forbindelse med eventet,
 * og også har en sektion med alt fra den pågældende underviser."
 * admin.hjerterum.info/plakater/<id> (behind the chair's login, worker/cockpit/posterStudio.ts): every design in every format, drawn from the picture
 * the chair picks - the event's own (cover, pictures among its files, the teacher's own poster, the calendar's photo) or the teacher's (PR photos,
 * profile photo, pictures from their other events) - for the event's post in PR og SoMe, or to download. Only for social media. The chair gets Saga's
 * proposal, then the finished post to publish (see PosterStudio). */

type Picture = { url: string; label: string; width?: number | null; height?: number | null };
type Quotes = { facilitator: string; offering: string; participant: string; participantName: string };
type Data = {
  event: { id: string; title: string; startsAt: string; endsAt: string | null; host: string | null; category: string | null; lines: string[]; bookingId: number | null; design: string | null };
  eventPictures: Picture[];
  files: Array<{ url: string; label: string }>;
  teacher: { name: string; consent: "given" | "withdrawn" | "none"; quotes: Quotes; pictures: Picture[]; events: Array<{ title: string; startsAt: string; picture: string | null }> } | null;
  post: { id: number; status: string; week: string | null; monday: string | null; image: string | null; design: boolean;
    text: string; instagramText: string; channels: string[]; publishAtMs: number | null; link: string | null; instagram: boolean } | null;
  back: string;
};

const image = (src: string) => new Promise<HTMLImageElement | null>(resolve => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => resolve(null); img.src = src; });
const FONTS = ["400 100px \"Playfair Display\"", "italic 400 100px \"Playfair Display\"", "400 30px Inter", "500 30px Inter", "600 30px Inter", "400 30px \"Space Mono\""];
const slug = (text: string) => text.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 40) || "event";
const DAY = new Intl.DateTimeFormat("da-DK", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Copenhagen" });

function Design({ variant, words, assets, format, chosen, title, big, canvasRef, onPick }: { variant: VariantKey; words: PosterWords; assets: Assets; format: Format;
  chosen: boolean; title: string; big?: boolean; canvasRef?: { current: HTMLCanvasElement | null }; onPick?: () => void }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => { if (ref.current) drawPoster(ref.current, variant, words, assets, format); }, [variant, words, assets, format]);
  const info = [...VARIANTS, OWN_PICTURE].find(v => v.key === variant)!;
  // Asked: "Når der står »hent billedet«, betyder det så, at du vil have mig til at downloade det og så poste det manuelt?" - no: Saga posts it.
  // Downloading is only for using a design somewhere else.
  const save = () => ref.current?.toBlob(blob => {
    if (!blob) return;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `hjerterum-${slug(title)}-${variant}-${format}.png`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 4000);
  }, "image/png");
  return <figure className={"poster-card" + (chosen && !big ? " is-picked" : "") + (big ? " is-proposal" : "")}>
    <canvas ref={el => { ref.current = el; if (canvasRef) canvasRef.current = el; }} className={"poster-canvas is-" + format} aria-label={`${info.label}: ${title}`} />
    {!big && <figcaption>
      <div><b>{info.label}</b>{chosen && <span className="poster-badge">I forslaget</span>}<p>{info.about}</p></div>
      <p className="studio-actions">{onPick && <button type="button" className={"lys-btn" + (chosen ? "" : " ghost")} onClick={onPick} aria-pressed={chosen}>{chosen ? "Valgt" : "Vælg"}</button>}
        <button type="button" className="text-button" onClick={save}>Download</button></p>
    </figcaption>}
  </figure>;
}

function Thumbs({ pictures, picked, onPick }: { pictures: Picture[]; picked: string | null; onPick: (url: string) => void }) {
  return <div className="studio-thumbs">{pictures.map(p => <button key={p.url} type="button" className={"studio-thumb" + (picked === p.url ? " is-picked" : "")} onClick={() => onPick(p.url)} aria-pressed={picked === p.url}>
    <img src={p.url} alt="" loading="lazy" /><span>{p.label}</span></button>)}</div>;
}

/** Requested: "får vi et problem med et billede som dette, hvor der er tekst over fotografiet. Er det muligt at croppe, forstørre og flytte rundt
 * på kernebilledet?" The frame is the part of the picture every design is drawn with: zoom in, and drag the frame (or the picture) to move it. */
export type Crop = { zoom: number; x: number; y: number };
export const NO_CROP: Crop = { zoom: 1, x: 0.5, y: 0.5 };
export const clampCrop = (c: Crop): Crop => {
  const zoom = Math.min(3, Math.max(1, c.zoom)), half = 0.5 / zoom;
  return { zoom, x: Math.min(1 - half, Math.max(half, c.x)), y: Math.min(1 - half, Math.max(half, c.y)) };
};

function CropTool({ src, ratio, crop, onChange }: { src: string; ratio: number; crop: Crop; onChange: (crop: Crop) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; crop: Crop } | null>(null);
  const size = 100 / crop.zoom;
  const move = (e: ReactPointerEvent) => {
    const from = drag.current, el = box.current;
    if (!from || !el) return;
    const r = el.getBoundingClientRect();
    onChange(clampCrop({ ...from.crop, x: from.crop.x + (e.clientX - from.x) / r.width, y: from.crop.y + (e.clientY - from.y) / r.height }));
  };
  return <div className="studio-crop">
    <div ref={box} className="studio-crop-picture" style={{ width: `min(100%, 460px, ${Math.round(480 * ratio)}px)` }} onPointerDown={e => { drag.current = { x: e.clientX, y: e.clientY, crop }; e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      <img src={src} alt="Det valgte billede" draggable={false} />
      <span className="studio-crop-frame" style={{ left: `${(crop.x - 0.5 / crop.zoom) * 100}%`, top: `${(crop.y - 0.5 / crop.zoom) * 100}%`, width: `${size}%`, height: `${size}%` }} />
    </div>
    <label className="studio-crop-zoom"><span>Zoom</span>
      <input type="range" min="1" max="3" step="0.05" value={crop.zoom} onChange={e => onChange(clampCrop({ ...crop, zoom: Number(e.target.value) }))} /></label>
    <p className="studio-actions"><button type="button" className="text-button" onClick={() => onChange(NO_CROP)} disabled={crop.zoom === 1}>Hele billedet</button></p>
  </div>;
}

/** The part of the picture inside the frame, at the picture's own resolution (so "Passer ikke" still tells when it is too small). */
function cropped(img: HTMLImageElement, crop: Crop): Promise<HTMLImageElement | null> {
  if (crop.zoom === 1) return Promise.resolve(img);
  const w = Math.round(img.naturalWidth / crop.zoom), h = Math.round(img.naturalHeight / crop.zoom);
  const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
  canvas.getContext("2d")!.drawImage(img, Math.round(crop.x * img.naturalWidth - w / 2), Math.round(crop.y * img.naturalHeight - h / 2), w, h, 0, 0, w, h);
  return new Promise(resolve => canvas.toBlob(blob => blob ? void image(URL.createObjectURL(blob)).then(resolve) : resolve(null), "image/jpeg", 0.95));
}

const FORMAT_HELP: Record<Format, string> = {
  opslag: "Passer til både Facebook og Instagram. Vælg det, hvis du er i tvivl.",
  cover: "Et bredt billede. Fylder godt på Facebook; Instagram viser det mindre.",
  story: "Til en story. Saga kan ikke poste stories, så den skal downloades og lægges op i Instagram-appen."
};

/** Back to the page the chair came from (?fra=, a path on this host), else to PR og SoMe → Events. */
export function backOf(search: string): string {
  const from = new URLSearchParams(search).get("fra");
  return from && /^\/(pr|plakater|arrangementer)([/?#]|$)/.test(from) ? from : "/pr/events";
}

function Quote({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  if (!text) return null;
  return <li><small>{label}</small><q>{text}</q>
    <button type="button" className="text-button" onClick={() => void navigator.clipboard?.writeText(text).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); })}>{copied ? "Kopieret" : "Kopiér"}</button></li>;
}

type Step = "forslag" | "opslag" | "sendt";
const WHEN = new Intl.DateTimeFormat("da-DK", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Copenhagen" });
const channelNames = (channels: string[]) => channels.map(c => c === "instagram" ? "Instagram" : "Facebook").join(" og ");

/** Requested (the chair, 3 Nov 2026): "Men så er det nødt til at være mere pædagogisk, så jeg får præsenteret et forslag. Jeg klikker på næste, og så kan
 * jeg se det færdige opslag med billede og tekst, som jeg så kan publicere." Two steps: Saga's proposal (the system's design with the event's first
 * picture - "Ret forslaget" opens the picture, the frame, the format and the other designs), then the finished post, with its words, to publish. */
export function PosterStudio({ id }: { id: string }) {
  const [data, setData] = useState<Data | null | undefined>(undefined);
  const [picked, setPicked] = useState<string | null>(null);
  const [source, setSource] = useState<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState<Crop>(NO_CROP);
  const [photo, setPhoto] = useState<HTMLImageElement | null>(null);
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  const [format, setFormat] = useState<Format>("opslag");
  const [variant, setVariant] = useState<VariantKey | null>(null);
  const [editing, setEditing] = useState(false);
  const [step, setStep] = useState<Step>("forslag");
  const [preview, setPreview] = useState<{ blob: Blob; url: string } | null>(null);
  const [text, setText] = useState("");
  const [instagramText, setInstagramText] = useState("");
  const [channels, setChannels] = useState<string[]>([]);
  const [now, setNow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState<{ publishAtMs: number | null; channels: string[] } | null>(null);
  const proposal = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let active = true;
    void fetch(`/plakater/${id}/data`, { headers: { accept: "application/json" } }).then(r => r.ok ? r.json() as Promise<Data> : null).catch(() => null).then(found => {
      if (!active) return;
      setData(found);
      if (!found) return;
      document.title = `Opslag: ${found.event.title} · Hjerterum admin`;
      setPicked((found.eventPictures[0] ?? found.teacher?.pictures[0])?.url ?? null);
      if (found.post) {
        setText(found.post.text); setInstagramText(found.post.instagramText);
        setChannels(found.post.instagram ? ["facebook", "instagram"] : ["facebook"]);
      }
    });
    void Promise.all(FONTS.map(f => document.fonts.load(f).catch(() => []))).then(() => image(LOGO_FILE)).then(img => { if (active) setLogo(img); });
    return () => { active = false; };
  }, [id]);

  useEffect(() => {
    let active = true;
    setCrop(NO_CROP);
    if (!picked) { setSource(null); return; }
    void image(picked).then(img => { if (active) setSource(img); });
    return () => { active = false; };
  }, [picked]);

  // The designs are drawn with the framed part, a moment after the frame stops moving.
  useEffect(() => {
    let active = true, made: string | null = null;
    if (!source) { setPhoto(null); return; }
    const timer = window.setTimeout(() => void cropped(source, crop).then(img => {
      if (img && img !== source) made = img.src;
      if (active) setPhoto(img); else if (made) URL.revokeObjectURL(made);
    }), crop.zoom === 1 ? 0 : 250);
    return () => { active = false; window.clearTimeout(timer); if (made) window.setTimeout(() => URL.revokeObjectURL(made!), 1000); };
  }, [source, crop]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  const back = useMemo(() => backOf(window.location.search), []);

  const assets: Assets = useMemo(() => ({ photo, logo }), [photo, logo]);
  const event = data?.event;
  const words = useMemo(() => event ? wordsOf({ ...event, imageUrl: photo ? "photo" : null }, event.lines) : null, [event, photo]);
  if (data === undefined) return <main className="page-shell site-page poster-page"><p className="poster-empty">Henter eventet …</p></main>;
  if (data === null || !event || !words) return <main className="page-shell site-page poster-page"><p className="poster-empty">Eventet findes ikke, eller du har ikke adgang. <a href="/plakater">Tilbage</a></p></main>;

  const size = photo ? { width: photo.naturalWidth, height: photo.naturalHeight } : null;
  const systems = chooseVariant({ ...event, imageUrl: photo ? "photo" : null }, size, format);
  const all: VariantKey[] = [...VARIANTS.map(v => v.key), ...(photo ? [OWN_PICTURE.key] : [])];
  // The chair's own choice of design while it still fits the picture and the format, else the system's.
  const chosen = variant && all.includes(variant) && photoFits(variant, format, size).ok ? variant : systems;
  const post = data.post;
  const t = data.teacher;
  const postLink = post?.monday ? `/pr/uge?uge=${post.monday}#opslag-${post.id}` : "/pr/events";
  const postable = format !== "story";
  const planned = post?.publishAtMs && post.publishAtMs > Date.now() ? post.publishAtMs : null;

  const next = () => {
    const canvas = proposal.current;
    if (!canvas) return;
    canvas.toBlob(blob => {
      if (!blob) { setMessage("Billedet kunne ikke laves. Prøv igen."); return; }
      setPreview({ blob, url: URL.createObjectURL(blob) }); setMessage(""); setStep("opslag"); window.scrollTo(0, 0);
    }, "image/jpeg", 0.9);
  };
  const publish = async () => {
    if (!preview || !post) return;
    setBusy(true); setMessage("Publicerer …");
    const stored = await fetch(`/plakater/${id}/opslag`, { method: "POST", headers: { "content-type": "image/jpeg" }, body: preview.blob }).catch(() => null);
    const response = stored?.ok ? await fetch(`/plakater/${id}/publicer`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, instagramText, channels, now: now || !planned }) }).catch(() => null) : null;
    const body = response?.ok ? await response.json().catch(() => null) as { publishAtMs: number | null; channels: string[] } | null : null;
    setBusy(false);
    if (body) { setSent(body); setMessage(""); setStep("sendt"); window.scrollTo(0, 0); }
    else setMessage(!stored?.ok ? "Billedet kunne ikke gemmes. Prøv igen." : response?.status === 422 ? "Vælg mindst ét sted, opslaget skal ud." : "Opslaget kunne ikke publiceres. Prøv igen.");
  };
  const toggle = (c: string) => setChannels(list => list.includes(c) ? list.filter(x => x !== c) : [...list, c]);

  const head = <section className="lys-intro site-intro studio-head">
    <div><p className="lys-kicker"><a href={back}>← Tilbage</a> · <a href={data.back}>Plakater og opslag</a></p><h1 className="lys-title">{event.title}</h1>
      <p>{DAY.format(new Date(event.startsAt))}{event.host ? ` · ${event.host}` : ""}</p></div>
    <ol className="studio-stepper" aria-label="Trin">
      <li className={step === "forslag" ? "is-on" : "is-done"}>1. Billedet</li>
      <li className={step === "opslag" ? "is-on" : step === "sendt" ? "is-done" : ""}>2. Opslaget</li>
      <li className={step === "sendt" ? "is-on" : ""}>3. Publiceret</li>
    </ol>
  </section>;

  if (step === "sendt" && sent) return <main className="page-shell site-page poster-page studio">{head}
    <section className="studio-box studio-done">
      <h2>Opslaget er godkendt</h2>
      <p>{sent.publishAtMs && sent.publishAtMs > Date.now() + 60_000 ? `Saga sender det ${WHEN.format(new Date(sent.publishAtMs))}` : "Saga sender det inden for fem minutter"} på {channelNames(sent.channels)}. Du skal ikke gøre mere.</p>
      <p className="studio-actions"><a className="lys-btn" href={back}>Tilbage</a><a className="lys-btn ghost" href={postLink}>Se opslaget i PR og SoMe</a></p>
    </section>
  </main>;

  if (step === "opslag" && preview && post) return <main className="page-shell site-page poster-page studio">{head}
    <section className="studio-post">
      <div className="studio-mock">
        <header><img src={LOGO_FILE} alt="" /><b>Hjerterum</b></header>
        <p className="studio-mock-text">{text}</p>
        {post.link && <p className="studio-mock-link">{post.link}</p>}
        <img className="studio-mock-picture" src={preview.url} alt="Opslagets billede" />
      </div>
      <div className="studio-box">
        <h2>Det færdige opslag</h2>
        <p className="studio-muted">Sådan kommer opslaget til at se ud. Ret teksten, hvis du vil, og tryk Publicér.</p>
        <label className="studio-field"><span>Teksten på Facebook</span><textarea rows={5} value={text} onChange={e => setText(e.target.value)} /></label>
        {post.instagram && channels.includes("instagram") && <label className="studio-field"><span>Teksten på Instagram (link virker ikke dér, så den peger på bio)</span>
          <textarea rows={5} value={instagramText} onChange={e => setInstagramText(e.target.value)} /></label>}
        <fieldset className="studio-choices"><legend>Hvor</legend>
          <label><input type="checkbox" checked={channels.includes("facebook")} onChange={() => toggle("facebook")} /> Facebook</label>
          {post.instagram ? <label><input type="checkbox" checked={channels.includes("instagram")} onChange={() => toggle("instagram")} /> Instagram</label>
            : <span className="studio-muted">Instagram er ikke forbundet.</span>}
        </fieldset>
        <fieldset className="studio-choices"><legend>Hvornår</legend>
          {planned ? <><label><input type="radio" name="hvornaar" checked={!now} onChange={() => setNow(false)} /> Som planlagt: {WHEN.format(new Date(planned))}</label>
            <label><input type="radio" name="hvornaar" checked={now} onChange={() => setNow(true)} /> Nu</label></>
            : <span>Med det samme (den planlagte tid er gået).</span>}
        </fieldset>
        {post.status === "approved" && <p className="studio-muted">Opslaget er allerede godkendt. Publicerer du, får det det nye billede og den nye tekst.</p>}
        {message && <p className="studio-message" role="status">{message}</p>}
        <p className="studio-actions"><button type="button" className="lys-btn" disabled={busy || !channels.length} onClick={() => void publish()}>Publicér</button>
          <button type="button" className="lys-btn ghost" disabled={busy} onClick={() => { setStep("forslag"); setMessage(""); }}>← Tilbage til billedet</button></p>
      </div>
    </section>
  </main>;

  return <main className="page-shell site-page poster-page studio">{head}
    <section className="studio-proposal">
      {!logo ? <p className="poster-empty">Tegner forslaget …</p>
        : <Design key={`${chosen}-${format}`} variant={chosen} words={words} assets={assets} format={format} chosen title={event.title} big canvasRef={proposal} />}
      <div className="studio-box">
        <h2>Sagas forslag</h2>
        {post ? <>
          <p>Det her er billedet til eventets opslag på Facebook og Instagram. Ser det godt ud, så tryk <b>Næste</b>. Så ser du det færdige opslag med teksten og kan publicere det.</p>
          <p className="studio-muted">Står der tekst på fotoet, eller vil du have et andet billede eller design, så tryk <b>Ret forslaget</b>.</p>
          {message && <p className="studio-message" role="status">{message}</p>}
          <p className="studio-actions"><button type="button" className="lys-btn" disabled={!logo || !postable || Boolean(picked && !photo)} onClick={next}>Næste →</button>
            <button type="button" className="lys-btn ghost" aria-expanded={editing} onClick={() => setEditing(!editing)}>{editing ? "Luk" : "Ret forslaget"}</button></p>
          {!postable && <p className="studio-muted">En story kan Saga ikke poste. Vælg formatet Opslag for at gå videre.</p>}
        </> : <>
          <p>Eventet har intet opslag i PR og SoMe endnu, så billedet kan ikke bruges i et opslag herfra. Lav opslaget under <a href="/pr/events">PR og SoMe → Events</a>, og kom tilbage hertil.</p>
          <p className="studio-actions"><button type="button" className="lys-btn ghost" aria-expanded={editing} onClick={() => setEditing(!editing)}>{editing ? "Luk" : "Ret forslaget"}</button></p>
        </>}
      </div>
    </section>

    {editing && <section className="studio-edit">
      <h2 className="studio-step">Billedet</h2>
      <div className="studio-material">
        <div className="studio-box">
          <h3>Fra eventet</h3>
          {data.eventPictures.length ? <Thumbs pictures={data.eventPictures} picked={picked} onPick={setPicked} /> : <p className="studio-muted">Der er ikke lagt billeder op med eventet.</p>}
          {data.files.length > 0 && <ul className="studio-files">{data.files.map(f => <li key={f.url}><a href={f.url}>{f.label}</a></li>)}</ul>}
          <p className="studio-actions"><button type="button" className={"lys-btn" + (picked ? " ghost" : "")} onClick={() => setPicked(null)}>Uden billede</button></p>
        </div>
        {t && <div className="studio-box">
          <h3>Fra underviseren{t.name ? `: ${t.name}` : ""}</h3>
          <p className={"studio-consent is-" + t.consent}>{t.consent === "given" ? "Har givet samtykke til, at Hjerterum bruger billederne og citaterne i PR."
            : t.consent === "withdrawn" ? "Har trukket sit PR-samtykke tilbage. Brug ikke billederne herfra." : "Har ikke givet PR-samtykke endnu. Brug kun billederne efter aftale."}</p>
          {t.pictures.length ? <Thumbs pictures={t.pictures} picked={picked} onPick={setPicked} /> : <p className="studio-muted">Underviseren har ikke delt billeder med os endnu.</p>}
          {(t.quotes.facilitator || t.quotes.offering || t.quotes.participant) && <ul className="studio-quotes">
            <Quote label="Om sig selv" text={t.quotes.facilitator} /><Quote label="Om det, de tilbyder" text={t.quotes.offering} />
            <Quote label={`En deltager${t.quotes.participantName ? ` (${t.quotes.participantName})` : ""}`} text={t.quotes.participant} />
          </ul>}
          {t.events.length > 0 && <><h3>Deres andre events i huset</h3><ul className="studio-files">{t.events.map(e => <li key={e.title + e.startsAt}>{e.title} <small>{DAY.format(new Date(e.startsAt))}</small></li>)}</ul></>}
        </div>}
      </div>

      {picked && source && <><h2 className="studio-step">Zoom og flyt</h2>
        <div className="studio-box">
          <p className="studio-muted">Det lyse felt er den del af billedet, designet bruger. Zoom ind, og træk feltet hen over selve fotoet, så tekst og kanter på billedet ikke kommer med.</p>
          <CropTool src={picked} ratio={source.naturalWidth / source.naturalHeight} crop={crop} onChange={setCrop} />
        </div></>}

      <h2 className="studio-step">Format</h2>
      <div className="poster-format" role="group" aria-label="Format">
        {(Object.keys(SIZES) as Format[]).map(key => <button key={key} type="button" className={"lys-btn" + (format === key ? "" : " ghost")} aria-pressed={format === key} onClick={() => setFormat(key)}>{SIZES[key].label}</button>)}
      </div>
      <p className="studio-muted studio-format-help">{FORMAT_HELP[format]}</p>

      <h2 className="studio-step">Design</h2>
      {!logo ? <p className="poster-empty">Tegner designene …</p> : <div className="poster-grid">
        {all.map(key => {
          const fits = photoFits(key, format, size);
          return fits.ok ? <Design key={key} variant={key} words={words} assets={assets} format={format} chosen={key === chosen} title={event.title} onPick={() => { setVariant(key); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
            : <figure key={key} className="poster-card is-refused"><div className="poster-refused" role="note"><b>Passer ikke</b><p>{fits.reason}</p></div>
              <figcaption><div><b>{[...VARIANTS, OWN_PICTURE].find(v => v.key === key)!.label}</b></div></figcaption></figure>;
        })}
      </div>}
    </section>}
  </main>;
}
