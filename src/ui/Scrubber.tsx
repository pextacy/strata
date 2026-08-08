import { useMemo, type CSSProperties } from "react";

import { formatElapsed } from "./format.ts";
import "./Scrubber.css";

/**
 * The time axis: a continuous band under the canvas, one bar per slice of the
 * day, tall where the day was busy. Every bar is a count of real strokes.
 *
 * The band is the track. A native range input sits on top of it, transparent
 * except for the handle, which is how the scrubber gets keyboard support,
 * arrow keys, Home/End and screen-reader semantics for free rather than
 * re-implementing a slider badly.
 */

export interface ScrubberProps {
  /** Seconds since the day opened. */
  readonly value: number;
  /** Seconds of the day that exist: a full day, or however much of today. */
  readonly max: number;
  /** `commit` marks the end of a drag or key press, for the URL write. */
  readonly onChange: (t: number, options?: { readonly commit?: boolean }) => void;
  /** Placements per bucket across the whole day, from `placementHistogram`. */
  readonly activity?: Uint32Array | null;
  /** Placements laid at or before `value`, and in the day. Both are counts. */
  readonly strokesShown?: number;
  readonly strokesTotal?: number;
  readonly playing: boolean;
  readonly onPlayToggle: () => void;
  /** True while the day is still being painted; changes the end label. */
  readonly dayOpen?: boolean;
  /** The day has not finished loading; the axis has nothing to move over. */
  readonly disabled?: boolean;
}

/** One arrow key moves a minute; the day is 1,440 of them. */
const STEP_SECONDS = 60;

/* Pinned, like every other count in the app. A bare `toLocaleString()` follows
   the browser's locale, so the readout said "39.776 strokes" directly above a
   stat panel saying "39,776" — two spellings of one number on one screen. */
const count = new Intl.NumberFormat("en-US");

export function Scrubber({
  value,
  max,
  onChange,
  activity,
  strokesShown,
  strokesTotal,
  playing,
  onPlayToggle,
  dayOpen = false,
  disabled = false,
}: ScrubberProps) {
  const bars = useMemo(() => normalise(activity), [activity]);
  const played = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const idle = disabled || max <= 0;

  const readout = `${formatElapsed(value)} into the day`;
  const counted =
    strokesShown === undefined
      ? null
      : strokesTotal === undefined
        ? `${count.format(strokesShown)} strokes laid`
        : `${count.format(strokesShown)} of ${count.format(strokesTotal)} strokes laid`;

  return (
    <div className={`scrubber${idle ? " is-idle" : ""}`}>
      <button
        type="button"
        className="scrubber-play"
        onClick={() => {
          onPlayToggle();
          // Playback writes the URL a few times a second; stopping mid-run left
          // the address bar up to a quarter of a second — nine minutes of a
          // day — behind the frame on screen. Pausing is the end of a gesture,
          // like letting go of the handle, so it commits.
          onChange(value, { commit: true });
        }}
        disabled={idle}
        aria-pressed={playing}
      >
        {playing ? "Pause" : "Play"}
      </button>

      <div className="scrubber-track" style={{ "--played": `${played * 100}%` } as PlayedStyle}>
        <div className="scrubber-band" aria-hidden="true">
          {bars.length > 0 && (
            <>
              <div className="scrubber-bars">
                {bars.map((height, i) => (
                  <span key={i} className="scrubber-bar" style={{ height: `${height * 100}%` }} />
                ))}
              </div>
              <div className="scrubber-bars is-played">
                {bars.map((height, i) => (
                  <span key={i} className="scrubber-bar" style={{ height: `${height * 100}%` }} />
                ))}
              </div>
            </>
          )}
        </div>

        <input
          type="range"
          className="scrubber-range"
          min={0}
          max={Math.max(max, 1)}
          step={STEP_SECONDS}
          value={value}
          disabled={idle}
          onChange={(event) => onChange(Number(event.target.value))}
          onPointerUp={() => onChange(value, { commit: true })}
          onKeyUp={() => onChange(value, { commit: true })}
          onBlur={() => onChange(value, { commit: true })}
          aria-label="Time of day"
          aria-valuetext={counted === null ? readout : `${readout}, ${counted}`}
        />
      </div>

      <div className="scrubber-scale" aria-hidden="true">
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>{dayOpen ? formatElapsed(max) : "24:00"}</span>
      </div>

      <p className="scrubber-readout">
        <strong>{formatElapsed(value)}</strong>
        <span className="scrubber-sep">·</span>
        {counted ?? (idle ? "Nothing to scrub through yet." : "Every stroke up to this moment.")}
      </p>
    </div>
  );
}

/** `--played` is a custom property, which React's CSSProperties will not take. */
type PlayedStyle = CSSProperties & { "--played": string };

/** Bar heights in 0..1, against the busiest slice of that day. */
function normalise(activity: Uint32Array | null | undefined): number[] {
  if (!activity || activity.length === 0) return [];
  let peak = 0;
  for (let i = 0; i < activity.length; i++) if (activity[i] > peak) peak = activity[i];
  if (peak === 0) return [];
  // Square root, because a heavy day's peak hour is an order of magnitude above
  // its quiet ones and a linear band would read as one spike and a flat line.
  return Array.from(activity, (count) => Math.sqrt(count / peak));
}
