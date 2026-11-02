import { describe, expect, it } from "vitest";
import { md5 } from "./md5.js";
import { handleNewsletterSignup } from "./newsletter-subscribe.js";
import { NEWSLETTER_HONEYPOT } from "../site/pages.js";

describe("the website's newsletter form", () => {
  it("names a Mailchimp member by the MD5 of the e-mail", () => {
    expect(md5("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5("The quick brown fox jumps over the lazy dog")).toBe("9e107d9d372bb6826bd81d3542a419d6");
    expect(md5("anne@example.dk")).toHaveLength(32);
  });

  // Douglas' notes: "Does newsletter addresses go to Mailchimp?" - yes, now with "Månedens events" ticked.
  it("signs up into the audience with Månedens events ticked, a new address waiting for its confirmation", async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.endsWith("/interest-categories?count=100")) return new Response(JSON.stringify({ categories: [{ id: "cat1", title: "Interesser" }] }));
      if (url.includes("/interest-categories/cat1/interests")) return new Response(JSON.stringify({ interests: [{ id: "int9", name: "Månedens events" }] }));
      return new Response(JSON.stringify({ id: "m" }));
    };
    const post = (body: unknown, env: Record<string, string> = { MAILCHIMP_API_KEY: "abc-us6" }) => handleNewsletterSignup(new Request("https://www.hjerterum.info/api/nyhedsbrev", {
      method: "POST", headers: { origin: "https://www.hjerterum.info" }, body: JSON.stringify(body) }), env as never, { fetcher, now: () => 0 });
    expect((await post({ name: "Anne", email: " Anne@Example.dk " })).status).toBe(200);
    const put = calls.find(c => c.method === "PUT")!;
    expect(put.url).toBe(`https://us6.api.mailchimp.com/3.0/lists/0070dc72a9/members/${md5("anne@example.dk")}`);
    expect(put.body).toEqual({ email_address: "anne@example.dk", status_if_new: "pending", interests: { int9: true }, merge_fields: { FNAME: "Anne" } });
    // Not connected: the page uses Mailchimp's own form. A robot is thanked and nothing is sent. A wrong address is refused.
    expect((await post({ email: "a@b.dk" }, {})).status).toBe(503);
    calls.length = 0;
    expect((await post({ email: "a@b.dk", [NEWSLETTER_HONEYPOT]: "x" })).status).toBe(200);
    expect(calls).toHaveLength(0);
    expect((await post({ email: "nope" })).status).toBe(400);
  });
});
