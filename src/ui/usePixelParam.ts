import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { formatPixel, parsePixel, samePixel, type Pixel } from "../core/pixel.ts";
import { liveParams, readableSearch } from "./search.ts";

/**
 * `?px=x,y` holds the drilled cell, so a core sample is a link someone can send.
 *
 * Only a deliberate choice is written — a click, a tap, an arrow key. Hovering
 * shows the sample but leaves the URL alone: a mouse crossing the canvas passes
 * over hundreds of cells, and none of them is a place anyone asked to be.
 */

const PARAM = "px";

export interface PixelParam {
  /** The cell in the URL, or null when none is pinned. */
  readonly selected: Pixel | null;
  /** Pins a cell. `null` clears the selection and drops `?px=` from the URL. */
  readonly select: (pixel: Pixel | null) => void;
}

export function usePixelParam(size: number): PixelParam {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();

  const raw = searchParams.get(PARAM);
  const fromUrl = size > 0 ? parsePixel(raw, size) : null;

  const [pinned, setPinned] = useState<Pixel | null>(fromUrl);
  /** The last value this hook wrote, so navigation is distinguishable from it. */
  const writtenRef = useRef<Pixel | null>(fromUrl);

  const writeRef = useRef({ navigate, pathname: location.pathname, searchParams });
  useEffect(() => {
    writeRef.current = { navigate, pathname: location.pathname, searchParams };
  });

  // Back, forward, or someone else's link replaces whatever is on screen.
  useEffect(() => {
    if (size === 0) return;
    if (samePixel(fromUrl, writtenRef.current)) return;
    writtenRef.current = fromUrl;
    setPinned(fromUrl);
  }, [fromUrl, size]);

  // A `px` this canvas cannot hold — a link to a 256 day opened against a 144
  // one, or plain nonsense — is dropped from the URL rather than left pointing
  // at a cell that is not on screen.
  useEffect(() => {
    if (size === 0 || raw === null || fromUrl !== null) return;
    const { navigate: go, pathname, searchParams: current } = writeRef.current;
    const next = liveParams(current);
    next.delete(PARAM);
    go({ pathname, search: readableSearch(next) }, { replace: true });
  }, [raw, fromUrl, size]);

  const select = useCallback((pixel: Pixel | null) => {
    setPinned(pixel);
    writtenRef.current = pixel;

    const { navigate: go, pathname, searchParams: current } = writeRef.current;
    const next = liveParams(current);
    if (pixel === null) next.delete(PARAM);
    else next.set(PARAM, formatPixel(pixel));

    // Drilling is a lens on the same canvas, not a new place. It survives a
    // reload; it does not deserve a back-button step of its own.
    go({ pathname, search: readableSearch(next) }, { replace: true });
  }, []);

  return { selected: pinned, select };
}
