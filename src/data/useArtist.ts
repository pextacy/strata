// Loading an artist, as React sees it. Rows arrive one day at a time and the
// page shows them as they land — ten canvases is several seconds of rebuilding,
// and a blank screen for that long would be a worse lie than a partial one, as
// long as the partial one says how partial it is.

import { useCallback, useEffect, useState } from "react";

import { DataError, isAbort } from "./client.js";
import {
  REPLAY_DAYS,
  loadArtist,
  newestFirst,
  type ArtistDayGap,
  type ArtistDayRow,
  type ArtistProfile,
  type ArtistProgress,
} from "./artist.js";

export type ArtistState =
  | { readonly status: "idle" }
  | {
      readonly status: "loading";
      readonly address: string;
      readonly progress: ArtistProgress;
      /** What has landed so far, newest first. */
      readonly rows: readonly ArtistDayRow[];
      readonly gaps: readonly ArtistDayGap[];
    }
  | { readonly status: "ready"; readonly address: string; readonly profile: ArtistProfile }
  | {
      readonly status: "failed";
      readonly address: string;
      readonly message: string;
      readonly detail?: string;
    };

export interface ArtistLoad {
  readonly state: ArtistState;
  readonly reload: () => void;
}

/** Pass null for an address that has not been chosen or does not parse. */
export function useArtist(address: string | null): ArtistLoad {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ArtistState>({ status: "idle" });

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (address === null) {
      setState({ status: "idle" });
      return;
    }

    const controller = new AbortController();
    const rows: ArtistDayRow[] = [];
    const gaps: ArtistDayGap[] = [];

    const publish = (progress: ArtistProgress) => {
      if (controller.signal.aborted) return;
      setState({
        status: "loading",
        address,
        progress,
        rows: newestFirst(rows),
        gaps: [...gaps].sort((a, b) => b.day - a.day),
      });
    };

    let progress: ArtistProgress = { phase: "account", done: 0, total: REPLAY_DAYS };
    publish(progress);

    loadArtist(address, {
      signal: controller.signal,
      onProgress: (next) => {
        progress = next;
        publish(next);
      },
      onRow: (row) => {
        rows.push(row);
        publish(progress);
      },
      onGap: (gap) => {
        gaps.push(gap);
        publish(progress);
      },
    })
      .then((profile) => {
        if (controller.signal.aborted) return;
        setState({ status: "ready", address, profile });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbort(error)) return;
        if (error instanceof DataError) {
          setState({ status: "failed", address, message: error.message, detail: error.detail });
        } else {
          setState({
            status: "failed",
            address,
            message: "Strata could not put this artist's record together.",
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      });

    return () => controller.abort();
  }, [address, attempt]);

  return { state, reload };
}
