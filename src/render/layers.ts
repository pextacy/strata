// The four ways to read a day. Each one is a single pass over the replay
// buffers, which is why switching modes costs nothing and refetches nothing.

import type { Layers } from "../core/replay.ts";
import { TRANSPARENT, depthColor } from "./palette.ts";

export type ViewMode = "final" | "underpainting" | "depth" | "ghost";

export const VIEW_MODES = ["final", "underpainting", "depth", "ghost"] as const;

export const DEFAULT_VIEW_MODE: ViewMode = "final";

export interface ModeCopy {
  readonly label: string;
  /** One line, shown under the switch. Says what the pixels mean. */
  readonly blurb: string;
}

export const MODE_COPY: Record<ViewMode, ModeCopy> = {
  final: {
    label: "Final",
    blurb: "The canvas as it ended, rebuilt stroke by stroke from the chain.",
  },
  underpainting: {
    label: "Underpainting",
    blurb: "The first colour ever laid on each cell — the day as it was sketched.",
  },
  depth: {
    label: "Depth",
    blurb: "How many times each cell was painted. Bright means fought over.",
  },
  ghost: {
    label: "Ghost",
    blurb: "Only what was painted and then covered, in the colour that was lost.",
  },
};

export function isViewMode(value: unknown): value is ViewMode {
  return typeof value === "string" && (VIEW_MODES as readonly string[]).includes(value);
}

/** Falls back to Final rather than erroring, so a mangled URL still renders. */
export function readViewMode(value: string | null | undefined): ViewMode {
  return isViewMode(value) ? value : DEFAULT_VIEW_MODE;
}

/**
 * Writes one view of `layers` into `out`, which is a Uint32 view of an
 * ImageData buffer. Pure and DOM-free so it can be unit tested in Node.
 *
 * A cell nobody painted is not empty: a BasePaint canvas starts as palette
 * index 0 everywhere, which is why `npm run verify` only reaches zero
 * mismatches when the ground colour is drawn. Final and Underpainting are whole
 * canvases and show it. Depth and Ghost are overlays and leave it out — they
 * describe the painting rather than reproduce it.
 *
 * A palette index the day does not have is drawn as nothing, matching the
 * decoder, which drops those pixels because BasePaint's renderer ignores them.
 */
export function paintLayer(
  out: Uint32Array,
  mode: ViewMode,
  layers: Layers,
  rgba: Uint32Array,
  maxDepth: number,
): Uint32Array {
  const { size, final, first, buried, depth } = layers;
  // Both buffers are zero-initialised, and palette index 0 is exactly the ground
  // the chain starts a canvas on, so an unpainted cell needs no special case.
  const cells = size * size;
  if (out.length < cells) {
    throw new Error(`pixel buffer holds ${out.length} cells, canvas needs ${cells}`);
  }

  const paletteLength = rgba.length;
  const colorOf = (index: number): number => (index < paletteLength ? rgba[index] : TRANSPARENT);

  switch (mode) {
    case "final":
      for (let i = 0; i < cells; i++) out[i] = colorOf(final[i]);
      break;

    case "underpainting":
      for (let i = 0; i < cells; i++) out[i] = colorOf(first[i]);
      break;

    case "depth":
      for (let i = 0; i < cells; i++) out[i] = depthColor(depth[i], maxDepth);
      break;

    // A cell repainted its own colour buried nothing — PRD §5 counts a placement
    // as buried only when a *different* colour covered it. Ghost mode honours
    // that, so it shows lost art rather than every cell that was touched twice.
    case "ghost":
      for (let i = 0; i < cells; i++) {
        out[i] = depth[i] > 1 && buried[i] !== final[i] ? colorOf(buried[i]) : TRANSPARENT;
      }
      break;
  }

  return out;
}

/** The same paint, into an ImageData the canvas can accept. */
export function layerImageData(
  mode: ViewMode,
  layers: Layers,
  rgba: Uint32Array,
  maxDepth: number,
): ImageData {
  const image = new ImageData(layers.size, layers.size);
  paintLayer(new Uint32Array(image.data.buffer), mode, layers, rgba, maxDepth);
  return image;
}
