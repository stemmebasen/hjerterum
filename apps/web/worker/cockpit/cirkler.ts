import type { D1Database } from "../db.js";

/** Requested: "Det lyder til hun har en gammel forståelse af cirkler. Det skal rettes. Og hun skal vide alt om cirkler fra cirklers
 * hjemmeside." What Saga knows of CIRKLER is cirkler.net itself - every public page, read each night in a real browser
 * (.github/workflows/cirkler-site.yml → the table cirkler_site) - and, from Hjerterum's own side, only how Hjerterum's members come
 * in and the board's decision. The old summary (written 29 October from older descriptions) is gone. Hjerterum keeps nothing about
 * circles or who is in them, so Saga can explain CIRKLER, but never say who is in a circle, when a circle meets, or whether someone
 * has been matched. */

/** Hjerterum's own side: the member area's button and check (cirkler-integration.ts, profile-features.tsx) and the board's decision. */
export const HJERTERUM_AND_CIRKLER = `HJERTERUM OG CIRKLER (Hjerterums egen side)
- Bestyrelsens beslutning på teammødet 3. september 2026 (vedtaget med flertal): "Cirkler er et selvstændigt koncept, som Jacob Hauge driver og ejer. Hjerterums lokaler kan bruges til cirkelmøder, i bytte for at Hjerterums medlemmer kan benytte lokalerne til cirkelmøder."
- Hjerterum er en godkendt forening hos CIRKLER: medlemmer med et medlemskab med medlemsfordele (Standard, Generøst og Reduceret pris - ikke Support) deltager gratis.
- Man kommer med fra Hjerterums medlemsområde (medlem.hjerterum.info) under Min CIRKLER-profil med knappen "Tilmeld dig eller åbn CIRKLER". CIRKLER tjekker hver dag hos Hjerterum, at medlemskabet stadig gælder.
- Hjerterum gemmer intet om cirklerne eller hvem der er med. Spørgsmål om ens egen cirkel klares i CIRKLER-appen eller på kontaktsiden på cirkler.net.`;

const RULE = `Svar om CIRKLER KUN ud fra cirkler.net herunder og Hjerterums egen side. cirkler.net er den gældende kilde - gæt aldrig regler, datoer, priser eller status, og brug ingen ældre viden (fx om Tribes eller "tribe leader"). Står svaret ikke her, så henvis til den relevante side på cirkler.net eller kontaktsiden. Link til siderne med deres adresse.`;

export type CirklerPage = { path: string; title: string; text: string; fetched_at_ms: number };

export async function cirklerPages(db: D1Database | undefined): Promise<CirklerPage[]> {
  if (!db) return [];
  return db.prepare("SELECT path, title, text, fetched_at_ms FROM cirkler_site ORDER BY CASE path WHEN '/' THEN 0 ELSE 1 END, path")
    .all<CirklerPage>().then(r => r.results ?? []).catch(() => []);
}

/** All that Saga is given about CIRKLER: the rule, cirkler.net's pages (with when they were read) and Hjerterum's side. */
export function cirklerText(pages: CirklerPage[]): string {
  const read = pages.length ? new Intl.DateTimeFormat("da-DK", { timeZone: "Europe/Copenhagen", day: "numeric", month: "long", year: "numeric" }).format(Math.max(...pages.map(p => p.fetched_at_ms))) : null;
  const site = pages.length
    ? `CIRKLER.NET (læst ${read}):\n\n` + pages.map(p => `### ${p.title} (https://cirkler.net${p.path === "/" ? "" : p.path})\n${p.text}`).join("\n\n")
    : "cirkler.net er ikke læst endnu - henvis til https://cirkler.net for alt om CIRKLER.";
  return `${RULE}\n\n${site}\n\n${HJERTERUM_AND_CIRKLER}`;
}

const ABOUT_CIRKLER = /cirk(el|ler)|circle|tribe/i;

/** The website's and the member area's Saga: CIRKLER when the conversation (its newest messages) is about CIRKLER - only then,
 * so other questions cost no more. Asked: "Ved hun virkelig ikke mere om cirkler? Er det en anden saga end hende vi har i admin?" */
export async function cirklerKnowledge(db: D1Database | undefined, history: ReadonlyArray<{ text: string }>): Promise<string> {
  const recent = history.slice(-6).map(m => m.text).join(" ");
  if (!ABOUT_CIRKLER.test(recent)) return "";
  return `\n\nCIRKLER - SMÅ, FASTE FÆLLESSKABER, SOM HJERTERUMS MEDLEMMER KAN DELTAGE I:\n${cirklerText(await cirklerPages(db))}`;
}
