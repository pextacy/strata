import { useCallback, useEffect, useState } from "react";

import { currentDay, dayEnd, dayStart, isDayOpen } from "./core/day-math.ts";
import { DataError } from "./data/client.ts";
import { BEACON_URL, basepaintUrl } from "./data/links.ts";
import { fetchTheme, type Theme } from "./data/theme.ts";

/**
 * Phase 0 surface: proof that live data arrives. The day number is arithmetic,
 * everything else comes from the theme API. Nothing here is invented — when the
 * fetch fails the screen says what failed and offers a retry.
 */

type State =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly theme: Theme }
  | { readonly status: "failed"; readonly message: string; readonly detail?: string };

const utc = (unixSec: number) =>
  `${new Date(unixSec * 1000).toISOString().replace("T", " ").slice(0, 16)} UTC`;

export default function App() {
  const [day] = useState(currentDay);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State>({ status: "loading" });

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });

    fetchTheme(day, { signal: controller.signal })
      .then((theme) => {
        // The Phase 0 gate: day number, theme name, palette length, all live.
        console.log(
          `day ${theme.day} · ${theme.theme} · ${theme.palette.length} colours · ${theme.size}×${theme.size}`,
        );
        setState({ status: "ready", theme });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof DataError) {
          setState({ status: "failed", message: error.message, detail: error.detail });
        } else {
          setState({
            status: "failed",
            message: "Strata could not read today's theme.",
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      });

    return () => controller.abort();
  }, [day, attempt]);

  return (
    <main>
      <h1>Strata</h1>
      <p className="lede">
        Every BasePaint canvas is a stack of paintings, and only the top one has ever been
        visible.
      </p>

      <dl>
        <dt>Day</dt>
        <dd>
          {day} {isDayOpen(day) ? "· being painted now" : "· closed"}
        </dd>

        <dt>Opened</dt>
        <dd>{utc(dayStart(day))}</dd>

        <dt>Closes</dt>
        <dd>{utc(dayEnd(day))}</dd>

        {state.status === "ready" && (
          <>
            <dt>Theme</dt>
            <dd>{state.theme.theme}</dd>

            <dt>Canvas</dt>
            <dd>
              {state.theme.size}&times;{state.theme.size}
            </dd>

            <dt>Palette</dt>
            <dd>
              <span className="swatches">
                {state.theme.palette.map((color) => (
                  <span key={color} className="swatch" style={{ background: color }} title={color} />
                ))}
              </span>{" "}
              {state.theme.palette.length} colours
            </dd>
          </>
        )}
      </dl>

      {state.status === "loading" && (
        <p role="status">Asking basepaint.xyz for the day {day} theme&hellip;</p>
      )}

      {state.status === "failed" && (
        <p role="alert">
          {state.message}{" "}
          <button type="button" onClick={retry}>
            Try again
          </button>
          {state.detail !== undefined && <small className="detail">{state.detail}</small>}
        </p>
      )}

      <footer>
        <a href={basepaintUrl()}>Paint at basepaint.xyz</a>
        <img src={BEACON_URL} width={1} height={1} alt="" />
      </footer>
    </main>
  );
}
