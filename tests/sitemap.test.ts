import { afterEach, describe, expect, it, vi } from "vitest";

import { assetOrigin, publicOrigin } from "../api/_lib/origin.js";
import { robots } from "../api/robots.js";
import { sitemap } from "../api/sitemap.js";
import { dayEnd } from "../src/core/day-math.js";

const ORIGIN = "https://strata.example";

describe("the sitemap", () => {
  const xml = sitemap(ORIGIN, 1095);

  it("is well-formed enough to be read at all", () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml.trimEnd().endsWith("</urlset>")).toBe(true);
  });

  it("lists the homepage and every day that has happened", () => {
    expect(xml).toContain(`<loc>${ORIGIN}/</loc>`);
    expect(xml).toContain(`<loc>${ORIGIN}/day/1</loc>`);
    expect(xml).toContain(`<loc>${ORIGIN}/day/1095</loc>`);
    // One per day, plus the homepage.
    expect((xml.match(/<url>/g) ?? []).length).toBe(1096);
  });

  it("does not offer a day that has not opened", () => {
    expect(xml).not.toContain(`<loc>${ORIGIN}/day/1096</loc>`);
    expect(xml).not.toContain(`<loc>${ORIGIN}/day/0</loc>`);
  });

  it("dates a closed day by the moment it closed", () => {
    const closed = new Date(dayEnd(500) * 1000).toISOString().slice(0, 10);
    expect(xml).toContain(`<loc>${ORIGIN}/day/500</loc><lastmod>${closed}</lastmod>`);
  });

  it("claims no last-modified date for the day still being painted", () => {
    // Today is repainted until midnight. Stating a date for it would be telling
    // a crawler it is settled when the next stroke is seconds away.
    expect(xml).toContain(`<loc>${ORIGIN}/day/1095</loc></url>`);
  });

  it("stays inside the 50,000-URL limit rather than truncating silently", () => {
    // Decades away, but a limit nobody checks fails on the day it is reached.
    const huge = sitemap(ORIGIN, 80_000);
    const count = (huge.match(/<url>/g) ?? []).length;
    expect(count).toBeLessThanOrEqual(50_000);
    // Newest first, so what is dropped is the far end of the archive.
    expect(huge).toContain(`<loc>${ORIGIN}/day/80000</loc>`);
  });
});

describe("robots.txt", () => {
  it("points at the sitemap with an absolute URL", () => {
    // The spec requires it, and a relative one is ignored — which is the whole
    // reason this is a function and not a file in public/.
    expect(robots(ORIGIN)).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
  });

  it("still lets everything be crawled", () => {
    expect(robots(ORIGIN)).toContain("User-agent: *");
    expect(robots(ORIGIN)).toContain("Allow: /");
    expect(robots(ORIGIN)).not.toContain("Disallow");
  });
});

/**
 * The Host header is client-supplied. `assetOrigin` decides where the HTML
 * function fetches the shell it is about to serve as this site's own page, so
 * trusting the header there is a server-side request forgery with the result
 * served back under our domain. `publicOrigin` decides what goes into other
 * people's search indexes. Neither may believe the request.
 */
describe("which host a function believes", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const asked = new URL("https://evil.example/day/500");

  it("fetches this deployment's own shell, not the one the caller named", () => {
    vi.stubEnv("VERCEL_URL", "strata-abc123.vercel.app");
    expect(assetOrigin(asked)).toBe("https://strata-abc123.vercel.app");
  });

  it("publishes the production domain, not the one the caller named", () => {
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "strata.example");
    expect(publicOrigin(asked)).toBe("https://strata.example");
  });

  it("speaks http to a loopback host, because vercel dev is not on TLS", () => {
    // `vercel dev` sets the same variables to localhost. Assuming https there
    // meant the HTML function could never fetch its own shell locally, so the
    // one harness that runs these functions the way the platform does answered
    // 503 on every page and nobody could use it.
    vi.stubEnv("VERCEL_URL", "localhost:3999");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "127.0.0.1:3000");
    expect(assetOrigin(asked)).toBe("http://localhost:3999");
    expect(publicOrigin(asked)).toBe("http://127.0.0.1:3000");
  });

  it("still speaks https to everything that is not loopback", () => {
    vi.stubEnv("VERCEL_URL", "localhost-of-evil.example");
    expect(assetOrigin(asked)).toBe("https://localhost-of-evil.example");
  });

  it("treats an empty variable as unset rather than building https://", () => {
    vi.stubEnv("VERCEL_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    expect(assetOrigin(asked)).toBe("https://evil.example");
    expect(publicOrigin(asked)).toBe("https://evil.example");
  });
});
