// The last thing standing between a thrown render and a blank white page.
//
// Every other failure in this app is a value: a fetch that did not resolve, a
// day the indexer does not have, an address that is not one. Those are handled
// where they happen and say so in words. This is for the failure that is not a
// value — a bug, a browser without a canvas, a decoded day whose shape changed
// underneath us. React unmounts the whole tree on an uncaught throw, so without
// this the person gets no page and no sentence explaining why.
//
// There are two of these mounted. The one inside `Shell` keeps the header, the
// footer and the day navigation alive, so a broken page is still a page you can
// leave; the one around the whole app is the last resort for a throw in the
// frame itself.

import { Component, type ErrorInfo, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

import { Failure } from "./states.tsx";

export interface ErrorBoundaryProps {
  readonly children: ReactNode;
  /**
   * Changing this clears a caught error. Navigation passes the path, so a page
   * that throws does not poison every page reached from it — otherwise the only
   * way out of one bad render is a reload.
   *
   * The path and not the whole location: the query string carries the scrub
   * position, which changes many times a second while someone drags the
   * timeline, and a boundary keyed on that would re-run a throwing render on
   * every frame instead of holding still and saying what happened.
   */
  readonly resetKey?: string;
  /** Named in the sentence the person reads, so they know how much is broken. */
  readonly scope?: string;
}

interface ErrorBoundaryState {
  readonly error: Error | null;
  /** What `resetKey` was when the error was caught, to notice it changing. */
  readonly caughtAt: string | undefined;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null, caughtAt: undefined };

  static getDerivedStateFromError(error: unknown): Pick<ErrorBoundaryState, "error"> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  /**
   * Clearing happens here rather than in `componentDidUpdate` so that a
   * navigation renders the new page immediately — deriving it from props costs
   * one render, where setting state afterwards costs two and flashes the
   * fallback in between.
   */
  static getDerivedStateFromProps(
    props: ErrorBoundaryProps,
    state: ErrorBoundaryState,
  ): ErrorBoundaryState | null {
    if (state.error === null) return { error: null, caughtAt: props.resetKey };
    return state.caughtAt === props.resetKey ? null : { error: null, caughtAt: props.resetKey };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // Nothing here reports home — there is no backend to report to. The console
    // is where a developer looks, and the component stack is the half of this
    // that a stack trace alone does not give them.
    console.error("Strata stopped rendering:", error, info.componentStack);
  }

  private readonly reload = (): void => {
    window.location.reload();
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;

    return (
      <ErrorFallback error={error} scope={this.props.scope} onReload={this.reload} />
    );
  }
}

export interface ErrorFallbackProps {
  readonly error: Error;
  readonly scope?: string;
  readonly onReload: () => void;
}

/**
 * Split out from the boundary so it can be rendered — and read back — without
 * throwing anything, which is the only way to check this copy in a test that
 * has no browser.
 */
export function ErrorFallback({ error, scope, onReload }: ErrorFallbackProps) {
  const what = scope === undefined ? "Strata" : scope;

  return (
    <Failure
      message={`${what} hit a bug and stopped drawing. Nothing you did caused this, and nothing on the chain is affected — what you were looking at is still there.`}
      detail={detailOf(error)}
      onRetry={onReload}
      retryLabel="Reload the page"
    >
      <Link to="/">Start from today</Link>
    </Failure>
  );
}

/**
 * One line, and never an empty one: a boundary that says nothing about the
 * error is worse than no boundary, because it hides the bug from whoever is
 * reading the page over someone's shoulder.
 */
function detailOf(error: Error): string {
  const message = error.message.trim();
  return message === "" ? error.name : `${error.name}: ${message}`;
}

/**
 * The boundary as pages use it: clears itself when the address bar changes, so
 * navigating away from a page that threw actually works.
 */
export function RouteErrorBoundary({ children, scope }: Omit<ErrorBoundaryProps, "resetKey">) {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary resetKey={pathname} scope={scope}>
      {children}
    </ErrorBoundary>
  );
}
