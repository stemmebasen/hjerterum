import { describe, expect, it } from "vitest";
import { planCrop } from "./cover-crop";

describe("cropping a cover to 1920 × 1005", () => {
  it("keeps the middle of a photo that is too tall", () => {
    expect(planCrop(3000, 3000)).toEqual({ ok: true, sx: 0, sy: 715, sw: 3000, sh: 1570 });
  });
  it("keeps the middle of a photo that is too wide", () => {
    expect(planCrop(4000, 1005)).toEqual({ ok: true, sx: 1040, sy: 0, sw: 1920, sh: 1005 });
  });
  it("takes a photo that is exactly right as it is", () => {
    expect(planCrop(1920, 1005)).toEqual({ ok: true, sx: 0, sy: 0, sw: 1920, sh: 1005 });
  });
  it("refuses a photo with too little picture - it is never enlarged", () => {
    expect(planCrop(1000, 800).ok).toBe(false);
    expect(planCrop(1920, 900).ok).toBe(false);
  });
});
