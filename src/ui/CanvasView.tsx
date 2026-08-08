// The canvas itself, drawn at an integer scale and nothing else. A 256-pixel
// canvas drawn at 1.5× produces uneven pixels and it is the first thing anyone
// who cares about pixel art notices.
//
// It is also where a cell is picked. Pointer, tap, and arrow keys all land on
// the same two callbacks: hovering is a preview, choosing is a commitment.

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { keyToStep, pixelAt, samePixel, type Pixel } from "../core/pixel.js";
import { PixelText } from "./PixelText.js";

/**
 * The gutter the left-hand ruler occupies, matching `--u3` in tokens.css. The
 * scale has to be worked out from the width the artwork actually gets, not the
 * width of the frame, or the canvas is one step too large and overflows.
 */
const RULER = 24;

export interface CanvasPick {
  /** The cell in the URL. Drawn as the strong marker. */
  readonly selected: Pixel | null;
  /** The cell under the pointer. Drawn faintly, and never written to the URL. */
  readonly hovered: Pixel | null;
  readonly onHover: (pixel: Pixel | null) => void;
  readonly onSelect: (pixel: Pixel) => void;
}

export interface CanvasViewProps {
  /** One rendered view of the day, or null while it is being built. */
  readonly image: ImageData | null;
  readonly size: number;
  /** Read out by screen readers in place of the artwork. */
  readonly label: string;
  /** Ceiling on the integer scale, so a 144 day does not fill a 5K display. */
  readonly maxScale?: number;
  /** Omit to render the artwork alone, with no cell picking. */
  readonly pick?: CanvasPick;
}

