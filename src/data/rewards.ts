/**
 * The two contract interfaces Strata touches, copied verbatim from the verified
 * sources — not written from memory, which is the one way to get an ABI subtly
 * and expensively wrong.
 *
 * Provenance, both on Base (chain 8453), fetched from Sourcify's verified
 * repository on 2026-08-08:
 *
 *   BasePaintRewards 0xaff1A9E200000061fC3283455d8B0C7e3e728161
 *   BasePaint        0xBa5e05cb26b78eDa3A2f8e3b3814726305dcAc83
 *
 *   curl "https://sourcify.dev/server/v2/contract/8453/<address>?fields=abi"
 *
 * Only the entries this app calls are kept. Nothing here was edited by hand
 * beyond deleting the functions Strata does not use.
 */

export const REWARDS_ADDRESS = "0xaff1A9E200000061fC3283455d8B0C7e3e728161" as const;
export const BASEPAINT_ADDRESS = "0xBa5e05cb26b78eDa3A2f8e3b3814726305dcAc83" as const;

/** Base mainnet. The only chain BasePaint is on. */
export const BASE_CHAIN_ID = 8453;

export const REWARDS_ABI = [
  {
    name: "mint",
    type: "function",
    inputs: [
      { name: "tokenId", type: "uint256", internalType: "uint256" },
      { name: "sendMintsTo", type: "address", internalType: "address" },
      { name: "count", type: "uint256", internalType: "uint256" },
      { name: "sendRewardsTo", type: "address", internalType: "address" },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    name: "mintLatest",
    type: "function",
    inputs: [
      { name: "sendMintsTo", type: "address", internalType: "address" },
      { name: "count", type: "uint256", internalType: "uint256" },
      { name: "sendRewardsTo", type: "address", internalType: "address" },
    ],
    outputs: [],
    stateMutability: "payable",
  },
] as const;

export const BASEPAINT_ABI = [
  {
    name: "openEditionPrice",
    type: "function",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
  {
    name: "today",
    type: "function",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
  {
    name: "epochDuration",
    type: "function",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
  {
    name: "startedAt",
    type: "function",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
] as const;
