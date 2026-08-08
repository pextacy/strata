// A stroke's `data` is a hex string of 3-byte pixels: x, y, palette index.
// `0x5a2b03` is one pixel at (90, 43) in palette slot 3. Everything the app
// knows about a canvas comes through this function, so it stays dumb and tested.

export class MalformedStrokeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MalformedStrokeError";
  }
}

/** Pixels a stroke claims to hold, from its hex length alone. */
export function strokePixelCount(data: string): number {
  const hex = data.startsWith("0x") || data.startsWith("0X") ? data.length - 2 : data.length;
  return hex % 6 === 0 ? hex / 6 : 0;
}

/**
 * Calls `out` once per pixel and returns the pixel count. Throws on a length
 * that is not a whole number of pixels; a caller replaying a day counts those
 * rather than abandoning the day.
 */
export function decodeStroke(
  data: string,
  out: (x: number, y: number, color: number) => void,
): number {
  const hex = data.startsWith("0x") || data.startsWith("0X") ? data.slice(2) : data;
  if (hex.length % 6 !== 0) {
    throw new MalformedStrokeError(
      `stroke data is ${hex.length} hex characters, not a whole number of 3-byte pixels`,
    );
  }
  const count = hex.length / 6;
  for (let i = 0; i < count; i++) {
    const at = i * 6;
    const x = parseInt(hex.slice(at, at + 2), 16);
    const y = parseInt(hex.slice(at + 2, at + 4), 16);
    const color = parseInt(hex.slice(at + 4, at + 6), 16);
    if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(color)) {
      throw new MalformedStrokeError(`stroke data has a non-hex character at pixel ${i}`);
    }
    out(x, y, color);
  }
  return count;
}

/**
 * Every pixel written on a day, as a struct of typed arrays. A heavy day is
 * hundreds of thousands of placements, so this is never an array of objects:
 * nine bytes each, and transferable out of a worker without a copy.
 */
export interface Placements {
  readonly n: number;
  readonly x: Uint8Array;
  readonly y: Uint8Array;
  /** Palette index. */
  readonly color: Uint8Array;
  /** Index into `artists`. */
  readonly artist: Uint16Array;
  /** Unix seconds. */
  readonly time: Uint32Array;
  /** Lowercased addresses, interned. */
  readonly artists: string[];
}

/** What the decoder had to skip or flag. Surfaced, never swallowed. */
export interface Anomalies {
  /** Strokes whose hex could not be read. Their pixels are missing. */
  malformedStrokes: number;
  /** Pixels addressing a cell outside the canvas. Dropped — they have no cell. */
  offCanvas: number;
  /** Pixels naming a palette slot this day does not have. Kept, and counted. */
  unknownColor: number;
}

/** One row of the indexer's `stroke` table, as the app asks for it. */
export interface StrokeRecord {
  readonly id: string;
  readonly accountId: string;
  readonly data: string;
  readonly pixels: number;
  readonly timestamp: number;
}

export const noAnomalies = (): Anomalies => ({
  malformedStrokes: 0,
  offCanvas: 0,
  unknownColor: 0,
});

export const hasAnomalies = (a: Anomalies): boolean =>
  a.malformedStrokes > 0 || a.offCanvas > 0 || a.unknownColor > 0;

/**
 * Accumulates decoded strokes into one `Placements`. Capacity doubles rather
 * than being guessed up front, because the hex string is the only authoritative
 * pixel count a stroke has.
 */
export class PlacementsBuilder {
  private cap: number;
  private count = 0;
  private xs: Uint8Array;
  private ys: Uint8Array;
  private colors: Uint8Array;
  private artistIdx: Uint16Array;
  private times: Uint32Array;

  private readonly artists: string[] = [];
  private readonly artistIds = new Map<string, number>();

  readonly anomalies: Anomalies = noAnomalies();

  private readonly size: number;
  private readonly paletteLength: number;

  constructor(size: number, paletteLength: number, initialCapacity = 1 << 16) {
    if (!Number.isInteger(size) || size <= 0 || size > 256) {
      throw new Error(`canvas size ${size} is outside the 1..256 a byte coordinate can address`);
    }
    this.size = size;
    this.paletteLength = paletteLength;
    this.cap = Math.max(1, initialCapacity);
    this.xs = new Uint8Array(this.cap);
    this.ys = new Uint8Array(this.cap);
    this.colors = new Uint8Array(this.cap);
    this.artistIdx = new Uint16Array(this.cap);
    this.times = new Uint32Array(this.cap);
  }

  get length(): number {
    return this.count;
  }

  get artistCount(): number {
    return this.artists.length;
  }

  /** Interns an address so a placement can carry a 2-byte artist index. */
  artistIndex(address: string): number {
    const key = address.toLowerCase();
    const existing = this.artistIds.get(key);
    if (existing !== undefined) return existing;
    const next = this.artists.length;
    if (next > 0xffff) {
      throw new Error("more than 65,536 artists on one day; widen Placements.artist");
    }
    this.artists.push(key);
    this.artistIds.set(key, next);
    return next;
  }

  /** Returns the pixels appended, which is 0 for a stroke that would not decode. */
  addStroke(stroke: StrokeRecord): number {
    const artist = this.artistIndex(stroke.accountId);
    const time = stroke.timestamp >>> 0;
    const before = this.count;
    this.reserve(strokePixelCount(stroke.data));

    try {
      decodeStroke(stroke.data, (x, y, color) => {
        if (x >= this.size || y >= this.size) {
          this.anomalies.offCanvas++;
          return;
        }
        if (color >= this.paletteLength) this.anomalies.unknownColor++;
        this.push(x, y, color, artist, time);
      });
    } catch (err) {
      if (!(err instanceof MalformedStrokeError)) throw err;
      this.anomalies.malformedStrokes++;
      this.count = before; // a half-read stroke contributes nothing
      return 0;
    }
    return this.count - before;
  }

  /** Trimmed copies, so a transfer carries no slack capacity. */
  finish(): Placements {
    return {
      n: this.count,
      x: this.xs.slice(0, this.count),
      y: this.ys.slice(0, this.count),
      color: this.colors.slice(0, this.count),
      artist: this.artistIdx.slice(0, this.count),
      time: this.times.slice(0, this.count),
      artists: this.artists.slice(),
    };
  }

  private push(x: number, y: number, color: number, artist: number, time: number): void {
    if (this.count === this.cap) this.reserve(1);
    const i = this.count++;
    this.xs[i] = x;
    this.ys[i] = y;
    this.colors[i] = color;
    this.artistIdx[i] = artist;
    this.times[i] = time;
  }

  private reserve(extra: number): void {
    const needed = this.count + extra;
    if (needed <= this.cap) return;
    let cap = this.cap;
    while (cap < needed) cap *= 2;
    this.xs = grow(this.xs, new Uint8Array(cap));
    this.ys = grow(this.ys, new Uint8Array(cap));
    this.colors = grow(this.colors, new Uint8Array(cap));
    this.artistIdx = grow(this.artistIdx, new Uint16Array(cap));
    this.times = grow(this.times, new Uint32Array(cap));
    this.cap = cap;
  }
}

function grow<T extends { set(source: T): void }>(source: T, next: T): T {
  next.set(source);
  return next;
}

/** Every ArrayBuffer inside a Placements, for a postMessage transfer list. */
export const placementBuffers = (p: Placements): ArrayBuffer[] => [
  p.x.buffer as ArrayBuffer,
  p.y.buffer as ArrayBuffer,
  p.color.buffer as ArrayBuffer,
  p.artist.buffer as ArrayBuffer,
  p.time.buffer as ArrayBuffer,
];
