// /day/:day — the excavation view, and the page every other one leads to.
//
// The canvas at the top, the day's own time band directly under it, the core
// sample as a column beside it, and the numbers below. Mode, moment and drilled
// pixel all live in the URL, so any state of this page is a link someone can
// send.

import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { bandsUpTo, coreSample } from "../core/coreSample.js";
import { DAY_DURATION } from "../core/constants.js";
import { currentDay, dayStart, isDayOpen } from "../core/day-math.js";
import { hasAnomalies } from "../core/decode.js";
import type { Pixel } from "../core/pixel.js";
import { basepaintDayUrl } from "../data/links.js";
import { useDay } from "../data/useDay.js";
import { initialProgress, type DayData } from "../data/day.js";
import { MODE_COPY } from "../render/layers.js";
import { Address } from "../ui/Address.js";
import { CanvasView } from "../ui/CanvasView.js";
import { CoreSample } from "../ui/CoreSample.js";
import { DepthLegend } from "../ui/DepthLegend.js";
import { MintButton } from "../ui/MintButton.js";
import { ModeSwitch } from "../ui/ModeSwitch.js";
import { PixelText } from "../ui/PixelText.js";
import { Scrubber } from "../ui/Scrubber.js";
import { Section } from "../ui/Section.js";
import { Stat } from "../ui/Stat.js";
import { Failure, LoadingDay, Nothing } from "../ui/states.js";
import { useDocumentTitle } from "../ui/useDocumentTitle.js";
import { useLayerImage } from "../ui/useLayerImage.js";
import { usePixelParam } from "../ui/usePixelParam.js";
import { usePlayback } from "../ui/usePlayback.js";
import { useTimeParam } from "../ui/useTimeParam.js";
import { useActivity, useTimeline } from "../ui/useTimeline.js";
import { useViewMode } from "../ui/useViewMode.js";
import "../styles/parts.css";
import "../styles/day.css";

const count = new Intl.NumberFormat("en-US");

const utcTime = (unixSec: number): string =>
  `${new Date(unixSec * 1000).toISOString().slice(11, 16)} UTC`;

/** How often a page open on today's canvas notices that the day has moved on. */
const TICK_MS = 30_000;

type ParsedDay =
  | { readonly ok: true; readonly day: number }
  | { readonly ok: false; readonly message: string };

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
  const parsed = parseDay(params.day);

  // Hooks cannot be conditional, so an unparseable day loads nothing and the
  // page renders its own sentence at the bottom of this function.
  return parsed.ok ? <Excavation day={parsed.day} /> : <BadDay message={parsed.message} />;
}

