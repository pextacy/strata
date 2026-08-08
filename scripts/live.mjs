#!/usr/bin/env node
// Drives today's unfinished canvas the whole way through: fetch, decode, replay,
// build the scrub keyframes, scrub across the elapsed window, drill a cell, and
// compute one artist's survival record.
//
// `npm run verify` cannot cover today. basepaint.net only publishes a render for
// a day that has closed, so there is nothing to diff against — day 1095 is a 404
// while day 1094 is a PNG. What can still be checked is that an open day, whose
// last stroke landed minutes ago and whose remaining hours are empty, does not
// break anything downstream of the replay. That is the failure this script is
// looking for: a scrubber that assumes a full 24 hours of strokes.
//
//   npm run live            # today
//   npm run live -- 500     # any day, as a control
//
// Exits non-zero if a check fails, so it can gate a deploy.

import { PlacementsBuilder, hasAnomalies } from "../src/core/decode.ts";
import { replay, dayStats, indexAtTime } from "../src/core/replay.ts";
import { Timeline } from "../src/core/keyframes.ts";
import { coreSample } from "../src/core/coreSample.ts";
import { artistDaySurvival, cellsClaimed } from "../src/core/survival.ts";
import { currentDay, dayEnd, dayStart, isDayOpen } from "../src/core/day-math.ts";
import { fetchDayStrokes } from "../src/data/queries.ts";
import { fetchTheme } from "../src/data/theme.ts";

/** DOCS.md §7.1: one scrub frame has 16 ms, and it is the whole point of keyframes. */
const FRAME_BUDGET_MS = 16;

const failures = [];
const notes = [];

function check(label, condition, detail) {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    failures.push(detail === undefined ? label : `${label} — ${detail}`);
    console.log(`  FAIL  ${label}${detail === undefined ? "" : ` — ${detail}`}`);
  }
}

function skip(label) {
  console.log(`  skip  ${label}`);
}

function note(line) {
  notes.push(line);
  console.log(`        ${line}`);
}

const ms = (n) => `${n.toFixed(2)} ms`;

