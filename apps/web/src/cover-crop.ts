/** Requested: "cropløsning, så vi cropper til de aktuelle standarder": a photo is cut to the middle 1920 × 1005 px (Facebook's event cover) in the browser.
 * It is never enlarged - a photo with less than 1920 × 1005 px of picture is refused. */
export const COVER_WIDTH = 1920;
export const COVER_HEIGHT = 1005;

export type CropPlan = { ok: true; sx: number; sy: number; sw: number; sh: number } | { ok: false; reason: string };

/** The part of a width × height picture to keep: the biggest 1.91:1 piece, from the middle (or `focus` 0-1 along the side that is cut). */
export function planCrop(width: number, height: number, focus = 0.5): CropPlan {
  const ratio = COVER_WIDTH / COVER_HEIGHT;
  const sw = Math.min(width, Math.round(height * ratio)), sh = Math.min(height, Math.round(width / ratio));
  if (sw < COVER_WIDTH || sh < COVER_HEIGHT) return { ok: false, reason: `Billedet er for lille: det skal have mindst ${COVER_WIDTH} × ${COVER_HEIGHT} px, og dit er ${width} × ${height} px.` };
  return { ok: true, sx: Math.round((width - sw) * focus), sy: Math.round((height - sh) * focus), sw, sh };
}

/** The photo as a 1920 × 1005 jpg file, or the reason it cannot be one. */
export async function cropCover(file: File): Promise<{ ok: true; file: File } | { ok: false; reason: string }> {
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); } catch { return { ok: false, reason: "Billedet kunne ikke læses. Brug en jpg eller png." }; }
  const plan = planCrop(bitmap.width, bitmap.height);
  if (!plan.ok) return plan;
  const canvas = document.createElement("canvas");
  canvas.width = COVER_WIDTH; canvas.height = COVER_HEIGHT;
  canvas.getContext("2d")!.drawImage(bitmap, plan.sx, plan.sy, plan.sw, plan.sh, 0, 0, COVER_WIDTH, COVER_HEIGHT);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) return { ok: false, reason: "Billedet kunne ikke beskæres." };
  return { ok: true, file: new File([blob], file.name.replace(/\.[^.]+$/, "") + "-1920x1005.jpg", { type: "image/jpeg" }) };
}
