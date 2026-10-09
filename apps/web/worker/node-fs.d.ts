// Only the tests read files from disk (worker/wrangler-config.test.ts); the worker itself has no Node types.
declare module "node:fs" {
  export function readFileSync(path: URL | string, encoding: "utf8"): string;
}
