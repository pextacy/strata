# Strata — Product Requirements

**One line:** every BasePaint canvas is a stack of paintings, and only the top one has ever been visible. Strata digs out the rest.

**Submission:** BasePaint Hackathon, category *For collectors* (with real value for *For artists*). Judged on usefulness, craft, originality, staying power.

---

## 1. The problem

A BasePaint canvas is co-painted by hundreds of people over 24 hours. Pixels are painted over — often many times. Everything about that process is on chain in the `Stroke` firehose, and every existing client throws it away: they render the final PNG and a timelapse video.

So today:

- A collector holding a canvas cannot see who actually painted the piece they own, or which parts were fought over.
- An artist cannot see whether their work survived the day, or who painted over it.
- The single most interesting thing about a collaborative canvas — that it is a record of hundreds of decisions layered on top of each other — is invisible.

Strata makes the layers legible. It is the only BasePaint client that treats a canvas as a stratigraphy rather than an image.

## 2. Who it is for

**Collectors** who own or are considering a day and want provenance: who made this, how contested was it, what is underneath.

**Artists** who painted that day and want to know what happened to their pixels.

**Everyone else** who arrives from a shared link and stays for one minute because watching a canvas dissolve into its buried layers is a good minute.

## 3. The signature: the core sample

Hover or focus any pixel on a finished canvas. Strata drills a **core sample**: a vertical column showing every colour that pixel has been, oldest at the bottom, newest at the top, one band per stroke, with the painter's address and timestamp on each band.

A 256×256 canvas has 65,536 of these and every one is a small story. This is the element the project is remembered by, and everything else on the page stays quiet so it can be.

## 4. Scope

### P0 — the product does not exist without these

**P0.1 Excavation view — `/day/:day`**

Renders a day's canvas from the on-chain stroke history, not from the published PNG.

- Canvas rendered at device-appropriate scale, `image-rendering: pixelated`, zoom and pan.
- Four view modes, switchable without refetching:
  - **Final** — the canvas as it ended. Must match the official image exactly.
  - **Underpainting** — the first colour ever laid on each pixel. The canvas as it was first sketched.
  - **Depth** — a heatmap of how many times each pixel was painted. Reads as a map of where the day was contested.
  - **Ghost** — only the pixels that were painted and later buried, shown in the colour that was lost. Everything that survived is dropped out. This is the view nobody has seen before.
- Time scrubber across the full 24 hours. Dragging it rebuilds the canvas at that moment. Playback with a play/pause control; playback is off by default under `prefers-reduced-motion`.
- Header stats for the day, all from live data: theme name, palette, artist count, total pixels painted, overpaint ratio (painted pixels ÷ canvas cells), mint count.

**P0.2 Core sample inspector**

Hover, tap, or arrow-key to a pixel. The inspector shows: coordinates, current colour, how many times painted, and the full stack of colours with painter address (ENS when resolvable) and time for each band. Clicking a painter opens their artist page. The selected pixel is in the URL.

**P0.3 Artist survival — `/artist/:address`**

For one address: total pixels placed, distinct canvas cells claimed, and **survival rate** — the share of the cells they painted that still carry their colour in the final image, per day and lifetime. Plus the two facts artists will screenshot: who painted over them the most, and who they painted over the most.

**P0.4 Correctness you can check**

`npm run verify -- <day>` replays the day in Node and diffs the result against `https://basepaint.net/v3/XXXX.png`. Days verified this way carry a small "matches on-chain" mark in the UI. If the replay ever disagrees with the official render, that is a bug in Strata and it blocks release.

### P1 — ship if the P0 set is solid

**P1.1 Share images.** `/api/og` renders a share card per day and per artist: the canvas, the ghost layer beside it, and one number (overpaint ratio for a day, survival rate for an artist). Meta tags injected per route so links unfurl.

