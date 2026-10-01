import { describe, expect, it } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { replacePoint } from "./corrections.js";
import { getMinutes, queueMinutes, saveBoardMessage, updateMinutes } from "../saga/store.js";
import { BOARD, deps, fakeServices, OWNER, sagaEnv, testDatabase } from "../saga/test-support.js";

// Requested: "Der skal ved hvert punkt være mulighed for hvert medlem af indsende rettelse - herefter vil
// Saga omskrive punktet. Hun skal spørge hvis hun er usikker på hvad der menes."

const ORIGIN = "https://hjerterum-platform-staging.example.workers.dev";
const NOW = Date.parse("2026-10-01T10:00:00Z");
const MINUTES = ["# Referat - bestyrelsesmøde 30. september 2026", "**Til stede:** Jacob, Gitta", "", "## Punkter", "### 1. Check-in", "- Drøftelse: God stemning.", "- Beslutning: Ingen beslutning",
  "### 2. Økonomi", "- Drøftelse: Kassen er 40.000 kr.", "- Beslutning: Budget vedtaget", "", "## Beslutninger", "- Budget vedtaget", "", "## Opgaver", "- Gitta - Send budget - 5. oktober", "", "## Næste møde", "Ikke aftalt"].join("\n");

describe("corrections to one point of the minutes", () => {
  it("replaces exactly the point asked for", () => {
    const text = replacePoint(MINUTES, 2, "### 2. Økonomi\n- Drøftelse: Kassen er 41.200 kr.\n- Beslutning: Budget vedtaget")!;
    expect(text).toContain("- Drøftelse: Kassen er 41.200 kr.");
    expect(text).not.toContain("40.000");
    expect(text).toContain("### 1. Check-in\n- Drøftelse: God stemning.");
    expect(text).toContain("\n\n## Beslutninger");
    expect(replacePoint(MINUTES, 3, "### 3. X")).toBeNull();
  });

  it("lets each member correct a point; Saga rewrites it, or asks first when she is unsure", async () => {
    const db = testDatabase();
    const prompts: string[] = [];
    let reply = "";
    const services = fakeServices({ ai: (_system, user) => { prompts.push(user); return reply; } });
    const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026", COCKPIT_URL: "https://cockpit.hjerterum.info" });
    for (const [i, [name, id]] of ([["Jacob Hauge", OWNER], ["Gitta", "202"], ["Lisbeth", "201"]] as const).entries())
      await saveBoardMessage(db, { chatId: BOARD, messageId: 10 + i, author: name, authorId: id, text: "Hej", sentAtMs: NOW - 86_400_000 });
    const id = (await queueMinutes(db, { source: "upload", fileId: "x", fileName: "x.m4a", mimeType: null, meetingDate: "2026-09-30", nowMs: NOW }))!;
    await updateMinutes(db, id, { status: "approved", draft: MINUTES, transcript: "Taler 1: Kassen er 41.200 kr." }, NOW);
    await db.prepare("INSERT INTO board_minutes_signoffs (minutes_id, member, status, comment, at_ms) VALUES (?, 'Lisbeth', 'approved', NULL, 1)").bind(id).run();
    const call = (path: string, init: RequestInit = {}) => handleCockpitRequest(new Request(ORIGIN + path, { ...init, headers: { ...(init.method === "POST" ? { origin: ORIGIN } : {}), ...(init.headers ?? {}) } }), env, deps(services.fetcher, NOW));
    const login = new FormData(); login.append("password", "hjerte-2026");
    const session = ((await call("/cockpit/login", { method: "POST", body: login })).headers.get("set-cookie") ?? "").split(";")[0]!;
    const as = (who: string) => ({ cookie: `${session}; hjerterum_cockpit_who=${encodeURIComponent(who)}` });
    const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); return f; };

    const page = await (await call(`/cockpit/referat/${id}`, { headers: as("Gitta") })).text();
    expect(page.match(/Ret dette punkt/g)).toHaveLength(2);
    expect(page).toContain(`action="/cockpit/referat/${id}/punkt/2"`);

    // Saga is unsure, and asks Gitta.
    reply = JSON.stringify({ action: "ask", question: "Mener du kassebeholdningen eller budgettet?" });
    const sent = await call(`/cockpit/referat/${id}/punkt/2`, { method: "POST", headers: as("Gitta"), body: form({ correction: "Tallet er forkert" }) });
    expect(sent.headers.get("location")).toBe(`/cockpit/referat/${id}#punkt-2`);
    expect(prompts.at(-1)).toContain("PUNKT: 2");
    expect(prompts.at(-1)).toContain("RETTELSE FRA Gitta:\nTallet er forkert");
    expect(prompts.at(-1)).toContain("KILDE (til opslag):\nTaler 1: Kassen er 41.200 kr.");
    expect(await (await call(`/cockpit/referat/${id}`, { headers: as("Gitta") })).text()).toContain("<strong>Saga spørger dig:</strong> Mener du kassebeholdningen eller budgettet?");
    expect(await (await call(`/cockpit/referat/${id}`, { headers: as("Lisbeth") })).text()).toContain("Saga har spurgt Gitta om rettelsen.");

    // Gitta answers; Saga rewrites the point, and the board's sign-offs start over.
    reply = JSON.stringify({ action: "rewrite", point: "### 2. Økonomi\n- Drøftelse: Kassen er 41.200 kr.\n- Beslutning: Budget vedtaget", decisions: null, tasks: null, summary: "Kassebeholdningen er rettet til 41.200 kr." });
    const correctionId = (await db.prepare("SELECT id FROM board_minutes_corrections").first<{ id: number }>())!.id;
    await call(`/cockpit/referat/${id}/rettelse/${correctionId}/svar`, { method: "POST", headers: as("Gitta"), body: form({ answer: "Kassebeholdningen" }) });
    expect(prompts.at(-1)).toContain("DIT SPØRGSMÅL: Mener du kassebeholdningen eller budgettet?\nSVAR FRA Gitta: Kassebeholdningen");
    expect((await getMinutes(db, id))!.draft_markdown).toContain("Kassen er 41.200 kr.");
    expect(await db.prepare("SELECT COUNT(*) AS n FROM board_minutes_signoffs").first()).toEqual({ n: 0 });
    const after = await (await call(`/cockpit/referat/${id}`, { headers: as("Lisbeth") })).text();
    expect(after).toContain("Rettet efter Gittas rettelse: Kassebeholdningen er rettet til 41.200 kr.");
    const told = services.telegram("sendMessage").at(-1)?.body as { chat_id: string; text: string };
    expect(told.chat_id).toBe(OWNER);
    expect(told.text).toContain("Gitta rettede punkt 2");
    expect(services.calls.filter(c => (c.body as { chat_id?: string })?.chat_id === BOARD)).toHaveLength(0);
    // Only the one who was asked can answer.
    expect((await call(`/cockpit/referat/${id}/rettelse/${correctionId}/svar`, { method: "POST", headers: as("Lisbeth"), body: form({ answer: "x" }) })).status).toBe(303);
  });
});
