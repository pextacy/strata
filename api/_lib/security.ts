// The headers every response carries, in one place.
//
// `vercel.json` uses the legacy `routes` array — it has to, because the
// homepage must reach `api/html.ts` rather than being served off disk as a
// static `index.html` — and `routes` cannot be combined with a top-level
// `headers` block. So the document headers are set by the function that builds
// the document, which is also the only place that knows whether it is sending
// HTML, a PNG, or a sentence about a failure.

/**
 * What the page is allowed to load, and from where.
 *
 * `script-src 'self'` is the one that matters: it is what stops an injected
 * tag from running, and it holds because the built shell has no inline script
 * of its own — Vite emits the entry as a module file. Anything that changes
 * that (an analytics snippet, an inlined runtime) breaks the app loudly in the
 * console rather than quietly weakening this, which is the right way round.
 *
 * `style-src` has to allow inline: canvas dimensions, scrubber bar heights and
 * core-sample band colours are per-element style attributes computed from the
 * data, and there is no static stylesheet that can express 65,536 possible
 * values.
 *
 * `connect-src` is deliberately the whole of https rather than a list. Strata
 * talks to the indexer, the theme API and a Base RPC, all of which could be
 * named — but ENS resolution also follows CCIP-read, where the resolver hands
 * back a gateway URL to fetch from, and offchain names (every basename, among
 * others) are resolved that way. Those hosts are not knowable when this header
 * is written. Naming a list would silently drop the names of exactly the
 * artists most likely to have one, and a lookup failure is silent by design, so
 * nobody would ever see why. The operator's own RPC, set at build time, is out
 * of reach here for the same reason. What is still bought: no plaintext http
 * destination, and no data: or blob: exfiltration channel.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  // basepaint.xyz serves the beacon in the footer; blob: and data: are for
  // canvases turned into images.
  "img-src 'self' data: blob: https://basepaint.xyz",
  "connect-src https: wss:",
  // The replay worker is a same-origin module file in the build and a blob in
  // the dev server.
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  // Nothing here posts anywhere. The day jump is handled in JavaScript.
  "form-action 'self'",
  // Strata shows a mint button that spends real money, so it must never be
  // rendered inside somebody else's frame.
  "frame-ancestors 'none'",
].join("; ");

/**
 * For a response that is not a document — a PNG, or a line of text explaining
 * why there is no PNG. It loads nothing, so it is allowed to load nothing.
 */
const CSP_ASSET = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; sandbox";

/**
 * Two years, subdomains included. Not `preload`: that submits the domain to a
 * list browsers ship, it is slow to undo, and it is the site operator's call to
 * make rather than a default to inherit from a file like this one.
 */
const HSTS = "max-age=63072000; includeSubDomains";

const SHARED = {
  // The one header here that is not defence in depth. Every response this
  // project sends either is HTML, is a PNG, or echoes part of the request back
  // as text; the last of those is exactly what content sniffing turns into a
  // vulnerability.
  "x-content-type-options": "nosniff",
  "strict-transport-security": HSTS,
  "referrer-policy": "strict-origin-when-cross-origin",
  // Strata asks for none of these, so it asks for them to be unavailable.
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
} as const;

/** For the HTML document itself. */
export function documentHeaders(): Record<string, string> {
  return {
    ...SHARED,
    "content-security-policy": CSP,
    // `frame-ancestors` above is the real rule; this is for the browsers that
    // still only understand this one.
    "x-frame-options": "DENY",
    // Popups stay allowed: a wallet may open one to confirm a mint.
    "cross-origin-opener-policy": "same-origin-allow-popups",
  };
}

/** For the share card, and for anything that answers in plain text. */
export function assetHeaders(): Record<string, string> {
  return { ...SHARED, "content-security-policy": CSP_ASSET };
}
