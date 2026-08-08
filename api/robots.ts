// /robots.txt
//
// A function rather than a file in `public/`, for one reason: the `Sitemap:`
// line has to be an absolute URL — that is the spec, and a relative one is
// ignored — and a static file cannot know which domain it is being served
// from. The rest of the file is the same two sentences it would otherwise be.

import { publicOrigin } from "./_lib/origin.js";
import { assetHeaders } from "./_lib/security.js";

// Pure string building, no network. It either answers at once or never.
export const config = { runtime: "nodejs", maxDuration: 10 };

export default function handler(request: Request): Response {
  return new Response(robots(publicOrigin(new URL(request.url))), {
    status: 200,
    headers: {
      ...assetHeaders(),
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}

export const robots = (origin: string): string => `User-agent: *
Allow: /

# Every route is a live replay of the BasePaint indexer, so there are as many
# day and artist URLs as there are days and addresses. Nothing here is secret;
# crawl what you like.

# Every day that has happened, with the date it closed. Artist pages are not
# listed — there is one per address that has ever painted, and they are reached
# from the day pages that credit them.
Sitemap: ${origin}/sitemap.xml
`;
