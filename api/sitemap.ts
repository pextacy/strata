// /sitemap.xml — every day that has happened, and nothing else.
//
// A crawler that finds the homepage can reach yesterday, and from yesterday the
// day before, one step at a time. That is a long way to walk to reach day 1, and
// nothing links to the middle of the archive at all. This lists every day
// directly, with the date it closed, so an indexer knows both that day 40 exists
// and that it is never going to change again.
//
// Artist pages are deliberately absent. There is one per address that has ever
// painted, they are discovered from the day pages that link to them, and there
// is no way to enumerate them without asking the indexer for every account —
// which is a lot of work to publish a list nobody asked for.

import { currentDay, dayEnd } from "../src/core/day-math.ts";
import { publicOrigin } from "./_lib/origin.ts";
import { assetHeaders } from "./_lib/security.ts";

// Pure string building, no network. It either answers at once or never.
export const config = { runtime: "nodejs", maxDuration: 10 };

/**
 * The sitemap protocol's ceiling is 50,000 URLs in one file. BasePaint gains one
 * day per day, so this is decades away — but a limit that is never checked is a
 * limit that fails silently on the day it is reached, and a truncated sitemap
 * looks exactly like a complete one.
 */
const MAX_URLS = 50_000;

export default function handler(request: Request): Response {
  const origin = publicOrigin(new URL(request.url));

  return new Response(sitemap(origin, currentDay()), {
    status: 200,
    headers: {
      ...assetHeaders(),
      "content-type": "application/xml; charset=utf-8",
      // A day's worth: the only thing that changes is one more day on the end.
      "cache-control": "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}

export function sitemap(origin: string, today: number): string {
  const entries: string[] = [url(`${origin}/`)];

  // Newest first, so that a crawler reading only the head of the file gets the
  // days most likely to have been linked to today.
  const oldest = Math.max(1, today - MAX_URLS + 2);
  for (let day = today; day >= oldest; day--) {
    // Today has not closed, so it has no last-modified date to state: it is
    // being repainted continuously until midnight UTC.
    entries.push(url(`${origin}/day/${day}`, day < today ? iso(dayEnd(day)) : undefined));
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join("\n")}
</urlset>
`;
}

function url(loc: string, lastmod?: string): string {
  const modified = lastmod === undefined ? "" : `<lastmod>${lastmod}</lastmod>`;
  return `  <url><loc>${escapeXml(loc)}</loc>${modified}</url>`;
}

/** Whole days, so W3C date format is enough and every entry is stable. */
const iso = (seconds: number): string => new Date(seconds * 1000).toISOString().slice(0, 10);

/**
 * The origin comes from an environment variable and the paths are numbers, so
 * nothing here should ever need escaping. It is escaped anyway: a sitemap that
 * is not well-formed XML is not read at all, and finding that out from a search
 * console weeks later is the expensive way.
 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
