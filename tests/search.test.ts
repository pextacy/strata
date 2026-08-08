import { afterEach, describe, expect, it, vi } from "vitest";

import { liveParams, readableSearch } from "../src/ui/search.ts";

/**
 * Three hooks write this one query string — the mode, the moment, and the
 * drilled pixel — and each carries the other two along. What they build it from
 * decides whether two writes in the same commit compose or clobber.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readableSearch", () => {
  it("leaves a pixel readable instead of percent-encoding its comma", () => {
    const params = new URLSearchParams();
    params.set("px", "91,204");
    params.set("mode", "ghost");
    expect(readableSearch(params)).toBe("?px=91,204&mode=ghost");
  });

  it("returns nothing at all for an empty query, not a bare question mark", () => {
    expect(readableSearch(new URLSearchParams())).toBe("");
  });
});

describe("liveParams", () => {
  it("reads the address bar rather than the snapshot it was handed", () => {
    // The bug this guards: a hook renders while the query is `?mode=ghost`,
    // another hook then writes `?mode=ghost&t=900`, and the first one's write
    // lands afterwards built from what it saw at render time — dropping `t`.
    vi.stubGlobal("window", { location: { search: "?mode=ghost&t=900" } });

    const stale = new URLSearchParams("mode=ghost");
    const next = liveParams(stale);
    next.set("px", "91,204");

    expect(next.get("t")).toBe("900");
    expect(readableSearch(next)).toBe("?mode=ghost&t=900&px=91,204");
  });

  it("falls back to what it was handed where there is no address bar", () => {
    vi.stubGlobal("window", undefined);
    expect(liveParams(new URLSearchParams("mode=depth")).get("mode")).toBe("depth");
  });

  it("copies rather than aliasing the params it was handed", () => {
    vi.stubGlobal("window", undefined);
    const original = new URLSearchParams("mode=depth");
    liveParams(original).set("t", "5");
    expect(original.has("t")).toBe(false);
  });
});
