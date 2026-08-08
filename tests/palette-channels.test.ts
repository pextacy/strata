import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  TRANSPARENT,
  alphaOf,
  blueOf,
  greenOf,
  isTransparent,
  packRgba,
  redOf,
} from "../src/render/palette.js";
import { asGround, over } from "../src/render/shareCard.js";

/**
 * Which byte of a packed pixel is which.
 *
 * `packRgba` measures the machine's byte order rather than assuming it, and says
 * why: a Uint32 view of `ImageData.data` reads as ABGR on a little-endian
 * machine and as RGBA on a big-endian one, and the wrong choice still produces a
 * picture — just the wrong picture. Everything that takes a packed pixel apart
 * has to make the same measurement, and `shareCard.ts` did not: it read
 * `color >>> 24` for alpha and `color & 0xff` for red, which are the alpha and
 * the red on the machine everyone tests on and the red and the alpha on the
 * other one. The card would have been drawn from three shifted channels, and
 * every pixel with no red would have been dropped as transparent.
 *
 * A test cannot switch the machine over, so it checks the property that has to
 * hold on either: whatever `packRgba` put in, the accessors take back out.
 */

const CHANNELS = [
  [0, 0, 0, 255],
  [255, 255, 255, 255],
  [253, 224, 71, 255], // the accent
  [30, 39, 53, 255], // the page
  [1, 0, 0, 255], // red only, which a wrong alpha test would call transparent
  [0, 1, 0, 255],
  [0, 0, 1, 255],
  [7, 62, 177, 128], // partly transparent
  [0, 0, 0, 0], // fully transparent
] as const;

describe("a packed pixel comes back apart the way it went together", () => {
  it.each(CHANNELS)("keeps r=%i g=%i b=%i a=%i", (r, g, b, a) => {
    const packed = packRgba(r, g, b, a);
    expect(redOf(packed), "red").toBe(r);
    expect(greenOf(packed), "green").toBe(g);
    expect(blueOf(packed), "blue").toBe(b);
    expect(alphaOf(packed), "alpha").toBe(a);
  });

  it("calls a pixel transparent only when its alpha is zero", () => {
    expect(isTransparent(TRANSPARENT)).toBe(true);
    expect(isTransparent(packRgba(0, 0, 0, 0))).toBe(true);
    // The one a swapped alpha test gets wrong: opaque, but with no red in it.
    expect(isTransparent(packRgba(0, 255, 255, 255))).toBe(false);
    expect(isTransparent(packRgba(0, 0, 0, 255))).toBe(false);
    expect(isTransparent(packRgba(0, 0, 0, 1))).toBe(false);
  });

  /**
   * Reading the source, because the bug this file exists for is not visible in
   * the output on the machine running the test. A hand-rolled shift is right
   * here and wrong elsewhere, and the only way to catch it from here is to say
   * it must not be written.
   */
  it("leaves the byte order to palette.ts, everywhere that unpacks a pixel", () => {
    const shareCard = readFileSync(new URL("../src/render/shareCard.ts", import.meta.url), "utf8");
    expect(shareCard).not.toMatch(/>>>\s*24/);
    expect(shareCard).not.toMatch(/&\s*0xff/);
    expect(shareCard).toContain("isTransparent");
  });
});

describe("the card's own pixel work survives the round trip", () => {
  it("drains colour without dropping an opaque pixel that has no red", () => {
    // Green and blue only. Under the old shifts this was `alpha === 0` and the
    // whole pixel was skipped, leaving a hole in the backdrop.
    const source = Uint32Array.from([packRgba(0, 200, 200, 255)]);
    const ground = asGround(source);
    expect(isTransparent(ground[0])).toBe(false);
    expect(alphaOf(ground[0])).toBe(255);
  });

  it("leaves a genuinely transparent pixel alone", () => {
    const source = Uint32Array.from([packRgba(0, 0, 0, 0)]);
    expect(asGround(source)[0]).toBe(TRANSPARENT);
  });

  it("lays an opaque pixel over the ground and keeps a transparent one out", () => {
    const base = Uint32Array.from([packRgba(10, 20, 30), packRgba(10, 20, 30)]);
    const top = Uint32Array.from([packRgba(0, 90, 90, 255), packRgba(0, 0, 0, 0)]);
    const result = over(base, top);
    expect(result[0]).toBe(top[0]); // opaque, no red — still wins
    expect(result[1]).toBe(base[1]); // transparent — leaves the base showing
  });
});
