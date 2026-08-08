import { afterEach, describe, expect, it, vi } from "vitest";

import { DataError } from "../src/data/client.ts";
import { fetchDayStrokes } from "../src/data/queries.ts";

/**
 * The paging loop is the one place in the app that decides when a day is fully
 * read. Getting "finished" wrong in the optimistic direction renders a partial
 * canvas as a complete one, which is the single failure this project cannot
 * ship; getting it wrong in the other direction hangs a worker or runs a
 * serverless function to its timeout. Both are exercised here against a stubbed
 * indexer, because no real day misbehaves this way on demand.
 */

const stroke = (id: number) => ({
  id: String(id),
  accountId: "0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa",
  data: "0x000001",
  pixels: 1,
  timestamp: 1_700_000_000 + id,
});

/** An indexer that answers every request with whatever `pages` says. */
function indexer(reply: (call: number) => { items: unknown[]; hasNextPage: boolean; endCursor: string | null }) {
  let call = 0;
  const fetchStub = vi.fn(async () => {
    const page = reply(call++);
    return new Response(
      JSON.stringify({
        data: {
          strokes: {
            items: page.items,
            pageInfo: { hasNextPage: page.hasNextPage, endCursor: page.endCursor },
            totalCount: 9_999,
          },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  vi.stubGlobal("fetch", fetchStub);
  return fetchStub;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchDayStrokes", () => {
  it("reads every page and stops when the indexer says it is done", async () => {
    indexer((call) =>
      call < 2
        ? { items: [stroke(call + 1)], hasNextPage: true, endCursor: `cursor-${call}` }
        : { items: [stroke(3)], hasNextPage: false, endCursor: null },
    );

    const seen: number[] = [];
    const { pages, lastId } = await fetchDayStrokes(500, (items) => seen.push(items.length));

    expect(pages).toBe(3);
    expect(seen).toEqual([1, 1, 1]);
    expect(lastId).toBe(3n);
  });

  it("refuses to spin when the cursor stops moving", async () => {
    // "More to come" plus the cursor it was just handed is an infinite loop.
    const stub = indexer(() => ({
      items: [stroke(1)],
      hasNextPage: true,
      endCursor: "stuck",
    }));

    await expect(fetchDayStrokes(500, () => {})).rejects.toThrow(DataError);
    // Two calls: the first hands out "stuck", the second returns it unchanged.
    expect(stub.mock.calls.length).toBe(2);
  });

  it("gives up loudly rather than paging without end", async () => {
    let n = 0;
    indexer(() => ({ items: [stroke(++n)], hasNextPage: true, endCursor: `cursor-${n}` }));

    // Not a silent truncation: a day that will not finish is a day Strata
    // cannot vouch for, and the page says so instead of drawing half a canvas.
    await expect(fetchDayStrokes(500, () => {})).rejects.toThrow(/did not stop paging/);
  });
});
