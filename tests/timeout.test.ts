import { afterEach, describe, expect, it, vi } from "vitest";

import { DataError, REQUEST_TIMEOUT_MS, getJson, gql, isAbort } from "../src/data/client.ts";

/**
 * What happens when the other end opens a connection and then says nothing.
 *
 * `fetch` has no timeout of its own, so before this every request in the app
 * could wait forever. In the browser that meant the loading state — the one this
 * project is careful to fill with a real stroke count — sat there counting
 * nothing until somebody reloaded the tab. In a serverless function it meant
 * holding the invocation open until the platform killed it and billed for all of
 * it. Neither failure looks like a failure from the outside, which is why it
 * survived four passes over this code.
 *
 * The timeouts here are tiny so the suite stays fast; the real one is fifteen
 * seconds.
 */

/** A fetch that never settles until the signal it was handed says to stop. */
const hangs = () =>
  vi.fn(
    (_input: unknown, init?: { signal?: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal === undefined) return; // no signal: hangs forever, as it used to
        if (signal.aborted) return reject(abortError());
        signal.addEventListener("abort", () => reject(abortError()), { once: true });
      }),
  );

/** What a real fetch rejects with when its signal fires. */
function abortError(): Error {
  const error = new Error("This operation was aborted");
  error.name = "AbortError";
  return error;
}

/** Headers arrive, then the body stalls — a 200 that never finishes. */
const stallsMidBody = () =>
  vi.fn(
    async (_input: unknown, init?: { signal?: AbortSignal }) =>
      ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(abortError()), { once: true });
          }),
      }) as unknown as Response,
  );

describe("a request that never answers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("gives up on the indexer instead of waiting forever", async () => {
    const fetchMock = hangs();
    vi.stubGlobal("fetch", fetchMock);

    const failure = await gql("{ x }", {}, { attempts: 1, timeoutMs: 20 }).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(DataError);
    expect((failure as DataError).kind).toBe("network");
    expect((failure as DataError).message).toContain("did not answer in time");
    expect((failure as DataError).detail).toContain("20 ms");
  });

  it("gives up on the theme endpoint too, and names the host", async () => {
    vi.stubGlobal("fetch", hangs());

    const failure = await getJson("https://basepaint.xyz/api/theme/500", {
      attempts: 1,
      timeoutMs: 20,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DataError);
    expect((failure as DataError).message).toBe("basepaint.xyz did not answer in time.");
  });

  it("treats running out of time as worth retrying", async () => {
    // A stall is usually one bad connection, not a dead service — the retry that
    // already existed for a network blip is the right response to it.
    const fetchMock = hangs();
    vi.stubGlobal("fetch", fetchMock);

    await gql("{ x }", {}, { attempts: 3, timeoutMs: 10 }).catch(() => {});
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("catches a body that stops halfway, not just headers that never come", async () => {
    // The deadline has to outlive the headers. An indexer that answers 200 and
    // then stops mid-JSON would otherwise hang exactly as before.
    vi.stubGlobal("fetch", stallsMidBody());

    const failure = await gql("{ x }", {}, { attempts: 1, timeoutMs: 20 }).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(DataError);
    expect((failure as DataError).message).toContain("stopped partway");
  });
});

describe("the caller's own signal", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * Navigating away is not a failure and must not be reported as one. The two
   * reasons the request can be called off arrive as the same event, which is why
   * the deadline tracks which one fired rather than reading it back off the
   * error.
   */
  it("still calls a request off, and is not mistaken for a timeout", async () => {
    vi.stubGlobal("fetch", hangs());
    const controller = new AbortController();

    const pending = gql("{ x }", {}, { signal: controller.signal, timeoutMs: 10_000 }).catch(
      (error: unknown) => error,
    );
    controller.abort();
    const failure = await pending;

    expect(isAbort(failure)).toBe(true);
    expect(failure).not.toBeInstanceOf(DataError);
  });

  it("is honoured before the first request is even sent", async () => {
    const fetchMock = hangs();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort();

    const failure = await gql("{ x }", {}, { signal: controller.signal }).catch(
      (error: unknown) => error,
    );
    expect(isAbort(failure)).toBe(true);
  });
});

describe("the deadline itself", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is fifteen seconds by default — far past a healthy answer", () => {
    expect(REQUEST_TIMEOUT_MS).toBe(15_000);
  });

  it("leaves no timer running behind a request that answered", async () => {
    // A per-attempt timer that is never cleared keeps a serverless function's
    // event loop alive after the response has gone out.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ data: { ok: true } }), { status: 200 })),
    );
    const before = process.getActiveResourcesInfo?.().filter((r) => r === "Timeout").length ?? 0;
    await gql<{ ok: boolean }>("{ ok }", {});
    const after = process.getActiveResourcesInfo?.().filter((r) => r === "Timeout").length ?? 0;
    expect(after).toBeLessThanOrEqual(before);
  });

  it("can be waived, for a caller that means to wait", async () => {
    const fetchMock = hangs();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    const pending = gql("{ x }", {}, { signal: controller.signal, timeoutMs: 0 }).catch(
      () => "called off",
    );
    // No deadline was set, so nothing has failed; only the caller can end it.
    controller.abort();
    expect(await pending).toBe("called off");
  });
});
