// The core sample: one cell of the canvas, drilled.
//
// Oldest band at the bottom, newest at the top, one band per placement, the
// painter and the moment on each. A 256×256 canvas holds 65,536 of these and
// every one is a small story — so this column is allowed to be the loudest
// thing on the page, and everything else stays quiet around it.

import { Link } from "react-router-dom";

import type { Band } from "../core/coreSample.ts";
import type { Pixel } from "../core/pixel.ts";
import { Address } from "./Address.tsx";
import { formatElapsed } from "./format.ts";
import "./CoreSample.css";

export interface CoreSampleProps {
  /** The cell being read, or null when nothing is picked yet. */
  readonly pixel: Pixel | null;
  /** Bands oldest first. Empty means nobody ever painted here. */
  readonly bands: readonly Band[];
  /** Lowercased addresses, indexed by `Band.artist`. */
  readonly artists: readonly string[];
  readonly palette: readonly string[];
  /** Unix seconds the day opened, so a band reads as time into the day. */
  readonly openedAt: number;
  /** True while the day is still loading — the column says so rather than lying. */
  readonly loading?: boolean;
  /** Set when the pointer is only passing over: the URL has not moved. */
  readonly preview?: boolean;
}

export function CoreSample({
  pixel,
  bands,
  artists,
  palette,
  openedAt,
  loading = false,
  preview = false,
}: CoreSampleProps) {
  const painters = new Set(bands.map((band) => band.artist)).size;
  // Repainting a cell the colour it already was covers nothing, so this is not
  // simply "every band but the top one".
  const buried = bands.reduce((n, band) => (band.buried ? n + 1 : n), 0);
  const top = bands.length > 0 ? bands[bands.length - 1] : null;

  return (
    <aside className="core" aria-label="Core sample">
      <header className="core-head">
        <h2>Core sample</h2>
        {pixel === null ? (
          <p className="core-hint">
            Point at the canvas, or tab to it and use the arrow keys, to drill a
            pixel and see everything it has ever been.
          </p>
        ) : (
          <p className="core-where">
            <code className="core-coords">
              {pixel.x}, {pixel.y}
            </code>
            {preview && <span className="core-preview"> · previewing</span>}
          </p>
        )}
      </header>

      {pixel !== null && (
        <div className="core-body">
          {loading ? (
            <p role="status" className="core-note">
              Reading the strokes for this day…
            </p>
          ) : bands.length === 0 ? (
            <p role="status" className="core-note">
              Nothing was ever painted here. This cell is still the colour the
              canvas started as.
            </p>
          ) : (
            <>
              <p className="core-summary">
                Painted <strong>{bands.length}</strong>{" "}
                {bands.length === 1 ? "time" : "times"} by{" "}
                <strong>{painters}</strong> {painters === 1 ? "painter" : "painters"}.{" "}
                {buried === 0
                  ? "Nothing here was ever covered."
                  : `${buried} ${buried === 1 ? "layer is" : "layers are"} buried under the one you can see.`}
              </p>

              {/* Chronological in the DOM — a screen reader reads the day
                  forwards — and reversed visually, so the oldest sits at the
                  bottom like a real core. */}
              <ol className="core-stack">
                {bands.map((band, index) => (
                  <li
                    key={band.index}
                    className={band.buried ? "core-band core-band-buried" : "core-band"}
                  >
                    <span
                      className="core-swatch"
                      style={{ background: palette[band.color] ?? "transparent" }}
                      aria-hidden="true"
                    />
                    <span className="core-band-main">
                      <Link className="core-painter" to={`/artist/${artists[band.artist] ?? ""}`}>
                        <Address address={artists[band.artist] ?? ""} />
                      </Link>
                      <span className="core-band-meta">
                        {formatElapsed(band.time - openedAt)} into the day ·{" "}
                        <span className="core-color">
                          {palette[band.color] ?? `index ${band.color}`}
                        </span>
                        {band === top ? " · on top" : band.buried ? " · buried" : " · repainted"}
                      </span>
                    </span>
                    <span className="core-band-index" aria-hidden="true">
                      {index + 1}
                    </span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      )}
    </aside>
  );
}
