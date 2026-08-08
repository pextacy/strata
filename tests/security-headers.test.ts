import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { CSP, assetHeaders, documentHeaders } from "../api/_lib/security.ts";

/**
 * The policy exists twice — once in `api/_lib/security.ts`, for the documents
 * the function builds, and once in `vercel.json`, for the built `index.html`
 * that Vercel serves off disk. It has to: `routes` cannot be combined with a
 * top-level `headers` block, and the function cannot set a header on a file it
 * does not serve. So the drift is what gets tested.
 */

interface VercelConfig {
  readonly routes: {
    readonly src: string;
    readonly dest?: string;
    readonly headers?: Record<string, string>;
  }[];
}

const config: VercelConfig = JSON.parse(
  readFileSync(new URL("../vercel.json", import.meta.url), "utf8"),
);

const route = (src: string) => config.routes.find((r) => r.src === src);

describe("the document headers", () => {
  const headers = documentHeaders();

  it("stops an injected script from running", () => {
    expect(headers["content-security-policy"]).toContain("script-src 'self'");
    expect(headers["content-security-policy"]).toContain("object-src 'none'");
    expect(headers["content-security-policy"]).toContain("base-uri 'self'");
  });

  it("refuses to be framed, in both spellings", () => {
    // A page with a mint button on it, inside somebody else's frame, is a
    // clickjack waiting to happen.
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["x-frame-options"]).toBe("DENY");
  });

  it("allows the inline styles the canvas actually needs", () => {
    // Scrubber bar heights and core-sample band colours are computed per
    // element. Dropping 'unsafe-inline' from style-src would blank them.
    expect(headers["content-security-policy"]).toContain("'unsafe-inline'");
  });

  it("allows the worker, the fonts and the beacon the app loads", () => {
    expect(CSP).toContain("worker-src 'self' blob:");
    expect(CSP).toContain("https://fonts.gstatic.com");
    expect(CSP).toContain("https://basepaint.xyz");
  });

  it("leaves popups open, because a wallet may need one to confirm a mint", () => {
    expect(headers["cross-origin-opener-policy"]).toBe("same-origin-allow-popups");
  });

  it("does not name the hosts it talks to", () => {
    // Deliberate: ENS resolves offchain names through gateway URLs handed back
    // by the resolver, which cannot be known here. See the comment on CSP.
    expect(CSP).toContain("connect-src https: wss:");
  });

  it("says nosniff, refuses a plaintext downgrade, and asks for no permissions", () => {
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["strict-transport-security"]).toContain("includeSubDomains");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toContain("camera=()");
  });
});

describe("the asset headers", () => {
  it("let a PNG load nothing at all", () => {
    const headers = assetHeaders();
    expect(headers["content-security-policy"]).toContain("default-src 'none'");
    expect(headers["content-security-policy"]).toContain("sandbox");
    expect(headers["x-content-type-options"]).toBe("nosniff");
  });
});

describe("vercel.json", () => {
  it("serves the built shell under the same policy the function sends", () => {
    // If these ever disagree, /index.html is a way to load the app without the
    // policy that the rest of the site is held to.
    expect(route("/index.html")?.headers?.["Content-Security-Policy"]).toBe(CSP);
  });

  it("says nosniff on every static file it serves", () => {
    // The function routes are absent on purpose: those responses get their
    // headers from `assetHeaders()`, which is the same set.
    for (const src of ["/assets/(.*)", "/favicon.svg", "/index.html"]) {
      expect(route(src)?.headers?.["X-Content-Type-Options"]).toBe("nosniff");
    }
  });

  it("sends robots.txt and the sitemap to the functions that build them", () => {
    // Both need the production domain written into them, which a file in
    // public/ cannot know.
    expect(route("/robots.txt")?.dest).toBe("/api/robots");
    expect(route("/sitemap.xml")?.dest).toBe("/api/sitemap");
  });

  it("still sends the homepage through the function that builds its card", () => {
    // The last route is the one that makes "/" dynamic. Losing it would serve a
    // static shell whose card is a relative URL, and no day page would unfurl.
    expect(config.routes.at(-1)).toEqual({ src: "/(.*)", dest: "/api/html" });
  });
});
