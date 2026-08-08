// Addresses arrive in three different cases and the difference is not cosmetic.
// The indexer stores `accountId` checksummed and returns nothing for a
// lowercased one; `Placements.artists` interns them lowercased so a placement
// can carry a 2-byte index. Every conversion between the two goes through here.

import { getAddress, isAddress } from "viem";

/** The checksummed form, which is what the indexer stores. Null if not an address. */
export function checksumAddress(raw: string): string | null {
  const value = raw.trim();
  if (!isAddress(value, { strict: false })) return null;
  try {
    return getAddress(value);
  } catch {
    return null;
  }
}

/** The form `Placements.artists` holds. */
export const placementAddress = (raw: string): string => raw.trim().toLowerCase();

export const isSameAddress = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase();
