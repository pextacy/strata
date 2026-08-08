// Replaying a day where there is no browser: no worker, no IndexedDB, no
// progress to report to anyone. Same core functions the app uses, so a share
// card can never disagree with the page it is advertising.

import { PlacementsBuilder, type Placements } from "../../src/core/decode.ts";
import { dayStats, replay, type DayStats, type Layers } from "../../src/core/replay.ts";
import { fetchDayStrokes } from "../../src/data/queries.ts";
import { fetchTheme, type Theme } from "../../src/data/theme.ts";
import { toRgba } from "../../src/render/palette.ts";

export interface ServerDay {
  readonly day: number;
  readonly theme: Theme;
  readonly size: number;
  readonly rgba: Uint32Array;
  readonly placements: Placements;
  readonly layers: Layers;
  readonly stats: DayStats;
}

export async function replayDay(day: number, signal?: AbortSignal): Promise<ServerDay> {
  const theme = await fetchTheme(day, { signal });
  const builder = new PlacementsBuilder(theme.size, theme.palette.length);

  await fetchDayStrokes(
    day,
    (items) => {
      for (const stroke of items) builder.addStroke(stroke);
    },
    { signal },
  );

  const placements = builder.finish();
  const layers = replay(placements, theme.size);

  return {
    day,
    theme,
    size: theme.size,
    rgba: toRgba(theme.palette),
    placements,
    layers,
    stats: dayStats(layers, placements),
  };
}
