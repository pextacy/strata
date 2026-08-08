import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { liveParams, readableSearch } from "./search.ts";

/**
 * `?t=` holds the moment being looked at, in seconds since the day opened, so
 * every frame of a day is a link someone can send.
 *
 * The URL is not written once per animation frame. Safari rate-limits
 * `replaceState` hard enough to throw during a drag, so the position is held in
 * state — which is what the scrubber renders from, immediately — and pushed
 * into the URL a few times a second, with a final write when the drag ends.
 */

const PARAM = "t";

/** Milliseconds between URL writes while a drag or playback is running. */
const WRITE_INTERVAL_MS = 250;

export interface TimeParam {
  /** Seconds since the day opened. Equals `max` when the URL carries no `?t=`. */
  readonly t: number;
  /** True when no moment is pinned — the canvas as it stands. */
  readonly atEnd: boolean;
  /**
   * Moves the moment. Pass `null` to unpin and go back to the end of the day.
   * `commit` writes the URL immediately; use it when a drag or a key press ends.
   */
  readonly setT: (t: number | null, options?: { readonly commit?: boolean }) => void;
}

export function useTimeParam(max: number): TimeParam {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const fromUrl = parseTime(searchParams.get(PARAM), max);

  const [pinned, setPinned] = useState<number | null>(fromUrl);

  /** The last value written to the URL, so a back button is distinguishable. */
  const writtenRef = useRef<number | null>(fromUrl);
  const pendingRef = useRef<number | null>(null);
  const hasPendingRef = useRef(false);
  const lastWriteAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const writeRef = useRef({ navigate, pathname: location.pathname, searchParams });
  useEffect(() => {
    writeRef.current = { navigate, pathname: location.pathname, searchParams };
  });

  const write = useCallback((value: number | null) => {
    writtenRef.current = value;
    hasPendingRef.current = false;
    lastWriteAtRef.current = performance.now();

    const { navigate: go, pathname, searchParams: current } = writeRef.current;
    const next = liveParams(current);
    if (value === null) next.delete(PARAM);
    else next.set(PARAM, String(value));
    // Through `navigate` rather than `setSearchParams`, so a pixel already in
    // the query keeps the comma it was written with.
    go({ pathname, search: readableSearch(next) }, { replace: true });
  }, []);

  // Navigation — back, forward, or a link — replaces whatever is on screen.
  useEffect(() => {
    if (fromUrl === writtenRef.current) return;
    writtenRef.current = fromUrl;
    hasPendingRef.current = false;
    setPinned(fromUrl);
  }, [fromUrl]);

  // A moment the day does not have — `t=99999` on a finished day, or `t=abc` —
  // is corrected in the address bar rather than left there naming a frame that
  // is not on screen. This is the same rule `?mode=` and `?px=` follow.
  const raw = searchParams.get(PARAM);
  useEffect(() => {
    if (raw === null) return;
    if (raw === (fromUrl === null ? null : String(fromUrl))) return;
    write(fromUrl);
  }, [raw, fromUrl, write]);

  const setT = useCallback(
    (value: number | null, options?: { readonly commit?: boolean }) => {
      const next = value === null ? null : clamp(Math.round(value), 0, max);
      setPinned(next);

      pendingRef.current = next;
      hasPendingRef.current = true;

      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      const since = performance.now() - lastWriteAtRef.current;
      if (options?.commit === true || since >= WRITE_INTERVAL_MS) {
        write(next);
        return;
      }
      // Trailing write, so the URL always ends up on the moment being shown.
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (hasPendingRef.current) write(pendingRef.current);
      }, WRITE_INTERVAL_MS - since);
    },
    [max, write],
  );

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  return {
    t: pinned === null ? max : clamp(pinned, 0, max),
    atEnd: pinned === null,
    setT,
  };
}

/** A `t` that is not a number in range is treated as absent, not as zero. */
function parseTime(raw: string | null, max: number): number | null {
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return clamp(Math.round(value), 0, max);
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
