import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { PlacementsBuilder, type Placements, type StrokeRecord } from "../src/core/decode.ts";
import { replay } from "../src/core/replay.ts";
import {
  aggregateSurvival,
  artistDaySurvival,
  artistIndex,
  cellsClaimed,
  cellsTouched,
  emptyLifetime,
  overpaintPairs,
  type ArtistDaySurvival,
} from "../src/core/survival.ts";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/day-0500-strokes.json", import.meta.url), "utf8"),
) as {
  theme: { size: number; palette: string[] };
  strokes: { items: StrokeRecord[] };
};

const ALICE = "0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa";
const BOB = "0xBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbb";
const CAROL = "0xCCccCCccCCccCCccCCccCCccCCccCCccCCccCCcc";
const DAVE = "0xDDddDDddDDddDDddDDddDDddDDddDDddDDddDDdd";

const hex = (n: number) => n.toString(16).padStart(2, "0");

function placementsOf(pixels: [number, number, number, string][], size: number): Placements {
  const builder = new PlacementsBuilder(size, 8, 8);
  pixels.forEach(([x, y, color, artist], i) => {
    builder.addStroke({
      id: String(i + 1),
      accountId: artist,
      data: `0x${hex(x)}${hex(y)}${hex(color)}`,
      pixels: 1,
      timestamp: 1_700_000_000 + i,
    });
  });
  return builder.finish();
}

// A four-cell day, arranged so every rule in PRD.md §5 fires at least once.
//
//   1. alice (0,0) c1
//   2. alice (1,0) c2
//   3. bob   (0,0) c3   bob covers alice — a different artist, a different colour
//   4. alice (2,0) c2
//   5. alice (2,0) c2   the same hand, the same colour: nothing happened
//   6. alice (2,0) c1   the same hand, a new colour: self-overpaint, not counted
//   7. carol (1,0) c2   a different hand, the same colour: nothing was buried,
//                       but the cell now belongs to carol
const SIZE = 4;
const DAY: [number, number, number, string][] = [
  [0, 0, 1, ALICE],
  [1, 0, 2, ALICE],
  [0, 0, 3, BOB],
  [2, 0, 2, ALICE],
  [2, 0, 2, ALICE],
  [2, 0, 1, ALICE],
  [1, 0, 2, CAROL],
];

const placements = placementsOf(DAY, SIZE);
const layers = replay(placements, SIZE);

describe("cellsClaimed", () => {
  it("gives each painted cell to whoever wrote its final colour", () => {
    const claimed = cellsClaimed(layers);
    expect(claimed.get(artistIndex(placements, ALICE))).toBe(1); // (2,0)
    expect(claimed.get(artistIndex(placements, BOB))).toBe(1); // (0,0)
    expect(claimed.get(artistIndex(placements, CAROL))).toBe(1); // (1,0)
  });

  it("hands out exactly the cells that were painted, and no others", () => {
    const claimed = cellsClaimed(layers);
    let total = 0;
    for (const count of claimed.values()) total += count;
    let painted = 0;
    for (const d of layers.depth) if (d > 0) painted++;
    expect(total).toBe(painted);
    expect(total).toBe(3);
  });

  it("does not credit artist 0 with the unpainted ground", () => {
    // lastArtist is zero-initialised and index 0 is a real painter, so an
    // unpainted canvas must produce no claims at all.
    const bare = replay(placementsOf([], SIZE), SIZE);
    expect(cellsClaimed(bare).size).toBe(0);
  });
});

describe("cellsTouched", () => {
  it("counts distinct cells, not placements", () => {
    const touched = cellsTouched(placements, SIZE);
    expect(touched.get(artistIndex(placements, ALICE))).toBe(3); // 5 placements, 3 cells
    expect(touched.get(artistIndex(placements, BOB))).toBe(1);
    expect(touched.get(artistIndex(placements, CAROL))).toBe(1);
  });

  it("agrees with a set-based count on real captured strokes", () => {
    const size = fixture.theme.size;
    const builder = new PlacementsBuilder(size, fixture.theme.palette.length);
    for (const stroke of fixture.strokes.items) builder.addStroke(stroke);
    const p = builder.finish();

    const reference = new Map<number, Set<number>>();
    for (let i = 0; i < p.n; i++) {
      const artist = p.artist[i];
      let cells = reference.get(artist);
      if (cells === undefined) {
        cells = new Set<number>();
        reference.set(artist, cells);
      }
      cells.add(p.y[i] * size + p.x[i]);
    }

    const counted = cellsTouched(p, size);
    expect(counted.size).toBe(reference.size);
    for (const [artist, cells] of reference) {
      expect(counted.get(artist)).toBe(cells.size);
    }
  });
});

