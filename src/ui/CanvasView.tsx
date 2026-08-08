// The canvas itself, drawn at an integer scale and nothing else. A 256-pixel
// canvas drawn at 1.5× produces uneven pixels and it is the first thing anyone
// who cares about pixel art notices.

import { useEffect, useRef, useState } from "react";

export interface CanvasViewProps {
  /** One rendered view of the day, or null while it is being built. */
  readonly image: ImageData | null;
  readonly size: number;
  /** Read out by screen readers in place of the artwork. */
  readonly label: string;
  /** Ceiling on the integer scale, so a 144 day does not fill a 5K display. */
  readonly maxScale?: number;
}

export function CanvasView({ image, size, label, maxScale = 8 }: CanvasViewProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sourceRef = useRef<HTMLCanvasElement | null>(null);
  const [scale, setScale] = useState(1);

  // Integer scale, recomputed from the space the layout actually gave us.
  useEffect(() => {
    const frame = frameRef.current;
    if (frame === null) return;

    const measure = (): void => {
      const width = frame.clientWidth;
      if (width === 0) return;
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

  const side = `${size * scale}px`;

  return (
    <div className="canvas-frame" ref={frameRef}>
      <canvas
        ref={canvasRef}
        className="canvas-art"
        style={{ width: side, height: side }}
        role="img"
        aria-label={label}
      />
      <p className="canvas-scale" aria-hidden="true">
        {size}&times;{size} at {scale}&times;
      </p>
    </div>
  );
}
