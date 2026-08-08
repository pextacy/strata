import { useMemo, useRef } from "react";

import type { Layers } from "../core/replay.ts";
import { paintLayer, type ViewMode } from "../render/layers.ts";

/**
 * Paints one view of the day into an ImageData, reusing two buffers instead of
 * allocating a quarter of a megabyte per frame.
 *
 * Two, not one: `CanvasView` redraws when the ImageData it was handed is a
 * different object, so a single mutated buffer would never repaint. Alternating
 * gives every frame a new identity and still allocates nothing after the first
 * two.
 */
export interface LayerImageInput {
  readonly mode: ViewMode;
  readonly layers: Layers | null;
  /** Palette as packed little-endian pixels. */
  readonly rgba: Uint32Array | null;
  /** The day's own deepest cell, so the depth ramp does not move while scrubbing. */
  readonly maxDepth: number;
  /**
   * Bump when `layers` changed underneath without its identity changing —
   * scrubbing reuses one scratch canvas, so the object is always the same one.
   */
  readonly revision?: number;
}

export function useLayerImage({
  mode,
  layers,
  rgba,
  maxDepth,
  revision = 0,
}: LayerImageInput): ImageData | null {
  const buffers = useRef<readonly [ImageData, ImageData] | null>(null);
  const flip = useRef(0);

  return useMemo(() => {
    if (layers === null || rgba === null) return null;

    const size = layers.size;
    let pair = buffers.current;
    if (pair === null || pair[0].width !== size) {
      pair = [new ImageData(size, size), new ImageData(size, size)];
      buffers.current = pair;
    }

    flip.current ^= 1;
    const image = pair[flip.current];
    paintLayer(new Uint32Array(image.data.buffer), mode, layers, rgba, maxDepth);
    return image;
    // `revision` is deliberately here and deliberately unread: it is the only
    // signal that a reused scratch canvas holds different pixels than it did.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, layers, rgba, maxDepth, revision]);
}
