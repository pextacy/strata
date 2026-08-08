# Strata — Technical Reference

Everything the implementation depends on. Facts here are drawn from `https://basepaint.xyz/ai.txt` and from `ponder.schema.ts` in `BasePaint/basepaint-ponder`. Where something cannot be known without asking the live API, this file says so and gives the command that asks.

---

## 1. BasePaint in one paragraph

A new canvas opens every 24 hours with a theme and a fixed palette. Anyone holding a brush NFT can paint a limited number of pixels into it. Painting is a transaction on Base, so every stroke is on chain. After 24 hours the canvas closes and goes on sale for 24 hours, and sale proceeds are split between that day's artists. All artwork is CC0.

## 2. Constants

```ts
export const DAY_ONE_START = 1691599315; // unix seconds
export const DAY_DURATION  = 86400;      // seconds, exact

export const CONTRACTS = {
  basePaint:        "0xBa5e05cb26b78eDa3A2f8e3b3814726305dcAc83",
  brush:            "0xD68fe5b53e7E1AbeB5A4d0A6660667791f39263a",
  wip:              "0xE6249eAfdC9C8a809fE28a5213120B1860f9a75f",
  rewards:          "0xaff1A9E200000061fC3283455d8B0C7e3e728161",
  brushEvents:      "0xb152f48F207d9D1C30Ff60d46E8cb8c1a5d00dEC",
  animation:        "0xC59F475122e914aFCf31C0a9E0A2274666135e4E",
  metadataRegistry: "0x5104482a2Ef3a03b6270D3e931eac890b86FaD01",
  subscription:     "0x75CF063a65d361527180805b244bC51c1deAb075",
} as const;
```

Day math:

```ts
export const currentDay = (nowSec = Math.floor(Date.now() / 1000)) =>
  Math.floor((nowSec - DAY_ONE_START) / DAY_DURATION) + 1;

export const dayStart = (day: number) => DAY_ONE_START + (day - 1) * DAY_DURATION;
export const dayEnd   = (day: number) => dayStart(day) + DAY_DURATION;
```

Test anchors: `currentDay(1691599315) === 1`, `currentDay(1691599315 + 86399) === 1`, `currentDay(1691599315 + 86400) === 2`. Day boundaries land at about 16:42 UTC.

Canvas size is 144×144 for days 1–365 and 256×256 from day 366. **Do not encode that rule in the app** — read `size` from the theme API per day, so the app keeps working if it changes again.

## 3. HTTP endpoints

| Purpose | URL | Notes |
| --- | --- | --- |
| Theme, palette, size | `https://basepaint.xyz/api/theme/:day` | JSON, CORS enabled. `{ theme, proposer, size, palette }`, `palette` is an array of hex strings. This is the source of truth for palette and size. |
| Final artwork | `https://basepaint.net/v3/XXXX.png` | Day zero-padded to 4 digits. Used only by the Node verification script. |
| Timelapse | `https://basepaint.net/animations/XXXX.mp4` | Not used by Strata; BasePaint already shows it. |
| In-progress canvas | `https://basepaint.xyz/api/art/image?day=painting&scale=1` | Current canvas state as an image. Strata renders today from strokes instead, but this is a useful cross-check. |
| Indexer | `https://graphql.basepaint.xyz` | GraphQL. GET returns the Ponder playground; queries are POSTed. |
| Beacon | `https://basepaint.xyz/api/beacon.gif?ref=strata` | 1×1 pixel, optional, lets BasePaint see traffic from derivative apps. |

## 4. The indexer

The indexer is Ponder. Its tables, from `ponder.schema.ts`:

**`stroke`** — the pixel firehose. `id` (bigint, chronological), `canvasId` (int), `accountId` (text, address), `brushId` (int), `data` (text, hex), `pixels` (int), `tx` (text), `timestamp` (int).

**`canvas`** — one per day. `id`, `name`, `palette`, `size`, `proposer`, `totalArtists`, `pixelsCount`, `totalMints`, `totalBurns`, `totalEarned`, `totalEarnedUsd8`, `ethUsdPriceAtStart8`.

**`account`** — `id` (address), `totalPixels`, `totalEarned`, `totalWithdrawn`, `streak`, `longestStreak`, `lastPaintedDay`, `totalDaysPainted`.

**`contribution`** — one artist on one day: `accountId`, `canvasId`, `pixelsCount`.

**`brush`** — `id`, `ownerId`, `strength`, `lastUsedDay`, `mintedTimestamp`, `streak`.

Also present: `global`, `usage`, `withdrawal`, `animation`, `balance`, `total_balance`.

### 4.1 Introspection is step zero

