import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import handler, {
  injectMeta,
  matchArtist,
  matchDay,
  metaFor,
  type Meta,
} from "../api/html.ts";
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
  status: 200,
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

/**
 * The app answers every URL with the same document, so the status is the only
 * thing that distinguishes a real page from a wrong one. A 200 on `/day/99999`
 * is an invitation to index it.
 */
describe("the status a route answers with", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** The only network call a day route makes is the theme name, and it is optional. */
  const withoutTheme = () => vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));

  it("answers 200 for the routes that exist", async () => {
    withoutTheme();
    expect((await metaFor("/")).status).toBe(200);
    expect((await metaFor("/day/500")).status).toBe(200);
    expect(
      (await metaFor("/artist/0xefa845164e612fe623ac21380afc8ec78f22e3c3")).status,
    ).toBe(200);
  });

  it("answers 404 for a day that has not happened", async () => {
    withoutTheme();
    expect((await metaFor(`/day/${currentDay() + 1}`)).status).toBe(404);
    expect((await metaFor("/day/0")).status).toBe(404);
  });

  it("answers 404 for an artist path that is not an address", async () => {
    expect((await metaFor("/artist/vitalik")).status).toBe(404);
    expect((await metaFor("/artist/%")).status).toBe(404);
  });

  it("answers 404 for a path that is not a route at all", async () => {
    const notFound = await metaFor("/wp-admin");
    expect(notFound.status).toBe(404);
    expect(notFound.title).toContain("No such page");
    expect(notFound.card).toBeNull();
  });

  it("still names a day even when the theme endpoint is down", async () => {
    withoutTheme();
    const day = await metaFor("/day/500");
    expect(day.title).toBe("Day 500 — Strata");
    expect(day.status).toBe(200);
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

  it("tells a crawler not to keep a page that does not exist", () => {
    const gone = injectMeta(SHELL, meta({ status: 404, card: null }), ORIGIN, "/wp-admin");
    expect(gone).toContain('name="robots" content="noindex, follow"');
  });

  it("says nothing about robots on a page that does exist", () => {
    expect(html).not.toContain('name="robots"');
  });

  it("serves the app even when the shell has no head to inject into", () => {
    // A broken build is not a reason to fail the request: the page still runs,
    // it just goes out without per-route tags.
    const headless = '<!doctype html><html><body><div id="root"></div></body></html>';
    const out = injectMeta(headless, meta(), ORIGIN, "/day/500");
    expect(out).toContain('<div id="root">');
  });
});

/**
 * The whole function, over a stubbed network. What is being checked is that a
 * request naming somebody else's host cannot make this function fetch from
 * there and then serve the result as Strata's own HTML — and cannot get its own
 * domain written into the canonical link or the card that other people index.
 */
describe("the handler, asked by a caller claiming to be somewhere else", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const fetched: string[] = [];

  const stubNetwork = () => {
    fetched.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const target = String(input);
        fetched.push(target);
        if (target.endsWith("/index.html")) return new Response(SHELL, { status: 200 });
        // The theme endpoint. Down, which the page has to survive anyway.
        return new Response("", { status: 500 });
      }),
    );
  };

  const ask = async (host: string, path: string): Promise<Response> => {
    stubNetwork();
    vi.stubEnv("VERCEL_URL", "strata-deploy-abc123.vercel.app");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "strata.example");
    return await handler(new Request(`https://${host}${path}`));
  };

  it("fetches its shell from this deployment, never from the caller's host", async () => {
    await ask("evil.example", "/day/500");
    expect(fetched).toContain("https://strata-deploy-abc123.vercel.app/index.html");
    expect(fetched.some((url) => url.includes("evil.example"))).toBe(false);
  });

  it("puts the caller's host nowhere in the page it serves", async () => {
    const response = await ask("evil.example", "/day/500");
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).not.toContain("evil.example");
    expect(html).toContain('rel="canonical" href="https://strata.example/day/500"');
    expect(html).toContain("https://strata.example/api/og?day=500");
  });

  it("answers 404 for a path that is not a route, and says so in the tags", async () => {
    const response = await ask("strata.example", "/wp-admin");
    expect(response.status).toBe(404);
    expect(await response.text()).toContain('name="robots" content="noindex, follow"');
  });

  it("carries the security headers on every document it sends", async () => {
    const response = await ask("strata.example", "/day/500");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
  });

  it("answers 503 in words when its own shell cannot be fetched", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    vi.stubEnv("VERCEL_URL", "strata-deploy-abc123.vercel.app");
    const response = await handler(new Request("https://strata.example/day/500"));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toContain("problem at our end");
  });
});

const count = (text: string, pattern: RegExp): number => (text.match(pattern) ?? []).length;
