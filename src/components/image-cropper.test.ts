import { describe, expect, it } from "vitest";
import { cropPlacementStyle } from "./image-cropper";
import { PROFILE_COVER_ASPECT, PROFILE_COVER_TARGET, coverCrop } from "@/lib/image-optimize";

/** Parses "12.5%" → 12.5 */
const pct = (v: unknown) => Number(String(v).replace("%", ""));

describe("cropPlacementStyle (live preview = saved crop)", () => {
  it("fills the frame exactly at zoom 1 for a landscape photo in a square frame", () => {
    const natural = { width: 1000, height: 500 };
    const crop = coverCrop(natural.width, natural.height, 1);
    const s = cropPlacementStyle(natural, crop);
    expect(pct(s.height)).toBe(100); // height covers the frame
    expect(pct(s.width)).toBe(200); // twice as wide, centred
    expect(pct(s.left)).toBe(-50);
    expect(pct(s.top)).toBeCloseTo(0);
  });

  it("reflects panning at zoom 1 (extra source area moves into view)", () => {
    const natural = { width: 500, height: 1000 }; // portrait in square frame
    const top = cropPlacementStyle(natural, coverCrop(500, 1000, 1, 1, 0, -1));
    const bottom = cropPlacementStyle(natural, coverCrop(500, 1000, 1, 1, 0, 1));
    expect(pct(top.top)).toBeCloseTo(0);
    expect(pct(bottom.top)).toBe(-100);
  });

  it("never distorts: width/height ratio equals the source ratio scaled by the frame aspect", () => {
    for (const [w, h, aspect] of [
      [4000, 3000, 1],
      [3000, 4000, 3],
      [2000, 2000, 1.6],
      [6000, 2000, 3],
    ] as const) {
      const crop = coverCrop(w, h, aspect, 2.3, 0.4, -0.7);
      const s = cropPlacementStyle({ width: w, height: h }, crop);
      // displayed px: width% * frameW, height% * frameH where frameH = frameW / aspect
      const displayedRatio = (pct(s.width) / (pct(s.height) / aspect));
      expect(displayedRatio).toBeCloseTo(w / h, 6);
      // the crop rectangle itself keeps the requested aspect
      expect(crop.width / crop.height).toBeCloseTo(aspect, 6);
    }
  });

  it("keeps the frame fully covered at any zoom/pan (no empty edges)", () => {
    const natural = { width: 1200, height: 900 };
    for (const zoom of [1, 1.5, 4]) {
      for (const pan of [-1, -0.3, 0, 0.8, 1]) {
        const crop = coverCrop(natural.width, natural.height, 16 / 10, zoom, pan, -pan);
        const s = cropPlacementStyle(natural, crop);
        expect(pct(s.left)).toBeLessThanOrEqual(0);
        expect(pct(s.top)).toBeLessThanOrEqual(0);
        expect(pct(s.left) + pct(s.width)).toBeGreaterThanOrEqual(100 - 1e-6);
        expect(pct(s.top) + pct(s.height)).toBeGreaterThanOrEqual(100 - 1e-6);
      }
    }
  });
});

describe("profile cover target", () => {
  it("encodes covers at the same 3:1 proportion the profile pages display", () => {
    expect(PROFILE_COVER_ASPECT).toBe(3);
    expect(PROFILE_COVER_TARGET.width / PROFILE_COVER_TARGET.height).toBe(3);
  });
});
