// The frame every page sits in: one header, one footer, one beacon, and a skip
// link ahead of both. Pages compose their own content; nothing below this file
// has to remember to link back to BasePaint or to count itself as traffic.

import { useState, type FormEvent, type ReactNode } from "react";
import { Link, Outlet, useMatch, useNavigate, useSearchParams } from "react-router-dom";

import { currentDay } from "../core/day-math.ts";
import { BEACON_URL, basepaintUrl } from "../data/links.ts";
import { isViewMode } from "../render/layers.ts";
import { RouteErrorBoundary } from "./ErrorBoundary.tsx";
import { PixelText } from "./PixelText.tsx";
import "../styles/shell.css";

const REPO_URL: string | undefined = import.meta.env.VITE_REPO_URL;

export interface ShellProps {
  /** Pages passed as children; otherwise the routed page renders here. */
  readonly children?: ReactNode;
}

export function Shell({ children }: ShellProps) {
  return (
    <>
      <a className="skip-link" href="#content">
        Skip to the canvas
      </a>
      <SiteHeader />
      <main id="content" className="site-main" tabIndex={-1}>
        {/* Scoped to the page, so a day that throws still leaves the header and
            the day navigation to walk away with. */}
        <RouteErrorBoundary scope="This page">{children ?? <Outlet />}</RouteErrorBoundary>
      </main>
      <SiteFooter />
    </>
  );
}

function SiteHeader() {
  const onDay = useMatch("/day/:day");
  const raw = onDay?.params.day;
  const day = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : null;
  const latest = currentDay();

  // Stepping from one day to the next keeps the lens you were reading through —
  // comparing the ghost layer of two days is the whole point of having four
  // views. The moment and the drilled pixel do not travel: they belong to one
  // canvas and mean nothing on another.
  const [search] = useSearchParams();
  const mode = search.get("mode");
  const keepMode = mode !== null && isViewMode(mode) ? `?mode=${mode}` : "";
  const dayHref = (n: number): string => `/day/${n}${keepMode}`;

  return (
    <header className="site-head">
      <div className="site-head-inner">
        {/* The name, in the face the canvases and the share cards are drawn
            with. This is the fifth use of the bitmap font and the budget in
            CLAUDE.md says a fifth needs a reason: the reason is that a wordmark
            is the one place a product is allowed to state its own identity, and
            setting it in anything else would mean the logo, the cards and the
            numbers were three different ideas. */}
        <Link className="wordmark" to="/" aria-label="Strata, home">
          <PixelText scale={4}>Strata</PixelText>
        </Link>

        <nav className="site-nav" aria-label="Days">
          <Link className="nav-link" to={`/${keepMode}`}>
            Today
          </Link>
          {day !== null && (
            <span className="day-step">
              <StepLink to={dayHref(day - 1)} disabled={day <= 1} label="Previous day">
                ←
              </StepLink>
              <span className="day-step-now">Day {day}</span>
              <StepLink to={dayHref(day + 1)} disabled={day >= latest} label="Next day">
                →
              </StepLink>
            </span>
          )}
          <DayJump latest={latest} href={dayHref} />
        </nav>

        <a className="nav-out" href={basepaintUrl()}>
          Paint at basepaint.xyz
        </a>
      </div>
    </header>
  );
}

function StepLink({
  to,
  disabled,
  label,
  children,
}: {
  readonly to: string;
  readonly disabled: boolean;
  readonly label: string;
  readonly children: ReactNode;
}) {
  if (disabled) {
    // Still on screen, so the row never changes width — but not focusable, and
    // announced as unavailable rather than silently doing nothing.
    return (
      <span className="step-link is-off" aria-hidden="true">
        {children}
      </span>
    );
  }
  return (
    <Link className="step-link" to={to} aria-label={label}>
      {children}
    </Link>
  );
}

/** Straight to a day by number. Every day since day 1 is reachable this way. */
function DayJump({
  latest,
  href,
}: {
  readonly latest: number;
  readonly href: (day: number) => string;
}) {
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (trimmed === "") {
      setProblem("Type a day number first — days run from 1 to " + latest + ".");
      return;
    }
    if (!/^\d+$/.test(trimmed)) {
      setProblem(`“${trimmed}” is not a day number.`);
      return;
    }
    const day = Number(trimmed);
    if (day < 1) {
      setProblem("Days are counted from 1. There is no day 0.");
      return;
    }
    if (day > latest) {
      setProblem(`Day ${day} has not opened yet. Today is day ${latest}.`);
      return;
    }
    setProblem(null);
    setValue("");
    navigate(href(day));
  };

  return (
    <form className="day-jump" onSubmit={submit}>
      <label className="visually-hidden" htmlFor="day-jump-input">
        Go to a day by number
      </label>
      <input
        id="day-jump-input"
        className="day-jump-input"
        type="text"
        inputMode="numeric"
        placeholder="Day"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          if (problem !== null) setProblem(null);
        }}
      />
      <button type="submit" className="day-jump-go">
        Go
      </button>
      {problem !== null && (
        <span role="alert" className="day-jump-problem">
          {problem}
        </span>
      )}
    </form>
  );
}

function SiteFooter() {
  return (
    <footer className="site-foot">
      <p className="site-foot-line">
        Rebuilt from the on-chain stroke history. BasePaint artwork is CC0; every pixel here is
        credited to the address that placed it.
      </p>
      <p className="site-foot-links">
        <a href={basepaintUrl()}>basepaint.xyz</a>
        {/* Only rendered once there is a repository to point at. A dead link is
            worse than no link. */}
        {REPO_URL !== undefined && REPO_URL !== "" && (
          <>
            <span aria-hidden="true"> · </span>
            <a href={REPO_URL}>Source</a>
          </>
        )}
      </p>
      {/* BasePaint's own counter. Optional for them, free for us, and it lets
          them see the traffic a derivative client sends their way. */}
      <img src={BEACON_URL} width={1} height={1} alt="" />
    </footer>
  );
}
