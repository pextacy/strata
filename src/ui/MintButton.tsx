// A canvas is on sale for one day after it closes, and the person reading its
// provenance is the person most likely to want it. The button only exists while
// the sale window is open, it names the price it read from the contract, and it
// falls back to basepaint.xyz where there is no wallet to sign with.

import { useCallback, useEffect, useState } from "react";

import { currentDay } from "../core/day-math.js";
import { basepaintDayUrl } from "../data/links.js";
import {
  MintError,
  formatEth,
  injectedProvider,
  isOnSale,
  saleEndsIn,
  type MintTerms,
} from "../data/mintTerms.js";
import "../styles/mint.css";

/**
 * Everything that talks to Base is behind this, and it is only ever awaited —
 * never imported at the top of the file. `../data/mint.ts` brings viem, which
 * is 87 kB gzipped and the single largest thing the app could load; a day page
 * for a canvas that left its sale window years ago, which is nearly all of
 * them, now renders without any of it. The sale-window arithmetic that decides
 * whether this button appears at all lives in `mintTerms.ts` and costs nothing.
 */
const chain = () => import("../data/mint.js");

export interface MintButtonProps {
  readonly day: number;
}

type Terms =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly terms: MintTerms }
  | { readonly status: "failed"; readonly message: string };

type Tx =
  | { readonly status: "idle" }
  | { readonly status: "signing" }
  | { readonly status: "pending"; readonly hash: string }
  | { readonly status: "done"; readonly hash: string }
  | { readonly status: "failed"; readonly message: string };

const hoursLeft = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  if (hours >= 1) return `${hours} more ${hours === 1 ? "hour" : "hours"}`;
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes} more ${minutes === 1 ? "minute" : "minutes"}`;
};

export function MintButton({ day }: MintButtonProps) {
  const [terms, setTerms] = useState<Terms>({ status: "loading" });
  const [count, setCount] = useState(1);
  const [tx, setTx] = useState<Tx>({ status: "idle" });

  useEffect(() => {
    // Day 500 has not been mintable for years, and reading Base to be told so
    // costs the person opening it a round trip. The arithmetic day only rules
    // out the ones that cannot possibly be on sale — with a day of slack, since
    // the contract's own `today()` is what actually decides.
    if (day < currentDay() - 2) {
      setTerms({ status: "failed", message: "This canvas left its sale window long ago." });
      return;
    }

    let live = true;
    setTerms({ status: "loading" });
    chain()
      .then(async ({ fetchMintTerms }) => await fetchMintTerms())
      .then((value) => live && setTerms({ status: "ready", terms: value }))
      .catch((error: unknown) => {
        if (!live) return;
        setTerms({
          status: "failed",
          message: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      live = false;
    };
  }, [day]);

  const mint = useCallback(async () => {
    if (terms.status !== "ready") return;
    setTx({ status: "signing" });
    try {
      const { connect, mintDay, publicClient, referrerAddress } = await chain();
      const account = await connect();
      const hash = await mintDay({
        day,
        count,
        account,
        referrer: referrerAddress(),
        price: terms.terms.price,
      });
      setTx({ status: "pending", hash });
      const receipt = await publicClient().waitForTransactionReceipt({ hash });
      setTx(
        receipt.status === "success"
          ? { status: "done", hash }
          : { status: "failed", message: "Base rejected the transaction." },
      );
    } catch (error: unknown) {
      setTx({ status: "failed", message: readableFailure(error) });
    }
  }, [terms, day, count]);

  // Nothing to say about a canvas that is not for sale. The page stays quiet.
  if (terms.status === "loading" || terms.status === "failed") return null;
  if (!isOnSale(day, terms.terms)) return null;

  const left = saleEndsIn(day, terms.terms, Math.floor(Date.now() / 1000));
  const price = formatEth(terms.terms.price);
  const total = formatEth(terms.terms.price * BigInt(count));
  const hasWallet = injectedProvider() !== null;

  return (
    <section className="mint" aria-label={`Mint day ${day}`}>
      <p className="mint-line">
        Day {day} is on sale for {hoursLeft(left)}. {price} ETH an edition, split between the
        artists who painted it.
      </p>

      {hasWallet ? (
        <div className="mint-controls">
          <label className="mint-count">
            <span>Editions</span>
            <input
              type="number"
              min={1}
              max={50}
              value={count}
              onChange={(event) => setCount(clampCount(event.target.value))}
              disabled={tx.status === "signing" || tx.status === "pending"}
            />
          </label>
          <button
            type="button"
            className="mint-go"
            onClick={() => void mint()}
            disabled={tx.status === "signing" || tx.status === "pending"}
          >
            {tx.status === "signing"
              ? "Check your wallet…"
              : tx.status === "pending"
                ? "Waiting for Base…"
                : `Mint for ${total} ETH`}
          </button>
        </div>
      ) : (
        <p className="mint-line">
          <a href={basepaintDayUrl(day)}>Mint day {day} on basepaint.xyz</a> — there is no wallet
          in this browser to sign with.
        </p>
      )}

      {tx.status === "pending" && (
        <p className="mint-note" role="status">
          Sent. <a href={txUrl(tx.hash)}>Follow it on BaseScan</a> while Base confirms it.
        </p>
      )}
      {tx.status === "done" && (
        <p className="mint-note mint-good" role="status">
          Minted. <a href={txUrl(tx.hash)}>The transaction is here.</a>
        </p>
      )}
      {tx.status === "failed" && (
        <p className="mint-note mint-bad" role="alert">
          {tx.message}
        </p>
      )}
    </section>
  );
}

const clampCount = (raw: string): number => {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return 1;
  return Math.min(50, Math.max(1, value));
};

const txUrl = (hash: string): string => `https://basescan.org/tx/${hash}`;

/** Wallet errors are long and technical. These are the ones worth translating. */
function readableFailure(error: unknown): string {
  if (error instanceof MintError) return error.message;
  const message = error instanceof Error ? error.message : String(error);
  if (/user rejected|denied|rejected the request/i.test(message)) {
    return "You cancelled the mint. Nothing was sent.";
  }
  if (/insufficient funds/i.test(message)) {
    return "That wallet does not hold enough ETH on Base for this mint.";
  }
  return `The mint did not go through: ${message.split("\n")[0]}`;
}
