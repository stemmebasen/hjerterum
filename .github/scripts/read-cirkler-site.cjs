// Requested: "hun skal vide alt om cirkler fra cirklers hjemmeside". cirkler.net is built in the browser, so its public pages are
// read in Chromium and written as SQL for the table cirkler_site (apps/web/migrations/0088_cirkler_site.sql).
// Usage: NODE_PATH=<dir with playwright>/node_modules node read-cirkler-site.cjs out.sql
const { chromium } = require("playwright");
const fs = require("fs");

const SITE = "https://cirkler.net";
// The member app, login and the association's own landing are not public reading.
const SKIP = /^\/(en(\/|$)|app\b|login|invitation|hjerterum$|design$|opret-profil$)/;
const NAV = ["CIRKLER", "Sådan fungerer det", "Praktisk info", "Månedstemaer", "Om CIRKLER", "Log ind", "Kom med i CIRKLER"];

const sql = (s) => "'" + String(s).replace(/'/g, "''") + "'";

(async () => {
  const sitemap = await (await fetch(`${SITE}/sitemap.xml`)).text();
  const paths = [...sitemap.matchAll(/<loc>https:\/\/cirkler\.net([^<]*)<\/loc>/g)].map(m => m[1] || "/")
    .map(p => p.replace(/\/$/, "") || "/").filter(p => !SKIP.test(p));
  const unique = [...new Set(["/", ...paths, "/inviter-forening"])];
  const browser = await chromium.launch();
  const page = await browser.newPage();
  // Only for a test behind a proxy (READ_THROUGH_FETCH=1): requests go through Node's fetch. Not used on GitHub.
  if (process.env.READ_THROUGH_FETCH === "1") await page.route("**/*", async r => { try { await r.fulfill({ response: await r.fetch() }); } catch { await r.abort(); } });
  const rows = [];
  for (const path of unique) {
    try {
      await page.goto(SITE + path, { waitUntil: "networkidle", timeout: 45000 });
      await page.waitForTimeout(1200);
      await page.evaluate(() => { document.querySelectorAll("details").forEach(d => { d.open = true; }); document.querySelectorAll('[aria-expanded="false"]').forEach(el => { try { el.click(); } catch {} }); });
      await page.waitForTimeout(400);
      const { title, text } = await page.evaluate(() => ({ title: document.title, text: (document.querySelector("main") || document.body).innerText }));
      const lines = text.split("\n").map(l => l.trim());
      // The top menu repeats on every page: dropped.
      let start = 0; while (start < lines.length && (NAV.includes(lines[start]) || !lines[start])) start++;
      const clean = lines.slice(start).join("\n").replace(/\n{3,}/g, "\n\n").trim();
      if (clean.length < 200) { console.warn("too short, skipped", path); continue; }
      rows.push({ path, title, text: clean.slice(0, 20000) });
      console.log(path, clean.length);
    } catch (error) { console.warn("failed", path, error.message); }
  }
  await browser.close();
  // Never empty the table on a bad night: at least the front page and five others must have been read.
  if (rows.length < 6 || !rows.some(r => r.path === "/")) { console.error("too few pages read:", rows.length); process.exit(1); }
  const now = Date.now();
  const out = ["DELETE FROM cirkler_site;", ...rows.map(r => `INSERT INTO cirkler_site (path, title, text, fetched_at_ms) VALUES (${sql(r.path)}, ${sql(r.title)}, ${sql(r.text)}, ${now});`)];
  fs.writeFileSync(process.argv[2] || "cirkler-site.sql", out.join("\n") + "\n");
})().catch(error => { console.error(error); process.exit(1); });
