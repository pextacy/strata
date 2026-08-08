// Every page request comes through here, because crawlers do not run the SPA
// router: they read the HTML they are handed and nothing else. This takes the
// built shell and puts the right title, description and card on it for the route
// being asked for, then hands the same shell to the browser to hydrate.
//
// It never invents a fact. The only value it fetches is the day's theme name,
// and when that call fails the tags fall back to the day number alone.

import { checksumAddress } from "../src/data/address.ts";
import { currentDay } from "../src/core/day-math.ts";
import { fetchTheme } from "../src/data/theme.ts";
import { assetOrigin, publicOrigin } from "./_lib/origin.ts";
import { assetHeaders, documentHeaders } from "./_lib/security.ts";

export const config = { runtime: "nodejs" };

const SITE = "Strata";
const TAGLINE =
  "Every BasePaint canvas is a stack of paintings, and only the top one has ever been visible.";

export interface Meta {
  readonly title: string;
  readonly description: string;
  /** Query string for /api/og, or null for the routes with no card of their own. */
  readonly card: string | null;
  readonly cacheControl: string;
  /**
   * The status the response goes out with. The app is one HTML document for
   * every route, so without this every wrong URL would answer 200 — a soft 404,
   * which tells a crawler that `/day/99999` and `/artist/vitalik` are real pages
   * worth indexing and keeping. They are not, and the SPA already says so on
   * screen; this makes the status agree with the sentence.
   */
  readonly status: number;
}

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const meta = await metaFor(url.pathname);

  let shell: string;
  try {
    shell = await loadShell(url);
  } catch (error) {
    // Without the shell there is no app to serve, so this is a real outage — but
    // it is still owed a sentence rather than a platform error page, and it must
    // not be cached on the way out.
    return new Response(
      "Strata could not load its own page. This is a problem at our end, not with the link — try again in a moment.",
      {
        status: 503,
        headers: {
          ...assetHeaders(),
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
          "x-strata-detail": detail(error),
        },
      },
    );
  }

  const html = injectMeta(shell, meta, publicOrigin(url), url.pathname);

  return new Response(html, {
    status: meta.status,
    headers: {
      ...documentHeaders(),
      "content-type": "text/html; charset=utf-8",
      "cache-control": meta.cacheControl,
    },
  });
}

/** One line, header-safe: no newlines, no control bytes, nothing exotic. */
const detail = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error))
    .replace(/[^\x20-\x7e]+/g, " ")
    .slice(0, 200);

export async function metaFor(pathname: string): Promise<Meta> {
  const day = matchDay(pathname);
  if (day !== null) {
    const theme = await themeName(day);
    const settled = day < currentDay();
    return {
      title: theme === null ? `Day ${day} — ${SITE}` : `Day ${day}: ${theme} — ${SITE}`,
      description: settled
        ? `Day ${day} of BasePaint, replayed from the chain: what survived, what is buried under it, and who painted which pixel.`
        : `Day ${day} of BasePaint is being painted right now. Watch the layers stack up, stroke by stroke.`,
      card: `day=${day}`,
      cacheControl: settled
        ? "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800"
        : "public, max-age=0, s-maxage=120, stale-while-revalidate=600",
      status: 200,
    };
  }

  const address = matchArtist(pathname);
  if (address !== null) {
    return {
      title: `${shorten(address)} — ${SITE}`,
      description: `How much of what ${shorten(address)} painted on BasePaint is still on the canvas, who covered them, and who they covered.`,
      card: `address=${address}`,
      cacheControl: "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
      status: 200,
    };
  }

  if (pathname === "/" || pathname === "") {
    return {
      title: `${SITE} — what is buried in a BasePaint canvas`,
      description: `${TAGLINE} Strata replays the on-chain strokes and digs out the rest.`,
      card: `day=${currentDay()}`,
      cacheControl: "public, max-age=0, s-maxage=300, stale-while-revalidate=3600",
      status: 200,
    };
  }

  // Not a route. This is the same answer the app gives on screen, and it says
  // the same thing to a crawler: the words come from `NotFound`, the status
  // from here. Kept out of the CDN for long, because a URL that is wrong today
  // — a day that has not opened yet, most of all — can be right tomorrow.
  return {
    title: `No such page — ${SITE}`,
    description: `Strata has a page per BasePaint day and a page per artist. This is neither.`,
    card: null,
    cacheControl: "public, max-age=0, s-maxage=60",
    status: 404,
  };
}

