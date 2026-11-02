import { describe, expect, it } from "vitest";
import { complete } from "./ai.js";
import { redoMinutes, writtenPoints } from "./saga.js";
import { deps, fakeServices, OWNER, BOARD, sagaEnv, testDatabase } from "./test-support.js";

const NOW = Date.parse("2026-11-02T12:00:00Z");

// Reported: "There seemed to be a lot missing in the summary, even though I did record the whole meeting" - the minutes stopped at point 5 of 12:
// Claude's thinking counts against max_tokens, the answer was cut off, and the half was kept as the whole.
describe("an answer cut off at the token limit", () => {
  it("is asked for again with twice the room, and is an error when cut off again - never kept as finished", async () => {
    const db = testDatabase();
    const limits: number[] = [];
    let cutOff = 1;
    const fetcher: typeof fetch = async (_input, init) => {
      limits.push(JSON.parse(String(init?.body)).max_tokens);
      const finish = limits.length <= cutOff ? "length" : "stop";
      return new Response(JSON.stringify({ choices: [{ message: { content: `svar ${limits.length}` }, finish_reason: finish }], usage: { prompt_tokens: 10, completion_tokens: 12000 } }));
    };
    const env = { AI_API_KEY: "key", AI_MODEL: "vertex/claude-sonnet-5-5@eu", DB: db } as never;
    expect(await complete(env, { fetcher, now: () => NOW }, [{ role: "user", content: "Referat" }], { purpose: "referat", maxTokens: 12000 })).toBe("svar 2");
    expect(limits).toEqual([12000, 24000]);
    cutOff = 99; limits.length = 0;
    await expect(complete(env, { fetcher, now: () => NOW }, [{ role: "user", content: "Referat" }], { purpose: "referat", maxTokens: 40000 })).rejects.toThrow("ai_truncated");
    expect(limits).toEqual([40000, 64000]);
    const rows = (await db.prepare("SELECT ok FROM ai_usage WHERE purpose = 'referat' ORDER BY id").all<{ ok: number }>()).results!.map(r => r.ok);
    expect(rows).toEqual([0, 1, 0, 0]);
  });
});

const CUT_15 = `# Referat - bestyrelsesmøde 29. oktober 2026
**Til stede:** Jacob, Gitta
**Fraværende:** Ikke nævnt

## Punkter
### 1. Velkommen
- Drøftelse: Ikke drøftet
- Beslutning: Ingen beslutning

### 2. Priser
- Drøftelse: Gitta foreslog en undersøgelse.
- Beslutning: Ingen beslutning`;

describe("the points already written", () => {
  it("keeps every whole point and leaves out one cut off midway", () => {
    expect(writtenPoints(CUT_15)).toEqual({ kept: CUT_15, next: 3 });
    expect(writtenPoints(`${CUT_15}\n\n###`)).toEqual({ kept: CUT_15, next: 3 });
    expect(writtenPoints(`${CUT_15}\n\n### 3. Julefest\n- Drøftelse: Lisbeth foreslog\n- Beslutning: Julefesten holdes fre`)).toEqual({ kept: CUT_15, next: 3 });
    expect(writtenPoints(`${CUT_15}\n\n## Beslutninger\n- Ingen`)).toEqual({ kept: CUT_15, next: 3 });
    expect(writtenPoints("Noget helt andet")).toEqual({ kept: "", next: 1 });
  });
});

