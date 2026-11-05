import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { LOGO_FILE, PALETTES, chooseVariant, drawPoster, type PaletteKey, isShaped, markShaped, setPosterSite, OWN_PICTURE, photoFits, SIZES, VARIANTS, wordsOf, type Assets, type Format, type PosterWords, type VariantKey } from "./event-poster";

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
    text: string; instagramText: string; channels: string[]; publishAtMs: number | null; link: string | null; instagram: boolean; instagramAtMs: number | null;
    video: string | null; noVideo: boolean;
    videoTemplate: number | null; videoTemplates: Array<{ no: number; name: string; used: string }>; videoRemake: boolean;
    videoChoices: Array<{ template: number; video: string }>; videoAsked: number[] } | null;
  back: string;
  siteLive?: boolean;
};

const image = (src: string) => new Promise<HTMLImageElement | null>(resolve => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => resolve(null); img.src = src; });
const FONTS = ["400 100px \"Playfair Display\"", "italic 400 100px \"Playfair Display\"", "400 30px Inter", "500 30px Inter", "600 30px Inter", "400 30px \"Space Mono\""];
const slug = (text: string) => text.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 40) || "event";
const DAY = new Intl.DateTimeFormat("da-DK", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Copenhagen" });

function Design({ variant, words, assets, format, chosen, title, big, soft, canvasRef, onPick, palette = "varm" }: { variant: VariantKey; words: PosterWords; assets: Assets; format: Format;
  chosen: boolean; title: string; big?: boolean; soft?: boolean; canvasRef?: { current: HTMLCanvasElement | null }; onPick?: () => void; palette?: PaletteKey }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => { if (ref.current) drawPoster(ref.current, variant, words, assets, format, 1, palette); }, [variant, words, assets, format, palette]);
  const info = [...VARIANTS, OWN_PICTURE].find(v => v.key === variant)!;
  // Asked: "Når der står »hent billedet«, betyder det så, at du vil have mig til at downloade det og så poste det manuelt?" - no: Saga posts it.
  // Downloading is only for using a design somewhere else.
  const save = () => ref.current?.toBlob(blob => {
    if (!blob) return;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `hjerterum-${slug(title)}-${variant}${palette === "varm" ? "" : `-${palette}`}-${format}.png`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 4000);
  }, "image/png");
  return <figure className={"poster-card" + (chosen && !big ? " is-picked" : "") + (big ? " is-proposal" : "")}>
    <canvas ref={el => { ref.current = el; if (canvasRef) canvasRef.current = el; }} className={"poster-canvas is-" + format} aria-label={`${info.label}: ${title}`} />
    {!big && <figcaption>
      <div><b>{info.label}{palette !== "varm" ? ` · ${PALETTES.find(p => p.key === palette)!.label}` : ""}</b>{chosen && <span className="poster-badge">I forslaget</span>}<p>{info.about}</p>
        {soft && <p className="studio-soft">Beskæringen er forstørret her, så billedet bliver lidt blødt.</p>}</div>
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
 * på kernebilledet?" The frame is the part of the picture every design is drawn with: zoom in, and drag the frame (or the picture) to move it.
 * Then (5 Nov 2026): "Jeg savner flere muligheder for at bruge et event billede kreativt - f.eks. at croppe i cirkelformat eller kvadratisk. Lige nu kan
 * jeg kun croppe i event cover dimensioner." The frame has a shape: the picture's own, a square or a circle. A square or round picture is put whole
 * into the design (event-poster.ts cover), on the design's own background. */
export type CropShape = "original" | "square" | "circle" | "portrait" | "wide" | "arch";
export type Crop = { zoom: number; x: number; y: number; shape?: CropShape };
export const NO_CROP: Crop = { zoom: 1, x: 0.5, y: 0.5, shape: "original" };
/** Then: "Så giv mig flere muligheder" - also standing (4:5, Instagram's own), wide (16:9) and an arch. */
const SHAPES: Array<[CropShape, string]> = [["original", "Hele formatet"], ["square", "Kvadrat"], ["circle", "Cirkel"], ["portrait", "Stående 4:5"], ["wide", "Bred 16:9"], ["arch", "Bue"]];
const ASPECT: Record<Exclude<CropShape, "original">, number> = { square: 1, circle: 1, portrait: 0.8, wide: 16 / 9, arch: 0.8 };
/** The frame's width and height as parts of the picture's (ratio: the picture's width / height): the largest frame of the shape's own proportions. */
export function frameOf(crop: Crop, ratio: number): { w: number; h: number } {
  const shape = crop.shape ?? "original";
  if (shape === "original") return { w: 1 / crop.zoom, h: 1 / crop.zoom };
  const aspect = ASPECT[shape];
  return aspect <= ratio ? { w: aspect / ratio / crop.zoom, h: 1 / crop.zoom } : { w: 1 / crop.zoom, h: ratio / aspect / crop.zoom };
}
export const clampCrop = (c: Crop, ratio = 1): Crop => {
  const zoom = Math.min(3, Math.max(1, c.zoom)), f = frameOf({ ...c, zoom }, ratio);
  return { ...c, zoom, x: Math.min(1 - f.w / 2, Math.max(f.w / 2, c.x)), y: Math.min(1 - f.h / 2, Math.max(f.h / 2, c.y)) };
};
const whole = (c: Crop) => c.zoom === 1 && (c.shape ?? "original") === "original";

export function CropTool({ src, ratio, crop, onChange }: { src: string; ratio: number; crop: Crop; onChange: (crop: Crop) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; crop: Crop } | null>(null);
  const f = frameOf(crop, ratio), shape = crop.shape ?? "original";
  const move = (e: ReactPointerEvent) => {
    const from = drag.current, el = box.current;
    if (!from || !el) return;
    const r = el.getBoundingClientRect();
    onChange(clampCrop({ ...from.crop, x: from.crop.x + (e.clientX - from.x) / r.width, y: from.crop.y + (e.clientY - from.y) / r.height }, ratio));
  };
  return <div className="studio-crop">
    <div className="studio-crop-shapes" role="group" aria-label="Beskæring">
      {SHAPES.map(([key, label]) => <button key={key} type="button" className={"lys-btn" + (shape === key ? "" : " ghost")} aria-pressed={shape === key}
        onClick={() => onChange(clampCrop({ ...crop, shape: key }, ratio))}><span className={"studio-shape-icon is-" + key} aria-hidden="true" />{label}</button>)}
    </div>
    <div ref={box} className="studio-crop-picture" style={{ width: `min(100%, 460px, ${Math.round(480 * ratio)}px)` }} onPointerDown={e => { drag.current = { x: e.clientX, y: e.clientY, crop }; e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      <img src={src} alt="Det valgte billede" draggable={false} />
      <span className={"studio-crop-frame" + (shape === "circle" ? " is-circle" : shape === "arch" ? " is-arch" : "")} style={{ left: `${(crop.x - f.w / 2) * 100}%`, top: `${(crop.y - f.h / 2) * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%` }} />
    </div>
    <label className="studio-crop-zoom"><span>Zoom</span>
      <input type="range" min="1" max="3" step="0.05" value={crop.zoom} onChange={e => onChange(clampCrop({ ...crop, zoom: Number(e.target.value) }, ratio))} /></label>
    <p className="studio-actions"><button type="button" className="text-button" onClick={() => onChange(NO_CROP)} disabled={whole(crop)}>Hele billedet</button></p>
  </div>;
}

/** The part of the picture inside the frame, at the picture's own resolution (so "Passer ikke" still tells when it is too small). A round one is
 * a PNG with clear corners; a square or round one is marked, so the designs put it in whole. */
export function cropped(img: HTMLImageElement, crop: Crop): Promise<HTMLImageElement | null> {
  if (whole(crop)) return Promise.resolve(img);
  const f = frameOf(crop, img.naturalWidth / img.naturalHeight), shape = crop.shape ?? "original";
  const w = Math.round(img.naturalWidth * f.w), h = Math.round(img.naturalHeight * f.h);
  const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  if (shape === "circle") { ctx.beginPath(); ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.clip(); }
  if (shape === "arch") { ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(0, w / 2); ctx.arc(w / 2, w / 2, w / 2, Math.PI, 0); ctx.lineTo(w, h); ctx.closePath(); ctx.clip(); }
  ctx.drawImage(img, Math.round(crop.x * img.naturalWidth - w / 2), Math.round(crop.y * img.naturalHeight - h / 2), w, h, 0, 0, w, h);
  return new Promise(resolve => canvas.toBlob(blob => blob ? void image(URL.createObjectURL(blob)).then(made => { if (made && shape !== "original") markShaped(made); resolve(made); }) : resolve(null),
    shape === "circle" || shape === "arch" ? "image/png" : "image/jpeg", 0.95));
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
/** "2026-11-20T19:00" in the browser's own time, for a datetime-local field. */
const localInput = (ms: number) => { const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000); return d.toISOString().slice(0, 16); };
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
  // "flere stills ... på kommando": the designs again in the house's other colour moods, one more for each press.
  const [palette, setPalette] = useState<PaletteKey>("varm");
  const [moods, setMoods] = useState(1);
  const [editing, setEditing] = useState(false);
  const [step, setStep] = useState<Step>("forslag");
  const [preview, setPreview] = useState<{ blob: Blob; url: string } | null>(null);
  const [text, setText] = useState("");
  const [instagramText, setInstagramText] = useState("");
  const [channels, setChannels] = useState<string[]>([]);
  // "Og så savner jeg også en mulighed for at planlægge udsendingen": as planned, now, or a time of the chair's own.
  const [when, setWhen] = useState<"plan" | "nu" | "valgt">("plan");
  const [chosenAt, setChosenAt] = useState("");
  // "forskellige tidspunkter på de to medier": Instagram's own time (empty: with Facebook).
  const [chosenIg, setChosenIg] = useState("");
  // The event's video for Instagram (made by Saga in the chosen template); the chair may keep the picture instead.
  const [useVideo, setUseVideo] = useState(true);
  // Requested (the chair, 5 Nov 2026): "lav gerne delen med videoskabelon" - the video made again in another template.
  const [template, setTemplate] = useState(0);
  const [videoNote, setVideoNote] = useState("");
  // Requested (the chair, 5 Nov 2026): "en mulighed for, at AI kan komme med et forslag til delingsteksten" - Saga's writer fills the fields.
  const [wish, setWish] = useState("");
  const [writing, setWriting] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState<{ publishAtMs: number | null; channels: string[]; status?: string; instagramAtMs?: number | null } | null>(null);
  const proposal = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let active = true;
    void fetch(`/plakater/${id}/data`, { headers: { accept: "application/json" } }).then(r => r.ok ? r.json() as Promise<Data> : null).catch(() => null).then(found => {
      if (!active) return;
      if (found) setPosterSite(Boolean(found.siteLive));
      setData(found);
      if (!found) return;
      document.title = `Opslag: ${found.event.title} · Hjerterum admin`;
      setPicked((found.eventPictures[0] ?? found.teacher?.pictures[0])?.url ?? null);
      if (found.post) {
        setText(found.post.text); setInstagramText(found.post.instagramText);
        setChannels(found.post.instagram ? ["facebook", "instagram"] : ["facebook"]);
        setUseVideo(!found.post.noVideo);
        setTemplate(found.post.videoTemplate ?? found.post.videoTemplates[0]?.no ?? 0);
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
    }), whole(crop) ? 0 : 250);
    return () => { active = false; window.clearTimeout(timer); if (made) window.setTimeout(() => URL.revokeObjectURL(made!), 1000); };
  }, [source, crop]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  const back = useMemo(() => backOf(window.location.search), []);

  const assets: Assets = useMemo(() => ({ photo, logo }), [photo, logo]);
  const event = data?.event;
  const words = useMemo(() => event ? wordsOf({ ...event, imageUrl: photo ? "photo" : null }, event.lines) : null, [event, photo]);
  if (data === undefined) return <main className="page-shell site-page poster-page"><p className="poster-empty">Henter eventet …</p></main>;
  if (data === null || !event || !words) return <main className="page-shell site-page poster-page"><p className="poster-empty">Eventet findes ikke, eller du har ikke adgang. <a href="/plakater">Tilbage</a></p></main>;

  const size = photo ? { width: photo.naturalWidth, height: photo.naturalHeight, cropped: Boolean(source) && photo !== source, shaped: isShaped(photo) } : null;
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
      body: JSON.stringify({ text, instagramText, channels, ...(post.video ? { video: useVideo } : {}), ...(when === "valgt" && chosenAt ? { at: new Date(chosenAt).getTime(), ...(chosenIg && channels.includes("instagram") ? { instagramAt: new Date(chosenIg).getTime() } : {}) } : { now: when === "nu" || !planned }) }) }).catch(() => null) : null;
    const body = response?.ok ? await response.json().catch(() => null) as { publishAtMs: number | null; channels: string[]; status?: string; instagramAtMs?: number | null } | null : null;
    setBusy(false);
    if (body) { setSent(body); setMessage(""); setStep("sendt"); window.scrollTo(0, 0); }
    else {
      const error = response?.status === 422 ? (await response.json().catch(() => null) as { error?: string } | null)?.error : null;
      setMessage(!stored?.ok ? "Billedet kunne ikke gemmes. Prøv igen." : error === "time" ? "Vælg et tidspunkt fra nu og til senest en time, før eventet begynder." : error ? "Vælg mindst ét sted, opslaget skal ud." : "Opslaget kunne ikke publiceres. Prøv igen.");
    }
  };
  const proposeWords = async () => {
    setWriting("Saga skriver …");
    const response = await fetch(`/plakater/${id}/tekst`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wish }) }).catch(() => null);
    const words = response?.ok ? await response.json().catch(() => null) as { text?: string; instagramText?: string } | null : null;
    if (!words?.text) { setWriting("Saga kunne ikke skrive et forslag lige nu. Prøv igen."); return; }
    setText(words.text); if (words.instagramText) setInstagramText(words.instagramText);
    setWriting("Forslaget står i felterne. Ret det, hvis du vil.");
  };
  const remakeVideo = async () => {
    if (!post || !template) return;
    setVideoNote("Sender …");
    const response = await fetch(`/plakater/${id}/video`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ template }) }).catch(() => null);
    const error = response && !response.ok ? (await response.json().catch(() => null) as { error?: string } | null)?.error : null;
    if (response?.ok) {
      setData(d => d && d.post ? { ...d, post: { ...d.post, video: null, noVideo: false, videoTemplate: template, status: "draft" } } : d);
      setVideoNote(`Ny video på vej i "${post.videoTemplates.find(t => t.no === template)?.name ?? template}" (højst en halv time). Saga skriver til dig på Telegram med et link, når den er klar - godkend den dér. Godkender du her før, kommer opslaget ud med billedet.`);
    } else setVideoNote(error === "late" ? "Der er for kort tid til eventet til at lave en ny video." : error === "template" ? "Den skabelon kan ikke bruges til dette event." : "Det lykkedes ikke. Prøv igen.");
  };
  // "flere ... video designs på kommando": more videos in other templates, made within a quarter of an hour; and the chair's pick among them.
  const moreVideos = async () => {
    setVideoNote("Sender …");
    const response = await fetch(`/plakater/${id}/video`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ more: true }) }).catch(() => null);
    const error = response && !response.ok ? (await response.json().catch(() => null) as { error?: string } | null)?.error : null;
    if (response?.ok) { setData(d => d && d.post ? { ...d, post: { ...d.post, videoAsked: [1] } } : d); setVideoNote("Saga laver op til tre nye videoer i andre skabeloner (cirka et kvarter). Hun skriver til dig på Telegram med et link, når de er klar - eller kom tilbage hertil."); }
    else setVideoNote(error === "late" ? "Der er for kort tid til eventet til at lave flere videoer." : error === "none" ? "Opslaget har allerede fået alle de skabeloner, det kan bruge." : error === "busy" ? "Saga er allerede i gang med nye videoer." : "Det lykkedes ikke. Prøv igen.");
  };
  const pickVideo = async (index: number) => {
    const response = await fetch(`/plakater/${id}/video`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pick: index }) }).catch(() => null);
    const body = response?.ok ? await response.json().catch(() => null) as { video?: string; videoTemplate?: number } | null : null;
    if (!body?.video) { setVideoNote("Videoen kunne ikke vælges. Prøv igen."); return; }
    setData(d => d && d.post ? { ...d, post: { ...d.post, video: body.video!, videoTemplate: body.videoTemplate ?? d.post.videoTemplate, noVideo: false, status: "draft" } } : d);
    setUseVideo(true); setVideoNote("Videoen er valgt. Den står nu i opslaget til venstre.");
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
      <p>{sent.status === "published" ? `Det er publiceret på ${channelNames(sent.channels)}.` : sent.instagramAtMs && sent.instagramAtMs !== sent.publishAtMs && sent.channels.length > 1
        ? `Saga sender det på Facebook ${WHEN.format(new Date(sent.publishAtMs!))} og på Instagram ${WHEN.format(new Date(sent.instagramAtMs))}.`
        : sent.publishAtMs && sent.publishAtMs > Date.now() + 60_000 ? `Saga sender det ${WHEN.format(new Date(sent.publishAtMs))} på ${channelNames(sent.channels)}.` : `Saga sender det om lidt på ${channelNames(sent.channels)}.`} Du skal ikke gøre mere.</p>
      <p className="studio-actions"><a className="lys-btn" href={back}>Tilbage</a><a className="lys-btn ghost" href={postLink}>Se opslaget i PR og SoMe</a></p>
    </section>
  </main>;

  if (step === "opslag" && preview && post) return <main className="page-shell site-page poster-page studio">{head}
    <section className="studio-post">
      <div className="studio-mocks"><div className="studio-mock">
        <header><img src={LOGO_FILE} alt="" /><b>Hjerterum</b></header>
        <p className="studio-mock-text">{text}</p>
        {post.link && <p className="studio-mock-link">{post.link}</p>}
        <img className="studio-mock-picture" src={preview.url} alt="Opslagets billede" />
      </div>
      {post.video && channels.includes("instagram") && <div className="studio-mock studio-mock-video">
        <header><img src={LOGO_FILE} alt="" /><b>Instagram</b><span className="studio-muted">{useVideo ? "reel" : "billedet"}</span></header>
        {useVideo ? <video src={post.video} controls muted playsInline autoPlay loop /> : <img className="studio-mock-picture" src={preview.url} alt="" />}
      </div>}</div>
      <div className="studio-box">
        <h2>Det færdige opslag</h2>
        <p className="studio-muted">Sådan kommer opslaget til at se ud. Ret teksten, hvis du vil, vælg hvornår, og godkend.</p>
        <div className="studio-writer">
          <input value={wish} maxLength={300} onChange={e => setWish(e.target.value)} placeholder="Ønske til teksten, fx mere legende (valgfrit)" aria-label="Ønske til teksten" />
          <button type="button" className="lys-btn ghost" disabled={writing === "Saga skriver …"} onClick={() => void proposeWords()}>✨ Nyt forslag fra Saga</button>
          {writing && <p className="studio-muted" role="status">{writing}</p>}
        </div>
        <label className="studio-field"><span>Teksten på Facebook</span><textarea rows={5} value={text} onChange={e => setText(e.target.value)} /></label>
        {post.instagram && channels.includes("instagram") && <label className="studio-field"><span>Teksten på Instagram (link virker ikke dér, så den peger på bio)</span>
          <textarea rows={5} value={instagramText} onChange={e => setInstagramText(e.target.value)} /></label>}
        <fieldset className="studio-choices"><legend>Hvor</legend>
          <label><input type="checkbox" checked={channels.includes("facebook")} onChange={() => toggle("facebook")} /> Facebook</label>
          {post.instagram ? <label><input type="checkbox" checked={channels.includes("instagram")} onChange={() => toggle("instagram")} /> Instagram</label>
            : <span className="studio-muted">Instagram er ikke forbundet.</span>}
          {post.video && channels.includes("instagram") && <label><input type="checkbox" checked={useVideo} onChange={() => setUseVideo(!useVideo)} /> Videoen på Instagram (ellers billedet)</label>}
        </fieldset>
        {post.instagram && channels.includes("instagram") && post.videoTemplates.length > 1 && (post.videoRemake || videoNote) && <fieldset className="studio-choices"><legend>Videoen på Instagram</legend>
          <p className="studio-muted">{post.video ? `Saga har lavet videoen i skabelon ${post.videoTemplate ?? ""}: ${post.videoTemplates.find(t => t.no === post.videoTemplate)?.name ?? ""}. Vælg en anden, hvis du vil.` : "Vælg skabelonen til videoen."}</p>
          <div className="studio-whens">
            <label><span>Skabelon</span><select value={template} onChange={e => setTemplate(Number(e.target.value))}>
              {post.videoTemplates.map(t => <option key={t.no} value={t.no}>{t.no}. {t.name} · {t.used}</option>)}</select></label>
            <button type="button" className="lys-btn ghost" disabled={!post.videoRemake || !template || (template === post.videoTemplate && Boolean(post.video))} onClick={() => void remakeVideo()}>Lav videoen</button>
          </div>
          {post.videoChoices.some(c => c.video !== post.video) && <div className="studio-choices-grid">
            {post.videoChoices.map((c, i) => c.video === post.video ? null : <figure key={c.video}><video src={c.video} controls muted playsInline loop preload="metadata" />
              <figcaption>{c.template}. {post.videoTemplates.find(t => t.no === c.template)?.name ?? ""}<button type="button" className="lys-btn ghost" onClick={() => void pickVideo(i)}>Vælg denne</button></figcaption></figure>)}
          </div>}
          {post.videoAsked.length ? <p className="studio-muted">Saga er i gang med nye videoer.</p>
            : post.videoRemake && <p className="studio-actions"><button type="button" className="lys-btn ghost" onClick={() => void moreVideos()}>✨ Lav flere videoer</button></p>}
          {videoNote && <p className="studio-muted" role="status">{videoNote}</p>}
        </fieldset>}
        <fieldset className="studio-choices"><legend>Hvornår</legend>
          {planned ? <label><input type="radio" name="hvornaar" checked={when === "plan"} onChange={() => setWhen("plan")} /> Sagas forslag: {post.instagramAtMs && post.instagramAtMs !== planned && channels.includes("instagram") && channels.includes("facebook")
            ? `Facebook ${WHEN.format(new Date(planned))} · Instagram ${WHEN.format(new Date(post.instagramAtMs))}` : WHEN.format(new Date(planned))}</label> : null}
          <label><input type="radio" name="hvornaar" checked={when === "nu" || (!planned && when === "plan")} onChange={() => setWhen("nu")} /> Nu</label>
          <label><input type="radio" name="hvornaar" checked={when === "valgt"} onChange={() => setWhen("valgt")} /> Vælg tidspunkt</label>
          {when === "valgt" && <div className="studio-whens">
            <label><span>{channels.includes("instagram") && channels.includes("facebook") ? "Facebook" : "Tidspunkt"}</span><input type="datetime-local" className="studio-when" value={chosenAt} min={localInput(Date.now())} max={localInput(Date.parse(event.startsAt) - 3_600_000)}
              onChange={e => setChosenAt(e.target.value)} /></label>
            {channels.includes("instagram") && channels.includes("facebook") && <label><span>Instagram (tomt: samtidig)</span><input type="datetime-local" className="studio-when" value={chosenIg} min={localInput(Date.now())} max={localInput(Date.parse(event.startsAt) - 3_600_000)}
              onChange={e => setChosenIg(e.target.value)} /></label>}
          </div>}
        </fieldset>
        {post.status === "approved" && <p className="studio-muted">Opslaget er allerede godkendt. Publicerer du, får det det nye billede og den nye tekst.</p>}
        {message && <p className="studio-message" role="status">{message}</p>}
        <p className="studio-actions"><button type="button" className="lys-btn" disabled={busy || !channels.length || (when === "valgt" && !chosenAt)} onClick={() => void publish()}>{when === "valgt" || (when === "plan" && planned) ? "Godkend og planlæg" : "Publicér nu"}</button>
          <button type="button" className="lys-btn ghost" disabled={busy} onClick={() => { setStep("forslag"); setMessage(""); }}>← Tilbage til billedet</button></p>
      </div>
    </section>
  </main>;

  return <main className="page-shell site-page poster-page studio">{head}
    <section className="studio-proposal">
      {!logo ? <p className="poster-empty">Tegner forslaget …</p>
        : <Design key={`${chosen}-${format}-${palette}`} variant={chosen} palette={palette} words={words} assets={assets} format={format} chosen title={event.title} big canvasRef={proposal} />}
      <div className="studio-box">
        <h2>Sagas forslag</h2>
        {post ? <>
          <p>Det her er billedet til eventets opslag på Facebook og Instagram. Ser det godt ud, så tryk <b>Næste</b>. Så ser du det færdige opslag med teksten, vælger hvornår, og godkender.</p>
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
      {!logo ? <p className="poster-empty">Tegner designene …</p> : <>{PALETTES.slice(0, moods).map(mood => <div key={mood.key}>
        {mood.key !== "varm" && <h3 className="studio-mood">{mood.label}</h3>}
        <div className="poster-grid">
        {all.map(key => {
          const fits = photoFits(key, format, size);
          return fits.ok ? <Design key={`${key}-${mood.key}`} variant={key} palette={mood.key} words={words} assets={assets} format={format} chosen={key === chosen && mood.key === palette} title={event.title} soft={Boolean(fits.soft)}
            onPick={() => { setVariant(key); setPalette(mood.key); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
            : mood.key === "varm" ? <figure key={key} className="poster-card is-refused"><div className="poster-refused" role="note"><b>Passer ikke</b><p>{fits.reason}</p></div>
              <figcaption><div><b>{[...VARIANTS, OWN_PICTURE].find(v => v.key === key)!.label}</b></div></figcaption></figure> : null;
        })}
      </div></div>)}
      {moods < PALETTES.length && <p className="studio-actions"><button type="button" className="lys-btn ghost" onClick={() => setMoods(moods + 1)}>Vis flere designs ({PALETTES[moods]!.label})</button></p>}</>}
    </section>}
  </main>;
}
