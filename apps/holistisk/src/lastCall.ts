/** No flock is gathered, and no invitation can be confirmed, this close to the start: the day before is the final
 * status for those already on the list (Jake 2026-11-24: three hours before was too late to buy a ticket and plan). */
export const LAST_CALL_MS = 24 * 3600_000;

/** "Jeg vil gerne med!" closes this long before the start (Jake 2026-11-24: to gather a flock it must be 3 days
 * before). The arrangement is still shown until it starts, just without the way to find a flock. */
export const SIGNUP_CLOSES_MS = 3 * 24 * 3600_000;

/** True while one can still put oneself on the list for the event: scheduled and more than 3 days to go. */
export function interestOpen(e: { status: string; starts_at: number }, now: number): boolean {
  return e.status === "scheduled" && e.starts_at - now > SIGNUP_CLOSES_MS;
}

/** True while a flock can still be gathered for those already on the list: scheduled and more than a day to go. */
export function gatheringOpen(e: { status: string; starts_at: number }, now: number): boolean {
  return e.status === "scheduled" && e.starts_at - now > LAST_CALL_MS;
}
