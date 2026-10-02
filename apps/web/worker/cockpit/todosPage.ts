import { EVERYONE, taskKey, type Task, type Todo } from "./data.js";
import { esc, layout, shortDay } from "./page.js";

/** Requested: "vi skal have en påmindelsesliste / to do-liste, hvor man skal krydse af de opgaver der
 * er tildelt en. Man kan også selv skrive ind." The tasks the minutes give you, your own items and the
 * ones another member wrote to you - each checked off with one press; what is done folds away. */

export const TODOS_STYLE = `
.todo{display:flex;gap:12px;align-items:flex-start}.todo form{margin:0}.todo .what{flex:1;min-width:0}
.check{width:26px;height:26px;min-height:26px;padding:0;border-radius:8px;border:2px solid var(--line);background:transparent;color:var(--ink);flex:none;display:grid;place-items:center;font-size:15px;line-height:1}
.check:hover{border-color:var(--accent-ink);filter:none}.check.done{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.todo.is-done .what{color:var(--muted);text-decoration:line-through}.todo .x{border:0;background:transparent;color:var(--faint);padding:2px 6px;min-height:0;font-size:18px}
.add{display:grid;gap:10px;grid-template-columns:1fr 160px 180px auto;align-items:end}.add label{margin:0}
@media (max-width:760px){.add{grid-template-columns:1fr 1fr}.add label:first-child,.add button{grid-column:1/-1}}
details.done-list summary{cursor:pointer;color:var(--muted);font-weight:600;margin-top:6px}
.who{display:inline-flex;align-items:center;font-size:12.5px;font-weight:650;padding:3px 10px;border-radius:999px;white-space:nowrap;line-height:1.3;
background:color-mix(in srgb,var(--c) 14%,transparent);color:color-mix(in srgb,var(--c) 82%,var(--ink));border:0;min-height:0;cursor:pointer}
.who[aria-pressed=true]{background:var(--c);color:#fff}.who-filter{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 14px}
ul.moves{list-style:none;margin:0;padding:0;display:grid}ul.moves li{display:grid;grid-template-columns:auto 1fr;gap:12px;align-items:baseline;padding:11px 0;border-top:1px solid var(--line)}
ul.moves li:first-child{border-top:0}ul.moves .who{cursor:default}ul.moves .when{font-size:12.5px;color:var(--faint);white-space:nowrap;margin-left:6px}
@media (max-width:760px){ul.moves li{grid-template-columns:1fr;gap:4px}ul.moves .who{justify-self:start}}
`;

export type TodosData = { who: string; members: string[]; tasks: Task[]; checked: Map<string, number>; todos: Todo[]; notice: string;
  /** The chair's questions and tasks from Saga - the same as in Matrix, checked off in either place. */
  saga?: Array<{ key: string; kind: string; text: string; source: string; from?: string | null }>;
  /** Requested ("gennemtænkt"): "Hvem har hvad" moves here from Status - everyone's open tasks from the minutes, newest first. */
  everyone?: Task[] };

const box = (base: string, kind: "opgave" | "punkt" | "saga", id: string, done: boolean) =>
  `<form method="post" action="${base}/opgaver/afkryds"><input type="hidden" name="kind" value="${kind}"><input type="hidden" name="id" value="${esc(id)}"><input type="hidden" name="done" value="${done ? "0" : "1"}">
<button class="check${done ? " done" : ""}" aria-label="${done ? "Markér som ikke klaret" : "Markér som klaret"}" title="${done ? "Fortryd" : "Klaret"}">${done ? "✓" : ""}</button></form>`;

const sentence = (text: string) => text.charAt(0).toLocaleUpperCase("da-DK") + text.slice(1);
/** Requested: "jeg tænker ikke, at vi behøver at bruge ord som drøftelser og beslutning ... hellere nogle skarpe
 * bullet points" - a task is one short line: no label in front, no full stop at the end. */
const sharp = (text: string) => sentence(text.replace(/^\s*(?:drøftelse|beslutning|opgave|aftale)\s*:\s*/i, "").replace(/\s*\.\s*$/, "").trim());
/** Requested: "et farvet felt med navn, så man hurtigt kan se, hvem der har hvilken opgave". Each person keeps one colour. */
const HUES = ["#2446d8", "#7c3aed", "#0e7c86", "#b45309", "#c0265e", "#4b5d73", "#2f7d32"];
const hue = (name: string) => name === EVERYONE ? "#4b5d73" : HUES[[...name.toLocaleLowerCase("da-DK")].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % HUES.length]!;
const chip = (name: string, tag = "span", extra = "") => `<${tag} class="who" style="--c:${hue(name)}"${extra}>${esc(name)}</${tag}>`;
const dueLabel = (due: string | null | undefined) => due ? ` <span class="pill">${esc(/^\d{4}-\d{2}-\d{2}$/.test(due) ? shortDay(due) : due)}</span>` : "";

function taskItem(base: string, task: Task, done: boolean): string {
  return `<li class="todo${done ? " is-done" : ""}">${box(base, "opgave", taskKey(task), done)}<div class="what">${esc(sharp(task.what))}${dueLabel(task.due)}
<div class="small muted">${task.source === "dokument" ? "Fra referatdokumentet" : "Fra referatet"}${task.meeting ? ` ${esc(shortDay(task.meeting))}` : ""}${task.who ? ` · ${esc(task.who)}` : ""}</div></div></li>`;
}

