import { agreedLabel, EVERYONE, imperative, mergeSame, sagaSource, taskKey, uniqueTasks, type Task, type Todo } from "./data.js";
import { esc, layout, shortDay } from "./page.js";
import { voteTodo, type Proposal } from "./votes.js";

/** Requested: "vi skal have en påmindelsesliste / to do-liste, hvor man skal krydse af de opgaver der
 * er tildelt en. Man kan også selv skrive ind." The tasks the minutes give you, your own items and the
 * ones another member wrote to you - each checked off with one press; what is done folds away. */

export const TODOS_STYLE = `
.todo{display:flex;gap:12px;align-items:flex-start}.todo form{margin:0}.todo .what{flex:1;min-width:0}
.check{width:26px;height:26px;min-height:26px;padding:0;border-radius:8px;border:2px solid var(--line);background:transparent;color:var(--ink);flex:none;display:grid;place-items:center;font-size:15px;line-height:1}
.check:hover{border-color:var(--accent-ink);filter:none}.check.done{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
ul.plain .ctx{display:block;font-size:12.5px;color:var(--faint);margin-top:2px}
.todo.is-done .what{color:var(--muted);text-decoration:line-through}.todo .x{border:0;background:transparent;color:var(--faint);padding:2px 6px;min-height:0;font-size:18px}
.add{display:grid;gap:10px;grid-template-columns:1fr 160px 180px auto;align-items:end}.add label{margin:0}
@media (max-width:760px){.add{grid-template-columns:1fr 1fr}.add label:first-child,.add button{grid-column:1/-1}}
details.done-list summary{cursor:pointer;color:var(--muted);font-weight:600;margin-top:6px}.done-note{margin:14px 0 0}
.who{display:inline-flex;align-items:center;font-size:12.5px;font-weight:650;padding:3px 10px;border-radius:999px;white-space:nowrap;line-height:1.3;
background:color-mix(in srgb,var(--c) 14%,transparent);color:color-mix(in srgb,var(--c) 82%,var(--ink));border:0;min-height:0;cursor:pointer}
.who[aria-pressed=true]{background:var(--c);color:#fff}.who-filter{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 14px}
ul.moves{list-style:none;margin:0;padding:0;display:grid}ul.moves li{display:grid;grid-template-columns:auto 1fr;gap:12px;align-items:baseline;padding:11px 0;border-top:1px solid var(--line)}
ul.moves li:first-child{border-top:0}ul.moves li.is-done>span:last-child{color:var(--muted)}ul.moves .tick{color:var(--accent);font-weight:800}ul.moves .who{cursor:default}ul.moves .when{font-size:12.5px;color:var(--faint);white-space:nowrap;margin-left:6px}
@media (max-width:760px){ul.moves li{grid-template-columns:1fr;gap:4px}ul.moves .who{justify-self:start}}
`;

export type TodosData = { who: string; members: string[]; tasks: Task[]; checked: Map<string, number>; todos: Todo[]; notice: string;
  /** Tasks this member removed from their own list (data.ts removeTaskFor). */
  removed?: Set<string>;
  /** The chair's questions and tasks from Saga - the same as in Matrix, checked off in either place. */
  saga?: Array<{ key: string; kind: string; text: string; source: string; from?: string | null }>;
  /** Requested ("gennemtænkt"): "Hvem har hvad" moves here from Status - everyone's open tasks from the minutes, newest first. */
  everyone?: Task[];
  /** Who checked each task off, and when: shown with a check and the date for seven days, then archived. */
  boardChecks?: Map<string, { by: string; at: number }>; now?: number;
  /** Requested: "Når et forslag er stillet, skal hvert bestyrelsesmedlem have punktet på sin to do." Gone once voted. */
  votes?: Proposal[] };

