// The contract between the main thread and the replay worker. Kept in its own
// module so both sides import the same types and neither imports the other.

import type { Anomalies, Placements } from "../core/decode.js";
import type { DayStats, Layers } from "../core/replay.js";
import type { FailureKind } from "../data/client.js";

/** Fetch the day (optionally resuming), decode, replay. */
export interface LoadRequest {
  readonly type: "load";
  readonly requestId: number;
  readonly day: number;
  readonly size: number;
  readonly paletteLength: number;
  /** Placements already held for this day, or null for a cold load. */
  readonly known: Placements | null;
  readonly knownAnomalies: Anomalies | null;
  /** Last stroke id already held. The fetch resumes strictly after it. */
  readonly knownLastId: string | null;
}

/**
 * The worker exists for one job: fetching and decoding hundreds of thousands of
 * strokes without dropping a frame. Replaying placements that are already
 * decoded is four milliseconds of arithmetic and stays on the main thread, where
 * it costs less than starting a worker to do it.
 */
export type WorkerRequest = LoadRequest;

export type LoadPhase = "fetching" | "replaying";

export interface ProgressMessage {
  readonly type: "progress";
  readonly requestId: number;
  readonly day: number;
  readonly phase: LoadPhase;
  /** Strokes read from the indexer so far in this request. */
  readonly strokes: number;
  /** Placements decoded so far in this request. */
  readonly pixels: number;
  /** Strokes this request expects in total, from the indexer's own count. */
  readonly totalStrokes: number;
  readonly pages: number;
  /** True when this is a top-up of a day already partly held. */
  readonly resuming: boolean;
}

export interface ReadyMessage {
  readonly type: "ready";
  readonly requestId: number;
  readonly day: number;
  readonly size: number;
  readonly placements: Placements;
  readonly layers: Layers;
  readonly stats: DayStats;
  readonly anomalies: Anomalies;
  /** Highest stroke id held, so the next visit can resume from it. */
  readonly lastId: string | null;
  /** Strokes fetched in this request. Zero on a pure cache replay. */
  readonly strokes: number;
}

export interface FailedMessage {
  readonly type: "failed";
  readonly requestId: number;
  readonly day: number;
  readonly kind: FailureKind | "decode" | "unknown";
  /** Written for a person to read. */
  readonly message: string;
  readonly detail?: string;
}

export type WorkerResponse = ProgressMessage | ReadyMessage | FailedMessage;