Ponder derives root query field names from the schema, and the exact singular/plural spelling is not worth guessing. Run this before writing any query:

```js
// scripts/introspect.mjs
const ENDPOINT = "https://graphql.basepaint.xyz";

const res = await fetch(ENDPOINT, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    query: `{ __schema { queryType { fields { name type { name kind } } } } }`,
  }),
});

const { data, errors } = await res.json();
if (errors) throw new Error(JSON.stringify(errors));

const fields = data.__schema.queryType.fields;
console.log(fields.map((f) => f.name).join("\n"));

await import("node:fs/promises").then((fs) =>
  fs.writeFile("src/data/schema.json", JSON.stringify(data, null, 2)),
);
```

Read the output, then write `src/data/queries.ts` against the names it printed. To learn the argument shape of the stroke field, introspect it specifically:

```graphql
{ __type(name: "Query") { fields { name args { name type { name kind ofType { name } } } } } }
```

Ponder's paged fields take `where`, `orderBy`, `orderDirection`, `limit`, `after`, and return `{ items, pageInfo { hasNextPage endCursor }, totalCount }`. `limit` is capped at 1000 per page. `id` on `stroke` is a bigint and arrives as a string — parse with `BigInt()`, never `Number()`.

### 4.2 The two queries the app sends

Adjust the root field names to whatever introspection reported.

```graphql
query DayStrokes($canvasId: Int!, $after: String) {
  strokes(
    where: { canvasId: $canvasId }
    orderBy: "id"
    orderDirection: "asc"
    limit: 1000
    after: $after
  ) {
    items { id accountId data pixels timestamp }
    pageInfo { hasNextPage endCursor }
    totalCount
  }
}
```

```graphql
query DayCanvas($id: Int!) {
  canvas(id: $id) {
    id name size palette proposer
    totalArtists pixelsCount totalMints totalBurns totalEarned
  }
}
```

Page until `hasNextPage` is false, reporting progress as you go. A busy day is roughly five to twenty pages. Order by `id` ascending and never re-sort by `timestamp` — several strokes share a timestamp, and `id` is the chronological tiebreaker that the canvas itself was built with.

## 5. Decoding a stroke

`data` is a hex string. Skip `0x`, read 6 hex characters at a time: byte 0 is x, byte 1 is y, byte 2 is the palette index. Coordinates are 0-based from the top-left.

Worked example: `0x5a2b03` is one pixel at x=90, y=43, palette index 3. `0x5a2b03000105` is two pixels: (90, 43) index 3, then (0, 1) index 5.

```ts
// src/core/decode.ts
export function decodeStroke(
  data: string,
  out: (x: number, y: number, color: number) => void,
): number {
  const hex = data.startsWith("0x") ? data.slice(2) : data;
  if (hex.length % 6 !== 0) {
    throw new Error(`stroke data length ${hex.length} is not a multiple of 6`);
  }
  const count = hex.length / 6;
  for (let i = 0; i < count; i++) {
    const at = i * 6;
    out(
      parseInt(hex.slice(at, at + 2), 16),
      parseInt(hex.slice(at + 2, at + 4), 16),
      parseInt(hex.slice(at + 4, at + 6), 16),
    );
  }
  return count;
}
```

Guard rails worth keeping: a coordinate at or beyond `size`, or a palette index beyond the palette length, means either a malformed stroke or the wrong `size`. Count these and surface the count in dev; do not silently drop them.

## 6. Placements

One placement is one pixel written by one stroke. Held as a struct of arrays, never as objects — a heavy day is hundreds of thousands of placements.

```ts
export interface Placements {
  readonly n: number;
  readonly x: Uint8Array;      // canvas is at most 256 wide
  readonly y: Uint8Array;
  readonly color: Uint8Array;  // palette index
  readonly artist: Uint16Array;// index into artists[]
  readonly time: Uint32Array;  // unix seconds
  readonly artists: string[];  // lowercased addresses
}
```

Build it in one pass over the paged strokes: intern each `accountId` into `artists`, decode the stroke's pixels, append. At roughly 9 bytes per placement, 500,000 placements is about 4.5 MB — comfortable, and transferable to the main thread with zero copying.

## 7. Replay

Replaying placements in order produces the layer buffers the whole UI reads from.

