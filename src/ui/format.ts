/** Small display helpers. Anything that reads a buffer belongs in `src/core`. */

/**
 * Seconds into a day as `HH:MM`. This counts elapsed painting time, not a wall
 * clock — a BasePaint day opens at about 16:42 UTC, so a clock reading would
 * make "the start of the day" look like the middle of the afternoon.
 */
export function formatElapsed(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** `0x1234…abcd`. The full address always stays available in a title. */
export function shortAddress(address: string, keep = 4): string {
  const clean = address.trim();
  return clean.length > 2 + keep * 2 + 2
    ? `${clean.slice(0, 2 + keep)}…${clean.slice(-keep)}`
    : clean;
}
