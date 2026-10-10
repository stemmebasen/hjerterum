import { describe, expect, it } from "vitest";
import { parsePublicProfile } from "../public-profile.js";
import { profilePhoto } from "./public-profiles.js";

// Requested: a round photo on the visit card, cut in the browser to 480 × 480.
const base = { name: "Anna", title: "Yogalærer", bio: "Hej", topics: "", teaching: true, treatment: false };

describe("the visit card's photo", () => {
  it("only takes the worker's own photo address", () => {
    expect(parsePublicProfile({ ...base, photoUrl: "/api/profile-photos/3f6c2a1e-1111-4222-8333-444455556666.jpg" }).photoUrl).toBe("/api/profile-photos/3f6c2a1e-1111-4222-8333-444455556666.jpg");
    expect(parsePublicProfile({ ...base, photoUrl: "" }).photoUrl).toBeUndefined();
    for (const bad of ["https://evil.example/x.jpg", "/api/profile-photos/../x.jpg", "javascript:alert(1)"]) expect(() => parsePublicProfile({ ...base, photoUrl: bad })).toThrow("invalid_profile");
  });
  it("is served from the bucket, and nothing else is", async () => {
    const objects = new Map([["portraits/3f6c2a1e-1111-4222-8333-444455556666.jpg", new Uint8Array([0xff, 0xd8, 0xff]).buffer]]);
    const env = { EVENT_MEDIA: { put: async () => undefined, delete: async () => undefined, get: async (k: string) => objects.has(k) ? { body: new Response(objects.get(k)!).body! } : null } };
    expect((await profilePhoto("3f6c2a1e-1111-4222-8333-444455556666", env)).headers.get("content-type")).toBe("image/jpeg");
    expect((await profilePhoto("00000000-0000-0000-0000-000000000000", env)).status).toBe(404);
  });
});

it("takes a website without https:// and adds it", () => {
  const base2 = { name: "Anna", title: "Yogalærer", bio: "Hej", topics: "", teaching: true, treatment: false };
  expect(parsePublicProfile({ ...base2, websiteUrl: "www.jacobhauge.com" }).websiteUrl).toBe("https://www.jacobhauge.com/");
  expect(parsePublicProfile({ ...base2, websiteUrl: "http://example.dk" }).websiteUrl).toBe("http://example.dk/");
  expect(() => parsePublicProfile({ ...base2, websiteUrl: "javascript:alert(1)" })).toThrow("invalid_profile");
  expect(() => parsePublicProfile({ ...base2, websiteUrl: "hej" })).toThrow("invalid_profile");
});
