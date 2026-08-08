// "/" — today's canvas, live, in the same four modes as any other day, with the
// day's time band under it. Most first-time visitors land here, so the page says
// what Strata is in one line and then gets out of the way of the painting.

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { DAY_DURATION } from "../core/constants.js";
import { currentDay, dayEnd, dayStart, isDayOpen } from "../core/day-math.js";
import { MODE_COPY } from "../render/layers.js";
import { useDay } from "../data/useDay.js";
import { initialProgress } from "../data/day.js";
import { basepaintDayUrl } from "../data/links.js";
import { CanvasView } from "../ui/CanvasView.js";
import { DepthLegend } from "../ui/DepthLegend.js";
import { ModeSwitch } from "../ui/ModeSwitch.js";
import { PixelText } from "../ui/PixelText.js";
import { Scrubber } from "../ui/Scrubber.js";
import { Section } from "../ui/Section.js";
import { Stat } from "../ui/Stat.js";
import { Failure, LoadingDay, Nothing } from "../ui/states.js";
import { useDocumentTitle } from "../ui/useDocumentTitle.js";
import { useLayerImage } from "../ui/useLayerImage.js";
import { usePlayback } from "../ui/usePlayback.js";
import { useTimeParam } from "../ui/useTimeParam.js";
import { useActivity, useTimeline } from "../ui/useTimeline.js";
import { useViewMode } from "../ui/useViewMode.js";
import "../styles/parts.css";
import "../styles/home.css";

const count = new Intl.NumberFormat("en-US");

/** The day rolls over at about 16:42 UTC. A tab left open should notice. */
const TICK_MS = 30_000;

export default function Home() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const day = currentDay(now);
  const open = isDayOpen(day, now);
  const { state, reload } = useDay(day);
  const data = state.status === "ready" ? state.data : null;

  const { mode, setMode } = useViewMode();

  // The band covers as much of the day as has actually happened. On a finished
  // day that is the whole 24 hours; on today it stops at now.
  const elapsed = open ? Math.max(0, Math.min(DAY_DURATION, now - dayStart(day))) : DAY_DURATION;

  const placements = data?.placements ?? null;
  const timeline = useTimeline(placements, data?.size ?? 0);
  // The window the band draws has to be the window the handle slides over, or
  // the bars sit under the wrong part of the track. Home is always looking at an
  // unfinished day, so this is the page where getting it wrong always showed.
  const activity = useActivity(placements, dayStart(day), dayStart(day) + elapsed);

  const { t, atEnd, setT } = useTimeParam(elapsed);
  const playback = usePlayback({
    value: t,
    onChange: setT,
    max: elapsed,
    disabled: timeline === null || timeline.count === 0,
  });

  // At the end of the day the finished buffers are already in hand; only a
  // scrub has to rebuild anything.
  const shown = useMemo(() => {
    if (data === null || timeline === null) return null;
    if (atEnd) return { layers: data.layers, strokes: timeline.count };
    const strokes = timeline.countAtTime(dayStart(day) + t);
    return { layers: timeline.frameAt(strokes), strokes };
  }, [data, timeline, atEnd, day, t]);

  const image = useLayerImage({
    mode,
    layers: shown?.layers ?? null,
    rgba: data?.rgba ?? null,
    maxDepth: data?.stats.maxDepth ?? 1,
    // The scrub reuses one scratch canvas, so its identity never changes; the
    // stroke count is what actually says the pixels are different.
    revision: shown?.strokes ?? 0,
  });

  useDocumentTitle(
    data === null
      ? `Strata — day ${day}`
      : `Day ${day}: ${data.theme.theme} — Strata`,
  );

  const empty = data !== null && data.stats.placements === 0;

  return (
    <Section
      head={
        <>
          {/* The page's argument, as a number about today rather than a
              sentence about canvases in general.

              Every other landing page for a tool like this opens by explaining
              itself. This one states the thing it exists because of: paint that
              was put down today and is already gone. It is the same figure the
              Ghost view draws, it is live, and it climbs while you read it —
              which is the whole claim, made without a word of persuasion.

              Until the day is replayed there is no number to stand behind, so
              the sentence takes its place rather than a zero or a skeleton. */}
          {data !== null && !empty && data.stats.buriedPlacements > 0 ? (
            <p className="home-thesis">
              <PixelText className="home-buried" scale={7}>
                {count.format(data.stats.buriedPlacements)}
              </PixelText>
              <span className="home-thesis-line">
                pixels have already been painted over today. The image BasePaint publishes
                tonight will show none of them.
              </span>
            </p>
          ) : (
            <p className="home-lede">
              {data !== null && !empty
                ? "Nothing has been covered yet today. Every pixel placed so far is still on the canvas — watch it start to stack."
                : "Every BasePaint canvas is a stack of paintings, and only the top one has ever been visible. Strata replays the strokes and digs out the rest."}
            </p>
          )}
          <h1 className="home-title">
            Day {day}
            {data !== null && <span className="home-theme">{data.theme.theme}</span>}
          </h1>
          <p className="home-status">
            {open ? "Being painted right now." : "Closed. This canvas is final."}{" "}
            <Link to={`/day/${day}`}>Dig into day {day}</Link>
          </p>
        </>
      }
      canvas={
        <div className="home-canvas">
          {data !== null && image !== null && !empty ? (
            <CanvasView
              image={image}
              size={data.size}
              label={`Day ${day}, ${MODE_COPY[mode].label.toLowerCase()} view, rebuilt from the on-chain strokes`}
            />
          ) : (
            <div className="home-canvas-waiting">
              {/* Idle is the flicker before the first effect runs. It is still
                  a state a person can see, so it says the same thing. */}
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
                  Nobody has painted on day {day} yet. The canvas opened{" "}
                  {formatAgo(now - dayStart(day))} ago and closes{" "}
                  {formatAgo(dayEnd(day) - now)} from now.
                </Nothing>
              )}
            </div>
          )}
        </div>
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
          disabled={timeline === null || timeline.count === 0}
        />
      }
      below={
        <div className="home-below">
          <ModeSwitch mode={mode} onChange={setMode} disabled={data === null || empty} />

          {mode === "depth" && data !== null && <DepthLegend maxDepth={data.stats.maxDepth} />}

          {data !== null && !empty && (
            <dl className="home-stats">
              <Stat
                label="Artists"
                value={count.format(data.placements.artists.length)}
                definition="Addresses that placed at least one pixel on this canvas."
              />
              <Stat
                label="Pixels painted"
                value={count.format(data.stats.placements)}
                definition="Placements: one pixel written by one stroke. A cell can hold many."
              />
              <Stat
                label="Buried"
                value={count.format(data.stats.buriedPlacements)}
                definition="Placements later covered by a different colour on the same cell. This is what Ghost draws."
              />
            </dl>
          )}

          <nav className="home-recent" aria-label="Recent days">
            <h2 className="home-recent-title">Dig into an earlier day</h2>
            <ul className="home-recent-list">
              {recentDays(day).map((n) => (
                <li key={n}>
                  <Link to={`/day/${n}`}>Day {n}</Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      }
    />
  );
}

/** The last few finished days. Numbers only — no counts nobody has fetched. */
function recentDays(today: number, howMany = 8): number[] {
  const days: number[] = [];
  for (let n = today - 1; n >= 1 && days.length < howMany; n--) days.push(n);
  return days;
}

/** "3 hours", "18 minutes" — a rough span, never a fake-precise one. */
function formatAgo(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 90) return `${s} second${s === 1 ? "" : "s"}`;
  const minutes = Math.round(s / 60);
  if (minutes < 90) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}
