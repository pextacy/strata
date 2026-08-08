import { Link } from "react-router-dom";

/** A path that is not a route says so in words and offers the way back. */
export default function NotFound() {
  return (
    <main>
      <h1>No such page</h1>
      <p className="lede">
        Strata has a page per day. Days look like <code>/day/500</code>, and a
        pixel inside one looks like <code>/day/500?px=236,56</code>.
      </p>
      <p>
        <Link to="/">Start from today</Link>
      </p>
    </main>
  );
}
