/** Requested: "Vis også de samme sociale links samt et kort og en rejseplan-integration" - the event page's way there (event-page.tsx). */
const TZ = "Europe/Copenhagen";
const pad = (n: number) => String(n).padStart(2, "0");
/** Rejseplanen with Hjerterum as the destination, arriving a quarter of an hour before the start (Copenhagen time). */
export function journeyUrl(address: string, startsAt: string): string {
  const at = new Date(Date.parse(startsAt) - 15 * 60_000);
  const part = (type: string) => new Intl.DateTimeFormat("da-DK", { timeZone: TZ, [type]: "2-digit", hourCycle: "h23" } as Intl.DateTimeFormatOptions).formatToParts(at).find((p) => p.type === type)?.value ?? "";
  const date = `${part("day")}.${part("month")}.${part("year").slice(-2)}`;
  const time = `${pad(Number(part("hour")))}:${part("minute")}`;
  const query = new URLSearchParams({ Z: address, ZADR: "1", timesel: "arrive", date, time });
  return `https://www.rejseplanen.dk/bin/query.exe/mn?${query.toString()}`;
}
/** OpenStreetMap, a small area around the house with a marker - no key, and no cookies of ours. */
export function mapUrl(lat: number, lon: number): { embed: string; open: string } {
  const d = 0.0025;
  return {
    embed: `https://www.openstreetmap.org/export/embed.html?bbox=${lon - d * 1.6},${lat - d},${lon + d * 1.6},${lat + d}&layer=mapnik&marker=${lat},${lon}`,
    open: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`
  };
}

