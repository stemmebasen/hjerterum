import { CATEGORIES, categoryByPath, type Category } from "./categories.js";

/** Everything a visitor can search for by name and that gets its own landing page, with and without a city:
 * /meditation, /meditation/aarhus, /klarsyn/randers. The 14 categories are activities; so are the narrower topics
 * people search for directly (klarsyn, soundbath, kakaoceremoni, MBSR …), which are found by words in the events'
 * text rather than by category. */

export type Activity = {
  slug: string;
  name: string;
  /** H1 with {place}: "Klarsynsaftener i {place}". */
  heading: string;
  phrase: string;
  promise: string;
  need: string;
  /** For a category's page: the category it lists. */
  category?: string;
  /** For a topic: every group must match at least one of its words (lower case) in the event's text. */
  groups?: string[][];
  /** Related activities, linked from the page. */
  related: string[];
};

export const TOPICS: Activity[] = [
  { slug: "mindfulness", name: "Mindfulness", heading: "Mindfulness i {place}", phrase: "mindfulness-kurser, MBSR-forløb og guidet nærvær", promise: "Find ro og nærvær i hverdagen", need: "mindre stress, mere nærvær eller et forløb i fællesskab", groups: [["mindful", "mbsr"]], related: ["mbsr", "meditation", "stress"] },
  { slug: "mbsr", name: "MBSR-forløb", heading: "MBSR-forløb i {place}", phrase: "MBSR – mindfulnessbaseret stressreduktion – i 8-ugers forløb og introaftener", promise: "Videnskabeligt funderet stressreduktion", need: "et struktureret forløb mod stress", groups: [["mbsr", "mindfulness-baseret stress", "mindfulnessbaseret stress", "mindfulness based stress"]], related: ["mindfulness", "stress", "meditation"] },
  { slug: "stress", name: "Stressreduktion", heading: "Stressreduktion og ro i nervesystemet i {place}", phrase: "workshops og forløb i stressreduktion, nervesystemsregulering og afspænding", promise: "Giv nervesystemet en pause", need: "ro i kroppen, bedre søvn eller nye værktøjer mod stress", groups: [["stress", "nervesystem", "udbrændt", "restorativ"]], related: ["mindfulness", "mbsr", "yin-yoga"] },
  { slug: "meditation-for-begyndere", name: "Meditation for begyndere", heading: "Meditation for begyndere i {place}", phrase: "introaftener, drop-in og begynderhold i meditation", promise: "Kom godt i gang", need: "en blid start uden forudsætninger", groups: [["meditation", "mindful"], ["begynder", "introduktion", "intro til", "intro-", "drop-in", "drop in", "alle kan være med", "ingen erfaring", "nybegynder"]], related: ["meditationsgrupper", "meditation", "mindfulness"] },
  { slug: "meditationsgrupper", name: "Meditationsgrupper", heading: "Meditationsgrupper i {place}", phrase: "faste meditationsaftener, drop-in og meditationsgrupper", promise: "Mediter sammen med andre", need: "en fast praksis i fællesskab", groups: [["meditation"], ["gruppe", "drop-in", "drop in", "fællesmeditation", "hver mandag", "hver tirsdag", "hver onsdag", "hver torsdag", "ugentlig", "fast aften", "meditationsaften"]], related: ["meditation", "buddhistisk-meditation", "meditation-for-begyndere"] },
  { slug: "buddhistisk-meditation", name: "Buddhistisk meditation", heading: "Buddhistisk meditation i {place}", phrase: "buddhistisk meditation, dharma-foredrag og meditationskurser", promise: "Stil sindet og find klarhed", need: "en klassisk meditationstradition eller et sted at praktisere", groups: [["buddhis", "dharma", "karma kagyu", "kagyü", "kadjü", "diamantvej", "diamond way", "lama ", "tibetansk", "rinpoche", "zen", "vipassana"]], related: ["meditation", "meditationsgrupper", "stilhedsretreat"] },
  { slug: "stilhedsretreat", name: "Stilhedsretreat", heading: "Stilhedsretreats i {place}", phrase: "stilhedsretreats, tavse weekender og fordybelse", promise: "Træk dig tilbage og find stilheden", need: "stilhed, fordybelse og et pusterum fra hverdagen", groups: [["stilhed", "silent", "tavs"], ["retreat", "retræte"]], related: ["retreat", "meditation", "buddhistisk-meditation"] },
  { slug: "klarsyn", name: "Klarsyn", heading: "Klarsynsaftener i {place}", phrase: "klarsynsaftener, klarsynsdemonstrationer og mediumskab", promise: "Oplev kontakten til den åndelige verden", need: "kontakt, indsigt eller en særlig aften", groups: [["klarsyn", "clairvoyan", "medie ", "mediet", "medium", "afdøde", "åndelige verden"]], related: ["spirituelle-foredrag", "spiritualitet", "healing"] },
  { slug: "spirituelle-foredrag", name: "Spirituelle foredrag", heading: "Spirituelle foredrag i {place}", phrase: "spirituelle foredrag om healing, sjæl, bevidsthed og den åndelige verden", promise: "Bliv inspireret", need: "viden, inspiration og nye perspektiver", groups: [["foredrag", "oplæg"], ["spiritu", "åndelig", "sjæl", "healing", "klarsyn", "medie", "bevidsthed", "teosofi"]], related: ["klarsyn", "spiritualitet", "healing"] },
  { slug: "healing", name: "Healing", heading: "Healing i {place}", phrase: "healing, healingsmeditation, energiarbejde og healende fællesskaber", promise: "Giv dig selv ro og ny energi", need: "balance, lindring eller en healende oplevelse", groups: [["healing", "healer", "reiki", "energiarbejde"]], related: ["spiritualitet", "soundbath", "klarsyn"] },
  { slug: "soundbath", name: "Soundbath", heading: "Soundbath og klangbad i {place}", phrase: "soundbaths, klangbad, gongbad og lydrejser", promise: "Lad lyden falde dig til ro", need: "dyb afslapning eller en lydrejse", groups: [["sound bath", "soundbath", "sound journey", "lydbad", "klangbad", "gong", "syngeskål", "klangskål", "lydrejse", "sound healing"]], related: ["lydhealing", "yin-yoga", "meditation"] },
  { slug: "kakaoceremoni", name: "Kakaoceremoni", heading: "Kakaoceremonier i {place}", phrase: "kakaoceremonier og hjerteåbnende cirkler", promise: "Åbn hjertet i fællesskab", need: "en ceremoni, et fællesskab eller en hjerteåbnende aften", groups: [["kakao", "cacao"]], related: ["spiritualitet", "kvinde-og-mandegrupper", "soundbath"] },
  { slug: "trommerejse", name: "Trommerejse", heading: "Trommerejser i {place}", phrase: "shamanistiske trommerejser og trommecirkler", promise: "Rejs indad med trommens rytme", need: "indsigt, kraft og healing gennem trommen", groups: [["trommerejse", "tromme", "shaman"]], related: ["spiritualitet", "healing", "kakaoceremoni"] },
  { slug: "yin-yoga", name: "Yin yoga", heading: "Yin yoga i {place}", phrase: "yin yoga, restorativ yoga og yoga nidra", promise: "Giv slip og find ro i kroppen", need: "dyb afspænding og en blid praksis", groups: [["yin yoga", "yin-yoga", "yinyoga", "restorativ", "restorative", "yoga nidra"]], related: ["yoga", "stress", "soundbath"] }
];

