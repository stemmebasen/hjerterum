import { describe, expect, it } from "vitest";
import { archivePage, decisionsPage, fold, meetingsPage, SHOWN, type PastMeeting } from "./page.js";
import { postPage } from "./enquiries.js";
import { translateHtml } from "./i18n.js";
import type { Decision, Meeting } from "./data.js";

// Requested: "Vi skal også benytte samfoldede afsnit på siden generelt, ellers blive det for voldsomt" - on Møder: "Indram punkterne så de er klart adskilt fra møde-overskrift og underopskrift",
// "Lad der kun blive vist fem punkter og sæt en knap: Klik her for detaljer", "Holdte møder skal kun være de seneste 5, herefter: Klik her for at se alle møder, og resten foldes ud";
// "Lav lignende oprydning på /beslutninger" and "samt på de resterende".
const BASE = "/cockpit";
const meetingOf = (id: number, agenda: string[]): Meeting => ({ id, meeting_date: "2026-10-15", start_time: "13:30", place: "Hjerterum", agenda: agenda.join("\n"), agenda_saga: agenda.slice(0, 2).join("\n"), updated_at_ms: 1, updated_by: null, kind: "team" });
const points = (n: number) => Array.from({ length: n }, (_, i) => `Punkt ${i + 1}`);
const past = (n: number): PastMeeting[] => Array.from({ length: n }, (_, i) => ({ date: `2026-09-${String(28 - i).padStart(2, "0")}`, meeting: null, minutes: null, state: null, inDocument: false }));
const meetings = (upcoming: Meeting[], held: PastMeeting[]) => meetingsPage(BASE, { members: [], upcoming, past: held, found: [], suggestion: [], prefill: { date: "", kind: "" }, today: "2026-10-07", who: "Jacob Hauge", notice: "", uploads: false });
const inside = (html: string, tag: string) => [...html.matchAll(new RegExp(`<${tag}[ >][^]*?</${tag}>`, "g"))].map(m => m[0]);

