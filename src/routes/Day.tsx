// /day/:day — the excavation view. The canvas at the top, the four ways to read
// it directly under, the day's own numbers below that. Mode lives in the URL, so
// every view here is a link someone can send.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { coreSample } from "../core/coreSample.ts";
import { currentDay, dayStart, isDayOpen } from "../core/day-math.ts";
import { hasAnomalies } from "../core/decode.ts";
import type { Pixel } from "../core/pixel.ts";
import { basepaintDayUrl, basepaintUrl, BEACON_URL } from "../data/links.ts";
import { useDay } from "../data/useDay.ts";
import type { DayData, DayProgress } from "../data/day.ts";
import {
  DEFAULT_VIEW_MODE,
  MODE_COPY,
  isViewMode,
  layerImageData,
  readViewMode,
  type ViewMode,
} from "../render/layers.ts";
import { Address } from "../ui/Address.tsx";
import { CanvasView } from "../ui/CanvasView.tsx";
import { CoreSample } from "../ui/CoreSample.tsx";
import { DepthLegend } from "../ui/DepthLegend.tsx";
import { ModeSwitch } from "../ui/ModeSwitch.tsx";
import { Stat } from "../ui/Stat.tsx";
import { usePixelParam } from "../ui/usePixelParam.ts";
import "../styles/day.css";

const count = new Intl.NumberFormat("en-US");

const utcTime = (unixSec: number): string =>
  `${new Date(unixSec * 1000).toISOString().slice(11, 16)} UTC`;

type ParsedDay = { readonly ok: true; readonly day: number } | { readonly ok: false; readonly message: string };

function parseDay(raw: string | undefined): ParsedDay {
  const value = (raw ?? "").trim();
  if (value === "") {
    return { ok: false, message: "This link is missing a day number. Days look like /day/500." };
  }
  if (!/^\d+$/.test(value)) {
    return { ok: false, message: `“${value}” is not a day number. Days are whole numbers from 1.` };
  }
  const day = Number(value);
  if (day < 1) return { ok: false, message: "Days are counted from 1. There is no day 0." };
  const latest = currentDay();
  if (day > latest) {
    return {
      ok: false,
      message: `Day ${day} has not opened yet. The canvas being painted right now is day ${latest}.`,
    };
  }
  return { ok: true, day };
}

export default function Day() {
  const params = useParams<{ day?: string }>();
  const [search, setSearch] = useSearchParams();

  const parsed = parseDay(params.day);
  const mode = readViewMode(search.get("mode"));
  const { state, reload } = useDay(parsed.ok ? parsed.day : null);

  // A mode nobody recognises is dropped from the URL rather than left there
  // pointing at a view that is not on screen.
  const rawMode = search.get("mode");
  useEffect(() => {
    if (rawMode === null || isViewMode(rawMode)) return;
    const next = new URLSearchParams(search);
    next.delete("mode");
    setSearch(next, { replace: true });
  }, [rawMode, search, setSearch]);

  const setMode = useCallback(
    (next: ViewMode) => {
      const params = new URLSearchParams(search);
      // Final is the default, so it stays out of the URL and the plain
      // /day/500 link keeps working as the canonical one.
      if (next === DEFAULT_VIEW_MODE) params.delete("mode");
      else params.set("mode", next);
      // A mode is a lens on the same page, not a new place: it does not deserve
      // a back-button step, but it does survive a reload.
      setSearch(params, { replace: true });
    },
    [search, setSearch],
  );

  const data = state.status === "ready" ? state.data : null;

  const image = useMemo(() => {
    if (data === null) return null;
    return layerImageData(mode, data.layers, data.rgba, data.stats.maxDepth);
  }, [data, mode]);

  // The drilled cell. `?px=` holds the one someone chose; hovering only previews
  // it, because a mouse crossing the canvas passes over hundreds of cells and
  // none of them is a place anyone asked to be.
  const size = data?.size ?? 0;
  const { selected, select } = usePixelParam(size);
  const [hovered, setHovered] = useState<Pixel | null>(null);
  const drilled = hovered ?? selected;

  // Recomputed on demand, never stored: one linear pass over the typed arrays,
  // which measures at 0.13 ms on a day of 132,000 placements.
  const sample = useMemo(() => {
    if (data === null || drilled === null) return null;
    return coreSample(data.placements, data.size, drilled.x, drilled.y);
  }, [data, drilled]);

  if (!parsed.ok) {
    return (
      <main className="excavation">
        <Header day={null} />
        <p role="alert" className="notice notice-bad">
          {parsed.message} <Link to="/">Start from today</Link>
        </p>
        <Footer day={null} />
      </main>
    );
  }

  const day = parsed.day;
  const empty = data !== null && data.stats.placements === 0;

  return (
    <main className="excavation">
      <Header day={day} theme={data?.theme.theme} open={isDayOpen(day)} />

      <div className="excavation-dig">
      <section className="canvas-panel" aria-label={`Day ${day} canvas`}>
        {data !== null && image !== null && !empty ? (
          <CanvasView
            image={image}
            size={data.size}
            label={`Day ${day}, ${MODE_COPY[mode].label.toLowerCase()} view, rebuilt from the on-chain strokes`}
            pick={{
              selected,
              hovered,
              onHover: setHovered,
              onSelect: (pixel) => {
                setHovered(null);
                select(pixel);
              },
            }}
          />
        ) : (
          <div className="canvas-frame canvas-frame-empty">
            {state.status === "loading" && <Loading progress={state.progress} day={day} />}
            {state.status === "failed" && (
              <p role="alert" className="notice notice-bad">
                {state.message}{" "}
                <button type="button" onClick={reload}>
                  Try again
                </button>
                {state.detail !== undefined && <small className="detail">{state.detail}</small>}
              </p>
            )}
            {empty && (
              <p role="status" className="notice">
                Nothing has been painted on day {day} yet. The canvas opened at{" "}
                {utcTime(dayStart(day))}.{" "}
                <button type="button" onClick={reload}>
                  Check again
                </button>
              </p>
            )}
          </div>
        )}
      </section>

        {data !== null && !empty && (
          <CoreSample
            pixel={drilled}
            bands={sample?.bands ?? []}
            artists={data.placements.artists}
            palette={data.palette}
            openedAt={dayStart(day)}
            preview={hovered !== null}
          />
        )}
      </div>

      <ModeSwitch mode={mode} onChange={setMode} disabled={data === null} />

      {mode === "depth" && data !== null && <DepthLegend maxDepth={data.stats.maxDepth} />}

      {data !== null && !empty && <DayNumbers data={data} />}

      <Footer day={day} />
    </main>
  );
}

