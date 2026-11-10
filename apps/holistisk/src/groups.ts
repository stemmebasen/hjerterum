/** Socialklubben's four main kinds of experience (Jake 2026-11-10): Underholdning, Krea, Oplysning and Fordybelse. Each
 * is a set of the portal's categories (src/categories.ts); an event belongs to every group one of its categories is in.
 * Shown as four big tiles to pick with one tap (/kalender?gruppe=…, the front page and the interest list). */

export type Group = {
  slug: "underholdning" | "krea" | "oplysning" | "fordybelse";
  name: string;
  /** One short line under the name on the tile. */
  line: string;
  categories: string[];
  /** The tile's icon: the inside of a 24×24 SVG, drawn with currentColor. */
  icon: string;
};

export const GROUPS: Group[] = [
  {
    slug: "underholdning", name: "Underholdning", line: "Koncerter, teater, comedy og fest",
    categories: ["koncerter-musik", "scenekunst", "quiz-fest", "dans-bevaegelse", "boern-familie"],
    icon: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>'
  },
  {
    slug: "krea", name: "Krea", line: "Kunst, udstillinger og skab selv",
    categories: ["kunst-udstillinger"],
    icon: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.9 1.2-1.8-.5-1.1.3-2.2 1.5-2.2H17a4 4 0 0 0 4-4c0-5.5-4-10-9-10z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="10.5" cy="7" r="1.2"/><circle cx="15.5" cy="8" r="1.2"/>'
  },
  {
    slug: "oplysning", name: "Oplysning", line: "Foredrag, debat og kurser",
    categories: ["foredrag-debat", "workshops-kurser", "personlig-udvikling"],
    icon: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>'
  },
  {
    slug: "fordybelse", name: "Fordybelse", line: "Meditation, yoga, natur og fællesskab",
    categories: ["meditation-mindfulness", "yoga", "aandedraet-breathwork", "spiritualitet-bevidsthed", "lydhealing", "kvinde-mandegrupper",
      "samtale-faellesskab", "retraeter", "holistisk-sundhed", "natur", "sociale-faellesskaber"],
    icon: '<path d="M12 21c-4-2-7-5.5-7-10 3 0 5.5 1.5 7 4 1.5-2.5 4-4 7-4 0 4.5-3 8-7 10z"/><path d="M12 15c-1.5-2-2-4.5-2-7 .8-1.6 1.6-2.8 2-3.5.4.7 1.2 1.9 2 3.5 0 2.5-.5 5-2 7z"/>'
  }
];

const BY_SLUG = new Map(GROUPS.map(g => [g.slug as string, g]));
export const groupBySlug = (slug: string | null | undefined): Group | undefined => slug ? BY_SLUG.get(slug) : undefined;
/** The groups an event belongs to, from its comma-separated categories. */
export const groupsOf = (categories: string | null): Group["slug"][] => {
  const cats = (categories ?? "").split(",").filter(Boolean);
  return GROUPS.filter(g => g.categories.some(c => cats.includes(c))).map(g => g.slug);
};
