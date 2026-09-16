import { describe, expect, it } from "vitest";
import { computeKeyboardViewport } from "./keyboard-viewport";

describe("computeKeyboardViewport", () => {
  it("reports no inset when the visual viewport is unavailable", () => {
    expect(computeKeyboardViewport(800, null)).toEqual({
      keyboardInset: 0,
      viewportHeight: null,
    });
  });

  it("reports no inset for small viewport changes (browser chrome, not a keyboard)", () => {
    expect(computeKeyboardViewport(800, { height: 760, offsetTop: 0 })).toEqual({
      keyboardInset: 0,
      viewportHeight: 760,
    });
  });

  it("reports the covered height when the keyboard is open", () => {
    expect(computeKeyboardViewport(800, { height: 460, offsetTop: 0 })).toEqual({
      keyboardInset: 340,
      viewportHeight: 460,
    });
  });

  it("accounts for a scrolled visual viewport", () => {
    expect(computeKeyboardViewport(800, { height: 420, offsetTop: 40 })).toEqual({
      keyboardInset: 340,
      viewportHeight: 420,
    });
  });

  it("never returns a negative inset", () => {
    expect(computeKeyboardViewport(600, { height: 900, offsetTop: 0 }).keyboardInset).toBe(0);
  });
});
