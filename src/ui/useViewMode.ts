import { useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import {
  DEFAULT_VIEW_MODE,
  isViewMode,
  readViewMode,
  type ViewMode,
} from "../render/layers.ts";
import { liveParams, readableSearch } from "./search.ts";

/**
 * `?mode=` holds which of the four ways of reading a day is on screen.
 *
 * Final is the default, so it stays out of the query and the plain `/day/500`
 * link keeps working as the canonical one. A mode is a lens on the same canvas,
 * not a new place: it survives a reload but does not deserve a back-button step.
 */

const PARAM = "mode";

export interface ViewModeParam {
  readonly mode: ViewMode;
  readonly setMode: (mode: ViewMode) => void;
}

export function useViewMode(): ViewModeParam {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();

  const raw = searchParams.get(PARAM);
  const mode = readViewMode(raw);

  const writeRef = useRef({ navigate, pathname: location.pathname, searchParams });
  useEffect(() => {
    writeRef.current = { navigate, pathname: location.pathname, searchParams };
  });

  const write = useCallback((value: ViewMode | null) => {
    const { navigate: go, pathname, searchParams: current } = writeRef.current;
    const next = liveParams(current);
    if (value === null) next.delete(PARAM);
    else next.set(PARAM, value);
    go({ pathname, search: readableSearch(next) }, { replace: true });
  }, []);

  // A mode nobody recognises is dropped rather than left in the URL pointing at
  // a view that is not on screen.
  useEffect(() => {
    if (raw === null || isViewMode(raw)) return;
    write(null);
  }, [raw, write]);

  const setMode = useCallback(
    (next: ViewMode) => write(next === DEFAULT_VIEW_MODE ? null : next),
    [write],
  );

  return { mode, setMode };
}
