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
import { PixelText } from "./PixelText.tsx";
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
  /**
   * Bands this cell gets after the moment being shown, when the scrubber is
   * somewhere in the middle of the day. Without it a cell painted at nine in the
   * evening reads as never painted at all from five in the afternoon.
   */
  readonly laterBands?: number;
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
  laterBands = 0,
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
            {/* The coordinate in the instrument's own face, matching the ticks
                on the rulers it was read off. */}
            <PixelText className="core-coords" scale={4}>{`${pixel.x}, ${pixel.y}`}</PixelText>
            {preview && <span className="core-preview">previewing</span>}
          </p>
        )}
      </header>

      {pixel !== null && (
        <div className="core-body">
          {loading ? (
            <p role="status" className="core-note-block">
              Reading the strokes for this day…
            </p>
          ) : bands.length === 0 ? (
            <p role="status" className="core-note-block">
              {laterBands === 0
                ? "Nothing was ever painted here. This cell is still the colour the canvas started as."
                : `Nothing here yet at this moment. This cell is painted ${laterBands} ${
                    laterBands === 1 ? "time" : "times"
                  } later in the day.`}
            </p>
          ) : (
            <>
              <p className="core-summary">
                Painted <strong>{bands.length}</strong>{" "}
                {bands.length === 1 ? "time" : "times"}
                {laterBands > 0 ? " so far" : ""} by{" "}
                <strong>{painters}</strong> {painters === 1 ? "painter" : "painters"}.{" "}
                {buried === 0
                  ? laterBands > 0
                    ? "Nothing here has been covered yet."
                    : "Nothing here was ever covered."
                  : `${buried} ${buried === 1 ? "layer is" : "layers are"} buried under the one you can see.`}
                {laterBands > 0 &&
                  ` ${laterBands} more ${laterBands === 1 ? "layer lands" : "layers land"} on this cell before the day closes.`}
              </p>

              {/* Newest first, in the DOM and on screen alike, so the oldest
                  still sits at the bottom like a real core.

                  This list was chronological in the DOM and flipped with
                  `column-reverse`, which reads well until the stack is taller
                  than its scroll box: a reversed flex container pins to its
                  first child, so a nineteen-band cell opened on the oldest
                  eight and hid the band actually on the canvas — the one the
                  summary directly above calls "the one you can see". Reading
                  down from the surface also puts keyboard focus in the order
                  the eye moves. */}
              {/* The core itself.

                  What this column is, literally, is one cell of the canvas seen
                  through time instead of through space — so it is drawn as one:
                  a continuous strip of hard-edged colour, no gaps, no rounding,
                  as though a drill had been sunk into the image and the plug
                  pulled out. The writing lives in a gutter beside it and reaches
                  back to its own band with a leader line, the way a note is
                  written beside a specimen rather than on it.

                  The earlier version put the swatch inside a padded row with the
                  text, which reads as a list of events. It was a list of events.
                  This reads as an object, which is what the data actually is. */}
              <ol className="core-stack">
                {bands.toReversed().map((band, index) => (
                  <li
                    key={band.index}
                    className={band.buried ? "core-band core-band-buried" : "core-band"}
                  >
                    <span
                      className="core-plug"
                      style={{ background: palette[band.color] ?? "transparent" }}
                      aria-hidden="true"
                    />
                    <span className="core-leader" aria-hidden="true" />
                    <span className="core-note">
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
                    {/* Depth, counted from the bottom of the core: band 1 is the
                        first colour ever laid here, whichever end you read from. */}
                    <span className="core-band-index" aria-hidden="true">
                      {bands.length - index}
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
