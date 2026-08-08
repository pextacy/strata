import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The palette, checked against WCAG rather than against taste.
 *
 * Every colour on screen comes from a custom property in `tokens.css`, so the
 * whole question of whether this app is readable is decided by about nine hex
 * values. They are read out of the stylesheet here rather than repeated, so a
 * colour that gets nudged has to come past this file on the way.
 *
 * The threshold that matters is 4.5:1: everything Strata sets in `--step--1` is
 * 0.78rem, which is under the 18.66px that WCAG counts as large text. `--danger`
 * was #e95252 and failed at 3.64:1 against `--bg-raised` — the one surface it is
 * used as text on, in `.mint-bad`, which is the sentence saying somebody's mint
 * did not go through.
 */

const TOKENS = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");

/** The value of a custom property, straight out of the stylesheet. */
function token(name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(TOKENS);
  if (match === null) throw new Error(`--${name} is not a six-digit hex in tokens.css`);
  return match[1];
}

const channel = (value: number): number => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** The three things anything can sit on. */
const SURFACES = ["bg", "bg-raised", "bg-sunken"] as const;

describe("the palette is readable", () => {
  it("reads its colours out of tokens.css, not out of this file", () => {
    expect(token("bg")).toMatch(/^#[0-9a-f]{6}$/i);
    expect(token("fg")).toMatch(/^#[0-9a-f]{6}$/i);
  });

  /**
   * `--muted` and `--danger` are the two that carry small text, and `--fg` and
   * `--accent` carry everything else. All four have to clear AA on every surface
   * they can land on — a token is not scoped to one background, so the weakest
   * pairing is the one that decides.
   */
  for (const ink of ["fg", "accent", "muted", "danger"] as const) {
    for (const surface of SURFACES) {
      it(`${ink} on ${surface} clears 4.5:1`, () => {
        const ratio = contrast(token(ink), token(surface));
        expect(ratio, `${token(ink)} on ${token(surface)} is ${ratio.toFixed(2)}:1`).
          toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it("keeps white legible on the header blue", () => {
    // The wordmark and the nav sit on this one rather than on a surface.
    expect(contrast(token("fg"), token("header"))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the page background legible on the accent", () => {
    // Reversed out: the skip link and the buttons put --bg on --accent.
    expect(contrast(token("bg"), token("accent"))).toBeGreaterThanOrEqual(4.5);
  });

  /**
   * The focus ring is the one thing on the page a keyboard user cannot do
   * without, and it is a graphic rather than text, so the bar is 3:1.
   */
  it("draws a focus ring that can be seen against every surface", () => {
    for (const surface of SURFACES) {
      expect(contrast(token("accent"), token(surface))).toBeGreaterThanOrEqual(3);
    }
  });
});

/**
 * The share card cannot use a custom property — it is packed bytes written by a
 * PNG encoder in Node, with no stylesheet anywhere near it — so it repeats the
 * brand colours as literals and a comment promises they are the same ones. That
 * promise is what drifts. A card in somebody's timeline wearing last year's
 * palette is the one place a colour change shows up where nobody can fix it.
 */
describe("the share card is painted in the same colours as the page", () => {
  const CARD = readFileSync(new URL("../src/render/shareCard.ts", import.meta.url), "utf8");

  const literal = (name: string): string => {
    const pattern = String.raw`const ${name} = packRgba\(0x([0-9a-f]{2}), 0x([0-9a-f]{2}), 0x([0-9a-f]{2})\)`;
    const match = new RegExp(pattern).exec(CARD);
    if (match === null) throw new Error(`${name} is not a packRgba literal in shareCard.ts`);
    return `#${match[1]}${match[2]}${match[3]}`;
  };

  it.each([
    ["BG", "bg"],
    ["SUNKEN", "bg-sunken"],
    ["LINE", "line"],
    ["ACCENT", "accent"],
    ["MUTED", "muted"],
  ])("%s is --%s", (constant, name) => {
    expect(literal(constant)).toBe(token(name).toLowerCase());
  });
});
