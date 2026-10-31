/** Requested: "Saga skal gå ind og vurdere eventet både i forhold til indhold og sprog, men ikke mindst i forhold til, at vi får en
 * flot eventtekst med et minimumsantal på 75 ord." The rule, shared by the form, Saga's guide and her review. */
export const MIN_EVENT_WORDS = 75;
export const wordCount = (text: string | null | undefined) => (text ?? "").trim().split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length;
export const textLongEnough = (text: string | null | undefined) => wordCount(text) >= MIN_EVENT_WORDS;
