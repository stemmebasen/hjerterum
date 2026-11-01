import { describe, expect, it } from "vitest";
import { dateLabel, getIssue, isoWeek, listTitle, monthEvents, monthStart, newsletterHtml, readDraft, sendTime, subjectOf, type NewsletterEvent } from "./newsletter.js";
import { runNewsletterJob } from "./newsletter-send.js";
import { deps, fakeServices, sagaEnv, testDatabase } from "./saga/test-support.js";
import type { D1Database } from "./db.js";

// Requested: "this is how the newsletter should be designed and compiled each month, sent out on the first" - the November mail as the model.

const at = (iso: string) => Date.parse(iso);
async function seed(db: D1Database) {
  const add = (id: string, title: string, iso: string, host: string | null, category: string, description: string, image = `https://d1tif55lvfk8gc.cloudfront.net/${id}.jpg`) =>
    db.prepare(`INSERT INTO house_events (id, title, starts_at_ms, ends_at_ms, location, host, category, link, image_url, description, content_hash, updated_at_ms)
      VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 'x', 0)`).bind(id, title, at(iso), at(iso) + 7_200_000, host, category, `https://holistisk.org/events/#!event/${id}`, image, description).run();
  await add("SF000000000000000000000001", "Honestbodytalk Practitioner Uddannelsen", "2026-12-01T08:00:00Z", "Søren Malmstrøm", "Kurser & Forløb", "Uddannelse.");
  await add("SF000000000000000000000002", "Dhyana Yoga", "2026-12-01T09:30:00Z", "Kasper Frausing", "Yoga & Meditation", "En del af Hjerterum Mornings.");
  await add("SF000000000000000000000003", "Introduktion til Guidekontakt – Prøv dine evner af.", "2026-12-06T09:00:00Z", "Rie Jespersen", "Events & Workshops", "Ingen erfaring nødvendig.");
  await add("SF000000000000000000000004", "Kvindecirkel på Hjerteland", "2026-12-06T11:00:00Z", "Aurora", "Hjerteland (8200 Lisbjerg)", "Hos partneren.");
  await add("SF000000000000000000000005", "Mediterende Yoga  |  Onsdage 16-17.20", "2026-12-30T15:00:00Z", "Meditating Yoga", "Yoga & Meditation", "Hver onsdag.");
}

