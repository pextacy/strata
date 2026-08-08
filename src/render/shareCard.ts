/**
 * The share card: 1200×630, two canvases side by side, one number.
 *
 * Pure — buffers in, buffers out, no DOM and no network — so the same function
 * runs in the share-image function and in a test that writes the PNG to disk and
 * looks at it.
 *
 * Everything lands on an integer grid and every canvas is scaled by a whole
 * number, because a share card is the first thing most people will ever see of
 * this project and a smeared pixel in it undoes the argument.
 */

import type { Layers } from "../core/replay.ts";
import { drawText, fillRect, fitText, textWidth, type Surface } from "./pixelFont.ts";
import {
  TRANSPARENT,
  blueOf,
  greenOf,
  isTransparent,
  packRgba,
  redOf,
} from "./palette.ts";

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

/** The brand, packed once. Same values as src/styles/tokens.css. */
const BG = packRgba(0x1e, 0x27, 0x35);
const SUNKEN = packRgba(0x18, 0x21, 0x30);
const LINE = packRgba(0x35, 0x40, 0x4f);
const ACCENT = packRgba(0xfd, 0xe0, 0x47);
const MUTED = packRgba(0x9a, 0xa6, 0xb6);

const MARGIN = 64;
const PANEL_TOP = 58;
const PANEL_BOX = 512;
const PANEL_GAP = 48;

export interface CardPanel {
  /**
   * Said under the panel, in words. "WHAT SURVIVED", not "layer 2". One panel
   * per card carries the number as its label — the figure describes the picture
   * above it, so it needs no second line to explain itself.
   */
  readonly label: string;
  /** Drawn in the accent, larger. This is the number people screenshot. */
  readonly strong?: boolean;
  /** size × size packed RGBA. Fully transparent cells show the panel ground. */
  readonly pixels: Uint32Array;
  readonly size: number;
}

export interface ShareCardInput {
  /** Right of the wordmark: the day, the artist, whatever names this card. */
  readonly title: string;
  readonly panels: readonly CardPanel[];
}

const WORDMARK_SCALE = 5;
const TITLE_SCALE = 4;
const LABEL_SCALE = 3;
const STRONG_SCALE = 4;

export function renderShareCard(input: ShareCardInput): Surface {
  const surface: Surface = {
    pixels: new Uint32Array(CARD_WIDTH * CARD_HEIGHT),
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
  };
  surface.pixels.fill(BG);

  // Header: the wordmark, then what this card is about, right-aligned so a long
  // theme name grows towards the middle and never past the edge.
  const wordmark = drawText(surface, "STRATA", MARGIN, 14, ACCENT, { scale: WORDMARK_SCALE });
  const titleRoom = CARD_WIDTH - MARGIN * 2 - wordmark - 32;
  const title = fitText(input.title, titleRoom, { scale: TITLE_SCALE });
  drawText(surface, title, CARD_WIDTH - MARGIN - textWidth(title, { scale: TITLE_SCALE }), 21, MUTED, {
    scale: TITLE_SCALE,
  });

  const panels = input.panels.slice(0, 2);
  const boxes = panelBoxes(panels.length);
  const labelTop = PANEL_TOP + PANEL_BOX;

  panels.forEach((panel, index) => {
    const box = boxes[index];
    fillRect(surface, box, PANEL_TOP, PANEL_BOX, PANEL_BOX, SUNKEN);
    outline(surface, box, PANEL_TOP, PANEL_BOX, PANEL_BOX, LINE);
    blit(surface, panel, box, PANEL_TOP);

    // The last panel's label may run into the margin; earlier ones stop at the
    // gap, so two labels can never touch.
    const last = index === panels.length - 1;
    const room = (last ? CARD_WIDTH - MARGIN : box + PANEL_BOX) - box;
    const style = { scale: panel.strong === true ? STRONG_SCALE : LABEL_SCALE };
    drawText(
      surface,
      fitText(panel.label, room, style),
      box,
      labelTop + (panel.strong === true ? 12 : 16),
      panel.strong === true ? ACCENT : MUTED,
      style,
    );
  });

  return surface;
}

/** Left edges of the panel boxes, centred as a group. */
function panelBoxes(count: number): number[] {
  if (count <= 1) return [Math.round((CARD_WIDTH - PANEL_BOX) / 2)];
  const total = PANEL_BOX * 2 + PANEL_GAP;
  const left = Math.round((CARD_WIDTH - total) / 2);
  return [left, left + PANEL_BOX + PANEL_GAP];
}

/** Nearest-neighbour, integer scale, centred in its box. Transparent stays. */
function blit(surface: Surface, panel: CardPanel, boxX: number, boxY: number): void {
  const { size, pixels } = panel;
  if (size <= 0) return;
  const scale = Math.max(1, Math.floor(PANEL_BOX / size));
  const side = size * scale;
  const offsetX = boxX + Math.round((PANEL_BOX - side) / 2);
  const offsetY = boxY + Math.round((PANEL_BOX - side) / 2);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const color = pixels[y * size + x];
      // Ghost mode leaves most of the canvas empty; empty means the ground
      // shows through, not that a black square gets drawn.
      if (color === TRANSPARENT || isTransparent(color)) continue;
      fillRect(surface, offsetX + x * scale, offsetY + y * scale, scale, scale, color);
    }
  }
}

function outline(
  surface: Surface,
  x: number,
  y: number,
  width: number,
  height: number,
  color: number,
): void {
  fillRect(surface, x, y, width, 1, color);
  fillRect(surface, x, y + height - 1, width, 1, color);
  fillRect(surface, x, y, 1, height, color);
  fillRect(surface, x + width - 1, y, 1, height, color);
}

/**
 * The canvas as context: drained of colour and pushed down towards the page
 * background, so that whatever is drawn on top of it is obviously the subject.
 * Nobody could mistake this for the artwork's own colours, which is exactly why
 * it is safe to show — it is a backdrop, not a claim about the painting.
 */
export function asGround(pixels: Uint32Array, strength = 0.45): Uint32Array {
  const out = new Uint32Array(pixels.length);
  for (let i = 0; i < pixels.length; i++) {
    const color = pixels[i];
    if (isTransparent(color)) continue;
    const r = redOf(color);
    const g = greenOf(color);
    const b = blueOf(color);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) * strength;
    // Tinted towards the same blue the page background sits at.
    out[i] = packRgba(Math.round(lum * 0.55), Math.round(lum * 0.68), Math.round(lum * 0.95), 255);
  }
  return out;
}

/** `top` wherever it is not transparent, `base` everywhere else. */
export function over(base: Uint32Array, top: Uint32Array): Uint32Array {
  const out = base.slice();
  for (let i = 0; i < top.length && i < out.length; i++) {
    if (!isTransparent(top[i])) out[i] = top[i];
  }
  return out;
}

/**
 * The cells whose final colour was written by one artist, in that colour, with
 * everything else transparent. This is "what survived" for a person, and it is
 * read straight off `lastArtist` — the same buffer the survival rate counts.
 */
export function claimedPixels(
  layers: Layers,
  rgba: Uint32Array,
  artist: number,
): Uint32Array {
  const { size, final, depth, lastArtist } = layers;
  const cells = size * size;
  const out = new Uint32Array(cells);
  for (let i = 0; i < cells; i++) {
    if (depth[i] === 0 || lastArtist[i] !== artist) continue;
    const color = final[i];
    out[i] = color < rgba.length ? rgba[color] : TRANSPARENT;
  }
  return out;
}
