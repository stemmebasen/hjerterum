/** The organiser directory (/arrangoerer): who arranges what, where, and their regular offerings. The facts come from
 * each organiser's own website (the URL is kept with each offering); the descriptions are written for the portal.
 * A profile's slug is the organizer_id the collector gives its events, so the profile lists them. */

export type Offering = {
  /** "Gratis healingsmeditation onsdage i lige uger kl. 17.30–18.30" */
  text: string;
  /** Where the organiser states it. */
  source: string;
};

export type OrganizerProfile = {
  slug: string;
  name: string;
  /** One or two sentences, written for the portal. */
  about: string;
  area: string;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  lat: number | null;
  lon: number | null;
  website: string;
  /** Activity slugs (src/activities.ts) the organiser offers, for "Faste tilbud" on those pages. */
  activities: string[];
  offerings: Offering[];
  /** How the portal gets the organiser's events, shown on the profile. */
  eventsNote: string;
};

export const ORGANIZERS: OrganizerProfile[] = [
  {
    slug: "hjerterum",
    name: "Hjerterum",
    about: "Holistisk hus og forening midt i Aarhus med workshops, yoga, meditation, breathwork, lydrejser og fællesskab for medlemmer og gæster.",
    area: "aarhus", address: "Guldsmedgade 26B", postalCode: "8000", city: "Aarhus C", lat: 56.159318, lon: 10.207848,
    website: "https://hjerterum.info",
    activities: ["meditation", "yoga", "breathwork", "spiritualitet", "healing", "workshops", "faellesskaber"],
    offerings: [],
    eventsNote: "Hjerterums kalender hentes automatisk hver nat."
  },
  {
    slug: "lysets-hus",
    name: "Lysets Hus",
    about: "Foreningen Lysets hus i Aarhus midtby holder spirituelle foredrag og klarsynsaftener om onsdagen, med gratis healingsmeditation og alternativ prøvebehandling forud.",
    area: "aarhus", address: "Posthussmøgen 11C", postalCode: "8000", city: "Aarhus C", lat: 56.154679, lon: 10.20885,
    website: "https://lysetshus.dk/",
    activities: ["spiritualitet", "klarsyn", "spirituelle-foredrag", "healing", "meditationsgrupper"],
    offerings: [
      { text: "Gratis healingsmeditation onsdage i lige uger kl. 17.30–18.30", source: "https://lysetshus.dk/" },
      { text: "Gratis alternativ prøvebehandling onsdage i ulige uger kl. 17.30–18.45", source: "https://lysetshus.dk/" },
      { text: "Foredrag og klarsynsaftener onsdage kl. 19.00", source: "https://lysetshus.dk/" }
    ],
    eventsNote: "Programmet på lysetshus.dk hentes automatisk hver nat."
  },
  {
    slug: "brahma-kumaris-aarhus",
    name: "Brahma Kumaris Aarhus",
    about: "Meditationscenter med Raja Yoga-meditation, introaftener, kurser i positiv tænkning og selvindsigt samt stilhedsdage. Tilbuddene er non-profit.",
    area: "aarhus", address: "Ålborggade 22, 3. tv.", postalCode: "8000", city: "Aarhus C", lat: 56.143271, lon: 10.192211,
    website: "https://brahmakumaris.dk/",
    activities: ["meditation", "meditationsgrupper", "meditation-for-begyndere", "selvudvikling", "spiritualitet"],
    offerings: [
      { text: "Aftenmeditation mandag, tirsdag, torsdag og fredag kl. 18.30–19.20", source: "https://brahmakumaris.dk/events/" },
      { text: "Introduktionsaften i Raja Yoga-meditation søndage kl. 18.30–19.30", source: "https://brahmakumaris.dk/events/" },
      { text: "Videregående kursus i Raja Yoga-meditation mandage kl. 19.30–21.00", source: "https://brahmakumaris.dk/events/" }
    ],
    eventsNote: "Kurser, introaftener og retræter hentes automatisk hver nat fra Brahma Kumaris' kalender."
  },
  {
    slug: "buddhistisk-center-aarhus",
    name: "Buddhistisk Center Aarhus",
    about: "Diamantvejens buddhistiske center på Trøjborg med meditation i Karma Kagyü-traditionen. Det er gratis at deltage, og alle er velkomne.",
    area: "aarhus", address: "Peder Skrams Gade 52B, kld.", postalCode: "8200", city: "Aarhus N", lat: 56.173836, lon: 10.21666,
    website: "https://buddha.dk/centres/aarhus/",
    activities: ["meditation", "buddhistisk-meditation", "meditationsgrupper", "meditation-for-begyndere", "spiritualitet"],
    offerings: [
      { text: "16. Karmapa-meditation hver mandag kl. 17.00", source: "https://buddha.dk/centres/aarhus/" },
      { text: "16. Karmapa-meditation hver torsdag kl. 19.30", source: "https://buddha.dk/centres/aarhus/" },
      { text: "Introduktionsforedrag og meditation første torsdag i måneden kl. 18.30", source: "https://buddha.dk/centres/aarhus/" },
      { text: "Gratis – alle er velkomne", source: "https://buddha.dk/centres/aarhus/" }
    ],
    eventsNote: "Foredrag og særlige events hentes automatisk hver nat fra buddha.dk."
  },
  {
    slug: "dansk-center-for-mindfulness",
    name: "Dansk Center for Mindfulness",
    about: "Aarhus Universitets center for videnskabeligt funderet mindfulness: MBSR-forløb, Mindfulness Tools-internatkurser, seminardage om stress og daglig online meditation.",
    area: "aarhus", address: "Hack Kampmanns Plads 1-3, 4.", postalCode: "8000", city: "Aarhus C", lat: 56.155276, lon: 10.213034,
    website: "https://mindfulness.au.dk/",
    activities: ["mindfulness", "mbsr", "stress", "meditation", "workshops", "retreat"],
    offerings: [
      { text: "Gratis morgenmeditation mandag–fredag kl. 6–7 (online via Zoom)", source: "https://mindfulness.au.dk/kom-godt-i-gang/gaa-til-mindfulness" },
      { text: "Meditation 12 minutter kl. 12 (online)", source: "https://mindfulness.au.dk/" },
      { text: "Yoga tirsdag og torsdag kl. 17–18 (online)", source: "https://mindfulness.au.dk/" }
    ],
    eventsNote: "Kurser og seminardage hentes automatisk hver nat fra centrets arrangementsliste. Kurser uden fast sted i en by vises i kalenderen for hele Østjylland."
  },
  {
    slug: "center-for-selvudvikling",
    name: "Center for Selvudvikling",
    about: "Meditation og selvudvikling ved Jens og Ellen G. Enemark: terapeutisk arbejde med stress og traumer, fortløbende grupper og enneagramgruppe. Grupperne kræver en forsamtale.",
    area: "aarhus", address: "Frederiksgade 74E, 2. tv.", postalCode: "8000", city: "Aarhus C", lat: 56.154046, lon: 10.203462,
    website: "https://centerforselvudvikling.dk/",
    activities: ["selvudvikling", "meditation", "stress", "samtalegrupper"],
    offerings: [
      { text: "Fortløbende terapeutiske grupper og dagsgrupper – optagelse efter forsamtale", source: "https://centerforselvudvikling.dk/grupper/grupper-ved-jens/" }
    ],
    eventsNote: "Centret har ingen offentlig kalender med tider; se grupperne på centrets egen side."
  },
  {
    slug: "yoga-og-meditation-horsens",
    name: "Yoga & Meditation Horsens",
    about: "Yoga- og meditationsstudie i Horsens med hatha, yin, restorativ yoga, breathwork, meditation, MBSR-forløb og stresscoaching.",
    area: "horsens", address: "Sundvej 35", postalCode: "8700", city: "Horsens", lat: 55.864307, lon: 9.870072,
    website: "https://www.yogaogmeditation.dk/",
    activities: ["yoga", "yin-yoga", "meditation", "mindfulness", "mbsr", "stress", "breathwork"],
    offerings: [
      { text: "Hold i hatha, yin og restorativ yoga samt breathwork og meditation – altid 75 minutter", source: "https://www.yogaogmeditation.dk/" },
      { text: "Sangha, te og tema – én onsdag om måneden kl. 19–20.30", source: "https://www.yogaogmeditation.dk/events-2" },
      { text: "MBSR-forløb over 8 uger", source: "https://www.yogaogmeditation.dk/events-2" }
    ],
    eventsNote: "Studiets holdplan ligger i et bookingsystem, der ikke tillader automatisk hentning; se holdene på studiets egen side."
  },
  {
    slug: "vaekstcenteret",
    name: "Vækstcenteret",
    about: "Meditations- og retreatcenter ved Nørre Snede med stilhedsretreats, meditationsdage, kurser og spirituel psykologi. To programmer om året.",
    area: "horsens", address: "Rørbækvej 10", postalCode: "8766", city: "Nørre Snede", lat: 55.963837, lon: 9.390209,
    website: "https://vaekstcenteret.dk/",
    activities: ["meditation", "retreat", "stilhedsretreat", "spiritualitet", "selvudvikling", "workshops"],
    offerings: [
      { text: "Forårs- og efterårsprogram med retreats, meditationsdage og kurser", source: "https://vaekstcenteret.dk/kurser/" }
    ],
    eventsNote: "Kurser og retreats hentes automatisk hver nat fra Vækstcenterets kursusoversigt."
  },
  {
    slug: "gomde",
    name: "Gomde",
    about: "Buddhistisk retreatcenter og tempel på Helgenæs ved Knebel med daglig praksis, pujas, retreats og meditationskurser. Templet er åbent hver dag.",
    area: "djursland", address: "Smedehalden 3", postalCode: "8420", city: "Knebel", lat: 56.130005, lon: 10.540809,
    website: "https://gomde.dk/",
    activities: ["buddhistisk-meditation", "meditation", "retreat", "stilhedsretreat", "spiritualitet"],
    offerings: [
      { text: "Daglig morgenpraksis i templet kl. 8.30–9.30", source: "https://gomde.dk/daily-temple-calendar/" },
      { text: "Daglig eftermiddagspraksis kl. 17.00–18.30", source: "https://gomde.dk/daily-temple-calendar/" },
      { text: "Individuelle retreats og halv-arbejdsretreats efter aftale", source: "https://gomde.dk/" }
    ],
    eventsNote: "Gomdes programmer og retreats står på gomde.dk; de hentes ikke automatisk endnu."
  },
  {
    slug: "favn-aarhus",
    name: "Favn Aarhus",
    about: "Hus for yoga, bevægelse og behandling i Aarhus med ugentlige hold i mediyoga, hormonyoga og mindful yoga, workshops, ceremonier og yogaretreats.",
    area: "aarhus", address: "Jægergårdsgade 14, 2.", postalCode: "8000", city: "Aarhus C", lat: 56.147952, lon: 10.197783,
    website: "https://favnaarhus.dk/",
    activities: ["yoga", "yin-yoga", "meditation", "mindfulness", "dans", "kakaoceremoni", "workshops", "retreat", "holistisk-sundhed", "kvinde-og-mandegrupper"],
    offerings: [
      { text: "Ugentlige hold i mediyoga, hormonyoga og mindful yoga – se holdkalenderen", source: "https://favnaarhus.dk/book-yoga-aarhus/" },
      { text: "Workshops, kakaoceremonier og pop up-yoga flere gange om måneden", source: "https://favnaarhus.dk/workshop-kalender-aarhus/" }
    ],
    eventsNote: "Workshops hentes automatisk hver nat fra Favns workshopkalender. Ugentlige hold bookes i Favns holdkalender."
  },
  {
    slug: "skandinavisk-yoga-og-meditationsskole-aarhus",
    name: "Skandinavisk Yoga og Meditationsskole Aarhus",
    about: "Yogaskolen i Aarhus, en del af Skandinavisk Yoga og Meditationsskole, har siden 1975 undervist i klassisk yoga, afspænding og meditation – i Vestergade 45 siden 1983. Skolen ledes af Laxmi og Gunnar Petersen.",
    area: "aarhus", address: "Vestergade 45, baghuset", postalCode: "8000", city: "Aarhus C", lat: 56.157457, lon: 10.201182,
    website: "https://yogaskolen.dk/",
    activities: ["yoga", "meditation", "mindfulness", "meditation-for-begyndere", "retreat"],
    offerings: [
      { text: "Gratis prøvetime i yoga, afspænding og meditation de fleste torsdage kl. 20–21", source: "https://yogaskolen.dk/holdtyper" },
      { text: "Meditation, klassisk mindful yoga & afspænding og yoga in English – enkeltklasser eller holdforløb over 8 gange", source: "https://yogaskolen.dk/holdtyper" },
      { text: "Senioryoga 60+, gravidyoga og efterfødselsyoga", source: "https://yogaskolen.dk/holdtyper" },
      { text: "3-timers søndagsyoga, jule- og påskekursus som gå-hjem-retreat, yoga-detox og kirtan", source: "https://yogaskolen.dk/events" },
      { text: "Yogaretreats på 3 og 5 dage på Mors", source: "https://yogaskolen.dk/yogaferier" }
    ],
    eventsNote: "Skolens ugeskema og events ligger i bookingsystemet YOGO, som ikke tillader automatisk hentning; se dem på yogaskolen.dk."
  },
  {
    slug: "yo-studios",
    name: "YO Studios",
    about: "Træningsstudie i Scandinavian Center i Aarhus C og i Højbjerg med yoga fra rolig yin til dynamisk vinyasa – side om side med pilates, barre og dans.",
    area: "aarhus", address: "Margrethepladsen 4, 1. sal", postalCode: "8000", city: "Aarhus C", lat: 56.15277, lon: 10.19707,
    website: "https://www.yostudios.dk/",
    activities: ["yoga", "yin-yoga"],
    offerings: [
      { text: "Yogahold fra yin til vinyasa i Scandinavian Center (Margrethepladsen 4) og i Højbjerg (Oddervej 157)", source: "https://www.yostudios.dk/dk/find-studio" },
      { text: "Events som yoga & poesi – mange er gratis og åbne for alle", source: "https://www.yostudios.dk/dk/events" }
    ],
    eventsNote: "Holdplan og events ligger i bookingsystemet YOGO, som ikke tillader automatisk hentning; se dem på yostudios.dk."
  }
];

const BY_SLUG = new Map(ORGANIZERS.map(o => [o.slug, o]));
export const organizerBySlug = (slug: string): OrganizerProfile | undefined => BY_SLUG.get(slug);

/** Profiles offering an activity, optionally in one area. */
export const organizersFor = (activity: string, area: string | null): OrganizerProfile[] =>
  ORGANIZERS.filter(o => o.activities.includes(activity) && (!area || o.area === area));
