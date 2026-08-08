import { describe, expect, it } from "vitest";

import { PlacementsBuilder, noAnomalies, type StrokeRecord } from "../src/core/decode.js";
import { concatPlacements, mergeAnomalies, placementBytes } from "../src/core/placements.js";
import { replay } from "../src/core/replay.js";

const SIZE = 8;
const PALETTE_LENGTH = 8;

const alice = "0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa";
const bob = "0xBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbb";
const carol = "0xCCccCCccCCccCCccCCccCCccCCccCCccCCccCCcc";

const hex = (n: number) => n.toString(16).padStart(2, "0");

function build(pixels: [number, number, number, string][], firstId = 1) {
  const builder = new PlacementsBuilder(SIZE, PALETTE_LENGTH, 4);
  pixels.forEach(([x, y, color, artist], i) => {
    const stroke: StrokeRecord = {
      id: String(firstId + i),
      accountId: artist,
      data: `0x${hex(x)}${hex(y)}${hex(color)}`,
      pixels: 1,
      timestamp: 1_700_000_000 + firstId + i,
    };
    builder.addStroke(stroke);
  });
  return builder.finish();
}

describe("concatPlacements", () => {
  it("keeps chronological order across the join", () => {
    const held = build([
      [0, 0, 1, alice],
      [1, 1, 2, bob],
    ]);
    const fresh = build([[0, 0, 3, carol]], 3);
    const joined = concatPlacements(held, fresh);

    expect(joined.n).toBe(3);
    expect([...joined.color]).toEqual([1, 2, 3]);
    expect(joined.time[2]).toBeGreaterThan(joined.time[1]);
  });

  it("remaps artist indices onto the first table without inventing a painter", () => {
    const held = build([
      [0, 0, 1, alice],
      [1, 0, 1, bob],
    ]);
    // A fresh page interns its own artists from zero: carol is 0 here, bob is 1.
    const fresh = build(
      [
        [2, 0, 2, carol],
        [3, 0, 2, bob],
      ],
      3,
    );
    const joined = concatPlacements(held, fresh);

    expect(joined.artists).toEqual([alice.toLowerCase(), bob.toLowerCase(), carol.toLowerCase()]);
    expect(joined.artists[joined.artist[2]]).toBe(carol.toLowerCase());
    expect(joined.artists[joined.artist[3]]).toBe(bob.toLowerCase());
  });

  it("replays a resumed day exactly as a cold load of the same strokes", () => {
    const all: [number, number, number, string][] = [
      [0, 0, 1, alice],
      [1, 1, 2, bob],
      [0, 0, 3, carol],
      [1, 1, 4, alice],
      [7, 7, 5, bob],
    ];
    const cold = replay(build(all), SIZE);
    const resumed = replay(concatPlacements(build(all.slice(0, 2)), build(all.slice(2), 3)), SIZE);

    expect([...resumed.final]).toEqual([...cold.final]);
    expect([...resumed.first]).toEqual([...cold.first]);
    expect([...resumed.buried]).toEqual([...cold.buried]);
    expect([...resumed.depth]).toEqual([...cold.depth]);
    // lastArtist is an index into artists[], so compare the addresses it names.
    const coldNames = build(all).artists;
    const resumedNames = concatPlacements(build(all.slice(0, 2)), build(all.slice(2), 3)).artists;
    for (let cell = 0; cell < SIZE * SIZE; cell++) {
      if (cold.depth[cell] === 0) continue;
      expect(resumedNames[resumed.lastArtist[cell]]).toBe(coldNames[cold.lastArtist[cell]]);
    }
  });

  it("returns the side that has anything when the other is empty", () => {
    const held = build([[0, 0, 1, alice]]);
    const empty = build([]);
    expect(concatPlacements(held, empty)).toBe(held);
    expect(concatPlacements(empty, held)).toBe(held);
  });
});

describe("mergeAnomalies", () => {
  it("adds up rather than losing the earlier count", () => {
    const merged = mergeAnomalies(
      { malformedStrokes: 1, offCanvas: 2, unknownColor: 3 },
      { malformedStrokes: 10, offCanvas: 20, unknownColor: 30 },
    );
    expect(merged).toEqual({ malformedStrokes: 11, offCanvas: 22, unknownColor: 33 });
    expect(mergeAnomalies(noAnomalies(), noAnomalies())).toEqual(noAnomalies());
  });
});

describe("placementBytes", () => {
  it("reports the nine bytes a placement actually costs", () => {
    expect(placementBytes(build([[0, 0, 1, alice]]))).toBe(9);
  });
});
