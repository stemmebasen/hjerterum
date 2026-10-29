import { useEffect, useState } from "react";

/** Requested (Opret event): "Kom her med typewriter eksempler i hvert felt". An empty field's placeholder writes an example letter by letter,
 * holds it, rubs it out and writes the next - so a member sees what a good title or text can be. It stops while the field is in use (the
 * placeholder is not shown then anyway), when the tab is hidden, and never moves with "reduce motion": then the first example just stands. */
const TYPE_MS = 45, ERASE_MS = 18, HOLD_MS = 2400, PAUSE_MS = 500;

export function useTypewriter(examples: readonly string[], prefix = "Fx "): string {
  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [text, setText] = useState(reduced ? prefix + (examples[0] ?? "") : prefix);
  useEffect(() => {
    if (reduced || !examples.length) return;
    let example = 0, shown = 0, erasing = false, timer = 0;
    const step = () => {
      if (document.hidden) { timer = window.setTimeout(step, 1000); return; }
      const full = examples[example % examples.length]!;
      if (!erasing && shown < full.length) { shown++; setText(prefix + full.slice(0, shown)); timer = window.setTimeout(step, TYPE_MS); return; }
      if (!erasing) { erasing = true; timer = window.setTimeout(step, HOLD_MS); return; }
      if (shown > 0) { shown = Math.max(0, shown - 3); setText(prefix + full.slice(0, shown)); timer = window.setTimeout(step, ERASE_MS); return; }
      erasing = false; example++; timer = window.setTimeout(step, PAUSE_MS);
    };
    timer = window.setTimeout(step, 600);
    return () => window.clearTimeout(timer);
  }, [reduced, prefix, examples]);
  return text;
}

/** Examples in Hjerterum's own tone (see Saga's EVENTTEKSTER): warm, concrete, no promises of healing. */
export const TITLE_EXAMPLES = ["Yin yoga og lydbad", "Kakaoceremoni med fællessang", "Åndedræt for begyndere", "Fuldmånemeditation", "Foredrag: Nervesystemet i balance", "Ecstatic dance"] as const;
export const DESCRIPTION_EXAMPLES = [
  "En rolig aften med yin yoga og lydbad. Vi lander i kroppen med blide stillinger og slutter med gongens toner. For alle – også begyndere. Medbring varmt tøj og en vandflaske.",
  "Vi samles om en kop ceremoniel kakao, synger enkle sange sammen og deler, hvad der rører sig. Ingen forudsætninger – kom som du er.",
  "Et introforløb i åndedræt: tre enkle teknikker, du kan bruge i hverdagen. Vi øver sammen og slutter med en guidet afspænding. Medbring et tæppe."
] as const;
export const ATTENDEE_EXAMPLES = ["12", "20", "30"] as const;
export const PRICE_EXAMPLES = ["150", "200", "100"] as const;
