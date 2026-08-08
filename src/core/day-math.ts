import { DAY_DURATION, DAY_ONE_START } from "./constants.ts";

/**
 * The BasePaint day number for a given moment. Day 1 is the day that opened at
 * DAY_ONE_START, so the arithmetic is offset by one. Boundaries land at about
 * 16:42 UTC.
 */
export function currentDay(nowSec: number = Math.floor(Date.now() / 1000)): number {
  return Math.floor((nowSec - DAY_ONE_START) / DAY_DURATION) + 1;
}

/** Unix seconds at which `day` opened. */
export function dayStart(day: number): number {
  return DAY_ONE_START + (day - 1) * DAY_DURATION;
}

/** Unix seconds at which `day` closed — i.e. the instant `day + 1` opened. */
export function dayEnd(day: number): number {
  return dayStart(day) + DAY_DURATION;
}

/** True while `day` is still being painted. */
export function isDayOpen(day: number, nowSec: number = Math.floor(Date.now() / 1000)): boolean {
  return nowSec >= dayStart(day) && nowSec < dayEnd(day);
}

/** How far into the day `t` sits, clamped to [0, 1]. */
export function dayProgress(day: number, t: number): number {
  const p = (t - dayStart(day)) / DAY_DURATION;
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

/** `500` -> `"0500"`, the form basepaint.net uses for artwork filenames. */
export function padDay(day: number): string {
  return String(day).padStart(4, "0");
}
