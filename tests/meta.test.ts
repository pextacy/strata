import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { injectMeta, matchArtist, matchDay, type Meta } from "../api/html.ts";
import { currentDay } from "../src/core/day-math.ts";

/**
 * Crawlers do not run the router, so these tags are the entire preview of a
 * link. The shell used here is the real one from the repository — if a tag is
 * added to it that this function does not replace, the duplicate shows up in
 * this test rather than in someone's timeline.
 */

const SHELL = readFileSync(new URL("../index.html", import.meta.url), "utf8");

const meta = (over: Partial<Meta> = {}): Meta => ({
  title: "Day 500: A Theme — Strata",
  description: "What survived and what is buried.",
  card: "day=500",
  cacheControl: "public",
  ...over,
});

const ORIGIN = "https://strata.example";

describe("route matching", () => {
  it("reads a day out of the path and refuses one that has not happened", () => {
    expect(matchDay("/day/500")).toBe(500);
    expect(matchDay("/day/500/")).toBe(500);
    expect(matchDay(`/day/${currentDay() + 5}`)).toBeNull();
    expect(matchDay("/day/0")).toBeNull();
    expect(matchDay("/day/five")).toBeNull();
    expect(matchDay("/artist/0x0")).toBeNull();
  });

  it("checksums an artist address and rejects anything that is not one", () => {
    const lower = "0xefa845164e612fe623ac21380afc8ec78f22e3c3";
    // EIP-55 casing, which is the only spelling the indexer answers to.
    expect(matchArtist(`/artist/${lower}`)).toBe("0xeFa845164E612fe623ac21380AfC8ec78F22e3c3");
    expect(matchArtist("/artist/vitalik")).toBeNull();
    expect(matchArtist("/artist/")).toBeNull();
  });

  it("answers null for a path that will not even unescape", () => {
    // decodeURIComponent throws a URIError on these, and a crawler will ask for
    // one eventually. Unescapable is not an address; it is not a 500 either.
    expect(matchArtist("/artist/%")).toBeNull();
    expect(matchArtist("/artist/%E0%A4%A")).toBeNull();
    expect(matchArtist("/artist/%zz")).toBeNull();
  });
});

describe("injectMeta", () => {
  const html = injectMeta(SHELL, meta(), ORIGIN, "/day/500");

  it("leaves exactly one title and one description", () => {
    expect(count(html, /<title>/g)).toBe(1);
    expect(html).toContain("<title>Day 500: A Theme — Strata</title>");
    expect(count(html, /name="description"/g)).toBe(1);
  });

  it("leaves exactly one card, pointing at this route", () => {
    expect(count(html, /property="og:image"/g)).toBe(1);
    expect(count(html, /property="og:title"/g)).toBe(1);
    expect(html).toContain('content="https://strata.example/api/og?day=500"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
  });

  it("keeps the app itself — the page still has to run", () => {
    expect(html).toContain('<div id="root">');
    expect(html).toContain("/src/main.tsx");
    expect(html).toContain("</head>");
  });

  it("names the page it is on", () => {
    expect(html).toContain('property="og:url" content="https://strata.example/day/500"');
    expect(html).toContain('rel="canonical" href="https://strata.example/day/500"');
  });

  it("treats a theme name as text, never as markup", () => {
    const nasty = injectMeta(
      SHELL,
      meta({ title: `Day 1: <script>alert("x")</script> & co` }),
      ORIGIN,
      "/day/1",
    );
    expect(nasty).not.toContain("<script>alert");
    expect(nasty).toContain("&lt;script&gt;");
    expect(nasty).toContain("&quot;x&quot;");
    expect(nasty).toContain("&amp; co");
  });

  it("falls back to a small card when a route has none of its own", () => {
    const plain = injectMeta(SHELL, meta({ card: null }), ORIGIN, "/nowhere");
    expect(plain).toContain('name="twitter:card" content="summary"');
    expect(count(plain, /property="og:image"/g)).toBe(0);
  });

  it("serves the app even when the shell has no head to inject into", () => {
    // A broken build is not a reason to fail the request: the page still runs,
    // it just goes out without per-route tags.
    const headless = '<!doctype html><html><body><div id="root"></div></body></html>';
    const out = injectMeta(headless, meta(), ORIGIN, "/day/500");
    expect(out).toContain('<div id="root">');
  });
});

const count = (text: string, pattern: RegExp): number => (text.match(pattern) ?? []).length;
