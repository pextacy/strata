import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import App from "../src/App.tsx";
import Home from "../src/routes/Home.tsx";
import { Scrubber } from "../src/ui/Scrubber.tsx";
import { Section } from "../src/ui/Section.tsx";
import { Shell } from "../src/ui/Shell.tsx";
import { Failure, LoadingDay, Nothing } from "../src/ui/states.tsx";
import { initialProgress } from "../src/data/day.ts";

/**
 * A page that typechecks can still throw on its first render. This mounts the
 * real components — no mocks — and reads the markup back, which is also how the
 * copy in every loading, empty and error state gets checked without a browser.
 *
 * Effects do not run here, so nothing reaches the network.
 */

const render = (node: ReactNode): string =>
  renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);

/** The whole app at one URL, router and frame included. */
const route = (path: string): string =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );

describe("Shell", () => {
  const html = render(
    <Shell>
      <p>page</p>
    </Shell>,
  );

  it("puts a skip link ahead of the header", () => {
    expect(html.indexOf("Skip to the canvas")).toBeLessThan(html.indexOf("wordmark"));
    expect(html).toContain('href="#content"');
  });

  it("links back to basepaint.xyz and carries the beacon", () => {
    expect(html).toContain("https://basepaint.xyz");
    expect(html).toContain("beacon.gif?ref=strata");
  });

  it("credits the artwork's CC0 status", () => {
    expect(html).toContain("CC0");
  });

  it("does not link to a repository that has not been set", () => {
    expect(html).not.toContain(">Source<");
  });
});

describe("Home", () => {
  const html = render(
    <Shell>
      <Home />
    </Shell>,
  );

  it("says what Strata is before anything else", () => {
    expect(html).toContain("only the top one has ever been visible");
  });

  it("offers the four view modes and the way into the full day", () => {
    for (const mode of ["Final", "Underpainting", "Depth", "Ghost"]) {
      expect(html).toContain(`>${mode}<`);
    }
    expect(html).toContain("Dig into day");
  });

  it("lays the canvas out as a section with the time band under it", () => {
    expect(html.indexOf("section-canvas")).toBeLessThan(html.indexOf("section-axis"));
  });
});

describe("states", () => {
  it("counts strokes rather than showing a bare spinner", () => {
    const html = render(<LoadingDay day={500} progress={initialProgress()} />);
    expect(html).toContain("Asking basepaint.xyz for the day 500 palette");
    expect(html).toContain('role="status"');
  });

  it("names what failed, what to do, and the underlying detail", () => {
    const html = render(
      <Failure
        message="Strata could not rebuild day 500."
        detail="HTTP 502 from graphql.basepaint.xyz"
        onRetry={() => {}}
      />,
    );
    expect(html).toContain("Strata could not rebuild day 500.");
    expect(html).toContain("Try again");
    expect(html).toContain("HTTP 502");
    expect(html).toContain('role="alert"');
  });

  it("says nothing is there in words", () => {
    const html = render(<Nothing>Nothing survived here.</Nothing>);
    expect(html).toContain("Nothing survived here.");
  });
});

describe("Scrubber", () => {
  const props = {
    value: 3600,
    max: 86_400,
    onChange: () => {},
    playing: false,
    onPlayToggle: () => {},
  };

  it("reads out the moment and the strokes behind it", () => {
    const html = render(<Scrubber {...props} strokesShown={1234} strokesTotal={9999} />);
    expect(html).toContain("01:00");
    expect(html).toContain("1,234 of 9,999 strokes laid");
    expect(html).toContain('type="range"');
    expect(html).toContain('aria-label="Time of day"');
  });

  it("says so plainly when there is nothing to scrub", () => {
    const html = render(<Scrubber {...props} max={0} disabled />);
    expect(html).toContain("Nothing to scrub through yet.");
    expect(html).toContain("disabled");
  });
});

describe("Section", () => {
  it("drops the side column when nothing is in it", () => {
    expect(render(<Section canvas={<i />} />)).not.toContain("has-column");
    expect(render(<Section canvas={<i />} column={<i />} />)).toContain("has-column");
  });

  it("carries a page's own class alongside its own", () => {
    expect(render(<Section canvas={<i />} className="excavation" />)).toContain(
      'class="section excavation"',
    );
  });
});

/**
 * The routes, rendered through the real router. A page that renders on its own
 * can still be unreachable, and every one of these was at some point.
 */
describe("routes", () => {
  const frame = (html: string) => {
    // Every route sits in the shell: one skip link, one header, one footer, and
    // exactly one <main> — not one per page.
    expect(html).toContain("Skip to the canvas");
    expect(html).toContain('class="wordmark"');
    expect(html.match(/<main/g)?.length).toBe(1);
    expect(html).toContain("beacon.gif?ref=strata");
  };

  it("lands on today's canvas at /", () => {
    const html = route("/");
    frame(html);
    expect(html).toContain("only the top one has ever been visible");
    expect(html).toContain("Dig into day");
  });

  it("digs a day at /day/:day, with the time band and the core sample", () => {
    const html = route("/day/500");
    frame(html);
    // The heading is drawn in the bitmap face, so the words sit in a span
    // inside the h1 rather than directly in it. What matters is unchanged:
    // the page's one heading names the day, in sentence case.
    const heading = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? "";
    expect(heading).toContain("Day 500");
    expect(heading).not.toContain("DAY 500");
    // Canvas, then the axis under it, then the column beside it — PRD §6.
    expect(html).toContain("has-column");
    expect(html.indexOf("section-canvas")).toBeLessThan(html.indexOf("section-axis"));
    expect(html).toContain('aria-label="Time of day"');
    expect(html).toContain("Core sample");
    for (const mode of ["Final", "Underpainting", "Depth", "Ghost"]) {
      expect(html).toContain(`>${mode}<`);
    }
  });

  it("says in words when a day number is not one", () => {
    const html = route("/day/nope");
    frame(html);
    expect(html).toContain("is not a day number");
    expect(html).toContain("Start from today");
  });

  it("opens an artist record at /artist/:address", () => {
    const html = route("/artist/0x1234567890AbcdEF1234567890aBcdef12345678");
    frame(html);
    expect(html).toContain("Survival record");
    expect(html).toContain("0x1234");
  });

  it("says an address is not one rather than showing empty numbers", () => {
    const html = route("/artist/vitalik");
    frame(html);
    expect(html).toContain("is not an Ethereum address");
  });

  it("keeps the frame on a path that is not a route", () => {
    const html = route("/nothing/here");
    frame(html);
    expect(html).toContain("No such page");
    expect(html).toContain("/artist/0x");
  });
});
