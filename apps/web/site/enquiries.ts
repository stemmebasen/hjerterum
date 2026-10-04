/** Requested: "Hjerterum skal dog have flere henvendelsesformularer ligesom på stemmebasen.dk" - "Her skal vi i hvert
 * fald have: Henvendelse vedr. opsætning af event, … deltagelse i et event, … medlemsskab, … samarbejde, … økonomi og
 * fakturering, Generel henvendelse". One form (src/enquiry-form.tsx) placed where each question arises - a page's text
 * says "{{enquiry-<topic>}}" - and the topic can be changed in the form. The worker lays each enquiry in team@'s inbox
 * (worker/enquiries.ts), and the statistics count it. */

export type EnquiryTopic = "event-opsaetning" | "event-deltagelse" | "medlemskab" | "samarbejde" | "oekonomi" | "generel";
type Text = { da: string; en: string };

export const ENQUIRY_TOPICS: Array<{ key: EnquiryTopic; label: Text; detail?: Text }> = [
  { key: "event-opsaetning", label: { da: "Henvendelse vedr. opsætning af event", en: "Setting up an event" },
    detail: { da: "Ønsket dato og forventet antal deltagere", en: "Preferred date and expected number of participants" } },
  { key: "event-deltagelse", label: { da: "Henvendelse vedr. deltagelse i et event", en: "Taking part in an event" },
    detail: { da: "Hvilket event?", en: "Which event?" } },
  { key: "medlemskab", label: { da: "Henvendelse vedr. medlemskab", en: "Membership" } },
  { key: "samarbejde", label: { da: "Henvendelse vedr. samarbejde", en: "Collaboration" },
    detail: { da: "Organisation eller virksomhed", en: "Organisation or company" } },
  { key: "oekonomi", label: { da: "Henvendelse vedr. økonomi og fakturering", en: "Finances and invoicing" },
    detail: { da: "Faktura- eller ordrenummer", en: "Invoice or order number" } },
  { key: "generel", label: { da: "Generel henvendelse", en: "General enquiry" } }
];

export const enquiryTopic = (key: string) => ENQUIRY_TOPICS.find(topic => topic.key === key);

/** Where the form posts, and the limits both the form and the worker hold. */
export const ENQUIRY_PATH = "/api/henvendelse";
export const ENQUIRY_LIMITS = { name: 120, email: 200, phone: 40, detail: 200, message: 5000 } as const;
/** A form filled by a person takes a few seconds. */
export const ENQUIRY_MIN_FILL_MS = 3_000;
export const ENQUIRY_HONEYPOT = "website";
