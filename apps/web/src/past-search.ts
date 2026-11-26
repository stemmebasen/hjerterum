/** The search in the past events (past-events.tsx): every word of the query in the title or the teacher, without regard to case or accents. */
const fold = (text: string) => text.toLocaleLowerCase("da-DK").normalize("NFD").replace(/[̀-ͯ]/g, "");
export const matchesPast = (event: { title: string; host: string | null }, query: string) => {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const text = fold(`${event.title} ${event.host ?? ""}`);
  return words.every(word => text.includes(word));
};
