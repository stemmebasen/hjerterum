/** A broad, mainstream selection (Jake 2026-11-10): the site should appeal to many kinds of people, not read as a
 * portal for spirituality and alternative treatment. Spiritual and alternative events stay in the calendar, in search
 * and on their own category pages, but the places that set the tone – the front page's three suggestions, its free
 * events and its week list, and the interest list's suggestions – show the broad offer first.
 *
 * Where the broad offer is too thin to fill a list, the rest fills it up, after the broad events.
 *
 * An event counts as spiritual/alternative when it comes from one of the sources below, or when one of its categories
 * is one of the categories below. Yoga, dance, nature and workshops count as broad. */

export const ALTERNATIVE_CATEGORIES = [
  "meditation-mindfulness", "aandedraet-breathwork", "spiritualitet-bevidsthed", "lydhealing",
  "kvinde-mandegrupper", "retraeter", "holistisk-sundhed", "personlig-udvikling"
] as const;

/** Sources (src/sources/registry.ts ids) whose programme is mainly spiritual or alternative. */
export const ALTERNATIVE_SOURCES = [
  "hjerterum", "lysetshus", "favn-aarhus", "dansk-center-for-mindfulness",
  "brahma-kumaris-aarhus", "buddhistisk-center-aarhus", "vaekstcenteret"
] as const;

/** Organisers (organizer_id) of the same kind, for events from shared sources such as the weekly offerings. */
export const ALTERNATIVE_ORGANIZERS = [
  "hjerterum", "hjerteland", "lysets-hus", "favn-aarhus", "dansk-center-for-mindfulness",
  "brahma-kumaris-aarhus", "buddhistisk-center-aarhus", "vaekstcenteret"
] as const;

/** The categories shown first in menus, on the front page and on /kategorier, in that order. */
export const BROAD_CATEGORIES = [
  "koncerter-musik", "scenekunst", "foredrag-debat", "quiz-fest", "kunst-udstillinger", "boern-familie",
  "sociale-faellesskaber", "dans-bevaegelse", "natur", "workshops-kurser", "yoga", "samtale-faellesskab"
] as const;

export const isAlternativeOrganizer = (slug: string): boolean => (ALTERNATIVE_ORGANIZERS as readonly string[]).includes(slug);

export const isAlternativeCategory = (slug: string): boolean => (ALTERNATIVE_CATEGORIES as readonly string[]).includes(slug);

/** The same test for a loaded event row. */
export function isAlternativeEvent(e: { primary_source_id: string; organizer_id: string | null; categories: string | null }): boolean {
  return (ALTERNATIVE_SOURCES as readonly string[]).includes(e.primary_source_id)
    || isAlternativeOrganizer(e.organizer_id ?? "")
    || (e.categories ?? "").split(",").some(isAlternativeCategory);
}

const marks = (n: number) => Array.from({ length: n }, () => "?").join(",");

/** SQL (for an events table aliased `e`): true for a spiritual or alternative event, with its parameters. Used to put
 * the broad offer first (ORDER BY … ASC) or to keep only it (NOT …). */
export function alternativeSql(): { sql: string; params: string[] } {
  return {
    sql: `(e.primary_source_id IN (${marks(ALTERNATIVE_SOURCES.length)})
      OR COALESCE(e.organizer_id, '') IN (${marks(ALTERNATIVE_ORGANIZERS.length)})
      OR EXISTS (SELECT 1 FROM event_categories bc WHERE bc.event_id = e.id AND bc.category IN (${marks(ALTERNATIVE_CATEGORIES.length)})))`,
    params: [...ALTERNATIVE_SOURCES, ...ALTERNATIVE_ORGANIZERS, ...ALTERNATIVE_CATEGORIES]
  };
}

/** SQL that keeps only the broad offer. */
export function broadOnly(): { sql: string; params: string[] } {
  const a = alternativeSql();
  return { sql: `NOT ${a.sql}`, params: a.params };
}
