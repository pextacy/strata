import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { bandsUpTo, coreSample, isOnCanvas } from "../src/core/coreSample.js";
import { PlacementsBuilder, strokePixelCount, type StrokeRecord } from "../src/core/decode.js";
import { indexAtTime, replay } from "../src/core/replay.js";

/** Real strokes, captured by `npm run capture -- 500`. */
const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/day-0500-strokes.json", import.meta.url), "utf8"),
) as {
  theme: { size: number; palette: string[] };
  strokes: { items: StrokeRecord[] };
};

const SIZE = fixture.theme.size;
const PALETTE = fixture.theme.palette.length;

function realPlacements() {
  const b = new PlacementsBuilder(SIZE, PALETTE);
  for (const stroke of fixture.strokes.items) b.addStroke(stroke);
  return b.finish();
}

let nextId = 1;
function stroke(data: string, artist: string, timestamp: number): StrokeRecord {
  return {
    id: String(nextId++),
    accountId: artist,
    data,
    pixels: strokePixelCount(data),
    timestamp,
  };
}

const ALICE = "0x00000000000000000000000000000000000000a1";
const BOB = "0x00000000000000000000000000000000000000b0";

/** Cell (1,1) painted 1, then 2, then 2 again, then 3. Cell (2,2) painted once. */
function stacked() {
  const b = new PlacementsBuilder(8, 8);
  b.addStroke(stroke("0x010101", ALICE, 100));
  b.addStroke(stroke("0x010102", BOB, 200));
  b.addStroke(stroke("0x010102", BOB, 300)); // same colour again — buries nothing
  b.addStroke(stroke("0x010103020204", ALICE, 400)); // (1,1)=3 and (2,2)=4
  return b.finish();
}

describe("isOnCanvas", () => {
  it("accepts a whole cell inside the grid and nothing else", () => {
    expect(isOnCanvas(144, 0, 0)).toBe(true);
    expect(isOnCanvas(144, 143, 143)).toBe(true);
    expect(isOnCanvas(144, 144, 0)).toBe(false);
    expect(isOnCanvas(144, -1, 0)).toBe(false);
    expect(isOnCanvas(144, 1.5, 0)).toBe(false);
  });
});

describe("coreSample", () => {
  it("returns every colour the cell has been, oldest first", () => {
    const sample = coreSample(stacked(), 8, 1, 1);
    expect(sample.bands.map((b) => b.color)).toEqual([1, 2, 2, 3]);
    expect(sample.cell).toBe(1 * 8 + 1);
    expect(sample.x).toBe(1);
    expect(sample.y).toBe(1);
  });

  it("names the painter and the moment on every band", () => {
    const p = stacked();
    const sample = coreSample(p, 8, 1, 1);
    expect(sample.bands.map((b) => p.artists[b.artist])).toEqual([ALICE, BOB, BOB, ALICE]);
    expect(sample.bands.map((b) => b.time)).toEqual([100, 200, 300, 400]);
  });

  it("counts distinct painters, not placements", () => {
    expect(coreSample(stacked(), 8, 1, 1).painters).toBe(2);
  });

  it("does not call a repaint in the same colour a burial", () => {
    const sample = coreSample(stacked(), 8, 1, 1);
    // 1 was covered by 2, and the second 2 was covered by 3. The first 2 was
    // repainted in its own colour, which buries nothing.
    expect(sample.bands.map((b) => b.buried)).toEqual([true, false, true, false]);
    expect(sample.buried).toBe(2);
  });

  it("leaves the top band unburied", () => {
    const sample = coreSample(stacked(), 8, 1, 1);
    expect(sample.bands[sample.bands.length - 1].buried).toBe(false);
  });

  it("returns an empty stack for a cell nobody painted", () => {
    const sample = coreSample(stacked(), 8, 7, 7);
    expect(sample.bands).toEqual([]);
    expect(sample.painters).toBe(0);
    expect(sample.buried).toBe(0);
  });

  it("returns an empty stack for a cell that is not on the canvas", () => {
    expect(coreSample(stacked(), 8, 8, 0).bands).toEqual([]);
    expect(coreSample(stacked(), 8, -1, 0).bands).toEqual([]);
  });

  it("keeps the placement index, which is what orders bands inside one stroke", () => {
    const p = stacked();
    const sample = coreSample(p, 8, 1, 1);
    const indices = sample.bands.map((b) => b.index);
    expect([...indices].sort((a, b) => a - b)).toEqual(indices);
    for (const band of sample.bands) {
      expect(p.x[band.index]).toBe(1);
      expect(p.y[band.index]).toBe(1);
      expect(p.color[band.index]).toBe(band.color);
    }
  });
});

