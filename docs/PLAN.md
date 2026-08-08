# Strata — Build Plan

**Deadline:** submission closes 23:59 UTC, Aug 8 2026. Work backwards from it. The plan below is written in hours from the moment you start (H+0), sized for a twelve-hour push with a two-hour reserve. If you have less time than that, jump to *Compressed track* at the bottom.

Reserve rule: **submission work starts at deadline minus 90 minutes, whatever state the code is in.** Deploying, recording the demo, writing the README, and filling the form take longer than anyone expects, and an unsubmitted project scores zero.

---

## H+0 → H+0:45 · Spine

Nothing depends on taste yet. Just make data arrive.

1. `npm create vite@latest strata -- --template react-ts`, add `react-router-dom`, `viem`, `idb-keyval`, `vitest`. Set `strict: true`.
2. Write `scripts/introspect.mjs` and run it. Read the output. **Confirm the exact root Query field names before writing a single query.** Commit `src/data/schema.json`.
3. `src/core/day-math.ts` — `currentDay()`, `dayStart(day)`, `dayEnd(day)`. Unit test it against the two anchors in `DOCS.md`.
4. `src/data/theme.ts` — fetch `https://basepaint.xyz/api/theme/:day`, return `{ theme, proposer, size, palette }`.

**Done when:** `npm run dev` prints today's day number, theme name, and palette length to the console from live data.

## H+0:45 → H+2:15 · Decode and replay

This is the whole product. Everything after it is presentation.

5. `src/core/decode.ts` — hex string to placements. Test against the fixture in `DOCS.md` and against a real stroke captured from the API.
6. `src/data/client.ts` + `queries.ts` — paged stroke fetch ordered by `id`, with a progress callback.
7. `src/core/replay.ts` — placements to layer buffers: `final`, `first`, `depth`, `lastArtist`, plus the artist index. Pure, synchronous, tested.
8. `scripts/verify.mjs` — replay a day in Node, decode the official PNG, diff. **Run it on day 500 now.**

**Gate:** day 500 diffs to zero mismatched pixels. If it does not, stop and fix it. Every later feature is built on this being true, and a project that renders a canvas slightly wrong loses the craft argument instantly.

Also verify one 144-size day (any day under 366) before moving on, so the size switch is proven.

## H+2:15 → H+4:00 · The canvas on screen

9. `src/workers/replay.worker.ts` — move fetch + decode + replay off the main thread, post transferable buffers back, stream progress.
10. `src/render/palette.ts` and `layers.ts` — buffers to `ImageData` for each of the four modes.
11. `src/routes/Day.tsx` — canvas element, `image-rendering: pixelated`, integer-scaled to fit, mode switch, real loading state showing strokes decoded.
12. `src/data/day.ts` — cache the decoded buffers in IndexedDB keyed by day, so a second visit is instant.

**Done when:** `/day/500` shows Final, Underpainting, Depth, and Ghost, and mode switching is instant.

## H+4:00 → H+5:00 · Time

13. Scrubber bound to `?t=` in the URL. Dragging replays to that timestamp.
14. Play/pause. Autoplay respects `prefers-reduced-motion`.

Implementation note: do not re-run the replay from zero on every scrub frame. Keep the placement list and step forward or rebuild from the last keyframe — see the incremental replay section in `DOCS.md`.

**Done when:** dragging the scrubber across a heavy day stays smooth and the URL updates.

## H+5:00 → H+6:30 · The core sample

The signature element. Give it the time it needs and make it beautiful.

15. `src/core/coreSample.ts` — for a given cell, rescan the placement list and return the ordered stack of `{ colorIndex, artist, timestamp, strokeId }`.
16. `src/ui/CoreSample.tsx` — the vertical column, oldest at the bottom. Address, ENS when it resolves, relative time per band.
17. Pixel selection by hover, tap, and arrow keys, written to `?px=x,y`.

**Done when:** clicking a contested pixel on day 500 shows a stack several bands deep with real addresses, and the URL reloads to the same pixel.

## H+6:30 → H+8:00 · Artist survival

