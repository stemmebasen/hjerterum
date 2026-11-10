import { describe, expect, it } from "vitest";
import { isSeries, seriesReason } from "../src/series.js";

const START = Date.parse("2026-11-12T17:30:00Z");
const ev = (title: string, description = "", hours: number | null = 2) =>
  ({ title, description, startsAt: START, endsAt: hours === null ? null : START + hours * 3600_000 });

describe("single events only", () => {
  it("leaves out courses, season groups and long retreats", () => {
    for (const e of [
      ev("Women Gathers | 3 mdr. Forløb | Opstart 1.10.", "Women Gathers | 3 måneders forløb\n\nopstart tors. d. 1.10. | 18.30 - 21"),
      ev("VIDEREGÅENDE FORDYBELSE OG PRAKSIS gr. A, 6. år", "", 54),
      ev("Den spirituelle organisme – et tremåneders retreat", "", 2164),
      ev("Vejen hjem - shamanistisk uddannelse", "VEJEN HJEM er en uddannelse for dig der ønsker at vække dig selv"),
      ev("DREJEKURSUS med glasering", "3-dages drejekursus for begyndere På dette kursus vil du blive meget klogere på ler"),
      ev("Mindfulness for begyndere", "Kurset består af 8 gange á 2 timer."),
      ev("Sorgforløb for efterladte"),
      ev("Yoga for gravide", "Et 6 ugers forløb hvor vi mødes hver tirsdag."),
      ev("Kor for alle", "Tilmelding til hele forløbet via hjemmesiden."),
      ev("Teaterklub – abonnement 2027")
    ]) expect(seriesReason(e), e.title).not.toBeNull();
  });

  it("keeps single evenings, drop-in classes and weekend retreats", () => {
    for (const e of [
      ev("Et Kursus i Mirakler - Udviklings og delings gruppe", "for praktiserende/studerende af Et kursus i Mirakler"),
      ev("Marianne Vihøj: Kvalitetssikring i uddannelse - hvor kom den idé fra?", "Oplev et aktuelt foredrag om kvalitetssikring i uddannelse"),
      ev("Smykkekursus: Lav din egen ring", "Intro-kursus til Smykkeværkstedet"),
      ev("Introkursus i Raja Yoga Meditation", "", 1.5),
      ev("Spejlingsfællesskab for kvinder med adhd 35+", "jeg tilbyder coachingforløb, bevægelsesfællesskaber eller foredrag. En billet koster 299,-"),
      ev("Restorative Sound & Yoga - Fall Afternoons", "10 restorative afternoons. 225 DKK for drop in, 1575 DKK for all 10 sessions. A 10-week course."),
      ev("Saunagus - Hold 2. kl. 11.00 - 12.00", "", 1),
      ev("Vækstcenterets tantra", "", 54.3),
      ev("Stilhedsretreat på Vækstcenteret", "", 114),
      ev("Dig & din baby - Babymassage og zoneterapi", "For babyer på 2-10 måneder og deres forældre"),
      ev("Mediterende Yoga | Onsdage 16-17.20", "Members Free | non-members 75 kr."),
      ev("Godsbanens Julemarked 2026", "", 48),
      ev("Workshop: 1-dages kursus i akvarel"),
      ev("Koncert", "", null)
    ]) expect(isSeries(e), e.title).toBe(false);
  });
});
