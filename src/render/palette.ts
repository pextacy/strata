// Palette index -> packed 32-bit pixel, in the byte order ImageData actually
// stores. Everything drawn on screen goes through this file.

/**
 * `ImageData.data` is RGBA byte-ordered, so a Uint32 view of it reads as ABGR on
 * a little-endian machine. The order is measured rather than assumed: the wrong
 * one still produces a picture, just the wrong picture, and a canvas archaeology
 * tool that renders the wrong colours has no argument left to make.
 */
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([0x11223344]).buffer)[0] === 0x44;

/** Fully transparent. Unpainted cells are this, never a made-up colour. */
export const TRANSPARENT = 0;

export function packRgba(r: number, g: number, b: number, a = 255): number {
  return (
    (LITTLE_ENDIAN
      ? (a << 24) | (b << 16) | (g << 8) | r
      : (r << 24) | (g << 16) | (b << 8) | a) >>> 0
  );
}

/**
 * Reading a packed pixel back apart.
 *
 * These exist because `packRgba` above is the only thing that knows which byte
 * is which, and anything that unpacks with its own shifts quietly disagrees with
 * it on a big-endian machine — `>>> 24` is the alpha on one and the red on the
 * other. `src/render/shareCard.ts` did exactly that, so its card would have been
 * drawn from the wrong three channels and treated every pixel with no red as
 * transparent. Measuring the order and then assuming it four lines later is the
 * kind of bug that survives precisely because the assumption is right on every
 * machine anyone tests on.
 */
export const redOf = (packed: number): number => (LITTLE_ENDIAN ? packed & 0xff : packed >>> 24) & 0xff;
export const greenOf = (packed: number): number => (packed >>> (LITTLE_ENDIAN ? 8 : 16)) & 0xff;
export const blueOf = (packed: number): number => (packed >>> (LITTLE_ENDIAN ? 16 : 8)) & 0xff;
export const alphaOf = (packed: number): number => (LITTLE_ENDIAN ? packed >>> 24 : packed) & 0xff;

/** True for a pixel that would draw nothing. */
export const isTransparent = (packed: number): boolean => alphaOf(packed) === 0;

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

const HEX6 = /^#?([0-9a-f]{6})$/i;

export function parseHexColor(hex: string): Rgb | null {
  const match = HEX6.exec(hex.trim());
  if (match === null) return null;
  const n = parseInt(match[1], 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

export const cssColor = ({ r, g, b }: Rgb): string => `rgb(${r} ${g} ${b})`;

/**
 * A day's palette as packed pixels. The palette comes from the theme API and is
 * already validated there; an entry that still will not parse is drawn as
 * nothing rather than as a guess.
 */
export function toRgba(palette: readonly string[]): Uint32Array {
  const out = new Uint32Array(palette.length);
  for (let i = 0; i < palette.length; i++) {
    const color = parseHexColor(palette[i]);
    out[i] = color === null ? TRANSPARENT : packRgba(color.r, color.g, color.b);
  }
  return out;
}

// --- depth ramp -------------------------------------------------------------

/** Depth 1: the brand header blue. */
export const DEPTH_RAMP_FROM = "#073eb1";
/** The day's deepest cell: full brand accent. */
export const DEPTH_RAMP_TO = "#fde047";

interface Hsl {
  readonly h: number;
  readonly s: number;
  readonly l: number;
}

function toHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const span = max - min;
  if (span === 0) return { h: 0, s: 0, l };
  const s = span / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / span) % 6;
  else if (max === gn) h = (bn - rn) / span + 2;
  else h = (rn - gn) / span + 4;
  h *= 60;
  return { h: h < 0 ? h + 360 : h, s, l };
}

function fromHsl({ h, s, l }: Hsl): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = l - c / 2;
  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (hp < 1) [rp, gp, bp] = [c, x, 0];
  else if (hp < 2) [rp, gp, bp] = [x, c, 0];
  else if (hp < 3) [rp, gp, bp] = [0, c, x];
  else if (hp < 4) [rp, gp, bp] = [0, x, c];
  else if (hp < 5) [rp, gp, bp] = [x, 0, c];
  else [rp, gp, bp] = [c, 0, x];
  return {
    r: Math.round((rp + m) * 255),
    g: Math.round((gp + m) * 255),
    b: Math.round((bp + m) * 255),
  };
}

const RAMP_STEPS = 256;

/**
 * Both ends of the ramp are brand colours; the path between them is the one
 * invention. Hue climbs rather than falls, so the ramp runs blue -> magenta ->
 * orange -> yellow instead of dropping through green, and neighbouring depths
 * stay far enough apart to read.
 */
function buildRamp(): Rgb[] {
  const from = toHsl(parseHexColor(DEPTH_RAMP_FROM) ?? { r: 7, g: 62, b: 177 });
  const to = toHsl(parseHexColor(DEPTH_RAMP_TO) ?? { r: 253, g: 224, b: 71 });
  const hueEnd = to.h + 360;
  const ramp: Rgb[] = [];
  for (let i = 0; i < RAMP_STEPS; i++) {
    const t = i / (RAMP_STEPS - 1);
    ramp.push(
      fromHsl({
        h: from.h + (hueEnd - from.h) * t,
        s: from.s + (to.s - from.s) * t,
        l: from.l + (to.l - from.l) * t,
      }),
    );
  }
  return ramp;
}

const RAMP_RGB = buildRamp();
const RAMP_PACKED = Uint32Array.from(RAMP_RGB, (c) => packRgba(c.r, c.g, c.b));

/**
 * Where a cell of this depth sits on the ramp, given the deepest cell on the
 * day. Normalised per day per DOCS §10 — against a fixed ceiling every quiet day
 * would read as flat. The square root spreads the low end, where nearly every
 * cell sits; the legend prints real depth numbers beside real swatches, so the
 * curve never has to be taken on trust.
 */
function rampIndex(depth: number, maxDepth: number): number {
  if (maxDepth <= 1) return 0;
  const t = Math.sqrt((depth - 1) / (maxDepth - 1));
  const i = Math.round(t * (RAMP_STEPS - 1));
  return i < 0 ? 0 : i > RAMP_STEPS - 1 ? RAMP_STEPS - 1 : i;
}

/** Packed pixel for a cell painted `depth` times. Unpainted stays transparent. */
export function depthColor(depth: number, maxDepth: number): number {
  if (depth <= 0) return TRANSPARENT;
  return RAMP_PACKED[rampIndex(depth, maxDepth)];
}

/** The same colour as CSS, for legend swatches. */
export function depthCssColor(depth: number, maxDepth: number): string {
  if (depth <= 0) return "transparent";
  return cssColor(RAMP_RGB[rampIndex(depth, maxDepth)]);
}