async function main() {
  const arg = process.argv.slice(2).map(Number).filter(Number.isInteger)[0];
  const now = Math.floor(Date.now() / 1000);
  const day = arg ?? currentDay(now);
  const open = isDayOpen(day, now);
  const from = dayStart(day);
  const to = dayEnd(day);

  console.log(`day ${day} — ${open ? "open, being painted now" : "closed"}`);
  if (!open) {
    note("this day has finished; run without an argument to exercise the live one");
  }

  // ---- fetch + decode ------------------------------------------------------

  const theme = await fetchTheme(day);
  const { size, palette } = theme;
  console.log(`  "${theme.theme}" · ${size}×${size} · ${palette.length} colours`);

  const builder = new PlacementsBuilder(size, palette.length);
  const fetchStart = performance.now();
  let pages = 0;
  const { lastId } = await fetchDayStrokes(day, (items, progress) => {
    for (const stroke of items) builder.addStroke(stroke);
    pages = progress.page;
    process.stdout.write(
      `\r  fetching: page ${progress.page}, ${progress.strokes}/${progress.totalStrokes} strokes, ${builder.length} placements   `,
    );
  });
  process.stdout.write("\n");
  const fetchMs = performance.now() - fetchStart;

  const p = builder.finish();
  note(`${pages} page${pages === 1 ? "" : "s"}, ${p.n} placements, ${p.artists.length} artists, ${ms(fetchMs)}`);
  note(`last stroke id ${lastId ?? "none"} — this is what a live refetch resumes from`);
  if (hasAnomalies(builder.anomalies)) {
    const a = builder.anomalies;
    note(
      `anomalies: ${a.malformedStrokes} malformed strokes, ${a.offCanvas} off-canvas pixels, ${a.unknownColor} unknown colours`,
    );
  }

  // An open day with nothing on it yet is a real state the UI has copy for, and
  // there is nothing further to drive. Say so and stop, rather than failing.
  if (p.n === 0) {
    console.log("\n  nobody has painted this day yet — no canvas to drive");
    check("an empty open day decodes without throwing", true);
    return;
  }

  // ---- replay --------------------------------------------------------------

  const replayStart = performance.now();
  const layers = replay(p, size);
  const replayMs = performance.now() - replayStart;
  const stats = dayStats(layers, p);
  note(
    `replay ${ms(replayMs)} · ${stats.paintedCells} painted cells · max depth ${stats.maxDepth} · ${stats.buriedPlacements} buried`,
  );

  // ---- the day's window ----------------------------------------------------
  //
  // The part of the day that has actually happened. On an open day this is the
  // number the scrubber's track is scaled to, and the bug this script exists to
  // catch is anything that assumes it is the full 86,400.

  const elapsed = open ? Math.min(to - from, now - from) : to - from;
  const lastStrokeAt = p.time[p.n - 1];
  note(
    `${Math.round(elapsed / 60)} minutes elapsed of 1440 · last stroke ${Math.round((now - lastStrokeAt) / 60)} minutes ago`,
  );

  if (open) {
    check(
      "the scrubber's window is shorter than a full day",
      elapsed < to - from,
      `elapsed ${elapsed}s`,
    );
    check("the day's own end is still in the future", to > now, `day ends ${to}, now ${now}`);
  } else {
    skip("the open-day window checks — this day has closed");
  }
  check(
    "every stroke landed inside the elapsed window",
    lastStrokeAt <= from + elapsed + 1,
    `last stroke ${lastStrokeAt}, window ends ${from + elapsed}`,
  );

  // ---- keyframes -----------------------------------------------------------

  const buildStart = performance.now();
  const timeline = new Timeline(p, size);
  const buildMs = performance.now() - buildStart;
  note(
    `${timeline.keyframeCount} keyframes, ${(timeline.keyframeBytes / 1024 / 1024).toFixed(2)} MB, step ${timeline.step}, built once in ${ms(buildMs)}`,
  );

  check("the timeline holds every placement", timeline.count === p.n);

  // ---- scrubbing -----------------------------------------------------------
  //
  // Forward across the elapsed window, then a rewind, then the two ends. A
  // rewind is the expensive direction — it cannot roll the scratch canvas
  // forward and has to copy a keyframe first.

  const stops = [];
  const STEPS = 24;
  for (let k = 0; k <= STEPS; k++) stops.push(from + Math.round((elapsed * k) / STEPS));
  for (let k = STEPS; k >= 0; k--) stops.push(from + Math.round((elapsed * k) / STEPS));
  stops.push(from - 1, from, to, to + 86_400);

  const timings = [];
  let monotonic = true;
  let lastCount = -1;
  let lastPainted = 0;
  let rewound = false;

  for (const t of stops) {
    const start = performance.now();
    const frame = timeline.frameAtTime(t);
    timings.push(performance.now() - start);

    const count = timeline.countAtTime(t);
    if (count < lastCount) rewound = true;
    // Going forward, the canvas can only gain paint. This is the invariant that
    // catches a keyframe copied from the wrong slot.
    if (!rewound && count > lastCount) {
      let painted = 0;
      for (let i = 0; i < frame.depth.length; i++) if (frame.depth[i] > 0) painted++;
      if (painted < lastPainted) monotonic = false;
      lastPainted = painted;
    }
    lastCount = count;
  }

  timings.sort((a, b) => a - b);
  const median = timings[Math.floor(timings.length / 2)];
  const worst = timings[timings.length - 1];
  note(`${timings.length} scrub frames · median ${ms(median)} · worst ${ms(worst)}`);

  check(
    `every scrub frame stays inside the ${FRAME_BUDGET_MS} ms budget`,
    worst <= FRAME_BUDGET_MS,
    `worst was ${ms(worst)}`,
  );
  check("paint only accumulates as the scrubber moves forward", monotonic);

  // ---- the ends ------------------------------------------------------------

  const beforeFirst = timeline.frameAtTime(p.time[0] - 1);
  check(
    "the moment before the first stroke is a blank canvas",
    beforeFirst.depth.every((d) => d === 0),
    "something was painted before the day's first stroke",
  );
  check("indexAtTime reports -1 before the first stroke", indexAtTime(p, p.time[0] - 1) === -1);

  // On the boundary, not just near it. `indexAtTime` promises the last placement
  // *at or before* a moment, and the placement laid on that very second is the
  // whole difference between `<=` and `<`. Asking only about `time[0] - 1` —
  // which no stroke sits on — cannot tell the two apart, so this asks about
  // seconds that strokes actually landed on.
  let boundaryOk = true;
  let boundaryDetail = "";
  for (const k of [0, p.n >> 2, p.n >> 1, p.n - 1]) {
    const at = p.time[k];
    // The last index sharing this second — several strokes can.
    let expected = k;
    while (expected + 1 < p.n && p.time[expected + 1] === at) expected++;
    const got = indexAtTime(p, at);
    if (got !== expected) {
      boundaryOk = false;
      boundaryDetail = `at ${at} got ${got}, expected ${expected}`;
      break;
    }
  }
  check("indexAtTime includes a placement laid on the exact second", boundaryOk, boundaryDetail);

  // The end of an open day is hours away and empty. Scrubbing there must land on
  // the same canvas the last stroke left, not on a partial frame.
  const atDayEnd = timeline.frameAtTime(to);
  check(
    "scrubbing to the day's end lands on the canvas the last stroke left",
    sameLayers(atDayEnd, layers),
    "the frame at the day's end differs from the full replay",
  );

  const atNow = timeline.frameAtTime(now);
  check("scrubbing to this second lands on the same canvas", sameLayers(atNow, layers));

  // Rewinding to the start and running forward again has to reproduce it too —
  // this is the path a second drag takes, over a reused scratch canvas.
  timeline.frameAtTime(from);
  check("a rewind and a second pass rebuild the same canvas", sameLayers(timeline.frameAt(p.n), layers));

  // ---- core sample ---------------------------------------------------------
  //
  // The deepest cell on the canvas: the most contested pixel of the day so far.

  let deepest = 0;
  for (let i = 1; i < layers.depth.length; i++) {
    if (layers.depth[i] > layers.depth[deepest]) deepest = i;
  }
  const x = deepest % size;
  const y = Math.floor(deepest / size);

  const sampleStart = performance.now();
  const sample = coreSample(p, size, x, y);
  const sampleMs = performance.now() - sampleStart;
  note(
    `deepest cell (${x},${y}): ${sample.bands.length} bands, ${sample.painters} painters, ${sample.buried} buried, drilled in ${ms(sampleMs)}`,
  );

  check("the core sample resolves in under 10 ms", sampleMs < 10, `took ${ms(sampleMs)}`);
  check(
    "the stack is as deep as the depth buffer says",
    sample.bands.length === layers.depth[deepest],
    `${sample.bands.length} bands against depth ${layers.depth[deepest]}`,
  );
  check(
    "the top band is the colour the canvas shows",
    sample.bands[sample.bands.length - 1].color === layers.final[deepest],
  );
  check(
    "the bands are in chronological order",
    sample.bands.every((b, i) => i === 0 || b.time >= sample.bands[i - 1].time),
  );
  check(
    "every band names a real address",
    sample.bands.every((b) => /^0x[0-9a-f]{40}$/.test(p.artists[b.artist])),
  );

  // The layer buffers, read against something that did not build them.
  //
  // Every `sameLayers` comparison above runs the same `replayInto` down both
  // sides, so it proves the keyframes were copied from the right slot and
  // nothing about what a layer means: change what `buried` holds and both sides
  // change together, in step, silently. `coreSample` walks the placements
  // itself and never touches those buffers, so it is the one thing here that can
  // disagree with them.
  const deepCells = [];
  for (let cell = 0; cell < layers.depth.length && deepCells.length < 200; cell++) {
    if (layers.depth[cell] > 1) deepCells.push(cell);
  }
  let layersAgree = true;
  let disagreement = "";
  for (const cell of deepCells) {
    const drilled = coreSample(p, size, cell % size, Math.floor(cell / size));
    const bands = drilled.bands;
    const want = {
      depth: bands.length,
      final: bands[bands.length - 1].color,
      first: bands[0].color,
      buried: bands[bands.length - 2].color,
      lastArtist: bands[bands.length - 1].artist,
    };
    for (const [key, value] of Object.entries(want)) {
      if (layers[key][cell] !== value) {
        layersAgree = false;
        disagreement = `cell ${cell}: ${key} is ${layers[key][cell]}, the stack says ${value}`;
        break;
      }
    }
    if (!layersAgree) break;
  }
  check(
    `every layer buffer agrees with the drilled stack on ${deepCells.length} contested cells`,
    layersAgree,
    disagreement,
  );

  // ---- survival ------------------------------------------------------------
  //
  // The artist holding the most cells right now. On an open day their record is
  // provisional by definition — the number still has to be internally consistent.

  const claimed = cellsClaimed(layers);
  let top = -1;
  let topCells = -1;
  for (const [artist, cells] of claimed) {
    if (cells > topCells) {
      top = artist;
      topCells = cells;
    }
  }
  const address = p.artists[top];
  const survivalStart = performance.now();
  const record = artistDaySurvival(p, layers, size, address);
  const survivalMs = performance.now() - survivalStart;

  check("the leading artist has a survival record", record !== null, address);
  if (record !== null) {
    note(
      `${address}: ${record.cellsClaimed}/${record.cellsTouched} cells held, ${(record.survival * 100).toFixed(1)}% surviving, computed in ${ms(survivalMs)}`,
    );
    check(
      "cells held never exceed cells touched",
      record.cellsClaimed <= record.cellsTouched,
      `${record.cellsClaimed} > ${record.cellsTouched}`,
    );
    check("the survival rate is a rate", record.survival >= 0 && record.survival <= 1);
    check(
      "placements are counted per pixel, not per cell",
      record.placements >= record.cellsTouched,
    );

    // Counted again, the slow way. `cellsTouched` sorts composite keys and skips
    // repeats; the inequalities above only bound it from one side, so dropping
    // that skip inflates the figure and every one of them still holds. A Set
    // cannot be talked into the same mistake.
    const distinct = new Set();
    let placed = 0;
    for (let i = 0; i < p.n; i++) {
      if (p.artist[i] !== top) continue;
      placed++;
      distinct.add(p.y[i] * size + p.x[i]);
    }
    check(
      "cells touched is distinct cells, not placements counted twice",
      record.cellsTouched === distinct.size,
      `record says ${record.cellsTouched}, a set of their cells holds ${distinct.size}`,
    );
    check(
      "pixels placed matches a straight count of their placements",
      record.placements === placed,
      `record says ${record.placements}, counted ${placed}`,
    );
    check(
      "an artist is never listed as covering themselves",
      record.covered.every((t) => t.address !== address) &&
        record.coveredBy.every((t) => t.address !== address),
    );
    note(
      record.coveredBy.length > 0
        ? `most often covered by ${record.coveredBy[0].address} (${record.coveredBy[0].times}×)`
        : "nobody has covered them today",
    );
  }
}

/** Every buffer, cell for cell. A scrubbed frame either is the canvas or is not. */
function sameLayers(a, b) {
  return (
    equal(a.final, b.final) &&
    equal(a.first, b.first) &&
    equal(a.buried, b.buried) &&
    equal(a.depth, b.depth) &&
    equal(a.lastArtist, b.lastArtist)
  );
}

function equal(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

await main();

console.log("");
if (failures.length === 0) {
  console.log(`all checks passed (${notes.length} measurements recorded)`);
  process.exit(0);
}
console.log(`${failures.length} check${failures.length === 1 ? "" : "s"} failed:`);
for (const f of failures) console.log(`  - ${f}`);
process.exit(1);
