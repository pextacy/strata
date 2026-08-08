import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import type { Band } from "../src/core/coreSample.ts";
import { CoreSample } from "../src/ui/CoreSample.tsx";

/**
 * The column reads down from the surface, and the order it reads in is not
 * cosmetic. It was once chronological in the DOM and flipped with CSS, which
 * meant a stack taller than its scroll box opened on the oldest bands and hid
 * the one still on the canvas — on a 390px screen, day 500's deepest cell showed
 * eight of nineteen layers and none of them the visible one. Markup order is
 * what fixes that, so markup order is what is tested.
 */

const OPENED_AT = 1_700_000_000;

/** Four placements on one cell: green, white, white again, then blue on top. */
const BANDS: readonly Band[] = [
  { color: 1, artist: 0, time: OPENED_AT + 600, index: 4, buried: true },
  { color: 2, artist: 1, time: OPENED_AT + 1200, index: 9, buried: false },
  { color: 2, artist: 1, time: OPENED_AT + 1800, index: 15, buried: true },
  { color: 3, artist: 2, time: OPENED_AT + 3600, index: 31, buried: false },
];

const ARTISTS = [
  "0x1111111111111111111111111111111111111111",
  "0x2222222222222222222222222222222222222222",
  "0x3333333333333333333333333333333333333333",
];

const PALETTE = ["#000000", "#2e6413", "#ffffff", "#0044e8"];

const html = renderToStaticMarkup(
  <MemoryRouter>
    <CoreSample
      pixel={{ x: 236, y: 56 }}
      bands={BANDS}
      artists={ARTISTS}
      palette={PALETTE}
      openedAt={OPENED_AT}
    />
  </MemoryRouter>,
);

/** Every painter address in the order the markup puts them. */
const painterOrder = (markup: string): string[] =>
  [...markup.matchAll(/\/artist\/(0x[0-9a-f]+)/g)].map((match) => match[1]);

describe("CoreSample", () => {
  it("puts the band on the canvas first, and the first colour ever laid last", () => {
    expect(painterOrder(html)).toEqual([ARTISTS[2], ARTISTS[1], ARTISTS[1], ARTISTS[0]]);
  });

  it("marks only the newest band as the one on top", () => {
    expect(html.indexOf("· on top")).toBeLessThan(html.indexOf("· buried"));
    expect([...html.matchAll(/· on top/g)]).toHaveLength(1);
  });

  it("numbers the bands from the bottom of the core, however they are read", () => {
    const numbers = [...html.matchAll(/core-band-index"[^>]*>(\d+)</g)].map((m) => Number(m[1]));
    expect(numbers).toEqual([4, 3, 2, 1]);
  });

  it("counts painters and buried layers rather than assuming one per band", () => {
    // Two of the four bands were covered by a different colour; the repaint of
    // white over white buried nothing, and one address painted twice.
    expect(html).toContain("Painted <strong>4</strong> times by <strong>3</strong> painters");
    expect(html).toContain("2 layers are buried");
  });

  it("says in words that nothing was ever painted on an untouched cell", () => {
    const empty = renderToStaticMarkup(
      <MemoryRouter>
        <CoreSample
          pixel={{ x: 0, y: 0 }}
          bands={[]}
          artists={ARTISTS}
          palette={PALETTE}
          openedAt={OPENED_AT}
        />
      </MemoryRouter>,
    );
    expect(empty).toContain("Nothing was ever painted here");
  });
});