type Kind = "opgave" | "punkt" | "saga";
/** The same task's other lines (kind:id), checked or removed with the one shown. */
const alsoField = (also: string[]) => also.length ? `<input type="hidden" name="also" value="${esc(also.join("\n"))}">` : "";
/** Where the page goes after a press: Opgaver, or - from the front page - back to "Dine opgaver" there. */
export type Back = "forside" | undefined;
const backField = (back: Back) => back ? `<input type="hidden" name="back" value="${back}">` : "";
const box = (base: string, kind: Kind, id: string, done: boolean, also: string[] = [], back?: Back) =>
  `<form method="post" action="${base}/opgaver/afkryds"><input type="hidden" name="kind" value="${kind}"><input type="hidden" name="id" value="${esc(id)}"><input type="hidden" name="done" value="${done ? "0" : "1"}">${alsoField(also)}${backField(back)}
<button class="check${done ? " done" : ""}" aria-label="${done ? "Markér som ikke klaret" : "Markér som klaret"}" title="${done ? "Fortryd" : "Klaret"}">${done ? "✓" : ""}</button></form>`;

const sentence = (text: string) => text.charAt(0).toLocaleUpperCase("da-DK") + text.slice(1);
/** Requested: "jeg tænker ikke, at vi behøver at bruge ord som drøftelser og beslutning ... hellere nogle skarpe
 * bullet points" - a task is one short line: no label in front, no full stop at the end. */