function Header({ day, theme, open }: { day: number | null; theme?: string; open?: boolean }) {
  return (
    <header className="day-head">
      <p className="crumb">
        <Link to="/">Strata</Link>
      </p>
      <h1>{day === null ? "That day does not exist" : `Day ${day}`}</h1>
      {theme !== undefined && <p className="day-theme">{theme}</p>}
      {open === true && (
        <p className="day-open">Still being painted — this canvas is not final.</p>
      )}
    </header>
  );
}

function Loading({ progress, day }: { progress: DayProgress; day: number }) {
  const { phase, strokes, pixels, totalStrokes, resuming } = progress;

  const line =
    phase === "theme"
      ? `Asking basepaint.xyz for the day ${day} palette…`
      : phase === "cache"
        ? `Rebuilding day ${day} from the copy stored on this device…`
        : phase === "replaying"
          ? `Stacking ${count.format(pixels)} placements…`
          : resuming
            ? `Catching up on today's canvas — ${count.format(strokes)} new strokes read.`
            : `Reading the chain — ${count.format(strokes)}${
                totalStrokes > 0 ? ` of ${count.format(totalStrokes)}` : ""
              } strokes, ${count.format(pixels)} pixels decoded.`;

  return (
    <div className="loading" role="status">
      <p>{line}</p>
      {phase === "fetching" && totalStrokes > 0 && (
        <progress className="loading-bar" value={Math.min(strokes, totalStrokes)} max={totalStrokes} />
      )}
    </div>
  );
}

function DayNumbers({ data }: { data: DayData }) {
  const { stats, placements, size, palette, theme, anomalies } = data;
  const cells = size * size;
  const coverage = cells === 0 ? 0 : (stats.paintedCells / cells) * 100;

  return (
    <section className="day-numbers" aria-label="Numbers for this day">
      <dl className="stats">
        <Stat
          label="Artists"
          value={count.format(placements.artists.length)}
          definition="Addresses that placed at least one pixel on this canvas."
        />
        <Stat
          label="Pixels painted"
          value={count.format(stats.placements)}
          definition="Placements: one pixel written by one stroke. A cell can hold many."
        />
        <Stat
          label="Cells painted"
          value={`${count.format(stats.paintedCells)} of ${count.format(cells)} · ${coverage.toFixed(1)}%`}
          definition="Distinct grid positions painted at least once, out of the whole canvas."
        />
        <Stat
          label="Overpaint ratio"
          value={stats.overpaintRatio.toFixed(2)}
          definition="Placements ÷ cells painted at least once. 1.00 means nothing was ever painted over."
        />
        <Stat
          label="Buried"
          value={count.format(stats.buriedPlacements)}
          definition="Placements later covered by a different colour on the same cell. This is what Ghost draws."
        />
        <Stat
          label="Deepest cell"
          value={`${count.format(stats.maxDepth)} ${stats.maxDepth === 1 ? "layer" : "layers"}`}
          definition="The most times any single cell was painted. The depth ramp is scaled to it."
        />
      </dl>

      <div className="palette-row">
        <p className="palette-label">
          {palette.length} colours
          {theme.proposer !== "" && (
            <>
              {" · proposed by "}
              <Address address={theme.proposer} />
            </>
          )}
        </p>
        <ul className="day-swatches" aria-label="Palette for this day">
          {palette.map((color, index) => (
            <li
              key={`${color}-${index}`}
              className="day-swatch"
              style={{ background: color }}
              title={`${index} · ${color}`}
            >
              <span className="visually-hidden">
                {index}: {color}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {hasAnomalies(anomalies) && (
        <p className="notice notice-quiet">
          {anomalies.offCanvas > 0 &&
            `${count.format(anomalies.offCanvas)} pixels addressed a cell outside the canvas and were dropped. `}
          {anomalies.unknownColor > 0 &&
            `${count.format(anomalies.unknownColor)} pixels named a colour this day's palette does not have. BasePaint's own renderer ignores those, so Strata does too, and the colour underneath shows through. `}
          {anomalies.malformedStrokes > 0 &&
            `${count.format(anomalies.malformedStrokes)} strokes could not be decoded. `}
        </p>
      )}
    </section>
  );
}

function Footer({ day }: { day: number | null }) {
  return (
    <footer className="day-foot">
      <a href={day === null ? basepaintUrl() : basepaintDayUrl(day)}>
        {day === null ? "Paint at basepaint.xyz" : `See day ${day} on basepaint.xyz`}
      </a>
      <img src={BEACON_URL} width={1} height={1} alt="" />
    </footer>
  );
}
