import { useMemo } from "react";

import type { Placements } from "../core/decode.js";
import { Timeline, keyframeBudget, placementHistogram } from "../core/keyframes.js";

/**
 * Builds the scrub keyframes once per day, right after the first replay, and
 * keeps them until the day or the canvas size changes. Rebuilding them on a
 * scrub frame is the one mistake that makes the whole time axis feel broken.
 */
export function useTimeline(placements: Placements | null, size: number): Timeline | null {
  return useMemo(() => {
    if (!placements) return null;
    return new Timeline(placements, size, { memoryBudgetBytes: deviceKeyframeBudget() });
  }, [placements, size]);
}

/** Bars in the time axis. One per fifteen minutes of a full day. */
const ACTIVITY_BUCKETS = 96;

/**
 * Stroke counts per slice of the day, for the band behind the scrubber.
 * `from` and `to` are unix seconds — the day's own window, so a quiet start
 * reads as a quiet start rather than being squeezed out of the picture.
 */
export function useActivity(
  placements: Placements | null,
  from: number,
  to: number,
  buckets = ACTIVITY_BUCKETS,
): Uint32Array | null {
  return useMemo(() => {
    if (!placements) return null;
    return placementHistogram(placements, from, to, buckets);
  }, [placements, from, to, buckets]);
}

/**
 * `navigator.deviceMemory` is Chromium-only and reports whole gigabytes. When
 * it is missing the full budget is used — DOCS.md §7.1 only halves it on a
 * device that says it has 4 GB or less.
 */
function deviceKeyframeBudget(): number {
  const reported = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return keyframeBudget(typeof reported === "number" ? reported : undefined);
}
