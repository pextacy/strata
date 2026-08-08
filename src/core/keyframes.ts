import type { Placements } from "./decode.js";
import { allocLayers, indexAtTime, replayInto, type Layers } from "./replay.js";

/**
 * Scrubbing a heavy day cannot rebuild the canvas from placement zero on every
 * frame — half a million placements is far past a 16 ms budget. So the day is
 * replayed once and snapshotted at regular intervals; a scrub copies the nearest
 * earlier snapshot and rolls forward at most `step` placements from there.
 *
 * Dragging forward is cheaper still: the scratch canvas is already at the last
 * scrubbed position, so a small step forward applies only the placements in
 * between and touches no snapshot at all.
 */

/** `final`, `first` and `buried` are a byte a cell; `depth` and `lastArtist` two. */
const BYTES_PER_CELL = 7;

/** DOCS.md §7.1 sizes keyframes in millions of bytes, not in a frame count. */
const DEFAULT_MEMORY_BUDGET = 8 * 1024 * 1024;

/** Forward work per scrub frame, in placements. Well inside one frame. */
const DEFAULT_MAX_STEP = 20_000;

export interface TimelineOptions {
  /** Ceiling on snapshot memory, in bytes. Fewer snapshots means longer scrubs. */
  readonly memoryBudgetBytes?: number;
  /** Placements to roll forward per scrub, at most. */
  readonly maxStep?: number;
}

/**
 * Snapshot budget for this device. `navigator.deviceMemory` is a DOM value, so
 * the caller reads it and passes the number in — core stays pure.
 */
export function keyframeBudget(deviceMemoryGb?: number): number {
  return deviceMemoryGb !== undefined && deviceMemoryGb <= 4
    ? DEFAULT_MEMORY_BUDGET / 2
    : DEFAULT_MEMORY_BUDGET;
}

export class Timeline {
  /** Canvas edge, in cells. */
  readonly size: number;
  /** Placements in the day. `frameAt(count)` is the finished canvas. */
  readonly count: number;
  /** Placements between snapshots, and the most any one scrub replays. */
  readonly step: number;

  private readonly placements: Placements;
  /** `frames[k]` is the canvas after placements `[0, k * step)`. Slot 0 is the
   *  empty canvas and is never stored — zeroing the scratch is free. */
  private readonly frames: readonly (Layers | null)[];
  private readonly scratch: Layers;
  /** Placement index the scratch currently holds. */
  private cursor = 0;

  constructor(placements: Placements, size: number, options: TimelineOptions = {}) {
    const cells = size * size;
    const budget = options.memoryBudgetBytes ?? DEFAULT_MEMORY_BUDGET;
    const maxStep = Math.max(1, options.maxStep ?? DEFAULT_MAX_STEP);

    // One snapshot per `maxStep` placements, capped by what the budget affords.
    // The empty canvas at index 0 costs nothing, so it does not count.
    const affordable = 1 + Math.max(0, Math.floor(budget / (cells * BYTES_PER_CELL)));
    const segments = Math.max(1, Math.min(Math.ceil(placements.n / maxStep), affordable));

    this.size = size;
    this.placements = placements;
    this.count = placements.n;
    this.step = Math.max(1, Math.ceil(placements.n / segments));
    this.scratch = allocLayers(size);

    const frames: (Layers | null)[] = [null];
    if (segments > 1) {
      const work = allocLayers(size);
      for (let k = 1; k < segments; k++) {
        replayInto(work, placements, (k - 1) * this.step, Math.min(k * this.step, placements.n));
        frames.push(cloneLayers(work));
      }
    }
    this.frames = frames;
  }

  /** Snapshots held, including the free empty canvas at index 0. */
  get keyframeCount(): number {
    return this.frames.length;
  }

  /** Bytes the snapshots occupy. Reported rather than guessed at. */
  get keyframeBytes(): number {
    return (this.frames.length - 1) * this.size * this.size * BYTES_PER_CELL;
  }

  /** Unix seconds of placement `index`, clamped to the day's first and last. */
  timeAt(index: number): number {
    if (this.count === 0) return 0;
    const i = clamp(index, 0, this.count - 1);
    return this.placements.time[i];
  }

  /** Index of the last placement at or before `time`, or -1 before the first. */
  indexAtTime(time: number): number {
    return indexAtTime(this.placements, time);
  }

  /** Placements laid at or before `time`. This is what `frameAt` wants. */
  countAtTime(time: number): number {
    return this.indexAtTime(time) + 1;
  }

  /**
   * The canvas after the first `upTo` placements.
   *
   * The returned `Layers` is reused between calls — read it, draw it, and do not
   * hold on to it. Allocating 458 KB of buffers per scrub frame would cost more
   * than the replay does.
   */
  frameAt(upTo: number): Layers {
    const target = clamp(Math.floor(upTo), 0, this.count);
    const k = Math.min(Math.floor(target / this.step), this.frames.length - 1);
    const base = k * this.step;

    // Rewinding, or jumping far enough forward that a snapshot beats the scratch.
    if (this.cursor > target || this.cursor < base) {
      const frame = this.frames[k];
      if (frame) copyLayersInto(this.scratch, frame);
      else zeroLayers(this.scratch);
      this.cursor = base;
    }

    replayInto(this.scratch, this.placements, this.cursor, target);
    this.cursor = target;
    return this.scratch;
  }

  /** The canvas as it stood at `time`, in unix seconds. */
  frameAtTime(time: number): Layers {
    return this.frameAt(this.countAtTime(time));
  }
}

/**
 * Placements per time bucket across `[from, to)`, for drawing the time axis.
 * Every bar is a count of real strokes; the band invents nothing.
 */
export function placementHistogram(
  p: Placements,
  from: number,
  to: number,
  buckets: number,
): Uint32Array {
  const out = new Uint32Array(Math.max(1, buckets));
  const span = to - from;
  if (span <= 0) return out;
  for (let i = 0; i < p.n; i++) {
    const bucket = Math.floor(((p.time[i] - from) / span) * out.length);
    if (bucket < 0 || bucket >= out.length) continue; // a stroke outside the window
    out[bucket]++;
  }
  return out;
}

function cloneLayers(L: Layers): Layers {
  return {
    size: L.size,
    final: L.final.slice(),
    first: L.first.slice(),
    buried: L.buried.slice(),
    depth: L.depth.slice(),
    lastArtist: L.lastArtist.slice(),
  };
}

function copyLayersInto(dst: Layers, src: Layers): void {
  dst.final.set(src.final);
  dst.first.set(src.first);
  dst.buried.set(src.buried);
  dst.depth.set(src.depth);
  dst.lastArtist.set(src.lastArtist);
}

function zeroLayers(L: Layers): void {
  L.final.fill(0);
  L.first.fill(0);
  L.buried.fill(0);
  L.depth.fill(0);
  L.lastArtist.fill(0);
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
