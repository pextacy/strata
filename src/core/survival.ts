// What happened to an artist's pixels. These are the numbers people will quote,
// so the definitions in PRD.md §5 are implemented literally and nothing here
// rounds, samples, or estimates.
//
//   Cells claimed  — cells whose final colour was written by that artist.
//   Cells touched  — distinct cells that artist placed on at any point.
//   Survival rate  — claimed ÷ touched. Painting over yourself does not count
//                    against you; only being covered by someone else does.
//   Lifetime rate  — sum of claimed ÷ sum of touched, never an average of daily
//                    rates, which would let a one-pixel day outvote a busy one.

import type { Placements } from "./decode.js";
import type { Layers } from "./replay.js";

/**
 * Cells whose final colour each artist owns. A cell nobody painted has no owner:
 * `lastArtist` is zero-initialised and artist index 0 is a real painter, so the
 * depth check is the only thing keeping the ground out of somebody's total.
 */
export function cellsClaimed(layers: Layers): Map<number, number> {
  const { depth, lastArtist } = layers;
  const claimed = new Map<number, number>();
  for (let cell = 0; cell < depth.length; cell++) {
    if (depth[cell] === 0) continue;
    const artist = lastArtist[cell];
    claimed.set(artist, (claimed.get(artist) ?? 0) + 1);
  }
  return claimed;
}

/**
 * Distinct cells each artist ever placed on, counted exactly by sorting
 * composite keys rather than by keeping a Set per artist — DOCS.md §9. One
 * Uint32 sort beats half a million Set operations on a heavy day, and it cannot
 * drift the way an approximate counter can.
 *
 * `artist * cells + cell` is the key. It stays inside 32 bits for up to 65,536
 * artists on a 256×256 canvas, which is the same ceiling `Placements.artist`
 * already has.
 */
export function cellsTouched(p: Placements, size: number): Map<number, number> {
  const cells = size * size;
  const keys = new Uint32Array(p.n);
  for (let i = 0; i < p.n; i++) {
    keys[i] = p.artist[i] * cells + (p.y[i] * size + p.x[i]);
  }
  keys.sort(); // typed array sort is numeric, and in place

  const touched = new Map<number, number>();
  for (let i = 0; i < keys.length; i++) {
    if (i > 0 && keys[i] === keys[i - 1]) continue; // same artist, same cell
    const artist = Math.floor(keys[i] / cells);
    touched.set(artist, (touched.get(artist) ?? 0) + 1);
  }
  return touched;
}

/**
 * Who painted over whom: `newArtist -> oldArtist -> placements`. Built by the
 * pass that decides whether a placement is buried, and bound by the same rule —
 * covering a cell with the colour it already had buries nothing, so it is not an
 * overpaint. Painting over your own pixel is not counted either.
 */
export function overpaintPairs(p: Placements, size: number): Map<number, Map<number, number>> {
  const cells = size * size;
  const owner = new Uint16Array(cells);
  const top = new Uint8Array(cells);
  const seen = new Uint8Array(cells);
  const pairs = new Map<number, Map<number, number>>();

  for (let i = 0; i < p.n; i++) {
    const cell = p.y[i] * size + p.x[i];
    const artist = p.artist[i];
    const color = p.color[i];

    if (seen[cell] === 1 && top[cell] !== color && owner[cell] !== artist) {
      let covered = pairs.get(artist);
      if (covered === undefined) {
        covered = new Map<number, number>();
        pairs.set(artist, covered);
      }
      const victim = owner[cell];
      covered.set(victim, (covered.get(victim) ?? 0) + 1);
    }

    owner[cell] = artist;
    top[cell] = color;
    seen[cell] = 1;
  }

  return pairs;
}

/** Index of an address in `p.artists`, or -1 if they did not paint that day. */
export function artistIndex(p: Placements, address: string): number {
  const wanted = address.trim().toLowerCase();
  for (let i = 0; i < p.artists.length; i++) {
    if (p.artists[i] === wanted) return i;
  }
  return -1;
}

export interface OverpaintTally {
  /** Lowercased, as `Placements.artists` holds it. */
  readonly address: string;
  /** Placements, not cells: the same cell fought over twice counts twice. */
  readonly times: number;
}

