// Renders the jobs that video/jobs.mjs wrote:  node video/render.mjs <out-dir>
// Each finished video is <out-dir>/<job.out>; <out-dir>/done.json lists the jobs that were made (a job that fails is left out, and its post keeps
// its picture). The house's own round logo is copied in first (apps/web/public/brand/hjerterum-rundt-logo.png, the chair's file, 7 Nov 2026) - never a logo of our own making.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

const HERE = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2];
const jobs = existsSync(join(out, "jobs.json")) ? JSON.parse(readFileSync(join(out, "jobs.json"), "utf8")) : [];
const done = [];
if (jobs.length) {
  copyFileSync(join(HERE, "..", "apps", "web", "public", "brand", "hjerterum-rundt-logo.png"), join(HERE, "public", "stempel.png"));
  const serveUrl = await bundle({ entryPoint: join(HERE, "src", "index.ts"), publicDir: join(HERE, "public") });
  const browserExecutable = process.env.REMOTION_BROWSER || null;
  for (const job of jobs) {
    try {
      const composition = await selectComposition({ serveUrl, id: job.composition, inputProps: job.props, browserExecutable });
      // A silent sound track, as Instagram expects one on a reel (the house's own music comes later).
      await renderMedia({ composition, serveUrl, codec: "h264", outputLocation: join(out, job.out), inputProps: job.props, browserExecutable, enforceAudioTrack: true, concurrency: 2 });
      done.push(job);
      console.log("lavet:", job.out);
    } catch (error) {
      console.error("kunne ikke laves:", job.out, error instanceof Error ? error.message : error);
    }
  }
}
writeFileSync(join(out, "done.json"), JSON.stringify(done, null, 2));
writeFileSync(join(out, "update.sql"), done.map(j => j.sql).join("\n") + (done.length ? "\n" : ""));
console.log(`${done.length} af ${jobs.length} lavet`);
