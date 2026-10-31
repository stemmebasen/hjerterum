import { useEffect, useRef, useState, type RefObject } from "react";
import { EventPhoto } from "./event-photo";

/** Requested: "Lad resuméet altid inkludere de kommende tre events" - Saga's words about the next three (worker/program.ts) under "Snart i Hjerterum".
 * Earlier: "når jeg siger tv-program mener jeg ikke en programoversigt, men en continuity speaker der fortæller hvad der er på vej" +
 * "fem eventfotos". Saga's words about the next two events, beside the five photos. */
type Item = { key: string; title: string; startsAt: string; endsAt: string | null; host: string | null; imageUrl: string | null; link: string | null };

const TZ = "Europe/Copenhagen";
const day = (iso: string) => new Intl.DateTimeFormat("da-DK", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(new Date(iso));
const shortDay = (iso: string) => new Intl.DateTimeFormat("da-DK", { timeZone: TZ, weekday: "short" }).format(new Date(iso)).replace(".", "");
const time = (iso: string) => new Intl.DateTimeFormat("da-DK", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso)).replace(":", ".");
const firstName = (host: string | null) => (host ?? "").replace(/^(med|ved)\s+/i, "").split(/\s*(?:,| og |&)\s*/)[0]?.split(/\s+/)[0] ?? "";

/** Requested: "Lad event billederne forsigtigt scrolle frem og tilbage så man kan se man kan se flere/scrolle". When the photos do not all fit
 * (on a phone), the strip slides a little forward and back once it is in view - up to three times, a few seconds apart - and stops for good
 * when the visitor touches or scrolls it. Never with "reduce motion". */
function useScrollHint(strip: RefObject<HTMLDivElement | null>, ready: boolean) {
  useEffect(() => {
    const el = strip.current;
    if (!ready || !el || typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let stopped = false, rounds = 0;
    const timers: number[] = [];
    const later = (fn: () => void, ms: number) => { timers.push(window.setTimeout(fn, ms)); };
    const stop = () => { stopped = true; timers.forEach(window.clearTimeout); el.style.scrollSnapType = ""; };
    const nudge = () => {
      if (stopped || el.scrollWidth <= el.clientWidth + 8 || el.scrollLeft > 4) return;
      // Snapping would turn the small slide into a jump to the next photo: off while she nudges.
      el.style.scrollSnapType = "none";
      el.scrollTo({ left: Math.min(90, el.scrollWidth - el.clientWidth), behavior: "smooth" });
      later(() => { if (!stopped) el.scrollTo({ left: 0, behavior: "smooth" }); }, 900);
      later(() => { if (!stopped) el.style.scrollSnapType = ""; }, 1700);
      if (++rounds < 3) later(nudge, 7000);
    };
    const touched = () => stop();
    el.addEventListener("pointerdown", touched, { once: true });
    el.addEventListener("touchstart", touched, { once: true, passive: true });
    el.addEventListener("wheel", touched, { once: true, passive: true });
    const seen = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { seen.disconnect(); later(nudge, 1200); }
    }, { threshold: 0.6 });
    seen.observe(el);
    return () => { stop(); seen.disconnect(); el.removeEventListener("pointerdown", touched); el.removeEventListener("touchstart", touched); el.removeEventListener("wheel", touched); };
  }, [strip, ready]);
}

export function ProgramGuide() {
  const strip = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<Item[] | null>(null);
  const [intro, setIntro] = useState<string | null>(null);
  const [heading, setHeading] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    fetch("/api/events/program").then(async (r) => {
      const body = r.ok ? await r.json() as { intro: string | null; heading?: string | null; items: Item[] } : { intro: null, items: [] };
      if (active) { setItems(body.items); setIntro(body.intro); setHeading(body.heading ?? null); }
    }).catch(() => { if (active) setItems([]); });
    return () => { active = false; };
  }, []);
  useScrollHint(strip, Boolean(items?.length));
  if (!items) return null;
  if (!items.length) return <article className="lys-card program-guide"><p className="lys-kicker">Snart i Hjerterum</p><p className="lys-sub">Der er stille i kalenderen lige nu - kig forbi snart.</p></article>;
  const nowMs = Date.now();
  const next = items.find((i) => Date.parse(i.endsAt ?? i.startsAt) > nowMs) ?? items[0]!;
  // Until Saga has written today's words: a plain line about the next event.
  const words = intro ?? `Næste gang i huset: ${next.title}${firstName(next.host) ? ` med ${firstName(next.host)}` : ""}, ${day(next.startsAt)} kl. ${time(next.startsAt)}.`;
  const open = (i: Item) => i.link ?? "/member-portal/kalender";
  return (
    <article className="lys-card program-guide">
      <div className="program-head">
        <p className="lys-kicker">{heading ?? "Snart i Hjerterum"}</p>
        <a className="lys-link" href="/member-portal/kalender">Hele kalenderen →</a>
      </div>
      <p className="program-intro">{words}</p>
      {/* Reported: "Eventfoto dimensionerne skal passe alle steder ... denne side bl.a. skal omdesignes". The next event large, in the
          event photo's own size (1920 × 1005, never cut), and the ones after it as a calm list with small photos of the same shape. */}
      <div className="program-layout">
        <a href={open(next)} target={next.link?.startsWith("http") ? "_blank" : undefined} rel="noopener" className="program-feature">
          <span className="program-photo">{next.imageUrl ? <EventPhoto src={next.imageUrl} /> : <span className="program-photo-empty" aria-hidden="true">◎</span>}
            <span className="program-next">Næste</span></span>
          <span className="program-when">{day(next.startsAt)} · kl. {time(next.startsAt)}</span>
          <strong className="program-feature-title">{next.title}</strong>
          {firstName(next.host) && <span className="program-host">med {next.host!.replace(/^(med|ved)\s+/i, "")}</span>}
        </a>
        <div className="program-strip" ref={strip}>
          {items.filter((i) => i.key !== next.key).slice(0, 4).map((i) => (
            <a key={i.key} href={open(i)} target={i.link?.startsWith("http") ? "_blank" : undefined} rel="noopener" className="program-tile">
              <span className="program-thumb">{i.imageUrl ? <EventPhoto src={i.imageUrl} /> : <span className="program-photo-empty" aria-hidden="true">◎</span>}</span>
              <span className="program-tile-text"><span className="program-when">{shortDay(i.startsAt)} {time(i.startsAt)}</span>
                <strong className="program-title">{i.title}</strong></span>
            </a>
          ))}
        </div>
      </div>
    </article>
  );
}

/** Requested: "samt på hjemmesiden" - the same words, quietly, above the website's calendar. */
export function SpeakerLine({ withHeading = true }: { withHeading?: boolean }) {
  const [said, setSaid] = useState<{ intro: string | null; heading?: string | null; items?: Item[] } | null>(null);
  useEffect(() => {
    let active = true;
    fetch("/api/events/program").then(async (r) => { if (active && r.ok) setSaid(await r.json() as { intro: string | null; heading?: string | null; items?: Item[] }); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  // Requested: "Der er ikke resumé endnu" - until Saga has written the words, a plain line with the next three.
  const nowMs = Date.now();
  const next = (said?.items ?? []).filter((i) => Date.parse(i.startsAt) > nowMs).slice(0, 3);
  const words = said?.intro ?? (next.length ? next.map((i) => `${shortDay(i.startsAt)} kl. ${time(i.startsAt)}: »${i.title}«`).join(" · ") : null);
  return words ? <p className="speaker-line">{withHeading && said?.heading && <strong>{said.heading}. </strong>}{words}</p> : null;
}
