/**
 * The parts of minting that do not touch a chain: what the sale window means,
 * what a price reads as, and whether there is a wallet in this browser at all.
 *
 * These are split out from `mint.ts` for one reason. Everything in that file
 * needs viem, viem is 87 kB of the gzipped bundle, and the mint button is the
 * one thing on a day page that most visitors will never press — most day pages
 * are of canvases that left their sale window years ago. Keeping the pure half
 * here lets the button render, and rule itself out, before any of that is
 * fetched. `mint.ts` is loaded on demand, when there is actually something to
 * sign.
 *
 * Nothing here may import viem, or the split is undone silently. There is a
 * test that says so.
 */

/** An EIP-1193 provider, which is what a browser wallet injects. */
export interface InjectedProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

export const injectedProvider = (): InjectedProvider | null => {
  const eth = (globalThis as { ethereum?: InjectedProvider }).ethereum;
  return eth ?? null;
};

export interface MintTerms {
  /** Wei per edition, from `openEditionPrice()`. */
  readonly price: bigint;
  /** The day the contract is currently taking pixels for. */
  readonly openDay: number;
  /** Seconds a canvas is open, from `epochDuration()`. Sale runs for the same. */
  readonly epochDuration: number;
  /** Unix seconds the whole thing started. */
  readonly startedAt: number;
}

/**
 * A canvas is on sale for one epoch after it closes — the day that just ended is
 * the one being sold while the next one is painted. Taken from the contract's
 * own `today()` rather than from the wall clock, so the button is never open on
 * a day the contract would revert on.
 */
export const isOnSale = (day: number, terms: MintTerms): boolean => day === terms.openDay - 1;

/** Seconds until this canvas leaves its sale window, or 0 once it has. */
export function saleEndsIn(day: number, terms: MintTerms, nowSec: number): number {
  const closesAt = terms.startedAt + (day + 1) * terms.epochDuration;
  return Math.max(0, closesAt - nowSec);
}

export class MintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MintError";
  }
}

/**
 * Wei as a short ETH string. Four decimals is enough for an open edition, which
 * has cost thousandths of an ETH for its whole history.
 *
 * The one thing this must never do is print a price of zero for a price that is
 * not zero. Truncating at four decimals did exactly that below 0.0001 ETH, and
 * "Mint for 0 ETH" on a button that spends money is the worst sentence in the
 * app.
 */
export function formatEth(wei: bigint): string {
  const negative = wei < 0n;
  const value = negative ? -wei : wei;
  const whole = value / 10n ** 18n;
  const rest = value % 10n ** 18n;
  const decimals = rest.toString().padStart(18, "0").slice(0, 4).replace(/0+$/, "");
  if (decimals === "" && whole === 0n && value > 0n) return "<0.0001";
  const sign = negative ? "-" : "";
  return decimals === "" ? `${sign}${whole}` : `${sign}${whole}.${decimals}`;
}
