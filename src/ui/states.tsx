// Loading, empty, and error states, written once and shared by every page.
//
// The rule from CLAUDE.md: a spinner with no information is not a loading
// state. Every line here names what is happening, how far along it is, or what
// the person can do next — in plain words, not in interface English.

import type { ReactNode } from "react";

import type { DayProgress } from "../data/day.ts";
import "../styles/states.css";

const count = new Intl.NumberFormat("en-US");

export interface LoadingDayProps {
  readonly day: number;
  readonly progress: DayProgress;
}

/** What Strata is doing right now, with the count it has reached. */
export function LoadingDay({ day, progress }: LoadingDayProps) {
  const { phase, strokes, pixels, totalStrokes, resuming } = progress;
  const known = totalStrokes > 0;

  return (
    <div className="state state-busy" role="status">
      <p className="state-line">{loadingLine(day, progress)}</p>
      {phase === "fetching" && known && (
        <progress className="state-bar" value={Math.min(strokes, totalStrokes)} max={totalStrokes} />
      )}
      {phase !== "theme" && pixels > 0 && (
        <p className="state-sub">{count.format(pixels)} pixels stacked so far.</p>
      )}
      {resuming && <p className="state-sub">Only the strokes newer than the copy held here.</p>}
    </div>
  );
}

/** The sentence on its own, for places that have no room for the bar. */
function loadingLine(day: number, progress: DayProgress): string {
  const { phase, strokes, pixels, totalStrokes, resuming } = progress;
  switch (phase) {
    case "theme":
      return `Asking basepaint.xyz for the day ${day} palette…`;
    case "cache":
      return `Rebuilding day ${day} from the copy stored on this device…`;
    case "replaying":
      return `Stacking ${count.format(pixels)} placements in the order the chain wrote them…`;
    case "fetching":
      return resuming
        ? `Catching up on today's canvas — ${count.format(strokes)} new strokes read.`
        : `Reading the chain — ${count.format(strokes)}${
            totalStrokes > 0 ? ` of ${count.format(totalStrokes)}` : ""
          } strokes decoded.`;
  }
}

export interface FailureProps {
  /** What failed, in a sentence. */
  readonly message: string;
  /** The underlying detail, kept quiet but never hidden. */
  readonly detail?: string;
  readonly onRetry?: () => void;
  readonly retryLabel?: string;
  /** Anything else worth offering — a link elsewhere, usually. */
  readonly children?: ReactNode;
}

export function Failure({
  message,
  detail,
  onRetry,
  retryLabel = "Try again",
  children,
}: FailureProps) {
  return (
    <div className="state state-bad" role="alert">
      <p className="state-line">{message}</p>
      {onRetry !== undefined && (
        <p className="state-actions">
          <button type="button" className="state-button" onClick={onRetry}>
            {retryLabel}
          </button>
          {children}
        </p>
      )}
      {onRetry === undefined && children !== undefined && (
        <p className="state-actions">{children}</p>
      )}
      {detail !== undefined && detail !== "" && <p className="state-detail">{detail}</p>}
    </div>
  );
}

export interface NothingProps {
  /** What is not there, said plainly. "Nothing survived here." */
  readonly children: ReactNode;
  readonly onRetry?: () => void;
  readonly retryLabel?: string;
}

export function Nothing({ children, onRetry, retryLabel = "Check again" }: NothingProps) {
  return (
    <div className="state state-empty" role="status">
      <p className="state-line">{children}</p>
      {onRetry !== undefined && (
        <p className="state-actions">
          <button type="button" className="state-button" onClick={onRetry}>
            {retryLabel}
          </button>
        </p>
      )}
    </div>
  );
}
