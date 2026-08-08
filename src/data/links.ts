/**
 * Outbound links to BasePaint. Anyone can earn half the protocol fee on mints
 * they refer with no signup, so every link out carries the referrer when one is
 * configured — and reads as a plain link when it is not.
 */

const REFERRER: string | undefined = import.meta.env.VITE_REFERRER_ADDRESS;

export const basepaintUrl = (path = "/"): string =>
  REFERRER
    ? `https://basepaint.xyz${path}?referrer=${REFERRER}`
    : `https://basepaint.xyz${path}`;

export const basepaintDayUrl = (day: number): string => basepaintUrl(`/painting/${day}`);

/** BasePaint's own beacon. Optional for them, free for us, honest about traffic. */
export const BEACON_URL = "https://basepaint.xyz/api/beacon.gif?ref=strata";
