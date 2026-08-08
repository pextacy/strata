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

export interface GqlOptions {
  signal?: AbortSignal;
  /** Attempts on a network or 5xx failure, including the first. */
  attempts?: number;
  endpoint?: string;
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
  const { signal, attempts = 3, endpoint = INDEXER } = options;
  let lastError: DataError | undefined;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await delay(250 * 2 ** (attempt - 1), signal);

    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, variables }),
        signal,
      });
    } catch (err) {
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
  }

  throw lastError ?? new DataError("network", "Could not reach the BasePaint indexer.");
}

export async function getJson<T>(url: string, options: GqlOptions = {}): Promise<T> {
  const { signal, attempts = 3 } = options;
  let lastError: DataError | undefined;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await delay(250 * 2 ** (attempt - 1), signal);
    let res: Response;
    try {
      res = await fetch(url, { signal });
    } catch (err) {
      if (isAbort(err)) throw err;
      lastError = new DataError(
        "network",
        `Could not reach ${new URL(url).host}.`,
        String(err instanceof Error ? err.message : err),
      );
      continue;
    }
    if (!res.ok) {
      const detail = `${res.status} ${res.statusText}`;
      if (res.status >= 500 || res.status === 429) {
        lastError = new DataError("http", `${new URL(url).host} is not answering.`, detail);
        continue;
      }
      throw new DataError("http", `${new URL(url).host} returned ${res.status}.`, detail);
    }
    try {
      return (await res.json()) as T;
    } catch (err) {
      throw new DataError(
        "shape",
        `${new URL(url).host} sent something that is not JSON.`,
        String(err instanceof Error ? err.message : err),
      );
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