describe("folded sections", () => {
  it("frames the points of a meeting, shows five and folds the rest under 'Klik her for detaljer'", () => {
    const page = meetings([meetingOf(1, points(8))], []);
    const box = /<div class="agenda-box">[^]*?<\/details><\/div>/.exec(page)?.[0] ?? "";
    expect(box).toContain('<ol class="agenda">');
    const [open, rest] = box.split('<details class="fold">') as [string, string];
    expect(open.match(/<li>/g)).toHaveLength(SHOWN);
    expect(open).toContain("Punkt 5");
    expect(open).not.toContain("Punkt 6");
    // The rest is numbered on from six, behind a button that says how many.
    expect(rest).toContain('<ol class="agenda" start="6">');
    expect(rest.match(/<li>/g)).toHaveLength(3);
    expect(rest).toContain('<span class="fold-more">Klik her for detaljer</span>');
    expect(rest).toContain('<span class="pill">3</span>');
    // Saga's marks follow the points into the fold - and five or fewer needs no button.
    expect(box).toContain("Sagas forslag");
    const few = meetings([meetingOf(2, points(5))], []);
    expect(few).toContain('<div class="agenda-box">');
    expect(few).not.toContain("Klik her for detaljer");
  });

  it("shows the five latest held meetings and folds the rest under 'Klik her for at se alle møder'", () => {
    const page = meetings([], past(9));
    const section = page.slice(page.indexOf("<h2>Holdte møder</h2>"), page.indexOf("</main>"));
    const [open, rest] = section.split('<details class="fold">') as [string, string];
    expect(open.match(/<tr><td data-label="Dato">/g)).toHaveLength(SHOWN);
    expect(open).toContain("28. sep");
    expect(rest).toContain("Klik her for at se alle møder");
    expect(rest.match(/<tr><td data-label="Dato">/g)).toHaveLength(4);
    // Each table keeps its own header row (the phone layout hides the first row of every table).
    expect(rest).toContain("<tr><th>Dato</th><th>Dagsorden</th><th>Referat</th></tr>");
    expect(meetings([], past(5))).not.toContain("Klik her for at se alle møder");
    expect(meetings([], [])).toContain("Ingen holdte møder endnu.");
  });

  it("shows the five latest decisions and agreements, folds the older ones, and lets a search open them", () => {
    const make = (kind: "beslutning" | "aftale", n: number): Decision[] => Array.from({ length: n }, (_, i) => ({ text: `${kind} ${i + 1}`, date: `2026-09-${String(28 - i).padStart(2, "0")}`, topic: "", source: "referat", minutesId: 1, kind }));
    const page = decisionsPage(BASE, [...make("beslutning", 8), ...make("aftale", 7)], "Jacob Hauge");
    const list = page.slice(page.indexOf('<table id="list"'), page.indexOf('id="aftaler"'));
    expect(list.match(/<tr><td data-label="Dato">/g)).toHaveLength(8);
    expect(list.indexOf("Klik her for at se alle beslutninger")).toBeGreaterThan(list.indexOf("beslutning 5"));
    expect(list.slice(0, list.indexOf('<details class="fold">')).match(/<tr><td data-label="Dato">/g)).toHaveLength(SHOWN);
    expect(list).toContain('<table id="list-rest"');
    const agreements = page.slice(page.indexOf('id="aftaler"'));
    expect(agreements).toContain("Klik her for at se alle aftaler");
    expect(agreements).toContain('<table id="agreements-rest"');
    // A search shows what matches among all of them: it opens the folds.
    expect(page).toContain('document.querySelectorAll("main details.fold").forEach(d=>{d.open=true})');
    expect(page).toContain('document.querySelectorAll("table.decisions tr")');
    // Five or fewer: no fold.
    const few = decisionsPage(BASE, make("beslutning", 4), "Jacob Hauge");
    expect(few).not.toContain("Klik her for at se alle beslutninger");
  });

  it("folds the inbox of Posthus and the minutes of Arkiv after five", () => {
    const mails = Array.from({ length: 8 }, (_, i) => ({ id: i, sender: `A${i} <a${i}@example.com>`, subject: `Mail ${i + 1}`, received_at_ms: 1_700_000_000_000 - i, preview: "x", enquiry_kind: null, handled_at_ms: null }));
    const post = postPage(BASE, { who: "Jacob Hauge", open: [], handled: [], unscanned: 0, notice: "", canScan: false, inbox: mails, inboxTotal: 8, all: true, watch: "", watchOk: true, nowMs: 1_700_000_100_000, mailbox: null });
    const inbox = post.slice(post.indexOf("<h2>Indbakke"));
    expect(inbox.slice(0, inbox.indexOf('<details class="fold">')).match(/<li><details>/g)).toHaveLength(SHOWN);
    expect(inbox).toContain("Klik her for at se flere mails");
    const minutes = Array.from({ length: 7 }, (_, i) => ({ id: i + 1, source: "telegram", meeting_date: `2026-09-${String(20 - i).padStart(2, "0")}`, draft_markdown: "x", drive_document_url: null, created_at_ms: 1, updated_at_ms: 1 })) as never;
    const archive = archivePage(BASE, { minutes, history: Array.from({ length: 6 }, (_, i) => ({ day: `2026-08-${String(20 - i).padStart(2, "0")}`, label: "", text: "t" })), docUrl: null, docError: null, who: "Jacob Hauge" });
    expect(archive).toContain("Klik her for at se alle referater");
    expect(archive).toContain("Klik her for at se alle tidligere referater");
    expect(archive.match(/<details class="fold">/g)).toHaveLength(2);
  });

  // Requested: "Record a meeting and Plan a meeting should be quite folded when you enter the page, and bring them up right next to each other vertically."
  it("keeps 'Planlæg et møde' and 'Optag et møde' folded when you enter Møder, one right under the other", () => {
    const page = meetings([], past(2));
    expect(page).toContain('<details class="card foldcard" id="nyt"><summary><h2>Planlæg et møde</h2></summary>');
    expect(page).toContain('<details class="card foldcard" id="upload"><summary><h2>Optag et møde</h2></summary>');
    expect(page).not.toMatch(/id="(?:nyt|upload)" open/);
    // Next to each other at the top: the plan card, the record card, the note - and only then the held meetings.
    const at = (text: string) => page.indexOf(text);
    expect(at('id="nyt"')).toBeLessThan(at('id="upload"'));
    expect(at('id="upload"')).toBeLessThan(at('class="notice info-note"'));
    expect(at('class="notice info-note"')).toBeLessThan(at("<h2>Holdte møder</h2>"));
    expect(page.slice(at('id="nyt"'), at('id="upload"'))).not.toContain("<h2>Holdte møder</h2>");
    // A link to #nyt or #upload (the front page, "Sæt i kalenderen") opens the card.
    expect(page).toContain('if(h&&h.tagName==="DETAILS"){h.open=true;h.scrollIntoView()}');
    // A date or kind in the link (from "Sæt i kalenderen") opens the plan card at once.
    const prefilled = meetingsPage(BASE, { members: [], upcoming: [], past: [], found: [], suggestion: [], prefill: { date: "2026-10-20", kind: "team" }, today: "2026-10-07", who: "Jacob Hauge", notice: "", uploads: false });
    expect(prefilled).toContain('id="nyt" open');
    expect(prefilled).not.toContain('id="upload" open');
    const en = translateHtml(page);
    expect(en).toContain("<h2>Plan a meeting</h2>");
    expect(en).toContain("<h2>Record a meeting</h2>");
  });

  it("has the buttons in English", () => {
    const en = translateHtml(fold("Klik her for detaljer", "Skjul detaljer", "<p>x</p>", 3) + fold("Klik her for at se alle møder", "Skjul de ældre møder", "<p>y</p>", 4)
      + fold("Klik her for at se alle beslutninger", "Skjul de ældre beslutninger", "<p>z</p>", 5));
    for (const text of ["Click here for details", "Hide details", "Click here to see all meetings", "Hide the older meetings", "Click here to see all decisions", "Hide the older decisions"]) expect(en).toContain(text);
    expect(inside(en, "summary")).toHaveLength(3);
  });
});
