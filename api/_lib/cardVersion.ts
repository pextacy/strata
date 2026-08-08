/**
 * The share card's design, as a number that appears in its URL.
 *
 * A card for a day that has closed is settled: the strokes are on chain, the
 * palette is fixed, and the replay is deterministic, so the picture can be kept
 * for a very long time instead of being rebuilt from a quarter of a million
 * placements every day. The one thing that can still change it is this
 * repository — a new layout, a different ramp, another figure on the panel — and
 * a CDN has no way to know that happened.
 *
 * So the version travels in the query string. Change anything about how a card
 * is drawn, bump this, and every card URL the site emits becomes a new one; the
 * old entries age out on their own. `api/og.ts` never reads it, which is the
 * point: it is a cache key, not an input.
 *
 * It lives in its own file because both functions need it and neither should
 * import the other — `api/html.ts` pulling in `api/og.ts` would drag the whole
 * PNG encoder and every render module into the function that serves the HTML.
 */
export const CARD_VERSION = 1;
