import { Link } from "react-router-dom";

import { currentDay } from "../core/day-math.js";
import { useDocumentTitle } from "../ui/useDocumentTitle.js";

/** A path that is not a route says so in words and offers the way back. */
export default function NotFound() {
  useDocumentTitle("No such page — Strata");
  const today = currentDay();

  return (
    <div className="page">
      <h1>No such page</h1>
      <p className="lede">
        Strata has a page per day and a page per artist. A day looks like{" "}
        <code>/day/500</code>, a pixel inside one looks like{" "}
        <code>/day/500?px=236,56</code>, and an artist looks like{" "}
        <code>/artist/0x…</code>.
      </p>
      <p>
        <Link to="/">Start from today</Link>
        <span aria-hidden="true"> · </span>
        <Link to={`/day/${today}`}>Day {today}</Link>
      </p>
    </div>
  );
}
