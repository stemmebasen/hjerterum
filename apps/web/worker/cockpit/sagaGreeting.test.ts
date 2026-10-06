import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { deps, fakeServices, sagaEnv, testDatabase, memberCookie, memberCookies } from "../saga/test-support.js";

// Requested: "Ændr: Hej \"navn\"🙂 Jeg er Saga. Spørg mig f. eks. om vedtægter, beslutninger, sager, møder, arrangementer og
// medlemsskab. Og så skal hun sættes ind i disse ting - ikke mindst medlemsskaber" - and "Douglas taler engelsk".
const ORIGIN = "https://admin.hjerterum.example";
const NOW = Date.parse("2026-10-02T10:00:00Z");

describe("Saga's greeting and what she knows about membership", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("greets by first name and answers membership questions from the house's own pages, in the asker's language", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    let system = "";
    const services = fakeServices({ ai: s => { system = s; return "Standard koster 222 kr. om måneden."; } });
    const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026" });
    const call = (path: string, init: RequestInit & { cookie?: string; json?: boolean } = {}) => handleCockpitRequest(new Request(ORIGIN + path, {
      ...init, headers: { ...(init.method === "POST" ? { origin: ORIGIN } : {}), ...(init.json ? { "content-type": "application/json" } : {}), ...(init.cookie ? { cookie: init.cookie } : {}) } }), env, deps(services.fetcher, NOW));
    const login = new FormData(); login.append("password", "hjerte-2026");
    const session = ((await call("/login", { method: "POST", body: login })).headers.get("set-cookie") ?? "").split(";")[0]!;

    expect(await (await call("/", { cookie: await memberCookie(session, "Douglas Smith") })).text())
      .toContain("Hej Douglas 🙂 Jeg er Saga. Spørg mig f.eks. om vedtægter, beslutninger, sager, møder, arrangementer og medlemskab.");

    const answer = await call("/saga", { method: "POST", json: true, cookie: await memberCookie(session, "Lisbeth"), body: JSON.stringify({ question: "Hvad koster et medlemskab?", history: [] }) });
    expect(answer.status).toBe(200);
    expect(system).toContain("MEDLEMSKAB - TYPER, PRISER, FORDELE OG VILKÅR");
    expect(system).toContain("- Generøst medlemskab: 333 kr. / 3.465 kr.");
    expect(system).toContain("Support medlemskab: 50 kr. / 540 kr.");
    expect(system).toContain("Bindingsperiode: løbende måned + 1 måned");
    expect(system).toContain("tribes@holistisk.org");
    expect(system).toContain("betaling dér er ikke åbnet endnu");
    expect(system).toContain("Svar på det sprog, spørgsmålet er stillet på");
    // Requested: "Dette er alt for tungt. Her skal hun blot svare varmt og uformel og med et glimt i øjet" (e.g. to "Hvem er jeg?").
    expect(system).toContain("TONEN ER DET VIGTIGSTE");
    expect(system).toContain("varm, uformel og lidt drilsk, med et glimt i øjet");
    expect(system).toContain("Du er Hjerterums skønne formand, Jacob Hauge");
    expect(system).toContain("ingen interne henvisninger som [T1]");
    expect(system).toContain("Tilbyd højst én ting ad gangen");
    // Requested: "Saga er en uformel og kærlig medhjælper, og hun skal ikke svare i tunge paragraffer, medmindre hun eksplicit bliver bedt om dem".
    expect(system).toContain("UDTRYKKELIGT beder om paragraf, kilde eller dokumentation");
    expect(system).toContain("eksemplet viser tonen, ikke ordene - hold det naturligt og ikke overdrevet");
    expect(system).toContain("nævner du kun, når medlemmet udtrykkeligt beder om dem");
    expect(system).not.toContain("Henvis til paragraf og stykke");
    expect(system).not.toContain("nævn loven og paragraffen, som de står der");
    // No promise that only the asker sees the answer - the chair can read the conversations.
    expect(system).not.toContain("Svaret ses kun af den, der spørger");
    expect(system).not.toContain("Højst 12 linjer, Markdown med punktform, hvor det hjælper");
  });
});