describe("overpaintPairs", () => {
  const pairs = overpaintPairs(placements, SIZE);
  const alice = artistIndex(placements, ALICE);
  const bob = artistIndex(placements, BOB);
  const carol = artistIndex(placements, CAROL);

  it("records a cover by a different hand in a different colour", () => {
    expect(pairs.get(bob)?.get(alice)).toBe(1);
  });

  it("does not count painting over yourself", () => {
    expect(pairs.get(alice)).toBeUndefined();
  });

  it("does not count a repaint in the colour that was already there", () => {
    // Carol took the cell, but nothing was lost, so nobody was painted over.
    expect(pairs.get(carol)).toBeUndefined();
  });
});

describe("artistDaySurvival", () => {
  it("reports one artist's day exactly", () => {
    const record = artistDaySurvival(placements, layers, SIZE, ALICE);
    expect(record).not.toBeNull();
    const alice = record as ArtistDaySurvival;
    expect(alice.address).toBe(ALICE.toLowerCase());
    expect(alice.placements).toBe(5);
    expect(alice.cellsTouched).toBe(3);
    expect(alice.cellsClaimed).toBe(1);
    expect(alice.survival).toBeCloseTo(1 / 3);
    expect(alice.coveredBy).toEqual([{ address: BOB.toLowerCase(), times: 1 }]);
    expect(alice.covered).toEqual([]);
  });

  it("credits the artist who did the covering", () => {
    const bob = artistDaySurvival(placements, layers, SIZE, BOB) as ArtistDaySurvival;
    expect(bob.covered).toEqual([{ address: ALICE.toLowerCase(), times: 1 }]);
    expect(bob.coveredBy).toEqual([]);
    expect(bob.survival).toBe(1);
  });

  it("takes a cell from an artist whose colour was matched, without burying it", () => {
    // Carol repainted (1,0) the colour it already was. Alice lost the claim and
    // nothing was buried — the two definitions genuinely do come apart here.
    const carol = artistDaySurvival(placements, layers, SIZE, CAROL) as ArtistDaySurvival;
    expect(carol.cellsClaimed).toBe(1);
    expect(carol.covered).toEqual([]);
  });

  it("is case-insensitive about the address it is asked for", () => {
    const lower = artistDaySurvival(placements, layers, SIZE, ALICE.toLowerCase());
    const upper = artistDaySurvival(placements, layers, SIZE, ALICE.toUpperCase());
    expect(lower).toEqual(upper);
  });

  it("returns null for someone who did not paint that day", () => {
    // Not a record of zeroes: no survival rate and a survival rate of zero are
    // different claims, and only one of them is true.
    expect(artistDaySurvival(placements, layers, SIZE, DAVE)).toBeNull();
  });
});

describe("aggregateSurvival", () => {
  const day = (
    cellsClaimedCount: number,
    cellsTouchedCount: number,
    extra: Partial<ArtistDaySurvival> = {},
  ): ArtistDaySurvival => ({
    address: ALICE.toLowerCase(),
    placements: cellsTouchedCount,
    cellsTouched: cellsTouchedCount,
    cellsClaimed: cellsClaimedCount,
    survival: cellsClaimedCount / cellsTouchedCount,
    coveredBy: [],
    covered: [],
    ...extra,
  });

  it("sums the totals and takes the rate once, never averaging daily rates", () => {
    const lifetime = aggregateSurvival([day(1, 1), day(0, 99)]);
    expect(lifetime.cellsClaimed).toBe(1);
    expect(lifetime.cellsTouched).toBe(100);
    expect(lifetime.survival).toBeCloseTo(0.01); // not 0.5
    expect(lifetime.days).toBe(2);
  });

  it("adds up who painted over whom across days", () => {
    const lifetime = aggregateSurvival([
      day(1, 2, { coveredBy: [{ address: BOB.toLowerCase(), times: 3 }] }),
      day(1, 2, {
        coveredBy: [
          { address: BOB.toLowerCase(), times: 4 },
          { address: CAROL.toLowerCase(), times: 9 },
        ],
      }),
    ]);
    expect(lifetime.coveredBy).toEqual([
      { address: CAROL.toLowerCase(), times: 9 },
      { address: BOB.toLowerCase(), times: 7 },
    ]);
  });

  it("has no rate at all before a day has been replayed", () => {
    expect(aggregateSurvival([])).toEqual(emptyLifetime());
    expect(aggregateSurvival([]).survival).toBeNull();
  });
});