18. `src/core/survival.ts` — the definitions from `PRD.md` §5, computed from the buffers. Tested.
19. `src/routes/Artist.tsx` — one address: lifetime totals, survival rate, per-day breakdown, top overpainter and top overpainted.
20. ENS resolution via `viem` against a public mainnet RPC, with the raw address shown while it resolves and kept if it fails.

Lifetime numbers need more than one day loaded. For the deadline, compute lifetime over the days the visitor has already loaded plus the artist's most recent ten days, and label exactly what the number covers. A number with an honest scope beats a number that quietly lies.

**Done when:** your own address, or any address pulled from day 500, renders a survival record with no fabricated values.

## H+8:00 → H+9:30 · Craft pass

21. Design tokens applied properly: `#1E2735`, `#ffffff`, `#fde047`, `#073eb1`, Roboto Mono, the geological-section layout from `PRD.md` §6.
22. Stable header on every page, link back to `https://basepaint.xyz/`, beacon pixel on every page.
23. Home route: today's canvas, live, with the same modes. This is what most first-time visitors land on.
24. Every loading, empty, and error state written in real words. Keyboard focus visible. 390px width checked.
25. Metric definitions on hover.

## H+9:30 → H+10:30 · Share loop (P1)

26. `api/og.tsx` — share card per day and per artist.
27. `api/html.ts` — meta tag injection per route so links unfurl.
28. Mint button on a canvas still in its sale window, routed through the referral parameter.

Cut this whole block without hesitation if H+9:30 arrives and the craft pass is not finished.

## H+10:30 → deadline−90min · Verification and hardening

29. Run `npm run verify` across ten days spanning both canvas sizes, including day 1, a day just before 366, a day just after, and a recent one. Record the results in the README.
30. Test today's in-progress canvas end to end. A day that has not finished must not break the scrubber.
31. Fix whatever the last hour of real use surfaced. Do not start anything new.

## deadline−90min → deadline · Ship

32. Deploy to Vercel. Open the production URL on a phone and click through every route.
33. README: what it is, the one screenshot that explains it, how to run it, the verification results, the MIT licence, the CC0 note on the artwork, and credit to BasePaint.
34. Record 40 seconds of screen: canvas fades to ghost layer, scrubber runs the day, core sample opens on a contested pixel showing eleven painters, cut to an artist page with a survival rate. No narration needed, the visuals carry it.
35. Quote the kickoff post with the live link, the repo, and the video. One quote post.
36. Submit the form. Then post the ghost layer of a well-known day and tag the artists whose work is buried in it — they are the people most likely to share it, and they have never seen that image before.

---

## Cut order

When time runs short, cut from the bottom up. Never reorder this list under pressure.

1. Embed route — cut first, it is P1.3 and nobody will miss it on day one.
2. Mint button.
3. Share images and meta injection.
4. Artist page lifetime aggregate (keep the per-day survival number, which is the shareable one).
5. Artist page entirely — surface survival for the hovered pixel's painter inside the core sample instead.
6. Underpainting mode.
7. Playback animation (keep the draggable scrubber).

**Never cut:** the verified replay, ghost mode, the core sample. Those three are the project. A Strata with only those three, done well, still wins its category. A Strata with six half-built features does not.

## Compressed track (six hours or less)

H+0 → H+2:15 exactly as written, including the verification gate. Then:

- Canvas with Final and Ghost only. No depth map, no underpainting.
- Core sample on click.
- Scrubber if it takes under thirty minutes, otherwise skip it — a static ghost layer is still something no one has seen.
- Design tokens, header, beacon, README, deploy, video, submit.

That is a complete, honest, original project. It is a better submission than a broader one that renders the wrong pixels.

## Standing rules for the build

- Commit after every numbered step. A working commit you can return to is worth more than an hour of debugging.
- Do not refactor during the push. Note it and move on.
- When something takes more than 25 minutes past its slot, cut it and take the next item.
- Test on a heavy day, never on day 1. Day 1 hides every performance problem you have.
- Every time you add a number to the screen, ask where it came from. If the answer is "I made it up for now", delete it.
