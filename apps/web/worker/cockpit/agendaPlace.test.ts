import { describe, expect, it } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { DEFAULT_PLACE, meeting, saveMeeting } from "./data.js";
import { deps, fakeServices, sagaEnv, testDatabase } from "../saga/test-support.js";

// Requested (on a meeting's page): "Her bør Sagas forslag til dagsorden også kunne trigges." -
// "Default lokation: Hjerterum, Guldsmedgade 26B, 8000 Aarhus".
const ORIGIN = "https://admin.hjerterum.example";
const NOW = Date.parse("2026-10-02T10:00:00Z");

describe("a meeting's agenda and place", () => {
  it("lets Saga suggest the agenda on demand, without saving it, and defaults the place to Hjerterum", async () => {
    const db = testDatabase();
    let asked = "";
    const services = fakeServices({ ai: (system, user) => { asked = system + user; return '{"items":["Godkendelse af dagsorden","1. Generalforsamling 14. okt.: roller","Eventuelt"]}'; } });
    const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026" });
    const call = (path: string, init: RequestInit & { cookie?: string } = {}) => handleCockpitRequest(new Request(ORIGIN + path, {
      ...init, headers: { ...(init.method === "POST" ? { origin: ORIGIN } : {}), ...(init.cookie ? { cookie: init.cookie } : {}) } }), env, deps(services.fetcher, NOW));
    const login = new FormData(); login.append("password", "hjerte-2026");
    const session = ((await call("/login", { method: "POST", body: login })).headers.get("set-cookie") ?? "").split(";")[0]!;
    const cookie = `${session}; hjerterum_cockpit_who=Jacob Hauge`;
    const id = await saveMeeting(db, { date: "2026-10-15", time: "13:30", place: "", agenda: "" }, "Jacob Hauge", NOW);
    expect((await meeting(db, id))?.place).toBe(DEFAULT_PLACE);

    const page = await (await call(`/moder/${id}`, { cookie })).text();
    expect(page).toContain("Bed Saga om forslag til dagsorden");
    expect(page).toContain(`value="${DEFAULT_PLACE}"`);
    const suggested = await (await call(`/moder/${id}/forslag`, { method: "POST", cookie })).text();
    expect(asked).toContain("Opfind intet");
    expect(asked).toContain("2026-10-15");
    expect(suggested).toContain("Indsæt Sagas forslag (3 punkter)");
    expect(suggested).toContain("Generalforsamling 14. okt.: roller");
    expect((await meeting(db, id))?.agenda).toBe("");
  });
});
