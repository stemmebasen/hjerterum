import { esc, layout } from "./page.js";
import { clock, dateOf, dayName } from "../social/plan.js";
import type { SocialPost } from "../social/social.js";
import { templateName, templatesFor, VIDEO_TEMPLATES } from "../social/videoTemplates.js";

/** Requested (the chair, 5 Nov 2026): "Det skal fungere sådan at jeg kan klikke på sagas link i telegram og på et øjeblik godkende" - the page behind
 * Saga's link (social/quickLink.ts): the post as it goes out, one big button, another template for the video, and on to the next proposal. */

export const QUICK_HEADERS = {
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; media-src https:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  // The link is the key: it is never sent on to another site.
  "referrer-policy": "no-referrer",
};

const when = (ms: number | null | undefined) => {
  if (!ms) return "uden tidspunkt";
  const [, month, day] = dateOf(ms).split("-");
  return `${dayName(ms)} ${Number(day)}/${Number(month)} kl. ${clock(ms)}`;
};

export const quickTitle = (p: SocialPost) => p.kind === "week" ? `Ugens events${p.week ? `, uge ${Number(p.week.slice(6))}` : ""}` : p.source.title ?? "Opslag";

const NOTICES: Record<string, string> = {
  godkendt: "Godkendt ✓", publiceret: "Godkendt ✓ og publiceret nu.", sprunget: "Sprunget over. Opslaget sendes ikke.", fortrudt: "Godkendelsen er fortrudt. Opslaget er et forslag igen.",
  skabelon: "Videoen laves om i den nye skabelon. Saga skriver til dig, når den er klar (højst en halv time).",
};
const ERRORS: Record<string, string> = {
  sent: "Opslaget er allerede ude og kan ikke ændres.", kanaler: "Opslaget har ingen kanal. Åbn det i admin, og vælg Facebook eller Instagram.",
  tid: "Der er for kort tid til eventet til at lave videoen om. Godkend den, der er, eller vælg billedet i admin.", skabelon: "Den skabelon kan ikke bruges til dette opslag.",
  fejl: "Det lykkedes ikke. Prøv igen, eller åbn opslaget i admin.",
};

export type QuickView = { post: SocialPost; action: string; notice?: string | undefined; error?: string | undefined; next: string | null; adminHref: string; base: string; canRemake: boolean };

