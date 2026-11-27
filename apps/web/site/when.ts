/** Douglas (forslag #5, 27 Nov 2026): the sign-up confirmation said "kl. kl. 10.00" (an event "Test 3", 2 people) - "The time must show "kl." only
 * once." The date formatter (da-DK, with hour and minute) writes "kl." before the time itself, and the code put another in front. One "kl.",
 * whether the formatter wrote it or not: "lørdag 28. november kl. 10.00". */
export const withKl = (formatted: string): string => formatted.replace(/(?:\s*kl\.)?\s+(\d{2})[.:](\d{2})$/, " kl. $1.$2");
