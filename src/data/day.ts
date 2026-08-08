// One day, ready to draw: theme, placements, replay buffers, stats. Three paths
// arrive here — memory, IndexedDB, and the indexer — and only the last one costs
// anything. Nothing in this file decides what a day looks like; it decides how
// fast it turns up.

import { get as idbGet, set as idbSet } from "idb-keyval";

import type { Anomalies, Placements } from "../core/decode.ts";
import { isDayOpen } from "../core/day-math.ts";
import type { DayStats, Layers } from "../core/replay.ts";
import { toRgba } from "../render/palette.ts";
import type {
  FailedMessage,
  LoadPhase,
  ProgressMessage,
  ReadyMessage,
  WorkerRequest,
  WorkerResponse,
} from "../workers/protocol.ts";
import { DataError } from "./client.ts";
import { fetchTheme, type Theme } from "./theme.ts";

/** Bump this whenever the decoder or the cached shape changes. */
export const CACHE_VERSION = 1;

export const cacheKey = (day: number): string => `day:${day}:v${CACHE_VERSION}`;

/** How many days stay in memory. A 256×256 heavy day is roughly 9 MB of buffers. */
const MEMORY_DAYS = 3;

export type DaySource = "memory" | "cache" | "network";

export interface DayData {
  readonly day: number;
  readonly theme: Theme;
  readonly size: number;
  readonly palette: readonly string[];
  /** Palette as packed pixels, ready for the render pass. */
  readonly rgba: Uint32Array;
  readonly placements: Placements;
  readonly layers: Layers;
  readonly stats: DayStats;
  readonly anomalies: Anomalies;
  readonly lastId: string | null;
  /** True while the day is still being painted. Its canvas is not final. */
  readonly open: boolean;
  readonly source: DaySource;
}

export type DayPhase = "theme" | "cache" | LoadPhase;

export interface DayProgress {
  readonly phase: DayPhase;
  readonly strokes: number;
  readonly pixels: number;
  readonly totalStrokes: number;
  readonly pages: number;
  readonly resuming: boolean;
}

export interface LoadDayOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: DayProgress) => void;
  /** Skip the memory hit and ask the indexer again. What a retry button does. */
  readonly refresh?: boolean;
}

const start = (phase: DayPhase, resuming = false): DayProgress => ({
  phase,
  strokes: 0,
  pixels: 0,
  totalStrokes: 0,
  pages: 0,
  resuming,
});

export const initialProgress = (): DayProgress => start("theme");

const memory = new Map<number, DayData>();

/** Drops everything held for a day. Used by tests and by the retry path. */
export function forgetDay(day: number): void {
  memory.delete(day);
}

export async function loadDay(day: number, options: LoadDayOptions = {}): Promise<DayData> {
  const { signal, onProgress, refresh = false } = options;
  const open = isDayOpen(day);

  const held = memory.get(day);
  if (held !== undefined && !refresh && !open) {
    // A closed day never changes. Nothing to ask anyone.
    return remember({ ...held, source: "memory" });
  }

  onProgress?.(start("theme"));
  const theme = await fetchTheme(day, { signal });
  throwIfAborted(signal);

  let request: WorkerRequest;
  let source: Exclude<DaySource, "memory">;

  if (held !== undefined && open) {
    // Today, revisited: keep what we have and ask only for the strokes after it.
    request = {
      type: "load",
      requestId: nextRequestId(),
      day,
      size: theme.size,
      paletteLength: theme.palette.length,
      known: held.placements,
      knownAnomalies: held.anomalies,
      knownLastId: held.lastId,
    };
    source = "network";
  } else {
    const cached = open || refresh ? null : await readCache(day, theme.size);
    throwIfAborted(signal);
    if (cached !== null) {
      onProgress?.(start("cache"));
      request = {
        type: "replay",
        requestId: nextRequestId(),
        day,
        size: theme.size,
        placements: cached.placements,
        anomalies: cached.anomalies,
        lastId: cached.lastId,
      };
      source = "cache";
    } else {
      request = {
        type: "load",
        requestId: nextRequestId(),
        day,
        size: theme.size,
        paletteLength: theme.palette.length,
        known: null,
        knownAnomalies: null,
        knownLastId: null,
      };
      source = "network";
    }
  }

  const ready = await runWorker(request, signal, (progress) => {
    onProgress?.({
      phase: progress.phase,
      strokes: progress.strokes,
      pixels: progress.pixels,
      totalStrokes: progress.totalStrokes,
      pages: progress.pages,
      resuming: progress.resuming,
    });
  });

  const data: DayData = {
    day,
    theme,
    size: theme.size,
    palette: theme.palette,
    rgba: toRgba(theme.palette),
    placements: ready.placements,
    layers: ready.layers,
    stats: ready.stats,
    anomalies: ready.anomalies,
    lastId: ready.lastId,
    open,
    source,
  };

  // Only finished days are worth keeping on disk — today's canvas is a moving
  // target, and a stale copy of it would be a lie the next visitor believes.
  if (!open && source === "network" && data.placements.n > 0) {
    void writeCache(data);
  }

  return remember(data);
}

