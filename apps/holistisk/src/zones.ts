/** The calendar's "Område" filter: four parts of the Aarhus area, named from the city centre (Midtbyen, Nord, Syd,
 * Vest). The towns around Aarhus belong to the part in their direction: Randers and Djursland to Nord, Silkeborg to
 * Vest, Skanderborg and Horsens to Syd. An event is placed by its postcode; without one by its town's name; without
 * that by its position. Events none of these place (further away) are only shown when no part is chosen.
 *
 * The placing is one SQL expression (zoneSql), so it works on events already stored, and new sources need nothing. */

export type Zone = "midtbyen" | "nord" | "syd" | "vest";

type ZoneDef = { slug: Zone; label: string; postcodes: Array<[number, number]>; towns: string[] };

const r = (from: number, to = from): [number, number] => [from, to];

export const ZONES: ZoneDef[] = [
  {
    slug: "midtbyen", label: "Midtbyen",
    postcodes: [r(8000, 8099)],
    towns: ["aarhus", "århus", "aarhus c", "århus c"]
  },
  {
    slug: "nord", label: "Nord",
    // Aarhus N, Risskov, Egå, Hadsten, Trige, Hinnerup, Djursland, Lystrup, Hjortshøj, Skødstrup, Randers.
    postcodes: [r(8200), r(8240, 8259), r(8370), r(8380), r(8382), r(8400, 8444), r(8500, 8599), r(8870, 8879), r(8900, 8999)],
    towns: ["aarhus n", "århus n", "risskov", "egå", "lystrup", "skødstrup", "hjortshøj", "lisbjerg", "trige", "hadsten", "hinnerup", "randers", "langå", "hornslet", "ebeltoft", "rønde", "grenaa", "grenå", "auning", "mørke", "ryomgård", "kolind"]
  },
  {
    slug: "syd", label: "Syd",
    // Viby, Højbjerg, Odder, Tranbjerg, Mårslet, Beder, Malling, Solbjerg, Hasselager, Hørning, Skanderborg, Ry, Horsens.
    postcodes: [r(8260, 8369), r(8660, 8799)],
    towns: ["viby", "viby j", "højbjerg", "odder", "tranbjerg", "tranbjerg j", "mårslet", "beder", "malling", "solbjerg", "hasselager", "hørning", "skanderborg", "ry", "horsens", "hedensted", "brædstrup", "nørre snede"]
  },
  {
    slug: "vest", label: "Vest",
    // Aarhus V, Brabrand, Åbyhøj, Tilst, Hammel, Harlev, Galten, Sabro, Silkeborg.
    postcodes: [r(8210, 8239), r(8381), r(8450, 8499), r(8600, 8659), r(8880, 8883)],
    towns: ["aarhus v", "århus v", "brabrand", "åbyhøj", "tilst", "hammel", "harlev", "galten", "skovby", "sabro", "silkeborg", "kjellerup", "gjern", "them"]
  }
];

export const zoneBySlug = (slug: string | null | undefined): ZoneDef | undefined => ZONES.find(z => z.slug === slug);

/** The centre of Aarhus (Store Torv) and how far Midtbyen reaches from it, for events placed by position only. */
const CENTRE = { lat: 56.1572, lon: 10.2107 };
const MIDTBYEN_KM = 2.2;
/** km per degree, at Aarhus. */
const KM_LAT = 111.2, KM_LON = 62.1;

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** The zone of the events row `e`, or NULL. Postcode first, then the town, then the position (inside about 2 km of the
 * centre is Midtbyen; otherwise the direction: north, south, west, and east counts as Nord, the Djursland side). */
export function zoneSql(e = "e"): string {
  const pc = `CAST(trim(${e}.postal_code) AS INTEGER)`;
  const hasPc = `(COALESCE(trim(${e}.postal_code), '') GLOB '[0-9][0-9][0-9][0-9]')`;
  const town = `lower(trim(${e}.city))`;
  const byPostcode = ZONES.map(z => `WHEN ${hasPc} AND (${z.postcodes.map(([a, b]) => a === b ? `${pc} = ${a}` : `${pc} BETWEEN ${a} AND ${b}`).join(" OR ")}) THEN '${z.slug}'`);
  const byTown = ZONES.map(z => `WHEN NOT ${hasPc} AND ${town} IN (${z.towns.map(quote).join(",")}) THEN '${z.slug}'`);
  const dy = `((${e}.lat - ${CENTRE.lat}) * ${KM_LAT})`;
  const dx = `((${e}.lon - ${CENTRE.lon}) * ${KM_LON})`;
  const byPosition = [
    `WHEN NOT ${hasPc} AND ${e}.lat IS NOT NULL AND ${e}.lon IS NOT NULL AND abs(${dy}) <= ${MIDTBYEN_KM} AND abs(${dx}) <= ${MIDTBYEN_KM} THEN 'midtbyen'`,
    `WHEN NOT ${hasPc} AND ${e}.lat IS NOT NULL AND ${e}.lon IS NOT NULL AND ${dy} >= abs(${dx}) THEN 'nord'`,
    `WHEN NOT ${hasPc} AND ${e}.lat IS NOT NULL AND ${e}.lon IS NOT NULL AND -${dy} >= abs(${dx}) THEN 'syd'`,
    `WHEN NOT ${hasPc} AND ${e}.lat IS NOT NULL AND ${e}.lon IS NOT NULL AND ${dx} < 0 THEN 'vest'`,
    `WHEN NOT ${hasPc} AND ${e}.lat IS NOT NULL AND ${e}.lon IS NOT NULL THEN 'nord'`
  ];
  return `(CASE ${[...byPostcode, ...byTown, ...byPosition].join(" ")} ELSE NULL END)`;
}
