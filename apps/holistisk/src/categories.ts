/** The portal's categories, and a plain keyword classifier (no AI): an event gets every category whose words it
 * carries, strongest first, at most three. A source may add hints (its own category names). */

export type Category = { slug: string; name: string; short: string; words: RegExp };

// Word lists match lower-cased text. \b does not understand æ/ø/å, so the lists use explicit edges where it matters.
const W = (source: string) => new RegExp(source, "i");

export const CATEGORIES: Category[] = [
  { slug: "meditation-mindfulness", name: "Meditation og mindfulness", short: "Meditation", words: W("meditat|mindful|stilhed|nærvær|vipassana|yoga nidra|body ?scan|zazen|guided rejse") },
  { slug: "yoga", name: "Yoga", short: "Yoga", words: W("yoga|asana|vinyasa|hatha|yin|kundalini|ashtanga|pranayama") },
  { slug: "aandedraet-breathwork", name: "Åndedræt og breathwork", short: "Breathwork", words: W("breath|åndedræt|åndedræts|vejrtrækning|wim hof|pranayama|holotrop") },
  { slug: "personlig-udvikling", name: "Personlig udvikling", short: "Personlig udvikling", words: W("personlig udvikling|selvudvikling|selvindsigt|coaching|potentiale|livsmod|selvværd|grænser|healing journey|indre barn|transformation") },
  { slug: "spiritualitet-bevidsthed", name: "Spiritualitet og bevidsthed", short: "Spiritualitet", words: W("spiritu|bevidsthed|shaman|trommerejse|clairvoyan|healing|healer|kakao|cacao|ceremoni|reiki|channel|sjæl|månecirkel|nymåne|fuldmåne|tarot|astrolog|chakra|energi") },
  { slug: "lydhealing", name: "Lydhealing og sound baths", short: "Lydhealing", words: W("sound ?bath|sound ?heal|lydbad|lydhealing|lydrejse|sound journey|gong|syngeskål|klangskål|krystalskål|mantra|kirtan|healing sang|sangcirkel|syng|sing\\b|lyd, sang|toning") },
  { slug: "dans-bevaegelse", name: "Dans og bevægelse", short: "Dans", words: W("dans|dance|bevægelse|5 ?rytmer|5rhythms|qi ?gong|qigong|tai ?chi|movement|krops?bevidst") },
  { slug: "kvinde-mandegrupper", name: "Kvindegrupper og mandegrupper", short: "Kvinde- og mandegrupper", words: W("kvindecirkel|kvindegruppe|kvinderum|women'?s circle|mandegruppe|mandecirkel|men'?s circle|søsterskab|broderskab|for kvinder|for mænd|kvindelig") },
  { slug: "samtale-faellesskab", name: "Samtale- og fællesskabsgrupper", short: "Samtalegrupper", words: W("samtale|sharing|delecirkel|cirkel|circle|støttegruppe|sorggruppe|lyttecirkel|dialogaften") },
  { slug: "workshops-kurser", name: "Workshops og kurser", short: "Workshops", words: W("workshop|kursus|kurser|forløb|uddannelse|træning|introduktion til|masterclass|seminar|foredrag|undervisning") },
  { slug: "retraeter", name: "Retræter", short: "Retræter", words: W("retræte|retreat|weekendophold|stilhedsweekend|ophold") },
  { slug: "holistisk-sundhed", name: "Holistisk sundhed og velvære", short: "Sundhed og velvære", words: W("sundhed|velvære|wellness|massage|terapi|terapeut|krop og sind|stress|søvn|nervesystem|ayurveda|urter|kost|helbred|zoneterapi|akupunktur|healing") },
  { slug: "natur", name: "Naturaktiviteter", short: "Natur", words: W("i naturen|ude i naturen|naturoplevelse|naturvandring|naturmeditation|skovbad|skovtur|forest bath|shinrin|havbad|vinterbad|vandretur|gåtur|hike|hiking|udendørs|udeliv|bålaften|strandtur") },
  { slug: "sociale-faellesskaber", name: "Sociale fællesskaber", short: "Fællesskab", words: W("fællesskab|community|socialt samvær|fællesspisning|åbent hus|netværksmøde|frivillig|medlemscaf|café|cafe\\b") }
];

const BY_SLUG = new Map(CATEGORIES.map(c => [c.slug, c]));
export const categoryBySlug = (slug: string): Category | undefined => BY_SLUG.get(slug);
export const categoryName = (slug: string): string => BY_SLUG.get(slug)?.name ?? slug;

/** Words that make an event relevant to a holistic portal at all; used for sources that also carry other events. */
export function isHolisticRelevant(text: string): boolean {
  return CATEGORIES.slice(0, 8).some(c => c.words.test(text)) || /retræte|retreat|holistisk|healing|velvære|terapi/i.test(text);
}

function matches(re: RegExp, text: string): number {
  const global = new RegExp(re.source, "gi");
  return Math.min(3, (text.match(global) ?? []).length);
}

/** Up to three categories. A word in the title is strong evidence (4); the source's own category name a little (1);
 * the description counts per mention, up to 3. A category needs 3 points, so a passing mention in a long text does
 * not decide it. */
export function classify(input: { title: string; description?: string | null; hints?: string[] }): string[] {
  const title = input.title.toLowerCase();
  const description = (input.description ?? "").toLowerCase().slice(0, 4000);
  const hints = (input.hints ?? []).join(" ").toLowerCase();
  const scored = CATEGORIES.map((c, index) => ({
    slug: c.slug,
    index,
    score: Math.min(1, matches(c.words, title)) * 4 + Math.min(1, matches(c.words, hints)) + matches(c.words, description)
  })).filter(s => s.score >= 3);
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, 3).map(s => s.slug);
}
