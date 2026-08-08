import { describe, expect, it } from "vitest";

import {
  clampPixel,
  formatPixel,
  keyToStep,
  parsePixel,
  pixelAt,
  samePixel,
  stepPixel,
} from "../src/core/pixel.js";

describe("parsePixel / formatPixel", () => {
  it("round-trips a cell through the URL", () => {
    for (const pixel of [
      { x: 0, y: 0 },
      { x: 91, y: 204 },
      { x: 255, y: 255 },
    ]) {
      expect(parsePixel(formatPixel(pixel), 256)).toEqual(pixel);
    }
  });

  it("drops a cell that is not on this canvas", () => {
    // A link to a 256 day opened against a 144 one. Selecting the wrong pixel
    // would be worse than selecting none.
    expect(parsePixel("200,10", 144)).toBeNull();
    expect(parsePixel("10,200", 144)).toBeNull();
    expect(parsePixel("144,0", 144)).toBeNull();
    expect(parsePixel("143,143", 144)).toEqual({ x: 143, y: 143 });
  });

  it("refuses anything that is not two whole numbers", () => {
    for (const raw of [null, undefined, "", "91", "91,", ",204", "91,204,7", "-1,4", "1.5,4", "a,b", "0x1,2"]) {
      expect(parsePixel(raw, 256)).toBeNull();
    }
  });

  it("ignores surrounding whitespace", () => {
    expect(parsePixel("  91,204  ", 256)).toEqual({ x: 91, y: 204 });
  });
});

describe("clampPixel / stepPixel", () => {
  it("holds a cell inside the canvas", () => {
    expect(clampPixel({ x: -5, y: 300 }, 256)).toEqual({ x: 0, y: 255 });
    expect(clampPixel({ x: 10, y: 10 }, 256)).toEqual({ x: 10, y: 10 });
  });

  it("stops at the edge instead of wrapping", () => {
    expect(stepPixel({ x: 0, y: 0 }, -1, -1, 144)).toEqual({ x: 0, y: 0 });
    expect(stepPixel({ x: 143, y: 143 }, 1, 1, 144)).toEqual({ x: 143, y: 143 });
    expect(stepPixel({ x: 5, y: 5 }, 1, -1, 144)).toEqual({ x: 6, y: 4 });
  });
});

describe("keyToStep", () => {
  const at = { x: 10, y: 10 };

  it("maps the arrow keys to one cell", () => {
    expect(keyToStep("ArrowLeft", 256, at)).toEqual({ x: 9, y: 10 });
    expect(keyToStep("ArrowRight", 256, at)).toEqual({ x: 11, y: 10 });
    expect(keyToStep("ArrowUp", 256, at)).toEqual({ x: 10, y: 9 });
    expect(keyToStep("ArrowDown", 256, at)).toEqual({ x: 10, y: 11 });
  });

  it("maps the paging and row keys", () => {
    expect(keyToStep("PageUp", 256, at)).toEqual({ x: 10, y: 0 });
    expect(keyToStep("PageDown", 256, at)).toEqual({ x: 10, y: 20 });
    expect(keyToStep("Home", 256, at)).toEqual({ x: 0, y: 10 });
    expect(keyToStep("End", 256, at)).toEqual({ x: 255, y: 10 });
  });

  it("leaves every other key alone, so the page keeps its shortcuts", () => {
    for (const key of ["a", "Enter", " ", "Tab", "Escape", "ArrowLeftFoo"]) {
      expect(keyToStep(key, 256, at)).toBeNull();
    }
  });
});

describe("pixelAt", () => {
  // A 256 canvas drawn at 3×: 768 CSS pixels across.
  it("maps a pointer position to the cell under it", () => {
    expect(pixelAt(0, 0, 768, 256)).toEqual({ x: 0, y: 0 });
    expect(pixelAt(2, 2, 768, 256)).toEqual({ x: 0, y: 0 });
    expect(pixelAt(3, 0, 768, 256)).toEqual({ x: 1, y: 0 });
    expect(pixelAt(767, 767, 768, 256)).toEqual({ x: 255, y: 255 });
  });

  it("returns nothing for a position off the artwork", () => {
    expect(pixelAt(-1, 10, 768, 256)).toBeNull();
    expect(pixelAt(10, 768, 768, 256)).toBeNull();
    expect(pixelAt(10, 10, 0, 256)).toBeNull();
  });

  it("works at 1× on the smaller canvas too", () => {
    expect(pixelAt(143, 0, 144, 144)).toEqual({ x: 143, y: 0 });
    expect(pixelAt(144, 0, 144, 144)).toBeNull();
  });
});

describe("samePixel", () => {
  it("compares by value and treats two nulls as the same", () => {
    expect(samePixel(null, null)).toBe(true);
    expect(samePixel({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(true);
    expect(samePixel({ x: 1, y: 2 }, { x: 2, y: 1 })).toBe(false);
    expect(samePixel({ x: 1, y: 2 }, null)).toBe(false);
  });
});
