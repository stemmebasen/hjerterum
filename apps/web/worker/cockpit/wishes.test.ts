import { describe, expect, it } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { BOARD, deps, fakeServices, OWNER, personalCookie, sagaEnv, testDatabase, memberCookie } from "../saga/test-support.js";
import { saveBoardMessage } from "../saga/store.js";
import { namedPage } from "./wishes.js";

// Asked (the chair, 24 Nov 2026): "Er det muligt han på en eller måde kan chatte med ai om ændringerne - og så ligger den endelig implementering og godkendelse
// stadig hos mig?" - "Ja".
const ORIGIN = "https://admin.hjerterum.example";
const NOW = Date.parse("2026-11-24T10:00:00Z");
const TOKEN = "a-long-enough-development-requests-key";

async function setup() {
  const db = testDatabase();
  for (const [i, [name, tid]] of ([["Jacob Hauge", OWNER], ["Lisbeth", "201"], ["Douglas Crawford", "202"]] as const).entries())
    await saveBoardMessage(db, { chatId: BOARD, messageId: 10 + i, author: name, authorId: tid, text: "Hej", sentAtMs: NOW - 86_400_000, fromAssistant: false });
  await db.prepare("INSERT INTO cockpit_login_links (token_hash, member, telegram_id, created_at_ms, expires_at_ms, code_hash, role) VALUES ('x', 'Douglas Crawford', '202', ?, ?, 'y', NULL)").bind(NOW - 1000, NOW + 1000).run();
  const asked: string[] = [];
  const services = fakeServices({ ai: (system, user) => {
    asked.push(`${system}\n${user}`);
    return asked.length === 1 ? '{"svar": "Which page were you on?", "oenske": null}'
      : '{"svar": "Here is the wish - change it if you like, or send it to Jacob.", "oenske": {"titel": "Bigger sign-up button on the event page", "type": "forbedring", "stoerrelse": "lille", "faerdig_naar": ["The button is easy to see on a phone"], "beskrivelse": "On an event page the sign-up button is small. Douglas: \\"make it bigger\\"."}}';
  } });
  const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026", DEV_REQUESTS_TOKEN: TOKEN } as never);
  const call = (path: string, init: RequestInit & { cookie?: string } = {}) => handleCockpitRequest(new Request(ORIGIN + path, {
    ...init, redirect: "manual", headers: { ...(init.method === "POST" ? { origin: ORIGIN } : {}), ...(init.cookie ? { cookie: init.cookie } : {}), ...((init.headers ?? {}) as Record<string, string>) } }), env, deps(services.fetcher, NOW));
  const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); return f; };
  const session = ((await call("/login", { method: "POST", body: form({ password: "hjerte-2026" }) })).headers.get("set-cookie") ?? "").split(";")[0]!;
  return { db, call, form, services, asked, lisbeth: await memberCookie(session, "Lisbeth"), chair: await personalCookie("Jacob Hauge", NOW), douglas: await personalCookie("Douglas Crawford", NOW) };
}

