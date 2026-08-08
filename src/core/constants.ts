/** Facts about BasePaint that the whole app depends on. Every source is public
    and unauthenticated, which is why this project has no backend and no secret. */

/** Day 1 opened at this unix second, and no day since has been any other length. */
export const DAY_ONE_START = 1691599315;
export const DAY_DURATION = 86400;

export const CONTRACTS = {
  basePaint: "0xBa5e05cb26b78eDa3A2f8e3b3814726305dcAc83",
  brush: "0xD68fe5b53e7E1AbeB5A4d0A6660667791f39263a",
  wip: "0xE6249eAfdC9C8a809fE28a5213120B1860f9a75f",
  rewards: "0xaff1A9E200000061fC3283455d8B0C7e3e728161",
  brushEvents: "0xb152f48F207d9D1C30Ff60d46E8cb8c1a5d00dEC",
  animation: "0xC59F475122e914aFCf31C0a9E0A2274666135e4E",
  metadataRegistry: "0x5104482a2Ef3a03b6270D3e931eac890b86FaD01",
  subscription: "0x75CF063a65d361527180805b244bC51c1deAb075",
} as const;

export const ENDPOINTS = {
  /** `${theme}/:day` -> `{ theme, proposer, size, palette }`. CORS enabled. */
  theme: "https://basepaint.xyz/api/theme",
  /** Ponder indexer. Queries are POSTed; a GET returns the playground. */
  graphql: "https://graphql.basepaint.xyz",
  /** Published final image, zero-padded to four digits. No CORS — Node only. */
  officialImage: "https://basepaint.net/v3",
  /** Where painting actually happens. Every page links back to it. */
  basepaint: "https://basepaint.xyz",
} as const;

/** The published PNG for a day. Read by `scripts/verify.mjs`, never by the app. */
export const officialImageUrl = (day: number): string =>
  `${ENDPOINTS.officialImage}/${String(day).padStart(4, "0")}.png`;