```ts
// src/core/replay.ts
export interface Layers {
  readonly size: number;
  final: Uint8Array;      // palette index of the top layer
  first: Uint8Array;      // palette index of the first colour ever laid
  buried: Uint8Array;     // palette index directly beneath the top layer
  depth: Uint16Array;     // placements on this cell
  lastArtist: Uint16Array;// artist index that owns the top layer
}

export function replay(p: Placements, size: number, upTo = p.n): Layers {
  const cells = size * size;
  const L: Layers = {
    size,
    final: new Uint8Array(cells),
    first: new Uint8Array(cells),
    buried: new Uint8Array(cells),
    depth: new Uint16Array(cells),
    lastArtist: new Uint16Array(cells),
  };
  for (let i = 0; i < upTo; i++) {
    const cell = p.y[i] * size + p.x[i];
    const d = L.depth[cell];
    if (d === 0) L.first[cell] = p.color[i];
    else L.buried[cell] = L.final[cell];
    L.final[cell] = p.color[i];
    L.lastArtist[cell] = p.artist[i];
    L.depth[cell] = d + 1;
  }
  return L;
}
```

A cell is unpainted when `depth === 0`; there is no sentinel colour, because index 0 is a real palette entry.

The four view modes read straight off these buffers:

- **Final** — `final`, skipping cells with `depth === 0`.
- **Underpainting** — `first`.
- **Depth** — `depth`, mapped to a ramp.
- **Ghost** — `buried`, drawn only where `depth > 1`, everything else transparent. This is the art that was covered over.

### 7.1 Scrubbing without recomputing the day

Rebuilding from placement zero on every scrub frame is too slow on a heavy day. Build keyframes once, right after the first replay:

```ts
const KEYFRAMES = 24; // one per hour of painting, roughly
const step = Math.ceil(p.n / KEYFRAMES);
```

Store `final` and `depth` snapshots at each step. To render time T: binary search `p.time` for the last placement at or before T, copy the nearest earlier keyframe, and apply the placements between it and the target. Forward work per scrub is at most `step` placements — about 20,000 on a heavy day, which is well under one frame.

Keyframe cost is `KEYFRAMES × cells × 3` bytes: about 4.7 MB at 256×256. Halve `KEYFRAMES` when `navigator.deviceMemory` is 4 or less.

### 7.2 Caching

Cache decoded placements per day in IndexedDB via `idb-keyval`, keyed `day:{n}:v1`. Bump the version suffix whenever the decoder changes. Only cache days that are finished — the current day keeps changing, so refetch it, and only fetch the pages after the last stroke id you already hold.

## 8. Core sample

The per-pixel history is not stored. It is recomputed on demand by scanning the placement list for one cell, which is a single linear pass over typed arrays — under 10 ms for half a million placements, far faster than a click.

```ts
// src/core/coreSample.ts
export interface Band {
  color: number;
  artist: number;
  time: number;
  index: number; // placement index, for ordering
}

export function coreSample(p: Placements, size: number, x: number, y: number): Band[] {
  const bands: Band[] = [];
  for (let i = 0; i < p.n; i++) {
    if (p.x[i] === x && p.y[i] === y) {
      bands.push({ color: p.color[i], artist: p.artist[i], time: p.time[i], index: i });
    }
  }
  return bands; // already chronological; render bottom-up
}
```

## 9. Survival

Definitions are in `PRD.md` §5 and must be implemented exactly as written there.

**Cells claimed** per artist is a count over `lastArtist` for cells with `depth > 0`.

**Cells touched** per artist is the number of distinct cells that artist ever placed on. Compute it exactly, without a hash set, by sorting composite keys:

```ts
// src/core/survival.ts
export function cellsTouched(p: Placements, size: number): Map<number, number> {
  const cells = size * size;
  const keys = new Uint32Array(p.n);
  for (let i = 0; i < p.n; i++) {
    keys[i] = p.artist[i] * cells + (p.y[i] * size + p.x[i]);
  }
  keys.sort(); // typed array sort is numeric and fast
  const counts = new Map<number, number>();
  for (let i = 0; i < keys.length; i++) {
    if (i > 0 && keys[i] === keys[i - 1]) continue; // same artist, same cell
    const artist = Math.floor(keys[i] / cells);
    counts.set(artist, (counts.get(artist) ?? 0) + 1);
  }
  return counts;
}
```

`artist * cells + cell` stays inside 32 bits for up to 65,536 artists on a 256×256 canvas, which is far beyond any real day.

**Who painted over whom** comes from the same pass that builds `buried`: when a placement covers a cell whose previous owner was a different artist, increment `overpaints[newArtist][oldArtist]`. Keep it as a `Map<number, Map<number, number>>` and only surface the top few entries.

## 10. Rendering

```ts
// src/render/palette.ts
export function toRgba(palette: string[]): Uint32Array {
  const out = new Uint32Array(palette.length);
  for (let i = 0; i < palette.length; i++) {
    const hex = palette[i].replace("#", "");
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    out[i] = (255 << 24) | (b << 16) | (g << 8) | r; // little-endian RGBA
  }
  return out;
}
```

