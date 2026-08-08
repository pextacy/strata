// Joining two runs of placements. Today's canvas is still being painted, so it
// is refetched from the last stroke id already held rather than from stroke
// zero; this is what puts the new pixels behind the old ones.

import type { Anomalies, Placements } from "./decode.ts";

/**
 * `b` appended after `a`, in that order — placement order is chronological and
 * the whole replay depends on it staying that way.
 *
 * Artist indices are local to a `Placements`, so b's are remapped onto a's
 * table. The addresses are already lowercased by the builder.
 */
export function concatPlacements(a: Placements, b: Placements): Placements {
  if (b.n === 0) return a;
  if (a.n === 0) return b;

  const artists = a.artists.slice();
  const indexOf = new Map<string, number>();
  for (let i = 0; i < artists.length; i++) indexOf.set(artists[i], i);

  const remap = new Uint16Array(b.artists.length);
  for (let i = 0; i < b.artists.length; i++) {
    const address = b.artists[i];
    let at = indexOf.get(address);
    if (at === undefined) {
      at = artists.length;
      if (at > 0xffff) {
        throw new Error("more than 65,536 artists on one day; widen Placements.artist");
      }
      artists.push(address);
      indexOf.set(address, at);
    }
    remap[i] = at;
  }

  const n = a.n + b.n;
  const x = new Uint8Array(n);
  const y = new Uint8Array(n);
  const color = new Uint8Array(n);
  const artist = new Uint16Array(n);
  const time = new Uint32Array(n);

  x.set(a.x.subarray(0, a.n));
  y.set(a.y.subarray(0, a.n));
  color.set(a.color.subarray(0, a.n));
  artist.set(a.artist.subarray(0, a.n));
  time.set(a.time.subarray(0, a.n));

  x.set(b.x.subarray(0, b.n), a.n);
  y.set(b.y.subarray(0, b.n), a.n);
  color.set(b.color.subarray(0, b.n), a.n);
  time.set(b.time.subarray(0, b.n), a.n);
  for (let i = 0; i < b.n; i++) artist[a.n + i] = remap[b.artist[i]];

  return { n, x, y, color, artist, time, artists };
}

export const mergeAnomalies = (a: Anomalies, b: Anomalies): Anomalies => ({
  malformedStrokes: a.malformedStrokes + b.malformedStrokes,
  offCanvas: a.offCanvas + b.offCanvas,
  unknownColor: a.unknownColor + b.unknownColor,
});

/** Bytes a Placements occupies, for the cache-size line in dev. */
export const placementBytes = (p: Placements): number => p.n * 9;
