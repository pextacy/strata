// The two share cards, from replayed buffers to PNG bytes. Every number on a
// card is computed here from the same buffers the app draws, so a card can be
// checked against the page it links to.

import { artistIndex } from "../../src/core/survival.js";
import { paintLayer } from "../../src/render/layers.js";
import { encodePng, type Deflate } from "../../src/render/png.js";
import {
  asGround,
  claimedPixels,
  over,
  renderShareCard,
  type CardPanel,
} from "../../src/render/shareCard.js";
import type { ServerDay } from "./day.js";

/** node:zlib when it is there, uncompressed deflate when it is not. */
export async function nodeDeflate(): Promise<Deflate | undefined> {
  try {
    const zlib = await import("node:zlib");
    return (data: Uint8Array) => new Uint8Array(zlib.deflateSync(data));
  } catch {
    return undefined;
  }
}

function panel(label: string, pixels: Uint32Array, size: number, strong = false): CardPanel {
  return { label, pixels, size, strong };
}

/**
 * The day card: what the canvas ended as, and what is buried under it. The
 * number is the count of buried placements — the pixels the ghost panel is
 * drawing, said out loud, so the picture and the figure are the same fact.
 */
export function dayCard(data: ServerDay, deflate?: Deflate): Uint8Array {
  const { layers, rgba, stats, size } = data;
  const cells = size * size;

  const final = paintLayer(new Uint32Array(cells), "final", layers, rgba, stats.maxDepth);
  const ghost = paintLayer(new Uint32Array(cells), "ghost", layers, rgba, stats.maxDepth);

  const surface = renderShareCard({
    title: `DAY ${data.day} · ${data.theme.theme}`,
    panels: [
      panel("WHAT SURVIVED THE DAY", final, size),
      panel(
        stats.buriedPlacements === 0
          ? "NOTHING WAS BURIED"
          : `${format(stats.buriedPlacements)} PIXELS BURIED`,
        ghost,
        size,
        true,
      ),
    ],
  });

  return encodePng(surface.pixels, surface.width, surface.height, { deflate });
}

/**
 * The artist card: the day beside the part of it that is still theirs, and their
 * survival rate on that day. An artist who painted nothing that survived gets a
 * card that says so — it is a true number, and it is still their day.
 */
export function artistCard(
  data: ServerDay,
  address: string,
  survivalRate: number | null,
  deflate?: Deflate,
): Uint8Array {
  const { layers, rgba, stats, size, placements } = data;
  const cells = size * size;

  const final = paintLayer(new Uint32Array(cells), "final", layers, rgba, stats.maxDepth);
  const index = artistIndex(placements, address);
  // Their surviving pixels can be a scatter of dots across a busy canvas. Laid
  // over the day pushed down into the background, the shape of what they painted
  // reads; on its own it looks like an empty card.
  const theirs =
    index < 0
      ? asGround(final)
      : over(asGround(final), claimedPixels(layers, rgba, index));

  const surface = renderShareCard({
    title: `${short(address)} · DAY ${data.day}`,
    panels: [
      panel(data.theme.theme, final, size),
      panel(
        survivalRate === null
          ? "NOT ON THIS CANVAS"
          : `${Math.round(survivalRate * 100)}% STILL THEIRS`,
        theirs,
        size,
        true,
      ),
    ],
  });

  return encodePng(surface.pixels, surface.width, surface.height, { deflate });
}

const format = (n: number): string => n.toLocaleString("en-US");

/** The font has no lowercase, so the address is cut to the part that reads. */
const short = (address: string): string =>
  address.length > 12 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address;
