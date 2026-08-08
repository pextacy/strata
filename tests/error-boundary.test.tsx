import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { ErrorBoundary, ErrorFallback } from "../src/ui/ErrorBoundary.tsx";

/**
 * `renderToStaticMarkup` does not run error boundaries — a throw propagates out
 * of the renderer instead of being caught — so the catching itself is checked
 * through `getDerivedStateFromError`, which is the whole of that decision, and
 * the fallback is rendered directly to read its copy back.
 */

const render = (path: string, node: React.ReactNode): string =>
  renderToStaticMarkup(<MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>);

describe("ErrorBoundary.getDerivedStateFromError", () => {
  it("keeps a thrown Error as it is", () => {
    const error = new TypeError("layers is not iterable");
    expect(ErrorBoundary.getDerivedStateFromError(error).error).toBe(error);
  });

  it("wraps a thrown non-Error rather than dropping it", () => {
    // Anything can be thrown, and a boundary that only handles Errors would
    // render an empty fallback for `throw "nope"`.
    const state = ErrorBoundary.getDerivedStateFromError("nope");
    expect(state.error).toBeInstanceOf(Error);
    expect(state.error?.message).toBe("nope");
  });
});

describe("ErrorBoundary", () => {
  it("renders its children when nothing has thrown", () => {
    const html = render("/", <ErrorBoundary>{<p>the canvas</p>}</ErrorBoundary>);
    expect(html).toContain("the canvas");
    expect(html).not.toContain("stopped drawing");
  });
});

/**
 * Whether a caught error survives the next render is the one piece of real
 * logic here, and getting it wrong is worse than having no boundary: too eager
 * and the fallback flickers away before it is read, too reluctant and one bad
 * page follows you around the site until you reload.
 */
describe("clearing a caught error", () => {
  const caught = { error: new Error("boom"), caughtAt: "/day/500" };

  it("holds the error while the path is the same", () => {
    // Dragging the scrubber re-renders this many times a second. Every one of
    // them must leave the fallback exactly where it is.
    expect(ErrorBoundary.getDerivedStateFromProps({ children: null, resetKey: "/day/500" }, caught))
      .toBe(null);
  });

  it("clears the error when the path changes", () => {
    const next = ErrorBoundary.getDerivedStateFromProps(
      { children: null, resetKey: "/day/501" },
      caught,
    );
    expect(next).toEqual({ error: null, caughtAt: "/day/501" });
  });

  it("remembers the path it is on while nothing is wrong", () => {
    // Without this the first error would be compared against a stale path and
    // clear itself on the very next render.
    const next = ErrorBoundary.getDerivedStateFromProps(
      { children: null, resetKey: "/day/500" },
      { error: null, caughtAt: undefined },
    );
    expect(next).toEqual({ error: null, caughtAt: "/day/500" });
  });
});

describe("the fallback", () => {
  const html = render(
    "/day/500",
    <ErrorFallback
      error={new TypeError("layers is not iterable")}
      scope="This page"
      onReload={() => {}}
    />,
  );

  it("says what broke, in words, without blaming the reader", () => {
    expect(html).toContain("This page hit a bug and stopped drawing");
    expect(html).toContain("Nothing you did caused this");
  });

  it("is announced as an error", () => {
    expect(html).toContain('role="alert"');
  });

  it("keeps the underlying error visible rather than swallowing it", () => {
    expect(html).toContain("TypeError: layers is not iterable");
  });

  it("offers both ways out — a reload and a page that is known to work", () => {
    expect(html).toContain("Reload the page");
    expect(html).toContain('href="/"');
    expect(html).toContain("Start from today");
  });

  it("names an error with no message rather than showing an empty line", () => {
    const bare = render("/", <ErrorFallback error={new RangeError("")} onReload={() => {}} />);
    expect(bare).toContain("RangeError");
    expect(bare).toContain("Strata hit a bug");
  });
});
