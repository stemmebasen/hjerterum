import { describe, expect, it } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { importDocMinutes } from "../saga/importDoc.js";
import { claimNextMinutes, queueMinutes, saveBoardMessage } from "../saga/store.js";
import { BOARD, deps, fakeServices, sagaEnv, testDatabase } from "../saga/test-support.js";

const ORIGIN = "https://hjerterum-platform-staging.example.workers.dev";
const THURSDAY = Date.parse("2026-10-01T15:00:00Z");

describe("the board's history in the new system", () => {
  // Requested: "En sjov detalje er at Marianne faktisk hedder Douglas, da det er hendes konto han bruger."
  it("keeps a member who writes from someone else's account under their own name", async () => {
    const db = testDatabase();
    await db.prepare("INSERT INTO board_people (telegram_id, name) VALUES ('301', 'Douglas')").run();
    await saveBoardMessage(db, { chatId: BOARD, messageId: 1, author: "Marianne Lehmann Pedersen", authorId: "301", text: "Hej", sentAtMs: THURSDAY });
    await saveBoardMessage(db, { chatId: BOARD, messageId: 2, author: "Gitta", authorId: "202", text: "Hej", sentAtMs: THURSDAY });
    expect((await db.prepare("SELECT author_name FROM board_messages ORDER BY telegram_message_id").all()).results).toEqual([{ author_name: "Douglas" }, { author_name: "Gitta" }]);
  });

  it("takes up a recording whose work was stopped halfway", async () => {
    const db = testDatabase();
    const id = (await queueMinutes(db, { source: "upload", fileId: "cockpit/x.m4a", fileName: "x.m4a", mimeType: "audio/mp4", meetingDate: "2026-10-01", nowMs: THURSDAY }))!;
    expect((await claimNextMinutes(db, THURSDAY))?.id).toBe(id);
    expect(await claimNextMinutes(db, THURSDAY + 5 * 60_000)).toBeNull();
    expect(await claimNextMinutes(db, THURSDAY + 21 * 60_000)).toMatchObject({ id, attempts: 2 });
  });

  // Requested: "Vi skal også have indsat de sidste 10 referater ind i det nye system".
  it("takes over the newest minutes from the board's document, with the original beside them, on weekdays", async () => {
    const doc = "Dagsordener & referater\nDato for møde: 1/10/ 2026  kl.13:30-15:30\nDeltagere: Douglas, Jacob\n1) Nyhedsmail DRØFTELSE\n\n"
      + "Dato for møde: 17/9/ 2026  kl.13:30-15:30\nDeltagere: Douglas, Jacob, Gitta\n1) Check in\n2) Generalforsamling\n\nReferat\n1. Check-in\nStor tilfredshed.\n2. Generalforsamling\nBeslutning: Invitationen sendes 18. september.";
    const ai = fakeServices({ ai: (_system, user) => user.includes("2026-10-01")
      ? JSON.stringify({ hasMinutes: false, time: "13:30", agenda: ["Nyhedsmail"], minutes: "" })
      : JSON.stringify({ hasMinutes: true, time: "13:30", agenda: ["Check in", "Generalforsamling"], minutes: "# Referat - bestyrelsesmøde 17. september 2026\n**Til stede:** Douglas, Jacob, Gitta\n**Fraværende:** Ikke nævnt\n\n## Punkter\n### 1. Check-in\n- Drøftelse: Stor tilfredshed.\n- Beslutning: Ingen beslutning\n### 2. Generalforsamling\n- Drøftelse: Invitationen.\n- Beslutning: Invitationen sendes 18. september.\n\n## Beslutninger\n- Invitationen sendes 18. september.\n\n## Opgaver\n\n## Næste møde\nIkke aftalt" }) });
    const fetcher: typeof fetch = (input, init) => String(input).includes("/export?") ? Promise.resolve(new Response(doc, { headers: { "content-type": "text/plain" } })) : ai.fetcher(input, init);
    const db = testDatabase();
    const env = sagaEnv(db, { GOOGLE_MINUTES_DOC_ID: "doc-1", GOOGLE_SERVICE_ACCOUNT_JSON: "", COCKPIT_PASSWORD: "hjerte-2026" });
    await importDocMinutes(env, deps(fetcher, Date.parse("2026-10-03T10:00:00Z")));
    expect(await db.prepare("SELECT COUNT(*) AS n FROM board_minutes").first()).toEqual({ n: 0 });
    await importDocMinutes(env, deps(fetcher, THURSDAY));
    const minutes = await db.prepare("SELECT id, source, status, meeting_date, transcript FROM board_minutes").all<{ id: number; source: string; status: string; meeting_date: string; transcript: string }>();
    expect(minutes.results).toHaveLength(1);
    expect(minutes.results![0]).toMatchObject({ source: "document", status: "approved", meeting_date: "2026-09-17" });
    expect(minutes.results![0]!.transcript).toContain("Beslutning: Invitationen sendes 18. september.");
    expect((await db.prepare("SELECT meeting_date, start_time, agenda FROM board_meetings ORDER BY meeting_date").all()).results).toEqual([
      { meeting_date: "2026-09-17", start_time: "13:30", agenda: "Check in\nGeneralforsamling" }, { meeting_date: "2026-10-01", start_time: "13:30", agenda: "Nyhedsmail" }]);
    await importDocMinutes(env, deps(fetcher, THURSDAY + 300_000));
    expect(await db.prepare("SELECT ok FROM saga_status WHERE key = 'minutes_import'").first()).toEqual({ ok: 1 });
    const login = new FormData(); login.append("password", "hjerte-2026");
    const call = (path: string, init: RequestInit = {}) => handleCockpitRequest(new Request(ORIGIN + path, { ...init, headers: { ...(init.method === "POST" ? { origin: ORIGIN } : {}), ...(init.headers ?? {}) } }), env, deps(fetcher, THURSDAY));
    const session = ((await call("/cockpit/login", { method: "POST", body: login })).headers.get("set-cookie") ?? "").split(";")[0]!;
    const page = await (await call(`/cockpit/referat/${minutes.results![0]!.id}`, { headers: { cookie: session } })).text();
    for (const text of ["Originalteksten fra referatdokumentet", "overført fra referatdokumentet", "<li>Check in</li>", "Invitationen sendes 18. september."]) expect(page).toContain(text);
  });
});
