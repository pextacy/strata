import { describe, expect, it } from "vitest";

// @ts-expect-error — a plain .mjs script with no types of its own.
import { compareRender } from "../scripts/verify.mjs";

import { allocLayers, replayInto } from "../src/core/replay.ts";
import type { Placements } from "../src/core/decode.ts";

/**
 * The cell-by-cell diff that `npm run verify` makes its one hard claim with.
 *
 * That script needs the network, so it is kept out of CI and runs on a schedule
 * — which leaves the comparison itself unchecked by anything that runs on a pull
 * request. And the part most worth checking is the part no real day exercises:
 * every render `basepaint.net` has published so far is 1x, where a cell is one
 * device pixel. The comparison used to read only the top-left sample of each
 * cell, which at 1x is the whole cell and at anything else is a corner standing
 * in for a block. The scale is read from the image rather than assumed, so the
 * day it stops being 1x, "zero mismatched cells" would start meaning "zero
 * mismatched corners".
 *
 * Synthetic images here, at both scales, with the damage put where each version
 * would and would not have looked.
 */

/** A `Placements` of one pixel per entry, in the order given. */
function placements(pixels: [number, number, number][]): Placements {
  const n = pixels.length;
  const p = {
    n,
    x: new Uint8Array(n),
    y: new Uint8Array(n),
    color: new Uint8Array(n),
    artist: new Uint16Array(n),
    time: new Uint32Array(n),
    artists: ["0x0000000000000000000000000000000000000001"],
  };
  pixels.forEach(([x, y, color], i) => {
    p.x[i] = x;
    p.y[i] = y;
    p.color[i] = color;
    p.time[i] = 1_000 + i;
  });
  return p;
}

interface FakePng {
  width: number;
  height: number;
  data: Uint8Array;
}

/** The canvas rendered the way basepaint.net renders it: nearest-neighbour. */
function render(
  size: number,
  scale: number,
  colourAt: (x: number, y: number) => number,
): FakePng {
  const width = size * scale;
  const data = new Uint8Array(width * width * 4);
  for (let y = 0; y < width; y++) {
    for (let x = 0; x < width; x++) {
      const rgb = colourAt(Math.floor(x / scale), Math.floor(y / scale));
      const at = (y * width + x) * 4;
      data[at] = (rgb >> 16) & 0xff;
      data[at + 1] = (rgb >> 8) & 0xff;
      data[at + 2] = rgb & 0xff;
      data[at + 3] = 255;
    }
  }
  return { width, height: width, data };
}

/** Overwrite one device pixel, leaving the rest of its cell correct. */
function damage(png: FakePng, deviceX: number, deviceY: number, rgb: number): void {
  const at = (deviceY * png.width + deviceX) * 4;
  png.data[at] = (rgb >> 16) & 0xff;
  png.data[at + 1] = (rgb >> 8) & 0xff;
  png.data[at + 2] = rgb & 0xff;
}

const SIZE = 4;
const PALETTE = [0x000000, 0xff0000, 0x00ff00, 0x0000ff];

/** A small day: a few painted cells, the rest left as the ground colour. */
function day() {
  const p = placements([
    [0, 0, 1],
    [1, 0, 2],
    [2, 2, 3],
    [1, 0, 3], // painted over — the render shows the last one
  ]);
  const layers = allocLayers(SIZE);
  replayInto(layers, p, 0, p.n);
  const colourAt = (x: number, y: number): number => {
    const cell = y * SIZE + x;
    return PALETTE[layers.depth[cell] > 0 ? layers.final[cell] : 0];
  };
  return { layers, colourAt };
}

