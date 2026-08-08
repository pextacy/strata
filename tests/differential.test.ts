// Every clever thing in `src/core`, against a version that is obviously right.
//
// The hard claim — that the replay *is* the canvas — is checked by
// `npm run verify`, which diffs a replayed day against the official render. That
// needs two third-party services to be up, so it is deliberately kept out of CI
// and runs on a schedule instead. What is left running on every pull request is
// example-based: real fixtures and hand-written cases, which prove the code
// works on the shapes somebody thought of.
//
// This file covers the rest. Each check runs a fast path and a naive one over
// the same random day and insists they agree:
//
//   Timeline.frameAt   copies a keyframe and rolls forward   vs. replaying from zero
//   coreSample         one pass with a `buried` lookahead    vs. scanning for the cell
//   cellsTouched       a sorted Uint32 of composite keys     vs. a Set per artist
//   indexAtTime        binary search                         vs. a linear scan
//   concatPlacements   two runs joined with an artist remap  vs. the undivided day
//
// The days are deliberately hostile in the ways real ones are not: canvases one
// and two cells across, palettes of one colour, pixels addressed off the edge,
// colours the day does not have, and an initial buffer far too small so the
// builder has to grow. The scrub order jumps backwards, lands on the same frame
// twice and runs off both ends, because that is what dragging a handle does and
// it is the one path where a reused scratch canvas can be left holding the
// wrong frame.

import { describe, expect, it } from "vitest";

import { PlacementsBuilder, type Placements } from "../src/core/decode.js";
import { coreSample, bandsUpTo } from "../src/core/coreSample.js";
import { Timeline, placementHistogram } from "../src/core/keyframes.js";
import { concatPlacements } from "../src/core/placements.js";
import { dayStats, indexAtTime, replay, type Layers } from "../src/core/replay.js";
import {
  artistDaySurvival,
  cellsClaimed,
  cellsTouched,
  overpaintPairs,
} from "../src/core/survival.js";

/**
 * A seeded generator, not `Math.random`. A fuzz test that cannot be re-run on
 * the input that failed is a fuzz test that reports bugs nobody can fix — and a
 * suite that fails once in fifty runs gets muted rather than read.
 *
 * The seed is mixed and the first draws are thrown away. Seeding a plain
 * congruential generator with 1000, 1001, 1002… leaves consecutive states one
 * multiplier apart, so the *first* value out of each is nearly the same number:
 * an earlier version of this file picked its canvas size with that draw and got
 * a 16×16 canvas for all forty rounds. The sequence was never the problem — the
 * mean of `unit()` is 0.4993 over 100,000 draws — but the first value of a run
 * is not a sample of it.
 */
function generator(seed: number) {
  let state = Math.imul(seed >>> 0, 2654435761) >>> 0;
  const next = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let i = 0; i < 16; i++) next();
  return { unit: next, int: (n: number): number => Math.floor(next() * n) };
}

type Rng = ReturnType<typeof generator>;

/**
 * A day of random strokes, including the malformed pixels real days carry.
 *
 * Coordinates are drawn against the canvas, not against the byte that carries
 * them — one in eight is drawn from the full 0–255 instead, so off-canvas pixels
 * are exercised without becoming the whole day. Drawing every coordinate from
 * the byte meant that on a 16×16 canvas 431 of 433 pixels were dropped before
 * they landed, and the "random day" every check below ran against was empty.
 */
function randomDay(rng: Rng, size: number, palette: number, strokes: number, artists: number) {
  // A capacity of 16 on a day of thousands of placements, so every run exercises
  // the doubling path rather than the happy case of one big allocation.
  const builder = new PlacementsBuilder(size, palette, 16);
  const byte = (v: number): string => v.toString(16).padStart(2, "0");
  const coordinate = (): string => byte(rng.int(8) === 0 ? rng.int(256) : rng.int(size));
  // Likewise for the palette: mostly a colour the day has, sometimes not.
  const colour = (): string => byte(rng.int(8) === 0 ? rng.int(palette + 3) : rng.int(palette));
  let time = 1_000_000;

  for (let s = 0; s < strokes; s++) {
    const pixels = 1 + rng.int(40);
    let data = "0x";
    for (let p = 0; p < pixels; p++) data += coordinate() + coordinate() + colour();
    time += rng.int(200);
    builder.addStroke({
      id: String(s),
      accountId: `0x${String(rng.int(artists)).padStart(40, "0")}`,
      data,
      pixels,
      timestamp: time,
    });
  }

  return builder.finish();
}

