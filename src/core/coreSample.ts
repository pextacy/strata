// Drill one cell and read back every colour it has ever been.
//
// This history is never stored. A 256×256 canvas has 65,536 cells and a heavy
// day has hundreds of thousands of placements; keeping a per-cell list would
// cost more memory than the whole day and would have to be rebuilt on every
// scrub. Instead one cell is recovered by a single linear pass over the typed
// arrays, which is a few milliseconds — far faster than the click that asked
// for it.

import type { Placements } from "./decode.js";

/** One colour this cell has been, and who put it there. */
export interface Band {
  /** Palette index. */
  readonly color: number;
  /** Index into `Placements.artists`. */
  readonly artist: number;
  /** Unix seconds. */
  readonly time: number;
  /** Placement index — the chronological key, and the tiebreak inside a stroke. */
  readonly index: number;
  /**
   * True when the next placement on this cell laid a different colour, so this
   * band was covered over. Repainting a cell the colour it already was buries
   * nothing, which is the same rule `dayStats` counts by.
   */
  readonly buried: boolean;
}

export interface CoreSampleResult {
  readonly x: number;
  readonly y: number;
  /** `y * size + x`, the index every layer buffer uses. */
  readonly cell: number;
  /** Oldest first. Render bottom-up: the last band is what the canvas shows. */
  readonly bands: readonly Band[];
  /** Distinct addresses that placed here. */
  readonly painters: number;
  /** Bands covered by a different colour. `bands.length - buried` survived. */
  readonly buried: number;
}

/** True for a cell that exists on a `size × size` canvas. */
export const isOnCanvas = (size: number, x: number, y: number): boolean =>
  Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < size && y < size;

/**
 * Every placement on one cell, oldest first. Empty for a cell nobody painted —
 * which is a real answer, not a failure.
 */
export function coreSample(
  p: Placements,
  size: number,
  x: number,
  y: number,
): CoreSampleResult {
  const cell = y * size + x;
  const bands: Band[] = [];

  if (!isOnCanvas(size, x, y)) {
    return { x, y, cell, bands, painters: 0, buried: 0 };
  }

  const { n, x: xs, y: ys, color, artist, time } = p;
  // One pass, no allocation per placement. `hits` collects indices first so the
  // `buried` flag can look at the next band without a second scan.
  const hits: number[] = [];
  for (let i = 0; i < n; i++) {
    if (xs[i] === x && ys[i] === y) hits.push(i);
  }

  const painters = new Set<number>();
  let buried = 0;
  for (let k = 0; k < hits.length; k++) {
    const i = hits[k];
    const next = k + 1 < hits.length ? hits[k + 1] : -1;
    const covered = next !== -1 && color[next] !== color[i];
    if (covered) buried++;
    painters.add(artist[i]);
    bands.push({
      color: color[i],
      artist: artist[i],
      time: time[i],
      index: i,
      buried: covered,
    });
  }

  return { x, y, cell, bands, painters: painters.size, buried };
}

/**
 * The bands as they stood at a moment, for when the scrubber is not at the end
 * of the day. `upTo` is a placement index — the same one `indexAtTime` returns.
 */
export function bandsUpTo(sample: CoreSampleResult, upTo: number): readonly Band[] {
  const all = sample.bands;
  // `upTo` counts placements in the whole day, not bands on this cell — a cell
  // painted nineteen times can hold band indices in the hundreds of thousands.
  // Comparing it against `all.length` shortcut every real scrub straight back to
  // the finished stack, which is the day's last frame wearing an earlier time.
  if (all.length === 0 || upTo >= all[all.length - 1].index) return all;

  const kept: Band[] = [];
  for (const band of sample.bands) {
    if (band.index > upTo) break;
    kept.push(band);
  }
  // The last surviving band is on top now, whatever happened to it later.
  if (kept.length > 0) {
    const last = kept.length - 1;
    kept[last] = { ...kept[last], buried: false };
  }
  return kept;
}