function Excavation({ day }: { readonly day: number }) {
  const { state, reload } = useDay(day);
  const data = state.status === "ready" ? state.data : null;
  const { mode, setMode } = useViewMode();

  // --- time ----------------------------------------------------------------
  // A finished day is a full 24 hours; today's stops at now, so the scrubber
  // never runs out past the last stroke that exists. A tab left open on the
  // canvas being painted keeps up rather than freezing at the minute it loaded.
  const openedAt = dayStart(day);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const open = isDayOpen(day, now);

  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), TICK_MS);
    return () => clearInterval(timer);
  }, [open]);

  const elapsed = open ? Math.max(0, Math.min(DAY_DURATION, now - openedAt)) : DAY_DURATION;

  const placements = data?.placements ?? null;
  const timeline = useTimeline(placements, data?.size ?? 0);
  // The band has to cover exactly the window the handle slides over. Drawn
  // across the full 24 hours while the scrubber stopped at `elapsed`, today's
  // bars sat under the wrong part of the track: six hours of painting squeezed
  // into the first quarter of a band whose right-hand end was already "now".
  const activity = useActivity(placements, openedAt, openedAt + elapsed);

  const { t, atEnd, setT } = useTimeParam(elapsed);
  const idle = timeline === null || timeline.count === 0;
  const playback = usePlayback({ value: t, onChange: setT, max: elapsed, disabled: idle });

  // At the end of the day the replayed buffers are already in hand; only a
  // scrub has to rebuild anything, and that reuses one scratch canvas.
  const shown = useMemo(() => {
    if (data === null || timeline === null) return null;
    if (atEnd) return { layers: data.layers, strokes: timeline.count, upTo: timeline.count - 1 };
    const strokes = timeline.countAtTime(openedAt + t);
    return { layers: timeline.frameAt(strokes), strokes, upTo: strokes - 1 };
  }, [data, timeline, atEnd, openedAt, t]);

  const image = useLayerImage({
    mode,
    layers: shown?.layers ?? null,
    rgba: data?.rgba ?? null,
    maxDepth: data?.stats.maxDepth ?? 1,
    // The scrub reuses one scratch canvas, so its identity never changes; the
    // stroke count is what actually says the pixels are different.
    revision: shown?.strokes ?? 0,
  });

  // --- the drilled cell ----------------------------------------------------
  // `?px=` holds the one someone chose; hovering only previews it, because a
  // mouse crossing the canvas passes over hundreds of cells and none of them is
  // a place anyone asked to be.
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

  // The core reads the same moment the canvas does. Scrub back an hour and the
  // bands laid after it are gone, not greyed out.
  const bands = useMemo(() => {
    if (sample === null) return [];
    if (atEnd || shown === null) return sample.bands;
    return bandsUpTo(sample, shown.upTo);
  }, [sample, atEnd, shown]);

  useDocumentTitle(
    data === null ? `Day ${day} — Strata` : `Day ${day}: ${data.theme.theme} — Strata`,
  );

  const empty = data !== null && data.stats.placements === 0;
  const canDraw = data !== null && image !== null && !empty;

  return (
    <Section
      className="excavation"
      head={
        <>
          {/* The loudest number on the page, in the face the canvas is drawn
              with. `PixelText` keeps the real words in the DOM, so this is
              still a heading a screen reader reads and a link preview quotes. */}
          <h1 className="day-title">
            {/* Sentence case here, not shouting: `fontSafe` folds to uppercase
                when it draws, so the glyphs are capitals and the heading a
                screen reader reads is still "Day 500". */}
            <PixelText scale={6}>{`Day ${day}`}</PixelText>
          </h1>
          {data !== null && <p className="day-theme">{data.theme.theme}</p>}
          <p className="day-open">
            {open
              ? "Still being painted — this canvas is not final."
              : `Closed. Opened at ${utcTime(openedAt)}, and final since.`}
          </p>
        </>
      }
      canvas={
        <section className="canvas-panel" aria-label={`Day ${day} canvas`}>
          {canDraw ? (
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
              {(state.status === "idle" || state.status === "loading") && (
                <LoadingDay
                  day={day}
                  progress={state.status === "loading" ? state.progress : initialProgress()}
                />
              )}
              {state.status === "failed" && (
                <Failure message={state.message} detail={state.detail} onRetry={reload}>
                  <a href={basepaintDayUrl(day)}>See it on basepaint.xyz instead</a>
                </Failure>
              )}
              {empty && (
                <Nothing onRetry={reload}>
                  Nothing has been painted on day {day} yet. The canvas opened at{" "}
                  {utcTime(openedAt)}.
                </Nothing>
              )}
            </div>
          )}
        </section>
      }
      axis={
        <Scrubber
          value={t}
          max={elapsed}
          onChange={setT}
          activity={activity}
          strokesShown={shown?.strokes}
          strokesTotal={timeline?.count}
          playing={playback.playing}
          onPlayToggle={playback.toggle}
          dayOpen={open}
          disabled={idle}
        />
      }
      column={
        <CoreSample
          pixel={drilled}
          bands={bands}
          artists={data?.placements.artists ?? []}
          palette={data?.palette ?? []}
          openedAt={openedAt}
          loading={data === null && state.status !== "failed"}
          laterBands={sample === null ? 0 : sample.bands.length - bands.length}
          preview={hovered !== null}
        />
      }
      below={
        <div className="excavation-below">
          <ModeSwitch mode={mode} onChange={setMode} disabled={!canDraw} />

          {mode === "depth" && data !== null && <DepthLegend maxDepth={data.stats.maxDepth} />}

          {/* Only on screen while the contract still has this canvas on sale. */}
          <MintButton day={day} />

          {data !== null && !empty && <DayNumbers data={data} />}

          <p className="day-elsewhere">
            <a href={basepaintDayUrl(day)}>See day {day} on basepaint.xyz</a>
          </p>
        </div>
      }
    />
  );
}

/** A day number that is not one. Said in words, with the way back. */
function BadDay({ message }: { readonly message: string }) {
  useDocumentTitle("No such day — Strata");

  return (
    <div className="page">
      <h1>That day does not exist</h1>
      <Failure message={message}>
        <Link to="/">Start from today</Link>
      </Failure>
    </div>
  );
}

function DayNumbers({ data }: { readonly data: DayData }) {
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
