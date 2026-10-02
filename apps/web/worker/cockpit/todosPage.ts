import { taskKey, type Task, type Todo } from "./data.js";
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
`;

export type TodosData = { who: string; members: string[]; tasks: Task[]; checked: Map<string, number>; todos: Todo[]; notice: string };

const box = (base: string, kind: "opgave" | "punkt", id: string, done: boolean) =>
  `<form method="post" action="${base}/opgaver/afkryds"><input type="hidden" name="kind" value="${kind}"><input type="hidden" name="id" value="${esc(id)}"><input type="hidden" name="done" value="${done ? "0" : "1"}">
<button class="check${done ? " done" : ""}" aria-label="${done ? "Markér som ikke klaret" : "Markér som klaret"}" title="${done ? "Fortryd" : "Klaret"}">${done ? "✓" : ""}</button></form>`;

const dueLabel = (due: string | null | undefined) => due ? ` <span class="pill">${esc(/^\d{4}-\d{2}-\d{2}$/.test(due) ? shortDay(due) : due)}</span>` : "";

function taskItem(base: string, task: Task, done: boolean): string {
  return `<li class="todo${done ? " is-done" : ""}">${box(base, "opgave", taskKey(task), done)}<div class="what">${esc(task.what)}${dueLabel(task.due)}
<div class="small muted">${task.source === "dokument" ? "Fra referatdokumentet" : "Fra referatet"}${task.meeting ? ` ${esc(shortDay(task.meeting))}` : ""}${task.who ? ` · ${esc(task.who)}` : ""}</div></div></li>`;
}

function todoItem(base: string, todo: Todo, who: string): string {
  const done = todo.done_at_ms !== null;
  return `<li class="todo${done ? " is-done" : ""}">${box(base, "punkt", String(todo.id), done)}<div class="what">${esc(todo.text)}${dueLabel(todo.due)}
<div class="small muted">${todo.created_by === who ? "Skrevet af dig" : `Fra ${esc(todo.created_by)}`}</div></div>
<form method="post" action="${base}/opgaver/slet"><input type="hidden" name="id" value="${todo.id}"><button class="x" aria-label="Slet punktet" title="Slet">×</button></form></li>`;
}

export function todosPage(base: string, data: TodosData): string {
  const openTasks = data.tasks.filter(t => !data.checked.has(taskKey(t))), doneTasks = data.tasks.filter(t => data.checked.has(taskKey(t)));
  const openTodos = data.todos.filter(t => t.done_at_ms === null), doneTodos = data.todos.filter(t => t.done_at_ms !== null);
  const open = [...openTodos.map(t => todoItem(base, t, data.who)), ...openTasks.map(t => taskItem(base, t, false))];
  const done = [...doneTodos.map(t => todoItem(base, t, data.who)), ...doneTasks.map(t => taskItem(base, t, true))];
  const others = data.members.filter(m => m !== data.who);
  const add = `<div class="card"><h2>Skriv en opgave</h2><form class="add" method="post" action="${base}/opgaver/ny">
<label>Opgave<input name="text" required maxlength="300" placeholder="Fx ring til udlejer om nøgler"></label>
<label>Frist (valgfri)<input type="date" name="due"></label>
<label>Til<select name="owner"><option value="${esc(data.who)}">Mig selv</option>${others.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join("")}</select></label>
<button>Tilføj</button></form></div>`;
  const list = `<div class="card"><h2>At gøre${open.length ? ` <span class="pill">${open.length}</span>` : ""}</h2>
${open.length ? `<ul class="plain">${open.join("")}</ul>` : `<p class="muted">Intet venter på dig. Godt gået.</p>`}
${done.length ? `<details class="done-list"><summary>Klaret (${done.length})</summary><ul class="plain">${done.join("")}</ul></details>` : ""}</div>`;
  return layout(base, "Opgaver", `<main><h1>Dine opgaver</h1><p class="muted">Opgaver fra referaterne, og dem du eller andre i bestyrelsen skriver til dig. Tryk på firkanten, når en er klaret.</p>
${data.notice ? `<p class="notice">${esc(data.notice)}</p>` : ""}${list}${add}</main>`, { section: "/opgaver", who: data.who, style: TODOS_STYLE });
}