export interface ArtistDaySurvival {
  readonly address: string;
  /** Pixels this artist placed, counting every repaint of the same cell. */
  readonly placements: number;
  readonly cellsTouched: number;
  readonly cellsClaimed: number;
  /** claimed ÷ touched. Touched is never zero here — see `artistDaySurvival`. */
  readonly survival: number;
  /** Who covered this artist, most first. */
  readonly coveredBy: readonly OverpaintTally[];
  /** Who this artist covered, most first. */
  readonly covered: readonly OverpaintTally[];
}

/**
 * One artist's record for one day, or null when they did not paint it. Null
 * rather than a record of zeroes: a survival rate of 0% and no survival rate at
 * all are different claims, and only one of them is true here.
 */
export function artistDaySurvival(
  p: Placements,
  layers: Layers,
  size: number,
  address: string,
): ArtistDaySurvival | null {
  const index = artistIndex(p, address);
  if (index < 0) return null;

  const touched = cellsTouched(p, size).get(index) ?? 0;
  if (touched === 0) return null;

  const claimed = cellsClaimed(layers).get(index) ?? 0;

  let placements = 0;
  for (let i = 0; i < p.n; i++) {
    if (p.artist[i] === index) placements++;
  }

  const pairs = overpaintPairs(p, size);
  const covered = tally(p, pairs.get(index));
  const coveredBy: OverpaintTally[] = [];
  for (const [other, victims] of pairs) {
    if (other === index) continue;
    const times = victims.get(index);
    if (times !== undefined && times > 0) {
      coveredBy.push({ address: p.artists[other], times });
    }
  }
  coveredBy.sort(byTimes);

  return {
    address: p.artists[index],
    placements,
    cellsTouched: touched,
    cellsClaimed: claimed,
    survival: claimed / touched,
    coveredBy,
    covered,
  };
}

function tally(p: Placements, victims: Map<number, number> | undefined): OverpaintTally[] {
  if (victims === undefined) return [];
  const out: OverpaintTally[] = [];
  for (const [artist, times] of victims) {
    if (times > 0) out.push({ address: p.artists[artist], times });
  }
  out.sort(byTimes);
  return out;
}

const byTimes = (a: OverpaintTally, b: OverpaintTally): number =>
  b.times - a.times || a.address.localeCompare(b.address);

export interface LifetimeSurvival {
  /** Days that went into these numbers. The UI states this scope in words. */
  readonly days: number;
  readonly placements: number;
  readonly cellsTouched: number;
  readonly cellsClaimed: number;
  /** Null when no day has been replayed yet — never a zero standing in for one. */
  readonly survival: number | null;
  readonly coveredBy: readonly OverpaintTally[];
  readonly covered: readonly OverpaintTally[];
}

export const emptyLifetime = (): LifetimeSurvival => ({
  days: 0,
  placements: 0,
  cellsTouched: 0,
  cellsClaimed: 0,
  survival: null,
  coveredBy: [],
  covered: [],
});

/**
 * Days added together, PRD.md §5: totals are summed and the rate is taken once
 * at the end. Averaging the daily rates would give a day where the artist placed
 * one pixel the same weight as a day where they placed ten thousand.
 */
export function aggregateSurvival(days: readonly ArtistDaySurvival[]): LifetimeSurvival {
  if (days.length === 0) return emptyLifetime();

  let placements = 0;
  let touched = 0;
  let claimed = 0;
  const coveredBy = new Map<string, number>();
  const covered = new Map<string, number>();

  for (const day of days) {
    placements += day.placements;
    touched += day.cellsTouched;
    claimed += day.cellsClaimed;
    for (const t of day.coveredBy) coveredBy.set(t.address, (coveredBy.get(t.address) ?? 0) + t.times);
    for (const t of day.covered) covered.set(t.address, (covered.get(t.address) ?? 0) + t.times);
  }

  return {
    days: days.length,
    placements,
    cellsTouched: touched,
    cellsClaimed: claimed,
    survival: touched === 0 ? null : claimed / touched,
    coveredBy: sortTallies(coveredBy),
    covered: sortTallies(covered),
  };
}

function sortTallies(counts: Map<string, number>): OverpaintTally[] {
  const out: OverpaintTally[] = [];
  for (const [address, times] of counts) out.push({ address, times });
  out.sort(byTimes);
  return out;
}
