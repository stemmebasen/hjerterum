import { useEffect, useRef, useState } from "react";
import { PHOTO_SIZE } from "../public-profile";

/** Requested: "Billedet formateres til et rundt billede og man skal kunne croppe det." The photo in a round frame: drag it into place and
 * zoom with the slider; "Brug billedet" cuts what is inside the circle to a 480 × 480 jpg. */
const VIEW = 260;

export function PhotoCropper({ file, onDone, onCancel }: { file: File; onDone: (blob: Blob) => void; onCancel: () => void }) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [problem, setProblem] = useState("");
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (Math.min(img.naturalWidth, img.naturalHeight) < 200) setProblem("Billedet er for lille. Brug et billede på mindst 200 × 200 px.");
      else setImage(img);
    };
    img.onerror = () => setProblem("Billedet kunne ikke læses. Brug en jpg eller png.");
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);
  // The image covers the circle at zoom 1; offsets are kept so it always does.
  const base = image ? VIEW / Math.min(image.naturalWidth, image.naturalHeight) : 1;
  const scale = base * zoom;
  const w = image ? image.naturalWidth * scale : VIEW, h = image ? image.naturalHeight * scale : VIEW;
  const clamp = (o: { x: number; y: number }) => ({ x: Math.min(0, Math.max(VIEW - w, o.x)), y: Math.min(0, Math.max(VIEW - h, o.y)) });
  useEffect(() => { if (image) setOffset(clamp({ x: (VIEW - w) / 2, y: (VIEW - h) / 2 })); }, [image]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setOffset((o) => clamp(o)); }, [zoom]); // eslint-disable-line react-hooks/exhaustive-deps
  function done() {
    if (!image) return;
    const canvas = document.createElement("canvas");
    canvas.width = PHOTO_SIZE; canvas.height = PHOTO_SIZE;
    canvas.getContext("2d")!.drawImage(image, -offset.x / scale, -offset.y / scale, VIEW / scale, VIEW / scale, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
    canvas.toBlob((blob) => { if (blob) onDone(blob); else setProblem("Billedet kunne ikke beskæres."); }, "image/jpeg", 0.88);
  }
  if (problem) return <div className="photo-cropper"><p role="alert">{problem}</p><button type="button" className="text-button" onClick={onCancel}>Vælg et andet billede</button></div>;
  if (!image) return <div className="photo-cropper"><p role="status">Henter billedet …</p></div>;
  return (
    <div className="photo-cropper">
      <div className="photo-crop-view" style={{ width: VIEW, height: VIEW }}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }; }}
        onPointerMove={(e) => { const d = drag.current; if (d) setOffset(clamp({ x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y })); }}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
        <img src={image.src} alt="" draggable={false} style={{ width: w, height: h, transform: `translate(${offset.x}px, ${offset.y}px)` }} />
      </div>
      <label className="photo-zoom">Zoom<input type="range" min={1} max={3} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} /></label>
      <p className="profile-note">Træk billedet på plads i rammen, og zoom ind med skyderen.</p>
      <div className="workspace-actions">
        <button type="button" className="pill-button dark" onClick={done}>Brug billedet</button>
        <button type="button" className="text-button" onClick={onCancel}>Fortryd</button>
      </div>
    </div>
  );
}
