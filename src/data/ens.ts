// ENS names, resolved against mainnet and remembered for the session.
//
// A name is decoration: the address is the fact. So every lookup starts from the
// address already on screen, a failure is silent, and nothing on the page waits
// for one. Names are a reverse record plus a forward check — a reverse record
// alone can claim any name, and crediting an artist by a name they do not own
// would be worse than showing the hex.

import { createPublicClient, fallback, http, type Address } from "viem";
import { mainnet } from "viem/chains";

import { knownEnsName, rememberEnsName } from "./ensCache.js";

/**
 * ENS lives on mainnet, and Strata has no key for it, so it reads from public
 * endpoints. The chain's own default is not one of them: viem currently ships
 * `https://ethereum.reth.rs/rpc` for mainnet and that host refuses the request,
 * which resolved every name to null — and because a failed lookup is silent by
 * design, it looked exactly like an artist who has no ENS name. Both endpoints
 * below were checked to return `vitalik.eth` for its address; `fallback` moves
 * on when one of them stops.
 *
 * Set `VITE_MAINNET_RPC` to use your own instead.
 */
const RPCS = ["https://eth.drpc.org", "https://ethereum-rpc.publicnode.com"];

const configured: string | undefined = import.meta.env.VITE_MAINNET_RPC;

const client = createPublicClient({
  chain: mainnet,
  transport: fallback(
    (configured !== undefined && configured !== "" ? [configured, ...RPCS] : RPCS).map((url) =>
      http(url, { timeout: 8_000 }),
    ),
  ),
});

const inFlight = new Map<string, Promise<string | null>>();

const isAddress = (value: string): value is Address => /^0x[0-9a-fA-F]{40}$/.test(value);

/**
 * The ENS name for an address, or null when it has none — which is the common
 * case and not an error. Concurrent callers for the same address share one
 * request, so a canvas full of the same painter costs one lookup.
 */
export function ensName(address: string): Promise<string | null> {
  const key = address.toLowerCase();

  const cached = knownEnsName(key);
  if (cached !== undefined) return Promise.resolve(cached);

  const pending = inFlight.get(key);
  if (pending !== undefined) return pending;

  if (!isAddress(key)) {
    rememberEnsName(key, null);
    return Promise.resolve(null);
  }

  const lookup = client
    .getEnsName({ address: key })
    .then(async (name) => {
      if (name === null) return null;
      // Forward check: the name must point back at this address.
      const forward = await client.getEnsAddress({ name });
      return forward !== null && forward.toLowerCase() === key ? name : null;
    })
    .catch(() => null)
    .then((name) => {
      rememberEnsName(key, name);
      inFlight.delete(key);
      return name;
    });

  inFlight.set(key, lookup);
  return lookup;
}
