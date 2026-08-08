/**
 * A PNG encoder in about a hundred lines, so the share card needs no image
 * library and no font file. Strata already holds every pixel it wants to ship
 * as a Uint32Array; this turns one into bytes.
 *
 * Compression is injected. Node hands in `zlib.deflateSync` and the card comes
 * out around a hundred kilobytes; with nothing handed in, the encoder writes
 * uncompressed deflate blocks, which any decoder reads and which keeps this file
 * runnable anywhere.
 */

/** Deflates a buffer. `zlib.deflateSync` fits this shape exactly. */
export type Deflate = (data: Uint8Array) => Uint8Array;

const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** RGBA, 8 bits a channel. */
const COLOR_TYPE_RGBA = 6;

export interface PngOptions {
  readonly deflate?: Deflate;
}

/**
 * `pixels` is little-endian packed RGBA — the same layout `ImageData` and
 * `src/render/palette.ts` use, so a rendered layer goes straight in.
 */
export function encodePng(
  pixels: Uint32Array,
  width: number,
  height: number,
  options: PngOptions = {},
): Uint8Array {
  const cells = width * height;
  if (pixels.length < cells) {
    throw new Error(`png needs ${cells} pixels, got ${pixels.length}`);
  }

  // One filter byte per scanline, then the row. Filter 0 (none) throughout:
  // pixel art is flat colour, so the filters that help photographs cost bytes
  // here and buy nothing.
  const raw = new Uint8Array(height * (1 + width * 4));
  const bytes = new Uint8Array(pixels.buffer, pixels.byteOffset, cells * 4);
  let at = 0;
  for (let y = 0; y < height; y++) {
    raw[at++] = 0;
    raw.set(bytes.subarray(y * width * 4, (y + 1) * width * 4), at);
    at += width * 4;
  }

  const compressed = options.deflate ? options.deflate(raw) : zlibStored(raw);

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = COLOR_TYPE_RGBA;
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

/** A zlib stream of stored (uncompressed) deflate blocks. Valid, just fat. */
function zlibStored(data: Uint8Array): Uint8Array {
  const MAX = 0xffff;
  const blocks = Math.max(1, Math.ceil(data.length / MAX));
  const out = new Uint8Array(2 + blocks * 5 + data.length + 4);
  let at = 0;
  out[at++] = 0x78; // CM 8, 32K window
  out[at++] = 0x01; // no dictionary, fastest — makes the header a multiple of 31

  for (let i = 0; i < blocks; i++) {
    const from = i * MAX;
    const len = Math.min(MAX, data.length - from);
    out[at++] = i === blocks - 1 ? 1 : 0; // BFINAL on the last block, BTYPE 00
    out[at++] = len & 0xff;
    out[at++] = (len >> 8) & 0xff;
    out[at++] = ~len & 0xff;
    out[at++] = (~len >> 8) & 0xff;
    out.set(data.subarray(from, from + len), at);
    at += len;
  }

  const sum = adler32(data);
  out[at++] = (sum >>> 24) & 0xff;
  out[at++] = (sum >>> 16) & 0xff;
  out[at++] = (sum >>> 8) & 0xff;
  out[at++] = sum & 0xff;
  return out.subarray(0, at);
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(data: Uint8Array): number {
  const MOD = 65521;
  let a = 1;
  let b = 0;
  // Chunked so the accumulators cannot overflow a 32-bit int mid-run.
  for (let i = 0; i < data.length; ) {
    const end = Math.min(i + 5552, data.length);
    for (; i < end; i++) {
      a += data[i];
      b += a;
    }
    a %= MOD;
    b %= MOD;
  }
  return ((b << 16) | a) >>> 0;
}
