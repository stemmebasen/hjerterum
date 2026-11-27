/** What a cancellation says (cancel-registration.tsx) - the same in "Mine tilmeldinger" and in Kalender. */
export const cancelMessage = (keep: number | null) => keep === null ? "Din tilmelding er annulleret." : `Din tilmelding er nu for ${keep} ${keep === 1 ? "person" : "personer"}.`;
