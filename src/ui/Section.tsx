// The page as a geological section, from PRD.md §6: the canvas at the top, the
// time axis as a continuous band directly beneath it, and the core sample
// opening as a vertical column to the side. The reading direction is down, into
// the canvas — so on a narrow screen the column falls in underneath the axis
// rather than being squeezed alongside it.

import type { ReactNode } from "react";

import "../styles/section.css";

export interface SectionProps {
  /** Extra class on the grid itself, for a page that scopes its own type. */
  readonly className?: string;
  /** Day number, theme, whatever names the thing being dug into. */
  readonly head?: ReactNode;
  /** The artwork. Nothing on the page is allowed to be louder than this. */
  readonly canvas: ReactNode;
  /** The time band, directly under the canvas and the same width. */
  readonly axis?: ReactNode;
  /** The core sample column, beside the canvas on a wide screen. */
  readonly column?: ReactNode;
  /** Numbers, palette, footnotes — everything that reads after the picture. */
  readonly below?: ReactNode;
}

export function Section({ className, head, canvas, axis, column, below }: SectionProps) {
  const classes = ["section", column === undefined ? "" : "has-column", className ?? ""]
    .filter((name) => name !== "")
    .join(" ");

  return (
    <div className={classes}>
      {head !== undefined && <div className="section-head">{head}</div>}
      <div className="section-canvas">{canvas}</div>
      {axis !== undefined && <div className="section-axis">{axis}</div>}
      {/* A plain div: what goes in the column brings its own landmark — the core
          sample is itself an <aside>, and nesting one in another gives a screen
          reader two complementary regions where there is one. */}
      {column !== undefined && <div className="section-column">{column}</div>}
      {below !== undefined && <div className="section-below">{below}</div>}
    </div>
  );
}
