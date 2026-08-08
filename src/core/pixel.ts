// The selected cell, as it travels through the URL and the keyboard.
//
// `?px=91,204` is the whole of it. A pixel that cannot be linked to is a pixel
// nobody can show anyone else, and the core sample is the thing people will
// want to send.

export interface Pixel {
  readonly x: number;
  readonly y: number;
}

export const formatPixel = (pixel: Pixel): string => `${pixel.x},${pixel.y}`;

/**
 * Reads `?px=x,y`. Returns null for anything that is not a cell on this canvas —
 * a stale link to a 256 day opened against a 144 one lands here, and dropping it
 * is better than selecting the wrong pixel.
 */
export function parsePixel(raw: string | null | undefined, size: number): Pixel | null {
  if (raw === null || raw === undefined) return null;
  const match = /^(\d{1,3}),(\d{1,3})$/.exec(raw.trim());
  if (match === null) return null;
  const x = Number(match[1]);
  const y = Number(match[2]);
  if (x >= size || y >= size) return null;
  return { x, y };
}

/** Holds a cell inside the canvas rather than letting the selection fall off it. */
export const clampPixel = (pixel: Pixel, size: number): Pixel => ({
  x: pixel.x < 0 ? 0 : pixel.x > size - 1 ? size - 1 : pixel.x,
  y: pixel.y < 0 ? 0 : pixel.y > size - 1 ? size - 1 : pixel.y,
});

/** Arrow-key movement. Stops at the edge instead of wrapping. */
export const stepPixel = (pixel: Pixel, dx: number, dy: number, size: number): Pixel =>
  clampPixel({ x: pixel.x + dx, y: pixel.y + dy }, size);

/** Arrow keys, Home/End, and PageUp/PageDown to a step. Null for anything else. */
export function keyToStep(
  key: string,
  size: number,
  pixel: Pixel,
): Pixel | null {
  switch (key) {
    case "ArrowLeft":
      return stepPixel(pixel, -1, 0, size);
    case "ArrowRight":
      return stepPixel(pixel, 1, 0, size);
    case "ArrowUp":
      return stepPixel(pixel, 0, -1, size);
    case "ArrowDown":
      return stepPixel(pixel, 0, 1, size);
    case "PageUp":
      return stepPixel(pixel, 0, -10, size);
    case "PageDown":
      return stepPixel(pixel, 0, 10, size);
    case "Home":
      return { x: 0, y: pixel.y };
    case "End":
      return { x: size - 1, y: pixel.y };
    default:
      return null;
  }
}

/**
 * A pointer position inside the drawn canvas, as a cell. `offset` and `extent`
 * are CSS pixels measured from the element, so this stays testable arithmetic
 * and the DOM reading happens at the call site.
 */
export function pixelAt(
  offsetX: number,
  offsetY: number,
  extent: number,
  size: number,
): Pixel | null {
  if (extent <= 0) return null;
  const scale = extent / size;
  const x = Math.floor(offsetX / scale);
  const y = Math.floor(offsetY / scale);
  if (x < 0 || y < 0 || x >= size || y >= size) return null;
  return { x, y };
}

export const samePixel = (a: Pixel | null, b: Pixel | null): boolean =>
  a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y);
