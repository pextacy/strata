#!/usr/bin/env node
// Captures real API responses into tests/fixtures/ so the unit tests can run
// offline against data the chain actually produced. Nothing in tests/fixtures
// is ever hand-written — if a fixture looks wrong, re-capture it and read the
// diff.
//
//   npm run capture -- 500          first 25 strokes of day 500, plus its theme
//   npm run capture -- 500 --n=100  more strokes

import { mkdir, writeFile } from "node:fs/promises";

const ENDPOINT = "https://graphql.basepaint.xyz";
const OUT_DIR = "tests/fixtures";

const argv = process.argv.slice(2);
const nArg = argv.find((a) => a.startsWith("--n="));
const count = nArg === undefined ? 25 : Number(nArg.slice("--n=".length));
const day = Number(argv.find((a) => !a.startsWith("--")));

if (!Number.isInteger(day) || day < 1) {
  console.error("usage: npm run capture -- <day> [--n=25]");
  process.exit(2);
}

const query = `
query DayStrokes($canvasId: Int!, $limit: Int!) {
  strokes(where: { canvasId: $canvasId } orderBy: "id" orderDirection: "asc" limit: $limit) {
    items { id accountId data pixels timestamp }
    pageInfo { hasNextPage endCursor }
    totalCount
  }
}`;

const res = await fetch(ENDPOINT, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ query, variables: { canvasId: day, limit: count } }),
});
if (!res.ok) throw new Error(`${ENDPOINT} responded ${res.status} ${res.statusText}`);
const { data, errors } = await res.json();
if (errors) throw new Error(JSON.stringify(errors, null, 2));

const themeRes = await fetch(`https://basepaint.xyz/api/theme/${day}`);
if (!themeRes.ok) throw new Error(`theme for day ${day} responded ${themeRes.status}`);
const theme = await themeRes.json();

const padded = String(day).padStart(4, "0");
const fixture = {
  capturedFrom: { indexer: ENDPOINT, theme: `https://basepaint.xyz/api/theme/${day}` },
  day,
  theme,
  strokes: data.strokes,
};

await mkdir(OUT_DIR, { recursive: true });
const path = `${OUT_DIR}/day-${padded}-strokes.json`;
await writeFile(path, `${JSON.stringify(fixture, null, 2)}\n`);

console.log(
  `wrote ${path}: ${fixture.strokes.items.length} of ${fixture.strokes.totalCount} strokes, ` +
    `theme "${theme.theme}", size ${theme.size}, ${theme.palette.length} colours`,
);
