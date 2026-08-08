/**
 * A 5×7 bitmap font, drawn one pixel at a time into the same packed-RGBA buffer
 * everything else in `src/render` writes to.
 *
 * A share card for a pixel-art project should be made of pixels, and a bitmap
 * font means the card carries no font file, no shaping library, and no second
 * network call at render time. It is uppercase only — anything lowercase is
 * folded up, and a character with no glyph is dropped rather than drawn as a
 * box, so a theme name never renders as a row of tofu.
 */

const W = 5;
const H = 7;

// prettier-ignore
const GLYPHS: Record<string, readonly string[]> = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".###.", "#...#", "#....", "#..##", "#...#", "#...#", ".###."],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  J: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#...#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#...#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": ["#####", "...#.", "..#..", "...#.", "....#", "#...#", ".###."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
  " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
  ".": [".....", ".....", ".....", ".....", ".....", ".....", "..#.."],
  ",": [".....", ".....", ".....", ".....", ".....", "..#..", ".#..."],
  ":": [".....", "..#..", ".....", ".....", ".....", "..#..", "....."],
  "·": [".....", ".....", ".....", "..#..", ".....", ".....", "....."],
  "-": [".....", ".....", ".....", ".###.", ".....", ".....", "....."],
  "+": [".....", "..#..", "..#..", "#####", "..#..", "..#..", "....."],
  "=": [".....", ".....", "#####", ".....", "#####", ".....", "....."],
  "/": ["....#", "....#", "...#.", "..#..", ".#...", "#....", "#...."],
  "%": ["#...#", "#..#.", "...#.", "..#..", ".#...", ".#..#", "#...#"],
  "×": [".....", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "....."],
  "'": ["..#..", "..#..", ".....", ".....", ".....", ".....", "....."],
  "!": ["..#..", "..#..", "..#..", "..#..", "..#..", ".....", "..#.."],
  "?": [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."],
  "(": ["...#.", "..#..", ".#...", ".#...", ".#...", "..#..", "...#."],
  ")": [".#...", "..#..", "...#.", "...#.", "...#.", "..#..", ".#..."],
  "#": [".#.#.", ".#.#.", "#####", ".#.#.", "#####", ".#.#.", ".#.#."],
};

/** Accented Latin folded to the letter underneath, so themes still read. */
const FOLD: Record<string, string> = {
  À: "A", Á: "A", Â: "A", Ã: "A", Ä: "A", Å: "A", Æ: "AE",
  Ç: "C", È: "E", É: "E", Ê: "E", Ë: "E",
  Ì: "I", Í: "I", Î: "I", Ï: "I",
  Ñ: "N", Ò: "O", Ó: "O", Ô: "O", Õ: "O", Ö: "O", Ø: "O",
  Ù: "U", Ú: "U", Û: "U", Ü: "U", Ý: "Y", ß: "SS",
  "—": "-", "–": "-", "‘": "'", "’": "'", "“": "'", "”": "'", "…": "...",
};

/** The text as this font can actually draw it. Unknown characters are dropped. */
export function fontSafe(text: string): string {
  let out = "";
  for (const char of text.toUpperCase()) {
    const folded = FOLD[char] ?? char;
    for (const c of folded) {
      if (c in GLYPHS) out += c;
    }
  }
  return out;
}

export interface TextStyle {
  /** Pixels per font pixel. Everything stays on the grid. */
  readonly scale?: number;
  /** Gap between glyphs, in font pixels. */
  readonly tracking?: number;
}

export function textWidth(text: string, style: TextStyle = {}): number {
  const { scale = 1, tracking = 1 } = style;
  const chars = fontSafe(text).length;
  if (chars === 0) return 0;
  return (chars * W + (chars - 1) * tracking) * scale;
}

export const textHeight = (style: TextStyle = {}): number => H * (style.scale ?? 1);

/**
 * The longest prefix of `text` that fits `maxWidth`, cut back to a word where
 * one is close by and marked with a full stop trio. Theme names are written by
 * people and some of them are long; a card must never run text off its edge.
 */
export function fitText(text: string, maxWidth: number, style: TextStyle = {}): string {
  const safe = fontSafe(text);
  if (textWidth(safe, style) <= maxWidth) return safe;

  const ellipsis = "...";
  let cut = safe.length;
  while (cut > 0 && textWidth(safe.slice(0, cut) + ellipsis, style) > maxWidth) cut--;
  if (cut <= 0) return "";

  const space = safe.lastIndexOf(" ", cut);
  const at = space > cut - 8 && space > 0 ? space : cut;
  return safe.slice(0, at).trimEnd() + ellipsis;
}

export interface Surface {
  readonly pixels: Uint32Array;
  readonly width: number;
  readonly height: number;
}

/**
 * Draws `text` with its top-left corner at (x, y) and returns the width used.
 * Colour is packed RGBA, the same as everywhere else in `src/render`.
 */
export function drawText(
  surface: Surface,
  text: string,
  x: number,
  y: number,
  color: number,
  style: TextStyle = {},
): number {
  const { scale = 1, tracking = 1 } = style;
  const safe = fontSafe(text);
  let penX = x;

  for (const char of safe) {
    const glyph = GLYPHS[char];
    for (let row = 0; row < H; row++) {
      const line = glyph[row];
      for (let col = 0; col < W; col++) {
        if (line[col] !== "#") continue;
        fillRect(surface, penX + col * scale, y + row * scale, scale, scale, color);
      }
    }
    penX += (W + tracking) * scale;
  }

  return safe.length === 0 ? 0 : penX - x - tracking * scale;
}

export function fillRect(
  surface: Surface,
  x: number,
  y: number,
  width: number,
  height: number,
  color: number,
): void {
  const { pixels, width: w, height: h } = surface;
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(w, Math.round(x + width));
  const y1 = Math.min(h, Math.round(y + height));
  for (let py = y0; py < y1; py++) {
    const row = py * w;
    for (let px = x0; px < x1; px++) pixels[row + px] = color;
  }
}
