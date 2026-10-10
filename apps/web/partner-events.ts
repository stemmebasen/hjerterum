/** Requested: "Vigtigt at alle Hjerteland events kommer i bunden under overskriften 'Fra samarbejdspartnere' - både på hjemmesiden og i
 * medlemssiden." An event from a partner house (today Hjerteland) is told by its place, category or title. */
const PARTNERS = /hjerteland/i;
export const PARTNER_HEADING = "Fra samarbejdspartnere";
export const isPartnerEvent = (event: { title?: string | null; location?: string | null; category?: string | null }) =>
  [event.location, event.category, event.title].some(value => !!value && PARTNERS.test(value));
