import { lazy, Suspense, useEffect, useState } from "react";
import { C, LOGO_FILE } from "./event-poster";
import { PictureFinder } from "./poster-studio";

const DesignEditor = lazy(() => import("./design-editor").then(m => ({ default: m.DesignEditor })));

/** Requested (the chair, 11 Nov 2026): "What if I want to create a post about a contest?" - "Nyt opslag": its picture made in the editor, from a blank page or a
 * picture found (Pixabay, Pexels, Unsplash, art), then laid in the post (worker/cockpit/handler.ts, /plakater/frit-<id>/opslag) - back to the post to read and approve. */
type Data = { free: true; post: { id: number; title: string; text: string; image: string | null }; back: string };

const blankPage = (width: number, height: number) => {
  const c = document.createElement("canvas"); c.width = width; c.height = height;
  const ctx = c.getContext("2d")!; ctx.fillStyle = C.cream; ctx.fillRect(0, 0, width, height);
  return c.toDataURL("image/png");
};

export function FreePostStudio({ id }: { id: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    void fetch(`/plakater/${id}/data`, { headers: { accept: "application/json" } }).then(r => r.ok ? r.json() as Promise<Data> : null).catch(() => null).then(found => {
      setData(found); if (found) document.title = `Opslag: ${found.post.title} · Hjerterum admin`;
    });
    const img = new Image(); img.onload = () => setLogo(img); img.src = LOGO_FILE;
  }, [id]);
  if (!data) return <main className="page-shell site-page poster-page"><p className="poster-empty">Åbner opslaget …</p></main>;
  const use = async (blob: Blob) => {
    setMessage("Gemmer billedet …");
    const r = await fetch(`/plakater/${id}/opslag`, { method: "POST", headers: { "content-type": "image/jpeg" }, body: blob }).catch(() => null);
    const body = r?.ok ? await r.json().catch(() => null) as { back?: string } | null : null;
    if (!body) { setMessage("Billedet kunne ikke gemmes. Prøv igen."); return; }
    window.location.href = body.back ?? data.back;
  };
  const words = { title: data.post.title, rest: null, teacher: null, kicker: "", day: "", time: "", number: "", month: "" };
  return <main className="page-shell site-page poster-page studio">
    {message && <p className="studio-muted" role="status">{message}</p>}
    <Suspense fallback={<div className="ed"><p className="ed-busy">Åbner editoren …</p></div>}>
      <DesignEditor format="opslag" start={{ kind: "flat", image: data.post.image ?? blankPage(1080, 1350) }} input={{ words, colors: C, site: "", quote: null }} pictures={[]} photoUrl={null} logo={logo}
        onUse={blob => void use(blob)} onClose={() => { window.location.href = data.back; }} finder={chosen => <PictureFinder id={id} onChosen={chosen} />} />
    </Suspense>
  </main>;
}
