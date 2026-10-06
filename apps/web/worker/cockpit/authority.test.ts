import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { actorOf, audit, can, denial, POWERS, recentAudit, type Power } from "./authority.js";
import { remember } from "./memory.js";
import { BOARD, deps, fakeServices, memberCookie, OWNER, personalCookie, sagaEnv, testDatabase } from "../saga/test-support.js";
import { saveBoardMessage } from "../saga/store.js";

// Requested by the chair: "Formandens beføjelser bliver udvidet hen ad vejen, så vi skal have et godt fundament for dette."

const ORIGIN = "https://admin.hjerterum.example";
const NOW = Date.parse("2026-10-06T16:00:00Z");

describe("what the chair may do", () => {
  const names = Object.keys(POWERS) as Power[];

  it("lists every power with a name and what it takes", () => {
    expect(names.length).toBeGreaterThan(5);
    for (const power of names) {
      expect(POWERS[power].label.length).toBeGreaterThan(10);
      expect(["named", "personal"]).toContain(POWERS[power].needs);
    }
  });

  it("gives a member nothing, the chair by name only what is harmless, and the chair with her own login everything", () => {
    const member = actorOf("Lisbeth", "Lisbeth", "Jacob Hauge");
    const named = actorOf("Jacob Hauge", null, "Jacob Hauge");
    const chair = actorOf("Jacob Hauge", "Jacob Hauge", "Jacob Hauge");
    const picked = actorOf(null, null, "Jacob Hauge");
    for (const power of names) {
      expect(can(member, power)).toBe(false);
      expect(can(picked, power)).toBe(false);
      expect(can(chair, power)).toBe(true);
      expect(can(named, power)).toBe(POWERS[power].needs === "named");
    }
    expect(can(named, "mailbox.see")).toBe(true);
    expect(can(named, "conversations.read")).toBe(false);
    // Someone else's personal login does not make the picked name the chair's.
    expect(actorOf("Jacob Hauge", "Lisbeth", "Jacob Hauge").personal).toBe(false);
    expect(denial(named, "conversations.read")).toContain("personlige login");
    expect(denial(member, "conversations.read")).toBe("Siden er kun for formanden.");
  });

  it("writes down what was done and shows the newest first", async () => {
    const db = testDatabase();
    const chair = actorOf("Jacob Hauge", "Jacob Hauge", "Jacob Hauge");
    await audit(db, chair, "access.close", "Lukkede Lisbeths adgang", NOW);
    await audit(db, chair, "conversations.read", "Læste samtaler med Gitta", NOW + 1000);
    expect((await recentAudit(db)).map(r => [r.power, r.detail])).toEqual([["conversations.read", "Læste samtaler med Gitta"], ["access.close", "Lukkede Lisbeths adgang"]]);
  });
});

describe("the chair's log in the cockpit", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is the chair's alone, with her own login, and records reading conversations, closing access and forgetting what others taught Saga - not her own", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    const services = fakeServices();
    const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026" });
    for (const [i, [name, id]] of ([["Jacob Hauge", OWNER], ["Lisbeth", "201"], ["Gitta", "202"]] as const).entries())
      await saveBoardMessage(db, { chatId: BOARD, messageId: 10 + i, author: name, authorId: id, text: "Hej", sentAtMs: NOW - 86_400_000, fromAssistant: false });
    const call = (path: string, init: { cookie?: string; form?: Record<string, string> } = {}) => handleCockpitRequest(new Request(ORIGIN + path, {
      method: init.form ? "POST" : "GET", body: init.form ? new URLSearchParams(init.form) : null,
      headers: { ...(init.form ? { origin: ORIGIN } : {}), ...(init.cookie ? { cookie: init.cookie } : {}) } }), env, deps(services.fetcher, NOW));
    const session = ((await call("/login", { form: { password: "hjerte-2026" } })).headers.get("set-cookie") ?? "").split(";")[0]!;
    const chair = await personalCookie("Jacob Hauge", NOW - 1000);
    await db.prepare("INSERT INTO cockpit_questions (asked_by, question, answer, created_at_ms) VALUES ('Lisbeth', 'Hvad?', 'Svar', ?)").bind(NOW - 3600_000).run();
    await remember(db, { scope: "board", member: null, text: "Rengøringen kommer om tirsdagen", learnedFrom: "Lisbeth" }, NOW);
    await remember(db, { scope: "member", member: "Jacob Hauge", text: "Vil have korte svar", learnedFrom: "Jacob Hauge" }, NOW);

    // Not for a member, and not for the chair's name picked with the shared password.
    const lisbeth = await memberCookie(session, "Lisbeth");
    expect((await call("/formand/log", { cookie: lisbeth })).status).toBe(403);
    const picked = await call("/formand/log", { cookie: await memberCookie(session, "Jacob Hauge") });
    expect(picked.status).toBe(403);
    expect(await picked.text()).toContain("personlige login");
    expect((await call("/formand/log")).status).toBe(401);

    await call("/samtaler?medlem=Lisbeth", { cookie: chair });
    await call("/samtaler?udskrift=1", { cookie: chair });
    await call("/adgang", { cookie: chair, form: { member: "Lisbeth" } });
    const memories = await db.prepare("SELECT id, text FROM saga_memories ORDER BY id").all<{ id: number; text: string }>();
    for (const m of memories.results ?? []) await call("/hukommelse/glem", { cookie: chair, form: { id: String(m.id) } });

    const log = await (await call("/formand/log", { cookie: chair })).text();
    expect(log).toContain("<h1>Formandens log</h1>");
    expect(log).toContain("Læste samtaler med Lisbeth");
    expect(log).toContain("Hentede udskrift af samtaler");
    expect(log).toContain("Lukkede Lisbeths adgang på alle enheder");
    expect(log).toContain("Glemte: Rengøringen kommer om tirsdagen");
    expect(log).not.toContain("Vil have korte svar");
    expect(log).toContain("Det formanden må");
    expect(log).toContain("Læse medlemmernes samtaler med Saga");
    expect(await (await call("/profil", { cookie: chair })).text()).toContain('href="/cockpit/formand/log"'.replace("/cockpit", ""));
  });
});
