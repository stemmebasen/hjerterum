import { describe, expect, it } from "vitest";
import { cancelRequestLines, cancelRequestMail, memberCancelRequest } from "./membership-cancel-request.js";
import type { ActiveMembership } from "./membership-access.js";
import { deps, fakeServices, sagaEnv, testDatabase } from "./saga/test-support.js";
import { SITE_PAGES } from "../site/pages.js";

// Requested: "Man skal selv kunne opsige når man er logget ind. Har man brug for hjælp kan man skrive team@hjerterum.info".
const NOW = Date.parse("2026-11-01T10:00:00Z");
const MW: ActiveMembership = { source: "membershipworks", fullName: "Anna Jensen", email: "anna@example.dk", externalId: 4711, membershipLevel: "Standard medlemskab" };

describe("cancelling a membership from the member area", () => {
  it("lays a cancellation in team@'s inbox with what the team needs to end it in MembershipWorks", () => {
    const lines = Object.fromEntries(cancelRequestLines(MW, "Flytter fra Aarhus", NOW));
    expect(lines["E-mail"]).toBe("anna@example.dk");
    expect(lines["Medlemskab"]).toBe("Standard medlemskab (MembershipWorks, medlem nr. 4711)");
    expect(lines["Begrundelse"]).toBe("Flytter fra Aarhus");
    expect(lines["Det skal ske"]).toContain("Afslut medlemskabet og betalingen i MembershipWorks");
    expect(cancelRequestMail(MW, "", NOW).length).toBeGreaterThan(200);
  });

  it("needs a logged-in member", async () => {
    const env = sagaEnv(testDatabase(), {});
    const response = await memberCancelRequest(new Request("https://medlem.hjerterum.info/api/members/me/cancel-request", { method: "POST" }), env, deps(fakeServices().fetcher, NOW));
    expect(response.status).toBe(401);
  });

  it("the site says you cancel yourself when logged in, and that team@hjerterum.info helps - and no expired trial offer", () => {
    const terms = SITE_PAGES.find(p => p.path === "/medlemskab/vilkaar")!.body;
    expect(terms).toContain("Du opsiger selv dit medlemskab, når du er logget ind");
    expect(terms).toContain("team@hjerterum.info");
    const all = SITE_PAGES.map(p => p.body).join("\n");
    expect(all).not.toContain("hjerterum@holistisk.org");
    expect(all).not.toContain("senest den 15. oktober 2026");
    expect(all).not.toContain("by 15 October 2026");
  });
});

// Said: "Opsigelse er løbende måned plus 1" - a card member pays once more after cancelling.
import { noticeEnd } from "./members.js";
describe("the notice when a card member cancels", () => {
  const at = (iso: string) => Date.parse(iso) / 1000;
  it("ends a monthly membership one period after the current one", () => {
    expect(noticeEnd(at("2026-11-14T09:00:00Z"), "month")).toBe(at("2026-12-14T09:00:00Z"));
    expect(noticeEnd(at("2026-12-20T09:00:00Z"), "month")).toBe(at("2027-01-20T09:00:00Z"));
    // A period ending on the 31st: the next month's last day.
    expect(noticeEnd(at("2027-01-31T09:00:00Z"), "month")).toBe(at("2027-02-28T09:00:00Z"));
  });
  it("lets a yearly membership run out its paid year, and leaves an unknown period to Stripe", () => {
    expect(noticeEnd(at("2027-03-01T09:00:00Z"), "year")).toBe(at("2027-03-01T09:00:00Z"));
    expect(noticeEnd(null, "month")).toBeNull();
  });
});
