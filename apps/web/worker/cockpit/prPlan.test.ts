import { describe, expect, it } from "vitest";
import { testDatabase } from "../saga/test-support.js";
import { prPlanData, prPlanSection, ROADMAP } from "./prPlan.js";
import type { SocialAccount } from "../social/social.js";

// Requested (the chair, 3 Nov 2026): "lav det i cockpittet så klokkeklart hvad planen er og hvad der lige nu kræves af mig, hvad der mangler, hvad der er next".
const NOW = Date.parse("2026-11-21T10:00:00Z"); // a Saturday, after the 20th
const account: SocialAccount = { page_id: "755", page_name: "Hjerterum", page_token_sealed: "x", ig_user_id: "1", ig_username: "hjerterum_aarhus", connected_by: "Jacob Hauge", connected_at_ms: 0, checked_at_ms: null, check_error: null };

describe("the plan at the top of PR og SoMe", () => {
  it("says what the chair must do now, what comes next, and what is missing", async () => {
    const db = testDatabase();
    const post = (kind: string, key: string, status: string, week: string | null, at: number | null) => db.prepare(`INSERT INTO social_posts (kind, source_key, week, channels, text, source, publish_at_ms, status, created_at_ms, updated_at_ms)
      VALUES (?, ?, ?, '["facebook"]', 'x', '{"title":"Dhyana Yoga"}', ?, ?, 0, 0)`).bind(kind, key, week, at, status).run();
    await post("share", "facebook:1", "draft", null, null);
    await post("event", "event:x", "failed", "2026-W47", NOW - 3_600_000);
    await post("week", "week:2026-W48", "draft", "2026-W48", Date.parse("2026-11-23T14:30:00Z"));
    await post("event", "event:y", "approved", "2026-W47", NOW + 3_600_000);
    // Kasper teaches next week and has not shared his PR material.
    await db.prepare(`INSERT INTO house_events (id, title, starts_at_ms, host, content_hash, updated_at_ms) VALUES ('SFa', 'Lydhealing', ?, 'Kasper Holm', 'x', 0)`).bind(NOW + 3 * 86_400_000).run();
    const plan = await prPlanData(db, { ready: true, account, nowMs: NOW });
    const texts = plan.todo.map(t => t.text);
    expect(texts).toEqual(expect.arrayContaining([
      "Ét opslag, Hjerterum er tagget i, venter på dig.",
      "Ét opslag kunne ikke komme ud. Se fejlen, og godkend det igen.",
      "Uge 48: 1 opslag venter på din godkendelse.",
      "Nyhedsbrevet for december er ikke skrevet endnu.",
      expect.stringContaining("har ikke delt PR-materiale: Kasper Holm")
    ]));
    expect(texts.filter(t => t.startsWith("Beslut:"))).toHaveLength(ROADMAP.filter(r => r.status === "venter-paa-dig").length);
    expect(plan.next[0]).toEqual({ at: NOW + 3_600_000, text: "Opslag om Dhyana Yoga går ud" });
    expect(plan.next.map(n => n.text)).toEqual(expect.arrayContaining(["Saga planlægger næste uges opslag", "Nyhedsbrevet Månedens events går ud"]));
    expect(plan.campaign.now?.title).toBe("Årets afslutning og jul");
    expect(plan.campaign.next.title).toBe("Nyt år og medlemskab");
    const html = prPlanSection("", plan);
    for (const heading of ["Det kræver dig lige nu", "Det næste", "Det mangler", "Planen"]) expect(html).toContain(heading);
    expect(html).toContain('href="/pr?uge=2026-11-23#uge"');
  });

  it("starts with connecting, before anything else can run", async () => {
    const db = testDatabase();
    expect((await prPlanData(db, { ready: false, account: null, nowMs: NOW })).todo[0]).toMatchObject({ urgent: true, text: expect.stringContaining("META_APP_ID") });
    expect((await prPlanData(db, { ready: true, account: null, nowMs: NOW })).todo[0]).toMatchObject({ href: "/pr/forbind" });
    expect((await prPlanData(db, { ready: true, account: { ...account, ig_user_id: null }, nowMs: NOW })).todo[0]!.text).toContain("Instagram er ikke koblet");
  });
});