**P1.2 Mint the day.** On a canvas still in its sale window, a mint button that routes through `BasePaintRewards` with the referral parameter. Collectors who arrive at a provenance page are exactly the people who mint.

**P1.3 Embed.** `/embed/day/:day` — a chrome-free excavation view sized for an iframe, so a collector can drop the layers of their canvas into their own gallery page.

### P2 — after the deadline

Contested-region detection (clustering high-depth areas and naming the artists involved), day-to-day artist rivalry graph, a downloadable ghost-layer PNG per day, and a "lost canvases" gallery ranking days by how much art was buried.

### Out of scope

Strata does not let you paint. It does not host a marketplace. It does not re-implement the BasePaint gallery. Painting happens on basepaint.xyz and the header links there from every page.

## 5. Definitions

These have to be exact, because they are the numbers people will quote.

- **Cell** — one position on the canvas grid, `size × size` of them.
- **Placement** — one pixel written by one stroke. A cell can have many placements.
- **Depth(cell)** — number of placements on that cell.
- **Overpaint ratio (day)** — total placements ÷ number of cells painted at least once. 1.0 means nothing was ever painted over.
- **Buried placement** — any placement that was later covered by a different colour on the same cell.
- **Cells claimed (artist, day)** — cells whose final colour was written by that artist.
- **Cells touched (artist, day)** — distinct cells that artist placed on at any point.
- **Survival rate (artist, day)** — cells claimed ÷ cells touched. Self-overpainting does not count against you; only being covered by someone else does.
- **Lifetime survival rate** — sum of cells claimed across all days ÷ sum of cells touched across all days, not an average of daily rates.

Every one of these is shown with its definition on hover. A metric nobody can define is a metric nobody trusts.

## 6. Look and feel

Follows the BasePaint design system, because a derivative client that fights the parent brand looks like a stranger.

- Background `#1E2735`, text `#ffffff`, accent `#fde047`, headers `#073eb1`.
- Roboto Mono throughout; MEK Sans / MEK Mono for display if the licence allows, Roboto Mono otherwise.
- `image-rendering: pixelated` on every canvas and every video.
- A stable header on every page with navigation and a link back to `https://basepaint.xyz/`.

One aesthetic decision beyond the brand: the page is laid out as a geological section. The canvas sits at the top, the time axis runs beneath it as a continuous band, and the core sample opens as a vertical column to the side — the reading direction is down, into the canvas. Nothing else on the page is allowed to be loud.

Copy is plain and active. "Nothing survived here" beats "No data available".

## 7. Success criteria

**For the judges**

- *Usefulness* — a collector can answer "who painted my canvas and what is under it" in under thirty seconds, and an artist gets a number about their own work they cannot get anywhere else.
- *Craft* — the replay matches the official image byte for byte, the app is fast on a heavy day, and it follows the BasePaint design system without being asked twice.
- *Originality* — nobody has rendered the buried layers of a BasePaint canvas before. The ghost view and the core sample only exist here.
- *Staying power* — it works retroactively for every day since day 1 and automatically for every day painted from now on, with no backend to maintain and no cost that scales with traffic.

**Measurable, day one**

- Replay verified against the official PNG for at least ten days spread across the full history, including days on both canvas sizes.
- Heavy day loads to an interactive canvas in under 5 seconds on a laptop, cached instantly afterwards.
- Every view in the app is reachable by URL and unfurls with a share image.

## 8. Risks

**Stroke volume on heavy days.** Mitigation: paged fetch with progress, replay in a worker, decoded day cached in IndexedDB, per-pixel history computed on demand rather than stored.

**Root GraphQL field names are not guessable.** Mitigation: introspection is a build step, and it runs before anything else in `PLAN.md`.

**Cross-origin canvas readback for verification.** Mitigation: verification runs in Node, not in the browser. The UI shows a verification mark, it does not compute one.

**Time.** Mitigation: the cut order is written down in `PLAN.md` and it is honoured. Ghost mode is never cut — it is the reason the project is interesting.
