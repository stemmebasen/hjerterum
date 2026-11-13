// Builds the render jobs from Saga's proposals (run by .github/workflows/video-events.yml and ugens-reel.yml):
//
//   node video/jobs.mjs events <posts.json> <out-dir> <now-ms> [asks.json] - a video for each event proposal on Instagram that has none yet,
//                                                                         and the chair's asked-for choices
//   node video/jobs.mjs week <week.json> <events.json> <out-dir> <now-ms> - "Ugens events" as a reel, once a week
//
// The json files are `wrangler d1 execute --json` answers. Writes <out-dir>/jobs.json ({ composition, props, out, name, sql }[]) - each job's sql
// lays its video in admin once it is made - and copies the pictures into video/public/jobs/, so the render needs no network for them. A video only
// ever says what the post says: its title, teacher, time and one sentence of Saga's text that the chair approves.
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sizeOf from "image-size";

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = "https://www.hjerterum.info";
const PICS = join(HERE, "public", "jobs");
const TZ = "Europe/Copenhagen";

const rows = path => { const d = JSON.parse(readFileSync(path, "utf8")); const first = Array.isArray(d) ? d[0] : d; return first?.results ?? []; };
const json = (text, fallback) => { try { return JSON.parse(text ?? ""); } catch { return fallback; } };
const sql = v => v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`;
const parts = ms => Object.fromEntries(new Intl.DateTimeFormat("da-DK", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hour12: false })
  .formatToParts(new Date(ms)).map(p => [p.type, p.value]));
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const clock = ms => { const p = parts(ms); return `${Number(p.hour)}.${p.minute}`; };
const hourOf = ms => Number(parts(ms).hour);

/** The title as a video says it: the first part, no emoji. */
export function cleanTitle(title) {
  let t = String(title ?? "").split(" | ")[0].replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "").replace(/\s+/g, " ").trim();
  if (t.length > 48) { const head = t.split(/\s[-–]\s/)[0]; if (head.length >= 8) t = head; }
  return t;
}

/** One sentence of Saga's approved words that does not repeat the time (the video shows it). */
export function lineOf(text) {
  // "kl. 16.15" and "ca. 45" do not end a sentence.
  const sentences = String(text ?? "").replace(/\s+/g, " ").replace(/\b(kl|ca|bl\.a|fx|evt|inkl|min)\. /gi, "$1\u2024 ").split(/(?<=[.!?])\s+/)
    .map(s => s.replace(/\u2024/g, ".").trim()).filter(Boolean);
  const s = sentences.find(x => !/\bkl\.?\s*\d/i.test(x) && x.length >= 20) ?? null;
  if (!s) return null;
  if (s.length <= 120) return s;
  return s.slice(0, s.lastIndexOf(" ", 110)) + " …";
}

const KICKERS = [["yoga", "YOGA"], ["medit", "MEDITATION"], ["breathwork", "BREATHWORK"], ["healing", "HEALING"], ["dans", "DANS"], ["foredrag", "FOREDRAG"],
  ["café", "CAFÉ"], ["cafe", "CAFÉ"], ["cirkel", "CIRKEL"], ["workshop", "WORKSHOP"], ["retreat", "RETREAT"], ["fællesskab", "FÆLLESSKAB"], ["ceremoni", "CEREMONI"]];
const kickerOf = text => (KICKERS.find(([k]) => String(text).toLowerCase().includes(k)) ?? [null, "I HJERTERUM"])[1];

/** The picture, copied in, with its shape (null when it cannot be had). */
async function picture(url) {
  if (!url || !/^https:\/\//.test(url)) return null;
  try {
    const r = await fetch(url, { headers: { "user-agent": "Hjerterum-video" } });
    if (!r.ok || !String(r.headers.get("content-type")).startsWith("image/")) return null;
    const bytes = Buffer.from(await r.arrayBuffer());
    const { width, height, type } = sizeOf(bytes);
    if (!width || !height) return null;
    mkdirSync(PICS, { recursive: true });
    const file = `${createHash("sha1").update(url).digest("hex").slice(0, 16)}.${type === "jpg" ? "jpg" : type}`;
    writeFileSync(join(PICS, file), bytes);
    return { file: `jobs/${file}`, ratio: width / height };
  } catch { return null; }
}

/** Saga's choice of template - the chair kept 1, 2, 3, 4, 5, 7, 8 and 10, and asked for 11 (13 Nov 2026). The chair's own choice (source.videoTemplate)
 * wins. An evening event gets 11, "Billedets farver", in the colours of its own picture - not 7, "Nat" (the chair: "this is a terrible template"). */
export function chooseTemplate(post, hasPicture, startsMs) {
  const own = Number(post.source?.videoTemplate);
  if ([1, 2, 3, 4, 5, 7, 8, 10, 11].includes(own) && (own === 2 || hasPicture)) return own;
  if (post.source?.quote && hasPicture) return 8;
  if (post.source?.portrait) return 10;
  if (!hasPicture) return 2;
  if (hourOf(startsMs) >= 18) return 11;
  return [1, 3, 4, 5, 11][Number(post.id) % 5];
}

/** The props of an event's video in a template (null when the template needs a picture the event does not have). */
async function eventVideo(r, now, forced = null) {
  const source = json(r.source, {}), images = json(r.images, []);
  if (!source.startsMs) return null;
  const pic = await picture(images[0]);
  const portrait = source.portrait ? await picture(source.portrait) : null;
  const post = { id: r.id, source };
  const p = parts(source.startsMs);
  const template = forced ?? chooseTemplate({ ...post, source: { ...source, portrait: portrait ? source.portrait : null } }, Boolean(pic), source.startsMs);
  if (forced && forced !== 2 && !pic) return null;
  const props = { template, title: cleanTitle(source.title), host: source.host ?? null, picture: pic, portrait, quote: source.quote ?? null,
    kicker: kickerOf(`${source.title} ${r.text}`), dayName: cap(p.weekday), dayNo: String(Number(p.day)), month: p.month, time: clock(source.startsMs), timeRange: clock(source.startsMs),
    line: lineOf(r.text) };
  const name = `event-${r.id}-${randomBytes(6).toString("hex")}`;
  return { template, props, name, video: `${SITE}/api/social-reels/${name}.mp4` };
}

async function eventJobs(postsPath, out, now, asksPath = null) {
  const jobs = [];
  for (const r of rows(postsPath)) {
    const v = await eventVideo(r, now);
    if (!v) continue;
    jobs.push({ composition: "Event", props: v.props, out: `${v.name}.mp4`, name: v.name,
      // Only on a proposal still waiting for the chair, that has no video yet - an approved post goes out as it was approved.
      sql: `UPDATE social_posts SET source = json_set(source, '$.video', ${sql(v.video)}, '$.videoTemplate', ${v.template}, '$.videoAtMs', ${now}) WHERE id = ${Number(r.id)} AND status = 'draft' AND json_extract(source, '$.video') IS NULL;` });
  }
  // Requested (the chair, 5 Nov 2026): "flere ... video designs på kommando" - the templates the chair asked for (source.videoAsk), each a choice beside the
  // post's video (source.videoChoices); the chair picks one in admin. The post's own video is never changed here.
  for (const r of asksPath ? rows(asksPath) : []) {
    // "med lidt bevægelse ... ryste, zoom eller slør ind" (still.tsx): the chair's own design from the studio, in motion.
    const still = json(r.source, {}).stillAsk;
    if (still?.image) {
      const pic = await picture(still.image);
      const effect = ["zoom", "ryst", "slor"].includes(still.effect) ? still.effect : "zoom";
      if (pic) {
        const name = `design-${r.id}-${randomBytes(6).toString("hex")}`;
        const choice = JSON.stringify({ template: 0, effect, video: `${SITE}/api/social-reels/${name}.mp4`, atMs: now });
        jobs.push({ composition: "Still", props: { picture: pic, effect }, out: `${name}.mp4`, name,
          sql: `UPDATE social_posts SET source = json_remove(json_set(source, '$.videoChoices', json(json_insert(coalesce(json_extract(source, '$.videoChoices'), '[]'), '$[#]', json(${sql(choice)})))), '$.stillAsk') WHERE id = ${Number(r.id)} AND status IN ('draft', 'approved', 'failed');` });
      }
    }
    const ask = json(r.source, {}).videoAsk;
    for (const template of (ask?.templates ?? []).slice(0, 3)) {
      const v = await eventVideo(r, now, Number(template));
      if (!v) continue;
      const choice = JSON.stringify({ template: v.template, video: v.video, atMs: now });
      jobs.push({ composition: "Event", props: v.props, out: `${v.name}.mp4`, name: v.name,
        sql: `UPDATE social_posts SET source = json_remove(json_set(source, '$.videoChoices', json(json_insert(coalesce(json_extract(source, '$.videoChoices'), '[]'), '$[#]', json(${sql(choice)})))), '$.videoAsk') WHERE id = ${Number(r.id)} AND status IN ('draft', 'approved', 'failed');` });
    }
  }
  writeFileSync(join(out, "jobs.json"), JSON.stringify(jobs, null, 2));
  console.log(`${jobs.length} video${jobs.length === 1 ? "" : "er"} at lave`);
}

const MONTH_SHORT = ["jan.", "feb.", "mar.", "apr.", "maj", "jun.", "jul.", "aug.", "sep.", "okt.", "nov.", "dec."];
function weekRange(mondayMs) {
  const a = new Date(new Date(mondayMs).toLocaleString("en-US", { timeZone: TZ })), b = new Date(a.getTime() + 6 * 86_400_000);
  return a.getMonth() === b.getMonth() ? `${a.getDate()}.–${b.getDate()}. ${MONTH_SHORT[b.getMonth()]}` : `${a.getDate()}. ${MONTH_SHORT[a.getMonth()]}–${b.getDate()}. ${MONTH_SHORT[b.getMonth()]}`;
}

const WEEK_REEL_MAX = 14;
/** Noon on the Monday of an ISO week ("2026-W46"), as ms. */
export function isoMonday(week) {
  const [, y, n] = /^(\d{4})-W(\d{2})$/.exec(week) ?? [];
  const jan4 = Date.UTC(Number(y), 0, 4), day = (new Date(jan4).getUTCDay() + 6) % 7;
  return jan4 - day * 86_400_000 + (Number(n) - 1) * 7 * 86_400_000 + 12 * 3_600_000;
}
async function weekJob(weekPath, eventsPath, out, now) {
  const skip = why => { writeFileSync(join(out, "jobs.json"), "[]"); writeFileSync(join(out, "skip"), why + "\n"); console.log("skip:", why); };
  const [w] = rows(weekPath);
  if (!w) return skip("ingen kommende uge er planlagt");
  if (w.has_reel) return skip(`${w.week} har allerede sin reel`);
  if (!w.ig) return skip("Instagram er ikke forbundet");
  const seen = new Set(), events = [];
  const posts = rows(eventsPath).map(r => ({ source: json(r.source, {}), images: json(r.images, []) })).filter(r => r.source.startsMs && r.images[0]).sort((a, b) => a.source.startsMs - b.source.startsMs);
  for (const r of posts) {
    const title = cleanTitle(r.source.title);
    // Reported (the chair, 8 Nov 2026): "Hvorfor vises kun disse i ugens reel?" - it stopped at 8 (Monday to Thursday): the whole week, up to 14 (7 pages, about 35 s).
    if (seen.has(title.toLowerCase()) || events.length >= WEEK_REEL_MAX) continue;
    const pic = await picture(r.images[0]);
    if (!pic) continue;
    seen.add(title.toLowerCase());
    const p = parts(r.source.startsMs);
    events.push({ picture: pic, day: cap(p.weekday), date: `${Number(p.day)}/${new Date(r.source.startsMs).toLocaleString("en-US", { timeZone: TZ, month: "numeric" })}`,
      time: clock(r.source.startsMs), title, host: r.source.host ? String(r.source.host).split(" ")[0] : null });
  }
  if (!events.length) return skip("ugen har ingen events med billede");
  const source = json(w.source, {});
  // Reported (the chair, 8 Nov 2026): "Hvorfor hedder overskriften 8-14. nov!?! Det er 9-15!!" - the Monday was counted back from the post's time (once always
  // Monday 15.30); now it is the week's own Monday, from its number.
  const monday = isoMonday(String(w.week));
  const props = { weekNo: Number(String(w.week).slice(6)), range: weekRange(monday), events };
  const name = `${String(w.week).toLowerCase()}-${randomBytes(6).toString("hex")}`;
  const reelSource = { format: "reel", video: `${SITE}/api/social-reels/${name}.mp4`, events: source.events ?? [], collaborators: source.collaborators ?? [] };
  const caption = String(source.instagramText || w.text || "").trim();
  // "sikr der køres én gang på IG og en gang på FB kl. 7.30" (the chair, 8 Nov 2026): the reel on both, at Ugens events' own time - and the picture post
  // then stays home (social.ts publishOne).
  const at = Number(w.publish_at_ms);
  writeFileSync(join(out, "jobs.json"), JSON.stringify([{ composition: "Week", props, out: `${name}.mp4`, name,
    sql: "INSERT OR IGNORE INTO social_posts (kind, source_key, week, channels, text, link, images, source, publish_at_ms, status, created_at_ms, updated_at_ms) VALUES " +
      `('week', ${sql("reel:" + w.week)}, ${sql(w.week)}, '["facebook","instagram"]', ${sql(caption)}, NULL, '[]', ${sql(JSON.stringify(reelSource))}, ${at}, 'draft', ${now}, ${now});` }], null, 2));
  console.log("Ugens reel:", name, events.length, "events");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode === "events") { const [posts, out, now, asks] = rest; mkdirSync(out, { recursive: true }); await eventJobs(posts, out, Number(now), asks ?? null); }
  else if (mode === "week") { const [week, events, out, now] = rest; mkdirSync(out, { recursive: true }); await weekJob(week, events, out, Number(now)); }
  else { console.error("brug: jobs.mjs events <posts.json> <out> <now> | week <week.json> <events.json> <out> <now>"); process.exit(2); }
}