export const matchDay = (pathname: string): number | null => {
  const match = /^\/day\/(\d+)\/?$/.exec(pathname);
  if (match === null) return null;
  const day = Number(match[1]);
  return day >= 1 && day <= currentDay() ? day : null;
};

export const matchArtist = (pathname: string): string | null => {
  const match = /^\/artist\/([^/]+)\/?$/.exec(pathname);
  if (match === null) return null;
  // `/artist/%` is a path a crawler will eventually ask for, and
  // decodeURIComponent throws a URIError on it. Unescapable is not an address —
  // it is the same answer as any other path that is not one, not a 500.
  let decoded: string;
  try {
    decoded = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  return checksumAddress(decoded);
};

async function themeName(day: number): Promise<string | null> {
  try {
    const theme = await fetchTheme(day, { attempts: 1 });
    return theme.theme;
  } catch {
    // A missing theme name is not a reason to serve a broken page.
    return null;
  }
}

/**
 * The built `index.html`, which Vercel serves as a static file — rewrites only
 * apply to paths that do not match one, so asking for it here cannot loop back
 * into this function.
 */
async function loadShell(url: URL): Promise<string> {
  const res = await fetch(new URL("/index.html", assetOrigin(url)), {
    headers: { "user-agent": "strata-html-shell" },
  });
  if (!res.ok) throw new Error(`the built shell answered ${res.status}`);
  return await res.text();
}

export function injectMeta(shell: string, meta: Meta, origin: string, pathname: string): string {
  const canonical = `${origin}${pathname}`;
  const image = meta.card === null ? null : `${origin}/api/og?${meta.card}`;

  const tags = [
    `<title>${escapeHtml(meta.title)}</title>`,
    tag("description", meta.description),
    // Belt and braces on a page that is not one. The status alone is enough for
    // a crawler that reads it; this is for the ones that do not, and for the
    // preview cards that render a link before anybody follows it.
    ...(meta.status === 200 ? [] : [tag("robots", "noindex, follow")]),
    `<link rel="canonical" href="${escapeAttr(canonical)}" />`,
    property("og:type", "website"),
    property("og:site_name", SITE),
    property("og:title", meta.title),
    property("og:description", meta.description),
    property("og:url", canonical),
    tag("twitter:title", meta.title),
    tag("twitter:description", meta.description),
    ...(image === null
      ? [tag("twitter:card", "summary")]
      : [
          property("og:image", image),
          property("og:image:width", "1200"),
          property("og:image:height", "630"),
          tag("twitter:card", "summary_large_image"),
          tag("twitter:image", image),
        ]),
  ].join("\n    ");

  // The shell ships with a full set of these already, for the routes Vercel
  // serves straight from disk. They are replaced rather than added to, so a
  // crawler never has two titles or two cards to choose between.
  const stripped = shell
    .replace(/<title>[\s\S]*?<\/title>/i, "")
    .replace(
      /<meta[^>]*(?:property="og:[^"]*"|name="twitter:[^"]*"|name="description")[^>]*>/gi,
      "",
    );

  // A shell with no </head> is a broken build, not a broken request. Serving the
  // app without per-route meta is worse for a crawler and no worse for a person;
  // failing the page would be worse for both.
  if (!/<\/head>/i.test(stripped)) return stripped;
  return stripped.replace(/<\/head>/i, `    ${tags}\n  </head>`);
}

const tag = (name: string, content: string): string =>
  `<meta name="${escapeAttr(name)}" content="${escapeAttr(content)}" />`;

const property = (name: string, content: string): string =>
  `<meta property="${escapeAttr(name)}" content="${escapeAttr(content)}" />`;

/** Theme names are proposed by people. They are text, never markup. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const escapeAttr = (value: string): string => escapeHtml(value).replace(/"/g, "&quot;");

const shorten = (address: string): string =>
  address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