export function CanvasView({ image, size, label, maxScale = 8, pick }: CanvasViewProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sourceRef = useRef<HTMLCanvasElement | null>(null);
  const [scale, setScale] = useState(1);

  // Integer scale, recomputed from the space the layout actually gave us.
  useEffect(() => {
    const frame = frameRef.current;
    if (frame === null) return;

    const measure = (): void => {
      const width = frame.clientWidth - RULER;
      if (width <= 0) return;
      const byWidth = Math.floor(width / size);
      const byHeight = Math.floor((window.innerHeight * 0.72) / size);
      const next = Math.max(1, Math.min(maxScale, byWidth, byHeight));
      setScale((current) => (current === next ? current : next));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [size, maxScale]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || image === null) return;

    let source = sourceRef.current;
    if (source === null || source.width !== size) {
      source = document.createElement("canvas");
      source.width = size;
      source.height = size;
      sourceRef.current = source;
    }
    const sourceCtx = source.getContext("2d");
    const ctx = canvas.getContext("2d");
    if (sourceCtx === null || ctx === null) return;

    sourceCtx.putImageData(image, 0, 0);

    // The backing store is a whole number of device pixels per canvas pixel, so
    // the browser never has to invent one.
    const dpr = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    const backing = Math.max(1, Math.round(scale * dpr));
    const pixels = size * backing;
    if (canvas.width !== pixels) canvas.width = pixels;
    if (canvas.height !== pixels) canvas.height = pixels;

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, pixels, pixels);
    ctx.drawImage(source, 0, 0, pixels, pixels);
  }, [image, size, scale]);

  const cellAt = useCallback(
    (event: PointerEvent<HTMLElement>): Pixel | null => {
      const rect = event.currentTarget.getBoundingClientRect();
      return pixelAt(event.clientX - rect.left, event.clientY - rect.top, rect.width, size);
    },
    [size],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (pick === undefined) return;
      // A coarse pointer has no hover: a finger on the canvas is a choice.
      if (event.pointerType !== "mouse") return;
      const cell = cellAt(event);
      if (!samePixel(cell, pick.hovered)) pick.onHover(cell);
    },
    [cellAt, pick],
  );

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (pick === undefined) return;
      const cell = cellAt(event);
      if (cell !== null) pick.onSelect(cell);
    },
    [cellAt, pick],
  );

  const onPointerLeave = useCallback(() => {
    if (pick !== undefined && pick.hovered !== null) pick.onHover(null);
  }, [pick]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (pick === undefined) return;
      // With nothing selected yet, the first arrow key starts in the middle,
      // which is where the painting usually is.
      const from = pick.selected ?? { x: Math.floor(size / 2), y: Math.floor(size / 2) };
      const next = keyToStep(event.key, size, from);
      if (next === null) return;
      event.preventDefault();
      pick.onSelect(pick.selected === null ? from : next);
    },
    [pick, size],
  );

  const side = `${size * scale}px`;
  const marker = (pixel: Pixel) => ({
    left: `${pixel.x * scale}px`,
    top: `${pixel.y * scale}px`,
    width: `${scale}px`,
    height: `${scale}px`,
  });

  const interactive = pick !== undefined && image !== null;

  // Every 16 cells, which divides both canvas sizes and lands on 8 ticks across
  // a 144 day and 16 across a 256 — enough to find a coordinate by, few enough
  // that the markings stay quieter than the artwork.
  const ticks: number[] = [];
  for (let cell = 0; cell < size; cell += 16) ticks.push(cell);

  // At 1× a 16-cell step is 16 pixels, which is narrower than the number that
  // would sit in it — the labels ran into each other and the ruler became
  // texture. The marks stay at every scale, because they still show the grid;
  // the numbers appear only where there is room to read one.
  const numbered = 16 * scale >= 24;

  return (
    <div className="canvas-frame" ref={frameRef}>
      {/* The plate: rulers along the top and left edges, the artwork in the
          corner they meet. A coordinate is read off the instrument rather than
          printed underneath it in a sentence.

          Grid, not absolute positioning, so a tick cannot drift out of register
          with the cell it names — which would be worse than having no ruler.
          aria-hidden: the position is already spoken by the core sample
          heading, and a screen reader has no use for sixteen loose numbers. */}
      <div className="canvas-plate">
        <span className="ruler-corner" aria-hidden="true" />
        <div className="ruler ruler-x" style={{ width: side }} aria-hidden="true">
          {ticks.map((cell) => (
            <span className="tick" key={cell} style={{ left: `${cell * scale}px` }}>
              {numbered ? cell : ""}
            </span>
          ))}
        </div>
        <div className="ruler ruler-y" style={{ height: side }} aria-hidden="true">
          {ticks.map((cell) => (
            <span className="tick" key={cell} style={{ top: `${cell * scale}px` }}>
              {numbered ? cell : ""}
            </span>
          ))}
        </div>
        <div
        className={interactive ? "canvas-stage canvas-stage-pick" : "canvas-stage"}
        style={{ width: side, height: side }}
        onPointerMove={interactive ? onPointerMove : undefined}
        onPointerDown={interactive ? onPointerDown : undefined}
        onPointerLeave={interactive ? onPointerLeave : undefined}
        onKeyDown={interactive ? onKeyDown : undefined}
        tabIndex={interactive ? 0 : undefined}
        role={interactive ? "application" : undefined}
        aria-label={interactive ? `${label}. Arrow keys drill into a pixel.` : undefined}
      >
        <canvas
          ref={canvasRef}
          className="canvas-art"
          style={{ width: side, height: side }}
          role="img"
          aria-label={label}
        />
        {pick?.hovered != null && !samePixel(pick.hovered, pick.selected) && (
          <span className="cell-marker cell-marker-hover" style={marker(pick.hovered)} aria-hidden="true" />
        )}
        {pick?.selected != null && (
          <>
            {/* One cell at 2× is four screen pixels — findable only if something
                points at it. The crosshair is how a pixel editor has always
                done this, and it survives any palette underneath. */}
            <span
              className="cell-cross cell-cross-v"
              style={{ left: `${pick.selected.x * scale}px`, width: `${scale}px` }}
              aria-hidden="true"
            />
            <span
              className="cell-cross cell-cross-h"
              style={{ top: `${pick.selected.y * scale}px`, height: `${scale}px` }}
              aria-hidden="true"
            />
            <span className="cell-marker cell-marker-selected" style={marker(pick.selected)} aria-hidden="true" />
          </>
        )}
        </div>
      </div>
      {/* The magnification, stated the way a microscope states it. */}
      <p className="canvas-scale">
        <PixelText scale={2}>{`${size}×${size} at ${scale}×`}</PixelText>
      </p>
    </div>
  );
}
