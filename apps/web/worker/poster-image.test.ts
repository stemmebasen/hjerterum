import { describe, expect, it } from "vitest";
import { posterImage, posterImageAllowed } from "./poster-image";

describe("the poster's photo pass-through", () => {
  it("lets only the membership system's photos through", () => {
    expect(posterImageAllowed("https://d1tif55lvfk8gc.cloudfront.net/6abba949e1a89220c3050d27.jpg?1786711170")).toBe(true);
    expect(posterImageAllowed("https://evil.example/6abba949.jpg")).toBe(false);
    expect(posterImageAllowed("https://d1tif55lvfk8gc.cloudfront.net.evil.example/x.jpg")).toBe(false);
    expect(posterImageAllowed("https://d1tif55lvfk8gc.cloudfront.net/../secret")).toBe(false);
    expect(posterImageAllowed(null)).toBe(false);
  });

  it("passes a picture on and refuses what is not one", async () => {
    const src = "https://d1tif55lvfk8gc.cloudfront.net/a.jpg";
    const ok = await posterImage(src, (async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } })) as unknown as typeof fetch);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/jpeg");
    const html = await posterImage(src, (async () => new Response("<html>", { headers: { "content-type": "text/html" } })) as unknown as typeof fetch);
    expect(html.status).toBe(404);
    expect((await posterImage("https://example.com/a.jpg")).status).toBe(400);
  });
});
