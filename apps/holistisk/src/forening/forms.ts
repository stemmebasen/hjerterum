import { cleanFirstName } from "../flokken/auth.js";
import { fromLocalInput, toLocalInput } from "../flokken/forms.js";
import type { Plan, ProfileFields, SamfolkMember } from "./members.js";
import type { PickFields } from "./store.js";

/** Samfolk's forms: a member's profile (joining and later), a tur, and the letter. */

/** For rows on the interest list from before Samfolk; Samfolk asks no one about age. */
export const AGE_LABELS: Record<string, string> = { "18-29": "18–29 år", "30-39": "30–39 år", "40-49": "40–49 år", "50-59": "50–59 år", "60-69": "60–69 år", "70+": "70 år eller mere" };
export const INTERESTS = ["Musik og koncerter", "Foredrag og debat", "Teater og scenekunst", "Kunst og udstillinger", "Film", "Natur og gåture", "Kreative værksteder", "Dans og bevægelse", "Mad og fællesspisning"] as const;

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i;
export const validEmail = (v: string) => EMAIL.test(v) && v.length <= 160;

export type FormErrors = Record<string, string>;

// ————————————————————————————————————————— The profile

export type ProfileForm = { firstName: string; email: string; interests: string[]; area: string; plan: string; newsletter: boolean; consent: boolean };

export function readProfileForm(data: FormData): ProfileForm {
  const s = (k: string) => String(data.get(k) ?? "").trim();
  return {
    firstName: s("fornavn"), email: s("email"), area: s("omraade"), plan: s("medlemskab"),
    interests: data.getAll("interesser").map(String).filter(v => (INTERESTS as readonly string[]).includes(v)),
    newsletter: s("brev") === "ja", consent: s("samtykke") === "ja"
  };
}

export const emptyProfileForm = (): ProfileForm => ({ firstName: "", email: "", interests: [], area: "", plan: "", newsletter: true, consent: false });

export const profileForm = (m: SamfolkMember, newsletter: boolean): ProfileForm => ({
  firstName: m.first_name, email: m.email ?? "", interests: (m.interests ?? "").split(", ").filter(Boolean), area: m.area ?? "",
  plan: m.plan ?? "", newsletter, consent: true
});

/** Everything is needed: the profile is what lets a member use the site. Consent only when joining. */
export function validateProfileForm(f: ProfileForm, areas: string[], joining: boolean): { errors: FormErrors; fields: ProfileFields | null } {
  const errors: FormErrors = {};
  const name = cleanFirstName(f.firstName);
  if (!name) errors.firstName = "Skriv dit fornavn (højst 30 bogstaver).";
  if (!validEmail(f.email)) errors.email = "Skriv en mailadresse, vi kan skrive til.";
  if (!f.interests.length) errors.interests = "Vælg mindst én ting, du har lyst til at opleve.";
  if (!areas.includes(f.area)) errors.area = "Vælg, hvor du bor.";
  if (f.plan !== "month" && f.plan !== "year") errors.plan = "Vælg medlemskab for en måned eller et år.";
  if (joining && !f.consent) errors.consent = "Sæt kryds, så vi må gemme dine oplysninger.";
  if (Object.keys(errors).length) return { errors, fields: null };
  return { errors, fields: { first_name: name!, email: f.email.toLowerCase(), interests: f.interests.join(", "), area: f.area, plan: f.plan as Plan } };
}

// ————————————————————————————————————————— A tur

export type PickForm = Record<"title" | "start" | "end" | "closes" | "association" | "associationUrl" | "venue" | "address" | "city" | "eventUrl" | "description" | "imageUrl" | "places" | "ownPayment" | "aftermeeting" | "meetingPlace" | "meetingAt" | "programme" | "status", string>;

/** Stored as the organiser when a member's tur names none (the column needs a value); never shown. */
export const NO_ORGANISER = "Samfolk-medlem";
/** The organiser of Samfolk's own events, unless another is named. */
export const SAMFOLK = "Foreningen Samfolk";

export function readPickForm(data: FormData): PickForm {
  const s = (k: string) => String(data.get(k) ?? "").trim();
  return {
    title: s("titel"), start: s("start"), end: s("slut"), closes: s("frist"), association: s("forening"), associationUrl: s("forening_url"), venue: s("sted"),
    address: s("adresse"), city: s("by"), eventUrl: s("link"), description: s("beskrivelse"), imageUrl: s("billede"), places: s("pladser"),
    ownPayment: s("egenbetaling"), aftermeeting: s("eftermoede"), meetingPlace: s("moedested"), meetingAt: s("moedetid"), programme: s("program"),
    status: s("status") === "withdrawn" ? "withdrawn" : "approved"
  };
}