describe.each([1, 2, 3])("at %ix", (scale) => {
  const { layers, colourAt } = day();

  it("finds nothing wrong with a render that matches", () => {
    const png = render(SIZE, scale, colourAt);
    const result = compareRender(layers, png, SIZE, scale, PALETTE);
    expect(result.mismatched).toBe(0);
    expect(result.painted + result.unpainted).toBe(SIZE * SIZE);
    expect(result.samples).toEqual([]);
  });

  it("counts painted and unpainted cells the way the replay does", () => {
    const png = render(SIZE, scale, colourAt);
    const result = compareRender(layers, png, SIZE, scale, PALETTE);
    let painted = 0;
    for (let i = 0; i < layers.depth.length; i++) if (layers.depth[i] > 0) painted++;
    expect(result.painted).toBe(painted);
    expect(result.unpainted).toBe(SIZE * SIZE - painted);
  });

  it("catches a wrong colour on the cell's own corner", () => {
    const png = render(SIZE, scale, colourAt);
    damage(png, 2 * scale, 2 * scale, 0x123456);
    const result = compareRender(layers, png, SIZE, scale, PALETTE);
    expect(result.mismatched).toBe(1);
    expect(result.samples[0]).toMatchObject({ x: 2, y: 2, actual: "#123456" });
  });

  it("catches a transparent pixel where paint should be", () => {
    const png = render(SIZE, scale, colourAt);
    png.data[(2 * scale * png.width + 2 * scale) * 4 + 3] = 0;
    const result = compareRender(layers, png, SIZE, scale, PALETTE);
    expect(result.mismatched).toBe(1);
    expect(result.samples[0].actual).toBe("transparent");
  });
});

/**
 * The whole point. At 1x these are the same pixel; past it they are not, and the
 * old comparison saw only the first of them.
 */
describe("a cell drawn as more than one device pixel", () => {
  const scale = 3;
  const { layers, colourAt } = day();

  it("catches damage away from the corner, which the corner sample missed", () => {
    const png = render(SIZE, scale, colourAt);
    // Bottom-right of cell (2,2). Its top-left corner is untouched, so the old
    // comparison called this cell a match.
    damage(png, 2 * scale + 2, 2 * scale + 2, 0x123456);

    const corner = png.data[((2 * scale) * png.width + 2 * scale) * 4];
    expect(corner, "the corner is deliberately left correct").toBe(0x00);

    const result = compareRender(layers, png, SIZE, scale, PALETTE);
    expect(result.mismatched).toBe(1);
    expect(result.samples[0]).toMatchObject({ x: 2, y: 2, actual: "#123456" });
    // And it says which pixel of the cell, so the report is actionable.
    expect(result.samples[0].at).toContain("+2,+2");
    expect(result.samples[0].at).toContain("3x3");
  });

  it("catches a single bad pixel anywhere in the block", () => {
    for (let dy = 0; dy < scale; dy++) {
      for (let dx = 0; dx < scale; dx++) {
        const png = render(SIZE, scale, colourAt);
        damage(png, 2 * scale + dx, 2 * scale + dy, 0x123456);
        const result = compareRender(layers, png, SIZE, scale, PALETTE);
        expect(result.mismatched, `damage at +${dx},+${dy}`).toBe(1);
      }
    }
  });

  it("says nothing about the device pixel when a cell is only one", () => {
    const png = render(SIZE, 1, colourAt);
    damage(png, 2, 2, 0x123456);
    const result = compareRender(layers, png, SIZE, 1, PALETTE);
    expect(result.samples[0].at).toBe("");
  });
});

describe("a palette index the day does not have", () => {
  it("is reported as the index rather than as a colour", () => {
    const p = placements([[0, 0, 9]]);
    const layers = allocLayers(SIZE);
    replayInto(layers, p, 0, p.n);
    // Nothing the decoder would produce — it drops these — but the comparison
    // must not turn an absent palette entry into a silent match.
    const png = render(SIZE, 1, () => PALETTE[0]);
    const result = compareRender(layers, png, SIZE, 1, PALETTE);
    expect(result.mismatched).toBe(1);
    expect(result.samples[0].expected).toBe("palette index 9");
  });
});
