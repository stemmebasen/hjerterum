/** The portal's categories, and a plain keyword classifier (no AI): an event gets every category whose words it
 * carries, strongest first, at most three. A source may add hints (its own category names). */

export type Category = {
  slug: string;
  name: string;
  short: string;
  words: RegExp;
  /** The category's address in URLs: /kategori/<path>, /aarhus/<path>. Short words people search for. */
  path: string;
  /** Search words for titles, descriptions and the page introduction ("guidede meditationer, mindfulness …"). */
  phrase: string;
  /** What it gives, for the description ("Find ro og nærvær"). */
  promise: string;
  /** What visitors look for, for the introduction ("ro, nærvær eller en pause i hverdagen"). */
  need: string;
  /** The landing page's H1, worded as people search ("Spirituelle arrangementer i {place}"). */
  heading: string;
};

// Word lists match lower-cased text. \b does not understand æ/ø/å, so the lists use explicit edges where it matters.
const W = (source: string) => new RegExp(source, "i");

export const CATEGORIES: Category[] = [
  { slug: "meditation-mindfulness", name: "Meditation og mindfulness", short: "Meditation", words: W("meditat|mindful|stilhed|nærvær|vipassana|yoga nidra|body ?scan|zazen|guided rejse"), path: "meditation", phrase: "guidede meditationer, mindfulness og stilhed", promise: "Find ro og nærvær", need: "ro, nærvær eller en pause i hverdagen", heading: "Meditation i {place}" },
  { slug: "yoga", name: "Yoga", short: "Yoga", words: W("yoga|asana|vinyasa|hatha|yin|kundalini|ashtanga|pranayama"), path: "yoga", phrase: "yogaklasser, yin yoga, hatha og yoga nidra", promise: "Find balance i krop og sind", need: "en blid klasse, en stærk praksis eller dyb afspænding", heading: "Yoga i {place}" },
  { slug: "aandedraet-breathwork", name: "Åndedræt og breathwork", short: "Breathwork", words: W("breath|åndedræt|åndedræts|vejrtrækning|wim hof|pranayama|holotrop"), path: "breathwork", phrase: "breathwork, åndedrætsøvelser og rebirthing", promise: "Træk vejret dybt og giv slip", need: "at slippe spændinger, få energi eller mærke dig selv", heading: "Breathwork i {place}" },
  { slug: "personlig-udvikling", name: "Personlig udvikling", short: "Personlig udvikling", words: W("personlig udvikling|selvudvikling|selvindsigt|coaching|potentiale|livsmod|selvværd|grænser|healing journey|indre barn|transformation"), path: "selvudvikling", phrase: "workshops, coaching og forløb i personlig udvikling", promise: "Bliv klogere på dig selv", need: "retning, mod eller ny indsigt", heading: "Selvudvikling og personlig udvikling i {place}" },
  { slug: "spiritualitet-bevidsthed", name: "Spiritualitet og bevidsthed", short: "Spiritualitet", words: W("spiritu|bevidsthed|shaman|trommerejse|clairvoyan|klarsyn|medie|medium|håndlæsning|kiromanti|åndelig|afdøde|healing|healer|kakao|cacao|ceremoni|reiki|channel|sjæl|månecirkel|nymåne|fuldmåne|tarot|astrolog|chakra|energi"), path: "spiritualitet", phrase: "spirituelle foredrag, klarsyn, healing og ceremonier", promise: "Find indre ro og fællesskab", need: "refleksion, fællesskab eller ny indsigt", heading: "Spirituelle arrangementer i {place}" },
  { slug: "lydhealing", name: "Lydhealing og sound baths", short: "Lydhealing", words: W("sound ?bath|sound ?heal|lydbad|lydhealing|lydrejse|sound journey|gong|syngeskål|klangskål|krystalskål|mantra|kirtan|healing sang|sangcirkel|syng|sing\\b|lyd, sang|toning"), path: "lydhealing", phrase: "sound baths, gongbad, lydrejser og healende sang", promise: "Lad lyden falde dig til ro", need: "dyb afslapning eller en lydrejse", heading: "Lydhealing og sound baths i {place}" },
  { slug: "dans-bevaegelse", name: "Dans og bevægelse", short: "Dans", words: W("dans|dance|bevægelse|5 ?rytmer|5rhythms|qi ?gong|qigong|tai ?chi|movement|krops?bevidst"), path: "dans", phrase: "ecstatic dance, 5Rytmer, qigong og bevidst bevægelse", promise: "Kom i kontakt med kroppen", need: "frihed, glæde eller ro i kroppen", heading: "Dans og bevægelse i {place}" },
  { slug: "kvinde-mandegrupper", name: "Kvindegrupper og mandegrupper", short: "Kvinde- og mandegrupper", words: W("kvindecirkel|kvindegruppe|kvinderum|women'?s circle|mandegruppe|mandecirkel|men'?s circle|søsterskab|broderskab|for kvinder|for mænd|kvindelig"), path: "kvinde-og-mandegrupper", phrase: "kvindecirkler, mandegrupper og månecirkler", promise: "Mød andre i et trygt rum", need: "fællesskab med andre kvinder eller mænd", heading: "Kvindecirkler og mandegrupper i {place}" },
  { slug: "samtale-faellesskab", name: "Samtale- og fællesskabsgrupper", short: "Samtalegrupper", words: W("samtale|sharing|delecirkel|cirkel|circle|støttegruppe|sorggruppe|lyttecirkel|dialogaften"), path: "samtalegrupper", phrase: "delecirkler, samtalegrupper og støttefællesskaber", promise: "Bliv hørt og del med andre", need: "nogen at dele med eller et trygt rum at tale i", heading: "Samtale- og delegrupper i {place}" },
  { slug: "workshops-kurser", name: "Workshops og kurser", short: "Workshops", words: W("workshop|kursus|kurser|forløb|uddannelse|træning|introduktion til|masterclass|seminar|foredrag|undervisning"), path: "workshops", phrase: "workshops, kurser, foredrag og uddannelser i det holistiske felt", promise: "Lær noget nyt", need: "viden, inspiration eller et længere forløb", heading: "Workshops og kurser i {place}" },
  { slug: "retraeter", name: "Retræter", short: "Retræter", words: W("retræte|retreat|weekendophold|stilhedsweekend|ophold"), path: "retreat", phrase: "retræter, stilhedsweekender og ophold", promise: "Træk dig tilbage og lad op", need: "stilhed, fordybelse eller et pusterum", heading: "Retreats og retræter i {place}" },
  { slug: "holistisk-sundhed", name: "Holistisk sundhed og velvære", short: "Sundhed og velvære", words: W("sundhed|velvære|wellness|massage|terapi|terapeut|krop og sind|stress|søvn|nervesystem|ayurveda|urter|kost|helbred|zoneterapi|akupunktur|healing"), path: "holistisk-sundhed", phrase: "healing, terapi, krop og sind og naturlig sundhed", promise: "Pas godt på dig selv", need: "balance, healing eller ny energi", heading: "Holistisk sundhed og healing i {place}" },
  { slug: "natur", name: "Naturaktiviteter", short: "Natur", words: W("i naturen|ude i naturen|naturoplevelse|naturvandring|naturmeditation|skovbad|skovtur|forest bath|shinrin|havbad|vinterbad|vandretur|gåtur|hike|hiking|udendørs|udeliv|bålaften|strandtur"), path: "natur", phrase: "naturvandringer, skovbad, vinterbad og bålaftener", promise: "Find roen udenfor", need: "frisk luft, stilhed og naturen tæt på", heading: "Naturaktiviteter i {place}" },
  { slug: "sociale-faellesskaber", name: "Sociale fællesskaber", short: "Fællesskab", words: W("fællesskab|community|socialt samvær|fællesspisning|åbent hus|netværksmøde|frivillig|medlemscaf|café|cafe\\b"), path: "faellesskaber", phrase: "fællesspisning, åbent hus og hyggelige fællesskaber", promise: "Mød nye mennesker", need: "selskab, samtaler og nye venskaber", heading: "Sociale fællesskaber i {place}" },
  { slug: "koncerter-musik", name: "Koncerter og musik", short: "Musik", words: W("koncert|concert|livemusik|live musik|live-musik|\\bband\\b|dj-set|\\bdj\\b|jazz|\\brock|hiphop|hip-hop|hip hop|\\bmetal\\b|indie|singer-songwriter|songwriter|orkester|symfoni|klassisk musik|americana|techno|elektronisk musik|\\bpunk|\\brap\\b|blues|soul\\b|turné|releasekoncert|spillested"), path: "koncerter", phrase: "koncerter, livemusik, jazz, rock og DJ-aftener", promise: "Hør musikken live", need: "en god koncert og nogen at dele den med", heading: "Koncerter i {place}" },
  { slug: "foredrag-debat", name: "Foredrag og debat", short: "Foredrag", words: W("foredrag|debat|forfattersamtale|forfatteraften|forfatter|oplæsning|litteratur|bogreception|bogudgivelse|lecture|\\btalk\\b|samtalesalon|filosof|podcast live|quizaften med|historie om"), path: "foredrag", phrase: "foredrag, debatter, forfattermøder og oplæsninger", promise: "Bliv klogere sammen med andre", need: "ny viden, gode samtaler eller et spændende emne", heading: "Foredrag og debat i {place}" },
  { slug: "kunst-udstillinger", name: "Kunst og udstillinger", short: "Kunst", words: W("udstilling|exhibition|fernisering|vernissage|galleri|gallery|kunstner|kunsthal|maleri|skulptur|\\bkunst\\b|kunstværk|billedkunst|keramik|drejekursus|tegneaften|croquis"), path: "kunst", phrase: "udstillinger, ferniseringer, kunstoplevelser og kreative værksteder", promise: "Oplev kunst og kreativitet", need: "inspiration, kunst eller selv at skabe noget", heading: "Kunst og udstillinger i {place}" },
  { slug: "scenekunst", name: "Teater, comedy og scenekunst", short: "Scenekunst", words: W("teater|theatre|theater|comedy|stand-up|standup|stand up|forestilling|\\bperformance|cirkus|improv|\\bimpro\\b|\\brevy|opera|musical|ballet|monolog"), path: "scenekunst", phrase: "teater, stand-up, comedy, opera og performance", promise: "Grin, gys og gåsehud", need: "en aften med teater, comedy eller performance", heading: "Teater og comedy i {place}" },
  { slug: "boern-familie", name: "Børn og familie", short: "Børn og familie", words: W("for børn|børn og|børnefamilie|familie|familien|babyer|\\bbaby|småbørn|forældre|\\bkids\\b|børneteater|børnekoncert|børneyoga|0-6 år|3-6 år|6-10 år|legestue|eventyr for"), path: "boern-og-familie", phrase: "familieevents, børneteater, legestuer og aktiviteter for børn", promise: "Oplevelser for hele familien", need: "noget sjovt at lave med børnene", heading: "Børn og familie i {place}" },
  { slug: "quiz-fest", name: "Quiz, fest og spilaftener", short: "Quiz og fest", words: W("\\bquiz|pubquiz|fredagsbar|karaoke|banko|bingo|brætspil|spilaften|\\bfest\\b|\\bparty\\b|klubaften|halloween|julefrokost|danseaften"), path: "quiz-og-fest", phrase: "quizaftener, fester, karaoke og spilaftener", promise: "Mød folk over en god aften", need: "en sjov aften, en quiz eller en fest", heading: "Quiz, fest og spilaftener i {place}" }
];

