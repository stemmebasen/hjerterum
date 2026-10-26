import { cleanFirstName } from "../flokken/auth.js";
import { fromLocalInput, toLocalInput } from "../flokken/forms.js";
import type { InterestFields, PickFields } from "./store.js";

/** Flokk's forms: the interest list (public) and an Udflugt (the volunteers'). */

export const AGE_GROUPS = ["18-29", "30-39", "40-49", "50-59", "60-69", "70+"] as const;
export const AGE_LABELS: Record<string, string> = { "18-29": "18–29 år", "30-39": "30–39 år", "40-49": "40–49 år", "50-59": "50–59 år", "60-69": "60–69 år", "70+": "70 år eller mere" };
export const INTERESTS = ["Musik og koncerter", "Foredrag og debat", "Teater og scenekunst", "Kunst og udstillinger", "Film", "Natur og gåture", "Kreative værksteder", "Dans og bevægelse"] as const;

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i;

export type InterestForm = { firstName: string; email: string; ageGroup: string; interests: string[]; area: string; pick: string; withFriend: boolean; consent: boolean };
export type FormErrors = Record<string, string>;

export function readInterestForm(data: FormData): InterestForm {
  const s = (k: string) => String(data.get(k) ?? "").trim();
  return {
    firstName: s("fornavn"), email: s("email"), ageGroup: s("alder"),
    interests: data.getAll("interesser").map(String).filter(v => (INTERESTS as readonly string[]).includes(v)),
    // Every participant is a member; a guest cannot come along, so there is no "friend" choice.
    area: s("omraade"), pick: s("event"), withFriend: false, consent: s("samtykke") === "ja"
  };
}

export const emptyInterestForm = (pick = ""): InterestForm => ({ firstName: "", email: "", ageGroup: "", interests: [], area: "", pick, withFriend: false, consent: false });

export function validateInterestForm(f: InterestForm, areas: string[], picks: string[]): { errors: FormErrors; fields: Omit<InterestFields, "pick_id"> & { pick: string | null } } {
  const errors: FormErrors = {};
  const name = cleanFirstName(f.firstName);
  if (!name) errors.firstName = "Skriv dit fornavn (højst 30 bogstaver).";
  if (!EMAIL.test(f.email) || f.email.length > 160) errors.email = "Skriv en mailadresse, vi kan skrive til.";
  if (f.ageGroup && !(AGE_GROUPS as readonly string[]).includes(f.ageGroup)) errors.ageGroup = "Vælg en aldersgruppe.";
  if (f.area && !areas.includes(f.area)) errors.area = "Vælg et område.";
  if (f.pick && !picks.includes(f.pick)) errors.pick = "Eventet findes ikke længere – vælg et andet.";
  if (!f.consent) errors.consent = "Sæt kryds, så vi må gemme dine oplysninger.";
  return {
    errors,
    fields: {
      first_name: name ?? "", email: f.email.toLowerCase(), age_group: f.ageGroup || null,
      interests: f.interests.length ? f.interests.join(", ") : null, area: f.area || null, pick: f.pick || null, with_friend: f.withFriend ? 1 : 0
    }
  };
}

// ————————————————————————————————————————— An event (the volunteers' form)

export type PickForm = Record<"title" | "start" | "end" | "association" | "associationUrl" | "venue" | "address" | "city" | "eventUrl" | "description" | "imageUrl" | "places" | "ownPayment" | "aftermeeting" | "status", string>;

export function readPickForm(data: FormData): PickForm {
  const s = (k: string) => String(data.get(k) ?? "").trim();
  return {
    title: s("titel"), start: s("start"), end: s("slut"), association: s("forening"), associationUrl: s("forening_url"), venue: s("sted"),
    address: s("adresse"), city: s("by"), eventUrl: s("link"), description: s("beskrivelse"), imageUrl: s("billede"), places: s("pladser"),
    ownPayment: s("egenbetaling"), aftermeeting: s("eftermoede"), status: s("status") === "withdrawn" ? "withdrawn" : "approved"
  };
}

export function pickForm(p: PickFields): PickForm {
  return {
    title: p.title, start: toLocalInput(p.starts_at), end: p.ends_at ? toLocalInput(p.ends_at) : "", association: p.association,
    associationUrl: p.association_url ?? "", venue: p.venue_name ?? "", address: p.address ?? "", city: p.city ?? "", eventUrl: p.event_url ?? "",
    description: p.description ?? "", imageUrl: p.image_url ?? "", places: p.places ? String(p.places) : "", ownPayment: p.own_payment ?? "",
    aftermeeting: p.aftermeeting ?? "", status: p.status
  };
}

export const emptyPickForm = (): PickForm => ({ title: "", start: "", end: "", association: "", associationUrl: "", venue: "", address: "", city: "", eventUrl: "", description: "", imageUrl: "", places: "", ownPayment: "", aftermeeting: "", status: "approved" });

const url = (v: string) => /^https?:\/\/\S+$/i.test(v) && v.length <= 500;

export function validatePickForm(f: PickForm): { errors: FormErrors; fields: PickFields | null } {
  const errors: FormErrors = {};
  if (f.title.length < 2 || f.title.length > 200) errors.title = "Skriv eventets titel.";
  const start = fromLocalInput(f.start);
  if (start === null) errors.start = "Vælg dato og tidspunkt.";
  const end = f.end ? fromLocalInput(f.end) : null;
  if (f.end && (end === null || (start !== null && end <= start))) errors.end = "Sluttidspunktet skal ligge efter starten.";
  if (f.association.length < 2 || f.association.length > 160) errors.association = "Skriv arrangørens navn.";
  if (f.associationUrl && !url(f.associationUrl)) errors.associationUrl = "Skriv hele adressen, fx https://arrangoer.dk";
  if (f.eventUrl && !url(f.eventUrl)) errors.eventUrl = "Skriv hele adressen til eventet.";
  if (f.imageUrl && !/^https:\/\/\S+$/i.test(f.imageUrl)) errors.imageUrl = "Et billede skal have en https-adresse.";
  const places = f.places ? Number(f.places) : null;
  if (places !== null && (!Number.isInteger(places) || places < 1 || places > 200)) errors.places = "Et helt tal mellem 1 og 200.";
  if (f.venue.length > 160) errors.venue = "Højst 160 tegn.";
  if (f.description.length > 4000) errors.description = "Højst 4000 tegn.";
  if (f.ownPayment.length > 120) errors.ownPayment = "Højst 120 tegn.";
  if (f.aftermeeting.length > 200) errors.aftermeeting = "Højst 200 tegn.";
  if (Object.keys(errors).length || start === null) return { errors, fields: null };
  return {
    errors,
    fields: {
      title: f.title, starts_at: start, ends_at: end, venue_name: f.venue || null, address: f.address.slice(0, 200) || null, city: f.city.slice(0, 80) || null,
      association: f.association, association_url: f.associationUrl || null, event_url: f.eventUrl || null, description: f.description || null,
      image_url: f.imageUrl || null, places, own_payment: f.ownPayment || null, aftermeeting: f.aftermeeting || null, status: f.status === "withdrawn" ? "withdrawn" : "approved"
    }
  };
}
