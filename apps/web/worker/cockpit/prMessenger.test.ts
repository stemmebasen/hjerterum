import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { BOARD, deps, fakeServices, OWNER, personalCookie, sagaEnv, testDatabase } from "../saga/test-support.js";
import { saveBoardMessage } from "../saga/store.js";
import { connectSocial } from "../social/social.js";

// Asked (the chair, 6 Nov 2026): "Vil jeg kunne svare på Messenger beskeder i cockpittet?" and "men hvor er beskederne så, når det virker?"
const GRAPH = "https://graph.facebook.com/v25.0";
const ORIGIN = "https://admin.hjerterum.example";
const NOW = Date.parse("2026-11-06T17:00:00Z");

describe("PR og SoMe → Beskeder", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the conversations, and the chair's answer goes out only on Send - within Meta's 24 hours", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const db = testDatabase();
    const services = fakeServices({ ai: () => "{}" });
    const env = sagaEnv(db, { MAIL_ENCRYPTION_KEY: "a-long-enough-test-key", META_APP_ID: "a", META_APP_SECRET: "b" } as never);
    await saveBoardMessage(db, { chatId: BOARD, messageId: 1, author: "Jacob Hauge", authorId: OWNER, text: "Hej", sentAtMs: NOW - 86_400_000, fromAssistant: false });
    await connectSocial(env, db, { id: "755", name: "Hjerterum", token: "t", igUserId: null, igUsername: null }, "Jacob Hauge", NOW - 86_400_000);
    const sent: Array<Record<string, string>> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (!url.startsWith(GRAPH)) return services.fetcher(input, init);
      const path = url.slice(GRAPH.length).split("?")[0];
      if (path === "/755/messages") { sent.push(Object.fromEntries(new URLSearchParams(String(init?.body ?? "")))); return new Response(JSON.stringify({ message_id: "m.9" })); }
      if (path === "/755/conversations") return new Response(JSON.stringify({ data: [
        { id: "t1", updated_time: "2026-11-06T11:55:00+0000", participants: { data: [{ id: "900", name: "Mari-Anne Christoffersen" }, { id: "755", name: "Hjerterum" }] },
          messages: { data: [{ id: "m1", created_time: "2026-11-06T11:55:00+0000", from: { id: "900" }, message: "Hej Hjerterum. Kunne I tænke jer at dele den? https://www.instagram.com/reel/DfZahAFRi3Z/" }] } },
        { id: "t2", updated_time: "2026-11-03T09:00:00+0000", participants: { data: [{ id: "901", name: "Signe Erritzøe" }, { id: "755", name: "Hjerterum" }] },
          messages: { data: [{ id: "m3", created_time: "2026-11-03T10:00:00+0000", from: { id: "755" }, message: "Tak!" }, { id: "m2", created_time: "2026-11-03T09:00:00+0000", from: { id: "901" }, message: "Vanvittig god energi" }] } },
      ] }));
      return new Response(JSON.stringify({ data: [] }));
    };
    const cookie = await personalCookie("Jacob Hauge", NOW);
    const call = (path: string, init: RequestInit = {}) => handleCockpitRequest(new Request(ORIGIN + path, { ...init, redirect: "manual", headers: { cookie, ...(init.method === "POST" ? { origin: ORIGIN } : {}) } }), env, deps(fetcher, NOW));
    const page = await (await call("/pr/beskeder")).text();
    expect(page).toContain("Mari-Anne Christoffersen");
    expect(page).toContain("Venter på svar");
    expect(page).toContain('href="https://www.instagram.com/reel/DfZahAFRi3Z/"');
    // Mari-Anne wrote five hours ago: she may be answered; Signe's last message is three days old: no box.
    expect(page.match(/action="\/pr\/beskeder\/svar"/g)).toHaveLength(1);
    expect(page).toContain("den seneste besked fra Signe Erritzøe, så Meta tillader ikke et svar herfra");
    expect(sent).toHaveLength(0);
    const form = new FormData(); form.append("til", "900"); form.append("navn", "Mari-Anne Christoffersen"); form.append("tekst", "Hej Mari-Anne, tak! Vi deler den gerne 🤍");
    expect((await call("/pr/beskeder/svar", { method: "POST", body: form })).headers.get("location")).toBe("/pr/beskeder?besked=besvaret");
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]!.recipient!)).toEqual({ id: "900" });
    expect(JSON.parse(sent[0]!.message!)).toEqual({ text: "Hej Mari-Anne, tak! Vi deler den gerne 🤍" });
    expect(sent[0]!.messaging_type).toBe("RESPONSE");
  });
});
