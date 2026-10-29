/** Hjerterum Lys - the one design for the website, the member area and the board's cockpit.
 * Requested: "Der bør ikke være nogen forskel. Det bør være den samme styling og det samme design ... toppen på
 * hjemmesiden er rigtig fin. Samtidig kan jeg godt lide det moderne indhold, der er på admin ... meget let og lyst",
 * then "Prøv at slette Aarhus fra headeren, så der bare står HJERTERUM" and "noget geometri der bevæger sig i hero" -
 * "Lad os bruge det design", and "Fint at holde fast i layout som dette" with hjerterum.info's own page as the reference:
 * the editorial intro (a kicker, a serif headline with an italic line in terracotta, the text beside it) and cards of
 * kicker, serif title and short text (2026-10-03, docs/DESIGN_SYSTEM.md).
 *
 * This file is the single source: the React pages inject LYS_CSS, and the cockpit puts it in every page. Each side
 * maps its own older variable names onto the --lys-* tokens, so the two can no longer drift apart. */

// Lato and Playfair's italic 500 as in the monthly newsletter (lys-spa.css, the public site).
export const LYS_FONTS_URL = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Lato:ital,wght@0,400;0,700;0,900;1,400&family=Playfair+Display:ital,wght@0,400;0,500;1,400;1,500&display=swap";

const TOKENS = `
:root{--lys-bg:#fbfaf8;--lys-surface:#fff;--lys-soft:#f6f3ef;--lys-line:#ebe5dd;--lys-ink:#2a2622;--lys-muted:#766d64;--lys-faint:#a0978d;
--lys-accent:#5b4a3f;--lys-accent-ink:#fffaf4;--lys-sage:#e8eee2;--lys-sage-ink:#4c5e43;--lys-clay:#f5e9df;--lys-clay-ink:#8a5636;
--lys-rose:#f6e8ea;--lys-rose-ink:#8c4b57;--lys-terra:#94503f;--lys-radius:20px;--lys-shadow:0 1px 2px rgba(42,38,34,.04),0 8px 24px -18px rgba(42,38,34,.18);
--lys-serif:"Playfair Display",Georgia,"Times New Roman",serif;--lys-sans:"Inter",system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;
--lys-blob-1:#e9efe1;--lys-blob-2:#f6e9de;--lys-blob-3:#f7e8eb;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--lys-bg:#1f1d1a;--lys-surface:#282521;--lys-soft:#2f2b27;--lys-line:#3a352f;--lys-ink:#f3eee6;--lys-muted:#bdb4a9;
--lys-faint:#8e857b;--lys-accent:#e6cdb8;--lys-accent-ink:#2a211b;--lys-sage:#33402e;--lys-sage-ink:#d6e2cc;--lys-clay:#45372c;--lys-clay-ink:#f0d6c2;
--lys-rose:#45333a;--lys-rose-ink:#f2d3da;--lys-terra:#e3a58f;--lys-shadow:none;--lys-blob-1:#3b4634;--lys-blob-2:#4a3b30;--lys-blob-3:#4a3840}}`;

/** The top that every page shares: Hjerterum's hands and HJERTERUM, calm links, a pill or the member on the right. */
const TOP = `
.lys-bar{position:sticky;top:0;z-index:30;background:var(--lys-bg)}.lys-bar::before{content:"";position:absolute;left:0;right:0;bottom:100%;height:100vh;background:var(--lys-bg);pointer-events:none}
.lys-top{max-width:1220px;margin:0 auto;padding:16px 28px;display:flex;align-items:center;gap:24px;border-bottom:1px solid var(--lys-line)}
.lys-logo{display:flex;align-items:center;gap:13px;text-decoration:none;color:var(--lys-ink);flex:none}
.lys-logo img{width:44px;height:44px;display:block;filter:brightness(0);opacity:.82}
.lys-logo b{font:400 20px/1 var(--lys-serif);letter-spacing:.22em;text-transform:uppercase;padding-top:2px}
.lys-nav{display:flex;align-items:center;gap:2px;margin-left:auto;flex-wrap:wrap;justify-content:flex-end}
.lys-nav>a,.lys-nav summary{padding:8px 13px;border-radius:999px;text-decoration:none;font:500 14.5px/1.2 var(--lys-sans);color:var(--lys-ink);cursor:pointer}
.lys-nav>a:hover,.lys-nav summary:hover{background:var(--lys-soft)}
.lys-nav>a[aria-current=page],.lys-nav>a.on{background:var(--lys-surface);box-shadow:inset 0 0 0 1px var(--lys-line)}
.lys-pill{white-space:nowrap;padding:9px 18px;border-radius:999px;background:var(--lys-accent);color:var(--lys-accent-ink);font:600 14.5px/1.2 var(--lys-sans);text-decoration:none}
.lys-pill:hover{filter:brightness(1.08)}
.lys-me{display:flex;align-items:center;gap:10px;flex:none}
@media (prefers-color-scheme:dark){.lys-logo img{filter:brightness(0) invert(1);opacity:.9}}
@media (max-width:760px){.lys-top{padding:12px 18px;gap:10px;flex-wrap:wrap}.lys-logo img{width:38px;height:38px}.lys-logo b{font-size:16px;letter-spacing:.18em}
.lys-nav{order:3;width:100%;margin-left:0;justify-content:flex-start;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;padding-bottom:2px}.lys-nav::-webkit-scrollbar{display:none}
.lys-nav>a{white-space:nowrap}.lys-me{margin-left:auto}}`;

