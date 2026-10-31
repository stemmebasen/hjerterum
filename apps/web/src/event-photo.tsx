import { useState, type CSSProperties } from "react";

/** Requested: "Eventfoto dimensionerne skal passe alle steder". An event's photo is shown in Facebook's event size everywhere -
 * 1920 × 1005 (1.91:1), the size the event form makes (cover-crop.ts). A photo of that shape fills the frame; one of another shape
 * (often a poster from the membership system, with text to its edges) is shown whole, on a soft blurred copy of itself, never cut. */
export const EVENT_PHOTO_RATIO = 1920 / 1005;

export function EventPhoto({ src, className = "", onError }: { src: string; className?: string; onError?: () => void }) {
  const [whole, setWhole] = useState(false);
  const style = { "--event-photo": `url("${src.replace(/["\\\n]/g, "")}")` } as CSSProperties;
  return <span className={"event-photo" + (whole ? " is-whole" : "") + (className ? " " + className : "")} style={style}>
    <img src={src} alt="" loading="lazy" decoding="async" onError={onError}
      onLoad={(e) => { const img = e.currentTarget; if (img.naturalWidth && img.naturalHeight) setWhole(Math.abs(img.naturalWidth / img.naturalHeight / EVENT_PHOTO_RATIO - 1) > 0.06); }} />
  </span>;
}
