// /artist/:address — the number an artist cannot get anywhere else.
//
// Everything on this page is either a figure the indexer publishes or a figure
// Strata derived by rebuilding whole canvases. The two never blend into one
// total, and the derived ones say out loud how many days they cover.

import { useEffect, useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { aggregateSurvival, emptyLifetime, type OverpaintTally } from "../core/survival.js";
import { checksumAddress } from "../data/address.js";
import type { ArtistDayGap, ArtistDayRow } from "../data/artist.js";
import { basepaintUrl } from "../data/links.js";
import { useArtist } from "../data/useArtist.js";
import type { AccountRecord } from "../data/queries.js";
import { Address } from "../ui/Address.js";
import { PixelText } from "../ui/PixelText.js";
import { Stat } from "../ui/Stat.js";
import { Failure, Nothing } from "../ui/states.js";
import { useDocumentTitle } from "../ui/useDocumentTitle.js";
import "../styles/parts.css";
import "../styles/day.css";
import "../styles/artist.css";

const count = new Intl.NumberFormat("en-US");

const percent = (rate: number): string => `${(rate * 100).toFixed(1)}%`;

const artistPath = (address: string): string => `/artist/${checksumAddress(address) ?? address}`;

// Stable empties, so the memo below is not invalidated by fresh literals.
const NO_ROWS: readonly ArtistDayRow[] = [];
const NO_GAPS: readonly ArtistDayGap[] = [];

export default function Artist() {
  const params = useParams<{ address?: string }>();
  const navigate = useNavigate();

  const raw = (params.address ?? "").trim();
  const address = checksumAddress(raw);
  const { state, reload } = useArtist(address);

  useDocumentTitle(
    address === null ? "Not an address — Strata" : `${shorten(address)} — Strata`,
  );

  // Keep one spelling of an address in the address bar, so two links to the
  // same artist are the same link.
  useEffect(() => {
    if (address !== null && raw !== address) {
      navigate(`/artist/${address}`, { replace: true });
    }
  }, [address, raw, navigate]);

  // Aggregated as rows land, so the headline number always covers exactly the
  // days listed underneath it and never gets ahead of them.
  const { rows, gaps, lifetime } = useMemo(() => {
    if (state.status === "ready") {
      const { profile } = state;
      return { rows: profile.rows, gaps: profile.gaps, lifetime: profile.lifetime };
    }
    if (state.status === "loading") {
      return {
        rows: state.rows,
        gaps: state.gaps,
        lifetime: aggregateSurvival(state.rows.map((row) => row.record)),
      };
    }
    return { rows: NO_ROWS, gaps: NO_GAPS, lifetime: emptyLifetime() };
  }, [state]);

  if (address === null) {
    return (
      <div className="page artist">
        <h1>That is not an address</h1>
        <Failure
          message={
            raw === ""
              ? "This link is missing an address. Artist pages look like /artist/0x…"
              : `“${raw}” is not an Ethereum address. Strata expects the 42-character form beginning 0x.`
          }
        >
          <Link to="/">Start from today</Link>
        </Failure>
      </div>
    );
  }

  const account = state.status === "ready" ? state.profile.account : null;
  const totalDays = state.status === "ready" ? state.profile.totalDays : null;
  const neverPainted = state.status === "ready" && state.profile.requested.length === 0;
  /** Days Strata set out to rebuild, which is not always the number it managed. */
  const asked = state.status === "ready" ? state.profile.requested.length : null;

  return (
    <div className="page artist">
      <header className="day-head">
        <h1 className="artist-name">
          <Address address={address} keep={6} />
        </h1>
        <p className="day-theme">Survival record</p>
      </header>

      {state.status === "failed" && (
        <Failure message={state.message} detail={state.detail} onRetry={reload} />
      )}

      {neverPainted && (
        <Nothing>
          This address has never painted a BasePaint canvas. Nothing of theirs is buried
          anywhere. <a href={basepaintUrl()}>Painting happens at basepaint.xyz</a>.
        </Nothing>
      )}

      {state.status === "loading" && (
        <div className="loading" role="status">
          <p>
            {state.progress.phase === "account"
              ? "Asking the indexer which days this address painted…"
              : `Rebuilding ${state.progress.done} of ${state.progress.total} canvases — survival cannot be looked up, only replayed.`}
          </p>
          {state.progress.phase === "replaying" && (
            <progress
              className="loading-bar"
              value={state.progress.done}
              max={state.progress.total}
            />
          )}
        </div>
      )}

      {lifetime.days > 0 && (
        <>
          <section className="survival" aria-label="Survival">
            <p className="survival-rate">
              {/* The one number this page exists to give, in the face the
                  canvases are drawn with. */}
              <PixelText className="survival-figure" scale={7}>
                {percent(lifetime.survival ?? 0)}
              </PixelText>
              <span className="survival-caption">
                of the cells they painted still carry their colour
              </span>
            </p>
            {/* The scope has to survive a day that failed to rebuild. Saying
                "across 8 days — the most recent 10" in one breath is the kind of
                small contradiction that makes a reader stop trusting the big
                number above it, so both figures come from what actually landed. */}
            <p className="survival-scope">
              Measured across {lifetime.days} {lifetime.days === 1 ? "day" : "days"}
              {asked !== null && asked > lifetime.days && <> of the {asked} asked for</>}
              {totalDays !== null && totalDays > 0 && (
                <>
                  {" "}
                  — the most recent this address painted, of {count.format(totalDays)} in all
                </>
              )}
              . Strata rebuilds those canvases in the browser; days it has not replayed are not
              in this number.
            </p>
          </section>

          <dl className="stats">
            <Stat
              label="Cells claimed"
              value={count.format(lifetime.cellsClaimed)}
              definition="Cells whose final colour was written by this artist, summed over the replayed days."
            />
            <Stat
              label="Cells touched"
              value={count.format(lifetime.cellsTouched)}
              definition="Distinct cells this artist placed on at any point, summed over the replayed days."
            />
            <Stat
              label="Pixels placed"
              value={count.format(lifetime.placements)}
              definition="Every pixel written across the replayed days, counting each repaint of the same cell."
            />
            <Stat
              label="Survival rate"
              value={lifetime.survival === null ? "—" : percent(lifetime.survival)}
              definition="Cells claimed ÷ cells touched, summed first and divided once. Painting over yourself does not count against you."
            />
          </dl>

          <div className="rivals">
            <TallyList
              title="Painted over them most"
              empty="Nobody covered a single one of their pixels on these days."
              tallies={lifetime.coveredBy}
              definition="Placements by another artist that covered one of this artist's pixels with a different colour."
            />
            <TallyList
              title="They painted over most"
              empty="They never covered anyone else's colour on these days."
              tallies={lifetime.covered}
              definition="Placements by this artist that covered another artist's pixel with a different colour."
            />
          </div>
        </>
      )}

      {rows.length > 0 && <DayTable rows={rows} />}

      {gaps.length > 0 && (
        <ul className="notice notice-quiet gap-list">
          {gaps.map((gap) => (
            <li key={gap.day}>
              Day {gap.day} is not in these numbers: {gap.reason}.
            </li>
          ))}
        </ul>
      )}

      {account !== null && <IndexerTotals account={account} />}
    </div>
  );
}

const shorten = (address: string): string => `${address.slice(0, 6)}…${address.slice(-4)}`;

function TallyList({
  title,
  empty,
  tallies,
  definition,
}: {
  title: string;
  empty: string;
  tallies: readonly OverpaintTally[];
  definition: string;
}) {
  const top = tallies.slice(0, 3);
  const rest = tallies.length - top.length;

  return (
    <section className="rival">
      <h2 title={definition}>
        {title}
        <span className="visually-hidden"> — {definition}</span>
      </h2>
      {top.length === 0 ? (
        <p className="rival-empty">{empty}</p>
      ) : (
        <ol className="rival-list">
          {top.map((tally) => (
            <li key={tally.address}>
              <Link to={artistPath(tally.address)}>
                <Address address={tally.address} />
              </Link>
              <span className="rival-times">
                {count.format(tally.times)} {tally.times === 1 ? "pixel" : "pixels"}
              </span>
            </li>
          ))}
        </ol>
      )}
      {rest > 0 && (
        <p className="rival-rest">
          and {count.format(rest)} {rest === 1 ? "other" : "others"}
        </p>
      )}
    </section>
  );
}

function DayTable({ rows }: { rows: readonly ArtistDayRow[] }) {
  return (
    <section className="day-table" aria-label="Day by day">
      <div className="table-scroll">
        <table>
          <caption className="visually-hidden">
            Cells touched, cells claimed, and survival rate for each replayed day
          </caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Theme</th>
              <th scope="col" className="num">
                Placed
              </th>
              <th scope="col" className="num">
                Touched
              </th>
              <th scope="col" className="num">
                Claimed
              </th>
              <th scope="col" className="num">
                Survived
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.day}>
                <th scope="row">
                  <Link to={`/day/${row.day}`}>{row.day}</Link>
                </th>
                <td className="theme-cell">{row.theme}</td>
                {/* The indexer's own pixel count for the day usually matches the
                    replay exactly. When it does not, both numbers show rather
                    than one quietly winning. */}
                <td
                  className="num"
                  title={
                    row.reportedPixels === row.record.placements
                      ? undefined
                      : `The indexer credits ${count.format(row.reportedPixels)} pixels for this day. The difference is pixels Strata could not place: off-canvas, or naming a colour the day does not have.`
                  }
                >
                  {row.reportedPixels === row.record.placements
                    ? count.format(row.record.placements)
                    : `${count.format(row.record.placements)} of ${count.format(row.reportedPixels)}`}
                </td>
                <td className="num">{count.format(row.record.cellsTouched)}</td>
                <td className="num">{count.format(row.record.cellsClaimed)}</td>
                <td className="num">{percent(row.record.survival)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function IndexerTotals({ account }: { account: AccountRecord }) {
  return (
    <section className="indexer-totals" aria-label="Lifetime totals from the indexer">
      <h2>Everything, from the indexer</h2>
      <p className="indexer-note">
        These come straight from the BasePaint indexer and cover every day this address has
        painted, replayed or not. Survival is not among them, which is why the numbers above
        exist.
      </p>
      <dl className="stats">
        <Stat
          label="Pixels placed"
          value={count.format(account.totalPixels)}
          definition="Every pixel this address has ever placed, as counted by the BasePaint indexer."
        />
        <Stat
          label="Days painted"
          value={count.format(account.totalDaysPainted)}
          definition="Canvases this address has contributed at least one pixel to."
        />
        <Stat
          label="Current streak"
          value={count.format(account.streak)}
          definition="Consecutive days painted, up to their most recent day."
        />
        <Stat
          label="Longest streak"
          value={count.format(account.longestStreak)}
          definition="The longest run of consecutive days this address has ever painted."
        />
      </dl>
      {account.lastPaintedDay !== null && (
        <p className="indexer-last">
          Last painted on <Link to={`/day/${account.lastPaintedDay}`}>day {account.lastPaintedDay}</Link>.
        </p>
      )}
    </section>
  );
}
