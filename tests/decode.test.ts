import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  MalformedStrokeError,
  PlacementsBuilder,
  decodeStroke,
  hasAnomalies,
  noAnomalies,
  strokePixelCount,
  type StrokeRecord,
} from "../src/core/decode.ts";

/** Real strokes, captured by `npm run capture -- 500`. Never hand-written. */
const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/day-0500-strokes.json", import.meta.url), "utf8"),
) as {
  day: number;
  theme: { size: number; palette: string[] };
  strokes: { items: StrokeRecord[]; totalCount: number };
};

const collect = (data: string) => {
  const out: [number, number, number][] = [];
  const n = decodeStroke(data, (x, y, color) => out.push([x, y, color]));
  return { n, out };
};

describe("decodeStroke", () => {
  // The worked example in DOCS.md §5.
  it("reads one pixel out of 0x5a2b03", () => {
    expect(collect("0x5a2b03")).toEqual({ n: 1, out: [[90, 43, 3]] });
  });

  it("reads two pixels out of 0x5a2b03000105", () => {
    expect(collect("0x5a2b03000105")).toEqual({
      n: 2,
      out: [
        [90, 43, 3],
        [0, 1, 5],
      ],
    });
  });

  it("does not require the 0x prefix and accepts either case", () => {
    expect(collect("5A2B03").out).toEqual([[90, 43, 3]]);
    expect(collect("0X5a2b03").out).toEqual([[90, 43, 3]]);
  });

  it("reads nothing out of an empty payload", () => {
    expect(collect("0x")).toEqual({ n: 0, out: [] });
  });

  it("refuses a length that is not a whole number of pixels", () => {
    expect(() => decodeStroke("0x5a2b", () => {})).toThrow(MalformedStrokeError);
    expect(() => decodeStroke("0x5a2b0304", () => {})).toThrow(MalformedStrokeError);
  });

  it("refuses a non-hex character rather than reading NaN as a coordinate", () => {
    expect(() => decodeStroke("0x5a2bzz", () => {})).toThrow(MalformedStrokeError);
  });

  it("agrees with strokePixelCount", () => {
    for (const stroke of fixture.strokes.items) {
      expect(strokePixelCount(stroke.data)).toBe(stroke.pixels);
      expect(decodeStroke(stroke.data, () => {})).toBe(stroke.pixels);
    }
  });
});

describe("decodeStroke against real day 500 strokes", () => {
  const { size, palette } = fixture.theme;

  it("decodes every captured stroke inside the canvas and the palette", () => {
    let pixels = 0;
    for (const stroke of fixture.strokes.items) {
      decodeStroke(stroke.data, (x, y, color) => {
        pixels++;
        expect(x).toBeLessThan(size);
        expect(y).toBeLessThan(size);
        expect(color).toBeLessThan(palette.length);
      });
    }
    // 25 strokes carrying 8,749 pixels between them: strokes are batched, which
    // is why a whole day fits in one page of a thousand.
    expect(pixels).toBe(fixture.strokes.items.reduce((n, s) => n + s.pixels, 0));
  });
});

describe("PlacementsBuilder", () => {
  const { size, palette } = fixture.theme;

  it("builds the same pixels the strokes claim", () => {
    const b = new PlacementsBuilder(size, palette.length);
    for (const stroke of fixture.strokes.items) b.addStroke(stroke);
    const p = b.finish();

    expect(p.n).toBe(fixture.strokes.items.reduce((n, s) => n + s.pixels, 0));
    expect(hasAnomalies(b.anomalies)).toBe(false);
    expect(p.x).toHaveLength(p.n);
    expect(p.time).toHaveLength(p.n);
  });

  it("interns each address once, lowercased", () => {
    const b = new PlacementsBuilder(size, palette.length);
    for (const stroke of fixture.strokes.items) b.addStroke(stroke);
    const p = b.finish();

    const distinct = new Set(fixture.strokes.items.map((s) => s.accountId.toLowerCase()));
    expect(p.artists).toHaveLength(distinct.size);
    expect(new Set(p.artists)).toEqual(distinct);
    for (const address of p.artists) expect(address).toBe(address.toLowerCase());
    for (let i = 0; i < p.n; i++) expect(p.artists[p.artist[i]]).toBeDefined();
  });

  it("keeps placements in the order the strokes arrived", () => {
    const b = new PlacementsBuilder(size, palette.length);
    for (const stroke of fixture.strokes.items) b.addStroke(stroke);
    const p = b.finish();

    for (let i = 1; i < p.n; i++) {
      expect(p.time[i]).toBeGreaterThanOrEqual(p.time[i - 1]);
    }
  });

  it("grows past its initial capacity without losing a pixel", () => {
    const b = new PlacementsBuilder(size, palette.length, 8);
    let expected = 0;
    for (const stroke of fixture.strokes.items) expected += b.addStroke(stroke);
    expect(b.finish().n).toBe(expected);
    expect(expected).toBe(fixture.strokes.items.reduce((n, s) => n + s.pixels, 0));
  });

  it("drops a pixel outside the canvas and counts it", () => {
    const b = new PlacementsBuilder(16, 4);
    const added = b.addStroke(stroke("0x0a0a01ff0a02"));
    expect(added).toBe(1); // (10,10) kept, (255,10) has no cell
    expect(b.anomalies.offCanvas).toBe(1);
  });

  it("drops a colour the palette does not have and counts it", () => {
    // BasePaint's renderer ignores these, so Strata does too — see decode.ts.
    const b = new PlacementsBuilder(16, 4);
    const added = b.addStroke(stroke("0x0a0a010b0b09"));
    expect(added).toBe(1);
    expect(b.anomalies.unknownColor).toBe(1);
  });

  it("contributes nothing from a stroke that will not decode", () => {
    const b = new PlacementsBuilder(16, 4);
    b.addStroke(stroke("0x0a0a01"));
    expect(b.addStroke(stroke("0x0a0a0102"))).toBe(0);
    expect(b.anomalies.malformedStrokes).toBe(1);
    expect(b.length).toBe(1); // the good stroke before it survives
  });

  it("refuses a canvas a byte coordinate cannot address", () => {
    expect(() => new PlacementsBuilder(512, 4)).toThrow();
    expect(() => new PlacementsBuilder(0, 4)).toThrow();
  });
});

describe("anomalies", () => {
  it("starts clean and reports any single kind", () => {
    expect(hasAnomalies(noAnomalies())).toBe(false);
    expect(hasAnomalies({ ...noAnomalies(), offCanvas: 1 })).toBe(true);
    expect(hasAnomalies({ ...noAnomalies(), unknownColor: 1 })).toBe(true);
    expect(hasAnomalies({ ...noAnomalies(), malformedStrokes: 1 })).toBe(true);
  });
});

let nextId = 1;
/** A stroke record shaped exactly like the indexer's, for the edge cases a real
    captured day does not contain. */
function stroke(data: string): StrokeRecord {
  return {
    id: String(nextId++),
    accountId: "0x0000000000000000000000000000000000000001",
    data,
    pixels: strokePixelCount(data),
    timestamp: 1_700_000_000,
  };
}
