import { describe, expect, it } from "vitest";
import { BACKUP_TABLES, exportBoardData, scheduledBackup } from "./backup.js";
import { insertMail, saveBoardMessage } from "./store.js";
import { BOARD, deps, fakeServices, sagaEnv, testDatabase } from "./test-support.js";

// Requested: "Sørg for, at alle disse ting, der foregår i gruppen, og som kan være vigtige for fremtiden, gemmes sikkert én gang i døgnet."
const NIGHT = Date.parse("2026-10-10T02:30:00Z"); // 04:30 in Copenhagen
const testKey = async () => {
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  return `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----`;
};

describe("the night copy", () => {
  const setup = async () => {
    const db = testDatabase();
    const services = fakeServices({});
    const env = sagaEnv(db, { GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: "saga@hjerterum.iam.gserviceaccount.com", private_key: await testKey() }), GOOGLE_DRIVE_MINUTES_FOLDER_ID: "folder-1" });
    await saveBoardMessage(db, { chatId: BOARD, messageId: 1, author: "Gitta", authorId: "202", text: "Konflikt med en underviser om nøgler", sentAtMs: NIGHT - 3_600_000, fromAssistant: false });
    await insertMail(db, { ref: "m1", sender: "Anna <anna@example.com>", subject: "Orientering", receivedAtMs: NIGHT - 7_200_000, preview: "Tekst", nowMs: NIGHT });
    return { db, services, env };
  };

  it("collects what the board has written and decided - and nothing that is only for security", async () => {
    const { db } = await setup();
    const data = await exportBoardData(db, NIGHT);
    expect(data.tables.board_messages).toMatchObject([{ author_name: "Gitta", text: "Konflikt med en underviser om nøgler" }]);
    expect(data.tables.board_mail).toMatchObject([{ subject: "Orientering" }]);
    for (const secret of ["cockpit_login_links", "cockpit_login_attempts", "cockpit_signouts", "team_mail_account", "ai_usage", "job_claims", "cockpit_translations"]) expect(Object.keys(data.tables)).not.toContain(secret);
    expect(BACKUP_TABLES).toContain("board_proposals");
    expect(JSON.stringify(data)).not.toContain("password");
  });

  it("puts one file a day on Drive after three at night, once - and tries again every hour until it works, telling the chair once", async () => {
    const { db, services, env } = await setup();
    const uploads = () => services.calls.filter(c => c.url.startsWith("https://www.googleapis.com/upload/drive/v3/files"));
    // Not before three in the morning (Copenhagen).
    expect(await scheduledBackup(env, deps(services.fetcher, Date.parse("2026-10-10T00:30:00Z")), db)).toBe(false);
    expect(uploads()).toHaveLength(0);
    expect(await scheduledBackup(env, deps(services.fetcher, NIGHT), db)).toBe(true);
    expect(uploads()).toHaveLength(1);
    expect(String(uploads()[0]!.body)).toContain("hjerterum-kopi-2026-10-10.json");
    expect(String(uploads()[0]!.body)).toContain("Konflikt med en underviser om nøgler");
    expect(await db.prepare("SELECT ok, detail FROM saga_status WHERE key = 'backup'").first()).toMatchObject({ ok: 1 });
    // The rest of the day: nothing more.
    expect(await scheduledBackup(env, deps(services.fetcher, NIGHT + 3_700_000), db)).toBe(false);
    expect(uploads()).toHaveLength(1);
    // The next night: a new file.
    expect(await scheduledBackup(env, deps(services.fetcher, NIGHT + 24 * 3_600_000), db)).toBe(true);
    expect(uploads()).toHaveLength(2);
  });

  it("shows a failure, tells the chair once a day, and tries again the next hour", async () => {
    const { db, env } = await setup();
    const broken = fakeServices({});
    const failing: typeof fetch = async (input, init) => String(input).startsWith("https://www.googleapis.com/upload/") ? new Response("{}", { status: 500 }) : broken.fetcher(input, init);
    expect(await scheduledBackup(env, deps(failing, NIGHT), db)).toBe(false);
    expect(await db.prepare("SELECT ok, detail FROM saga_status WHERE key = 'backup'").first()).toMatchObject({ ok: 0 });
    expect(broken.telegram("sendMessage")).toHaveLength(1);
    expect(await scheduledBackup(env, deps(failing, NIGHT + 3_700_000), db)).toBe(false);
    expect(broken.telegram("sendMessage")).toHaveLength(1);
    const ok = fakeServices({});
    expect(await scheduledBackup(env, deps(ok.fetcher, NIGHT + 7_400_000), db)).toBe(true);
  });

  it("does nothing without Google", async () => {
    const { db, services } = await setup();
    expect(await scheduledBackup(sagaEnv(db), deps(services.fetcher, NIGHT), db)).toBe(false);
  });
});
