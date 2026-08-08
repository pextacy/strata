// Four ways to read the same day. Switching is a repaint of buffers already in
// memory, so it never asks the network for anything.

import { MODE_COPY, VIEW_MODES, type ViewMode } from "../render/layers.ts";

export interface ModeSwitchProps {
  readonly mode: ViewMode;
  readonly onChange: (mode: ViewMode) => void;
  /** Modes that cannot be drawn yet are still listed, so the set never shifts. */
  readonly disabled?: boolean;
}

export function ModeSwitch({ mode, onChange, disabled = false }: ModeSwitchProps) {
  return (
    <div className="mode-switch">
      <div className="mode-buttons" role="group" aria-label="View mode">
        {VIEW_MODES.map((value) => (
          <button
            key={value}
            type="button"
            className="mode-button"
            aria-pressed={value === mode}
            disabled={disabled}
            onClick={() => onChange(value)}
          >
            {MODE_COPY[value].label}
          </button>
        ))}
      </div>
      <p className="mode-blurb">{MODE_COPY[mode].blurb}</p>
    </div>
  );
}
