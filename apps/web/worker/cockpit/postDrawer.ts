/** Requested: "Hvor er den flotte sideknap Stil et forslag?" - "Ja": the tab on the right edge (first made for Beslutninger:
 * "Kan den være en fold-ud bjælke i højre side?") is now the one way in on every page of the admin. It folds out the
 * Opslagstavle's form: Afklaring, Til orientering or Forslag til afstemning (digital or at the meeting, with a deadline). */

export type PostKind = "afklaring" | "orientering" | "afstemning";

export function postDrawer(base: string, options: { kind?: PostKind; open?: boolean } = {}): string {
  const pick = options.kind ?? "afklaring";
  const kind = (value: PostKind, label: string, hint: string) =>
    `<label class="choice"><input type="radio" name="kind" value="${value}"${value === pick ? " checked" : ""}><b>${label}</b><span>${hint}</span></label>`;
  return `<aside class="drawer${options.open ? " open" : ""}" id="nyt" aria-label="Nyt opslag"><button type="button" class="tab" aria-expanded="${options.open ? "true" : "false"}" aria-controls="nyt-panel"><i aria-hidden="true">+</i>Nyt opslag</button>
<div class="panel" id="nyt-panel"><h2>Nyt opslag</h2><p class="lead">Det kommer på Opslagstavlen og på de andres liste.</p><form class="post-form" method="post" action="${base}/opslag">
<fieldset class="kinds">${kind("afklaring", "Afklaring", "Et spørgsmål, de andre svarer på.")}${kind("orientering", "Til orientering", "Noget, de andre skal vide.")}${kind("afstemning", "Forslag til afstemning", "Bestyrelsen stemmer digitalt eller på mødet.")}</fieldset>
<label>Overskrift<input name="title" required maxlength="200" placeholder="Fx Skal vi forlænge den gratis prøveperiode?"></label>
<label>Uddybning (valgfri)<textarea name="text" rows="3" maxlength="4000"></textarea></label>
<label class="check meet-only"><input type="checkbox" name="moede" value="1"> Tag det også med til næste teammøde</label>
<fieldset class="vote-only"><label class="choice"><input type="radio" name="mode" value="digital" checked><b>Digital afstemning</b><span>Vedtaget ved flertal.</span></label>
<label class="choice"><input type="radio" name="mode" value="moede"><b>På næste møde</b><span>Saga sætter det på dagsordenen.</span></label>
<label class="deadline">Frist for afstemningen<select name="days"><option value="3">3 dage</option><option value="7" selected>7 dage</option><option value="14">14 dage</option></select></label></fieldset>
<button class="go">Slå op</button></form></div></aside>
<noscript><style>.drawer:not(.open) .panel{display:block}</style></noscript>${DRAWER_SCRIPT}`;
}

const DRAWER_SCRIPT = `<script>(()=>{const d=document.getElementById("nyt"),b=d&&d.querySelector(".tab");if(!d||!b)return;
const set=o=>{d.classList.toggle("open",o);b.setAttribute("aria-expanded",String(o));if(o)setTimeout(()=>{const f=d.querySelector("input[name=title]");f&&f.focus({preventScroll:true})},60)};
b.addEventListener("click",()=>set(!d.classList.contains("open")));
// Every "#nyt" link opens the tab where you are - "Stil et forslag til afstemning" with that kind chosen.
document.addEventListener("click",e=>{const a=e.target.closest&&e.target.closest('a[href$="#nyt"]');if(!a)return;e.preventDefault();
const k=new URL(a.href).searchParams.get("art"),r=k&&d.querySelector('input[name=kind][value="'+k+'"]');if(r)r.checked=true;set(true)});
document.addEventListener("keydown",e=>{if(e.key==="Escape")set(false)});
if(location.hash==="#nyt")set(true)})()</script>`;

export const DRAWER_STYLE = `
/* Requested: "\\"Opret forslag\\" fylder for meget nu. Kan den være en fold-ud bjælke i højre side?": a tab on the right edge of the page that folds the form out over it. */
.drawer{position:fixed;top:150px;right:0;z-index:40;display:flex;align-items:flex-start;pointer-events:none;max-width:100vw}
.drawer>*{pointer-events:auto}
.drawer .tab{writing-mode:vertical-rl;transform:rotate(180deg);display:inline-flex;align-items:center;gap:8px;margin:0;padding:18px 11px;border:0;border-radius:0 12px 12px 0;background:var(--accent);color:var(--accent-ink);
font:inherit;font-size:13.5px;font-weight:700;letter-spacing:.04em;cursor:pointer;box-shadow:-3px 4px 18px rgb(0 0 0 / .18)}
.drawer .tab:hover{filter:brightness(1.07)}.drawer .tab i{font-style:normal;font-size:17px;line-height:1;transform:rotate(180deg);transition:transform .25s}
.drawer.open .tab i{transform:rotate(225deg)}
.drawer .panel{width:min(380px,calc(100vw - 52px));max-height:calc(100vh - 150px - 24px);overflow:auto;box-sizing:border-box;padding:20px 20px 18px;background:var(--card);color:var(--ink);
border:1px solid color-mix(in srgb,var(--accent) 32%,var(--line));border-right:0;border-radius:16px 0 0 16px;box-shadow:-8px 10px 34px rgb(0 0 0 / .22);
transition:transform .28s ease,opacity .2s;transform-origin:right center}
.drawer:not(.open) .panel{display:none}
.drawer textarea{min-height:64px}.drawer .panel h2{margin:0 0 4px;font-size:18px;color:var(--accent)}.drawer .panel .lead{margin:0 0 14px;font-size:13.5px;color:var(--muted)}
.post-form{display:grid;gap:10px}.post-form label{display:grid;gap:4px}.post-form fieldset{border:0;margin:0;padding:0;display:grid;gap:8px}
.post-form .choice{display:grid;grid-template-columns:auto minmax(0,1fr);gap:2px 10px;align-items:start;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--card);cursor:pointer}
.post-form .choice input{appearance:auto;-webkit-appearance:radio;width:18px;height:18px;min-height:0;padding:0;margin:2px 0 0;border:0;background:none;box-shadow:none;accent-color:var(--accent)}
.post-form .choice b{font-weight:650;color:var(--ink)}.post-form .choice span{grid-column:2;font-size:12.5px;color:var(--muted)}
.post-form .choice:has(input:checked){border-color:var(--accent);background:color-mix(in srgb,var(--accent) 8%,var(--card))}
.post-form .check{display:flex;gap:8px;align-items:center;font-size:14px}.post-form .check input{width:18px;height:18px;min-height:0;margin:0;accent-color:var(--accent)}
.post-form .vote-only{display:none}.post-form:has(input[value=afstemning]:checked) .vote-only{display:grid}.post-form:has(input[value=afstemning]:checked) .meet-only{display:none}
.post-form:has(input[value=moede]:checked) .deadline{display:none}.post-form .go{width:100%}
@media (prefers-reduced-motion:no-preference){.drawer.open .panel{animation:drawer-in .28s ease}@keyframes drawer-in{from{transform:translateX(40px);opacity:0}}}
@media (max-width:620px){.drawer{top:30vh}.drawer.open{top:76px}.drawer .panel{max-height:calc(100vh - 76px - 90px)}}
@media print{.drawer{display:none}}`;
