import { describe, expect, it } from "vitest";

import { allocLayers } from "../src/core/replay.ts";
import { packRgba, TRANSPARENT } from "../src/render/palette.ts";
import { drawText, fitText, fontSafe, textWidth } from "../src/render/pixelFont.ts";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  asGround,
  claimedPixels,
  over,
  renderShareCard,
} from "../src/render/shareCard.ts";

const RED = packRgba(220, 40, 40);
const BLUE = packRgba(40, 80, 220);

describe("pixel font", () => {
  it("folds case and accents rather than dropping the word", () => {
    expect(fontSafe("Café")).toBe("CAFE");
    expect(fontSafe("Étude — 2")).toBe("ETUDE - 2");
  });

  it("drops characters it has no glyph for instead of drawing a box", () => {
    expect(fontSafe("日 A 本")).toBe(" A ");
  });

  it("measures what it draws", () => {
    // Two glyphs of five columns, one column of tracking between, times the scale.
    expect(textWidth("AB", { scale: 2 })).toBe((5 + 1 + 5) * 2);
    expect(textWidth("", { scale: 4 })).toBe(0);
  });

  it("truncates to the width it is given", () => {
    const style = { scale: 3 };
    const long = "BASEPAINT OFFICE PARTY AT THE END OF THE WORLD";
    const cut = fitText(long, 300, style);
    expect(textWidth(cut, style)).toBeLessThanOrEqual(300);
    expect(cut.endsWith("...")).toBe(true);
    expect(fitText("DAY 500", 300, style)).toBe("DAY 500");
  });

  it("writes only inside the surface it is handed", () => {
    const surface = { pixels: new Uint32Array(20 * 10), width: 20, height: 10 };
    drawText(surface, "STRATA", 15, 6, RED, { scale: 4 });
    expect(surface.pixels.length).toBe(200); // nothing resized, nothing threw
  });
});

describe("renderShareCard", () => {
  const size = 8;
  const left = new Uint32Array(size * size).fill(RED);
  const right = new Uint32Array(size * size);
  right[0] = BLUE;

  const card = renderShareCard({
    title: "DAY 500 · A THEME",
    panels: [
      { label: "WHAT SURVIVED", pixels: left, size },
      { label: "62,924 PIXELS BURIED", pixels: right, size, strong: true },
    ],
  });

  it("is exactly the size every crawler expects", () => {
    expect(card.width).toBe(CARD_WIDTH);
    expect(card.height).toBe(CARD_HEIGHT);
    expect(card.pixels.length).toBe(CARD_WIDTH * CARD_HEIGHT);
  });

  it("draws both canvases", () => {
    expect(card.pixels).toContain(RED);
    expect(card.pixels).toContain(BLUE);
  });

  it("leaves no pixel unpainted — a transparent card renders as a black box", () => {
    for (let i = 0; i < card.pixels.length; i++) {
      if ((card.pixels[i] >>> 24) !== 255) throw new Error(`pixel ${i} is not opaque`);
    }
  });

  it("keeps the panels apart and inside the margins", () => {
    // The gap between the two panels holds no canvas colour.
    const row = 300 * CARD_WIDTH;
    for (let x = 578; x < 620; x++) {
      expect(card.pixels[row + x]).not.toBe(RED);
      expect(card.pixels[row + x]).not.toBe(BLUE);
    }
  });

  it("survives a canvas of a different size", () => {
    const small = renderShareCard({
      title: "DAY 1",
      panels: [{ label: "DAY ONE", pixels: new Uint32Array(144 * 144).fill(RED), size: 144 }],
    });
    expect(small.pixels).toContain(RED);
  });
});

describe("claimedPixels", () => {
  it("keeps only the cells whose top layer is that artist's", () => {
    const layers = allocLayers(2);
    const rgba = new Uint32Array([RED, BLUE]);
    // Cell 0: artist 1 on top. Cell 1: artist 0 on top. Cell 2: never painted.
    layers.depth[0] = 2;
    layers.final[0] = 1;
    layers.lastArtist[0] = 1;
    layers.depth[1] = 1;
    layers.final[1] = 0;
    layers.lastArtist[1] = 0;

    const mine = claimedPixels(layers, rgba, 1);
    expect(mine[0]).toBe(BLUE);
    expect(mine[1]).toBe(TRANSPARENT);
    expect(mine[2]).toBe(TRANSPARENT);
  });
});

describe("asGround and over", () => {
  it("drains colour without touching transparency", () => {
    const ground = asGround(new Uint32Array([RED, TRANSPARENT]));
    expect(ground[0]).not.toBe(RED);
    expect(ground[0] >>> 24).toBe(255);
    expect(ground[1]).toBe(TRANSPARENT);
  });

  it("puts the highlight on top and leaves the rest of the ground alone", () => {
    const base = new Uint32Array([RED, RED]);
    const top = new Uint32Array([BLUE, TRANSPARENT]);
    expect([...over(base, top)]).toEqual([BLUE, RED]);
  });
});