const sharp = (text: string) => sentence(imperative(text.replace(/^\s*(?:drøftelse|beslutning|opgave|aftale)\s*:\s*/i, "").replace(/\s*\.\s*$/, "").trim()));
/** Requested: "et farvet felt med navn, så man hurtigt kan se, hvem der har hvilken opgave". Each person keeps one colour. */
// Requested: "jeg synes ikke, at det giver mening med rød farve. Dog må hver af os gerne have forskellige farver, bare
// ikke rød." No red or pink; each board member gets the next colour in the member list, so no two share one.
// Hjerterum Lys: the same eight distinct colours, warmed and softened to sit beside the shared palette - still no red or pink.
const HUES = ["#3f6a80", "#2f6f66", "#6a5a8c", "#4f6f3a", "#9a6a1f", "#5b4a3f", "#4d5f8f", "#7a6a3a"];
const SHARED = "#6b625a";
let palette = new Map<string, string>();
const first = (name: string) => name.trim().split(/\s+/)[0]!.toLocaleLowerCase("da-DK");
function setPalette(members: string[]): void {
  palette = new Map([...members].sort((a, b) => a.localeCompare(b, "da")).map((m, i) => [first(m), HUES[i % HUES.length]!]));
}
const hue = (name: string) => name === EVERYONE || /,|\bog\b/.test(name) ? SHARED
  : palette.get(first(name)) ?? HUES[[...first(name)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % HUES.length]!;
const chip = (name: string, tag = "span", extra = "") => `<${tag} class="who" style="--c:${hue(name)}"${extra}>${esc(name)}</${tag}>`;
const dueLabel = (due: string | null | undefined) => due ? ` <span class="pill">${esc(/^\d{4}-\d{2}-\d{2}$/.test(due) ? shortDay(due) : due)}</span>` : "";

/** Requested: "I can't delete them." Every line on your own list can be removed - your own items are deleted; a task
 * from the minutes or from Saga leaves your list (the minutes themselves are not changed). */
const removeButton = (base: string, kind: Kind, id: string, also: string[], back?: Back) =>
  `<form method="post" action="${base}/opgaver/fjern"><input type="hidden" name="kind" value="${kind}"><input type="hidden" name="id" value="${esc(id)}">${alsoField(also)}${backField(back)}<button class="x" aria-label="Fjern fra din liste" title="Fjern fra din liste">×</button></form>`;
function taskItem(base: string, task: Task, done: boolean, also: string[] = [], back?: Back): string {
  return `<li class="todo${done ? " is-done" : ""}">${box(base, "opgave", taskKey(task), done, also, back)}<div class="what">${esc(sharp(task.what))}${dueLabel(task.due)}
<div class="small muted">${esc(agreedLabel(task.meeting))}${task.who ? ` · ${esc(task.who)}` : ""}</div></div>${done ? "" : removeButton(base, "opgave", taskKey(task), also, back)}</li>`;
}

function todoItem(base: string, todo: Todo, who: string, also: string[] = [], back?: Back): string {
  const done = todo.done_at_ms !== null;
  return `<li class="todo${done ? " is-done" : ""}">${box(base, "punkt", String(todo.id), done, also, back)}<div class="what">${esc(sentence(todo.text))}${dueLabel(todo.due)}
<div class="small muted">${todo.owner === EVERYONE ? `Til alle · ${todo.created_by === who ? "skrevet af dig" : `fra ${esc(todo.created_by)}`}` : todo.created_by === who ? "Skrevet af dig" : `Fra ${esc(todo.created_by)}`}</div></div>
${removeButton(base, "punkt", String(todo.id), also, back)}</li>`;
}

type SagaItem = { key: string; kind: string; text: string; source: string; since?: string; from?: string | null };

/** The open lines of "Dine opgaver", the same on Opgaver and on the front page ("Gør det også muligt at sætte et flueben ved ens opgaver fra forsiden ...
 * Altså helt samme styling som på opgavesiden"): the tasks from the minutes (the approved minutes' wording first, then the minutes document's), what Saga
 * has for this member, and the member's own items. The same task from several places is one line - checking or removing it takes all of them. */
export function openLines(base: string, d: { who: string; tasks: Task[]; todos: Todo[]; saga: SagaItem[]; back?: Back }): string[] {
  type Line = { kind: Kind; id: string; text: string; render: (also: string[]) => string };
  const sagaLine = (f: SagaItem): Line => ({ kind: "saga", id: f.key, text: f.text, render: also => `<li class="todo">${box(base, "saga", f.key, false, also, d.back)}<div class="what">${f.kind === "spørgsmål" ? "Svar på: " : ""}${esc(sharp(f.text))}
<div class="small muted">${esc(sagaSource(f, "Fra Saga"))}</div></div>${removeButton(base, "saga", f.key, also, d.back)}</li>` });
  const lines: Line[] = [
    ...d.tasks.filter(t => t.source !== "dokument").map((t): Line => ({ kind: "opgave", id: taskKey(t), text: t.what, render: also => taskItem(base, t, false, also, d.back) })),
    ...d.tasks.filter(t => t.source === "dokument").map((t): Line => ({ kind: "opgave", id: taskKey(t), text: t.what, render: also => taskItem(base, t, false, also, d.back) })),
    ...d.saga.map(sagaLine),
    ...d.todos.map((t): Line => ({ kind: "punkt", id: String(t.id), text: t.text, render: also => todoItem(base, t, d.who, also, d.back) })),
  ];
  return mergeSame(lines, l => l.text).map(({ item, twins }) => item.render(twins.map(t => `${t.kind}:${t.id}`)));
}

const SEVEN_DAYS = 7 * 86_400_000;

export function todosPage(base: string, data: TodosData): string {
  setPalette(data.members);
  const removed = data.removed ?? new Set<string>(), nowMs = data.now ?? Date.now();
  // Requested: "checked to-dos will get archived from the list after 7 days that they have been checked".
  const recent = (at: number | null | undefined) => at !== null && at !== undefined && nowMs - at <= SEVEN_DAYS;
  const openTasks = data.tasks.filter(t => !data.checked.has(taskKey(t)) && !removed.has(taskKey(t)));
  const doneTasks = data.tasks.filter(t => data.checked.has(taskKey(t)) && !removed.has(taskKey(t)) && recent(data.checked.get(taskKey(t))));
  const openTodos = data.todos.filter(t => t.done_at_ms === null), doneTodos = data.todos.filter(t => t.done_at_ms !== null && recent(t.done_at_ms));
  const merged = openLines(base, { who: data.who, tasks: openTasks, todos: openTodos, saga: data.saga ?? [] });
  const open = [...(data.votes ?? []).map(p => voteTodo(base, p)), ...merged];
  const done = [...doneTodos.map(t => todoItem(base, t, data.who)), ...doneTasks.map(t => taskItem(base, t, true))];
  const others = data.members.filter(m => m !== data.who);
  const add = `<div class="card"><h2>Skriv en opgave</h2><form class="add" method="post" action="${base}/opgaver/ny">
<label>Opgave<input name="text" required maxlength="300" placeholder="Fx ring til udlejer om nøgler"></label>
<label>Frist (valgfri)<input type="date" name="due"></label>
<label>Til<select name="owner"><option value="${esc(data.who)}">Mig selv</option><option value="${EVERYONE}">Alle</option>${others.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join("")}</select></label>
<button>Tilføj</button></form>
<p class="small" style="margin:12px 0 0"><a href="${base}/beslutninger#nyt">Stil et forslag til afstemning i bestyrelsen →</a></p></div>`;
  // Requested: "At gøre = Dine to-do's".
  const list = `<div class="card"><h2>Dine to-do's${open.length ? ` <span class="pill">${open.length}</span>` : ""}</h2>
${open.length ? `<ul class="plain">${open.join("")}</ul>` : `<p class="muted">Intet venter på dig. Godt gået.</p>`}
${done.length ? `<details class="done-list" open><summary>Klaret de sidste 7 dage (${done.length})</summary><ul class="plain">${done.join("")}</ul></details>` : ""}
<p class="small muted done-note">Opgaver, der er klaret, forsvinder automatisk efter syv dage.</p></div>`;
  const everyone = uniqueTasks(data.everyone ?? []), checks = data.boardChecks ?? new Map(), now = data.now ?? Date.now();
  const checkOf = (t: Task) => checks.get(taskKey(t));
  // Requested: "Afkrydsede to-dos bør være i bunden" - what is checked off stands under what is still open, in the order it came.
  const current = everyone.filter(t => { const c = checkOf(t); return !c || now - c.at <= SEVEN_DAYS; });
  current.sort((a, b) => Number(Boolean(checkOf(a))) - Number(Boolean(checkOf(b))));
  const archived = everyone.filter(t => { const c = checkOf(t); return c && now - c.at > SEVEN_DAYS; });
  const DONE_DAY = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short", timeZone: "Europe/Copenhagen" });
  const move = (t: Task) => { const who = t.who.trim() || EVERYONE, c = checkOf(t);
    return `<li data-who="${esc(who)}"${c ? ' class="is-done"' : ""}>${chip(who)}<span>${c ? '<span class="tick" aria-label="Klaret">✓</span> ' : ""}${esc(sharp(t.what))}${t.due && !c ? `<span class="when">· ${esc(/^\d{4}-\d{2}-\d{2}$/.test(t.due) ? shortDay(t.due) : t.due)}</span>` : ""}${c ? `<span class="when">· klaret ${esc(DONE_DAY.format(c.at))}${c.by && c.by !== who ? ` af ${esc(c.by.split(/\s+/)[0]!)}` : ""}</span>` : ""}</span></li>`; };
  const people = [...new Set(everyone.map(t => t.who.trim() || EVERYONE))];
  const board = everyone.length ? `<div class="card"><h2>Hvad bevæger sig</h2><p class="small muted" style="margin-top:-8px">Hele bestyrelsens opgaver fra referaterne den seneste måned - de nyeste øverst.</p>
${people.length > 1 ? `<div class="who-filter" role="group" aria-label="Vis kun">${people.map(p => chip(p, "button", ` type="button" aria-pressed="false" data-who="${esc(p)}"`)).join("")}</div>` : ""}
<ul class="moves">${current.map(t => move(t)).join("")}</ul>
${archived.length ? `<details class="done-list"><summary>Arkiv (${archived.length})</summary><ul class="moves">${archived.map(t => move(t)).join("")}</ul></details>` : ""}</div>
<script>document.querySelectorAll(".who-filter .who").forEach(b=>b.onclick=()=>{const on=b.getAttribute("aria-pressed")!=="true";document.querySelectorAll(".who-filter .who").forEach(x=>x.setAttribute("aria-pressed","false"));
b.setAttribute("aria-pressed",String(on));document.querySelectorAll("ul.moves li").forEach(li=>{li.hidden=on&&li.dataset.who!==b.dataset.who})})</script>` : "";
  return layout(base, "Opgaver", `<main><h1>Dine opgaver</h1><p class="muted">Opgaver fra referaterne, og dem du eller andre i bestyrelsen skriver til dig - de nyeste øverst. Tryk på firkanten, når en er klaret.</p>
${data.notice ? `<p class="notice">${esc(data.notice)}</p>` : ""}${list}${add}${board}</main>`, { section: "/opgaver", who: data.who, style: TODOS_STYLE });
}
