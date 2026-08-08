import { afterEach, describe, expect, it, vi } from "vitest";

import handler, { cachePolicy } from "../api/og.ts";
import { currentDay } from "../src/core/day-math.ts";

/**
 * The share card is the first thing most people ever see of this project, and
 * it is drawn by replaying a whole day from the chain. What is checked here is
 * everything that happens *before* that replay: which requests are turned away,
 * what they are told, and what a CDN is allowed to do with the answer.
 *
 * The replay itself is covered by `share-card.test.ts` and by `npm run verify`,
 * which diffs it against the official render. Nothing in this file reaches the
 * network — a request that got as far as fetching would fail the last test here.
 */

const ask = (query: string) => handler(new Request(`https://strata.example/api/og?${query}`));

/** Any request that would have gone to the network instead lands here. */
const noNetwork = () =>
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("the handler reached the network");
    }),
  );

describe("requests the card function turns away", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refuses a day that is not a number, and says which one", async () => {
    noNetwork();
    const response = await ask("day=abc");
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("“abc” is not a day number");
  });

  it("refuses a day that has not been painted yet", async () => {
    noNetwork();
    expect((await ask(`day=${currentDay() + 1}`)).status).toBe(400);
    expect((await ask("day=0")).status).toBe(400);
    expect((await ask("day=-5")).status).toBe(400);
    expect((await ask("day=1e9")).status).toBe(400);
  });

  it("refuses something that is not an address", async () => {
    noNetwork();
    const response = await ask("address=vitalik");
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("is not an Ethereum address");
  });

  it("answers a wrong request without asking anyone else about it", async () => {
    // The point of the checks above running first: a bad day number or a
    // malformed address is decided here, not by making the indexer decide.
    noNetwork();
    for (const query of ["day=abc", "day=0", "address=vitalik", "address=0x00"]) {
      expect((await ask(query)).status).toBe(400);
    }
  });
});

describe("what a CDN may keep", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * A wrong request is wrong the same way every time, and there are 2^160
   * addresses to ask about. Uncached, every retry of a bad card link reached
   * this function, and the ones the indexer has to answer ran fresh queries
   * against somebody else's service each time.
   */
  it("lets a 400 be cached, because the answer does not depend on the world", async () => {
    noNetwork();
    const cache = (await ask("day=abc")).headers.get("cache-control") ?? "";
    expect(cache).toContain("s-maxage=3600");
    expect(cache).not.toContain("no-store");
  });

  it("keeps a 502 out of the cache, because that one is about the world", async () => {
    // An upstream that was down a second ago recovers; a cached failure does
    // not, and the card stays broken long after the thing that broke it.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 500 })),
    );
    const response = await ask("day=500");
    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("never lets a failure go out as an image with a 200 on it", async () => {
    // A broken image is worse than no image: the crawler falls back to the
    // static card in the shell only if this answers with an error.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 500 })),
    );
    const response = await ask("day=500");
    expect(response.status).not.toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  });
});

/**
 * How long a card may be kept is decided by what the card is a function of, and
 * getting that wrong is not visible from the outside — a stale card looks
 * exactly like a fresh one.
 *
 * These reach no network either: each one is stopped before the replay by a
 * check that runs first, and what is being read is the policy, not the picture.
 * The pinned-versus-resolved distinction is checked through `cachePolicy`, which
 * is the same function the handler calls.
 */
describe("how long the CDN may keep a card", () => {
  const today = currentDay();
  const closed = today - 1;

  it("keeps a card pinned to a closed day for a long time", () => {
    // Settled history: same request, same quarter of a million placements, same
    // bytes out. Rebuilding it daily bought nothing.
    const policy = cachePolicy(closed, true);
    expect(policy).toContain("s-maxage=2592000");
    expect(policy).toContain("stale-while-revalidate=31536000");
  });

  it("keeps today's card for minutes, because today is still being painted", () => {
    expect(cachePolicy(today, true)).toContain("s-maxage=300");
    expect(cachePolicy(today, false)).toContain("s-maxage=300");
  });

  /**
   * The bug this split exists for. `?address=` with no `day=` answers "their
   * most recent closed canvas" — a different day every time one closes. It was
   * cached by the settledness of whichever day it landed on, so an artist who
   * painted last night could keep serving the day before for up to a week.
   */
  it("keeps a card it had to pick the day for on a much shorter leash", () => {
    const resolved = cachePolicy(closed, false);
    expect(resolved).toContain("s-maxage=3600");
    expect(resolved).not.toContain("s-maxage=2592000");
  });

  it("never lets a resolved card outlive a pinned one", () => {
    const maxAge = (policy: string) => Number(/s-maxage=(\d+)/.exec(policy)?.[1]);
    expect(maxAge(cachePolicy(closed, false))).toBeLessThan(maxAge(cachePolicy(closed, true)));
  });
});

