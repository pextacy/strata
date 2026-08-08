// The only transport this app has. Every failure it can produce is named, so a
// UI can say what broke instead of showing a spinner that never resolves.

export const INDEXER = "https://graphql.basepaint.xyz";

export type FailureKind = "network" | "http" | "graphql" | "shape";

export class DataError extends Error {
  readonly kind: FailureKind;
  /** The technical detail, for the console. The message is what a person reads. */
  readonly detail?: string;

  constructor(kind: FailureKind, message: string, detail?: string) {
    super(message);
    this.name = "DataError";
    this.kind = kind;
    this.detail = detail;
  }
}

/**
 * How long one attempt may take before it is abandoned and retried.
 *
 * Without this a connection that opens and then says nothing hangs forever.
 * `fetch` has no timeout of its own, and neither end of this app could survive
 * one: in the browser the page keeps "Reading the chain — 0 strokes decoded" on
 * screen until somebody reloads, which is exactly the spinner-that-tells-you-
 * nothing this project refuses to ship; in a serverless function it holds the
 * invocation open until the platform kills it and bills for the whole of it.
 *
 * Fifteen seconds is far past any healthy response — the heaviest day there has
 * ever been comes back in about a second — and short enough that the retry below
 * still has room to work.
 */
export const REQUEST_TIMEOUT_MS = 15_000;

export interface GqlOptions {
  signal?: AbortSignal;
  /** Attempts on a network or 5xx failure, including the first. */
  attempts?: number;
  endpoint?: string;
  /** Milliseconds one attempt may take. Zero or Infinity waits forever. */
  timeoutMs?: number;
}

/**
 * The caller's signal and a deadline, as one signal.
 *
 * Composed by hand rather than with `AbortSignal.any`, which is younger than the
 * browsers this otherwise runs in. `expired()` distinguishes the two reasons the
 * signal can fire, because they are not the same event: a deadline is worth
 * retrying and saying out loud, and the caller navigating away is worth neither.
 */
function deadline(outer: AbortSignal | undefined, ms: number) {
  const controller = new AbortController();
  let expired = false;

  const onOuter = (): void => controller.abort(outer?.reason);
  if (outer !== undefined) {
    if (outer.aborted) controller.abort(outer.reason);
    else outer.addEventListener("abort", onOuter, { once: true });
  }

  const timer =
    Number.isFinite(ms) && ms > 0
      ? setTimeout(() => {
          expired = true;
          controller.abort();
        }, ms)
      : undefined;

  return {
    signal: controller.signal,
    /** True when this attempt ran out of time rather than being called off. */
    expired: () => expired,
    done: (): void => {
      if (timer !== undefined) clearTimeout(timer);
      outer?.removeEventListener("abort", onOuter);
    },
  };
}

interface GqlResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

export async function gql<T>(
  query: string,
  variables: Record<string, unknown>,
  options: GqlOptions = {},
): Promise<T> {
  const {
    signal,
    attempts = 3,
    endpoint = INDEXER,
    timeoutMs = REQUEST_TIMEOUT_MS,
  } = options;
  let lastError: DataError | undefined;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await delay(250 * 2 ** (attempt - 1), signal);

    // The deadline covers reading the body as well as getting the headers.
    // Aborting the signal errors the response stream, so an indexer that sends
    // a 200 and then stops mid-JSON is caught by the same clock.
    const clock = deadline(signal, timeoutMs);
    try {
      let res: Response;
      try {
        res = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query, variables }),
          signal: clock.signal,
        });
      } catch (err) {
        if (clock.expired()) {
          lastError = new DataError(
            "network",
            "The BasePaint indexer did not answer in time.",
            `no response within ${timeoutMs} ms`,
          );
          continue;
        }
        if (isAbort(err)) throw err;
        lastError = new DataError(
          "network",
          "Could not reach the BasePaint indexer.",
          String(err instanceof Error ? err.message : err),
        );
        continue;
      }

      if (!res.ok) {
        const detail = `${res.status} ${res.statusText}`;
        if (res.status >= 500 || res.status === 429) {
          lastError = new DataError("http", "The BasePaint indexer is not answering.", detail);
          continue;
        }
        throw new DataError("http", "The BasePaint indexer rejected the request.", detail);
      }

      let body: GqlResponse<T>;
      try {
        body = (await res.json()) as GqlResponse<T>;
      } catch (err) {
        if (clock.expired()) {
          lastError = new DataError(
            "network",
            "The BasePaint indexer stopped partway through its answer.",
            `body not finished within ${timeoutMs} ms`,
          );
          continue;
        }
        if (isAbort(err)) throw err;
        throw new DataError(
          "shape",
          "The indexer sent something that is not JSON.",
          String(err instanceof Error ? err.message : err),
        );
      }

      if (body.errors?.length) {
        throw new DataError(
          "graphql",
          "The indexer refused this query. The schema may have moved — re-run npm run introspect.",
          body.errors.map((e) => e.message).join("; "),
        );
      }
      if (!body.data) {
        throw new DataError("shape", "The indexer answered with no data.");
      }
      return body.data;
    } finally {
      clock.done();
    }
  }

  throw lastError ?? new DataError("network", "Could not reach the BasePaint indexer.");
}

export async function getJson<T>(url: string, options: GqlOptions = {}): Promise<T> {
  const { signal, attempts = 3, timeoutMs = REQUEST_TIMEOUT_MS } = options;
  const host = new URL(url).host;
  let lastError: DataError | undefined;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await delay(250 * 2 ** (attempt - 1), signal);

    const clock = deadline(signal, timeoutMs);
    try {
      let res: Response;
      try {
        res = await fetch(url, { signal: clock.signal });
      } catch (err) {
        if (clock.expired()) {
          lastError = new DataError(
            "network",
            `${host} did not answer in time.`,
            `no response within ${timeoutMs} ms`,
          );
          continue;
        }
        if (isAbort(err)) throw err;
        lastError = new DataError(
          "network",
          `Could not reach ${host}.`,
          String(err instanceof Error ? err.message : err),
        );
        continue;
      }
      if (!res.ok) {
        const detail = `${res.status} ${res.statusText}`;
        if (res.status >= 500 || res.status === 429) {
          lastError = new DataError("http", `${host} is not answering.`, detail);
          continue;
        }
        throw new DataError("http", `${host} returned ${res.status}.`, detail);
      }
      try {
        return (await res.json()) as T;
      } catch (err) {
        if (clock.expired()) {
          lastError = new DataError(
            "network",
            `${host} stopped partway through its answer.`,
            `body not finished within ${timeoutMs} ms`,
          );
          continue;
        }
        if (isAbort(err)) throw err;
        throw new DataError(
          "shape",
          `${host} sent something that is not JSON.`,
          String(err instanceof Error ? err.message : err),
        );
      }
    } finally {
      clock.done();
    }
  }
  throw lastError ?? new DataError("network", `Could not reach ${url}.`);
}

export const isAbort = (err: unknown): boolean =>
  err instanceof DataError === false &&
  typeof err === "object" &&
  err !== null &&
  "name" in err &&
  (err as { name?: unknown }).name === "AbortError";

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
