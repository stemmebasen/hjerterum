import { describe, expect, it } from "vitest";
import { md5 } from "./md5.js";
import { memberNewsletter, queueContact, runMailchimpSync } from "./mailchimp-sync.js";
import { testDatabase } from "./saga/test-support.js";

// Requested: "Jeg vil gerne have at alle modtagere gemmes samlet i vores Mailchimp konto" - "Alt med samtykke i én liste".
function fakeMailchimp() {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const statuses = new Map<string, string>();
  const fetcher: typeof fetch = async (input, init) => {
    const path = String(input).replace("https://us6.api.mailchimp.com/3.0", ""), method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method, path, body });
    if (path.endsWith("/interest-categories?count=100")) return new Response(JSON.stringify({ categories: [{ id: "c1", title: "Nyhedsbreve" }] }));
    if (path.includes("/interest-categories/c1/interests")) return new Response(JSON.stringify({ interests: [{ id: "i1", name: "Månedens events" }] }));
    const hash = /\/members\/([0-9a-f]{32})/.exec(path)?.[1];
    if (method === "GET" && hash) return statuses.has(hash) ? new Response(JSON.stringify({ status: statuses.get(hash) })) : new Response(JSON.stringify({ title: "Resource Not Found" }), { status: 404 });
    if (method === "PATCH" && hash) { statuses.set(hash, body.status); return new Response("{}"); }
    if (method === "PUT" && hash) { if (!statuses.has(hash)) statuses.set(hash, body.status_if_new); return new Response("{}"); }
    return new Response("{}");
  };
  return { calls, statuses, fetcher };
}

describe("one Mailchimp list for everyone who said yes", () => {
  it("carries MembershipWorks members who ticked the newsletter, members and guests into the list, with Medlem on members", async () => {
    const db = testDatabase();
    await db.prepare("INSERT INTO membershipworks_uploads (id, filename, uploaded_by, accounts, uploaded_at_ms) VALUES (1, 'export.csv', 'Jacob', 3, 1)").run();
    const mw = (email: string, json: Record<string, unknown>) => db.prepare("INSERT INTO membershipworks_accounts (email, full_name, row_json, upload_id) VALUES (?, ?, ?, 1)").bind(email, "Anne Holm", JSON.stringify(json)).run();
    await mw("anne@x.dk", { newsletter: true });
    await mw("bo@x.dk", { newsletter: false });
    await mw("old@x.dk", { newsletter: true, cancelled: true });
    await queueContact(db, { email: "Gæst@X.dk ", name: "Gæst", source: "event", member: false, doubleOptIn: true }, 5);
    const mc = fakeMailchimp();
    const env = { DB: db, MAILCHIMP_API_KEY: "k-us6" } as never;
    expect(await runMailchimpSync(env, { fetcher: mc.fetcher, now: () => 10 })).toBe(3);
    const puts = mc.calls.filter(c => c.method === "PUT");
    expect(puts.map(c => c.path)).toEqual(expect.arrayContaining([`/lists/0070dc72a9/members/${md5("anne@x.dk")}`, `/lists/0070dc72a9/members/${md5("old@x.dk")}`, `/lists/0070dc72a9/members/${md5("gæst@x.dk")}`]));
    expect(puts.find(c => c.path.endsWith(md5("anne@x.dk")))!.body).toMatchObject({ status_if_new: "subscribed", interests: { i1: true }, merge_fields: { FNAME: "Anne", LNAME: "Holm" } });
    expect(puts.find(c => c.path.endsWith(md5("gæst@x.dk")))!.body).toMatchObject({ status_if_new: "pending" });
    // Medlem on the member, not on the one whose membership ended or the guest.
    expect(mc.calls.filter(c => c.path.endsWith("/tags")).map(c => c.path)).toEqual([`/lists/0070dc72a9/members/${md5("anne@x.dk")}/tags`]);
    // Sent once: the next run has nothing to do.
    expect(await runMailchimpSync(env, { fetcher: mc.fetcher, now: () => 20 })).toBe(0);
    // Without Mailchimp nothing is sent; the queue waits.
    expect(await runMailchimpSync({ DB: db } as never, { fetcher: mc.fetcher, now: () => 30 })).toBe(0);
  });

  it("lets a member turn Månedens events on and off in Min profil", async () => {
    const db = testDatabase();
    const mc = fakeMailchimp();
    const env = { DB: db, MAILCHIMP_API_KEY: "k-us6" } as never, deps = { fetcher: mc.fetcher, now: () => 1 };
    const me = { email: "Lise@X.dk", name: "Lise Berg" };
    expect(await memberNewsletter(env, deps, me)).toEqual({ subscribed: false });
    expect(await memberNewsletter(env, deps, me, true)).toEqual({ subscribed: true });
    expect(mc.statuses.get(md5("lise@x.dk"))).toBe("subscribed");
    expect(await memberNewsletter(env, deps, me)).toEqual({ subscribed: true });
    expect(await memberNewsletter(env, deps, me, false)).toEqual({ subscribed: false });
    expect(mc.statuses.get(md5("lise@x.dk"))).toBe("unsubscribed");
    expect(await memberNewsletter(env, deps, me)).toEqual({ subscribed: false });
    // On again: Mailchimp asks them to confirm (pending), as it must for one who unsubscribed.
    expect(await memberNewsletter(env, deps, me, true)).toEqual({ subscribed: true });
    expect(mc.statuses.get(md5("lise@x.dk"))).toBe("pending");
  });
});