describe("the monthly newsletter", () => {
  it("speaks Danish time: the month's first moment, the send time, the list's dates and weeks", () => {
    expect(new Date(monthStart("2026-12")).toISOString()).toBe("2026-11-30T23:00:00.000Z");
    expect(new Date(monthStart("2027-07")).toISOString()).toBe("2027-06-30T22:00:00.000Z");
    expect(new Date(sendTime("2026-12")).toISOString()).toBe("2026-12-01T18:00:00.000Z");
    expect(dateLabel(at("2026-11-01T08:00:00Z"))).toBe("SØN. 1/11 · 9.00");
    expect(dateLabel(at("2026-11-03T09:30:00Z"))).toBe("TIRS. 3/11 · 10.30");
    expect(isoWeek(at("2026-11-01T08:00:00Z"))).toBe(44);
    expect(isoWeek(at("2026-11-02T08:00:00Z"))).toBe(45);
  });

  it("lists the house's events of the month - not the partner houses' - and marks Mornings", async () => {
    const db = testDatabase(); await seed(db);
    const events = await monthEvents(db, "2026-12");
    expect(events.map(e => e.title)).not.toContain("Kvindecirkel på Hjerteland");
    expect(events).toHaveLength(4);
    expect(events.find(e => e.title === "Dhyana Yoga")!.mornings).toBe(true);
    expect(events[0]!.link).toBe("https://www.hjerterum.info/events/000000000000000000000001");
    expect(listTitle("Mediterende Yoga  |  Onsdage 16-17.20")).toBe("Mediterende Yoga");
    expect(listTitle("Source Breathwork (Rebirthing) with Douglas Crawford")).toBe("Source Breathwork med Douglas Crawford");
    expect(listTitle("Hjerterum Medlemscafé ☕️")).toBe("Medlemscafé ☕️");
  });

  it("reads Saga's draft: highlights with links to the events, short titles, and nothing made up", () => {
    const e = (key: string, title: string): NewsletterEvent => ({ key, title, startsMs: 0, endsMs: null, host: null, category: null, imageUrl: `https://img/${key}`, link: `https://www.hjerterum.info/events/${key}`, description: "", mornings: false });
    const refs = new Map([["E1", e("a", "Introduktion til Guidekontakt")], ["E2", e("b", "Shamanismens rødder")]]);
    const draft = readDraft(JSON.stringify({ emneord: "Guidekontakt og shamanisme.", intro: "Her er decembers overblik.\n\nVi glæder os til at se dig.",
      fremhaevet: [{ overskrift: "Guidekontakt med Rie Jespersen", linje: "Rie Jespersen · 6/12", tekst: "Prøv dine evner af i [Introduktion til Guidekontakt](E1) og [noget](E9).", billede: "E1", events: ["E1", "E2"] }],
      titler: { E1: "Introduktion til Guidekontakt med Rie Jespersen", E7: "findes ikke" } }), refs)!;
    expect(draft.words).toBe("Guidekontakt og shamanisme");
    expect(draft.highlights[0]!.text).toBe("Prøv dine evner af i [Introduktion til Guidekontakt](https://www.hjerterum.info/events/a) og noget.");
    expect(draft.highlights[0]!.image).toBe("https://img/a");
    expect(draft.titles).toEqual({ a: "Introduktion til Guidekontakt med Rie Jespersen" });
    expect(subjectOf("2026-12", draft.words)).toBe("December i Hjerterum: Guidekontakt og shamanisme 🤍");
  });

  it("draws the mail like the November one: header, greeting, highlights, the month week by week, button, Mornings and footer", async () => {
    const db = testDatabase(); await seed(db);
    const events = await monthEvents(db, "2026-12");
    const mail = newsletterHtml({ month: "2026-12", subject: "December i Hjerterum 🤍", preheader: "Her er decembers overblik.", intro: "Her er decembers overblik.\n\nVi glæder os til at se dig.",
      highlights: [{ heading: "Guidekontakt med Rie Jespersen", byline: "Rie Jespersen · 6/12", text: "Prøv [Introduktion til Guidekontakt](https://www.hjerterum.info/events/x).", image: "https://img/a", link: "https://www.hjerterum.info/events/x" }],
      titles: { [events[2]!.key]: "Introduktion til Guidekontakt med Rie Jespersen" } }, events);
    for (const part of ["December", "i Hjerterum", "MÅNEDENS EVENTS", "Kære ven af Hjerterum", "Kærlig hilsen<br>Hjerterum", "*|UPDATE_PROFILE|*", "Fremhævet i December",
      "Rie Jespersen · 6/12", '<em>Introduktion til Guidekontakt</em>', "Læs mere her →", "Resten af December", "UGE 49", "UGE 53", "TIRS. 1/12 · 9.00",
      "Introduktion til Guidekontakt med Rie Jespersen", "· Mornings", "Mediterende Yoga<", "Se alle events her", "nyhedsbrev-mornings.jpg", "*|UNSUB|*", "hjerterum-ordmaerke.png"]) expect(mail).toContain(part);
    expect(mail).not.toContain("Hjerteland");
  });

  it("drafts next month's issue from the 20th, tells the board - and sends only an approved issue, on the 1st at 19.00", async () => {
    const db = testDatabase(); await seed(db);
    const answer = JSON.stringify({ emneord: "Guidekontakt", intro: "Her er decembers overblik.\n\nVi glæder os.", fremhaevet: [{ overskrift: "Guidekontakt", linje: "Rie Jespersen · 6/12", tekst: "Kom og prøv [det](E3).", billede: "E3", events: ["E3"] }], titler: {} });
    const services = fakeServices({ ai: () => answer });
    const sent: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (!url.includes("api.mailchimp.com")) return services.fetcher(input, init);
      sent.push(`${init?.method ?? "GET"} ${url.replace(/^https:\/\/us6\.api\.mailchimp\.com\/3\.0/, "")}`);
      const reply = (data: unknown) => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
      if (url.endsWith("/interest-categories?count=100")) return reply({ categories: [{ id: "cat1", title: "Hvad vil du have?" }] });
      if (url.includes("/interest-categories/cat1/interests")) return reply({ interests: [{ id: "int9", name: "Månedens events" }] });
      if (url.endsWith("/lists/0070dc72a9")) return reply({ campaign_defaults: { from_name: "Hjerterum", from_email: "hjerterum@holistisk.org" } });
      if (url.endsWith("/campaigns")) return reply({ id: "camp1" });
      return reply({});
    };
    const env = { ...sagaEnv(db), MAILCHIMP_API_KEY: "abc-us6" };
    // The 19th: nothing yet.
    await runNewsletterJob(env, deps(fetcher, at("2026-11-19T10:00:00Z")));
    expect(await getIssue(db, "2026-12")).toBeNull();
    // The 20th: the draft, and a word to the board.
    await runNewsletterJob(env, deps(fetcher, at("2026-11-20T10:00:00Z")));
    const issue = (await getIssue(db, "2026-12"))!;
    expect(issue.status).toBe("draft");
    expect(issue.subject).toBe("December i Hjerterum: Guidekontakt 🤍");
    expect(JSON.stringify(services.telegram("sendMessage").map(c => c.body))).toContain("Nyhedsbrevet for december er klar til gennemsyn");
    // The 1st at 19.00 - but not approved: nothing is sent.
    await runNewsletterJob(env, deps(fetcher, at("2026-12-01T18:05:00Z")));
    expect(sent).toEqual([]);
    // Approved; before 19.00 it waits, after it goes - once.
    await db.prepare("UPDATE newsletter_issues SET status = 'approved', approved_by = 'Gitta', approved_at_ms = ? WHERE month = '2026-12'").bind(at("2026-11-25T10:00:00Z")).run();
    await runNewsletterJob(env, deps(fetcher, at("2026-12-01T17:55:00Z")));
    expect(sent).toEqual([]);
    await runNewsletterJob(env, deps(fetcher, at("2026-12-01T18:05:00Z")));
    await runNewsletterJob(env, deps(fetcher, at("2026-12-01T18:10:00Z")));
    expect(sent.filter(s => s.startsWith("POST /campaigns"))).toEqual(["POST /campaigns", "POST /campaigns/camp1/actions/send"]);
    expect(sent).toContain("PUT /campaigns/camp1/content");
    const done = (await getIssue(db, "2026-12"))!;
    expect(done.status).toBe("sent");
    expect(done.campaign_id).toBe("camp1");
  });
});
