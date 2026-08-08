import type { Placements } from "./decode.js";

/**
 * Replaying every placement in id order rebuilds the canvas exactly as the
 * chain built it. Everything the app draws is a read of one of these buffers.
 *
 * A cell is unpainted when `depth === 0`. There is no sentinel colour, because
 * palette index 0 is a real colour.
 */
export interface Layers {
  readonly size: number;
  final: Uint8Array; // palette index of the top layer
  first: Uint8Array; // palette index of the first colour ever laid here
  buried: Uint8Array; // palette index directly beneath the top layer
  depth: Uint16Array; // placements on this cell
  lastArtist: Uint16Array; // artist index that owns the top layer
}

export function allocLayers(size: number): Layers {
  const cells = size * size;
  return {
    size,
    final: new Uint8Array(cells),
    first: new Uint8Array(cells),
    buried: new Uint8Array(cells),
    depth: new Uint16Array(cells),
    lastArtist: new Uint16Array(cells),
  };
}

export function replay(p: Placements, size: number, upTo: number = p.n): Layers {
  return replayInto(allocLayers(size), p, 0, upTo);
}

/**
 * Applies placements `[from, to)` on top of `L`. Scrubbing copies the nearest
 * earlier keyframe and calls this with a short range, which is why replay never
 * restarts from placement zero once the day has been loaded.
 */
export function replayInto(L: Layers, p: Placements, from: number, to: number): Layers {
  const { size } = L;
  const { x, y, color, artist } = p;
  const { final, first, buried, depth, lastArtist } = L;
  for (let i = from; i < to; i++) {
    const cell = y[i] * size + x[i];
    const d = depth[cell];
    if (d === 0) first[cell] = color[i];
    else buried[cell] = final[cell];
    final[cell] = color[i];
    lastArtist[cell] = artist[i];
    depth[cell] = d + 1;
  }
  return L;
}

export interface DayStats {
  /** Cells painted at least once. */
  paintedCells: number;
  /** Total placements. */
  placements: number;
  /** The most times any single cell was painted. Normalises the depth ramp. */
  maxDepth: number;
  /** Placements that were later covered by a different colour on the same cell. */
  buriedPlacements: number;
  /** placements ÷ painted cells. 1.0 means nothing was ever painted over. */
  overpaintRatio: number;
}

export function dayStats(L: Layers, p: Placements): DayStats {
  const { depth } = L;
  let paintedCells = 0;
  let maxDepth = 0;
  let placements = 0;
  for (let i = 0; i < depth.length; i++) {
    const d = depth[i];
    if (d === 0) continue;
    paintedCells++;
    placements += d;
    if (d > maxDepth) maxDepth = d;
  }
  return {
    paintedCells,
    placements,
    maxDepth,
    buriedPlacements: countBuried(p, L.size),
    overpaintRatio: paintedCells === 0 ? 0 : placements / paintedCells,
  };
}

/**
 * A buried placement is one later covered by a *different* colour on the same
 * cell. Repainting a cell the colour it already was buries nothing, so this is
 * not simply `placements - paintedCells`.
 */
function countBuried(p: Placements, size: number): number {
  const cells = size * size;
  const top = new Uint8Array(cells);
  const seen = new Uint8Array(cells);
  let count = 0;
  for (let i = 0; i < p.n; i++) {
    const cell = p.y[i] * size + p.x[i];
    if (seen[cell] === 1 && top[cell] !== p.color[i]) count++;
    top[cell] = p.color[i];
    seen[cell] = 1;
  }
  return count;
}

/**
 * Index of the last placement at or before `time`, or -1 if the day had not
 * started yet. Placements are in id order, which is chronological, so timestamps
 * are non-decreasing and a binary search is safe.
 */
export function indexAtTime(p: Placements, time: number): number {
  let lo = 0;
  let hi = p.n - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (p.time[mid] <= time) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
