import { useEffect, useState } from "react";

/** Requested: "en programoversigt i fjernsynet på nogle linjer" + "fem eventfotos" + a short warm intro to the next two events by Saga. */
type Item = { key: string; title: string; startsAt: string; endsAt: string | null; host: string | null; imageUrl: string | null; link: string | null };

const TZ = "Europe/Copenhagen";
const day = (iso: string) => new Intl.DateTimeFormat("da-DK", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(new Date(iso));
const time = (iso: string) => new Intl.DateTimeFormat("da-DK", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso)).replace(":", ".");
const firstName = (host: string | null) => (host ?? "").replace(/^(med|ved)\s+/i, "").split(/\s*(?:,| og |&)\s*/)[0]?.split(/\s+/)[0] ?? "";

export function ProgramGuide() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [intro, setIntro] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    fetch("/api/events/program").then(async (r) => { const body = r.ok ? await r.json() as { intro: string | null; items: Item[] } : { intro: null, items: [] }; if (active) { setItems(body.items); setIntro(body.intro); } }).catch(() => { if (active) setItems([]); });
    return () => { active = false; };
  }, []);
  if (!items) return null;
  if (!items.length) return <article className="lys-card program-guide"><p className="lys-kicker">Det sker i huset</p><p className="lys-sub">Der er stille i kalenderen lige nu - kig forbi snart.</p></article>;
  const now = Date.now();
  const days: Array<[string, Item[]]> = [];
  for (const item of items) {
    const d = day(item.startsAt);
    const last = days[days.length - 1];
    if (last && last[0] === d) last[1].push(item); else days.push([d, [item]]);
  }
  const nextKey = items.find((i) => Date.parse(i.startsAt) > now)?.key;
  const isNow = (i: Item) => Date.parse(i.startsAt) <= now && now < Date.parse(i.endsAt ?? i.startsAt);
  const open = (i: Item) => i.link ?? "/member-portal/kalender";
  return (
    <article className="lys-card program-guide">
      <p className="lys-kicker">Det sker i huset</p>
      {intro && <p className="program-intro">{intro}</p>}
      <div className="program-layout">
        <div className="program-list">
          {days.map(([d, list]) => (
            <section key={d}>
              <h3>{d}</h3>
              <ul>{list.map((i) => (
                <li key={i.key} className={hover === i.key ? "is-hover" : ""} onMouseEnter={() => setHover(i.key)} onMouseLeave={() => setHover(null)}>
                  <a href={open(i)} target={i.link?.startsWith("http") ? "_blank" : undefined} rel="noopener">
                    <time>{time(i.startsAt)}</time><span className="program-title">{i.title}</span><span className="program-dots" aria-hidden="true" />
                    <span className="program-host">{firstName(i.host)}</span>
                    {isNow(i) ? <span className="program-badge now">NU</span> : i.key === nextKey ? <span className="program-badge">NÆSTE</span> : null}
                  </a>
                </li>))}</ul>
            </section>
          ))}
        </div>
        <div className="program-mosaic">
          {items.map((i, index) => (
            <a key={i.key} href={open(i)} target={i.link?.startsWith("http") ? "_blank" : undefined} rel="noopener"
              className={"program-tile" + (index === 0 ? " is-lead" : "") + (hover === i.key ? " is-hover" : "")}
              onMouseEnter={() => setHover(i.key)} onMouseLeave={() => setHover(null)}>
              <span className="program-photo">{i.imageUrl ? <img src={i.imageUrl} alt="" loading="lazy" /> : <span className="program-photo-empty" aria-hidden="true">◎</span>}
                <span className="program-when">{time(i.startsAt)}</span></span>
              <span className="program-caption"><strong>{i.title}</strong>{firstName(i.host) && <span>{firstName(i.host)}</span>}</span>
            </a>
          ))}
        </div>
      </div>
      <p className="member-overview-more"><a className="lys-link" href="/member-portal/kalender">Hele kalenderen →</a></p>
    </article>
  );
}
