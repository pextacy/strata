// Which host a function is allowed to believe it is running on.
//
// `request.url` is built from the Host header, which the client sends and can
// say anything. Two things are too dangerous to take from it, and both of them
// live here rather than in one function, so that every function gets the same
// answer.

const fromEnv = (name: string): string | null => {
  const value = process.env[name];
  return value === undefined || value === "" ? null : value;
};

/**
 * Where to fetch this deployment's own files from.
 *
 * `api/html.ts` fetches the built shell and then serves it as this site's HTML.
 * Sourcing that from an attacker-supplied host would let whoever chose the Host
 * header choose the page served under our domain. `VERCEL_URL` names this exact
 * deployment, so the shell is always the one this build produced.
 */
export function assetOrigin(url: URL): string {
  const deployment = fromEnv("VERCEL_URL");
  return deployment === null ? url.origin : `https://${deployment}`;
}

/**
 * Where the site lives, for URLs that other people will keep.
 *
 * Canonical links, card URLs and sitemap entries are absolute and end up in
 * search indexes and timelines, so they name the project's production domain
 * rather than whatever host the request claimed.
 *
 * With neither variable set — `vercel dev`, or a plain `node` — there is no
 * deployment to ask about and the request's own origin is all there is.
 */
export function publicOrigin(url: URL): string {
  const production = fromEnv("VERCEL_PROJECT_PRODUCTION_URL");
  return production === null ? url.origin : `https://${production}`;
}
