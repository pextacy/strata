// Loading a day, as React sees it. Four states and nothing in between: idle,
// loading with a real count, ready, or failed with a sentence and a retry.

import { useCallback, useEffect, useState } from "react";

import { DataError, isAbort } from "./client.ts";
import { initialProgress, loadDay, type DayData, type DayProgress } from "./day.ts";

export type DayState =
  | { readonly status: "idle" }
  | { readonly status: "loading"; readonly day: number; readonly progress: DayProgress }
  | { readonly status: "ready"; readonly day: number; readonly data: DayData }
  | {
      readonly status: "failed";
      readonly day: number;
      readonly message: string;
      readonly detail?: string;
    };

export interface DayLoad {
  readonly state: DayState;
  /** Refetches from the indexer rather than reusing what is held. */
  readonly reload: () => void;
}

/** Pass null for a day that has not been chosen or does not parse. */
export function useDay(day: number | null): DayLoad {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<DayState>({ status: "idle" });

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (day === null) {
      setState({ status: "idle" });
      return;
    }

    const controller = new AbortController();
    setState({ status: "loading", day, progress: initialProgress() });

    loadDay(day, {
      signal: controller.signal,
      refresh: attempt > 0,
      onProgress: (progress) => {
        if (controller.signal.aborted) return;
        setState((current) =>
          current.status === "loading" && current.day === day
            ? { status: "loading", day, progress }
            : current,
        );
      },
    })
      .then((data) => {
        if (controller.signal.aborted) return;
        setState({ status: "ready", day, data });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbort(error)) return;
        if (error instanceof DataError) {
          setState({ status: "failed", day, message: error.message, detail: error.detail });
        } else {
          setState({
            status: "failed",
            day,
            message: `Strata could not rebuild day ${day}.`,
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      });

    return () => controller.abort();
  }, [day, attempt]);

  return { state, reload };
}
