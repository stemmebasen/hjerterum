import { DatabaseSync } from "node:sqlite";
import type { D1Database, D1PreparedStatement } from "../db.js";
import type { SagaDeps, SagaEnv } from "./env.js";

/** A D1-shaped database over SQLite with every real migration applied. */
export function testDatabase(): D1Database {
  const sqlite = new DatabaseSync(":memory:");
  const migrations = import.meta.glob("../../migrations/*.sql", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
  for (const key of Object.keys(migrations).sort()) sqlite.exec(migrations[key]!);
  return {
    prepare(query: string): D1PreparedStatement {
      const statement = sqlite.prepare(query);
      let values: unknown[] = [];
      const api: D1PreparedStatement = {
        bind(...next: unknown[]) { values = next; return api; },
        async first<T>() { return (statement.get(...values) as T | undefined) ?? null; },
        async all<T>() { return { results: statement.all(...values) as T[], success: true }; },
        async run() { const r = statement.run(...values); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; }
      };
      return api;
    }
  };
}

export type Call = { url: string; method: string; body: unknown };

/** Telegram, AI, ElevenLabs and Google Drive, faked; every call is recorded. */
export function fakeServices(options: { ai?: (system: string, user: string) => string } = {}) {
  const calls: Call[] = [];
  let messageId = 1000;
  const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input), method = init?.method ?? "GET";
    let body: unknown = init?.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { /* keep text */ } }
    if (body instanceof FormData) body = Object.fromEntries([...body.entries()].map(([k, v]) => [k, typeof v === "string" ? v : `[file ${(v as File).name}]`]));
    calls.push({ url, method, body });
    if (url.startsWith("https://api.telegram.org/file/")) return new Response(new Uint8Array([1, 2, 3]));
    if (url.startsWith("https://api.telegram.org/bot")) {
      const api = url.split("/").pop();
      if (api === "getFile") return reply({ ok: true, result: { file_path: "voice/file_1.ogg" } });
      return reply({ ok: true, result: { message_id: ++messageId } });
    }
    if (url === "https://api.elevenlabs.io/v1/speech-to-text") return reply({ text: "x", words: [
      { text: "Vi", speaker_id: "s0", type: "word" }, { text: " vedtager", speaker_id: "s0", type: "word" }, { text: " budgettet.", speaker_id: "s0", type: "word" },
      { text: "Enig.", speaker_id: "s1", type: "word" }] });
    if (url.endsWith("/chat/completions")) {
      const messages = (body as { messages: Array<{ content: string }> }).messages;
      const text = options.ai?.(messages[0]!.content, messages[1]!.content) ?? "Svar fra Saga.";
      return reply({ choices: [{ message: { content: text } }] });
    }
    if (url === "https://oauth2.googleapis.com/token") return reply({ access_token: "drive-token" });
    if (url.startsWith("https://www.googleapis.com/drive/v3/files?")) return reply({ files: [{ id: "rec-1", name: "Bestyrelsesmøde.m4a", mimeType: "audio/mp4", size: "1000", createdTime: "2026-09-22T17:00:00Z" }] });
    if (url.includes("/export?")) return new Response("Referat 1. september 2026\nBeslutning: Ny kagekasse.");
    if (url.startsWith("https://docs.googleapis.com/v1/documents/") && url.endsWith(":batchUpdate")) return reply({ documentId: "minutes-doc" });
    if (url.startsWith("https://docs.googleapis.com/v1/documents/")) return reply({ body: { content: [{ endIndex: 1 }, { endIndex: 120 }] } });
    if (url.startsWith("https://www.googleapis.com/drive/v3/files/")) return new Response(new Uint8Array([4, 5, 6]));
    if (url.startsWith("https://www.googleapis.com/upload/drive/v3/files")) return reply({ id: "doc-1", webViewLink: "https://docs.google.com/document/d/doc-1/edit" });
    return reply({ error: "unexpected" }, 404);
  };
  const telegram = (method: string) => calls.filter(c => c.url.startsWith("https://api.telegram.org/bot") && c.url.endsWith(`/${method}`));
  return { fetcher, calls, telegram };
}

export const OWNER = "111", BOARD = "-100222";
export function sagaEnv(db: D1Database, extra: Partial<SagaEnv> = {}): SagaEnv {
  return { DB: db, SAGA_TELEGRAM_BOT_TOKEN: "bot-token", SAGA_TELEGRAM_WEBHOOK_SECRET: "hook-secret", SAGA_TELEGRAM_BOT_USERNAME: "HjerterumSagaBot",
    SAGA_BOARD_CHAT_ID: BOARD, SAGA_OWNER_TELEGRAM_ID: OWNER, SAGA_LIVA_SECRET: "liva-secret", AI_API_KEY: "ai-key", AI_MODEL: "test-model",
    ELEVENLABS_API_KEY: "el-key", SAGA_BOARD_POSTING: "on", ...extra };
}
export const deps = (fetcher: typeof fetch, now = Date.parse("2026-09-23T10:00:00Z")): SagaDeps => ({ fetcher, now: () => now });