function todoItem(base: string, todo: Todo, who: string): string {
  const done = todo.done_at_ms !== null;
  return `<li class="todo${done ? " is-done" : ""}">${box(base, "punkt", String(todo.id), done)}<div class="what">${esc(sentence(todo.text))}${dueLabel(todo.due)}
<div class="small muted">${todo.owner === EVERYONE ? `Til alle · ${todo.created_by === who ? "skrevet af dig" : `fra ${esc(todo.created_by)}`}` : todo.created_by === who ? "Skrevet af dig" : `Fra ${esc(todo.created_by)}`}</div></div>
<form method="post" action="${base}/opgaver/slet"><input type="hidden" name="id" value="${todo.id}"><button class="x" aria-label="Slet punktet" title="Slet">×</button></form></li>`;
}

export function todosPage(base: string, data: TodosData): string {
  const openTasks = data.tasks.filter(t => !data.checked.has(taskKey(t))), doneTasks = data.tasks.filter(t => data.checked.has(taskKey(t)));
  const openTodos = data.todos.filter(t => t.done_at_ms === null), doneTodos = data.todos.filter(t => t.done_at_ms !== null);
  const SOURCES: Record<string, string> = { telegram: "Fra gruppen", dokument: "Fra referatdokumentet", mail: "Fra team@" };
  const sagaItems = (data.saga ?? []).map(f => `<li class="todo">${box(base, "saga", f.key, false)}<div class="what">${f.kind === "spørgsmål" ? "Svar på: " : ""}${esc(sharp(f.text))}
<div class="small muted">${esc(SOURCES[f.source] ?? "Fra Saga")}${f.from ? ` · ${esc(f.from)}` : ""}</div></div></li>`);
  const open = [...sagaItems, ...openTodos.map(t => todoItem(base, t, data.who)), ...openTasks.map(t => taskItem(base, t, false))];
  const done = [...doneTodos.map(t => todoItem(base, t, data.who)), ...doneTasks.map(t => taskItem(base, t, true))];
  const others = data.members.filter(m => m !== data.who);
  const add = `<div class="card"><h2>Skriv en opgave</h2><form class="add" method="post" action="${base}/opgaver/ny">
<label>Opgave<input name="text" required maxlength="300" placeholder="Fx ring til udlejer om nøgler"></label>
<label>Frist (valgfri)<input type="date" name="due"></label>
<label>Til<select name="owner"><option value="${esc(data.who)}">Mig selv</option><option value="${EVERYONE}">Alle</option>${others.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join("")}</select></label>
<button>Tilføj</button></form></div>`;
  // Requested: "At gøre = Dine to-do's".
  const list = `<div class="card"><h2>Dine to-do's${open.length ? ` <span class="pill">${open.length}</span>` : ""}</h2>
${open.length ? `<ul class="plain">${open.join("")}</ul>` : `<p class="muted">Intet venter på dig. Godt gået.</p>`}
${done.length ? `<details class="done-list"><summary>Klaret (${done.length})</summary><ul class="plain">${done.join("")}</ul></details>` : ""}</div>`;
  const everyone = data.everyone ?? [];
  const people = [...new Set(everyone.map(t => t.who.trim() || EVERYONE))];
  const board = everyone.length ? `<div class="card"><h2>Hvad bevæger sig</h2><p class="small muted" style="margin-top:-8px">Hele bestyrelsens opgaver fra referaterne siden 1. oktober - de nyeste øverst.</p>
${people.length > 1 ? `<div class="who-filter" role="group" aria-label="Vis kun">${people.map(p => chip(p, "button", ` type="button" aria-pressed="false" data-who="${esc(p)}"`)).join("")}</div>` : ""}
<ul class="moves">${everyone.map(t => { const who = t.who.trim() || EVERYONE;
  return `<li data-who="${esc(who)}">${chip(who)}<span>${esc(sharp(t.what))}${t.due ? `<span class="when">· ${esc(/^\d{4}-\d{2}-\d{2}$/.test(t.due) ? shortDay(t.due) : t.due)}</span>` : ""}</span></li>`; }).join("")}</ul></div>
<script>document.querySelectorAll(".who-filter .who").forEach(b=>b.onclick=()=>{const on=b.getAttribute("aria-pressed")!=="true";document.querySelectorAll(".who-filter .who").forEach(x=>x.setAttribute("aria-pressed","false"));
b.setAttribute("aria-pressed",String(on));document.querySelectorAll("ul.moves li").forEach(li=>{li.hidden=on&&li.dataset.who!==b.dataset.who})})</script>` : "";
  return layout(base, "Opgaver", `<main><h1>Dine opgaver</h1><p class="muted">Opgaver fra referaterne, og dem du eller andre i bestyrelsen skriver til dig - de nyeste øverst. Tryk på firkanten, når en er klaret.</p>
${data.notice ? `<p class="notice">${esc(data.notice)}</p>` : ""}${list}${add}${board}</main>`, { section: "/opgaver", who: data.who, style: TODOS_STYLE });
}
