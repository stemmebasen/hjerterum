/** Geography. Denmark is divided into regions (landsdele), each into areas. An event is placed by its postcode
 * (Danish postcodes are geographic), else by its town's name. Which regions the portal shows is configuration
 * (ACTIVE_REGIONS), so widening the portal to more of Denmark is a config change, plus finer areas here when wanted.
 * Events outside the active regions are still stored; they simply are not listed. */

export type Area = {
  slug: string;
  name: string;
  region: string;
  /** Inclusive postcode ranges. */
  postcodes: Array<[number, number]>;
  /** Town names (lower case) used when an event has no postcode. */
  towns: string[];
  /** A rough centre, for "near me". */
  centre: { lat: number; lon: number };
};

export type Region = { slug: string; name: string };

export const REGIONS: Region[] = [
  { slug: "ostjylland", name: "Østjylland" },
  { slug: "nordjylland", name: "Nordjylland" },
  { slug: "midt-vestjylland", name: "Midt- og Vestjylland" },
  { slug: "sydjylland", name: "Syd- og Sønderjylland" },
  { slug: "fyn", name: "Fyn og øerne" },
  { slug: "sjaelland", name: "Sjælland" },
  { slug: "hovedstaden", name: "København og Nordsjælland" },
  { slug: "bornholm", name: "Bornholm" }
];

const r = (from: number, to = from): [number, number] => [from, to];

/** Østjylland is split into the launch areas. The other regions are one area each until they are opened and split. */
export const AREAS: Area[] = [
  {
    slug: "aarhus", name: "Aarhus og omegn", region: "ostjylland",
    postcodes: [r(8000, 8099), r(8200, 8270), r(8300, 8361), r(8370, 8382), r(8450, 8463), r(8465, 8472), r(8520, 8541)],
    towns: ["aarhus", "århus", "risskov", "viby", "højbjerg", "brabrand", "åbyhøj", "egå", "lystrup", "skødstrup", "hjortshøj", "tranbjerg", "mårslet", "beder", "malling", "solbjerg", "hasselager", "odder", "hadsten", "hinnerup", "trige", "tilst", "sabro", "hammel", "harlev", "lisbjerg"],
    centre: { lat: 56.1572, lon: 10.2107 }
  },
  {
    slug: "randers", name: "Randers", region: "ostjylland",
    postcodes: [r(8870), r(8900, 8940), r(8960), r(8970, 8990)],
    towns: ["randers", "langå", "havndal", "spentrup", "gjerlev", "fårup", "assentoft"],
    centre: { lat: 56.4607, lon: 10.0364 }
  },
  {
    slug: "djursland", name: "Djursland", region: "ostjylland",
    postcodes: [r(8400, 8444), r(8500), r(8543, 8592), r(8950), r(8961, 8963)],
    towns: ["ebeltoft", "rønde", "knebel", "balle", "grenaa", "grenå", "hornslet", "mørke", "ryomgård", "kolind", "trustrup", "nimtofte", "glesborg", "ørum djurs", "anholt", "ørsted", "allingåbro", "auning", "mols", "femmøller", "kalø"],
    centre: { lat: 56.3500, lon: 10.6500 }
  },
  {
    slug: "silkeborg", name: "Silkeborg", region: "ostjylland",
    postcodes: [r(8600, 8643), r(8653, 8654), r(8882, 8883)],
    towns: ["silkeborg", "kjellerup", "lemming", "sorring", "ans", "them", "bryrup", "fårvang", "gjern", "virklund"],
    centre: { lat: 56.1697, lon: 9.5451 }
  },
  {
    slug: "skanderborg", name: "Skanderborg", region: "ostjylland",
    postcodes: [r(8362), r(8464), r(8660, 8680)],
    towns: ["skanderborg", "ry", "låsby", "galten", "hørning", "stilling", "skovby"],
    centre: { lat: 56.0384, lon: 9.9298 }
  },
  {
    slug: "horsens", name: "Horsens", region: "ostjylland",
    postcodes: [r(8700, 8783)],
    towns: ["horsens", "hedensted", "brædstrup", "østbirk", "gedved", "hovedgård", "juelsminde", "løsning", "nørre snede", "hornsyld"],
    centre: { lat: 55.8607, lon: 9.8503 }
  },
  { slug: "nordjylland", name: "Nordjylland", region: "nordjylland", postcodes: [r(7700, 7999), r(9000, 9999)], towns: ["aalborg", "hjørring", "frederikshavn", "thisted", "skagen"], centre: { lat: 57.0488, lon: 9.9217 } },
  { slug: "midt-vestjylland", name: "Midt- og Vestjylland", region: "midt-vestjylland", postcodes: [r(6900, 7699), r(8800, 8850), r(8860, 8869), r(8880, 8881)], towns: ["viborg", "herning", "holstebro", "skive", "ikast", "ringkøbing", "struer", "bjerringbro"], centre: { lat: 56.2, lon: 9.0 } },
  { slug: "sydjylland", name: "Syd- og Sønderjylland", region: "sydjylland", postcodes: [r(6000, 6899), r(7000, 7399)], towns: ["kolding", "vejle", "fredericia", "esbjerg", "haderslev", "aabenraa", "sønderborg", "tønder", "billund", "ribe", "varde"], centre: { lat: 55.5, lon: 9.3 } },
  { slug: "fyn", name: "Fyn og øerne", region: "fyn", postcodes: [r(5000, 5999)], towns: ["odense", "svendborg", "nyborg", "middelfart", "faaborg", "assens"], centre: { lat: 55.3959, lon: 10.3883 } },
  { slug: "sjaelland", name: "Sjælland", region: "sjaelland", postcodes: [r(4000, 4999)], towns: ["roskilde", "næstved", "holbæk", "slagelse", "køge", "ringsted", "nykøbing f", "kalundborg"], centre: { lat: 55.45, lon: 11.75 } },
  { slug: "hovedstaden", name: "København og Nordsjælland", region: "hovedstaden", postcodes: [r(1000, 3699)], towns: ["københavn", "frederiksberg", "hillerød", "helsingør", "lyngby", "gentofte", "hellerup", "valby", "amager"], centre: { lat: 55.6761, lon: 12.5683 } },
  { slug: "bornholm", name: "Bornholm", region: "bornholm", postcodes: [r(3700, 3799)], towns: ["rønne", "nexø", "svaneke", "gudhjem", "allinge"], centre: { lat: 55.1, lon: 14.9 } }
];

