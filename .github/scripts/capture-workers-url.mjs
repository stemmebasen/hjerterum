import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
let workerUrl = null;

for await (const line of lines) {
  const match = line.match(/https:\/\/[A-Za-z0-9.-]+\.workers\.dev\b/);
  if (match) workerUrl = match[0];
  console.log(line);
}

if (!workerUrl) {
  console.error("No workers.dev URL found in Wrangler output.");
  process.exitCode = 2;
} else if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `worker_url=${workerUrl}\n`);
}
