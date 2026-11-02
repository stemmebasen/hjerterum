import { describe, expect, it } from "vitest";
import config from "./config-entry.js";
import { eventMeta, withEventMeta } from "./event-meta.js";
import { sagaEnv, testDatabase } from "./saga/test-support.js";

// Reported: "Dette deles når man vil dele et event - det skal handle om eventet og det skal være meget mere spændende med billede og beskrivelse".
const INDEX = `<!doctype html><html lang="da"><head><meta name="description" content="Hjerterum i Aarhus" /><title>Hjerterum</title>
<!-- og:start -->\n<meta property="og:title" content="Hjerterum" />\n<!-- og:end --></head><body><div id="root"></div></body></html>`;

describe("a shared event page", () => {
  it("carries the event's title, picture, time and words for Facebook", async () => {
    const db = testDatabase();
    const id = Number((await db.prepare(`INSERT INTO room_bookings (clerk_user_id, teacher_name, teacher_email, title, description, starts_at_ms, ends_at_ms, review_status, status, created_at_ms, updated_at_ms)
      VALUES ('t', 'Anna Ananda', 'a@x.dk', 'Lydbad med "gongs"', 'En rolig aften med gongs og krystalskåle.', ?, ?, 'approved', 'scheduled', 1, 1)`).bind(Date.parse("2026-11-20T18:00:00Z"), Date.parse("2026-11-20T20:00:00Z")).run()).meta!.last_row_id);
    const meta = (await eventMeta(db, `h${id}`, fetch, 0))!;
    expect(meta).toEqual({ title: 'Lydbad med "gongs"', url: `https://www.hjerterum.info/events/h${id}`, image: "https://www.hjerterum.info/media/hjerterum-deling.jpg",
      description: "Fredag den 20. november kl. 19.00 i Hjerterum, Aarhus · med Anna Ananda. En rolig aften med gongs og krystalskåle." });
    const html = withEventMeta(INDEX, meta);
    expect(html).toContain("<title>Lydbad med &quot;gongs&quot; · Hjerterum</title>");
    expect(html).toContain('<meta property="og:title" content="Lydbad med &quot;gongs&quot;" />');
    expect(html).toContain('<meta property="og:image" content="https://www.hjerterum.info/media/hjerterum-deling.jpg" />');
    expect(html).toContain(`<meta property="og:url" content="https://www.hjerterum.info/events/h${id}" />`);
    expect(html).not.toContain('content="Hjerterum" />\n<!-- og:end');
    expect(html.match(/og:title/g)).toHaveLength(1);

    // Served so by the worker, around the app's own page.
    const env = { ...sagaEnv(db), ASSETS: { fetch: async () => new Response(INDEX, { headers: { "content-type": "text/html; charset=utf-8" } }) } } as never;
    const page = await (await config.fetch(new Request(`https://www.hjerterum.info/events/h${id}`), env)).text();
    expect(page).toContain('og:description" content="Fredag den 20. november kl. 19.00 i Hjerterum');
    // An event that is not there: the app's page as it is.
    expect(await (await config.fetch(new Request("https://www.hjerterum.info/events/h999999"), env)).text()).toBe(INDEX);
  });
});
