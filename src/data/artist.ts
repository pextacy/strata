// One artist's record. The indexer knows their lifetime totals; it does not know
// what survived, because nobody has ever replayed the days to find out. That is
// the number this file exists to produce, and producing it means rebuilding whole
// canvases — so the scope is bounded, streamed, and stated in words on screen.

import {
  aggregateSurvival,
  artistDaySurvival,
  emptyLifetime,
  type ArtistDaySurvival,
  type LifetimeSurvival,
} from "../core/survival.js";
import { checksumAddress } from "./address.js";
import { DataError, isAbort } from "./client.js";
import { loadDay } from "./day.js";
import { fetchAccount, fetchArtistDays, type AccountRecord } from "./queries.js";

/** How many of an artist's most recent days Strata replays. */
export const REPLAY_DAYS = 10;

/**
 * Days rebuilt at once. Each one is a worker, a page of strokes, and a few MB of
 * buffers; three keeps the page filling in without three seconds of nothing.
 */
const CONCURRENCY = 3;

export interface ArtistDayRow {
  readonly day: number;
  readonly theme: string;
  /** Pixels the indexer credits them with that day, beside what the replay found. */
  readonly reportedPixels: number;
  readonly record: ArtistDaySurvival;
}

/** A day the indexer lists but the replay could not account for. Never hidden. */
export interface ArtistDayGap {
  readonly day: number;
  readonly reason: string;
}

export interface ArtistProgress {
  readonly phase: "account" | "replaying";
  readonly done: number;
  readonly total: number;
}

export interface ArtistProfile {
  /** Checksummed, which is the only form the indexer answers to. */
  readonly address: string;
  readonly account: AccountRecord | null;
  /** Days the indexer says they have painted, ever. */
  readonly totalDays: number;
  /** The days Strata asked for, newest first. */
  readonly requested: readonly number[];
  readonly rows: readonly ArtistDayRow[];
  readonly gaps: readonly ArtistDayGap[];
  readonly lifetime: LifetimeSurvival;
}

export interface LoadArtistOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: ArtistProgress) => void;
  /** Called as each day lands, so the page fills in rather than waiting. */
  readonly onRow?: (row: ArtistDayRow) => void;
  readonly onGap?: (gap: ArtistDayGap) => void;
  readonly days?: number;
}

export function newestFirst(rows: readonly ArtistDayRow[]): ArtistDayRow[] {
  return [...rows].sort((a, b) => b.day - a.day);
}

export async function loadArtist(
  rawAddress: string,
  options: LoadArtistOptions = {},
): Promise<ArtistProfile> {
  const { signal, onProgress, onRow, onGap, days = REPLAY_DAYS } = options;

  const address = checksumAddress(rawAddress);
  if (address === null) {
    throw new DataError(
      "shape",
      `“${rawAddress}” is not an Ethereum address. Strata expects the 42-character form beginning 0x.`,
    );
  }

  onProgress?.({ phase: "account", done: 0, total: days });

  // The indexer stores accountId checksummed and returns nothing at all for a
  // lowercased one, so this is the only spelling that works.
  const [account, contributions] = await Promise.all([
    fetchAccount(address, { signal }),
    fetchArtistDays(address, days, { signal }),
  ]);

  const requested = contributions.days.map((d) => d.canvasId);
  const reported = new Map(contributions.days.map((d) => [d.canvasId, d.pixelsCount]));

  if (requested.length === 0) {
    return {
      address,
      account,
      totalDays: contributions.totalDays,
      requested,
      rows: [],
      gaps: [],
      lifetime: emptyLifetime(),
    };
  }

  const rows: ArtistDayRow[] = [];
  const gaps: ArtistDayGap[] = [];
  let done = 0;

  onProgress?.({ phase: "replaying", done, total: requested.length });

  await pool(requested, CONCURRENCY, async (day) => {
    try {
      const data = await loadDay(day, { signal });
      const record = artistDaySurvival(data.placements, data.layers, data.size, address);
      if (record === null) {
        // The indexer credits them with pixels the replay cannot find. That
        // happens when every one of them was off-canvas or named a colour the
        // day does not have, and it is worth saying rather than swallowing.
        const gap: ArtistDayGap = {
          day,
          reason: "the replay found no pixels from this address",
        };
        gaps.push(gap);
        onGap?.(gap);
      } else {
        const row: ArtistDayRow = {
          day,
          theme: data.theme.theme,
          reportedPixels: reported.get(day) ?? 0,
          record,
        };
        rows.push(row);
        onRow?.(row);
      }
    } catch (error) {
      if (isAbort(error)) throw error;
      const gap: ArtistDayGap = {
        day,
        reason: error instanceof DataError ? error.message : "the day could not be rebuilt",
      };
      gaps.push(gap);
      onGap?.(gap);
    } finally {
      done++;
      onProgress?.({ phase: "replaying", done, total: requested.length });
    }
  });

  const ordered = newestFirst(rows);

  return {
    address,
    account,
    totalDays: contributions.totalDays,
    requested,
    rows: ordered,
    gaps: [...gaps].sort((a, b) => b.day - a.day),
    lifetime: aggregateSurvival(ordered.map((row) => row.record)),
  };
}

/** Runs `task` over `items` with at most `limit` in flight. Order is not kept. */
async function pool<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      await task(items[index]);
    }
  });
  await Promise.all(runners);
}