export function quickPage(v: QuickView): string {
  const { post: p } = v;
  const video = p.source.video && !p.source.noVideo && p.channels.includes("instagram") ? p.source.video : null;
  const picture = p.images[0] ?? null;
  const ig = p.channels.includes("instagram"), fb = p.channels.includes("facebook");
  const igAt = p.source.instagramAtMs ?? p.publish_at_ms;
  const times = [fb ? `Facebook ${when(p.publish_at_ms)}` : "", ig ? `Instagram ${when(igAt)}${video ? " (video)" : ""}` : ""].filter(Boolean).join(" · ") || "Ingen kanal valgt";
  const status = p.status === "approved" ? `<p class="q-state ok">Godkendt${p.approved_by ? ` af ${esc(p.approved_by)}` : ""}. Saga sender det på tidspunktet.</p>`
    : p.status === "published" ? `<p class="q-state ok">Publiceret.</p>` : p.status === "publishing" ? `<p class="q-state">Sendes nu.</p>`
    : p.status === "skipped" ? `<p class="q-state">Sprunget over.</p>` : p.status === "failed" ? `<p class="q-state bad">Fejlede: ${esc(p.error ?? "")}</p>` : "";
  const open = ["draft", "failed", "skipped"].includes(p.status);
  const button = (handling: string, label: string, cls = "") => `<form method="post" action="${esc(v.action)}"><input type="hidden" name="handling" value="${handling}"><button class="${cls}">${label}</button></form>`;
  const offered = p.kind === "event" ? templatesFor(p) : [];
  const remake = v.canRemake && offered.length > 1 && p.status !== "published" && p.status !== "publishing"
    ? `<form method="post" action="${esc(v.action)}" class="q-remake"><input type="hidden" name="handling" value="skabelon"><label>Lav videoen i en anden skabelon
<select name="skabelon">${VIDEO_TEMPLATES.filter(t => offered.includes(t.no)).map(t => `<option value="${t.no}"${t.no === p.source.videoTemplate ? " selected" : ""}>${t.no}. ${esc(t.name)}</option>`).join("")}</select></label><button class="ghost">Lav om</button></form>` : "";
  const texts = `${fb || !ig ? `<details${video ? "" : " open"}><summary>Teksten på Facebook</summary><p class="q-text">${esc(p.text)}</p></details>` : ""}
${ig ? `<details${video ? " open" : ""}><summary>Teksten på Instagram</summary><p class="q-text">${esc(p.source.instagramText || p.text)}</p></details>` : ""}`;
  const body = `<main class="q"><div class="q-head"><img src="${v.base}/logo.png" alt="Hjerterum" width="40" height="40"><span>Saga · godkend opslag</span></div>
${v.notice ? `<p class="notice good">${esc(NOTICES[v.notice] ?? "")}${v.next && ["godkendt", "publiceret", "sprunget"].includes(v.notice) ? ` <a href="${esc(v.next)}"><b>Næste forslag →</b></a>` : ""}</p>` : ""}${v.error ? `<p class="notice warn">${esc(ERRORS[v.error] ?? ERRORS.fejl!)}</p>` : ""}
<h1>${esc(quickTitle(p))}</h1>
${p.kind === "event" && p.source.startsMs ? `<p class="muted">Eventet: ${esc(when(p.source.startsMs))}${p.source.host ? ` · ${esc(p.source.host)}` : ""}</p>` : ""}
<p class="q-times">${esc(times)}</p>
${status}
${open ? `<div class="q-go">${button("godkend", p.status === "failed" ? "Godkend og prøv igen" : "Godkend")}</div>` : p.status === "approved" ? `<div class="q-go">${button("fortryd", "Fortryd godkendelsen", "ghost")}</div>` : ""}
${video ? `<video class="q-media" src="${esc(video)}" controls muted playsinline autoplay loop preload="auto"${picture ? ` poster="${esc(picture)}"` : ""}></video>
${p.source.videoTemplate ? `<p class="small muted">Skabelon ${p.source.videoTemplate}: ${esc(templateName(p.source.videoTemplate) ?? "")}</p>` : ""}`
    : picture ? `<img class="q-media pic" src="${esc(picture)}" alt="">` : p.kind === "event" && ig ? `<p class="small muted">Videoen er ikke lavet endnu.</p>` : ""}
${texts}
${remake}
<div class="q-more">${p.status === "draft" ? button("spring", "Spring over", "ghost") : ""}<a class="button ghost" href="${esc(v.adminHref)}">Ret tekst og tid i admin</a></div>
${v.next ? `<p class="q-next"><a class="button" href="${esc(v.next)}">Næste forslag →</a></p>` : `<p class="small muted q-next">Der er ikke flere forslag, der venter.</p>`}
</main>`;
  return layout(v.base, `Godkend: ${quickTitle(p)}`, body, { style: QUICK_STYLE });
}

export function quickGonePage(base: string): string {
  return layout(base, "Linket er udløbet", `<main class="q"><div class="q-head"><img src="${base}/logo.png" alt="Hjerterum" width="40" height="40"><span>Saga · godkend opslag</span></div>
<p class="notice warn">Linket er udløbet eller passer ikke. Opslagene ligger i admin under PR og SoMe.</p><p><a class="button" href="${base}/pr/kalender">Til PR-kalenderen</a></p></main>`, { style: QUICK_STYLE });
}

const QUICK_STYLE = `.q{max-width:520px;margin:0 auto;padding:16px 16px 40px}.q-head{display:flex;align-items:center;gap:10px;color:var(--muted);font-size:14px;margin:0 0 12px}
.q-head img{border-radius:50%}.q h1{margin:6px 0 4px;font-size:24px}.q-media{display:block;height:min(50vh,560px);width:auto;max-width:100%;margin:10px auto;border-radius:16px;background:#000;aspect-ratio:9/16;object-fit:contain}
.q-media.pic{height:auto;max-height:50vh;aspect-ratio:auto;background:none}.q-times{font-weight:600;margin:8px 0}.q-state{margin:6px 0;font-weight:600}.q-state.ok{color:var(--ok,#2f7d4f)}.q-state.bad{color:var(--warn,#a33)}
.q-go button{width:100%;font-size:20px;padding:16px;border-radius:14px;margin:10px 0}.q details{margin:10px 0}.q summary{cursor:pointer;font-weight:600}.q-text{white-space:pre-wrap;margin:8px 0}
.q-remake{display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin:14px 0}.q-remake label{flex:1 1 220px}.q-more{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:14px 0}
.q-more form{margin:0}.q-next{margin:20px 0 0;text-align:center}.q-next .button{padding:12px 22px}`;