/** The modern content blocks: kicker and serif title, figure tiles, cards with lists, and small tags. */
const BLOCKS = `
.lys-page{max-width:1220px;margin:0 auto;padding:44px 28px 80px;display:grid;gap:22px;font-family:var(--lys-sans);color:var(--lys-ink)}
.lys-kicker{font:600 11.5px/1.2 var(--lys-sans);letter-spacing:.2em;text-transform:uppercase;color:var(--lys-terra);margin:0}
.lys-title{font:400 clamp(40px,5vw,64px)/1.05 var(--lys-serif);letter-spacing:-.02em;margin:12px 0 8px}
.lys-title em{display:block;font-style:italic;color:var(--lys-terra)}
.lys-intro{display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:start}.lys-intro>p{margin:30px 0 0;color:var(--lys-muted);font-size:18px;line-height:1.7}
.lys-lead{color:var(--lys-muted);font-size:17px;margin:0;max-width:640px}
.lys-titlerow{display:flex;justify-content:space-between;align-items:end;gap:20px}
.lys-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px}
.lys-tile{background:var(--lys-surface);border-radius:18px;padding:18px 20px;box-shadow:var(--lys-shadow);border:1px solid var(--lys-line);min-width:0}
.lys-tile>span{display:block;font-size:12.5px;color:var(--lys-muted);font-weight:500}.lys-tile>b{display:block;font:600 28px/1.15 var(--lys-sans);letter-spacing:-.02em;margin:6px 0 2px;overflow-wrap:anywhere}
.lys-tile>small{color:var(--lys-faint);font-size:12.5px}.lys-tile a{color:var(--lys-accent);font-weight:600;font-size:12.5px;text-decoration:none}
.lys-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:18px;align-items:start}
.lys-card{background:var(--lys-surface);border-radius:var(--lys-radius);padding:24px 26px;border:1px solid var(--lys-line);box-shadow:var(--lys-shadow);min-width:0}
.lys-card h2{font:400 27px/1.2 var(--lys-serif);letter-spacing:-.01em;margin:0 0 6px}.lys-card .lys-kicker{margin-bottom:14px}
.lys-card.sage{background:var(--lys-sage);border-color:transparent}.lys-card.clay{background:var(--lys-clay);border-color:transparent}.lys-sub{color:var(--lys-muted);font-size:13.5px;margin:0 0 14px}
.lys-list{list-style:none;margin:0;padding:0}.lys-list li{display:flex;justify-content:space-between;gap:14px;align-items:center;padding:12px 0;border-top:1px solid var(--lys-line)}
.lys-list li:first-child{border-top:0;padding-top:4px}.lys-list .lys-meta{display:block;font-size:13px;color:var(--lys-muted)}
.lys-chip{display:inline-block;font:600 11.5px/1 var(--lys-sans);padding:6px 10px;border-radius:999px;white-space:nowrap;background:var(--lys-soft);color:var(--lys-muted)}
.lys-chip.sage{background:var(--lys-sage);color:var(--lys-sage-ink)}.lys-chip.clay{background:var(--lys-clay);color:var(--lys-clay-ink)}.lys-chip.rose{background:var(--lys-rose);color:var(--lys-rose-ink)}
.lys-card.sage .lys-chip.sage,.lys-card.clay .lys-chip.clay{background:var(--lys-surface)}
.lys-btn{display:inline-flex;align-items:center;gap:6px;padding:11px 20px;border-radius:999px;background:var(--lys-accent);color:var(--lys-accent-ink);font:600 14.5px/1.2 var(--lys-sans);text-decoration:none;border:0;cursor:pointer}
.lys-btn.ghost{background:transparent;color:var(--lys-ink);box-shadow:inset 0 0 0 1.5px var(--lys-line)}
.lys-link{font-weight:600;font-size:14px;text-decoration:none;color:var(--lys-accent)}
@media (max-width:760px){.lys-page{padding:28px 18px 64px}.lys-intro{grid-template-columns:1fr;gap:8px}.lys-intro>p{margin-top:8px}.lys-tiles{grid-template-columns:1fr 1fr}.lys-tile>b{font-size:22px}}`;

/** Geometry: three circles in Hjerterum's colours that meet - circles that overlap. Requested: "Kan du fjerne prikkerne i
 * animationen" - no dots on the rings - and later "Fjern animationen": nothing moves, in the art or when a page appears. */
const ART = `
.lys-art{width:100%;max-width:500px;aspect-ratio:1;display:block;margin-left:auto;overflow:visible}
.lys-art .blob{mix-blend-mode:multiply;opacity:.92}.lys-art .ring{fill:none;stroke:var(--lys-ink)}
.lys-art .r1{stroke-opacity:.12}.lys-art .r2{stroke-opacity:.08}
.lys-art.mini{width:150px;height:150px;flex:none;margin:-20px 0 -10px}
@media (prefers-color-scheme:dark){.lys-art .blob{mix-blend-mode:screen;opacity:.75}}
@media (max-width:760px){.lys-art{max-width:340px;margin:0 auto}.lys-art.mini{display:none}}`;

export const LYS_CSS = TOKENS + TOP + BLOCKS + ART;

/** The geometry as inline SVG (a constant: nothing from outside goes into it). */
export function lysArt(size: "hero" | "mini" = "hero"): string {
  return `<svg class="lys-art${size === "mini" ? " mini" : ""}" viewBox="0 0 500 500" aria-hidden="true" focusable="false">
<circle class="blob" cx="205" cy="215" r="150" fill="var(--lys-blob-1)"/><circle class="blob" cx="300" cy="225" r="140" fill="var(--lys-blob-2)"/><circle class="blob" cx="250" cy="300" r="132" fill="var(--lys-blob-3)"/>
<circle class="ring r1" cx="250" cy="250" r="214"/><circle class="ring r2" cx="250" cy="250" r="238"/></svg>`;
}