describe("wishes and faults in admin", () => {
  it("lets Douglas talk a wish through with Jewel and send it, and only the chair decides", async () => {
    const { db, call, form, services, asked, lisbeth, chair, douglas } = await setup();
    expect((await call("/forslag", { cookie: lisbeth })).status).toBe(403);
    expect(await (await call("/", { cookie: douglas })).text()).toContain("/forslag");
    // "Formand skal ikke nævnes" (the chair, 24 Nov 2026) - and the first address leads to the new one.
    expect((await call("/oensker", { cookie: douglas })).headers.get("location")).toMatch(/\/forslag$/);

    const made = await call("/forslag/ny", { method: "POST", cookie: douglas });
    const at = made.headers.get("location")!;
    expect(at).toMatch(/\/forslag\/\d+$/);
    const id = at.split("/").pop()!;

    await call(`/forslag/${id}/besked`, { method: "POST", cookie: douglas, body: form({ text: "The sign-up button is too small" }) });
    expect(await (await call(`/forslag/${id}`, { cookie: douglas })).text()).toContain("Which page were you on?");
    // Not ready yet: nothing to send.
    await call(`/forslag/${id}/send`, { method: "POST", cookie: douglas });
    expect((await db.prepare("SELECT status FROM wishes WHERE id = ?").bind(id).first<{ status: string }>())!.status).toBe("open");

    // The live chat: the message goes without a reload, and the conversation and the wish come back as pieces of the page.
    const live = await call(`/forslag/${id}/besked`, { method: "POST", cookie: douglas, body: form({ text: "The event page" }), headers: { accept: "application/json" } });
    expect(live.status).toBe(200);
    const pieces = await live.json() as { chat: string; card: string; notice: string };
    expect(pieces.chat).toContain("The event page");
    expect(pieces.card).toContain("Bigger sign-up button on the event page");
    // Saga is a sparring partner who knows the system, the board's decisions and the rules.
    expect(asked[1]).toContain("Eventplanlæggeren");
    expect(asked[1]).toContain("kritisk");
    // The chair (25 Nov 2026): the development agent is Jewel, a product developer, with a handbook of the system and its latest changes.
    expect(asked[1]).toContain("Du er Jewel");
    expect(asked[1]).toContain("charmerende, kvik londoner");
    expect(asked[1]).toContain("HÅNDBOG OVER SYSTEMET");
    expect(asked[1]).toContain("Forslag til udvikling (begrænset adgang; også Douglas)");
    expect(asked[1]).toContain("DE SENESTE ÆNDRINGER");
    expect(asked[1]).toContain("BESTYRELSENS BESLUTNINGER");
    expect(asked[1]).toContain("LEJE AF SALEN");
    const page = await (await call(`/forslag/${id}`, { cookie: douglas })).text();
    expect(page.toLowerCase()).not.toContain("formand");
    expect(page).toContain("Skriv til Jewel");
    // "et billede af en kvinde på 40 med hjerterums logo" (the chair, 25 Nov 2026): Jewel drawn, with the chair's own logo file inside.
    const picture = await call("/jewel.svg");
    expect(picture.headers.get("content-type")).toContain("image/svg+xml");
    expect(await picture.text()).toContain("data:image/png;base64,iVBORw0KGgo");
    expect(page).toContain("Forbedring");
    expect(page).toContain("Lille opgave");
    expect(page).toContain("The button is easy to see on a phone");
    expect(page).toContain("Bigger sign-up button on the event page");
    expect(page).toContain("Send forslaget til udvikling");
    // Douglas cannot decide.
    expect((await call(`/forslag/${id}/afgoer`, { method: "POST", cookie: douglas, body: form({ svar: "godkend" }) })).status).toBe(403);

    // "We don't need that buffer" (the chair, 26 Nov 2026): what Douglas sends is approved at once, and the chair hears of it.
    await call(`/forslag/${id}/send`, { method: "POST", cookie: douglas });
    expect((await db.prepare("SELECT status, decided_by FROM wishes WHERE id = ?").bind(id).first())).toEqual({ status: "approved", decided_by: "Douglas Crawford" });
    const told = services.telegram("sendMessage").map(c => JSON.stringify(c.body));
    expect(told.some(t => t.includes("har sendt et forslag til udvikling") && t.includes("Bigger sign-up button") && t.includes("direkte videre til udvikling"))).toBe(true);
    // The conversation is closed once it is sent.
    await call(`/forslag/${id}/besked`, { method: "POST", cookie: douglas, body: form({ text: "One more thing" }) });
    expect(asked).toHaveLength(2);

    // The chair can still add a note - or turn it down.
    await call(`/forslag/${id}/afgoer`, { method: "POST", cookie: chair, body: form({ svar: "godkend", note: "Good idea" }) });
    expect((await db.prepare("SELECT status, chair_note FROM wishes WHERE id = ?").bind(id).first())).toEqual({ status: "approved", chair_note: "Good idea" });
    expect(services.telegram("sendMessage").map(c => JSON.stringify(c.body)).some(t => t.includes("was approved") && t.includes("202"))).toBe(true);
    const list = await (await call("/forslag", { cookie: chair })).text();
    expect(list).toContain("Godkendte forslag samlet");
    expect(list).toContain("Note: Good idea");
    // Douglas does not get the chair's list.
    expect(await (await call("/forslag", { cookie: douglas })).text()).not.toContain("Godkendte forslag samlet");

    // The one who makes them fetches the approved requests with the key - nobody without it - and marks one done when it is on the site.
    expect((await call("/udvikling/api/forslag")).status).toBe(404);
    expect((await call("/udvikling/api/forslag", { headers: { authorization: "Bearer wrong-key-wrong-key-wrong-key" } })).status).toBe(404);
    // The key without "Bearer" in front works too.
    expect((await call("/udvikling/api/forslag", { headers: { authorization: TOKEN } })).status).toBe(200);
    const fetched = await (await call("/udvikling/api/forslag", { headers: { authorization: `Bearer ${TOKEN}` } })).json() as { forslag: Array<{ id: number; titel: string; note: string }> };
    expect(fetched.forslag).toEqual([expect.objectContaining({ id: Number(id), titel: "Bigger sign-up button on the event page", note: "Good idea" })]);
    expect((await call(`/udvikling/api/forslag/${id}/lavet`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` } })).status).toBe(200);
    expect(services.telegram("sendMessage").map(c => JSON.stringify(c.body)).some(t => t.includes("is done and on the site"))).toBe(true);
    // "et grønt flueben + teksten LIVE for hver opgave der er live" (the chair, 27 Nov 2026).
    expect(services.telegram("sendMessage").map(c => JSON.stringify(c.body)).some(t => t.includes("✓ LIVE"))).toBe(true);
    const overview = await (await call("/forslag", { cookie: douglas })).text();
    expect(overview).toContain('<span class="w-status w-done">✓ LIVE</span>');
    expect((await (await call("/udvikling/api/forslag", { headers: { authorization: `Bearer ${TOKEN}` } })).json() as { forslag: unknown[] }).forslag).toEqual([]);
    expect((await db.prepare("SELECT status FROM wishes WHERE id = ?").bind(id).first<{ status: string }>())!.status).toBe("done");

    // A wish can be let go. An empty conversation is used again rather than a new one, and conversations are not kept on the overview.
    const other = (await call("/forslag/ny", { method: "POST", cookie: douglas })).headers.get("location")!.split("/").pop()!;
    expect((await call("/forslag/ny", { method: "POST", cookie: douglas })).headers.get("location")!.split("/").pop()).toBe(other);
    expect(await (await call("/forslag", { cookie: douglas })).text()).not.toContain("Under samtale");
    await call(`/forslag/${other}/opgiv`, { method: "POST", cookie: douglas });
    expect((await db.prepare("SELECT status FROM wishes WHERE id = ?").bind(other).first<{ status: string }>())!.status).toBe("dropped");
  });

  it("answers the live chat with the conversation and the wish as pieces of the page", async () => {
    const { call, form, douglas } = await setup();
    const id = (await call("/forslag/ny", { method: "POST", cookie: douglas })).headers.get("location")!.split("/").pop()!;
    const response = await call(`/forslag/${id}/besked`, { method: "POST", cookie: douglas, body: form({ text: "The sign-up button is too small" }), headers: { accept: "application/json" } });
    expect(response.status).toBe(200);
    const body = await response.json() as { chat: string; card: string; notice: string };
    expect(body.chat).toContain("The sign-up button is too small");
    expect(body.chat).toContain("Which page were you on?");
    expect(body.notice).toBe("");
  });

  it("reads the page of hjerterum.info that is named - and no other site", async () => {
    const asked: string[] = [];
    const fetcher = (async (url: string) => { asked.push(url); return new Response('<html><body><div id="root"><div data-prerender><h1>Lejepriser</h1><p>Standard: 300 kr.</p></div></div></body></html>'); }) as unknown as typeof fetch;
    const text = await namedPage({ fetcher, now: () => NOW }, "Look at https://www.hjerterum.info/brug-hjerterum/lejepriser, please.");
    expect(asked).toEqual(["https://www.hjerterum.info/brug-hjerterum/lejepriser"]);
    expect(text).toContain("Lejepriser");
    expect(text).toContain("Standard: 300 kr.");
    expect(await namedPage({ fetcher, now: () => NOW }, "See https://evil.example/x")).toBe("");
  });
});