function remember(data: DayData): DayData {
  memory.delete(data.day);
  memory.set(data.day, data);
  while (memory.size > MEMORY_DAYS) {
    const oldest = memory.keys().next();
    if (oldest.done === true) break;
    memory.delete(oldest.value);
  }
  return data;
}

// --- IndexedDB ---------------------------------------------------------------

interface CachedDay {
  readonly version: number;
  readonly day: number;
  readonly size: number;
  readonly placements: Placements;
  readonly anomalies: Anomalies;
  readonly lastId: string | null;
}

/**
 * A cache read never fails the page. Private-mode browsers, a full disk, and a
 * changed schema all mean the same thing here: fetch it again.
 */
async function readCache(day: number, size: number): Promise<CachedDay | null> {
  let record: CachedDay | undefined;
  try {
    record = await idbGet<CachedDay>(cacheKey(day));
  } catch {
    return null;
  }
  if (record === undefined) return null;
  if (record.version !== CACHE_VERSION || record.day !== day || record.size !== size) return null;
  if (typeof record.placements !== "object" || record.placements === null) return null;
  return record;
}

async function writeCache(data: DayData): Promise<void> {
  const record: CachedDay = {
    version: CACHE_VERSION,
    day: data.day,
    size: data.size,
    placements: data.placements,
    anomalies: data.anomalies,
    lastId: data.lastId,
  };
  try {
    await idbSet(cacheKey(data.day), record);
  } catch {
    // Storage is a nicety. The day is already on screen.
  }
}

// --- worker ------------------------------------------------------------------

let requestCounter = 0;
const nextRequestId = (): number => ++requestCounter;

/**
 * One worker per load, terminated when the load ends. Cancellation is then the
 * only thing it can be — the fetch, the decode, and the replay all stop at once,
 * which matters when someone types day numbers faster than a heavy day loads.
 */
function runWorker(
  request: WorkerRequest,
  signal: AbortSignal | undefined,
  onProgress: (progress: ProgressMessage) => void,
): Promise<ReadyMessage> {
  return new Promise<ReadyMessage>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(signal.reason);
      return;
    }

    const worker = new Worker(new URL("../workers/replay.worker.ts", import.meta.url), {
      type: "module",
      name: `strata-replay-${request.day}`,
    });

    const done = (): void => {
      signal?.removeEventListener("abort", onAbort);
      worker.terminate();
    };

    const onAbort = (): void => {
      done();
      reject(signal?.reason);
    };

    worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.requestId !== request.requestId) return;
      if (message.type === "progress") {
        onProgress(message);
        return;
      }
      done();
      if (message.type === "ready") resolve(message);
      else reject(new DataError(kindOf(message.kind), message.message, message.detail));
    });

    worker.addEventListener("error", (event: ErrorEvent) => {
      done();
      reject(
        new DataError(
          "shape",
          `Strata could not start the replay for day ${request.day}.`,
          event.message,
        ),
      );
    });

    signal?.addEventListener("abort", onAbort, { once: true });
    // No transfer list: the caller keeps its copy of the placements it sent.
    worker.postMessage(request);
  });
}

const kindOf = (kind: FailedMessage["kind"]): DataError["kind"] =>
  kind === "network" || kind === "http" || kind === "graphql" ? kind : "shape";

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw signal.reason;
}