const BY_SLUG = new Map(CATEGORIES.map(c => [c.slug, c]));
export const categoryBySlug = (slug: string): Category | undefined => BY_SLUG.get(slug);
export const categoryName = (slug: string): string => BY_SLUG.get(slug)?.name ?? slug;
const BY_PATH = new Map(CATEGORIES.map(c => [c.path, c]));
/** A category by its URL path (or, for old links, by its slug). */
export const categoryByPath = (path: string): Category | undefined => BY_PATH.get(path) ?? BY_SLUG.get(path);

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
 * not decide it. A source whose description is the organiser's own one-line summary of the event (Favn's teasers) passes
 * it as summary: what it names counts 3, as a sub-title would. "Nærvær" is left out there: nearly every teaser uses it for
 * the mood, not the activity. */
export function classify(input: { title: string; description?: string | null; summary?: string | null; hints?: string[] }): string[] {
  const title = input.title.toLowerCase();
  const description = (input.description ?? "").toLowerCase().slice(0, 4000);
  const hints = (input.hints ?? []).join(" ").toLowerCase();
  const summary = (input.summary ?? "").toLowerCase().slice(0, 400).replace(/nærvær\p{L}*/gu, "");
  const scored = CATEGORIES.map((c, index) => ({
    slug: c.slug,
    index,
    score: Math.min(1, matches(c.words, title)) * 4 + Math.min(1, matches(c.words, hints)) + matches(c.words, description) + Math.min(1, matches(c.words, summary)) * 3
  })).filter(s => s.score >= 3);
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, 3).map(s => s.slug);
}
