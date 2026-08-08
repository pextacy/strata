// /api/og — the share card, as a PNG.
//
//   /api/og?day=500                  the canvas and what is buried under it
//   /api/og?address=0x…              their most recent day and what survived
//   /api/og?address=0x…&day=500      that day in particular
//
// The day is replayed from the chain on every cold request, which is the same
// work the browser does, so the card can never show a number the app disagrees
// with. Finished days never change, so the CDN keeps the answer for a day.

import { checksumAddress } from "../src/data/address.js";
import { currentDay } from "../src/core/day-math.js";
import { artistDaySurvival } from "../src/core/survival.js";
import { fetchAccount, fetchArtistDays } from "../src/data/queries.js";
import { artistCard, dayCard, nodeDeflate } from "./_lib/card.js";
import { replayDay } from "./_lib/day.js";
import { assetHeaders } from "./_lib/security.js";

/**
 * Long enough for the work this actually does, and stated rather than inherited.
 *
 * A cold request replays a whole day: one paged fetch from the indexer, a
 * quarter of a million placements, and a PNG. That is about a second when
 * everything is healthy. What has to fit inside this number is the unhealthy
 * case — `gql` allows three attempts at 15 s each plus backoff, so a stalling
 * indexer can spend the best part of a minute before giving up with a sentence.
 * Leaving the platform default in place would have cut that off mid-retry and
 * returned a platform error page instead of the card's own fallback.
 */
export const config = { runtime: "nodejs", maxDuration: 60 };

/**
 * How long the CDN may keep a card, decided by what the card is a function of.
 *
 * There are three answers, and they used to be two — which hid a bug.
 *
 * A card *pinned to a day that has closed* is settled history. Its strokes are
 * on chain, its palette is fixed, and the replay is deterministic, so the same
 * request will draw the same picture forever. Rebuilding that daily was a
 * quarter of a million placements replayed to produce a byte-identical PNG; it
 * is now kept for a month, with a year of serving-while-revalidating behind it.
 * `CARD_VERSION` in the URL is what invalidates it when the design changes.
 *
 * A card for *today* is a moving target and stays on a five-minute leash.
 *
 * And a card that has to work out **which** day — `?address=` with no `day=` —
 * is not settled even when the day it lands on is. It answers "their most recent
 * closed canvas", which becomes a different day every time one closes. That was
 * previously cached by the settledness of the day it happened to pick, so an
 * artist who painted last night could keep serving a card for the day before for
 * up to a week. An hour, because the thing it depends on turns over daily.
 */
const SETTLED = "public, max-age=0, s-maxage=2592000, stale-while-revalidate=31536000";
const MOVING = "public, max-age=0, s-maxage=300, stale-while-revalidate=3600";
const RESOLVED = "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400";

export const cachePolicy = (day: number, pinned: boolean): string => {
  if (day >= currentDay()) return MOVING;
  return pinned ? SETTLED : RESOLVED;
};

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const rawDay = url.searchParams.get("day");
  const rawAddress = url.searchParams.get("address");

  try {
    const deflate = await nodeDeflate();

    if (rawAddress !== null) {
      const address = checksumAddress(rawAddress);
      if (address === null) return problem(`“${rawAddress}” is not an Ethereum address.`);

      // Pinned when the caller named the day; resolved when Strata had to pick.
      const pinned = rawDay !== null;
      const day = pinned ? parseDay(rawDay) : await bestArtistDay(address);
      if (day === null) {
        return problem(`${address} has not painted a canvas the indexer knows about.`);
      }

      const data = await replayDay(day);
      const survival = artistDaySurvival(data.placements, data.layers, data.size, address);
      return png(
        artistCard(data, address, survival?.survival ?? null, deflate),
        cachePolicy(day, pinned),
      );
    }

    // `/api/og` with nothing at all means today, which is never settled.
    const day = parseDay(rawDay ?? String(currentDay()));
    if (day === null) return problem(`“${rawDay}” is not a day number.`);

    const data = await replayDay(day);
    // Always pinned: a day card is about one day, either the one asked for or
    // today — and today is settled by the first branch of the policy, not by
    // this flag. Writing `rawDay !== null` here read as a distinction and was
    // not one, which is worse than no condition at all.
    return png(dayCard(data, deflate), cachePolicy(day, true));
  } catch (error) {
    // A card that cannot be drawn must not become a broken image with a 200 on
    // it — the crawler should fall back to the static card in the shell.
    return problem(error instanceof Error ? error.message : String(error), 502);
  }
}

/**
 * The most recent day of theirs that has actually finished. A survival rate on
 * a canvas still being painted is provisional — anything still on it can be
 * covered before the day closes — and a share card should not put a provisional
 * number in a headline. When today is all they have, the card says today.
 */
async function bestArtistDay(address: string): Promise<number | null> {
  const today = currentDay();
  const { days } = await fetchArtistDays(address, 5);
  const closed = days.map((d) => d.canvasId).filter((d) => d >= 1 && d < today);
  if (closed.length > 0) return Math.max(...closed);

  const account = await fetchAccount(address);
  const day = account?.lastPaintedDay ?? null;
  return day !== null && day >= 1 && day <= today ? day : null;
}

function parseDay(raw: string): number | null {
  if (!/^\d+$/.test(raw.trim())) return null;
  const day = Number(raw.trim());
  return day >= 1 && day <= currentDay() ? day : null;
}

function png(body: Uint8Array, cacheControl: string): Response {
  return new Response(body as BodyInit, {
    status: 200,
    headers: {
      ...assetHeaders(),
      "content-type": "image/png",
      "cache-control": cacheControl,
    },
  });
}

/**
 * These echo back what was asked for, so they say `nosniff`: the body is text
 * and no browser should be persuaded to treat it as anything else.
 *
 * A 400 is a verdict on the request rather than a report about the world — the
 * day number is not a day number, the address is not an address, nobody by that
 * name has ever painted — so the CDN is allowed to keep it for an hour. Without
 * that, every retry of a wrong URL reached this function, and the two the
 * indexer answers ran a fresh pair of GraphQL queries each time. There are 2^160
 * addresses to ask about and a crawler that finds one bad card link will ask
 * again; uncached, that turns Strata into a free way to hammer somebody else's
 * indexer. An hour is short enough that a first-time painter's card appears the
 * same day, which is the only case this can be briefly wrong about.
 *
 * A 502 stays out of the cache entirely. That one *is* a report about the world
 * — an upstream that was down a second ago — and caching it would keep a card
 * broken long after the thing that broke it recovered.
 */
function problem(message: string, status = 400): Response {
  return new Response(message, {
    status,
    headers: {
      ...assetHeaders(),
      "content-type": "text/plain; charset=utf-8",
      "cache-control":
        status >= 500 ? "no-store" : "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
