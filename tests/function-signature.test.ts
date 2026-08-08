import { describe, expect, it } from "vitest";

import htmlFn from "../api/html.js";
import ogFn from "../api/og.js";
import robotsFn from "../api/robots.js";
import sitemapFn from "../api/sitemap.js";

/**
 * How these functions are exported decides what Vercel passes into them, and
 * getting it wrong takes the whole site down without a single other test
 * noticing.
 *
 * A bare `export default function handler(request)` is the Node.js signature.
 * Vercel calls it with an `IncomingMessage`, whose `url` is a path — "/" or
 * "/robots.txt" — and every one of these functions starts by doing `new
 * URL(request.url)`, which throws on a path. Every route answered 500 with
 * `ERR_INVALID_URL` while every test here passed, because a test calls the
 * handler directly with a real `Request` it built itself. It can only ever
 * prove the body works, never that the platform will hand it the argument it
 * expects.
 *
 * Exporting `{ fetch }` is what asks for a Web `Request` and a `Response` back.
 * This checks the shape of that contract on all four, which is the part a
 * direct call cannot reach.
 */

const functions = {
  "api/html.ts": htmlFn,
  "api/og.ts": ogFn,
  "api/robots.ts": robotsFn,
  "api/sitemap.ts": sitemapFn,
};

describe("every API function", () => {
  for (const [name, fn] of Object.entries(functions)) {
    it(`${name} exports a fetch handler, not a bare default function`, () => {
      // A function as the default export is the Node.js (req, res) signature.
      expect(typeof fn).toBe("object");
      expect(typeof fn.fetch).toBe("function");
    });

    it(`${name} takes one argument, the request`, () => {
      // Two would mean somebody reintroduced (request, response).
      expect(fn.fetch.length).toBeLessThanOrEqual(1);
    });
  }
});

describe("the contract that broke", () => {
  it("answers a Request with an absolute URL, the way Vercel delivers one", async () => {
    const response = await robotsFn.fetch(new Request("https://strata.example/robots.txt"));
    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Sitemap: https://strata.example/sitemap.xml");
  });
});
