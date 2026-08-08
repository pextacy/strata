import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import App from "../src/App.js";

/**
 * The structural half of accessibility, read off the real markup.
 *
 * `ui-smoke.test.tsx` checks that each route renders and says the right words.
 * This checks the things a screen reader navigates by, which no amount of
 * correct copy makes up for: one first-level heading per page, headings that do
 * not skip a level, a name on every control, and alternative text on every
 * image. None of it needs a browser — `renderToStaticMarkup` produces the same
 * document the crawler and the first paint see.
 *
 * What this cannot see is anything an effect draws: the canvas, the core sample
 * once a day has loaded, the mint button. Those are covered where they are
 * built, by the tests that render them with props.
 */

const ROUTES = [
  "/",
  "/day/500",
  "/day/500?mode=ghost&px=100,100",
  "/day/nope",
  "/artist/0x1234567890AbcdEF1234567890aBcdef12345678",
  "/artist/vitalik",
  "/nothing/here",
];

const render = (path: string): string =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );

/** Every tag of one name, with its attributes, as written. */
const tags = (html: string, name: string): string[] =>
  html.match(new RegExp(`<${name}\\b[^>]*>`, "gi")) ?? [];

/** Heading levels in the order they appear. */
function headingLevels(html: string): number[] {
  return [...html.matchAll(/<h([1-6])\b/gi)].map((match) => Number(match[1]));
}

/** The text a tag wraps, with markup removed — a rough accessible name. */
function textInside(html: string, openTag: string): string {
  const at = html.indexOf(openTag);
  if (at === -1) return "";
  const name = /<([a-z]+)/i.exec(openTag)?.[1] ?? "";
  const close = html.indexOf(`</${name}>`, at);
  if (close === -1) return "";
  return html
    .slice(at + openTag.length, close)
    .replace(/<[^>]*>/g, "")
    .trim();
}

const attribute = (tag: string, name: string): string | null =>
  new RegExp(`\\s${name}="([^"]*)"`, "i").exec(tag)?.[1] ?? null;

describe.each(ROUTES)("%s", (path) => {
  const html = render(path);

  it("has exactly one first-level heading", () => {
    // Two <h1>s means two documents as far as a screen reader is concerned; none
    // means a page that cannot be found by heading at all.
    expect(headingLevels(html).filter((level) => level === 1)).toHaveLength(1);
  });

  it("opens with its h1 rather than burying it under a lower heading", () => {
    expect(headingLevels(html)[0]).toBe(1);
  });

  it("never skips a heading level on the way down", () => {
    const levels = headingLevels(html);
    for (let i = 1; i < levels.length; i++) {
      // Going back up any distance is fine; going down more than one at a time
      // leaves a gap a reader navigating by heading falls into.
      expect(levels[i] - levels[i - 1], `h${levels[i - 1]} then h${levels[i]}`).toBeLessThanOrEqual(
        1,
      );
    }
  });

  it("gives every image alternative text, even if it is empty on purpose", () => {
    // The beacon is decorative and carries alt="", which is the right answer —
    // a missing attribute is not, because a reader then announces the filename.
    for (const tag of tags(html, "img")) expect(attribute(tag, "alt"), tag).not.toBeNull();
  });

  it("gives every control a name", () => {
    for (const tag of tags(html, "button")) {
      const name = attribute(tag, "aria-label") ?? textInside(html, tag);
      expect(name, `unnamed button: ${tag}`).not.toBe("");
    }
  });

  it("labels every text input", () => {
    for (const tag of tags(html, "input")) {
      const id = attribute(tag, "id");
      const labelled =
        attribute(tag, "aria-label") !== null ||
        attribute(tag, "aria-labelledby") !== null ||
        (id !== null && new RegExp(`<label[^>]*\\sfor="${id}"`).test(html));
      expect(labelled, `unlabelled input: ${tag}`).toBe(true);
    }
  });

  it("keeps the skip link first, so it is the first thing a tab reaches", () => {
    expect(html.indexOf("skip-link")).toBeGreaterThanOrEqual(0);
    expect(html.indexOf("skip-link")).toBeLessThan(html.indexOf("<header"));
    expect(html).toContain('href="#content"');
  });

  it("has one main landmark for the skip link to land on", () => {
    const mains = tags(html, "main");
    expect(mains).toHaveLength(1);
    expect(attribute(mains[0], "id")).toBe("content");
    // Focusable programmatically, or the skip link moves the viewport and
    // leaves the keyboard where it was.
    expect(attribute(mains[0], "tabindex")).toBe("-1");
  });

  /**
   * Stricter than the spec, deliberately. ARIA only requires a name when two
   * landmarks of a kind could be confused for each other, and most pages here
   * have one `<nav>` and one `<aside>`. But "complementary" and "navigation"
   * announced with no name tell a reader the shape of the page and nothing about
   * it, and every landmark in this codebase already carries a label — the header
   * nav is "Days", the column is "Core sample". This holds that line rather than
   * letting the next one be the exception.
   */
  it("names every navigation and complementary landmark", () => {
    for (const name of ["nav", "aside"]) {
      for (const tag of tags(html, name)) {
        const label = attribute(tag, "aria-label") ?? attribute(tag, "aria-labelledby");
        expect(label, `unnamed <${name}>: ${tag}`).not.toBeNull();
      }
    }
  });
});
