import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Playback for the time scrubber. The caller owns the position — this only
 * advances it, so dragging the scrubber mid-play stays authoritative and the
 * URL keeps working the way it does when nothing is playing.
 *
 * Autoplay never starts under `prefers-reduced-motion`. The play button still
 * works if someone presses it; the rule is about motion nobody asked for.
 */

/** Wall-clock seconds a full run takes, whatever window it covers. */
const DEFAULT_RUN_SECONDS = 40;

/** A backgrounded tab hands back one enormous delta. Cap it at a slow frame. */
const MAX_FRAME_SECONDS = 0.1;

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => matchReducedMotion());

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    setReduced(query.matches);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

function matchReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface PlaybackOptions {
  /** Current position, in seconds since the day opened. */
  readonly value: number;
  readonly onChange: (value: number) => void;
  readonly max: number;
  readonly min?: number;
  /** Wall-clock seconds one full run should take. */
  readonly runSeconds?: number;
  readonly loop?: boolean;
  /** Start playing on mount, unless motion is reduced. */
  readonly autoPlay?: boolean;
  /** Nothing to play — the day has not finished loading. */
  readonly disabled?: boolean;
}

export interface Playback {
  readonly playing: boolean;
  readonly play: () => void;
  readonly pause: () => void;
  readonly toggle: () => void;
  /** True when the person asked the system for less motion. */
  readonly reducedMotion: boolean;
}

export function usePlayback(options: PlaybackOptions): Playback {
  const {
    value,
    onChange,
    max,
    min = 0,
    runSeconds = DEFAULT_RUN_SECONDS,
    loop = false,
    autoPlay = false,
    disabled = false,
  } = options;

  const reducedMotion = usePrefersReducedMotion();
  const [playing, setPlaying] = useState(false);

  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  /** The last value this hook emitted, so an outside change is recognisable. */
  const emittedRef = useRef<number | null>(null);

  useEffect(() => {
    valueRef.current = value;
    onChangeRef.current = onChange;
  });

  const play = useCallback(() => setPlaying(true), []);
  const pause = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(() => setPlaying((p) => !p), []);

  useEffect(() => {
    if (disabled) setPlaying(false);
  }, [disabled]);

  useEffect(() => {
    if (!autoPlay || reducedMotion || disabled) return;
    setPlaying(true);
  }, [autoPlay, reducedMotion, disabled]);

  useEffect(() => {
    if (!playing || disabled || max <= min) return;

    const rate = (max - min) / Math.max(0.001, runSeconds); // day-seconds per wall second
    // Pressing play at the end replays the day rather than sitting still.
    let cursor = valueRef.current >= max ? min : valueRef.current;
    let last = performance.now();
    let frame = 0;

    const emit = (next: number) => {
      const rounded = Math.round(next);
      emittedRef.current = rounded;
      onChangeRef.current(rounded);
    };

    const tick = (now: number) => {
      const elapsed = Math.min((now - last) / 1000, MAX_FRAME_SECONDS);
      last = now;

      // Someone dragged the scrubber while it was playing. They win.
      if (emittedRef.current !== null && valueRef.current !== emittedRef.current) {
        cursor = valueRef.current;
      }

      cursor += elapsed * rate;
      if (cursor >= max) {
        if (loop) {
          cursor = min;
        } else {
          emit(max);
          setPlaying(false);
          return;
        }
      }
      emit(cursor);
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      emittedRef.current = null;
    };
  }, [playing, disabled, min, max, runSeconds, loop]);

  return { playing, play, pause, toggle, reducedMotion };
}
