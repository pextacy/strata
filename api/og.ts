// /api/og — the share card, as a PNG.
//
//   /api/og?day=500                  the canvas and what is buried under it
//   /api/og?address=0x…              their most recent day and what survived
//   /api/og?address=0x…&day=500      that day in particular
//
// The day is replayed from the chain on every cold request, which is the same
// work the browser does, so the card can never show a number the app disagrees
// with. Finished days never change, so the CDN keeps the answer for a day.

import { checksumAddress } from "../src/data/address.ts";
import { currentDay } from "../src/core/day-math.ts";
import { artistDaySurvival } from "../src/core/survival.ts";
import { fetchAccount, fetchArtistDays } from "../src/data/queries.ts";
import { artistCard, dayCard, nodeDeflate } from "./_lib/card.ts";
import { replayDay } from "./_lib/day.ts";

export const config = { runtime: "nodejs" };

/** A finished day is settled history; today is still being painted. */
const cacheFor = (day: number): string =>
  day < currentDay()
    ? "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800"
    : "public, max-age=0, s-maxage=300, stale-while-revalidate=3600";

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const rawDay = url.searchParams.get("day");
  const rawAddress = url.searchParams.get("address");

  try {
    const deflate = await nodeDeflate();

    if (rawAddress !== null) {
      const address = checksumAddress(rawAddress);
      if (address === null) return problem(`“${rawAddress}” is not an Ethereum address.`);

      const day = rawDay === null ? await bestArtistDay(address) : parseDay(rawDay);
      if (day === null) {
        return problem(`${address} has not painted a canvas the indexer knows about.`);
      }

      const data = await replayDay(day);
      const survival = artistDaySurvival(data.placements, data.layers, data.size, address);
      return png(artistCard(data, address, survival?.survival ?? null, deflate), cacheFor(day));
    }

    const day = parseDay(rawDay ?? String(currentDay()));
    if (day === null) return problem(`“${rawDay}” is not a day number.`);

    const data = await replayDay(day);
    return png(dayCard(data, deflate), cacheFor(day));
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
      "content-type": "image/png",
      "cache-control": cacheControl,
      "x-content-type-options": "nosniff",
    },
  });
}

/**
 * These echo back what was asked for, so they say `nosniff`: the body is text
 * and no browser should be persuaded to treat it as anything else.
 */
function problem(message: string, status = 400): Response {
  return new Response(message, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
