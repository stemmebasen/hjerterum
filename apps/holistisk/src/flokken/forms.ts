import { TIMEZONE, wallClock, zonedToUtc } from "../time.js";
import { DEFAULT_SIZE, MAX_SIZE, MIN_SIZE, type FlockInput } from "./store.js";

/** Reading and checking the flock form. The meeting place must be a public place: the form asks the person to
 * confirm it, and the event's own entrance is suggested. */

export type FlockForm = { meetingPlace: string; meetingAt: string; note: string; maxSize: string; publicPlace: boolean; followsFlockId: string };
export type FieldErrors = Partial<Record<"meetingPlace" | "meetingAt" | "note" | "maxSize" | "publicPlace" | "followsFlockId", string>>;

const pad = (n: number) => String(n).padStart(2, "0");
/** "2026-10-26T18:45" in Danish time, for <input type="datetime-local">. */
export function toLocalInput(ms: number): string {
  const w = wallClock(ms, TIMEZONE);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}

export function fromLocalInput(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1).map(Number) as [number, number, number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  return zonedToUtc({ year, month, day, hour, minute }, TIMEZONE);
}

export function readFlockForm(data: FormData): FlockForm {
  const s = (k: string) => String(data.get(k) ?? "");
  return { meetingPlace: s("moedested"), meetingAt: s("tidspunkt"), note: s("note"), maxSize: s("stoerrelse"), publicPlace: data.get("offentligt") === "ja", followsFlockId: s("fra_flok") };
}

export function defaultFlockForm(event: { venue_name: string | null; starts_at: number }, now: number): FlockForm {
  const before = Math.max(event.starts_at - 15 * 60_000, now + 30 * 60_000);
  return {
    meetingPlace: event.venue_name ? `Ved indgangen til ${event.venue_name}` : "Ved indgangen",
    meetingAt: toLocalInput(Math.min(before, event.starts_at)), note: "", maxSize: String(DEFAULT_SIZE), publicPlace: false, followsFlockId: ""
  };
}

/** Checks the form against the event: the meeting is after now, at most 6 hours before the event starts and not after
 * it has ended. */
export function validateFlockForm(form: FlockForm, event: { starts_at: number; ends_at: number | null }, now: number, options: { allowedFollows: string[] }): { input: FlockInput } | { errors: FieldErrors } {
  const errors: FieldErrors = {};
  const place = form.meetingPlace.replace(/\s+/g, " ").trim();
  if (place.length < 3 || place.length > 120) errors.meetingPlace = "Skriv et mødested på 3–120 tegn, fx indgangen, en café eller et torv.";
  const at = fromLocalInput(form.meetingAt);
  const ends = event.ends_at ?? event.starts_at + 3 * 3600_000;
  if (at === null) errors.meetingAt = "Vælg dato og klokkeslæt.";
  else if (at < now) errors.meetingAt = "Tidspunktet er allerede gået.";
  else if (at < event.starts_at - 6 * 3600_000 || at > ends) errors.meetingAt = "Mød højst 6 timer før eventet starter og senest når det slutter.";
  const note = form.note.replace(/\r\n/g, "\n").trim();
  if (note.length > 280) errors.note = "Højst 280 tegn.";
  const size = Number.parseInt(form.maxSize, 10);
  if (!Number.isInteger(size) || size < MIN_SIZE || size > MAX_SIZE) errors.maxSize = `Vælg mellem ${MIN_SIZE} og ${MAX_SIZE}.`;
  if (!form.publicPlace) errors.publicPlace = "Flokke mødes altid et offentligt sted. Bekræft, at mødestedet er det.";
  const follows = form.followsFlockId.trim() || null;
  if (follows && !options.allowedFollows.includes(follows)) errors.followsFlockId = "Vælg en af dine tidligere flokke eller ingen.";
  if (Object.keys(errors).length) return { errors };
  return { input: { meetingPlace: place, meetingAt: at!, note: note || null, maxSize: size, followsFlockId: follows } };
}
