import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { CSP } from "../api/_lib/security.js";

/**
 * The built shell, read against the policy that will be sent with it.
 *
 * `api/_lib/security.ts` says `script-src 'self'` holds "because the built shell
 * has no inline script of its own — Vite emits the entry as a module file", and
 * that anything changing it "breaks the app loudly in the console". That is
 * true, and it is the wrong place to find out: the console in question belongs
 * to whoever opened the site after the deploy. A plugin that inlines a runtime,
 * an analytics snippet pasted into `index.html`, a `<script>` added by a future
 * Vite default — each one produces a build that passes every other test here,
 * runs perfectly under `npm run dev` (which sends no CSP at all), and is dead on
 * arrival in production.
 *
 * So the policy is checked against the artefact rather than against a promise.
 *
 * This needs `dist/`, which a clean checkout does not have — `npm run build`
 * comes before `npm test` in CI for exactly this reason. Locally it skips, and
 * says so, rather than passing on nothing.
 */

const DIST = new URL("../dist/index.html", import.meta.url);
const BUILT = existsSync(DIST);

/** What each directive of the policy allows, as a list of sources. */
function directive(name: string): string[] {
  const found = CSP.split(";")
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
  if (found === undefined) throw new Error(`the policy has no ${name} directive`);
  return found.slice(name.length).trim().split(/\s+/).filter(Boolean);
}

/** Whether a directive permits loading from this absolute URL's origin. */
function allows(name: string, url: string): boolean {
  const sources = directive(name);
  if (sources.includes("*") || sources.includes("https:")) return true;
  const { origin } = new URL(url);
  return sources.some((source) => source === origin || source === `${origin}/`);
}

describe.skipIf(!BUILT)("the built shell obeys the policy it is served with", () => {
  const shell = BUILT ? readFileSync(DIST, "utf8") : "";
  const tags = (name: string): string[] => shell.match(new RegExp(`<${name}\\b[^>]*>`, "gi")) ?? [];

  it("ships no inline script, which is the whole of script-src 'self'", () => {
    expect(directive("script-src")).toEqual(["'self'"]);
    // Every script tag has to point at a file. An inline one would be blocked,
    // and the app would never start.
    for (const tag of tags("script")) expect(tag, tag).toMatch(/\ssrc=/);
    expect(shell).not.toMatch(/<script\b[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i);
  });

  it("carries no inline event handler, which the same directive blocks", () => {
    // `onclick=` and friends are script, and `'unsafe-inline'` is not on offer.
    expect(shell).not.toMatch(/<[^>]+\son[a-z]+\s*=/i);
    expect(shell).not.toMatch(/javascript:/i);
  });

  it("loads its own script and stylesheet from this origin", () => {
    const sources = [...shell.matchAll(/\s(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
    const assets = sources.filter((url) => /\.(js|css)$/.test(url.split("?")[0]));
    expect(assets.length).toBeGreaterThan(0);
    for (const url of assets) {
      if (!/^https?:/.test(url)) continue; // relative is same-origin, which is 'self'
      expect(allows(url.endsWith(".css") ? "style-src" : "script-src", url), url).toBe(true);
    }
  });

  /**
   * The one thing the shell fetches from somebody else. If a second host ever
   * appears here — a CDN, an icon set, an embed — the policy has to learn about
   * it in the same commit, not after someone reports a blank page.
   */
  it("names every outside host it reaches for in the policy", () => {
    const external = [...shell.matchAll(/\s(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
    const stylesheets = [...shell.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/gi)]
      .map((tag) => /href="(https?:\/\/[^"]+)"/.exec(tag[0])?.[1])
      .filter((url): url is string => url !== undefined);

    for (const url of stylesheets) expect(allows("style-src", url), url).toBe(true);

    // Anything external that is not a stylesheet or a preconnect hint has to be
    // covered by default-src, which is 'self' — so there should be none.
    const hints = new Set(
      [...shell.matchAll(/<link\b[^>]*rel="(?:preconnect|dns-prefetch)"[^>]*>/gi)]
        .map((tag) => /href="(https?:\/\/[^"]+)"/.exec(tag[0])?.[1])
        .filter((url): url is string => url !== undefined),
    );
    const unaccounted = external.filter((url) => !stylesheets.includes(url) && !hints.has(url));
    expect(unaccounted, "external references the policy does not cover").toEqual([]);
  });

  it("keeps the mount point and the entry the app needs to start at all", () => {
    // A policy the app cannot run under is one failure; a shell with nothing to
    // run is another, and this file is where both would show.
    expect(shell).toContain('id="root"');
    expect(tags("script").length).toBeGreaterThan(0);
  });
});
