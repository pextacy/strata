import { afterEach, describe, expect, it } from "vitest";

import { forgetEnsNames, knownEnsName, rememberEnsName } from "../src/data/ensCache.ts";

/**
 * The cache is read during render, before the resolver has been loaded, so the
 * three states have to stay distinguishable: a name, no name, and not asked.
 * Collapsing the last two would make every address without a name re-ask on
 * every render.
 */

describe("the ENS session cache", () => {
  afterEach(forgetEnsNames);

  const VITALIK = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

  it("tells not-asked from asked-and-there-is-none", () => {
    expect(knownEnsName(VITALIK)).toBeUndefined();
    rememberEnsName(VITALIK, null);
    expect(knownEnsName(VITALIK)).toBeNull();
  });

  it("gives back the name it was told", () => {
    rememberEnsName(VITALIK, "vitalik.eth");
    expect(knownEnsName(VITALIK)).toBe("vitalik.eth");
  });

  it("does not care how the address is cased or spaced", () => {
    // Addresses arrive checksummed from the indexer and lowercased from
    // `Placements.artists`. One lookup has to serve both spellings, or the same
    // painter is resolved twice per page.
    rememberEnsName(VITALIK.toLowerCase(), "vitalik.eth");
    expect(knownEnsName(VITALIK)).toBe("vitalik.eth");
    expect(knownEnsName(`  ${VITALIK.toUpperCase()}  `)).toBe("vitalik.eth");
  });
});