// Requested: "Begge skal laves igen og sendes ud til godkendelse igen. Implementer mine og andres rettelser først. ... Start med at sende dem til godkendelse hos mig."
describe("minutes written again", () => {
  it("keeps the corrected points, writes the rest with the board's corrections, and sends it to the chair alone", async () => {
    const db = testDatabase();
    let asked = "";
    const services = fakeServices({ ai: (_system, user) => { asked = user; return "Her er fortsættelsen:\n### 3. Hjemmeside\n- Drøftelse: Jacob viste siden.\n- Beslutning: Ingen beslutning\n\n## Beslutninger\n- Ingen beslutninger\n\n## Aftaler\n- Gitta laver spørgeskemaet\n\n## Opgaver\n- Gitta - Lav spørgeskemaet - ingen frist aftalt\n\n## Næste møde\nIkke aftalt"; } });
    const id = Number((await db.prepare(`INSERT INTO board_minutes (source, source_file_id, file_name, status, meeting_date, transcript, draft_markdown, approval_message_id, attempts, created_at_ms, updated_at_ms, redo_requested_at_ms)
      VALUES ('upload', 'r2-key', 'møde.m4a', 'approved', '2026-10-29', 'Gitta: lad os spørge medlemmerne.', ?, 219, 1, ?, ?, ?)`).bind(`${CUT_15}\n\n###`, NOW - 5 * 86_400_000, NOW - 5 * 86_400_000, NOW - 60_000).run()).meta!.last_row_id);
    await db.prepare("INSERT INTO board_minutes_corrections (minutes_id, point, member, correction, status, created_at_ms, updated_at_ms) VALUES (?, 2, 'Jacob Hauge', 'Det var Gitta og ikke Douglas', 'applied', 1, 1)").bind(id).run();
    await db.prepare("INSERT INTO board_minutes_signoffs (minutes_id, member, status, at_ms) VALUES (?, 'Douglas', 'approved', 1)").bind(id).run();
    await db.prepare("INSERT INTO job_claims (job_key, scheduled_for_ms, claimed_at_ms) VALUES ('minutes_approval_open', ?, 1)").bind(id).run();

    expect(await redoMinutes(sagaEnv(db), deps(services.fetcher, NOW))).toBe(true);
    expect(asked).toContain("RETTELSER FRA BESTYRELSEN");
    expect(asked).toContain("Punkt 2 (Jacob Hauge): Det var Gitta og ikke Douglas");
    expect(asked).toContain('begynd med "### 3."');
    const row = await db.prepare("SELECT status, draft_markdown, redo_requested_at_ms FROM board_minutes WHERE id = ?").bind(id).first<{ status: string; draft_markdown: string; redo_requested_at_ms: number | null }>();
    expect(row).toMatchObject({ status: "drafted", redo_requested_at_ms: null });
    expect(row!.draft_markdown.startsWith(`${CUT_15}\n\n### 3. Hjemmeside`)).toBe(true);
    expect(row!.draft_markdown).not.toContain("Her er fortsættelsen");
    expect(row!.draft_markdown).toContain("## Opgaver\n- Gitta - Lav spørgeskemaet");
    expect((await db.prepare("SELECT COUNT(*) AS n FROM board_minutes_signoffs WHERE minutes_id = ?").bind(id).first<{ n: number }>())!.n).toBe(0);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM job_claims WHERE job_key = 'minutes_approval_open'").first<{ n: number }>())!.n).toBe(0);
    const sent = services.telegram("sendDocument");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toMatchObject({ chat_id: OWNER });
    expect(services.calls.some(c => JSON.stringify(c.body ?? "").includes(BOARD))).toBe(false);
    // Done once: the next round has nothing to write again.
    expect(await redoMinutes(sagaEnv(db), deps(services.fetcher, NOW + 3_600_000))).toBe(false);
  });

  it("keeps the old text when the new part is not whole, and tries again later", async () => {
    const db = testDatabase();
    const services = fakeServices({ ai: () => "### 3. Hjemmeside\n- Drøftelse: Jacob viste" });
    const id = Number((await db.prepare(`INSERT INTO board_minutes (source, source_file_id, file_name, status, meeting_date, transcript, draft_markdown, attempts, created_at_ms, updated_at_ms, redo_requested_at_ms)
      VALUES ('upload', 'r2-key', 'møde.m4a', 'approved', '2026-10-29', 'tekst', ?, 1, 1, 1, 1)`).bind(CUT_15).run()).meta!.last_row_id);
    expect(await redoMinutes(sagaEnv(db), deps(services.fetcher, NOW))).toBe(false);
    expect(await db.prepare("SELECT status, draft_markdown, redo_requested_at_ms FROM board_minutes WHERE id = ?").bind(id).first()).toMatchObject({ status: "approved", draft_markdown: CUT_15, redo_requested_at_ms: 1 });
    // The same half hour: no second try; half an hour later: one more.
    expect(await redoMinutes(sagaEnv(db), deps(services.fetcher, NOW + 60_000))).toBe(false);
    expect(services.calls.filter(c => c.url.endsWith("/chat/completions"))).toHaveLength(1);
    await redoMinutes(sagaEnv(db), deps(services.fetcher, NOW + 31 * 60_000));
    expect(services.calls.filter(c => c.url.endsWith("/chat/completions"))).toHaveLength(2);
  });

  it("still refuses to change minutes the whole board has approved and locked", async () => {
    const db = testDatabase();
    const id = Number((await db.prepare(`INSERT INTO board_minutes (source, source_file_id, file_name, status, draft_markdown, attempts, created_at_ms, updated_at_ms, locked_at_ms)
      VALUES ('upload', 'k', 'f', 'approved', 'tekst', 1, 1, 1, 5)`).run()).meta!.last_row_id);
    await expect(db.prepare("UPDATE board_minutes SET draft_markdown = 'nyt' WHERE id = ?").bind(id).run()).rejects.toThrow(/minutes_locked/);
  });
});
