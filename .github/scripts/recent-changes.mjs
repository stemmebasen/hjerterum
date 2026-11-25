// Jewel (apps/web/worker/cockpit/wishes.ts) knows what has been made lately: the changes merged to main in the last 60 days, newest first, as
// "2026-11-25 Planner: changing times ... are redrawn". Written into recent-changes.generated.ts before each deploy; the committed file is empty.
import { execFileSync } from "node:child_process";

const log = execFileSync("git", ["log", "--no-merges", "--since=60 days ago", "-n", "150", "--pretty=format:%cs%x09%s"], { encoding: "utf8" });
const lines = log.split("\n").map(line => line.trim()).filter(Boolean)
  .map(line => { const [day, ...rest] = line.split("\t"); return `${day} ${rest.join(" ").replace(/\s*\(#\d+\)\s*$/, "")}`; })
  .filter(line => !/^\S+ (Merge |Revert "|Bump )/.test(line));
process.stdout.write(`/** Written before each deploy by .github/scripts/recent-changes.mjs - the changes of the last 60 days, newest first. */\nexport const RECENT_CHANGES: string[] = ${JSON.stringify(lines, null, 2)};\n`);
