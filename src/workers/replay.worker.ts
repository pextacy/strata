// Fetch, decode, and replay a day, off the main thread. A heavy day is hundreds
// of thousands of placements; doing this on the main thread drops every frame
// for several seconds. The main thread only ever receives the finished buffers,
// transferred rather than copied.

import { DataError } from "../data/client.ts";
import { PlacementsBuilder, noAnomalies, placementBuffers } from "../core/decode.ts";
import type { Anomalies, Placements } from "../core/decode.ts";
import { concatPlacements, mergeAnomalies } from "../core/placements.ts";
import { dayStats, replay } from "../core/replay.ts";
import { fetchDayStrokes } from "../data/queries.ts";
import type { LoadRequest, ReadyMessage, WorkerRequest, WorkerResponse } from "./protocol.ts";

// lib.dom is what this project compiles against, so the worker global is typed
// by hand instead of pulling in lib.webworker, which redeclares half of it.
interface WorkerScope {
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent<WorkerRequest>) => void): void;
}

const scope = self as unknown as WorkerScope;

scope.addEventListener("message", (event) => {
  void handle(event.data);
});

async function handle(request: WorkerRequest): Promise<void> {
  try {
    const ready = await runLoad(request);
    scope.postMessage(ready, transferables(ready));
  } catch (error) {
    scope.postMessage(describe(request, error));
  }
}

async function runLoad(request: LoadRequest): Promise<ReadyMessage> {
  const { day, size, paletteLength, known, knownLastId } = request;
  const resuming = known !== null && knownLastId !== null;
  const builder = new PlacementsBuilder(size, paletteLength);
  let strokes = 0;

  const { lastId } = await fetchDayStrokes(
    day,
    (items, progress) => {
      for (const stroke of items) builder.addStroke(stroke);
      strokes = progress.strokes;
      scope.postMessage({
        type: "progress",
        requestId: request.requestId,
        day,
        phase: "fetching",
        strokes: progress.strokes,
        pixels: builder.length,
        totalStrokes: progress.totalStrokes,
        pages: progress.page,
        resuming,
      });
    },
    { afterId: resuming && knownLastId !== null ? BigInt(knownLastId) : null },
  );

  const fetched = builder.finish();

  scope.postMessage({
    type: "progress",
    requestId: request.requestId,
    day,
    phase: "replaying",
    strokes: 0,
    pixels: (known?.n ?? 0) + fetched.n,
    totalStrokes: 0,
    pages: 0,
    resuming,
  });

  const placements = known === null ? fetched : concatPlacements(known, fetched);
  const anomalies = mergeAnomalies(request.knownAnomalies ?? noAnomalies(), builder.anomalies);

  return finish(
    request.requestId,
    day,
    size,
    placements,
    anomalies,
    lastId === null ? knownLastId : lastId.toString(),
    strokes,
  );
}

function finish(
  requestId: number,
  day: number,
  size: number,
  placements: Placements,
  anomalies: Anomalies,
  lastId: string | null,
  strokes: number,
): ReadyMessage {
  const layers = replay(placements, size);
  return {
    type: "ready",
    requestId,
    day,
    size,
    placements,
    layers,
    stats: dayStats(layers, placements),
    anomalies,
    lastId,
    strokes,
  };
}

/** Everything sent by reference rather than copied. Roughly 9 MB on a heavy day. */
function transferables(ready: ReadyMessage): Transferable[] {
  const { layers } = ready;
  return [
    ...placementBuffers(ready.placements),
    layers.final.buffer as ArrayBuffer,
    layers.first.buffer as ArrayBuffer,
    layers.buried.buffer as ArrayBuffer,
    layers.depth.buffer as ArrayBuffer,
    layers.lastArtist.buffer as ArrayBuffer,
  ];
}

function describe(request: WorkerRequest, error: unknown): WorkerResponse {
  if (error instanceof DataError) {
    return {
      type: "failed",
      requestId: request.requestId,
      day: request.day,
      kind: error.kind,
      message: error.message,
      detail: error.detail,
    };
  }
  return {
    type: "failed",
    requestId: request.requestId,
    day: request.day,
    kind: "unknown",
    message: `Strata could not rebuild day ${request.day}.`,
    detail: error instanceof Error ? error.message : String(error),
  };
}
