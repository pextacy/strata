/**
 * Minting a canvas, through `BasePaintRewards` so that the referrer earns half
 * the protocol fee. A collector who has just read the provenance of a day is
 * exactly the person who mints it, which is why the button lives on the day
 * page rather than on a page of its own.
 *
 * Everything here reads the chain for its facts: the price, which day is open,
 * and how long a canvas stays on sale. Nothing is assumed from the clock.
 */

import {
  createPublicClient,
  createWalletClient,
  custom,
  getAddress,
  http,
  isAddress,
  type Address,
  type Hex,
} from "viem";
import { base } from "viem/chains";

import {
  BASEPAINT_ABI,
  BASEPAINT_ADDRESS,
  BASE_CHAIN_ID,
  REWARDS_ABI,
  REWARDS_ADDRESS,
} from "./rewards.ts";

/** An EIP-1193 provider, which is what a browser wallet injects. */
export interface InjectedProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

export const injectedProvider = (): InjectedProvider | null => {
  const eth = (globalThis as { ethereum?: InjectedProvider }).ethereum;
  return eth ?? null;
};

const RPC: string | undefined = import.meta.env.VITE_BASE_RPC;

/**
 * Who earns the referral share. Unset is a normal state, not a broken one: the
 * mint goes through and simply pays no referrer. A malformed address is dropped
 * rather than sent, because the contract would take it at face value.
 */
export function referrerAddress(): Address | undefined {
  const raw: string | undefined = import.meta.env.VITE_REFERRER_ADDRESS;
  if (raw === undefined || !isAddress(raw.trim(), { strict: false })) return undefined;
  return getAddress(raw.trim());
}

export const publicClient = () =>
  createPublicClient({ chain: base, transport: http(RPC) });

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
 * All four in one `eth_call` through Multicall3, rather than four requests that
 * race each other into the same rate limit. Base's default public endpoint
 * answers about half of a burst of four with a 429, and one rejection is enough
 * to hide the mint on the single day a canvas is ever on sale.
 */
export async function fetchMintTerms(): Promise<MintTerms> {
  const client = publicClient();
  const call = (functionName: "openEditionPrice" | "today" | "epochDuration" | "startedAt") =>
    ({ address: BASEPAINT_ADDRESS, abi: BASEPAINT_ABI, functionName }) as const;

  const [price, today, epochDuration, startedAt] = await client.multicall({
    contracts: [call("openEditionPrice"), call("today"), call("epochDuration"), call("startedAt")],
    // A canvas whose price cannot be read is not a canvas to offer for sale.
    allowFailure: false,
  });

  return {
    price,
    openDay: Number(today),
    epochDuration: Number(epochDuration),
    startedAt: Number(startedAt),
  };
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

export interface MintRequest {
  readonly day: number;
  readonly count: number;
  /**
   * Who signs and pays. This has to be an account the wallet actually holds —
   * anything else and the wallet has no key to sign with.
   */
  readonly account: Address;
  /**
   * Where the editions go. Defaults to the payer. Kept separate because the
   * contract takes it separately: `sendMintsTo` is an argument, not the sender,
   * and passing one as the other would charge the wrong address the moment
   * these two are ever allowed to differ.
   */
  readonly to?: Address;
  /** Who earns the referral share. Absent means the mint carries no referrer. */
  readonly referrer?: Address;
  readonly price: bigint;
}

export class MintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MintError";
  }
}

/** The connected account, asking the wallet to connect if it has not already. */
export async function connect(): Promise<Address> {
  const provider = injectedProvider();
  if (provider === null) {
    throw new MintError("No wallet in this browser. Mint on basepaint.xyz instead.");
  }
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as Address[];
  const account = accounts[0];
  if (account === undefined) throw new MintError("The wallet did not share an account.");
  return account;
}

/**
 * Sends the mint and returns the transaction hash. The rewards contract takes
 * the referrer as an argument — this is the referral path DOCS.md §13 describes,
 * done on chain rather than as a link parameter.
 */
export async function mintDay(request: MintRequest): Promise<Hex> {
  const provider = injectedProvider();
  if (provider === null) {
    throw new MintError("No wallet in this browser. Mint on basepaint.xyz instead.");
  }
  if (!Number.isInteger(request.count) || request.count < 1) {
    throw new MintError("Mint at least one edition.");
  }
  if (!Number.isInteger(request.day) || request.day < 1) {
    throw new MintError("That is not a canvas anyone can mint.");
  }

  const wallet = createWalletClient({ chain: base, transport: custom(provider) });
  await ensureBase(wallet);

  return await wallet.writeContract({
    account: request.account,
    address: REWARDS_ADDRESS,
    abi: REWARDS_ABI,
    functionName: "mint",
    args: [
      BigInt(request.day),
      request.to ?? request.account,
      BigInt(request.count),
      // No referrer configured is not an error: the mint still works, it simply
      // pays nobody. Sending the minter's own address would be a lie about who
      // referred it.
      request.referrer ?? "0x0000000000000000000000000000000000000000",
    ],
    value: request.price * BigInt(request.count),
    chain: base,
  });
}

async function ensureBase(wallet: {
  getChainId: () => Promise<number>;
  switchChain: (args: { id: number }) => Promise<void>;
}): Promise<void> {
  const chainId = await wallet.getChainId();
  if (chainId === BASE_CHAIN_ID) return;
  try {
    await wallet.switchChain({ id: BASE_CHAIN_ID });
  } catch {
    throw new MintError("This wallet is not on Base. Switch networks and try again.");
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
