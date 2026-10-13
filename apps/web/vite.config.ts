import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Requested: the version in the footer ("v1.66.0 · b2f4ac2"): package.json's version and the commit the build came from.
const version = (JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version?: string }).version ?? "";
const commit = (() => {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try { return execSync("git rev-parse --short=7 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return ""; }
})();

export default defineConfig({
  plugins: [react(), cloudflare()],
  // Requested (the admin's footer, "Hjerterum admin v1.15.0 · 4. okt. 2026"): "this footer should change accordingly" - the day of the build too.
  define: { __APP_VERSION__: JSON.stringify(version), __APP_COMMIT__: JSON.stringify(commit), __APP_BUILT__: JSON.stringify(new Date().toISOString().slice(0, 10)) }
});
