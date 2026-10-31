import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, type ClerkBrowser } from "./clerk";
import {
  FIRST_HOUR, LAST_HOUR, MIN_MINUTES, EVENING_FROM, PROBLEM_TEXT, RENT_TYPES, BUFFER_CHOICES,
  bufferText, busyDuring, pricedSpan, clockOf, clockOrMidnight, danishClock, endMinutes, endOptions, endRange, entryMinutes, firstFreeStart, hoursText, longDay, minutesOf,
  monthGrid, monthTitle, planProblem, priceText, quoteForPlan, startOptions, todayKey, weekdayOf, windowOf,
  type DayEntry, type Plan, type RentType
} from "./event-planner-logic";

/** The member's choice of day, time and kind of rent for an event: a date picker, what is on the chosen day, the times as
 * choices, and the room's price for each kind of rent (requested). */

const HOUR_PX = 38;
const TRACK_HEIGHT = (LAST_HOUR - FIRST_HOUR) * HOUR_PX;
const WEEKDAYS = ["ma", "ti", "on", "to", "fr", "lø", "sø"];
const topOf = (minutes: number) => Math.max(0, Math.min(TRACK_HEIGHT, ((minutes - FIRST_HOUR * 60) / 60) * HOUR_PX));

/** Events at the same time side by side: each gets a lane, and every event in an overlapping group knows how many lanes it has. */
function lanes(ranges: Array<{ from: number; to: number } | null>): Array<{ at: number; of: number } | null> {
  const out: Array<{ at: number; of: number } | null> = ranges.map(() => null);
  const order = ranges.map((r, i) => ({ r, i })).filter((x): x is { r: { from: number; to: number }; i: number } => Boolean(x.r)).sort((a, b) => a.r.from - b.r.from || b.r.to - a.r.to);
  let group: Array<{ i: number; at: number; to: number }> = [], groupEnd = -1;
  const close = () => { const of = Math.max(1, ...group.map(g => g.at + 1)); for (const g of group) out[g.i] = { at: g.at, of }; group = []; };
  for (const { r, i } of order) {
    if (r.from >= groupEnd && group.length) close();
    const taken = new Set(group.filter(g => g.to > r.from).map(g => g.at));
    let at = 0; while (taken.has(at)) at++;
    group.push({ i, at, to: r.to }); groupEnd = Math.max(groupEnd, r.to);
  }
  if (group.length) close();
  return out;
}