describe("coreSample against a real day", () => {
  const p = realPlacements();
  const layers = replay(p, SIZE);

  it("agrees with the replay buffers on every cell it is asked about", () => {
    let checked = 0;
    for (let cell = 0; cell < layers.depth.length && checked < 400; cell++) {
      if (layers.depth[cell] === 0) continue;
      checked++;
      const x = cell % SIZE;
      const y = Math.floor(cell / SIZE);
      const sample = coreSample(p, SIZE, x, y);

      expect(sample.bands).toHaveLength(layers.depth[cell]);
      expect(sample.bands[sample.bands.length - 1].color).toBe(layers.final[cell]);
      expect(sample.bands[0].color).toBe(layers.first[cell]);
      expect(sample.bands[sample.bands.length - 1].artist).toBe(layers.lastArtist[cell]);
      if (sample.bands.length > 1) {
        expect(sample.bands[sample.bands.length - 2].color).toBe(layers.buried[cell]);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("finds a contested cell with a stack several bands deep", () => {
    let deepest = 0;
    let at = 0;
    for (let cell = 0; cell < layers.depth.length; cell++) {
      if (layers.depth[cell] > deepest) {
        deepest = layers.depth[cell];
        at = cell;
      }
    }
    const sample = coreSample(p, SIZE, at % SIZE, Math.floor(at / SIZE));
    expect(sample.bands.length).toBe(deepest);
    expect(sample.bands.length).toBeGreaterThan(1);
    for (const band of sample.bands) {
      expect(p.artists[band.artist]).toMatch(/^0x[0-9a-f]{40}$/);
    }
  });

  it("resolves well inside the 10 ms budget", () => {
    const start = performance.now();
    for (let i = 0; i < 20; i++) coreSample(p, SIZE, 91 + i, 204);
    const each = (performance.now() - start) / 20;
    expect(each).toBeLessThan(10);
  });
});

describe("bandsUpTo", () => {
  it("shows the stack as it stood at a placement index", () => {
    const p = stacked();
    const sample = coreSample(p, 8, 1, 1);

    expect(bandsUpTo(sample, -1)).toEqual([]);
    expect(bandsUpTo(sample, sample.bands[0].index).map((b) => b.color)).toEqual([1]);
    expect(bandsUpTo(sample, sample.bands[2].index).map((b) => b.color)).toEqual([1, 2, 2]);
    expect(bandsUpTo(sample, p.n)).toEqual(sample.bands);
  });

  it("never marks the top of a partial stack as buried", () => {
    const p = stacked();
    const sample = coreSample(p, 8, 1, 1);
    const partial = bandsUpTo(sample, sample.bands[1].index);
    // Band 1 is buried in the finished day, but at this moment it is what the
    // canvas shows — the scrubber must not claim it is already covered.
    expect(partial[partial.length - 1].buried).toBe(false);
    expect(partial[0].buried).toBe(true);
  });

  it("lines up with the scrubber's own index", () => {
    const p = stacked();
    const sample = coreSample(p, 8, 1, 1);
    expect(bandsUpTo(sample, indexAtTime(p, 250)).map((b) => b.color)).toEqual([1, 2]);
    expect(bandsUpTo(sample, indexAtTime(p, 99))).toEqual([]);
  });

  // On a toy day the placement indices are as small as the band count, which
  // hides the whole class of bug: a real cell's nineteen bands carry indices in
  // the hundred thousands, and anything that confuses the two hands back the
  // finished stack for every moment of the day.
  it("truncates a real day's stack, where the indices dwarf the band count", () => {
    const p = realPlacements();
    const layers = replay(p, SIZE);

    let at = 0;
    for (let cell = 0; cell < layers.depth.length; cell++) {
      if (layers.depth[cell] > layers.depth[at]) at = cell;
    }
    const sample = coreSample(p, SIZE, at % SIZE, Math.floor(at / SIZE));
    expect(sample.bands.length).toBeGreaterThan(2);

    const middle = sample.bands[Math.floor(sample.bands.length / 2)];
    const partial = bandsUpTo(sample, middle.index);

    expect(partial.length).toBeLessThan(sample.bands.length);
    expect(partial[partial.length - 1].index).toBe(middle.index);
    expect(partial.every((band) => band.index <= middle.index)).toBe(true);
    // The band on the surface at that moment is not yet covered by definition.
    expect(partial[partial.length - 1].buried).toBe(false);

    // The whole stack still comes back once the day has run past the last band.
    expect(bandsUpTo(sample, p.n)).toEqual(sample.bands);
    expect(bandsUpTo(sample, sample.bands[sample.bands.length - 1].index)).toEqual(sample.bands);
  });
});
