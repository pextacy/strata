import { describe, expect, it } from "vitest";

import { PlacementsBuilder, type StrokeRecord } from "../src/core/decode.ts";
import { dayStats, replay } from "../src/core/replay.ts";
import {
  MODE_COPY,
  VIEW_MODES,
  isViewMode,
  paintLayer,
  readViewMode,
} from "../src/render/layers.ts";
import {
  TRANSPARENT,
  depthColor,
  packRgba,
  parseHexColor,
  toRgba,
} from "../src/render/palette.ts";

const PALETTE = ["#000000", "#ff0000", "#00ff00", "#0000ff"];

/** Builds placements from `[x, y, color, artist]` tuples, in the given order. */
function placementsOf(pixels: [number, number, number, string][], size = 4) {
  const builder = new PlacementsBuilder(size, PALETTE.length, 8);
  pixels.forEach(([x, y, color, artist], i) => {
    const stroke: StrokeRecord = {
      id: String(i + 1),
      accountId: artist,
      data: `0x${hex(x)}${hex(y)}${hex(color)}`,
      pixels: 1,
      timestamp: 1_700_000_000 + i,
    };
    builder.addStroke(stroke);
  });
  return { placements: builder.finish(), anomalies: builder.anomalies };
}

const hex = (n: number) => n.toString(16).padStart(2, "0");

describe("packRgba", () => {
  it("round-trips through the byte order ImageData actually uses", () => {
    const packed = new Uint32Array([packRgba(1, 2, 3, 4)]);
    const bytes = new Uint8Array(packed.buffer);
    expect([...bytes]).toEqual([1, 2, 3, 4]); // r, g, b, a
  });

  it("is opaque by default", () => {
    const bytes = new Uint8Array(new Uint32Array([packRgba(9, 9, 9)]).buffer);
    expect(bytes[3]).toBe(255);
  });
});

describe("parseHexColor", () => {
  it("reads six-digit hex with or without the hash", () => {
    expect(parseHexColor("#fde047")).toEqual({ r: 253, g: 224, b: 71 });
    expect(parseHexColor("073eb1")).toEqual({ r: 7, g: 62, b: 177 });
  });

  it("refuses anything else rather than guessing", () => {
    expect(parseHexColor("#fff")).toBeNull();
    expect(parseHexColor("red")).toBeNull();
  });
});

describe("toRgba", () => {
  it("keeps palette order, because the index is what strokes carry", () => {
    const rgba = toRgba(PALETTE);
    expect(rgba.length).toBe(4);
    expect(rgba[1]).toBe(packRgba(255, 0, 0));
    expect(rgba[3]).toBe(packRgba(0, 0, 255));
  });
});

describe("depthColor", () => {
  it("draws nothing where nothing was painted", () => {
    expect(depthColor(0, 10)).toBe(TRANSPARENT);
  });

  it("puts depth 1 at the bottom of the ramp and the deepest cell at the top", () => {
    const low = depthColor(1, 12);
    const high = depthColor(12, 12);
    expect(low).not.toBe(high);
    expect(low).toBe(depthColor(1, 40)); // the floor does not move with the day
  });

  it("never leaves the ramp when depth exceeds the reported maximum", () => {
    expect(depthColor(99, 10)).toBe(depthColor(10, 10));
  });

  it("holds still on a day where nothing was overpainted", () => {
    expect(depthColor(1, 1)).toBe(depthColor(1, 1));
    expect(depthColor(1, 1)).not.toBe(TRANSPARENT);
  });
});

describe("readViewMode", () => {
  it("accepts every mode the switch offers", () => {
    for (const mode of VIEW_MODES) {
      expect(isViewMode(mode)).toBe(true);
      expect(readViewMode(mode)).toBe(mode);
      expect(MODE_COPY[mode].blurb.length).toBeGreaterThan(0);
    }
  });

  it("falls back to final rather than breaking on a mangled URL", () => {
    expect(readViewMode("ghosts")).toBe("final");
    expect(readViewMode(null)).toBe("final");
  });
});

describe("paintLayer", () => {
  const size = 4;
  const alice = "0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa";
  const bob = "0xBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbb";

  // (0,0): red, then blue on top — one cell of lost art.
  // (1,0): green, painted once and never touched again.
  // (2,0): green twice by the same hand — nothing was lost there.
  const { placements } = placementsOf(
    [
      [0, 0, 1, alice],
      [1, 0, 2, bob],
      [0, 0, 3, bob],
      [2, 0, 2, alice],
      [2, 0, 2, alice],
    ],
    size,
  );
  const layers = replay(placements, size);
  const stats = dayStats(layers, placements);
  const rgba = toRgba(PALETTE);
  const out = new Uint32Array(size * size);

  it("draws the final canvas on the palette-0 ground the chain starts from", () => {
    paintLayer(out, "final", layers, rgba, stats.maxDepth);
    expect(out[0]).toBe(rgba[3]); // blue landed last
    expect(out[1]).toBe(rgba[2]);
    // Not transparent: an unpainted cell is palette index 0, which is what the
    // official render shows and what `npm run verify` diffs against.
    expect(out[3]).toBe(rgba[0]);
  });

  it("draws the first colour ever laid for the underpainting", () => {
    paintLayer(out, "underpainting", layers, rgba, stats.maxDepth);
    expect(out[0]).toBe(rgba[1]); // red, before blue covered it
    expect(out[3]).toBe(rgba[0]); // never painted, so still the ground
  });

  it("shows only colours that were actually lost in the ghost layer", () => {
    paintLayer(out, "ghost", layers, rgba, stats.maxDepth);
    expect(out[0]).toBe(rgba[1]); // the red under the blue
    expect(out[1]).toBe(TRANSPARENT); // painted once, survived
    expect(out[2]).toBe(TRANSPARENT); // repainted its own colour, lost nothing
  });

  it("colours the depth map only where the canvas was painted", () => {
    paintLayer(out, "depth", layers, rgba, stats.maxDepth);
    expect(out[0]).toBe(depthColor(2, stats.maxDepth));
    expect(out[1]).toBe(depthColor(1, stats.maxDepth));
    expect(out[3]).toBe(TRANSPARENT);
  });

  it("refuses a buffer that cannot hold the canvas", () => {
    expect(() => paintLayer(new Uint32Array(4), "final", layers, rgba, stats.maxDepth)).toThrow(
      /pixel buffer/,
    );
  });

  it("draws nothing for a palette index the day does not have", () => {
    // The decoder already drops these, so this is the last line of defence
    // rather than a normal path: a colour is never guessed to fill the gap.
    const shortPalette = toRgba(PALETTE.slice(0, 2));
    paintLayer(out, "final", layers, shortPalette, stats.maxDepth);
    expect(out[0]).toBe(TRANSPARENT); // index 3 is off the end of this palette
    expect(out[1]).toBe(TRANSPARENT); // index 2, likewise
  });
});