/**
 * Cells worth drilling: ones that were actually painted, plus a couple that
 * probably were not. Six uniformly random cells of a 256×256 canvas are all
 * empty, and an empty cell agrees with everything.
 */
function cellsToProbe(rng: Rng, p: Placements, size: number): { x: number; y: number }[] {
  const cells = [{ x: rng.int(size), y: rng.int(size) }];
  for (let k = 0; k < 5 && p.n > 0; k++) {
    const i = rng.int(p.n);
    cells.push({ x: p.x[i], y: p.y[i] });
  }
  return cells;
}

/**
 * The replay, written again, the slow obvious way.
 *
 * This deliberately does not call `replay` — `replay` is `replayInto`, which is
 * the very function `Timeline` rolls forward with, so comparing the two only
 * ever proved the keyframe bookkeeping and never the meaning of a layer. With
 * both sides sharing an implementation, changing what `buried` holds broke
 * nothing here. A second implementation is the only thing that can disagree.
 *
 * Written from the definitions rather than from the code: `first` is the oldest
 * colour on the cell, `buried` is the one directly under the top, `final` is the
 * top, `depth` counts placements and `lastArtist` owns the top.
 */
function naiveReplay(p: Placements, size: number, upTo: number): Layers {
  const cells = size * size;
  const stacks: { color: number; artist: number }[][] = Array.from({ length: cells }, () => []);
  for (let i = 0; i < Math.min(upTo, p.n); i++) {
    stacks[p.y[i] * size + p.x[i]].push({ color: p.color[i], artist: p.artist[i] });
  }

  const layers: Layers = {
    size,
    final: new Uint8Array(cells),
    first: new Uint8Array(cells),
    buried: new Uint8Array(cells),
    depth: new Uint16Array(cells),
    lastArtist: new Uint16Array(cells),
  };
  for (let cell = 0; cell < cells; cell++) {
    const stack = stacks[cell];
    if (stack.length === 0) continue;
    layers.depth[cell] = stack.length;
    layers.first[cell] = stack[0].color;
    layers.final[cell] = stack[stack.length - 1].color;
    layers.lastArtist[cell] = stack[stack.length - 1].artist;
    if (stack.length > 1) layers.buried[cell] = stack[stack.length - 2].color;
  }
  return layers;
}

/** The first difference between two sets of buffers, or null when they agree. */
function firstDifference(a: Layers, b: Layers): string | null {
  for (const key of ["final", "first", "buried", "depth", "lastArtist"] as const) {
    if (a[key].length !== b[key].length) return `${key} has a different length`;
    for (let i = 0; i < a[key].length; i++) {
      if (a[key][i] !== b[key][i]) return `${key}[${i}] is ${a[key][i]}, expected ${b[key][i]}`;
    }
  }
  return null;
}

/**
 * The same comparison, for two canvases whose artist tables are not the same
 * table.
 *
 * `lastArtist` holds an index into `Placements.artists`, and a day rebuilt from
 * two independently-decoded halves interns its addresses in a different order —
 * that reordering is the whole job `concatPlacements` does. Comparing the raw
 * indices asks whether the two tables happen to be sorted alike, which is not a
 * property anything promises and not the one worth checking. Who owns the cell
 * is.
 */
function firstDifferenceByArtist(
  a: Layers,
  aArtists: readonly string[],
  b: Layers,
  bArtists: readonly string[],
): string | null {
  const pixels = firstDifference(
    { ...a, lastArtist: new Uint16Array(a.lastArtist.length) },
    { ...b, lastArtist: new Uint16Array(b.lastArtist.length) },
  );
  if (pixels !== null) return pixels;

  for (let cell = 0; cell < a.depth.length; cell++) {
    if (a.depth[cell] === 0) continue; // nobody owns the ground
    const owner = aArtists[a.lastArtist[cell]];
    const expected = bArtists[b.lastArtist[cell]];
    if (owner !== expected) return `cell ${cell} is owned by ${owner}, expected ${expected}`;
  }
  return null;
}

