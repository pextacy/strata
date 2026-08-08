# Strata — Phases

`PRD.md` says what to build. `PLAN.md` says when, in clock hours. This file says **in what order, with what dependencies, and what has to be true before a phase is allowed to close**. It is the file to work from when picking up the next task.

Every phase is a shippable state. If the deadline landed at the end of any phase from 2 onward, there is still something honest to submit.

---

## Overview

| # | Phase | Depends on | Closes when |
| --- | --- | --- | --- |
| 0 | Spine | — | Live day number, theme, and palette on screen |
| 1 | Decode & replay | 0 | `npm run verify -- 500` reports zero mismatched cells |
| 2 | Canvas on screen | 1 | `/day/500` renders all four modes, switching instantly |
| 3 | Time | 2 | Scrubber is smooth on a heavy day and lives in the URL |
| 4 | Core sample | 2 | A contested pixel opens a real, deep, linkable stack |
| 5 | Artist survival | 1, 4 | An address renders a survival record with no invented numbers |
| 6 | Craft | 2–5 | Brand applied, every state written, 390px usable |
| 7 | Share loop (P1) | 6 | Links unfurl with a per-route card |
| 8 | Verification & ship | 6 | Ten days verified, deployed, submitted |

Phases 3 and 4 both depend only on 2 and do not depend on each other. Phase 4 is the signature and outranks phase 3 if only one can be done well.

---

## Phase 0 — Spine

**Goal:** data arrives. No taste decisions yet.

**Build**

1. Scaffold: `npm create vite@latest strata -- --template react-ts`; add `react-router-dom`, `viem`, `idb-keyval`, `vitest`. `strict: true` in `tsconfig`.
2. `scripts/introspect.mjs` (`DOCS.md` §4.1). Run it, **read the printed root field names**, commit `src/data/schema.json`.
3. `src/core/day-math.ts` — `currentDay()`, `dayStart()`, `dayEnd()`. Unit tested against the three anchors in `DOCS.md` §2.
4. `src/data/theme.ts` — `https://basepaint.xyz/api/theme/:day` → `{ theme, proposer, size, palette }`.

**Gate**

- `npm run dev` prints today's day number, theme name, and palette length from live data.
- `src/data/schema.json` exists and was generated, not written by hand.

**Do not** write a GraphQL document before step 2 has printed its output. Guessed field names are the single most likely way to lose an hour here.

---

## Phase 1 — Decode & replay

**Goal:** the whole product. Everything after this is presentation.

**Build**

5. `src/core/decode.ts` — hex → placements (`DOCS.md` §5). Test against the worked example `0x5a2b03000105` and against a real stroke captured from the API. Out-of-range coordinates and palette indices are counted and surfaced, never silently dropped.
6. `src/data/client.ts` + `src/data/queries.ts` — paged stroke fetch, `orderBy: "id"` ascending, `limit: 1000`, page until `hasNextPage` is false, progress callback per page. `id` is a bigint string — `BigInt()`, never `Number()`.
7. `src/core/replay.ts` — placements → `{ final, first, buried, depth, lastArtist }` (`DOCS.md` §7). Pure, synchronous, unit tested. Placements are a struct of typed arrays, never objects.
8. `scripts/verify.mjs` — replay in Node, decode `https://basepaint.net/v3/0500.png` with `pngjs`, diff.

**Gate — hard stop**

- Day 500 diffs to **zero** mismatched cells.
- One day under 366 (size 144) also diffs to zero, proving the size switch.

If either fails, nothing else starts. Every feature downstream assumes the replay is exact, and a client that renders the canvas slightly wrong loses the craft argument on sight.

---

## Phase 2 — Canvas on screen

**Goal:** the four views exist and are fast.

**Build**

