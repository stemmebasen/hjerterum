/** Asked (Gitta): "Ikonerne på forsiden (Foredrag, Filmaften, Koncerter, Café osv.) fører alle til den samme fulde kalender. Er de ment som
 * filtre?" - they are now: each opens the calendar with only its kind, read from the event's title and category. */
export const EVENT_KINDS = [
  { key: "foredrag", label: "Foredrag", test: /foredrag|\btalk\b|oplæg|lecture/i },
  { key: "koncerter", label: "Koncerter", test: /koncert|concert|kirtan|åben scene|sang|songs?\b|musik|music/i },
  { key: "cafe", label: "Café", test: /café|cafe/i },
  // Douglas (3 Nov): "how about a fællesspisning button in this list?"
  { key: "spisning", label: "Fællesspisning", test: /fællesspisning|spisning|potluck|fællesmiddag|\bdinner|shared meal|communal (dining|meal)/i },
  { key: "film", label: "Filmaftener", test: /\bfilm|movie|biograf/i },
  // Douglas' notes: "? Courses button" - courses, series and trainings.
  { key: "kurser", label: "Kurser", test: /kursus|kurser|forløb|uddannelse|\bcourse|training|træning/i }
] as const;

export type EventKind = (typeof EVENT_KINDS)[number]["key"];

export const kindOf = (key: string | null | undefined) => EVENT_KINDS.find(kind => kind.key === key) ?? null;

export const isKind = (event: { title: string; category?: string | null }, key: EventKind) =>
  kindOf(key)!.test.test(`${event.title} ${event.category ?? ""}`);
