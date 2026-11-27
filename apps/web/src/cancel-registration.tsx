import { useState } from "react";
import { apiFetch, type ClerkBrowser } from "./clerk";
import { Live } from "./live-text";
import { cancelMessage } from "./cancel-registration-text";

/** Douglas (forslag #6, 27 Nov 2026): "One 'Cancel' button next to each registration ... Pressing it opens an 'Are you sure?' step. It uses the same
 * cancellation as Kalender" - and for a registration of several people, "cancel the whole registration or pick one or more of the people and keep the
 * rest". The people of a group registration are a number of places, so the member chooses how many to keep. Used in "Mine tilmeldinger" on the front
 * page of Min side and in Kalender, so the rules and the words are the same in both. */
export type CancellableBooking = { id: number; title: string; ticketPriceKr: number; mySeats?: number | null };

const failure = (code: string | undefined) => code === "booking_started" ? "Eventet er begyndt." : "Tilmeldingen kunne ikke ændres. Prøv igen om lidt.";

export function CancelRegistration({ clerk, booking, onDone, label = "Annullér" }: { clerk: ClerkBrowser; booking: CancellableBooking; onDone: (message: string) => void | Promise<void>; label?: string }) {
  const seats = booking.mySeats && booking.mySeats > 1 ? booking.mySeats : 1;
  const [open, setOpen] = useState(false);
  const [keep, setKeep] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function cancel() {
    setBusy(true); setError("");
    const response = await apiFetch(clerk, `/api/room-bookings/${booking.id}/attend`, keep === null ? { method: "DELETE" }
      : { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ seats: keep }) }).catch(() => null);
    const body = response ? await response.json().catch(() => ({})) as { error?: string } : {};
    setBusy(false);
    if (!response?.ok) { setError(failure(body.error)); return; }
    setOpen(false);
    await onDone(cancelMessage(keep));
  }
  if (!open) return <button type="button" className="pill-button subtle cancel-registration-open" onClick={() => { setKeep(null); setError(""); setOpen(true); }}>{label}</button>;
  return <div className="cancel-registration" role="group" aria-label="Annullér tilmelding">
    <p><Live text={`Er du sikker på, at du vil annullere din tilmelding til »${booking.title}«?`} /></p>
    {seats > 1 && <div className="cancel-registration-choice">
      <label><input type="radio" name={`cancel-${booking.id}`} checked={keep === null} onChange={() => setKeep(null)} /> <Live text={`Hele tilmeldingen (${seats} personer)`} /></label>
      <label><input type="radio" name={`cancel-${booking.id}`} checked={keep !== null} onChange={() => setKeep(seats - 1)} /> Kun nogle af pladserne - behold{" "}
        <select aria-label="Antal personer, der stadig kommer" value={keep ?? seats - 1} onChange={e => setKeep(Number(e.target.value))} onFocus={() => keep === null && setKeep(seats - 1)}>
          {Array.from({ length: seats - 1 }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n === 1 ? "1 person" : `${n} personer`}</option>)}
        </select></label>
    </div>}
    {booking.ticketPriceKr > 0 && <p className="small">En betalt billet refunderes ikke automatisk.</p>}
    {error && <p className="workspace-message" role="alert">{error}</p>}
    <p className="cancel-registration-actions">
      <button type="button" className="pill-button dark" disabled={busy} onClick={() => void cancel()}>{busy ? "Arbejder …" : keep === null ? "Ja, annullér" : "Ja, annullér pladserne"}</button>
      {/* Douglas (forslag #8): the button that closes the step without cancelling keeps the registration - and says so, in words Google translates as "Keep". */}
      <button type="button" className="pill-button subtle" disabled={busy} onClick={() => setOpen(false)}>Nej, behold min tilmelding</button>
    </p>
  </div>;
}
