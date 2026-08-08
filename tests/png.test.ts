import { deflateSync } from "node:zlib";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";

import { encodePng } from "../src/render/png.ts";
import { packRgba } from "../src/render/palette.ts";

/**
 * The encoder is checked by decoding what it writes with pngjs — the same
 * library `npm run verify` uses to read BasePaint's official renders. If a share
 * card ever comes out wrong, it will be wrong here first.
 */

function image(width: number, height: number): Uint32Array {
  const pixels = new Uint32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      pixels[y * width + x] = packRgba((x * 7) % 256, (y * 11) % 256, (x + y) % 256, 255);
    }
  }
  return pixels;
}

function expectRoundTrip(width: number, height: number, deflate?: (d: Uint8Array) => Uint8Array) {
  const pixels = image(width, height);
  const png = encodePng(pixels, width, height, { deflate });
  const decoded = PNG.sync.read(Buffer.from(png));

  expect(decoded.width).toBe(width);
  expect(decoded.height).toBe(height);

  const source = new Uint8Array(pixels.buffer);
  for (let i = 0; i < width * height * 4; i++) {
    if (decoded.data[i] !== source[i]) {
      throw new Error(`byte ${i} decoded as ${decoded.data[i]}, encoded from ${source[i]}`);
    }
  }
  return png;
}

describe("encodePng", () => {
  it("round-trips with no compressor at all", () => {
    expectRoundTrip(64, 40);
  });

  it("round-trips through node's deflate", () => {
    expectRoundTrip(64, 40, (data) => new Uint8Array(deflateSync(data)));
  });

  it("round-trips a run longer than one stored deflate block", () => {
    // 65,535 bytes is the largest stored block, so this crosses the boundary.
    expectRoundTrip(200, 200);
  });

  it("keeps alpha, which is the whole point of the ghost layer", () => {
    const pixels = new Uint32Array([packRgba(253, 224, 71, 255), packRgba(0, 0, 0, 0)]);
    const decoded = PNG.sync.read(Buffer.from(encodePng(pixels, 2, 1)));
    expect([...decoded.data.subarray(0, 4)]).toEqual([253, 224, 71, 255]);
    expect(decoded.data[7]).toBe(0);
  });

  it("compresses a flat canvas far below its raw size", () => {
    const flat = new Uint32Array(256 * 256).fill(packRgba(30, 39, 53));
    const raw = encodePng(flat, 256, 256);
    const packed = encodePng(flat, 256, 256, {
      deflate: (data) => new Uint8Array(deflateSync(data)),
    });
    expect(packed.length).toBeLessThan(raw.length / 50);
  });

  it("refuses a buffer with fewer pixels than the size claims", () => {
    expect(() => encodePng(new Uint32Array(10), 8, 8)).toThrow(/needs 64 pixels/);
  });
});
