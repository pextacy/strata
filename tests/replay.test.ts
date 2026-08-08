import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { PlacementsBuilder, strokePixelCount, type StrokeRecord } from "../src/core/decode.js";
import { allocLayers, dayStats, indexAtTime, replay, replayInto } from "../src/core/replay.js";

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

/** Three placements on cell (1,1): colour 1, then 2, then 3. */
function stacked() {
  const b = new PlacementsBuilder(4, 8);
  b.addStroke(stroke("0x010101", ALICE, 100)); // (1,1) colour 1
  b.addStroke(stroke("0x010102", BOB, 200)); // (1,1) colour 2
  b.addStroke(stroke("0x0101030202040303050303ff", ALICE, 300)); // (1,1)=3, (2,2)=4, (3,3)=5, (3,3)=255
  return { p: b.finish(), artists: b.finish().artists };
}

describe("replay", () => {
  it("stacks colours: first stays first, buried is the one under the top", () => {
    const { p } = stacked();
    const L = replay(p, 4);
    const cell = 1 * 4 + 1;

    expect(L.depth[cell]).toBe(3);
    expect(L.first[cell]).toBe(1);
    expect(L.buried[cell]).toBe(2);
    expect(L.final[cell]).toBe(3);
  });

  it("gives the top layer to whoever placed last", () => {
    const { p } = stacked();
    const L = replay(p, 4);
    expect(p.artists[L.lastArtist[1 * 4 + 1]]).toBe(ALICE);
  });

  it("leaves a cell nobody touched at depth zero", () => {
    const { p } = stacked();
    const L = replay(p, 4);
    expect(L.depth[0]).toBe(0);
    // There is no sentinel colour: index 0 is a real palette entry, so depth is
    // the only way to know a cell was never painted.
    expect(L.final[0]).toBe(0);
  });

  it("stops where it is told to", () => {
    const { p } = stacked();
    const cell = 1 * 4 + 1;

    expect(replay(p, 4, 0).depth[cell]).toBe(0);
    expect(replay(p, 4, 1).final[cell]).toBe(1);
    expect(replay(p, 4, 2).final[cell]).toBe(2);
    expect(replay(p, 4, 2).buried[cell]).toBe(1);
    expect(replay(p, 4, p.n).final[cell]).toBe(3);
  });
});

describe("replayInto", () => {
  // Scrubbing copies the nearest earlier keyframe and steps forward, so a
  // partial replay plus the rest must equal a replay from zero. If this drifts,
  // every scrubber frame is a lie.
  it("matches a replay from zero, whatever the split", () => {
    const p = realPlacements();
    const whole = replay(p, SIZE);

    for (const split of [0, 1, 137, Math.floor(p.n / 2), p.n - 1, p.n]) {
      const stepped = replayInto(allocLayers(SIZE), p, 0, split);
      replayInto(stepped, p, split, p.n);

      expect(stepped.final).toEqual(whole.final);
      expect(stepped.first).toEqual(whole.first);
      expect(stepped.buried).toEqual(whole.buried);
      expect(stepped.depth).toEqual(whole.depth);
      expect(stepped.lastArtist).toEqual(whole.lastArtist);
    }
  });

  it("survives being stepped forward many times", () => {
    const p = realPlacements();
    const stepped = allocLayers(SIZE);
    const step = Math.ceil(p.n / 24); // one keyframe per hour, as DOCS.md §7.1 sizes it
    for (let from = 0; from < p.n; from += step) {
      replayInto(stepped, p, from, Math.min(from + step, p.n));
    }
    expect(stepped.depth).toEqual(replay(p, SIZE).depth);
    expect(stepped.final).toEqual(replay(p, SIZE).final);
  });
});

describe("dayStats", () => {
  it("counts painted cells, depth, and the overpaint ratio", () => {
    const { p } = stacked();
    const stats = dayStats(replay(p, 4), p);

    // (1,1) three times, (2,2) once, (3,3) once — the fourth pixel of the last
    // stroke names colour 255, which the palette does not have, so it is dropped.
    expect(stats.paintedCells).toBe(3);
    expect(stats.placements).toBe(5);
    expect(stats.maxDepth).toBe(3);
    expect(stats.overpaintRatio).toBeCloseTo(5 / 3);
  });

  it("does not count a repaint in the same colour as burying anything", () => {
    const b = new PlacementsBuilder(4, 8);
    b.addStroke(stroke("0x010101", ALICE, 100));
    b.addStroke(stroke("0x010101", BOB, 200)); // same colour again
    const p = b.finish();

    const stats = dayStats(replay(p, 4), p);
    expect(stats.placements).toBe(2);
    expect(stats.buriedPlacements).toBe(0);
  });

  it("counts a real cover-up", () => {
    const { p } = stacked();
    // (1,1) was covered twice; (2,2) and (3,3) once each and never covered.
    expect(dayStats(replay(p, 4), p).buriedPlacements).toBe(2);
  });

  it("agrees with the layers on a real day", () => {
    const p = realPlacements();
    const L = replay(p, SIZE);
    const stats = dayStats(L, p);

    let painted = 0;
    let total = 0;
    for (const d of L.depth) {
      if (d === 0) continue;
      painted++;
      total += d;
    }
    expect(stats.paintedCells).toBe(painted);
    expect(stats.placements).toBe(total);
    expect(stats.placements).toBe(p.n);
    expect(stats.overpaintRatio).toBeGreaterThanOrEqual(1);
  });
});

describe("indexAtTime", () => {
  it("finds the last placement at or before a moment", () => {
    const { p } = stacked();
    expect(indexAtTime(p, 99)).toBe(-1);
    expect(indexAtTime(p, 100)).toBe(0);
    expect(indexAtTime(p, 150)).toBe(0);
    expect(indexAtTime(p, 200)).toBe(1);
    expect(indexAtTime(p, 10_000)).toBe(p.n - 1);
  });

  it("lands on the last of several placements sharing a timestamp", () => {
    const { p } = stacked();
    // The third stroke wrote three pixels in one transaction, all at t=300.
    expect(indexAtTime(p, 300)).toBe(p.n - 1);
  });

  it("agrees with a linear scan of a real day", () => {
    const p = realPlacements();
    for (const t of [p.time[0] - 1, p.time[0], p.time[Math.floor(p.n / 3)], p.time[p.n - 1] + 60]) {
      let expected = -1;
      for (let i = 0; i < p.n; i++) if (p.time[i] <= t) expected = i;
      expect(indexAtTime(p, t)).toBe(expected);
    }
  });
});
