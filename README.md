# Strata

Every BasePaint canvas is a stack of paintings, and only the top one has ever been visible. Strata digs out the rest.

A BasePaint canvas is painted by hundreds of people over 24 hours, and pixels get painted over — often many times. The published PNG is the top layer only. Every stroke that ever landed is on chain, and Strata replays all of them: what the canvas looked like at any moment, what is buried under the final image, who painted each pixel, and how much of an artist's work survived the day.

![The ghost layer of day 500 — only the pixels that were painted and later covered, in the colour that was lost — with the core sample open on the day's most contested cell](docs/media/strata-day-500-ghost.png)

*`/day/500?mode=ghost&px=236,56`. On the left, the ghost layer: everything that survived has been dropped out, so what is left is only paint that somebody else covered over. On the right, the core sample of cell (236,56) — the deepest on the canvas, nineteen layers by four painters, read downward from the colour on the surface.*

## What it does

**Four views of the same day**, switchable without refetching anything.

- **Final** — the canvas as it ended, rebuilt stroke by stroke. It matches the official render exactly; see the table below.
- **Underpainting** — the first colour ever laid on each cell. The day as it was sketched.
- **Depth** — how many times each cell was painted, normalised to that day's deepest. A map of where the day was contested.
- **Ghost** — only the placements that were later covered, in the colour that was lost. Nobody has seen this image of a BasePaint day before.

**The core sample.** Hover, tap, or arrow-key to any cell and Strata drills it: every colour that cell has ever been, oldest at the bottom, one band per placement, with the painter's address (ENS when it resolves) and the time on each band. A 256×256 canvas has 65,536 of these.

**Artist survival.** For one address: pixels placed, cells touched, cells still holding their colour, and the survival rate between them — plus who covered them most and who they covered most. The lifetime figure states in words which days it covers, because a number with an honest scope beats one that quietly lies.

**Time.** Under every canvas is a band of the day itself, one bar per fifteen minutes, tall where the day was busy. Drag it and the canvas rebuilds to that moment — and so does the core sample, which drops the bands that had not been laid yet. Today's canvas scrubs across however much of the day has happened.

**Everything is in the URL.** Day, view mode, scrub position and selected pixel: `/day/500?mode=ghost&px=236,56&t=18400` reloads to exactly what you were looking at. Links unfurl with a card drawn from the same replay the page runs, so the picture in the preview is never one the app disagrees with.

**Minting, where it belongs.** A canvas is on sale for one day after it closes, and the person reading its provenance is the person most likely to want it. While that window is open — read from the contract, not from the clock — the day page offers the mint, through `BasePaintRewards` so the referral share is paid on chain.

## Correctness

The one hard claim Strata makes is that its replay *is* the canvas. `npm run verify` replays a day from the on-chain strokes in Node, decodes the official render from `basepaint.net`, and diffs them cell by cell. Anything other than zero is a bug in Strata and blocks release.

Ten days, spanning both canvas sizes and the whole history, verified 2026-08-08:

| day | theme | size | placements | artists | painted cells | mismatched |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | On chain summer | 144×144 | 27,498 | 101 | 17,266 | **0** |
| 100 | Nouns #915 | 144×144 | 108,114 | 596 | 20,703 | **0** |
| 250 | Cheese Factory | 144×144 | 108,647 | 496 | 20,629 | **0** |
| 365 | BasePaint Birthday Cake | 144×144 | 99,411 | 336 | 20,620 | **0** |
| 366 | On chain summer 2 | 256×256 | 113,982 | 335 | 59,730 | **0** |
| 500 | BasePaint Office Party | 256×256 | 131,958 | 175 | 61,059 | **0** |
| 750 | Ethereum in Buenos Aires | 256×256 | 152,886 | 122 | 63,925 | **0** |
| 900 | (900) Days of Onchain Summer | 256×256 | 135,013 | 75 | 63,495 | **0** |
| 1000 | BasePaint Hall of Fame | 256×256 | 146,866 | 94 | 62,477 | **0** |
| 1094 | Construction site | 256×256 | 128,610 | 69 | 63,249 | **0** |

Reproduce it with `npm run verify -- 1 100 250 365 366 500 750 900 1000 1094`. Days 365 and 366 sit either side of the canvas-size change, which is read from the theme API and never hardcoded.

What the table does not show is that reaching zero means handling the strokes that are themselves malformed, and `npm run verify` prints those separately for every day. Some pixels address coordinates off the edge of the canvas — 97 of them on day 1, 600 on day 100 — and some name a palette slot the day does not have, like the 52 on day 500. BasePaint's own renderer ignores both kinds, so Strata ignores both and counts them out loud rather than quietly dropping them.

### What runs without a network

Both checks above need two third-party services to be up, which is why neither
runs on a pull request. What does is a differential fuzz: forty seeded random
days, replayed twice — once by `src/core` and once by a second, deliberately
slow implementation written from the definitions rather than from the code — and
the two are made to agree. It covers the scrub keyframes, the core sample, the
survival counts, the binary search over timestamps, and the join that resumes
today's canvas from the last stroke already held.

The days are hostile in the ways real ones are not: canvases one and two cells
across, palettes of a single colour, pixels addressed off the edge, colours the
day does not have, and a scrub order that jumps backwards and lands on the same
frame twice. Its worth was measured rather than assumed — fourteen deliberate
bugs were introduced into `src/core` one at a time, and the suite caught all
fourteen.

### The day that has no answer to diff against

`basepaint.net` publishes a render only once a day has closed, so today's canvas cannot be diffed at all. `npm run live` drives it end to end instead — fetch, decode, replay, build the scrub keyframes, scrub across the elapsed window and back, drill the deepest cell, compute the leading artist's record — and checks the invariants that survive without a reference image: paint only accumulates going forward, the moment before the first stroke is blank, scrubbing to the day's end lands on the canvas the last stroke left, and a rewind followed by a second pass rebuilds it exactly.

Run on day 1095 mid-afternoon (61,663 placements, 809 of 1,440 minutes elapsed) and, as controls, on day 750 (152,886 placements) and day 1: every check passed. The worst single scrub frame across the three was 0.07 ms against a 16 ms budget, and the deepest core sample resolved in 1.09 ms.

## Running it

```bash
npm install
npm run dev            # http://localhost:5173
```

Node 22 or newer. CI builds on 22 and 24; the Vercel functions run on 22.

`src/data/schema.json` is committed, so a clean checkout builds and runs without touching the network. It is the record of what the indexer's schema actually says, and every GraphQL field name in `src/data/queries.ts` was read out of it rather than guessed. Re-run `npm run introspect` — a real network call — before changing a query, and commit what it writes.

That is checked rather than trusted: `npm test` parses every query in `queries.ts` and walks it against the committed schema — root fields, their arguments, the columns a `where` clause filters on, and the type each selection descends into. A misspelled field is caught there instead of at runtime in somebody's browser, which is the only other place it would ever show. A query that reaches into a type the schema does not carry fails the test rather than skipping it; add the type to the list in `scripts/introspect.mjs` and re-run.

There is no backend and no database. Every number on screen is derived at runtime from the BasePaint indexer and the BasePaint theme API; decoded days are cached in the browser's IndexedDB so a second visit is instant.

A render that throws does not blank the page. Every page sits inside an error boundary that keeps the header and the day navigation alive, says what broke in words, and shows the underlying error rather than swallowing it — and clears itself when you navigate, so one bad page does not follow you around the site.

Nor does a request that never answers. `fetch` has no timeout of its own, so every one Strata makes is given fifteen seconds — covering the body as well as the headers, because an indexer that sends a 200 and then stops mid-JSON stalls exactly as hard as one that never replies. Running out of time is treated as a blip worth retrying, and when the retries are spent it fails with a sentence like any other failure. The alternative is the one loading state this project could not otherwise reach: a stroke counter sitting at zero until somebody reloads the tab, which is the spinner-that-says-nothing that everything else here exists to avoid. The serverless functions declare `maxDuration` to match that budget, so a stalling upstream ends in Strata's own words rather than the platform's error page.

| command | what it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | typecheck, then build to `dist/` |
| `npm run test` | decoder, replay, keyframe, survival, render, page-meta, card, header, contrast, accessibility and bundle tests, plus a differential fuzz over `src/core` and the built shell read against its own CSP |
| `npm run typecheck` | `tsc -b` |
| `npm run lint` | oxlint |
| `npm run verify -- 500` | replay day 500 and diff it against the official PNG |
| `npm run live` | drive today's unfinished canvas end to end |
| `npm run introspect` | regenerate `src/data/schema.json` |

### Configuration

Every variable is optional; copy `.env.example` to `.env.local` to set any of them.

- `VITE_REFERRER_ADDRESS` — every BasePaint link Strata emits carries this as `?referrer=`, which earns half the protocol fee on mints it refers. Unset, the links still work, just unattributed.
- `VITE_REPO_URL` — the footer links to the source when this is set, and says nothing when it is not.
- `VITE_MAINNET_RPC` — used only to turn addresses into ENS names. Unset, Strata falls back to public endpoints; an address that will not resolve simply stays an address.
- `VITE_BASE_RPC` — reads the open-edition price and which canvas is on sale, and sends the mint. Unset, viem's default Base endpoint is used, which is rate limited but works.

### Deploying

`vercel.json` carries the build settings and the routing. Set `VITE_REFERRER_ADDRESS` in the Vercel project settings if you want mints attributed.

Every path that is not a static file is served by `api/html.ts`, the homepage included — a crawler does not run the router, so the title, description and card have to be on the HTML it is handed. That function is also what makes a wrong URL answer `404` rather than `200`: the app is one document for every route, and without it `/day/99999` would invite indexing. Two things it will not take from the request are the host it fetches its own shell from and the domain it writes into canonical links, both of which come from the deployment's own environment; `Host: evil.example` puts that string nowhere in the response, and there is a test that says so.

`/robots.txt` and `/sitemap.xml` are functions rather than files in `public/`, because both need to name the production domain and a static file cannot know it. The sitemap lists every day that has closed, with the date it closed.

`/api/og` is the most expensive thing here — a cold request replays a whole day to draw the card, which is the point, because a card built any other way could disagree with the page it advertises. So how long the CDN keeps one is decided by what the card is a *function of*, not by how it was requested. A card pinned to a day that has closed is settled history and is kept for a month; today's is kept for five minutes; and a card that had to work out *which* day — `?address=` with no `?day=` — is kept for an hour, because it answers "their most recent closed canvas" and that becomes a different canvas every night. Every card URL the site emits carries `v=`, from `api/_lib/cardVersion.ts`: it is the only way a redesign can reach a cache that has been told to hold the picture for a month. The function ignores it, which is what makes it safe to bump.

The security headers — the content security policy above all — are in `api/_lib/security.ts`. The policy is repeated once in `vercel.json`, for the built `index.html` that Vercel serves off disk, and a test fails if the two ever disagree. `script-src 'self'` holds only because the built shell has no inline script; anything that adds one breaks the app loudly rather than weakening the policy quietly.

### What runs on its own

| workflow | when | what it does |
| --- | --- | --- |
| `.github/workflows/ci.yml` | every push and pull request | typecheck, lint, test and build, on Node 22 and 24 |
| `.github/workflows/verify.yml` | daily, and on demand | replays the ten days in the table above and diffs each against the official render, then drives today's canvas end to end |

The split is deliberate. CI reaches no network at all, so a pull request can never fail because an indexer was busy. `verify` is the one that talks to the chain and to `basepaint.net`, and it is the one that would catch the replay ever ceasing to be the canvas.

### Weight

The canvas is the product, so it does not wait on anything optional. viem is 87 kB gzipped — more than all of Strata's own code — and it exists here for two things a visitor may never do: turning an address into an ENS name, and minting. Both are loaded on demand, which leaves 99 kB gzipped of initial JavaScript instead of 139 kB. A day page for a canvas that left its sale window years ago, which is nearly every day page, loads none of it: the arithmetic that rules the mint button out lives in `src/data/mintTerms.ts` and touches no chain. `tests/bundle.test.ts` fails if a static import ever quietly undoes this.

## Licence and credit

The code is MIT — see [`LICENSE`](LICENSE).

**The artwork is not ours.** Every canvas Strata renders was painted by the people whose addresses it shows. All BasePaint artwork is CC0, so rendering, remixing and redistributing it is allowed without attribution — Strata credits every artist by address anyway, on every layer, because crediting them is the entire point of the tool.

Built on [BasePaint](https://basepaint.xyz/), which put the whole stroke history on chain and made this possible. Strata does not let you paint; go paint there.
