import { describe, expect, it } from "vitest";
import { prCalendarSection } from "./prCalendar.js";
import type { SocialPost } from "../social/social.js";

// Asked (the chair, 6 Nov 2026): "Kan der være en streg der markerede tidspunktet" and "Og et lille link til det publicerede opslag hvis muligt".
const NOW = Date.parse("2026-11-06T13:00:00Z"); // 14.00 in Aarhus
const post = (id: number, at: string, extra: Partial<SocialPost> = {}): SocialPost => ({ id, kind: "event", source_key: `e${id}`, week: "2026-W45", channels: ["facebook"], text: "x", link: null, images: [],
  source: { title: `Event ${id}`, startsMs: NOW + 5 * 86_400_000 }, publish_at_ms: Date.parse(at), status: "approved", approved_by: null, approved_at_ms: null, published: {}, published_at_ms: null, error: null,
  created_at_ms: 0, updated_at_ms: 0, ...extra } as SocialPost);

describe("the PR calendar's now and its links", () => {
  it("draws a line for now between today's posts, and links each published post", () => {
    const html = prCalendarSection("", { mondays: ["2026-11-02"], nowMs: NOW, instagram: true, posts: [
      post(1, "2026-11-06T11:00:00Z", { status: "published", channels: ["facebook", "instagram"], published: { facebook: "755_1", facebook_link: "https://www.facebook.com/hjerterum/posts/1", instagram: "ig1", instagram_link: "https://www.instagram.com/p/ABC/" } }),
      post(2, "2026-11-06T18:30:00Z"),
      post(3, "2026-11-05T11:00:00Z", { status: "published", published: { facebook: "755_3" } }),
    ] });
    const today = html.split('id="dag-2026-11-06"')[1]!.split('class="cal-day')[0]!;
    expect(today.indexOf('class="cal-now"')).toBeGreaterThan(today.indexOf("Event 1"));
    expect(today.indexOf('class="cal-now"')).toBeLessThan(today.indexOf("Event 2"));
    expect(today).toContain("Nu 14.00");
    expect(today).toContain('href="https://www.facebook.com/hjerterum/posts/1"');
    expect(today).toContain('href="https://www.instagram.com/p/ABC/"');
    // An older post without its link: Facebook's address by the post's id.
    expect(html).toContain('href="https://www.facebook.com/755_3"');
    // "Kan jeg holde mus over et event i kalenderen for at se opslaget/opslagene?"
    expect(today).toContain('class="cal-peek"');
    // Only today has the line.
    expect(html.match(/class="cal-now"/g)).toHaveLength(1);
  });
});
