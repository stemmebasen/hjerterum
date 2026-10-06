import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { responsibilities, responsibilitiesForSaga, setResponsibilities } from "./data.js";
import { BOARD, deps, fakeServices, memberCookie, OWNER, sagaEnv, testDatabase } from "../saga/test-support.js";
import { saveBoardMessage } from "../saga/store.js";

// Requested by the chair: "Indbyg at man skal skrive hvad ens ansvarsområder er, så Saga ved besked".

const ORIGIN = "https://admin.hjerterum.example";
const NOW = Date.parse("2026-10-06T10:00:00Z");

async function setup() {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
  const db = testDatabase();
  let system = "";
  const services = fakeServices({ ai: s => { system = s; return "Svar."; } });
  const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026" });
  for (const [i, [name, id]] of ([["Jacob Hauge", OWNER], ["Lisbeth", "201"], ["Gitta", "202"]] as const).entries())
    await saveBoardMessage(db, { chatId: BOARD, messageId: 10 + i, author: name, authorId: id, text: "Hej", sentAtMs: NOW - 86_400_000, fromAssistant: false });
  const call = (path: string, init: RequestInit & { cookie?: string; form?: Record<string, string>; json?: unknown } = {}) => handleCockpitRequest(new Request(ORIGIN + path, {
    method: init.method ?? (init.form || init.json ? "POST" : "GET"),
    body: init.form ? new URLSearchParams(init.form) : init.json ? JSON.stringify(init.json) : null,
    headers: { ...(init.form || init.json ? { origin: ORIGIN } : {}), ...(init.json ? { "content-type": "application/json" } : {}), ...(init.cookie ? { cookie: init.cookie } : {}) } }), env, deps(services.fetcher, NOW));
  const session = ((await call("/login", { form: { password: "hjerte-2026" } })).headers.get("set-cookie") ?? "").split(";")[0]!;
  return { db, call, as: (name: string) => memberCookie(session, name), system: () => system };
}

describe("a member's responsibilities", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps what the member wrote, trimmed and cut at 600 characters, and never clears it by an empty save", async () => {
    const db = testDatabase();
    expect(await setResponsibilities(db, "Lisbeth", "  Lokaler og nøgler\r\n\r\n\r\n\r\nØkonomi  ", NOW)).toBe(true);
    expect((await responsibilities(db)).get("Lisbeth")).toBe("Lokaler og nøgler\n\nØkonomi");
    expect(await setResponsibilities(db, "Lisbeth", "   ", NOW)).toBe(false);
    expect((await responsibilities(db)).get("Lisbeth")).toBe("Lokaler og nøgler\n\nØkonomi");
    await setResponsibilities(db, "Lisbeth", "x".repeat(900), NOW);
    expect((await responsibilities(db)).get("Lisbeth")).toHaveLength(600);
  });

  it("is listed for Saga with who has not written yet", () => {
    expect(responsibilitiesForSaga(["Gitta", "Lisbeth", "Douglas"], new Map([["Lisbeth", "Lokaler\nØkonomi"]]))).toBe(
      "- Gitta: (har ikke skrevet sine ansvarsområder endnu)\n- Lisbeth: Lokaler; Økonomi\n- Douglas: (har ikke skrevet sine ansvarsområder endnu)");
  });

  it("is asked for on the front page until it is written, then Saga knows it, and it can be edited under the profile", async () => {
    const { call, as, db, system } = await setup();
    const gitta = await as("Gitta");
    const front = await (await call("/", { cookie: gitta })).text();
    expect(front).toContain("Hvad har du ansvar for?");
    expect(front).toContain('action="/profil/ansvar"');

    const saved = await call("/profil/ansvar", { cookie: gitta, form: { text: "Events og nyhedsbrev", back: "/" } });
    expect(saved.status).toBe(303);
    expect(saved.headers.get("location")).toBe("/");
    expect(await (await call("/", { cookie: gitta })).text()).not.toContain("Hvad har du ansvar for?");
    // The others are still asked.
    expect(await (await call("/", { cookie: await as("Lisbeth") })).text()).toContain("Hvad har du ansvar for?");

    const profile = await (await call("/profil", { cookie: gitta })).text();
    expect(profile).toContain("Mine ansvarsområder");
    expect(profile).toContain(">Events og nyhedsbrev</textarea>");
    const edited = await call("/profil/ansvar", { cookie: gitta, form: { text: "Events, nyhedsbrev og den daglige post", back: "/profil" } });
    expect(edited.headers.get("location")).toBe("/profil?ansvar=gemt#ansvar");
    expect(await (await call("/profil?ansvar=gemt", { cookie: gitta })).text()).toContain("Gemt. Saga kender dem nu.");

    await call("/saga", { cookie: await as("Jacob Hauge"), json: { question: "Hvem tager sig af nyhedsbrevet?", history: [] } });
    expect(system()).toContain("ANSVARSOMRÅDER I BESTYRELSEN");
    expect(system()).toContain("- Gitta: Events, nyhedsbrev og den daglige post");
    expect(system()).toContain("- Lisbeth: (har ikke skrevet sine ansvarsområder endnu)");
    expect((await db.prepare("SELECT COUNT(*) AS n FROM cockpit_responsibilities").first<{ n: number }>())!.n).toBe(1);
  });

  it("needs someone who is logged in", async () => {
    const { call } = await setup();
    expect((await call("/profil/ansvar", { form: { text: "x", back: "/" } })).status).toBe(401);
  });
});
