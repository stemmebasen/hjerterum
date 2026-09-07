import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
let previewUrl = "";

for await (const inputLine of rl) {
  const workerMatch = inputLine.match(/https:\/\/[^\s]+\.workers\.dev\/?/i);
  if (workerMatch) previewUrl = workerMatch[0].replace(/[),.;]+$/, "");

  const safeLine = inputLine
    .replace(/https:\/\/dash\.cloudflare\.com\/[^\s]*claim[^\s]*/gi, "<redacted-cloudflare-claim-url>")
    .replace(/claimToken=[^&\s]+/gi, "claimToken=<redacted>");

  process.stdout.write(`${safeLine}\n`);
}

if (!previewUrl) {
  process.stderr.write("Temporary Worker URL was not found in Wrangler output.\n");
  process.exit(1);
}

const outputFile = process.env.GITHUB_OUTPUT;
if (!outputFile) {
  process.stderr.write("GITHUB_OUTPUT is unavailable.\n");
  process.exit(1);
}

appendFileSync(outputFile, `preview_url=${previewUrl}\n`);