const AREA_BY_SLUG = new Map(AREAS.map(a => [a.slug, a]));
export const areaBySlug = (slug: string): Area | undefined => AREA_BY_SLUG.get(slug);
export const regionBySlug = (slug: string): Region | undefined => REGIONS.find(r => r.slug === slug);

export function areaForPostcode(postcode: string | null | undefined): Area | null {
  const n = Number(/^\s*(\d{4})\s*$/.exec(postcode ?? "")?.[1]);
  if (!Number.isFinite(n) || n < 1000) return null;
  return AREAS.find(a => a.postcodes.some(([from, to]) => n >= from && n <= to)) ?? null;
}

export function areaForTown(town: string | null | undefined): Area | null {
  const t = (town ?? "").toLowerCase().replace(/\s+[cnsvø]{1,2}$/i, "").trim();
  if (!t) return null;
  return AREAS.find(a => a.towns.includes(t)) ?? AREAS.find(a => a.towns.some(name => new RegExp(`(^|[^a-zæøå])${name}([^a-zæøå]|$)`).test(t))) ?? null;
}

/** Postcode first; else the town; else any known town named in a free-text location. */
export function placeEvent(input: { postalCode?: string | null; city?: string | null; freeText?: string | null }): Area | null {
  return areaForPostcode(input.postalCode) ?? areaForTown(input.city) ?? (input.freeText ? areaForTown(input.freeText) : null);
}

/** ACTIVE_REGIONS ("ostjylland,fyn") to the known region slugs it names. Unknown names are ignored; empty means Østjylland. */
export function activeRegions(config: string | undefined): string[] {
  const wanted = (config ?? "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  const known = wanted.filter(slug => REGIONS.some(r => r.slug === slug));
  return known.length ? known : ["ostjylland"];
}

export const activeAreas = (regions: string[]): Area[] => AREAS.filter(a => regions.includes(a.region));

/** Distance in km, for "near me". */
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