9. `src/workers/replay.worker.ts` — fetch, decode, and replay off the main thread; post transferable buffers back; stream progress.
10. `src/render/palette.ts` (`toRgba`, little-endian) and `src/render/layers.ts` — buffers → `ImageData` per mode: Final (`final`, skip `depth === 0`), Underpainting (`first`), Depth (`depth` on the brand ramp, normalised to that day's max), Ghost (`buried` where `depth > 1`, everything else transparent).
11. `src/routes/Day.tsx` — canvas, `image-rendering: pixelated`, **integer scale only**, mode switch in `?mode=`, loading state that shows strokes decoded rather than a spinner.
12. `src/data/day.ts` — cache decoded placements in IndexedDB as `day:{n}:v1`. Finished days only; today's canvas is refetched from the last stroke id held.

**Gate**

- `/day/500` renders Final, Underpainting, Depth, and Ghost; switching modes takes under 50 ms and refetches nothing.
- Second visit to the same day is interactive in under 300 ms.
- Reloading the URL lands on the same mode.

---

## Phase 3 — Time

**Goal:** the day moves.

**Build**

13. Scrubber bound to `?t=`. Keyframes built once after the first replay (`DOCS.md` §7.1): copy the nearest earlier keyframe, apply the placements up to the target. Never rebuild from placement zero on a scrub frame.
14. Play/pause. Autoplay is off under `prefers-reduced-motion`.

**Gate**

- Scrub frame stays under 16 ms on a heavy day.
- The URL updates while dragging and reloads to the same moment.
- An in-progress day (today) scrubs without breaking.

**Cut rule:** playback animation goes before the scrubber does. A draggable scrubber with no autoplay is a complete feature.

---

## Phase 4 — Core sample

**Goal:** the element the project is remembered by. Give it the time it needs.

**Build**

15. `src/core/coreSample.ts` — rescan the placement list for one cell, return the ordered stack of `{ color, artist, time, index }`. Computed on demand, never stored.
16. `src/ui/CoreSample.tsx` — the vertical column, oldest at the bottom, one band per placement, address (ENS when it resolves) and relative time on each band. Clicking a painter opens their artist page.
17. Pixel selection by hover, tap, **and arrow keys**, written to `?px=x,y`.

**Gate**

- A contested pixel on day 500 opens a stack several bands deep with real addresses.
- The URL reloads to the same selected pixel.
- The inspector is reachable and navigable with the keyboard alone, with visible focus.
- Sample resolves in under 10 ms.

**Never cut.** Along with the verified replay and ghost mode, this is the project.

---

## Phase 5 — Artist survival

**Goal:** the number an artist cannot get anywhere else.

**Build**

18. `src/core/survival.ts` — the definitions in `PRD.md` §5, implemented exactly: cells claimed from `lastArtist`, cells touched by the sorted-composite-key pass (`DOCS.md` §9), overpaint pairs from the same pass that builds `buried`. Unit tested.
19. `src/routes/Artist.tsx` — lifetime totals, survival rate, per-day breakdown, top overpainter and top overpainted.
20. ENS via `viem` against a public mainnet RPC. The raw address shows while it resolves and stays if resolution fails.

**Gate**

- An address pulled from day 500 renders a survival record with no fabricated values.
- Every metric carries its definition on hover.
- The lifetime number states its own scope in words — loaded days plus the artist's most recent ten. An honest scope beats a number that quietly lies.

**Cut order inside this phase:** lifetime aggregate first, then the route entirely (surface survival for the hovered pixel's painter inside the core sample instead).

---

## Phase 6 — Craft

**Goal:** it stops looking like a prototype.

**Build**

21. `src/styles/tokens.css` applied properly — `#1e2735`, `#ffffff`, `#fde047`, `#073eb1`, Roboto Mono, and the geological-section layout from `PRD.md` §6: canvas at the top, time axis as a continuous band directly beneath, core sample as a vertical column to the side.
22. Header on every page, link back to `https://basepaint.xyz/` with the referrer parameter, beacon pixel on every page.
23. `src/routes/Home.tsx` — today's canvas, live, with the same modes. Most first-time visitors land here.
24. Every loading, empty, and error state written in real words. "Nothing survived here", not "No data available". An error names what failed and what to do next.
25. Keyboard focus visible everywhere. 390px width checked on a real page, not just resized.

**Gate**

- Nothing on screen is louder than the canvas.
- No spinner without a count, no empty state without a sentence, no number without a source.

---

## Phase 7 — Share loop (P1)

**Goal:** the link does the marketing.

**Build**

26. `api/og.tsx` — share card per day and per artist: the canvas, the ghost layer beside it, one number.
27. `api/html.ts` — per-route `og:title`, `og:description`, `og:image` injected into the built shell, since crawlers do not run the router.
28. Mint button for a canvas still in its sale window, through `BasePaintRewards` with the referrer. **ABI comes from the verified contract or `basepaint-contracts`** — never hand-written.

**Cut this entire phase without hesitation** if phase 6 is not finished. Falling back to one sensible set of static meta tags is a fine outcome.

---

## Phase 8 — Verification & ship

Starts at **deadline − 90 minutes**, whatever state the code is in. An unsubmitted project scores zero.

**Build**

29. `npm run verify` across ten days spanning both canvas sizes: day 1, a day just under 366, a day just over, several mid-history, and a recent heavy one. Results go in the README.
30. Today's in-progress canvas end to end — an unfinished day must not break the scrubber.
31. Fix only what the last hour of real use surfaced. Start nothing new.
32. Deploy to Vercel with the SPA rewrite and `VITE_REFERRER_ADDRESS` set. Open the production URL on a phone, click every route.
33. README: what it is, one screenshot, how to run it, the verification table, MIT, the CC0 note, credit to BasePaint.
34. 40 seconds of screen capture: canvas fades to ghost, scrubber runs the day, core sample opens on a contested pixel, cut to an artist page. No narration.
35. Quote the kickoff post with link, repo, video. Submit the form.
36. Post the ghost layer of a well-known day and tag the artists whose work is buried in it. They have never seen that image.

---

## Dependency graph

```
0 Spine
└── 1 Decode & replay ── [GATE: verify == 0]
    ├── 2 Canvas
    │   ├── 3 Time
    │   └── 4 Core sample ──┐
    └── 5 Artist survival ◄─┘
        └── 6 Craft
            ├── 7 Share loop (P1)
            └── 8 Verification & ship
```

Phases 3 and 4 are independent of each other. Phase 5 needs the buffers from 1 and the artist-page link from 4.

---

## Closing a phase

A phase is closed when all of the following hold. Not "mostly".

1. `npm run typecheck`, `npm run lint`, and `npm run test` pass.
2. It works against the live indexer for a heavy day (500 and 1000) **and** for today's in-progress canvas.
3. Loading, empty, and error states exist and were looked at with your own eyes.
4. Every view added is linkable — reload the URL, land in the same state.
5. 390px wide is usable, not merely unbroken.
6. Committed. Every numbered step gets its own commit.

## Standing rules

- When a step runs more than 25 minutes past its slot, cut it and take the next one.
- Do not refactor mid-push. Write it down and keep going.
- Test on a heavy day. Day 1 hides every performance problem you have.
- Every number on screen has a source. If the source is "I made it up for now", delete the number.
- Never cut: the verified replay, ghost mode, the core sample.
