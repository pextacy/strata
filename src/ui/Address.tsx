// An address, shortened for reading and complete on hover. ENS resolution lands
// in the artist phase; until then the raw address is the honest thing to show,
// and it is never truncated in the title.

export interface AddressProps {
  readonly address: string;
  /** Characters kept at each end. */
  readonly keep?: number;
}

export function Address({ address, keep = 4 }: AddressProps) {
  const clean = address.trim();
  const short =
    clean.length > 2 + keep * 2 + 2
      ? `${clean.slice(0, 2 + keep)}…${clean.slice(-keep)}`
      : clean;

  return (
    <code className="address" title={clean}>
      {short}
    </code>
  );
}
