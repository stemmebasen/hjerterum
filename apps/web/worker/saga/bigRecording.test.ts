import { describe, expect, it } from "vitest";
import { handleCockpitRequest } from "../cockpit/handler.js";
import { queueTelegramRecording } from "./saga.js";
import { saveBoardMessage } from "./store.js";
import { BOARD, deps, fakeServices, OWNER, personalCookie, sagaEnv, testDatabase } from "./test-support.js";

// The chair (27 Nov 2026): a meeting's recording of 61,1 MB - Saga sent him to a Drive folder, and admin's upload stopped at 60 MB.
describe("a long meeting recording", () => {
  it("is taken in admin up to 95 MB, kept as it came, and queued for the minutes", async () => {
    const db = testDatabase();
    const now = Date.now();
    await saveBoardMessage(db, { chatId: BOARD, messageId: 1, author: "Jacob Hauge", authorId: OWNER, text: "Hej", sentAtMs: now - 86_400_000 });
    const stored: Array<{ key: string; value: unknown }> = [];
    const bucket = { put: async (key: string, value: unknown) => { stored.push({ key, value }); return {}; }, get: async () => null };
    const env = sagaEnv(db, { BOARD_RECORDINGS: bucket } as never);
    const services = fakeServices();
    const upload = async (bytes: number) => {
      const form = new FormData();
      form.append("recording", new File([new Uint8Array(bytes)], "Ny optagelse 864.m4a", { type: "audio/mp4" }));
      form.append("meeting_date", "2026-11-26");
      return handleCockpitRequest(new Request("https://admin.hjerterum.info/upload", { method: "POST", body: form, headers: { origin: "https://admin.hjerterum.info", cookie: await personalCookie("Jacob Hauge", now) } }), env, deps(services.fetcher, now));
    };
    const ok = await upload(61 * 1024 * 1024 + 100_000);
    expect(ok.status).toBe(303);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.value).toBeInstanceOf(Blob);
    expect((await db.prepare("SELECT source, file_name, status FROM board_minutes").first())).toMatchObject({ source: "upload", file_name: "Ny optagelse 864.m4a", status: "queued" });
    expect((await upload(96 * 1024 * 1024)).status).toBe(413);
  });

  it("sends a too large file in Telegram to admin's upload, not to a Drive folder", async () => {
    const answer = await queueTelegramRecording(sagaEnv(testDatabase(), { COCKPIT_URL: "https://admin.hjerterum.info" } as never), deps(fakeServices().fetcher, Date.now()),
      { fileId: "f", fileName: "Ny optagelse 864.m4a", mimeType: "audio/mp4", size: 61 * 1024 * 1024 });
    expect(answer).toContain("https://admin.hjerterum.info/moder");
    expect(answer).toContain("95 MB");
    expect(answer).not.toContain("Drev");
  });
});
