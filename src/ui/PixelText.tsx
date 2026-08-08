// The numbers on screen, drawn with the same 5×7 bitmap font that draws the
// share cards.
//
// `src/render/pixelFont.ts` exists because a card for a pixel-art project should
// be made of pixels — no font file, no shaping library, no second network call.
// That argument does not stop at the edge of the PNG. A day number set in a
// smoothed webfont, sitting above a canvas rendered at a whole scale with
// antialiasing switched off, is the interface quietly disagreeing with its own
// subject.
//
// So the display numerals come from the same source as the cards: the day
// number, the drilled coordinate, the survival percentage, the scale readout.
// Everything else on the page stays Roboto Mono. This is the one loud typeface
// and it is used four times.
//
// The glyph set is uppercase, digits and a little punctuation — `fontSafe`
// folds what it can and drops what it cannot, so nothing ever renders as tofu.
// Text that will not survive that is not display text, and belongs in the body
// face where it can be read properly.

import { useEffect, useRef } from "react";

import { drawText, textHeight, textWidth } from "../render/pixelFont.ts";

export interface PixelTextProps {
  readonly children: string;
  /**
   * Screen pixels per font pixel. Whole numbers only — this is the same rule
   * the canvas is drawn under, for the same reason.
   */
  readonly scale?: number;
  /** Any CSS colour. Sampled off a probe element so tokens work. */
  readonly color?: string;
  readonly tracking?: number;
  readonly className?: string;
}

export function PixelText({
  children,
  scale = 3,
  color = "currentColor",
  tracking = 1,
  className,
}: PixelTextProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const style = { scale, tracking };
  const width = Math.max(1, textWidth(children, style));
  const height = textHeight(style);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;

    // A 2D context does not understand `currentColor` — it is a CSS keyword,
    // not a colour, and assigning it leaves `fillStyle` untouched. So the
    // cascade is asked instead: the canvas inherits `color` from whatever class
    // is on it, and `getComputedStyle` gives back what that resolved to. This is
    // what lets `.survival-figure { color: var(--accent) }` reach the glyphs.
    ctx.fillStyle = color === "currentColor" ? getComputedStyle(canvas).color : color;
    // Read back rather than reuse: the context normalises whatever it was given
    // to one of two spellings, and `packCss` only has to know those two.
    const ink = packCss(ctx.fillStyle);

    const dpr = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    // A whole number of device pixels per font pixel, so the glyphs land on the
    // display's own grid instead of being resampled onto it.
    const device = Math.max(1, Math.round(dpr));
    const w = width * device;
    const h = height * device;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;

    const surface = { pixels: new Uint32Array(w * h), width: w, height: h };
    drawText(surface, children, 0, 0, ink, { scale: scale * device, tracking });

    const image = new ImageData(new Uint8ClampedArray(surface.pixels.buffer), w, h);
    ctx.clearRect(0, 0, w, h);
    ctx.putImageData(image, 0, 0);
  }, [children, scale, tracking, color, width, height]);

  // The real text is in the DOM and only the picture of it is hidden. Labelling
  // the canvas with `aria-label` would satisfy a screen reader and nothing else:
  // the number would still be uncopyable, unfindable with ctrl-F, and invisible
  // to anything reading the page as text. A canvas is how this is drawn, not
  // what it is.
  return (
    <span className={className === undefined ? "pixel-text" : `pixel-text ${className}`}>
      <span className="visually-hidden">{children}</span>
      <canvas
        ref={canvasRef}
        className="pixel-text-canvas"
        style={{ width: `${width}px`, height: `${height}px` }}
        aria-hidden="true"
      />
    </span>
  );
}

/**
 * A resolved CSS colour to the little-endian packed RGBA the renderer writes.
 *
 * A 2D context normalises `fillStyle` to exactly two spellings — `#rrggbb` when
 * the colour is opaque, `rgba(r, g, b, a)` when it is not — so those are the
 * two this handles. Anything else would be a browser doing something new, and
 * white is the safe answer on this project's backgrounds.
 */
function packCss(resolved: string): number {
  const hex = /^#([0-9a-f]{6})$/i.exec(resolved);
  if (hex !== null) {
    const n = parseInt(hex[1], 16);
    return ((255 << 24) | ((n & 0xff) << 16) | (((n >> 8) & 0xff) << 8) | ((n >> 16) & 0xff)) >>> 0;
  }

  const parts = resolved.match(/[\d.]+/g);
  if (parts === null || parts.length < 3) return 0xffffffff;
  const [r, g, b] = parts.map(Number);
  const a = parts.length > 3 ? Math.round(Number(parts[3]) * 255) : 255;
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
}
