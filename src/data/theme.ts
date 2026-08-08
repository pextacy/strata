import { DataError, getJson, type GqlOptions } from "./client.ts";

/**
 * The theme endpoint is the source of truth for a day's palette and canvas
 * size. Size is 144 for days 1–365 and 256 from 366, but that rule is never
 * written down in this app — it is read per day, so the app keeps working if it
 * changes again.
 */
export interface Theme {
  day: number;
  theme: string;
  proposer: string;
  size: number;
  palette: string[];
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export const themeUrl = (day: number) => `https://basepaint.xyz/api/theme/${day}`;

export async function fetchTheme(day: number, options: GqlOptions = {}): Promise<Theme> {
  const raw = await getJson<unknown>(themeUrl(day), options);
  return parseTheme(day, raw);
}

export function parseTheme(day: number, raw: unknown): Theme {
  if (typeof raw !== "object" || raw === null) {
    throw new DataError("shape", `Day ${day} has no theme record.`);
  }
  const r = raw as Record<string, unknown>;

  const size = r.size;
  if (typeof size !== "number" || !Number.isInteger(size) || size <= 0 || size > 256) {
    throw new DataError(
      "shape",
      `Day ${day} reported a canvas size Strata cannot draw.`,
      `size = ${JSON.stringify(size)}`,
    );
  }

  const palette = r.palette;
  if (!Array.isArray(palette) || palette.length === 0) {
    throw new DataError("shape", `Day ${day} has no palette.`);
  }
  const colors: string[] = [];
  for (const entry of palette) {
    if (typeof entry !== "string" || !HEX_COLOR.test(entry)) {
      throw new DataError(
        "shape",
        `Day ${day} has a palette entry Strata cannot read.`,
        JSON.stringify(entry),
      );
    }
    colors.push(entry);
  }

  return {
    day,
    theme: typeof r.theme === "string" && r.theme.length > 0 ? r.theme : `Day ${day}`,
    proposer: typeof r.proposer === "string" ? r.proposer : "",
    size,
    palette: colors,
  };
}
