import type { D1Database } from "../db.js";
import { PR_CONSENT_TEXT, PR_MIN_PHOTOS, readyForPr, type PrMaterial } from "../../pr-material.js";
import { prMaterialOf } from "../pr-material.js";
import { esc } from "./page.js";

/** Requested (Gitta): "at events, bliver connected til underviseren på en måde ... og at deres billed/pr materiale ligger på den." On a teacher's page in
 * admin (Arrangementer → Undervisere), what they have shared for PR: whether we may use it, their photos and their quotes - photos and quotes only
 * with their consent. The teacher is found by the name they book under, are a member under, or have on their visit card. */
const lower = (s: string) => s.trim().toLocaleLowerCase("da-DK");

async function userIdsFor(db: D1Database, name: string): Promise<string[]> {
  const rows = (await db.prepare(`SELECT clerk_user_id AS id FROM room_bookings WHERE lower(trim(teacher_name)) = ?1
    UNION SELECT clerk_user_id FROM members WHERE lower(trim(full_name)) = ?1
    UNION SELECT clerk_user_id FROM public_profiles WHERE lower(trim(json_extract(draft_json, '$.name'))) = ?1`).bind(lower(name)).all<{ id: string }>().catch(() => ({ results: [] }))).results ?? [];
  return rows.map(r => r.id);
}

/** The teacher's material: the one of their accounts that has any. */
export async function prMaterialForTeacher(db: D1Database, name: string): Promise<PrMaterial | null> {
  for (const id of await userIdsFor(db, name)) {
    const m = await prMaterialOf(db, id).catch(() => null);
    if (m && (m.photos.length || m.consentAt || m.withdrawnAt || Object.values(m.quotes).some(Boolean))) return m;
  }
  return null;
}

/** The names of the teachers who are ready for PR (consent and at least three photos), lower-cased - for the badge in the list. */
export async function prReadyNames(db: D1Database): Promise<Set<string>> {
  const rows = (await db.prepare(`SELECT DISTINCT lower(trim(n.name)) AS name FROM pr_material m
    JOIN (SELECT clerk_user_id, teacher_name AS name FROM room_bookings UNION SELECT clerk_user_id, full_name FROM members
      UNION SELECT clerk_user_id, json_extract(draft_json, '$.name') FROM public_profiles) n ON n.clerk_user_id = m.clerk_user_id
    WHERE m.consent_at_ms IS NOT NULL AND (SELECT COUNT(*) FROM pr_photos p WHERE p.clerk_user_id = m.clerk_user_id) >= ?`).bind(PR_MIN_PHOTOS).all<{ name: string }>().catch(() => ({ results: [] }))).results ?? [];
  return new Set(rows.map(r => r.name).filter(Boolean));
}

const DAY = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Copenhagen" });

export function prMaterialCard(m: PrMaterial | null): string {
  const head = `<div class="card pr-material" id="pr-materiale"><h2>PR-materiale</h2>`;
  if (!m) return `${head}<p class="muted">Har ikke delt PR-materiale endnu. Undervisere deler billeder, citater og samtykke under Min profil → Mit PR-materiale.</p></div>`;
  if (!m.consentAt) return `${head}<p class="muted">${m.withdrawnAt ? `Har trukket sit samtykke tilbage ${esc(DAY.format(m.withdrawnAt))} - vi må ikke bruge billederne og citaterne.` : `Har ikke givet samtykke endnu (${m.photos.length} ${m.photos.length === 1 ? "billede" : "billeder"} delt) - vi må ikke bruge materialet.`}</p></div>`;
  const q = m.quotes, quote = (label: string, text: string, by = "") => text ? `<li><span class="small muted">${label}</span><q>${esc(text)}</q>${by ? ` <span class="small muted">- ${esc(by)}</span>` : ""}</li>` : "";
  return `${head}<p><span class="badge${readyForPr(m) ? " ok" : ""}">${readyForPr(m) ? "✓ Klar til PR" : `Mangler ${PR_MIN_PHOTOS - m.photos.length} ${PR_MIN_PHOTOS - m.photos.length === 1 ? "billede" : "billeder"}`}</span>
<span class="small muted">Samtykke givet ${esc(DAY.format(m.consentAt))}</span></p>
${m.photos.length ? `<div class="pr-photos">${m.photos.map(p => `<a href="${esc(p.url)}" target="_blank" rel="noopener" download><img src="${esc(p.url)}" alt="" loading="lazy"></a>`).join("")}</div><p class="small muted">Tryk på et billede for at åbne det i fuld størrelse.</p>` : ""}
${q.facilitator || q.offering || q.participant ? `<h3>Citater</h3><ul class="plain quotes">${quote("Om dem som facilitator", q.facilitator)}${quote("Det, deltagerne får med", q.offering)}${quote("Fra en tidligere deltager", q.participant, q.participantName)}</ul>` : ""}
<details class="small muted"><summary>Samtykket</summary><p>"${esc(PR_CONSENT_TEXT)}"</p></details></div>`;
}

export const PR_MATERIAL_STYLE = `.pr-material .pr-photos{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px;margin:12px 0 6px}
.pr-material .pr-photos img{width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:12px;display:block}.pr-material .quotes li{display:grid;gap:2px;margin:0 0 10px}
.pr-material q{font-style:italic}.badge.ok{background:#e6f4ea;color:#1e6b35}`;
