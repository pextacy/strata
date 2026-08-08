// An address, shortened for reading and complete on hover. The ENS name replaces
// it only once a lookup has come back and checked out; until then, and forever
// if there is no name, the raw address is what shows. Nothing here ever waits.

import { useEffect, useState } from "react";

import { knownEnsName } from "../data/ensCache.js";
import { shortAddress } from "./format.js";

export interface AddressProps {
  readonly address: string;
  /** Characters kept at each end. */
  readonly keep?: number;
  /** Skip the ENS lookup — for lists long enough that the names are noise. */
  readonly raw?: boolean;
}

export function Address({ address, keep = 4, raw = false }: AddressProps) {
  const clean = address.trim();
  const [name, setName] = useState<string | null>(() => knownEnsName(clean) ?? null);

  useEffect(() => {
    if (raw) return;
    const known = knownEnsName(clean);
    if (known !== undefined) {
      setName(known);
      return;
    }

    let live = true;
    setName(null);
    // The resolver is fetched here rather than imported at the top, because it
    // brings viem with it — 87 kB of the bundle, for a decoration. The canvas
    // is on screen before any of this is asked for, and a page whose addresses
    // all resolved earlier in the session never asks at all.
    void import("../data/ens.js")
      .then(async ({ ensName }) => await ensName(clean))
      .then((resolved) => {
        if (live) setName(resolved);
      })
      // A name is decoration and a failure is silent by design — including the
      // failure to load the code that would have resolved one.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [clean, raw]);

  return (
    <code className="address" title={clean}>
      {name ?? shortAddress(clean, keep)}
    </code>
  );
}
