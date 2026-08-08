import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * viem is the largest thing this app could load — 87 kB gzipped, against 66 kB
 * for all of Strata's own code — and it is needed for exactly two things, both
 * optional: turning an address into an ENS name, and minting. Neither is on the
 * path to seeing a canvas.
 *
 * So it is loaded on demand. That arrangement is one `import` statement away
 * from silently collapsing, and nothing about it would look broken: the app
 * would work perfectly and just be slower to first paint for everyone. Hence
 * this, which reads the source rather than the bundle so it holds without a
 * build step.
 */

const source = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/** A static `import … from "x"`, which pulls x into whatever chunk this is. */
const staticallyImports = (path: string, specifier: string): boolean =>
  new RegExp(String.raw`^\s*import\s[^;]*?from\s+["'][^"']*${specifier}["']`, "m").test(
    source(path),
  );

describe("the modules that must stay free of viem", () => {
  // These two exist only so the cheap half of a viem-dependent feature can be
  // used without the expensive half. An import here undoes that entirely.
  it("mintTerms.ts holds the sale arithmetic and nothing that reaches a chain", () => {
    expect(staticallyImports("src/data/mintTerms.ts", "viem")).toBe(false);
  });

  it("ensCache.ts is a Map and nothing else", () => {
    expect(staticallyImports("src/data/ensCache.ts", "viem")).toBe(false);
    expect(source("src/data/ensCache.ts")).not.toContain("import ");
  });
});

describe("the two components that reach for viem", () => {
  it("Address loads the resolver only when it has a name to look up", () => {
    expect(staticallyImports("src/ui/Address.tsx", "data/ens.ts")).toBe(false);
    // Still asks for it — a dynamic import that nobody calls is just a missing
    // feature.
    expect(source("src/ui/Address.tsx")).toContain('import("../data/ens.ts")');
  });

  it("MintButton loads the chain only when there is something to read or sign", () => {
    expect(staticallyImports("src/ui/MintButton.tsx", "data/mint.ts")).toBe(false);
    expect(source("src/ui/MintButton.tsx")).toContain('import("../data/mint.ts")');
  });

  it("MintButton can still decide it has nothing to show, for free", () => {
    // `isOnSale` and `saleEndsIn` are what rule the button out on an old canvas.
    // If they ever came from mint.ts again, every day page would load viem to
    // be told there is nothing to mint.
    expect(staticallyImports("src/ui/MintButton.tsx", "data/mintTerms.ts")).toBe(true);
  });
});