export function EventPlanner({ clerk, plan, onChange, markedDates, ignoreId, onProblem, title }: {
  clerk: ClerkBrowser;
  /** Requested: "Her kunne eventets navn godt stå i stedet for 'Dit event'" - the title as written in the form. */
  title?: string;
  plan: Plan;
  onChange: (next: Plan) => void;
  /** Days that already have something in the calendar; they get a dot. */
  markedDates: Set<string>;
  /** Tells the form what, if anything, is wrong with the chosen day and time. */
  onProblem?: (problem: string | null) => void;
  /** The booking being edited: it does not count as busy against itself. */
  ignoreId?: number | null;
}) {
  const today = todayKey();
  const [view, setView] = useState(() => {
    const base = plan.date ? new Date(`${plan.date}T12:00:00`) : new Date();
    return { year: base.getFullYear(), month: base.getMonth() };
  });
  const [entries, setEntries] = useState<DayEntry[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const touched = useRef(false);

  useEffect(() => {
    if (!plan.date) { setEntries([]); setStatus("idle"); return; }
    let live = true;
    setStatus("loading");
    void apiFetch(clerk, `/api/room-bookings/day?date=${plan.date}`)
      .then(async (response) => {
        if (!live) return;
        if (!response.ok) { setStatus("error"); return; }
        const body = await response.json() as { items?: DayEntry[] };
        setEntries(body.items ?? []);
        setStatus("ready");
      })
      .catch(() => { if (live) setStatus("error"); });
    return () => { live = false; };
  }, [clerk, plan.date]);

  const shown = useMemo(() => entries.filter((entry) => !(ignoreId != null && entry.own && entry.id === ignoreId)), [entries, ignoreId]);

  // A freshly chosen day: if the suggested time is taken, move to the first free two hours - until the member has chosen a time.
  useEffect(() => {
    if (status !== "ready" || touched.current || !plan.date) return;
    const room = windowOf(plan);
    if (!busyDuring(shown, plan.date, room.from, room.to).length) return;
    const length = endMinutes(plan.end) - minutesOf(plan.start);
    const free = firstFreeStart(shown, plan.date, length, plan.setup, plan.cleanup);
    if (free) onChange({ ...plan, start: free, end: clockOrMidnight(minutesOf(free) + length) });
  }, [status, shown]); // eslint-disable-line react-hooks/exhaustive-deps

  const problem = status === "error" ? null : planProblem(plan, shown);
  useEffect(() => { onProblem?.(status === "loading" ? (plan.date ? "loading" : "no_date") : problem); }, [problem, status]); // eslint-disable-line react-hooks/exhaustive-deps
  const from = minutesOf(plan.start), to = endMinutes(plan.end);
  const chosenOk = plan.date && Number.isFinite(from) && Number.isFinite(to);
  const duration = chosenOk ? to - from : 0;
  const room = windowOf(plan);

  function pickDate(date: string) {
    touched.current = false;
    onChange({ ...plan, date });
  }
  function setStart(start: string) {
    touched.current = true;
    const begin = minutesOf(start);
    const range = endRange(begin, plan.setup, plan.cleanup);
    const end = Math.max(range.min, Math.min(begin + (duration || 0), range.max));
    onChange({ ...plan, start, end: clockOrMidnight(end) });
  }
  // Setup or cleanup changed: keep the event's time, but shorten it if the room would otherwise be rented past the limits.
  function setBuffer(which: "setup" | "cleanup", minutes: number) {
    touched.current = true;
    const next = { ...plan, [which]: minutes };
    const begin = minutesOf(next.start);
    const range = endRange(begin, next.setup, next.cleanup);
    const end = Math.max(range.min, Math.min(endMinutes(next.end), range.max));
    onChange({ ...next, end: clockOrMidnight(end) });
  }
  function setEnd(end: string) { touched.current = true; onChange({ ...plan, end }); }
  function clickTrack(event: React.MouseEvent<HTMLDivElement>) {
    if (!plan.date) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const raw = FIRST_HOUR * 60 + Math.round(((event.clientY - rect.top) / HOUR_PX) * 2) * 30;
    setStart(clockOf(Math.max(FIRST_HOUR * 60, Math.min(raw, LAST_HOUR * 60 - MIN_MINUTES))));
  }
  // Requested: "Kan man trække sin ønskede tidsramme op og ned?" - drag the chosen time to move it, or its lower edge to make it
  // longer or shorter; in half hours, 2-10 hours of rent with setup and cleanup, between FIRST_HOUR and midnight.
  const drag = useRef<{ mode: "move" | "end"; y: number; from: number; to: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  function startDrag(event: React.PointerEvent<HTMLDivElement>, mode: "move" | "end") {
    if (!chosenOk) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { mode, y: event.clientY, from, to };
    setDragging(true);
  }
  function onDrag(event: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    const step = Math.round(((event.clientY - d.y) / HOUR_PX) * 2) * 30;
    let nextFrom = d.from, nextTo = d.to;
    if (d.mode === "move") {
      const length = d.to - d.from;
      nextFrom = Math.max(FIRST_HOUR * 60, Math.min(d.from + step, 24 * 60 - plan.cleanup - length));
      nextTo = nextFrom + length;
    } else {
      const range = endRange(d.from, plan.setup, plan.cleanup);
      nextTo = Math.max(range.min, Math.min(d.to + step, range.max));
    }
    if (nextFrom === from && nextTo === to) return;
    touched.current = true;
    onChange({ ...plan, start: clockOf(nextFrom), end: clockOrMidnight(nextTo) });
  }
  function endDrag() { drag.current = null; setDragging(false); }

  function move(delta: number) {
    const next = new Date(view.year, view.month + delta, 1);
    setView({ year: next.getFullYear(), month: next.getMonth() });
  }

  const viewingNow = view.year === new Date().getFullYear() && view.month === new Date().getMonth();
  const endChoices = endOptions(plan.start, plan.setup, plan.cleanup);

  return (
    <fieldset className="planner">
      <legend>Dato og tid</legend>
      <div className="planner-top">
        <div className="planner-cal" role="group" aria-label="Vælg dato">
          <div className="planner-cal-head">
            <button type="button" className="planner-nav" onClick={() => move(-1)} disabled={viewingNow} aria-label="Forrige måned">‹</button>
            <strong>{monthTitle(view.year, view.month)}</strong>
            <button type="button" className="planner-nav" onClick={() => move(1)} aria-label="Næste måned">›</button>
          </div>
          <div className="planner-weekdays" aria-hidden="true">{WEEKDAYS.map((d) => <span key={d}>{d}</span>)}</div>
          {monthGrid(view.year, view.month).map((week) => (
            <div className="planner-week" key={week[0]!.date}>
              {week.map((cell) => {
                const past = cell.date < today;
                const cls = ["planner-day", !cell.inMonth && "out", cell.date === today && "today", cell.date === plan.date && "on", markedDates.has(cell.date) && "has"].filter(Boolean).join(" ");
                return <button type="button" key={cell.date} className={cls} disabled={past} aria-pressed={cell.date === plan.date}
                  aria-label={longDay(cell.date) + (markedDates.has(cell.date) ? ", der er allerede noget i kalenderen" : "")} onClick={() => pickDate(cell.date)}>{Number(cell.date.slice(8))}</button>;
              })}
            </div>
          ))}
          <p className="planner-key"><span className="planner-dot" /> Der er allerede noget i kalenderen</p>
        </div>

        <div className="planner-dayview">
          {!plan.date ? (
            <div className="planner-empty">
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>
              <h3>Vælg en dato</h3>
              <p>Så ser du, hvad der sker i salen den dag, og kan vælge et ledigt tidspunkt.</p>
            </div>
          ) : (
            <>
              <h3>{longDay(plan.date)}</h3>
              <p className="lys-sub" role="status">{status === "loading" ? "Henter dagen …" : status === "error" ? "Dagen kunne ikke hentes. Du kan stadig vælge tid." : shown.length ? `${shown.length} ting i salen den dag. Tryk på et ledigt tidspunkt, eller træk dit event op og ned.` : "Salen er ledig hele dagen. Tryk på et tidspunkt, eller træk dit event op og ned."}</p>
              <div className="planner-track" style={{ height: TRACK_HEIGHT }} onClick={clickTrack} aria-hidden="true">
                {Array.from({ length: LAST_HOUR - FIRST_HOUR + 1 }, (_, i) => <span className="planner-hour" key={i} style={{ top: i * HOUR_PX }}>{String(FIRST_HOUR + i).padStart(2, "0")}</span>)}
                {EVENING_FROM > FIRST_HOUR * 60 && <div className="planner-evening" style={{ top: topOf(EVENING_FROM) }}><span>18.30 · aftentakst</span></div>}
                {lanes(shown.map((entry) => entryMinutes(entry, plan.date))).map((lane, index) => {
                  const entry = shown[index]!, range = entryMinutes(entry, plan.date);
                  if (!range || !lane) return null;
                  const top = topOf(range.from), bottom = topOf(range.to);
                  const cls = ["planner-block", entry.own && "mine", entry.waiting && "waiting", entry.external && "external"].filter(Boolean).join(" ");
                  // Reported: "Hvorfor er de to events i én samlet boks?" - events at the same time stand side by side.
                  const width = `calc((100% - 12px - ${(lane.of - 1) * 6}px) / ${lane.of})`;
                  return <div key={index} className={cls} style={{ top, height: Math.max(bottom - top, 14), width, right: "auto", left: `calc(6px + ${lane.at} * (${width} + 6px))` }}>
                    <b>{entry.label}</b> <span>{danishClock(range.from)}–{danishClock(range.to)}</span>
                  </div>;
                })}
                {chosenOk && to > from && plan.setup > 0 && <div className="planner-buffer before" style={{ top: topOf(room.from), height: Math.max(topOf(from) - topOf(room.from), 4) }}><span>Klargøring</span></div>}
                {chosenOk && to > from && plan.cleanup > 0 && <div className="planner-buffer after" style={{ top: topOf(to), height: Math.max(topOf(room.to) - topOf(to), 4) }}><span>Oprydning</span></div>}
                {chosenOk && to > from && <div className={"planner-chosen" + (problem ? " bad" : "") + (dragging ? " dragging" : "")} style={{ top: topOf(from), height: Math.max(topOf(to) - topOf(from), 14) }}
                  onPointerDown={(e) => startDrag(e, "move")} onPointerMove={onDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onClick={(e) => e.stopPropagation()}>
                  <b>{title?.trim() || "Dit event"}</b> <span>{danishClock(from)}–{danishClock(to)}</span><span className="planner-length">{hoursText(to - from)}</span>
                  <div className="planner-resize" title="Træk for at ændre sluttidspunktet" onPointerDown={(e) => startDrag(e, "end")} onPointerMove={onDrag} onPointerUp={endDrag} onPointerCancel={endDrag} />
                </div>}
              </div>
              <ul className="planner-sr">{shown.map((entry, index) => { const r = entryMinutes(entry, plan.date); return r ? <li key={index}>{entry.label}, {danishClock(r.from)} til {danishClock(r.to)}</li> : null; })}</ul>
            </>
          )}
        </div>
      </div>

      {/* Requested: "Du må kunne lave et meget pænere layout til denne side. Det ser rodet ud - især midterdelen". The four times on one row,
          and one line under them instead of a note squeezed under two of them. */}
      <div className="planner-times">
        <label>Starter
          <select value={plan.start} disabled={!plan.date} onChange={(e) => setStart(e.target.value)}>
            {startOptions().map((t) => <option key={t} value={t}>{danishClock(minutesOf(t))}</option>)}
          </select>
        </label>
        <label>Slutter
          <select value={plan.end} disabled={!plan.date} onChange={(e) => setEnd(e.target.value)}>
            {endChoices.map((t) => <option key={t} value={t}>{danishClock(endMinutes(t))}</option>)}
          </select>
        </label>
        <label>Klargøring før
          <select value={plan.setup} disabled={!plan.date} onChange={(e) => setBuffer("setup", Number(e.target.value))}>
            {BUFFER_CHOICES.map((m) => <option key={m} value={m}>{bufferText(m)}</option>)}
          </select>
        </label>
        <label>Oprydning efter
          <select value={plan.cleanup} disabled={!plan.date} onChange={(e) => setBuffer("cleanup", Number(e.target.value))}>
            {BUFFER_CHOICES.map((m) => <option key={m} value={m}>{bufferText(m)}</option>)}
          </select>
        </label>
      </div>
      <p className="planner-summary">{plan.date && chosenOk
        ? <>Salen er din <b>{danishClock(room.from)}–{danishClock(room.to)}</b> med klargøring og oprydning. Lejen regnes for {hoursText(pricedSpan(room.from, room.to).to - pricedSpan(room.from, room.to).from)}.</>
        : "Salen lejes 2–10 timer i halve timer. Klargøring og oprydning lejes med, så næste event ikke står i døren."}</p>
      {plan.date && problem && <p className="planner-problem" role="alert">{PROBLEM_TEXT[problem]}</p>}

      <div className="planner-types" role="radiogroup" aria-label="Lejetype">
        {RENT_TYPES.map((type) => {
          const quote = plan.date ? quoteForPlan(plan, type.id) : null;
          const crosses = Boolean(plan.date) && quote === null && type.id !== "standard" && weekdayOf(plan.date) > 0 && weekdayOf(plan.date) < 6 && chosenOk && room.to - room.from >= MIN_MINUTES;
          const selected = plan.type === type.id;
          return (
            <label key={type.id} className={"planner-type" + (selected ? " on" : "")}>
              <input type="radio" name="rentType" value={type.id} checked={selected} onChange={() => onChange({ ...plan, type: type.id as RentType })} />
              <span className="planner-type-name">{type.name}</span>
              <span className="planner-type-text">{type.text}</span>
              <b className="planner-type-price">{plan.date ? (crosses ? "Ikke hen over 18.30" : priceText(quote)) : "Vælg dato"}</b>
              {selected && quote && <span className="planner-type-lines">{quote.lines.join(" ")}</span>}
            </label>
          );
        })}
      </div>
      <p className="lys-sub">Prisen er for lejen af salen inkl. klargøring og oprydning og er inkl. moms.</p>
    </fieldset>
  );
}
