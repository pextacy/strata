/**
 * What has already been looked up, for the session.
 *
 * Kept apart from `ens.ts` because it has to be readable synchronously — an
 * address that already has a name should render with it on the first frame,
 * not flicker through the hex — while `ens.ts` itself needs viem, which is far
 * too large to load before the canvas is on screen. So the cache is here, with
 * no dependencies at all, and the module that fills it is fetched on demand.
 *
 * Resolved, unresolved, and failed lookups all land here: `null` means asked
 * and there is no name, `undefined` means not asked. A failure caches as `null`
 * so one dead endpoint does not turn every address on the page into a retry.
 */

const names = new Map<string, string | null>();

const key = (address: string): string => address.trim().toLowerCase();

/** The name if it is known, `null` if there is none, `undefined` if unasked. */
export const knownEnsName = (address: string): string | null | undefined => names.get(key(address));

export const rememberEnsName = (address: string, name: string | null): void => {
  names.set(key(address), name);
};

/** Only for tests: the session cache is otherwise meant to live as long as the tab. */
export const forgetEnsNames = (): void => {
  names.clear();
};
