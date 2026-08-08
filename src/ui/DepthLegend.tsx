// Depth mode is the one view whose colours carry a number, so the number is
// printed beside the colour. The ramp is normalised to this day's deepest cell,
// which means a legend copied from another day would be wrong.

import { depthCssColor } from "../render/palette.js";

export interface DepthLegendProps {
  readonly maxDepth: number;
}

/**
 * Ticks are spaced the way the ramp is — evenly in the eased space, not evenly
 * in depth — so the swatches step through the ramp at a steady rate and each one
 * still carries its true depth.
 */
function ticks(maxDepth: number): number[] {
  if (maxDepth <= 1) return [1];
  const out: number[] = [];
  const steps = 6;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const depth = Math.round(1 + (maxDepth - 1) * t * t);
    if (out[out.length - 1] !== depth) out.push(depth);
  }
  return out;
}

export function DepthLegend({ maxDepth }: DepthLegendProps) {
  if (maxDepth <= 0) return null;

  return (
    <div className="legend">
      <p className="legend-title">Times painted</p>
      <ul className="legend-scale">
        {ticks(maxDepth).map((depth) => (
          <li key={depth}>
            <span
              className="legend-swatch"
              style={{ background: depthCssColor(depth, maxDepth) }}
              aria-hidden="true"
            />
            {depth}
          </li>
        ))}
      </ul>
      <p className="legend-note">
        Scaled to this day&rsquo;s deepest cell, painted {maxDepth}{" "}
        {maxDepth === 1 ? "time" : "times"}. Unpainted cells are left empty.
      </p>
    </div>
  );
}
