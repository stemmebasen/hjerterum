import { useEffect, useRef, useState, type ReactNode } from "react";
import { chooseVariant, drawPoster, OWN_PICTURE, photoFits, SIZES, VARIANTS, wordsOf, type Assets, type Format, type PosterEvent, type PosterWords, type VariantKey } from "./event-poster";

/** Requested: "Vi skal have fem varianter systemet kan vælge mellem". /plakat/<id>: an event's poster for Instagram and Facebook
 * in five designs (event-poster.ts), the system's choice first; each can be saved as a picture, as a post or as a story.
 * <id> is an event from the membership system's calendar (24 hex) or one of the house's own events ("h" + its number). */

type Loaded = { event: PosterEvent; lines: string[] };

async function loadEvent(id: string): Promise<Loaded | null> {
  if (/^[0-9a-f]{24}$/.test(id)) {
    const response = await fetch(`/api/events/external/${id}`);
    if (!response.ok) return null;
    const e = await response.json() as { id: string; title: string; startsAt: string; endsAt: string | null; host: string | null; category: string | null; imageUrl: string | null; paragraphs?: string[] };
    return { event: { id: e.id, title: e.title, startsAt: e.startsAt, endsAt: e.endsAt, host: e.host, category: e.category,
      imageUrl: e.imageUrl ? `/api/poster-image?src=${encodeURIComponent(e.imageUrl)}` : null }, lines: e.paragraphs ?? [] };
  }
  const house = /^h(\d+)$/.exec(id);
  if (!house) return null;
  const response = await fetch("/api/room-bookings/public");
  if (!response.ok) return null;
  const list = await response.json() as Array<{ id: number; title: string; startsAt: string; endsAt: string | null; teacherName?: string | null; imageUrl?: string | null; description?: string | null }>;
  const b = list.find(item => String(item.id) === house[1]);
  if (!b) return null;
  return { event: { id, title: b.title, startsAt: b.startsAt, endsAt: b.endsAt, host: b.teacherName ?? null, category: null,
    imageUrl: b.imageUrl && b.imageUrl.startsWith("/") ? b.imageUrl : null }, lines: (b.description ?? "").split(/\n+/) };
}

const image = (src: string) => new Promise<HTMLImageElement | null>(resolve => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => resolve(null);
  img.src = src;
});

/** The poster's type must be loaded before the canvas draws, or it falls back to Georgia. */
async function fontsReady() {
  const faces = ["400 100px \"Playfair Display\"", "italic 400 100px \"Playfair Display\"", "400 30px Inter", "500 30px Inter", "600 30px Inter"];
  await Promise.all(faces.map(face => document.fonts.load(face).catch(() => [])));
}

const slug = (text: string) => text.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 40) || "event";

function Poster({ variant, words, assets, format, chosen }: { variant: VariantKey; words: PosterWords; assets: Assets; format: Format; chosen: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (ref.current) drawPoster(ref.current, variant, words, assets, format); }, [variant, words, assets, format]);
  const info = [...VARIANTS, OWN_PICTURE].find(v => v.key === variant)!;
  const save = () => ref.current?.toBlob(blob => {
    if (!blob) return;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `hjerterum-${slug(words.title)}-${variant}-${format}.png`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 4000);
  }, "image/png");
  return <figure className={"poster-card" + (chosen ? " is-chosen" : "")}>
    <canvas ref={ref} className={"poster-canvas is-" + format} aria-label={`${info.label}: opslag til ${words.title}`} />
    <figcaption>
      <div><b>{info.label}</b>{chosen && <span className="poster-badge">Systemets valg</span>}<p>{info.about}</p></div>
      <button type="button" className="lys-btn" onClick={save}>Hent billede</button>
    </figcaption>
  </figure>;
}

function Refused({ variant, reason }: { variant: VariantKey; reason: string }) {
  const info = [...VARIANTS, OWN_PICTURE].find(v => v.key === variant)!;
  return <figure className="poster-card is-refused">
    <div className="poster-refused" role="note"><b>Afvist</b><p>{reason}</p></div>
    <figcaption><div><b>{info.label}</b><p>{info.about}</p></div></figcaption>
  </figure>;
}

export function PosterPage({ id, header, footer }: { id: string; header: ReactNode; footer: ReactNode }) {
  const [loaded, setLoaded] = useState<Loaded | null | undefined>(undefined);
  const [assets, setAssets] = useState<Assets | null>(null);
  const [format, setFormat] = useState<Format>("opslag");

  useEffect(() => {
    let active = true;
    void (async () => {
      const found = await loadEvent(id).catch(() => null);
      if (!active) return;
      setLoaded(found);
      if (!found) return;
      document.title = `Opslag: ${found.event.title} · Hjerterum`;
      const [photo, logo] = await Promise.all([found.event.imageUrl ? image(found.event.imageUrl) : Promise.resolve(null), image("/logo.png"), fontsReady()]);
      if (active) setAssets({ photo, logo });
    })();
    return () => { active = false; };
  }, [id]);

  const event = loaded?.event;
  const words = loaded ? wordsOf(loaded.event, loaded.lines) : null;
  const size = assets?.photo ? { width: assets.photo.naturalWidth, height: assets.photo.naturalHeight } : null;
  const chosen = event && assets ? chooseVariant(event.imageUrl && assets.photo ? event : { ...event, imageUrl: null }, size, format) : null;
  const order: VariantKey[] = chosen ? [chosen, ...VARIANTS.map(v => v.key).filter(k => k !== chosen)] : [];
  // The teacher's own picture, whole - when there is one.
  if (chosen && assets?.photo) order.push(OWN_PICTURE.key);

  return <main className="page-shell site-page poster-page">
    {header}
    <section className="lys-intro site-intro">
      <div><p className="lys-kicker">Opslag til de sociale medier</p><h1 className="lys-title">{event ? event.title : "Opslag"}</h1></div>
      <div className="site-intro-side"><p>Fem designs i Hjerterums farver. Systemet har valgt det, der passer bedst til eventet - de andre står under det. Tryk "Hent billede", og læg det på Instagram eller Facebook.</p>
        <div className="poster-format" role="group" aria-label="Format">
          {(Object.keys(SIZES) as Format[]).map(key => <button key={key} type="button" className={"lys-btn" + (format === key ? "" : " ghost")} aria-pressed={format === key} onClick={() => setFormat(key)}>{SIZES[key].label}</button>)}
        </div></div>
    </section>
    {loaded === null && <p className="poster-empty">Eventet findes ikke længere i kalenderen.</p>}
    {loaded && (!assets || !words) && <p className="poster-empty">Tegner opslagene …</p>}
    {assets && words && <div className="poster-grid">
      {order.map(variant => {
        // Requested: "Systemet skal sørge for at dimensionerne er i orden eller afvise" - a design the photo is too small for is refused.
        const fits = photoFits(variant, format, size);
        return fits.ok ? <Poster key={variant} variant={variant} words={words} assets={assets} format={format} chosen={variant === chosen} />
          : <Refused key={variant} variant={variant} reason={fits.reason} />;
      })}
    </div>}
    {footer}
  </main>;
}
