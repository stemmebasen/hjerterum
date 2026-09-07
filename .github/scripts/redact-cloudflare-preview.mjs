import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
let previewUrl = null;

for await (const line of lines) {
  const workerMatch = line.match(/https:\/\/[A-Za-z0-9.-]+\.workers\.dev\b/);
  if (workerMatch) previewUrl = workerMatch[0];

  const sanitized = line
    .replace(/https:\/\/dash\.cloudflare\.com\/claim-preview\?[^\s]+/g, "[redacted Cloudflare claim URL]")
    .replace(/claimToken=[A-Za-z0-9._~-]+/g, "claimToken=[redacted]");

  console.log(sanitized);
}

if (!previewUrl) {
  console.error("No workers.dev preview URL found in Wrangler output.");
  process.exitCode = 2;
} else if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `preview_url=${previewUrl}\n`);
}
