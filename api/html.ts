// Every page request comes through here, because crawlers do not run the SPA
// router: they read the HTML they are handed and nothing else. This takes the
// built shell and puts the right title, description and card on it for the route
// being asked for, then hands the same shell to the browser to hydrate.
//
// It never invents a fact. The only value it fetches is the day's theme name,
// and when that call fails the tags fall back to the day number alone.

import { checksumAddress } from "../src/data/address.js";
import { currentDay } from "../src/core/day-math.js";
import { fetchTheme } from "../src/data/theme.js";
import { CARD_VERSION } from "./_lib/cardVersion.js";
import { assetOrigin, publicOrigin } from "./_lib/origin.js";
import { assetHeaders, documentHeaders } from "./_lib/security.js";

/**
 * This one fetches its own shell and, for a day route, one theme name — both
 * small and both on short clocks (5 s for the shell, one attempt for the theme).
 * It has no reason to live as long as the card function does, and a page that
 * cannot be built quickly is better answered than waited on.
 */
export const config = { runtime: "nodejs", maxDuration: 20 };

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
  /**
   * The one spelling of this page's URL, which is what the canonical link and
   * `og:url` name — never the path as it was asked for.
   *
   * An address has three spellings that all reach the same artist, and the app
   * itself rewrites the address bar to the checksummed one; a day answers with
   * and without a trailing slash. Echoing the request back made every one of
   * those its own canonical URL, so a crawler was told that three URLs were
   * three pages, and the one the SPA actually settles on was named by none of
   * them. `metaFor` has already worked out the real spelling to build the title
   * and the card from — this is that same answer, kept rather than discarded.
   */
  readonly path: string;
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

  const html = injectMeta(shell, meta, publicOrigin(url));

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
      card: `day=${day}&v=${CARD_VERSION}`,
      cacheControl: settled
        ? "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800"
        : "public, max-age=0, s-maxage=120, stale-while-revalidate=600",
      status: 200,
      // The number, not the digits that were typed: `/day/0500/` is this page too.
      path: `/day/${day}`,
    };
  }

  const address = matchArtist(pathname);
  if (address !== null) {
    return {
      title: `${shorten(address)} — ${SITE}`,
      description: `How much of what ${shorten(address)} painted on BasePaint is still on the canvas, who covered them, and who they covered.`,
      card: `address=${address}&v=${CARD_VERSION}`,
      cacheControl: "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
      status: 200,
      // Checksummed, which is the spelling `Artist.tsx` rewrites the address bar
      // to and the only one the indexer answers to.
      path: `/artist/${address}`,
    };
  }

  if (pathname === "/" || pathname === "") {
    return {
      title: `${SITE} — what is buried in a BasePaint canvas`,
      description: `${TAGLINE} Strata replays the on-chain strokes and digs out the rest.`,
      card: `day=${currentDay()}&v=${CARD_VERSION}`,
      cacheControl: "public, max-age=0, s-maxage=300, stale-while-revalidate=3600",
      status: 200,
      path: "/",
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
    // Nothing to normalise a wrong URL to. It goes out `noindex` anyway, so the
    // canonical is only ever read as "this is where you are".
    path: pathname === "" ? "/" : pathname,
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
  // On a clock, like every other fetch here. This one is same-deployment and
  // should answer in milliseconds; without a deadline a stall holds the function
  // open until the platform kills it, and the person gets a platform error page
  // instead of the sentence below. Short, because there is a real answer waiting
  // on the other side of giving up.
  const res = await fetch(new URL("/index.html", assetOrigin(url)), {
    headers: { "user-agent": "strata-html-shell" },
    signal: AbortSignal.timeout(SHELL_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`the built shell answered ${res.status}`);
  return await res.text();
}

const SHELL_TIMEOUT_MS = 5_000;

/**
 * The path is deliberately not a parameter: it comes from `meta`, which is the
 * only thing that knows the canonical spelling of the page. Taking it separately
 * is what let the request's own path be canonicalised by mistake.
 */
export function injectMeta(shell: string, meta: Meta, origin: string): string {
  const canonical = `${origin}${meta.path}`;
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
  //
  // `robots` is in the list because the shell carries `noindex` — it is reachable
  // at `/index.html`, where it is a second copy of the homepage with no canonical
  // and a relative card URL. Every page served through this function is a real
  // page and gets the tag decided above instead: none at all when the route
  // exists, `noindex` when it does not. Leaving the shell's tag in place would
  // deindex the entire site.
  const stripped = shell
    .replace(/<title>[\s\S]*?<\/title>/i, "")
    .replace(
      /<meta[^>]*(?:property="og:[^"]*"|name="twitter:[^"]*"|name="description"|name="robots")[^>]*>/gi,
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
