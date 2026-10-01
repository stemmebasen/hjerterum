import { describe, expect, it } from "vitest";
import { handleCockpitRequest } from "./handler.js";
import { runEventSync, searchEvents, syncHouseEvents } from "./events.js";
import { deps, sagaEnv, testDatabase, fakeServices } from "../saga/test-support.js";

// Requested: "You can also use this direct link so that Saga knows coming and historic events - could
// be nice to showcase, and to be able to search through and even ask Saga about".

const ORIGIN = "https://hjerterum-platform-staging.example.workers.dev";
const NOW = Date.parse("2026-10-01T10:00:00Z");
const item = (id: string, title: string, start: string, extra = "") => `<item><title>${title}</title><guid isPermaLink="false">${id}</guid>
<link>https://holistisk.org/events/#!event/${id}</link><media:content medium="image" url="https://d1tif55lvfk8gc.cloudfront.net/${id}.jpg" />
<category>Yoga &#x26; Meditation</category><content:encoded><![CDATA[${extra}<p>Kom som du er.</p>]]></content:encoded>
<ev:startdate>${start}</ev:startdate><ev:enddate>${start.replace("T19", "T21")}</ev:enddate><ev:location>Hjerterum</ev:location></item>`;
const rss = (...items: string[]) => `<?xml version="1.0"?><rss><channel>${items.join("")}</channel></rss>`;

function feed(full: string, coming: string) {
  const calls: string[] = [];
  const fetcher: typeof fetch = async input => { const url = String(input); calls.push(url); return new Response(url.includes("sdp=1") ? full : coming); };
  return { calls, fetcher };
}

describe("Hjerterum's events in the cockpit", () => {
  const history = [item("a1", "Lydhealing med gongs", "2023-03-02T19:00:00+01:00", "<h3>Underviser:&nbsp;Michael Rahbek Thomsen<br /></h3>"),
    item("a2", "Yin yoga", "2024-05-06T19:00:00+02:00"), item("a3", "Medlemscafé", "2026-10-08T19:00:00+02:00"), item("a4", "Kakaoceremoni", "2026-10-20T19:00:00+02:00")];

  it("keeps every event since 2019, writes only what changed, and marks a coming event that left the calendar", async () => {
    const db = testDatabase();
    const { fetcher } = feed(rss(...history), rss(history[2]!));
    expect(await syncHouseEvents(db, deps(fetcher, NOW), true)).toEqual({ seen: 4, written: 4, left: 0 });
    expect(await syncHouseEvents(db, deps(fetcher, NOW), true)).toEqual({ seen: 4, written: 0, left: 0 });
    const found = await searchEvents(db, "lydhealing");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ title: "Lydhealing med gongs", host: "Michael Rahbek Thomsen", category: "Yoga & Meditation", starts_at_ms: Date.parse("2023-03-02T18:00:00Z") });
    expect((await searchEvents(db, "Michael")).map(e => e.id)).toEqual(["a1"]);
    expect((await searchEvents(db, "", { year: 2024 })).map(e => e.id)).toEqual(["a2"]);
    // The coming calendar no longer has the cocoa ceremony: it was taken off.
    await syncHouseEvents(db, deps(fetcher, NOW), false);
    expect(await db.prepare("SELECT id FROM house_events WHERE removed_at_ms IS NOT NULL").all()).toMatchObject({ results: [{ id: "a4" }] });
  });

  it("reads the whole history every quarter until it is in, then once a day, and the coming events hourly", async () => {
    const db = testDatabase();
    const env = sagaEnv(db);
    const { calls, fetcher } = feed(rss(...history), rss(history[2]!));
    await runEventSync(env, deps(fetcher, NOW));
    await runEventSync(env, deps(fetcher, NOW + 60_000));
    await runEventSync(env, deps(fetcher, NOW + 16 * 60_000));
    await runEventSync(env, deps(fetcher, NOW + 61 * 60_000));
    await runEventSync(env, deps(fetcher, NOW + 25 * 3_600_000));
    expect(calls.map(url => url.includes("sdp=1") ? "full" : "coming")).toEqual(["full", "coming", "coming", "full"]);
  });

  it("shows coming events, the years and a search, and lets Saga answer from the archive", async () => {
    const db = testDatabase();
    const { fetcher } = feed(rss(...history), rss(history[2]!));
    await syncHouseEvents(db, deps(fetcher, NOW), true);
    let seen = "";
    const ai = fakeServices({ ai: (system, user) => { seen = `${system}\\n${user}`; return "Sidst 2. marts 2023."; } });
    const both: typeof fetch = (input, init) => String(input).includes("membershipworks") ? fetcher(input, init) : ai.fetcher(input, init);
    const env = sagaEnv(db, { COCKPIT_PASSWORD: "hjerte-2026" });
    const call = (path: string, init: RequestInit = {}, cookie = "") => handleCockpitRequest(new Request(ORIGIN + path, { ...init, headers: { ...(init.method === "POST" ? { origin: ORIGIN } : {}), cookie, ...(init.headers ?? {}) } }), env, deps(both, NOW));
    const login = new FormData(); login.append("password", "hjerte-2026");
    const session = ((await call("/cockpit/login", { method: "POST", body: login })).headers.get("set-cookie") ?? "").split(";")[0]!;
    const page = await (await call("/cockpit/arrangementer", {}, session)).text();
    for (const text of ["Arrangementer", "Medlemscafé", 'src="https://d1tif55lvfk8gc.cloudfront.net/a3.jpg"', "Arrangementer pr. år", "Michael Rahbek Thomsen", "Seneste afholdte", "i alt siden 2023"]) expect(page).toContain(text);
    const search = await (await call("/cockpit/arrangementer?q=yoga&aar=2024", {}, session)).text();
    expect(search).toContain('1 arrangement med "yoga" i 2024');
    const asked = await call("/cockpit/saga", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: "Hvornår havde vi sidst lydhealing?" }) }, session);
    expect(asked.status).toBe(200);
    expect(seen).toContain("FUNDET I ARKIVET (lydhealing");
    expect(seen).toContain("Lydhealing med gongs (Michael Rahbek Thomsen)");
    expect(seen).toContain("Pr. år: 2023: 1, 2024: 1, 2026: 2");
    expect(seen).toContain("Medlemscafé");
  });
});