/** Canvas edges worth trying: the degenerate ones, and both real ones. */
const SIZES = [1, 2, 7, 16, 144, 256];

const ROUNDS = 40;

describe("the fast paths agree with the obvious ones", () => {
  for (let round = 0; round < ROUNDS; round++) {
    const seed = 1000 + round;

    it(`holds on random day ${seed}`, () => {
      const rng = generator(seed);
      const size = SIZES[rng.int(SIZES.length)];
      const palette = 1 + rng.int(30);
      const p = randomDay(rng, size, palette, 1 + rng.int(40), 1 + rng.int(6));
      const whole = replay(p, size);
      // The replay itself, against a second implementation.
      expect(firstDifference(whole, naiveReplay(p, size, p.n))).toBeNull();

      // --- scrubbing ------------------------------------------------------
      // A short step means many keyframes; a tiny budget means almost none.
      // Both have to land on the same canvas as replaying from placement zero.
      const timeline = new Timeline(p, size, {
        maxStep: 1 + rng.int(20),
        memoryBudgetBytes: rng.int(200_000),
      });
      expect(timeline.count).toBe(p.n);

      const targets = [
        0,
        p.n,
        p.n, // the same frame twice: the scratch must not drift
        0, // and a full rewind
        ...Array.from({ length: 20 }, () => rng.int(p.n + 1)),
      ];
      for (const upTo of targets) {
        const difference = firstDifference(timeline.frameAt(upTo), naiveReplay(p, size, upTo));
        expect(difference, `frameAt(${upTo}) of ${p.n}, step ${timeline.step}`).toBeNull();
      }

      // --- the core sample ------------------------------------------------
      for (const { x, y } of cellsToProbe(rng, p, size)) {
        const cell = y * size + x;
        const sample = coreSample(p, size, x, y);

        const expected: number[] = [];
        for (let i = 0; i < p.n; i++) if (p.x[i] === x && p.y[i] === y) expected.push(i);
        expect(sample.bands.map((band) => band.index)).toEqual(expected);

        if (sample.bands.length > 0) {
          // The drilled stack has to agree with the canvas it was drilled from.
          expect(sample.bands.length).toBe(whole.depth[cell]);
          expect(sample.bands[sample.bands.length - 1].color).toBe(whole.final[cell]);
          expect(sample.bands[0].color).toBe(whole.first[cell]);
        }

        // A band is buried only when the *next* placement here laid a different
        // colour. Repainting a cell the colour it already was covers nothing —
        // the rule the ghost layer and the "buried" figure both count by, and
        // the one thing about a band that is not simply "it is not the top".
        sample.bands.forEach((band, index) => {
          const next = sample.bands[index + 1];
          expect(band.buried, `band ${index} of (${x},${y})`).toBe(
            next !== undefined && next.color !== band.color,
          );
        });
        expect(sample.buried).toBe(sample.bands.filter((band) => band.buried).length);
        expect(sample.painters).toBe(new Set(sample.bands.map((band) => band.artist)).size);

        // Scrubbing the stack: before the day, mid-day, and past its end.
        for (const upTo of [-1, 0, rng.int(p.n + 2) - 1, p.n - 1, p.n]) {
          const kept = bandsUpTo(sample, upTo);
          expect(kept.length).toBe(expected.filter((i) => i <= upTo).length);
          // Whatever happened later, the last band held is the one on top now.
          if (kept.length > 0) expect(kept[kept.length - 1].buried).toBe(false);
        }
      }

      // --- survival -------------------------------------------------------
      const touched = cellsTouched(p, size);
      const naive = new Map<number, Set<number>>();
      for (let i = 0; i < p.n; i++) {
        const artist = p.artist[i];
        let cells = naive.get(artist);
        if (cells === undefined) naive.set(artist, (cells = new Set()));
        cells.add(p.y[i] * size + p.x[i]);
      }
      expect(touched.size).toBe(naive.size);
      for (const [artist, cells] of naive) expect(touched.get(artist)).toBe(cells.size);

      // `dayStats` counts buried placements with one pass over the whole day;
      // `coreSample` decides it again, per cell, from a different direction. The
      // day's figure is the sum of the cells' — two implementations of one rule,
      // and the number the Ghost view and the share card both print.
      let buriedByCell = 0;
      for (let cell = 0; cell < size * size; cell++) {
        if (whole.depth[cell] === 0) continue;
        buriedByCell += coreSample(p, size, cell % size, Math.floor(cell / size)).buried;
      }
      expect(buriedByCell).toBe(dayStats(whole, p).buriedPlacements);

      // Every painted cell belongs to exactly one artist, and the ground to none.
      const claimed = cellsClaimed(whole);
      let claimedTotal = 0;
      for (const n of claimed.values()) claimedTotal += n;
      expect(claimedTotal).toBe(dayStats(whole, p).paintedCells);

      for (const [artist, victims] of overpaintPairs(p, size)) {
        expect(victims.has(artist), "an artist covered themselves").toBe(false);
      }
      for (const address of p.artists) {
        const record = artistDaySurvival(p, whole, size, address);
        if (record === null) continue;
        expect(record.cellsClaimed).toBeLessThanOrEqual(record.cellsTouched);
        expect(record.survival).toBeGreaterThanOrEqual(0);
        expect(record.survival).toBeLessThanOrEqual(1);
      }

      // --- the binary search ----------------------------------------------
      const moments = [1_000_000 - 1, 1_000_000 + rng.int(p.n * 200 + 400)];
      for (let k = 0; k < 4 && p.n > 0; k++) {
        // A timestamp exactly, and either side of it. `indexAtTime` promises the
        // last placement *at or before* a moment, so the placement laid on that
        // very second is the one the boundary is about.
        const at = p.time[rng.int(p.n)];
        moments.push(at - 1, at, at + 1);
      }
      for (const time of moments) {
        let expectedIndex = -1;
        for (let i = 0; i < p.n; i++) if (p.time[i] <= time) expectedIndex = i;
        expect(indexAtTime(p, time), `indexAtTime(${time})`).toBe(expectedIndex);
      }

      // --- resuming today's canvas ----------------------------------------
      // A day fetched in two goes has to rebuild the day fetched in one. The
      // artist tables of the two halves are independent, so this is really a
      // test that the remap holds.
      if (p.n > 2) {
        const cut = 1 + rng.int(p.n - 1);
        /**
         * Each half interns its own addresses, in the order it meets them and
         * with the second half's order reversed — which is what a fresh
         * `PlacementsBuilder` does on a resumed fetch. Handing both halves one
         * shared table made the remap an identity and the check below vacuous.
         */
        const part = (from: number, to: number, reverse: boolean): Placements => {
          const seen = new Map<string, number>();
          const artists: string[] = [];
          const order = [];
          for (let i = from; i < to; i++) order.push(i);
          for (const i of reverse ? [...order].reverse() : order) {
            const address = p.artists[p.artist[i]];
            if (!seen.has(address)) {
              seen.set(address, artists.length);
              artists.push(address);
            }
          }
          const artist = new Uint16Array(to - from);
          for (let i = from; i < to; i++) artist[i - from] = seen.get(p.artists[p.artist[i]]) ?? 0;
          return {
            n: to - from,
            x: p.x.slice(from, to),
            y: p.y.slice(from, to),
            color: p.color.slice(from, to),
            artist,
            time: p.time.slice(from, to),
            artists,
          };
        };
        const joined = concatPlacements(part(0, cut, false), part(cut, p.n, true));
        expect(joined.n).toBe(p.n);
        expect(
          firstDifferenceByArtist(
            replay(joined, size),
            joined.artists,
            naiveReplay(p, size, p.n),
            p.artists,
          ),
        ).toBeNull();
        for (let i = 0; i < p.n; i++) {
          expect(joined.artists[joined.artist[i]]).toBe(p.artists[p.artist[i]]);
        }
      }

      // --- the time band ---------------------------------------------------
      // Every bar is a real stroke and no stroke is counted twice, so a band
      // drawn over the day's own window accounts for the whole day.
      if (p.n > 0) {
        const histogram = placementHistogram(p, p.time[0], p.time[p.n - 1] + 1, 1 + rng.int(120));
        let total = 0;
        for (const bar of histogram) total += bar;
        expect(total).toBe(p.n);
      }
    });
  }
});
