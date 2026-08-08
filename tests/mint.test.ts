import { describe, expect, it } from "vitest";

import { formatEth, isOnSale, saleEndsIn, type MintTerms } from "../src/data/mintTerms.js";
import { BASEPAINT_ABI, REWARDS_ABI } from "../src/data/rewards.js";

/**
 * The sale window and the price come from the contract; these are the pure
 * decisions made around them. Signing cannot be tested without a wallet, so
 * everything a wrong assumption could break is pushed into functions that can.
 */

const terms: MintTerms = {
  price: 2_600_000_000_000_000n,
  openDay: 1095,
  epochDuration: 86_400,
  startedAt: 1_691_599_315,
};

describe("sale window", () => {
  it("is open only for the day that just closed", () => {
    expect(isOnSale(1094, terms)).toBe(true);
    expect(isOnSale(1095, terms)).toBe(false); // still being painted
    expect(isOnSale(1093, terms)).toBe(false); // sold and gone
  });

  it("counts down to the end of the window and then stops", () => {
    const opensAt = terms.startedAt + 1094 * terms.epochDuration;
    const closesAt = opensAt + terms.epochDuration;
    expect(saleEndsIn(1094, terms, closesAt - 3600)).toBe(3600);
    expect(saleEndsIn(1094, terms, closesAt)).toBe(0);
    expect(saleEndsIn(1094, terms, closesAt + 99_999)).toBe(0);
  });
});

describe("formatEth", () => {
  it("reads a price the way a person would say it", () => {
    expect(formatEth(2_600_000_000_000_000n)).toBe("0.0026");
    expect(formatEth(0n)).toBe("0");
    expect(formatEth(10n ** 18n)).toBe("1");
    expect(formatEth(1_500_000_000_000_000_000n)).toBe("1.5");
  });

  it("never prints a price of zero for a price that is not zero", () => {
    // Truncating at four decimals used to put "Mint for 0 ETH" on a button that
    // spends money. Only an actual zero is allowed to read as zero.
    expect(formatEth(1n)).toBe("<0.0001");
    expect(formatEth(10_000_000_000_000n)).toBe("<0.0001"); // 0.00001 ETH
    expect(formatEth(100_000_000_000_000n)).toBe("0.0001"); // exactly on the edge
    expect(formatEth(0n)).toBe("0");
  });
});

describe("contract interfaces", () => {
  // These are copied from the verified sources; a typo would only ever show up
  // as a reverted transaction, so it is worth one assertion.
  it("mints through the rewards contract with a referrer argument", () => {
    const mint = REWARDS_ABI.find((entry) => entry.name === "mint");
    expect(mint?.stateMutability).toBe("payable");
    expect(mint?.inputs.map((i) => i.name)).toEqual([
      "tokenId",
      "sendMintsTo",
      "count",
      "sendRewardsTo",
    ]);
  });

  it("reads the price and the open day from BasePaint itself", () => {
    const names = BASEPAINT_ABI.map((entry) => entry.name);
    expect(names).toContain("openEditionPrice");
    expect(names).toContain("today");
    for (const entry of BASEPAINT_ABI) expect(entry.stateMutability).toBe("view");
  });
});
