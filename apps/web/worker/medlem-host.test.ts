import { describe, expect, it } from "vitest";
import config from "./config-entry.js";
import { sagaEnv, testDatabase } from "./saga/test-support.js";

// Requested: "Kan du ligge den på medlem.hjerterum.info?"

const env = () => ({ ...sagaEnv(testDatabase(), { COCKPIT_PASSWORD: "x" }), ASSETS: { fetch: async (request: Request) => new Response(`spa ${new URL(request.url).pathname}`) } }) as never;

describe("medlem.hjerterum.info", () => {
  it("opens in the member area", async () => {
    const root = await config.fetch(new Request("https://medlem.hjerterum.info/"), env());
    expect(root.status).toBe(302);
    expect(root.headers.get("location")).toBe("/member-portal");
    expect((await config.fetch(new Request("https://medlem.hjerterum.info/?payment=success"), env())).headers.get("location")).toBe("/member-portal?payment=success");
  });

  it("serves the member area, sign-in and the public pages as any other address does", async () => {
    for (const path of ["/member-portal", "/member-portal/kalender", "/sign-in", "/behandlere"]) {
      const response = await config.fetch(new Request(`https://medlem.hjerterum.info${path}`), env());
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(`spa ${path}`);
    }
    expect((await config.fetch(new Request("https://medlem.hjerterum.info/api/health"), env())).status).toBe(200);
  });

  it("leaves the cockpit's and the platform's own addresses as they were", async () => {
    expect((await config.fetch(new Request("https://admin.hjerterum.info/"), env())).status).toBe(401);
    expect(await (await config.fetch(new Request("https://hjerterum-platform-staging.example.workers.dev/"), env())).text()).toBe("spa /");
  });

  it("serves the shared logo on every address", async () => {
    for (const host of ["medlem.hjerterum.info", "admin.hjerterum.info", "hjerterum-platform-staging.example.workers.dev"]) {
      const response = await config.fetch(new Request(`https://${host}/logo.png`), env());
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/png");
    }
  });
});
