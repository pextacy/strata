/**
 * `URLSearchParams` percent-encodes the comma. It does not have to: a comma is a
 * legal sub-delimiter in a query, and `?px=91,204` is a link a person can read
 * out loud. Both forms parse; only one is worth sharing.
 *
 * Every writer of the query string goes through here. When one of them did not,
 * the pixel someone picked survived until they touched the scrubber or the mode
 * switch, and then turned into `px=91%2C204` behind their back.
 */
export function readableSearch(params: URLSearchParams): string {
  const query = params.toString().replaceAll("%2C", ",");
  return query === "" ? "" : `?${query}`;
}

/**
 * The query as the address bar holds it this instant, rather than as it looked
 * when the component last rendered.
 *
 * Three hooks write this query — the mode, the moment, and the drilled pixel —
 * and each one carries the other two along. Building that from a render-time
 * snapshot means two writes in the same commit are both based on the state
 * before either of them, so the second silently undoes the first. `navigate`
 * goes through `history.replaceState`, which lands synchronously, so reading it
 * back here sees every write that has already happened.
 */
export function liveParams(fallback: URLSearchParams): URLSearchParams {
  if (typeof window === "undefined") return new URLSearchParams(fallback);
  return new URLSearchParams(window.location.search);
}
