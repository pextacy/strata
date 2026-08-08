// One number with its definition attached. A metric nobody can define is a
// metric nobody trusts, so the definition travels with the value rather than
// living in a README.

export interface StatProps {
  readonly label: string;
  readonly value: string;
  /** How the number is defined. On hover for a mouse, read out for a screen reader. */
  readonly definition: string;
}

export function Stat({ label, value, definition }: StatProps) {
  return (
    <div className="stat">
      <dt title={definition}>
        {label}
        <span className="visually-hidden"> — {definition}</span>
      </dt>
      <dd className="stat-value">{value}</dd>
    </div>
  );
}