/**
 * The same distinction, through the whole handler rather than through the policy
 * on its own.
 *
 * Checking `cachePolicy` proves the three answers are right; it does not prove
 * the handler asks it the right question. Wiring `pinned` to the wrong thing
 * would put a month-long cache on the one card that must not have it, and every
 * test above would still pass — so this one drives a card end to end over a
 * stubbed indexer and reads the header that actually goes out.
 */
describe("a card built end to end", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const ARTIST = "0xeFa845164E612fe623ac21380AfC8ec78F22e3c3";
  const closed = currentDay() - 1;

  /** Just enough of both upstreams for one two-pixel day to be replayed. */
  const stubUpstreams = () =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: { body?: string }) => {
        const url = String(typeof input === "object" && "url" in input ? input.url : input);

        if (url.includes("/api/theme/")) {
          return new Response(
            JSON.stringify({
              theme: "A Theme",
              proposer: ARTIST,
              size: 8,
              palette: ["#000000", "#ff0000"],
            }),
            { status: 200 },
          );
        }

        const query = String(init?.body ?? "");
        if (query.includes("DayStrokes")) {
          return new Response(
            JSON.stringify({
              data: {
                strokes: {
                  // Two pixels: (0,0) colour 1, then (1,1) colour 1.
                  items: [
                    {
                      id: "1",
                      accountId: ARTIST,
                      data: "0x000001010101",
                      pixels: 2,
                      timestamp: 1_700_000_000,
                    },
                  ],
                  pageInfo: { hasNextPage: false, endCursor: null },
                  totalCount: 1,
                },
              },
            }),
            { status: 200 },
          );
        }
        if (query.includes("ArtistDays")) {
          return new Response(
            JSON.stringify({
              data: { contributions: { items: [{ canvasId: closed, pixelsCount: 2 }], totalCount: 1 } },
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ data: { account: null } }), { status: 200 });
      }),
    );

  const cacheOf = async (query: string) => {
    const response = await ask(query);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    return response.headers.get("cache-control") ?? "";
  };

  it("keeps a day card for a closed day for a month", async () => {
    stubUpstreams();
    expect(await cacheOf(`day=${closed}`)).toContain("s-maxage=2592000");
  });

  it("keeps an artist card pinned to that day for a month too", async () => {
    stubUpstreams();
    expect(await cacheOf(`address=${ARTIST}&day=${closed}`)).toContain("s-maxage=2592000");
  });

  it("keeps an artist card that had to pick the day for an hour", async () => {
    // The card says "their most recent closed canvas", and tomorrow that is a
    // different canvas. This is the one the month-long cache would have broken.
    stubUpstreams();
    expect(await cacheOf(`address=${ARTIST}`)).toContain("s-maxage=3600");
  });

  it("keeps today's card for five minutes however it was asked for", async () => {
    stubUpstreams();
    expect(await cacheOf(`day=${currentDay()}`)).toContain("s-maxage=300");
    expect(await cacheOf("")).toContain("s-maxage=300");
  });

  it("ignores the version in the URL — it is a cache key, not an input", async () => {
    stubUpstreams();
    const plain = await ask(`day=${closed}`);
    const versioned = await ask(`day=${closed}&v=7`);
    expect(versioned.status).toBe(200);
    expect(new Uint8Array(await versioned.arrayBuffer())).toEqual(
      new Uint8Array(await plain.arrayBuffer()),
    );
  });
});

describe("the headers every card answer carries", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("says nosniff on a body that echoes the request back", async () => {
    noNetwork();
    const response = await ask("address=vitalik");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });
});