// Narrower topics a category's page points on to.
const RELATED: Record<string, string[]> = {
  "meditation-mindfulness": ["meditationsgrupper", "buddhistisk-meditation", "mindfulness", "meditation-for-begyndere"],
  "yoga": ["yin-yoga", "stress", "meditation"],
  "aandedraet-breathwork": ["stress", "healing", "meditation"],
  "spiritualitet-bevidsthed": ["klarsyn", "spirituelle-foredrag", "healing", "trommerejse", "kakaoceremoni"],
  "lydhealing": ["soundbath", "healing", "yin-yoga"],
  "retraeter": ["stilhedsretreat", "buddhistisk-meditation"],
  "holistisk-sundhed": ["healing", "stress", "mbsr"],
  "personlig-udvikling": ["mindfulness", "stress", "spirituelle-foredrag"]
};

/** The categories as activities: their path is their address. */
const CATEGORY_ACTIVITIES: Activity[] = CATEGORIES.map((c: Category) => ({
  slug: c.path, name: c.name, heading: c.heading, phrase: c.phrase, promise: c.promise, need: c.need, category: c.slug,
  related: RELATED[c.slug] ?? []
}));

export const ACTIVITIES: Activity[] = [...CATEGORY_ACTIVITIES, ...TOPICS];
const BY_SLUG = new Map(ACTIVITIES.map(a => [a.slug, a]));

/** An activity by its address; an old category address (its long slug) finds the category's activity. */
export function activityBySlug(slug: string): Activity | undefined {
  return BY_SLUG.get(slug) ?? (() => { const c = categoryByPath(slug); return c ? BY_SLUG.get(c.path) : undefined; })();
}

/** Topics an event is about. Every word group must be present; a word in the title weighs 4, mentions in the
 * description 1 each (at most 3), and 3 points are needed – so one passing mention in a long text is not enough. */
export function classifyTopics(input: { title: string; description?: string | null }): string[] {
  const title = input.title.toLowerCase();
  const description = (input.description ?? "").toLowerCase().slice(0, 4000);
  const count = (text: string, word: string) => { let n = 0, i = text.indexOf(word); while (i !== -1 && n < 3) { n++; i = text.indexOf(word, i + word.length); } return n; };
  return TOPICS.filter(t => {
    const groups = t.groups ?? [];
    const scores = groups.map(g => {
      const inTitle = g.some(w => title.includes(w));
      const mentions = Math.min(3, g.reduce((sum, w) => sum + count(description, w), 0));
      return (inTitle ? 4 : 0) + mentions;
    });
    return scores.length > 0 && scores.every(s => s > 0) && Math.min(...scores) >= 1 && scores[0]! >= 3;
  }).map(t => t.slug);
}

export const headingFor = (a: Activity, place: string): string => a.heading.replace("{place}", place);
