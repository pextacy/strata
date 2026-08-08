/**
 * Minting a canvas, through `BasePaintRewards` so that the referrer earns half
 * the protocol fee. A collector who has just read the provenance of a day is
 * exactly the person who mints it, which is why the button lives on the day
 * page rather than on a page of its own.
 *
 * Everything here reads the chain for its facts: the price, which day is open,
 * and how long a canvas stays on sale. Nothing is assumed from the clock.
 *
 * Everything here also needs viem, which is why the sale-window arithmetic and
 * the price formatting live in `mintTerms.ts` instead: this module is imported
 * on demand, at the moment there is something to read or sign, and a day page
 * that nobody mints from never loads it at all.
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
} from "./rewards.js";
import { MintError, injectedProvider, type MintTerms } from "./mintTerms.js";

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

