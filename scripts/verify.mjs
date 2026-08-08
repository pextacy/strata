#!/usr/bin/env node
// Replays a day from the on-chain stroke history and diffs the result against
// the official render at basepaint.net. This is the project's one hard claim —
// if it stops passing, the bug is in Strata and nothing else ships.
//
// It runs in Node rather than the browser because the official PNG is not
// served with CORS headers, so a browser canvas holding it cannot be read back.
//
//   npm run verify -- 500
//   npm run verify -- 1 300 366 500 1000

import { pathToFileURL } from "node:url";
import { PNG } from "pngjs";
import { PlacementsBuilder, hasAnomalies } from "../src/core/decode.ts";
import { replay } from "../src/core/replay.ts";
import { fetchDayStrokes } from "../src/data/queries.ts";
import { fetchTheme } from "../src/data/theme.ts";

const ARTWORK = (day) => `https://basepaint.net/v3/${String(day).padStart(4, "0")}.png`;

async function fetchPng(day) {
  const res = await fetch(ARTWORK(day));
  if (!res.ok) throw new Error(`${ARTWORK(day)} returned ${res.status} ${res.statusText}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  return PNG.sync.read(buffer);
}

/** "#rrggbb" -> packed 0xrrggbb, for comparing against PNG samples. */
const packHex = (hex) => parseInt(hex.slice(1), 16);

async function verifyDay(day, limit) {
  const theme = await fetchTheme(day);
  const { size, palette } = theme;

  const builder = new PlacementsBuilder(size, palette.length);
  let pages = 0;
  await fetchDayStrokes(day, (items, progress) => {
    for (const stroke of items) builder.addStroke(stroke);
    pages = progress.page;
    process.stdout.write(
      `\r  day ${day}: page ${progress.page}, ${progress.strokes}/${progress.totalStrokes} strokes, ${builder.length} placements   `,
    );
  }, limit === undefined ? {} : { limit });
  process.stdout.write("\n");

  const placements = builder.finish();
  const layers = replay(placements, size);

  const png = await fetchPng(day);
  const scale = png.width / size;
  if (png.width !== png.height) {
    throw new Error(`official image is ${png.width}x${png.height}, expected a square`);
  }
  if (!Number.isInteger(scale)) {
    throw new Error(`official image is ${png.width}px for a ${size}px canvas — not an integer scale`);
  }

  const compared = compareRender(layers, png, size, scale, palette.map(packHex));

  return {
    day,
    size,
    theme: theme.theme,
    scale,
    pages,
    placements: placements.n,
    artists: placements.artists.length,
    ...compared,
    anomalies: builder.anomalies,
  };
}

/**
 * The replayed canvas against the decoded PNG, cell by cell and — where a cell
 * is drawn as more than one device pixel — device pixel by device pixel.
 *
 * Pure, exported, and tested, because the only renders published so far are 1x,
 * where the block loop below collapses to the single sample the old code took.
 * A branch that no real day exercises is a branch nobody has checked, and this
 * one carries the project's only hard claim.
 */
export function compareRender(layers, png, size, scale, packed) {
  const mismatches = [];
  let painted = 0;
  let mismatched = 0;
  let unpainted = 0;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cell = y * size + x;

      // The canvas starts as palette index 0 everywhere, so a cell nobody
      // painted still renders — as the first colour of the day's palette.
      const wasPainted = layers.depth[cell] > 0;
      if (wasPainted) painted++;
      else unpainted++;

      const expected = packed[wasPainted ? layers.final[cell] : 0];

      // Every device pixel of the block, not just its corner. This read the
      // top-left sample alone, which at 1x is the whole cell and at anything
      // else is a cell whose corner happens to match passing for one that does.
      let wrong = null;
      for (let dy = 0; dy < scale && wrong === null; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const at = ((y * scale + dy) * png.width + (x * scale + dx)) * 4;
          const a = png.data[at + 3];
          const actual = (png.data[at] << 16) | (png.data[at + 1] << 8) | png.data[at + 2];
          if (a === 0 || expected === undefined || actual !== expected) {
            wrong = { a, actual, dx, dy };
            break;
          }
        }
      }

      if (wrong !== null) {
        mismatched++;
        if (mismatches.length < 10) {
          mismatches.push({
            x,
            y,
            expected: expected === undefined ? `palette index ${layers.final[cell]}` : hex(expected),
            actual: wrong.a === 0 ? "transparent" : hex(wrong.actual),
            // Which pixel of the cell disagreed, when a cell is more than one.
            at: scale === 1 ? "" : ` (device pixel +${wrong.dx},+${wrong.dy} of ${scale}x${scale})`,
          });
        }
      }
    }
  }

  return { painted, mismatched, unpainted, samples: mismatches.slice(0, 10) };
}

function hex(v) {
  return `#${v.toString(16).padStart(6, "0")}`;
}

// Only when run as the program. A test imports `compareRender` from here, and
// importing a module must not start replaying days from the chain.
const invokedDirectly =
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedDirectly) await cli();

async function cli() {
  const argv = process.argv.slice(2);
  // --limit=N forces the paged path. No real day has ever had more than a
  // thousand strokes, so this is the only way to prove page assembly is right.
  const limitArg = argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg === undefined ? undefined : Number(limitArg.slice("--limit=".length));
  const days = argv.filter((a) => !a.startsWith("--")).map(Number).filter(Number.isInteger);

  if (days.length === 0) {
    console.error("usage: npm run verify -- <day> [day...] [--limit=N]");
    process.exit(2);
  }

  const results = [];
  let failed = false;

  for (const day of days) {
    console.log(`\nday ${day}`);
    try {
      const r = await verifyDay(day, limit);
      results.push(r);
      const ok = r.mismatched === 0;
      if (!ok) failed = true;
      console.log(
        `  ${ok ? "MATCH" : "MISMATCH"}  size ${r.size}  scale ${r.scale}x  ` +
          `${r.placements} placements  ${r.artists} artists  ${r.painted} painted cells  ` +
          `${r.mismatched} mismatched`,
      );
      if (hasAnomalies(r.anomalies)) {
        console.log(
          `  anomalies: ${r.anomalies.malformedStrokes} malformed strokes, ` +
            `${r.anomalies.offCanvas} off-canvas pixels, ${r.anomalies.unknownColor} unknown colours`,
        );
      }
      for (const m of r.samples) {
        console.log(`    (${m.x},${m.y}) expected ${m.expected} got ${m.actual}${m.at ?? ""}`);
      }
    } catch (err) {
      failed = true;
      console.log(`  FAILED  ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Pasted straight into the README, so the theme name travels with the numbers —
  // it is the one column a reader can check against basepaint.xyz by eye.
  const n = new Intl.NumberFormat("en-US");
  console.log("\n| day | theme | size | placements | artists | painted cells | mismatched |");
  console.log("| --- | --- | --- | --- | --- | --- | --- |");
  for (const r of results) {
    console.log(
      `| ${r.day} | ${r.theme} | ${r.size}×${r.size} | ${n.format(r.placements)} | ${r.artists} | ` +
        `${n.format(r.painted)} | **${r.mismatched}** |`,
    );
  }

  process.exit(failed ? 1 : 0);
}
