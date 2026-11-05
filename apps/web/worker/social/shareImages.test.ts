import { describe, expect, it } from "vitest";
import { freshInstagramImages } from "./meta.js";

// Reported (the chair, 5 Nov 2026): "Fejlede Deling fra kunet_menneske - meta_400: Unsupported get request. Object with ID '18484839364115159' does not exist,
// cannot be loaded due to missing permissions".
const GRAPH = "https://graph.facebook.com/v25.0";

describe("a tagged Instagram post's pictures, when it is passed on", () => {
  it("are read from Hjerterum's own tags when the post cannot be read by its id, else the ones kept", async () => {
    const calls: string[] = [];
    const fetcher = (tags: unknown[]): typeof fetch => async input => {
      const path = String(input).slice(GRAPH.length).split("?")[0]!;
      calls.push(path);
      if (path === "/18484839364115159") return new Response(JSON.stringify({ error: { message: "Unsupported get request.", code: 100 } }), { status: 400 });
      return new Response(JSON.stringify({ data: tags }));
    };
    const account = { igUserId: "17841", token: "t" };
    const fresh = await freshInstagramImages(fetcher([{ id: "18484839364115159", media_type: "IMAGE", media_url: "https://cdn.example/fresh.jpg", username: "kunet_menneske" }]), account, "18484839364115159", ["https://cdn.example/old.jpg"]);
    expect(fresh).toEqual(["https://cdn.example/fresh.jpg"]);
    expect(calls).toEqual(["/18484839364115159", "/17841/tags"]);
    expect(await freshInstagramImages(fetcher([]), account, "18484839364115159", ["https://cdn.example/old.jpg"])).toEqual(["https://cdn.example/old.jpg"]);
  });
});
