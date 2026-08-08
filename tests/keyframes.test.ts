import { describe, expect, it } from "vitest";

import type { Placements } from "../src/core/decode.js";
import { Timeline, keyframeBudget, placementHistogram } from "../src/core/keyframes.js";
import { replay, type Layers } from "../src/core/replay.js";

/**
 * A scrub is only allowed to be fast if it is also exactly right. Every case
 * here compares the timeline against a full replay from placement zero, which
 * is the definition the verified canvas is built on.
 */

const SIZE = 8;

/** Deterministic pseudo-random placements — no Math.random, so failures repeat. */
function makePlacements(n: number, size = SIZE, artists = 4): Placements {
  const x = new Uint8Array(n);
  const y = new Uint8Array(n);
  const color = new Uint8Array(n);
  const artist = new Uint16Array(n);
  const time = new Uint32Array(n);
  let seed = 1;
  const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
  for (let i = 0; i < n; i++) {
    x[i] = next() % size;
    y[i] = next() % size;
    color[i] = next() % 12;
    artist[i] = next() % artists;
    time[i] = 1_000_000 + i * 3; // id order is chronological, so time never goes back
  }
  return {
    n,
    x,
    y,
    color,
    artist,
    time,
    artists: Array.from({ length: artists }, (_, i) => `0x${String(i).repeat(40)}`),
  };
}

function expectSameLayers(actual: Layers, expected: Layers, at: number): void {
  expect(Array.from(actual.final), `final at ${at}`).toEqual(Array.from(expected.final));
  expect(Array.from(actual.first), `first at ${at}`).toEqual(Array.from(expected.first));
  expect(Array.from(actual.buried), `buried at ${at}`).toEqual(Array.from(expected.buried));
  expect(Array.from(actual.depth), `depth at ${at}`).toEqual(Array.from(expected.depth));
  expect(Array.from(actual.lastArtist), `lastArtist at ${at}`).toEqual(
    Array.from(expected.lastArtist),
  );
}

describe("Timeline.frameAt", () => {
  it("matches a full replay at every index", () => {
    const p = makePlacements(400);
    const timeline = new Timeline(p, SIZE, { maxStep: 37 });
    for (let i = 0; i <= p.n; i++) {
      expectSameLayers(timeline.frameAt(i), replay(p, SIZE, i), i);
    }
  });

  it("matches a full replay when the scrub jumps around", () => {
    const p = makePlacements(400);
    const timeline = new Timeline(p, SIZE, { maxStep: 37 });
    // Forward creep, a long rewind, a jump to the end, a jump to the start.
    for (const i of [10, 11, 12, 300, 299, 5, 400, 0, 137, 136, 400, 399]) {
      expectSameLayers(timeline.frameAt(i), replay(p, SIZE, i), i);
    }
  });

  it("clamps out-of-range and fractional positions", () => {
    const p = makePlacements(50);
    const timeline = new Timeline(p, SIZE, { maxStep: 8 });
    expectSameLayers(timeline.frameAt(-40), replay(p, SIZE, 0), -40);
    expectSameLayers(timeline.frameAt(9999), replay(p, SIZE, p.n), 9999);
    expectSameLayers(timeline.frameAt(20.9), replay(p, SIZE, 20), 20.9);
  });

  it("is still correct when the memory budget affords no snapshots", () => {
    const p = makePlacements(300);
    const timeline = new Timeline(p, SIZE, { maxStep: 10, memoryBudgetBytes: 0 });
    expect(timeline.keyframeCount).toBe(1);
    expect(timeline.keyframeBytes).toBe(0);
    for (const i of [300, 150, 0, 299]) {
      expectSameLayers(timeline.frameAt(i), replay(p, SIZE, i), i);
    }
  });

  it("handles a day with no strokes yet", () => {
    const p = makePlacements(0);
    const timeline = new Timeline(p, SIZE);
    expect(timeline.count).toBe(0);
    expect(timeline.frameAt(0).depth.every((d) => d === 0)).toBe(true);
  });
});

describe("Timeline snapshot sizing", () => {
  it("never replays more than `step` placements per scrub", () => {
    const p = makePlacements(1000);
    const timeline = new Timeline(p, SIZE, { maxStep: 100 });
    expect(timeline.step).toBeLessThanOrEqual(100);
    expect(timeline.keyframeCount).toBeGreaterThan(1);
  });

  it("stays inside the memory budget it was given", () => {
    const p = makePlacements(1000);
    const budget = 3 * SIZE * SIZE * 7;
    const timeline = new Timeline(p, SIZE, { maxStep: 1, memoryBudgetBytes: budget });
    expect(timeline.keyframeBytes).toBeLessThanOrEqual(budget);
  });

  it("halves the budget on a small-memory device", () => {
    expect(keyframeBudget(4)).toBe(keyframeBudget(8) / 2);
    expect(keyframeBudget()).toBe(keyframeBudget(8));
  });
});

describe("Timeline time lookup", () => {
  it("finds the placement count at a moment", () => {
    const p = makePlacements(100);
    const timeline = new Timeline(p, SIZE, { maxStep: 10 });
    expect(timeline.countAtTime(p.time[0] - 1)).toBe(0);
    expect(timeline.countAtTime(p.time[0])).toBe(1);
    expect(timeline.countAtTime(p.time[49])).toBe(50);
    expect(timeline.countAtTime(p.time[99] + 10_000)).toBe(100);
  });

  it("renders the same canvas by time as by index", () => {
    const p = makePlacements(100);
    const timeline = new Timeline(p, SIZE, { maxStep: 10 });
    const t = p.time[63];
    expectSameLayers(timeline.frameAtTime(t), replay(p, SIZE, 64), t);
  });
});

describe("placementHistogram", () => {
  it("counts every placement inside the window exactly once", () => {
    const p = makePlacements(500);
    const bars = placementHistogram(p, p.time[0], p.time[p.n - 1] + 1, 24);
    expect(bars.reduce((a, b) => a + b, 0)).toBe(p.n);
  });

  it("drops placements outside the window rather than pinning them to an edge", () => {
    const p = makePlacements(100);
    const bars = placementHistogram(p, p.time[50], p.time[p.n - 1] + 1, 10);
    expect(bars.reduce((a, b) => a + b, 0)).toBe(50);
  });

  it("returns empty bars for a window with no span", () => {
    const p = makePlacements(10);
    expect(Array.from(placementHistogram(p, 100, 100, 4))).toEqual([0, 0, 0, 0]);
  });
});