Write into a `Uint32Array` view over `ImageData.data.buffer`, one write per cell, then `putImageData` into an offscreen canvas at 1:1 and scale up with `drawImage` and `imageSmoothingEnabled = false`. Set `image-rendering: pixelated` in CSS as well, for the cases where the canvas is scaled by layout rather than by draw.

Scale by integer factors only. A 256-pixel canvas drawn at 1.5× produces uneven pixels and it is immediately visible.

The depth ramp should stay inside the brand palette rather than reaching for a rainbow: unpainted stays background, depth 1 is a dim blue near `#073eb1`, and the ramp climbs to full `#fde047` at the highest depth on that day. Normalise against the day's own maximum depth, not a fixed ceiling, and print the maximum in the legend.

## 11. Verification

The replay must reproduce the official image exactly. This runs in Node, not the browser, because the official image is not served with CORS headers and a tainted canvas cannot be read back.

```bash
npm run verify -- 500
```

`scripts/verify.mjs` fetches all strokes for the day, replays them, fetches `https://basepaint.net/v3/0500.png`, decodes it with `pngjs`, and compares. The published image may be rendered at an integer scale, so read its dimensions, divide by the day's `size`, assert the result is a whole number, and sample the top-left pixel of each block. Report the number of mismatched cells and the first ten coordinates that differ.

Run it across at least ten days spanning both canvas sizes before release, including day 1, a day just below 366, a day just above, and a recent one. Record the results in the README — a project that proves its own correctness is a different kind of submission.

## 12. Design tokens

```css
/* src/styles/tokens.css */
:root {
  --bg: #1e2735;
  --fg: #ffffff;
  --accent: #fde047;
  --header: #073eb1;

  --mono: "Roboto Mono", ui-monospace, monospace;

  --step--1: 0.78rem;
  --step-0: 1rem;
  --step-1: 1.4rem;
  --step-2: 2.1rem;
  --step-3: 3.2rem;
}

canvas, img.artwork, video.artwork {
  image-rendering: pixelated;
}
```

Roboto Mono is on Google Fonts. MEK Sans and MEK Mono are BasePaint's display faces, from mek.gallery; use them only if the licence allows redistribution, and fall back to Roboto Mono otherwise rather than shipping a lookalike.

Official logos and the full brand sheet are at `https://basepaint.xyz/brand`.

Layout, from `PRD.md` §6: the canvas at the top, the time axis as a continuous band directly beneath it, the core sample opening as a vertical column to the side. Reading direction is down, into the canvas.

## 13. Referral and outbound links

Anyone can earn half the protocol fee on mints they refer, with no signup. Append `?referrer=<address>` to any BasePaint URL and it is remembered for 30 days.

```ts
const REFERRER = import.meta.env.VITE_REFERRER_ADDRESS; // set in .env.local and in Vercel
export const basepaintUrl = (path = "/") =>
  REFERRER ? `https://basepaint.xyz${path}?referrer=${REFERRER}` : `https://basepaint.xyz${path}`;
```

If the app grows its own mint button, it must pass the referrer directly to `BasePaintRewards.mintLatest()`. **Do not hand-write that ABI.** Take it from `BasePaint/basepaint-contracts` or from the verified contract on BaseScan at `0xaff1A9E200000061fC3283455d8B0C7e3e728161`. Until that is wired up, the outbound link above is the correct and complete implementation.

## 14. Deployment

Static Vite build on Vercel, plus two Edge Functions.

`vercel.json` needs an SPA rewrite so `/day/742` reaches the app, with `/api/*` excluded. `api/og.tsx` renders share cards with `@vercel/og`; it can compose the official day PNG by URL and overlay the one number that matters. `api/html.ts` injects per-route `og:title`, `og:description`, and `og:image` into the built `index.html`, since crawlers do not run the SPA router.

Both Edge Functions are P1. If they are cut, set a single sensible set of meta tags on the static shell and move on.

Set `VITE_REFERRER_ADDRESS` in the Vercel project settings. There are no other secrets — every data source is public and unauthenticated, which is also why hosting costs nothing and the project keeps working with no maintenance.

## 15. Performance budget

| Path | Budget |
| --- | --- |
| Fetch + decode + replay, heavy day, cold | under 5 s to interactive canvas, with visible progress |
| Same day, warm from IndexedDB | under 300 ms |
| Mode switch | under 50 ms, no refetch |
| Scrub frame | under 16 ms |
| Core sample on click | under 10 ms |

Always test against a heavy recent day. Day 1 is small and hides every problem you have.

## 16. Licence and credit

Strata is MIT. BasePaint artwork is CC0, so rendering and remixing it needs no permission — but Strata names the artist behind every pixel anyway, because that is the entire point of the tool.
