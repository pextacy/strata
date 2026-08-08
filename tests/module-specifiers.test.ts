import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every relative import in this project must name a `.js` file, even though the
 * file on disk is `.ts`. That is the TypeScript convention for ESM, and here it
 * is not a style preference — it is the difference between a working deploy and
 * a dead one.
 *
 * Vercel does not bundle these functions. It compiles `api/**` and every
 * `src/**` file they reach to `.js`, copies them into the function, and passes
 * the import specifiers through untouched. A specifier ending in `.ts` therefore
 * points at a file that is not there, and the function dies on load with
 * ERR_MODULE_NOT_FOUND before it can run a line. Every route 500s.
 *
 * Nothing else in the toolchain notices: Vite resolves `.ts` specifiers happily,
 * so the dev server, the production bundle and all 460 other tests stayed green
 * while the deployed site was returning 500 on every URL. This is the only check
 * that would have caught it, which is why it reads the source rather than
 * anything built.
 */

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function sourcesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) {
      out.push(...sourcesUnder(rel));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(rel);
    }
  }
  return out;
}

/**
 * A static or dynamic import of a relative path carrying a TypeScript
 * extension. Package specifiers are not relative and are never affected.
 *
 * Written without an example of what it matches, deliberately: an illustration
 * in this comment is itself a match, and the first run of this test failed on
 * its own documentation.
 */
const TS_SPECIFIER = /(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']*\.tsx?)["']/g;

describe("relative import specifiers", () => {
  const files = [...sourcesUnder("src"), ...sourcesUnder("api"), ...sourcesUnder("tests")];

  it("finds source to check, so this test cannot pass by looking at nothing", () => {
    expect(files.length).toBeGreaterThan(60);
  });

  it("never point at a .ts file, because the deployed functions have none", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(join(ROOT, file), "utf8");
      for (const match of source.matchAll(TS_SPECIFIER)) {
        offenders.push(`${file} → ${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