export function pickForm(p: PickFields): PickForm {
  return {
    title: p.title, start: toLocalInput(p.starts_at), end: p.ends_at ? toLocalInput(p.ends_at) : "", closes: p.closes_at ? toLocalInput(p.closes_at) : "",
    association: p.association === NO_ORGANISER ? "" : p.association, associationUrl: p.association_url ?? "", venue: p.venue_name ?? "", address: p.address ?? "",
    city: p.city ?? "", eventUrl: p.event_url ?? "", description: p.description ?? "", imageUrl: p.image_url ?? "", places: p.places ? String(p.places) : "",
    ownPayment: p.own_payment ?? "", aftermeeting: p.aftermeeting ?? "", meetingPlace: p.meeting_place ?? "", meetingAt: p.meeting_at ? toLocalInput(p.meeting_at) : "",
    programme: p.programme ?? "", status: p.status
  };
}

export const emptyPickForm = (): PickForm => ({ title: "", start: "", end: "", closes: "", association: "", associationUrl: "", venue: "", address: "", city: "", eventUrl: "", description: "", imageUrl: "", places: "", ownPayment: "", aftermeeting: "", meetingPlace: "", meetingAt: "", programme: "", status: "approved" });

const url = (v: string) => /^https?:\/\/\S+$/i.test(v) && v.length <= 500;

/** `fallbackOrganiser` stands in when no organiser is named: Samfolk for its own events, NO_ORGANISER for a member's. */
export function validatePickForm(f: PickForm, fallbackOrganiser: string, now: number): { errors: FormErrors; fields: PickFields | null } {
  const errors: FormErrors = {};
  if (f.title.length < 2 || f.title.length > 200) errors.title = "Skriv en titel.";
  const start = fromLocalInput(f.start);
  if (start === null) errors.start = "Vælg dato og tidspunkt.";
  else if (start < now) errors.start = "Turen skal ligge ude i fremtiden.";
  const end = f.end ? fromLocalInput(f.end) : null;
  if (f.end && (end === null || (start !== null && end <= start))) errors.end = "Sluttidspunktet skal ligge efter starten.";
  const closes = f.closes ? fromLocalInput(f.closes) : null;
  if (f.closes && (closes === null || (start !== null && closes > start))) errors.closes = "Fristen skal ligge før turen starter.";
  if (f.association && (f.association.length < 2 || f.association.length > 160)) errors.association = "Højst 160 tegn.";
  if (f.associationUrl && !url(f.associationUrl)) errors.associationUrl = "Skriv hele adressen, fx https://arrangoer.dk";
  if (f.eventUrl && !url(f.eventUrl)) errors.eventUrl = "Skriv hele adressen, fx https://…";
  if (f.imageUrl && !/^https:\/\/\S+$/i.test(f.imageUrl)) errors.imageUrl = "Et billede skal have en https-adresse.";
  const places = f.places ? Number(f.places) : null;
  if (places !== null && (!Number.isInteger(places) || places < 1 || places > 200)) errors.places = "Et helt tal mellem 1 og 200.";
  if (f.venue.length > 160) errors.venue = "Højst 160 tegn.";
  if (f.description.length > 4000) errors.description = "Højst 4000 tegn.";
  if (f.ownPayment.length > 120) errors.ownPayment = "Højst 120 tegn.";
  if (f.aftermeeting.length > 200) errors.aftermeeting = "Højst 200 tegn.";
  if (f.meetingPlace.length > 200) errors.meetingPlace = "Højst 200 tegn.";
  const meetingAt = f.meetingAt ? fromLocalInput(f.meetingAt) : null;
  if (f.meetingAt && meetingAt === null) errors.meetingAt = "Vælg dato og tidspunkt.";
  if (f.programme.length > 2000) errors.programme = "Højst 2000 tegn.";
  if (Object.keys(errors).length || start === null) return { errors, fields: null };
  return {
    errors,
    fields: {
      title: f.title, starts_at: start, ends_at: end, venue_name: f.venue || null, address: f.address.slice(0, 200) || null, city: f.city.slice(0, 80) || null,
      association: f.association || fallbackOrganiser, association_url: f.associationUrl || null, event_url: f.eventUrl || null, description: f.description || null,
      image_url: f.imageUrl || null, places, own_payment: f.ownPayment || null, aftermeeting: f.aftermeeting || null, status: f.status === "withdrawn" ? "withdrawn" : "approved",
      meeting_place: f.meetingPlace || null, meeting_at: meetingAt, programme: f.programme || null, closes_at: closes
    }
  };
}
