import { describe, expect, it, vi } from "vitest";
import { guardFetch, isCutOff } from "./closed-ecosystem.js";

// The chair (27 Nov 2026): "alle forbindelser til holistisk og membership works skal klippes så vores nye siden er et helt og lukket økosystem".
describe("the closed ecosystem", () => {
  it("refuses every request to MembershipWorks and holistisk.org, and lets everything else through", async () => {
    const inner = vi.fn(async () => new Response("ok"));
    const guarded = guardFetch(inner as unknown as typeof fetch);
    for (const url of ["https://api.membershipworks.com/v2/events?_op=rss&org=22308", "https://membershipworks.com/admin", "https://holistisk.org/wp-json/wp/v2/pages", "https://www.holistisk.org/"]) {
      expect(isCutOff(url), url).toBe(true);
      expect((await guarded(url)).status, url).toBe(403);
    }
    expect(inner).not.toHaveBeenCalled();
    for (const url of ["https://api.telegram.org/botx/sendMessage", "https://www.hjerterum.info/", "https://holistisk.us6.list-manage.com/subscribe", "https://api.stripe.com/v1/x"]) {
      expect(isCutOff(url), url).toBe(false);
      expect((await guarded(url)).status, url).toBe(200);
    }
    expect((await guarded(new Request("https://holistisk.org/events"))).status).toBe(403);
  });
});
