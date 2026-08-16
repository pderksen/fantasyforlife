# Fantasy For Life

## Project Overview
Fantasy football roster viewer for a long-running league. Pulls roster data from the Sleeper API and generates HTML tables showing all rostered players organized by owner.

**Deeper reference** (read when the "why" matters; this file carries the rules, those carry the reasoning):
- `docs/data-capture.md` — traded picks + trade log: dating algorithm, sealing, JSON shapes, what was tried and dropped
- `docs/excel-export.md` — workbook internals, sheet layout, filename reasoning, format-verification procedure
- `docs/site-design.md` — site header, index/roster page structure, head metadata, front-end stack calls
- `docs/photos.md` — photo pipeline: the gitignored inbox, target dimensions per slot, format and naming, the optimize command
- `RUNBOOK.md` — operational cadence: what to run when, verification steps, yearly calendar
- `WORKTREES.md` — parallel Claude Code sessions in git worktrees
- `docs/audit-2026-08-04.md` — **archived** improvement audit (was `RECOMMENDATIONS.md` at the repo root until 2026-08-12). Commit messages cite its item numbers ("Close #14"), so it stays reachable by name. Read it for reasoning behind decisions, especially declined ones, never as a description of current state: a closed item can be reverted afterward without the item being updated. It tracks nothing open.

## Tech Stack
- TypeScript 7 (`^7.0.2`) / Node.js 24 LTS (ES modules). `package.json` declares `"engines": { "node": ">=24" }`; `@types/node` is held at `^24` to match the runtime, so ignore `npm outdated` nagging about 25/26 until Node 26 reaches LTS (Oct 2026).
  - **TS 7 does not auto-discover `@types/node`.** `tsconfig.json` must keep `"types": ["node"]`, or every `node:` import and `process` reference fails with `TS2591`.
- `tsconfig`: `module`/`moduleResolution` `nodenext`, `target` `ES2024`
- Native `fetch` (no HTTP library). **Zero npm runtime dependencies** — hold this line.
- Tailwind CSS v4 and Schibsted Grotesk both load from CDNs at page view; pages are not self-contained. **v4 has no JS config** — theme lives in the `@theme` block (`THEME` in `html.ts`), never `tailwind.config = {...}`. Requires Safari 16.4+ / Chrome 111+ / Firefox 128+. Rationale, palette token names, and the declined self-hosting proposals: `docs/site-design.md`.
- All styling: Tailwind utilities + the `@theme` palette + ~10 lines of inline `<style>` for the roster table's own colors (position, tier, round).
- Three brand marks in `assets/` plus four photo cuts in `assets/photos/`, mirrored into `output/assets/` by `syncStaticAssets()` on every run. **Native formats only — PNG for the marks, JPEG for the photos**; there is no WebP or AVIF here and adding one needs an argument, since ten people view this site occasionally and the bytes were never the constraint. Referenced by a page today: `ffl-avatar-128.png` (every page's header mark) and the two large photo cuts (the home page gallery, via `GALLERY` in `league-info.ts`). The larger avatar, the banner cut, and the two 650px thumbs are staged for slots not yet built. Ladder, photo ledger, and rationale: `docs/photos.md`.

## Key Concepts

**Roster Snapshots**: Three point-in-time JSON captures per season in `data/<season>/`:
- `rosters-pre-draft.json` — full carryover roster with keepers flagged, captured before the draft
- `rosters-post-draft.json` — generated from draft picks (can be created retroactively)
- `rosters-end-of-season.json` — after NFL Week 18
- Each snapshot is self-contained with resolved player names, positions, NFL teams. NFL seasons span calendar years (e.g., 2025 = Sep 2025 – Feb 2026). Shape: `src/types.ts`, also reproduced in `docs/data-capture.md`.

**Pre-Draft Snapshots**: The **entire** carryover roster (`roster.players` — Sleeper holds last season's roster in the new league until the draft runs), with players listed in `roster.keepers` marked `keeper: true`. Kept players appear in *both* arrays, so `keepers` is the only thing distinguishing them; it is `null` until the owner picks, max 3 per `settings.max_keepers`. Owners choose on their own schedule, sometimes right up to draft day, so `takeSnapshot()` names the teams still missing and the command is safe to re-run — each run overwrites the capture.

**Post-Draft Snapshots**: Built from `draft-picks.json` (not live API). Rosters ordered by draft slot; players in draft pick order.

**Draft Data**: Immutable. Saved as `draft-picks.json` and `draft-traded-picks.json` — no date suffix needed. Both are written by `--snapshot-draft` on the first run that finds them missing, via `saveDraftPicks()` / `saveDraftTradedPicks()` in `snapshot.ts`, which **never overwrite an existing file** — the copy on disk is the record. `draft-traded-picks.json` is stored as the raw response text, not re-serialized JSON: Sleeper returns its `draft_id` as a bare integer past 2^53, so a parse/stringify round trip silently rounds it off.

**Player Data**: Sleeper `/players/nfl` (~15MB as of Aug 2026; their docs still say 5MB) fetched during `--snapshot` runs, used in-memory to resolve player IDs — not saved to disk. Not fetched during `--snapshot-draft` (draft picks already contain metadata).

**Traded Picks**: Fetched from `/league/{id}/traded_picks` and saved **unfiltered** (every pick, every draft season) with both resolved and raw data. Re-fetched with each snapshot command until the season seals. Pages narrow the list at render time. See Traded Picks section below.

**Trade Log**: Every completed trade in a season's league, resolved to owner and player names and dated, saved as `data/<season>/trades.json`. **Archive only, no page.** Built by sweeping `/league/{id}/transactions/{week}` for weeks 1–18 of that **one** league (not the lineage — a season's log is what happened that season). Captured by every `--snapshot` run and by `--trades`; seals like traded picks. A season with no trades gets no file. Why there's no page, why players carry no NFL team, and the JSON shape: `docs/data-capture.md`.

**HTML Output**: `output/<season>/` (one per snapshot type) + `output/index.html` home page. Roster pages include chip-style nav bar. Every roster page and the home page show a "Traded Picks" section. Table cells color-coded by position. Footer shows capture timestamp in Pacific time.

**Excel Output**: every roster page has a `rosters-<type>-<season>-ffl.xlsx` twin beside it, written by the same run through `writeRosterOutputs()` in `index.ts` — the page links its own workbook, so one is never written without the other. Two sheets: the roster grid with its formatting intact, and that page's traded picks. Nothing reads these back. See the Excel Export section.

## Sleeper API
- Docs: https://docs.sleeper.com/ — Base URL: `https://api.sleeper.app/v1` — No auth required
- Key endpoints: `/league/{id}`, `/league/{id}/rosters`, `/league/{id}/users`, `/league/{id}/drafts`, `/draft/{draft_id}/picks`, `/league/{id}/traded_picks`, `/league/{id}/transactions/{week}`, `/players/nfl`
- `/league/{id}/traded_picks`: `roster_id` = original owner, `owner_id` = current owner (both numeric despite the name). Carries **no date** — trade dates come from transactions.
- `/league/{id}/transactions/{week}`: one week per call, no all-weeks endpoint. Both callers go through `sweepTrades()`, which keeps `type: "trade"` + `status: "complete"`. `getPickTrades()` sweeps the **whole league lineage** (`getLeagueLineage()` walks `previous_league_id`) and then keeps only trades with a non-empty `draft_picks` array, because next year's picks are traded in this year's league. `getTrades()` sweeps **one league** for the trade log. `status_updated` = accepted, `created` = proposed.
- Preseason and offseason trades are filed under `leg: 1`, so the weeks 1–18 sweep does catch August activity (verified 2026-08-05 against a live pre-draft trade). `league.settings.leg` also reads `1` while status is `pre_draft`.
- A trade names what each roster *gained*: `adds` maps player_id → receiving roster, `draft_picks[].owner_id` is the receiving roster, `waiver_budget` moves FAAB. `drops` is the mirror image of `adds` and carries nothing extra.
- `users[].is_owner` is `null` for non-commissioners, not `false` (verified 2026-08-04 against the 2025 league: 9 of 10 users `null`).
- Rate limit: 1000 calls/min
- **Consumed picks persist**: a completed league still returns its own season's traded picks, so pre-draft pick state stays recoverable after the draft
- `roster_id` → `owner_id` is stable across the season rollover (verified 2025→2026), so raw pick data isn't ambiguous between leagues
- `/players/nfl?position=X` filters, but repeated `position` params are **last-wins, not OR** — multi-position needs one call per position, so the single 15MB fetch (~0.5s) is usually better

## Commands
- **npm 12 swallows the first `--`.** Every `npm run dev -- --flag` below needs a *second* one (`npm run dev -- -- --generate 2026`) or it dies with `EUNKNOWNCONFIG: Unknown cli flag`, and `npm run dev -- --help` prints npm's own help instead of the CLI's. Verified on npm 12.0.2. `node dist/index.js --generate 2026` takes flags cleanly and skips the rebuild.
- `npm run build` — compile TypeScript
- `npm start` — run `dist/index.js` without recompiling. Same `--` caveat. `.github/workflows/refresh.yml` calls `node dist/index.js` directly at every step, not npm.
- `npm run dev` — regenerate `output/index.html` and open it in the OS default browser (local preview; no server, pages load over `file://`)
- `npm run dev -- --help` — usage
- `npm run dev -- --snapshot <pre-draft|post-draft|end-of-season> [league_id] [--force]`
- `npm run dev -- --snapshot-draft <season> [league_id]` — post-draft from draft-picks.json; works retroactively
- `npm run dev -- --generate <season> [type]` — regenerate HTML (omit type for all)
- `npm run dev -- --traded-picks [league_id]` — fetch traded picks standalone
- `npm run dev -- --trades [league_id]` — fetch that league's trades to `data/<season>/trades.json`. Generates no page. Takes a **league id, not a season**: trades live in the league that recorded them, so backfilling an old year means naming that year's league.
- All commands auto-regenerate `output/index.html`

## League
Sleeper mints a **new league ID every season**; `previous_league_id` chains them backward.
`DEFAULT_LEAGUE_ID` in `src/index.ts` is per-season and must be updated each year.

| Season | League ID | Draft ID |
|--------|-----------|----------|
| 2025 | `1220634180434526208` | `1220634181302767616` |
| 2026 | `1331127568820109312` | `1331127568832667648` (Aug 29, 2026) |

- Find next season's league: `/user/{user_id}/leagues/nfl/{season}` — grab any `user_id` from the current league's `/users`
- Find drafts: `/league/{id}/drafts`
- `draft.draft_order` maps `user_id` → slot; use it to verify `DRAFT_ORDERS` in `tiers.ts`

## Team Names

**`South Town FF` is written `South Town Freedom Fighters` everywhere it fits.** Sleeper carries the abbreviation; the league's own name is the full one, so it is corrected on the way in like `ClovisJets` → `Clovis Jets`. The short form survives only as the *key* in `OWNER_NAME_OVERRIDES` — that key is Sleeper's string and must stay verbatim or the correction stops firing.

Abbreviating is fine where a full slate of names would not fit and the reader already has the context: `PRIZE_WINNERS` in `league-info.ts` is the standing example, using bare city words ("Vancouver", "Visalia", "Sanger"). Full names are the default everywhere a team is identified on its own — roster column headers, the draft order card, honor cards, traded-pick owners.

**Renaming a team is a source *and* data edit.** `applyOwnerNameOverride()` runs at capture, so the corrected string is what lands in the snapshot JSON, and every join key downstream matches on it: `DRAFT_ORDERS` in `tiers.ts`, the roster grid's column ordering, `SEASON_HONORS`. Sealed seasons never re-fetch, so nothing will ever rewrite their files for you. The full sweep:
1. `OWNER_NAME_OVERRIDES` in `snapshot.ts` (add, keeping Sleeper's string as the key)
2. `DRAFT_ORDERS` in `tiers.ts`, and any hand-written name in `league-info.ts`
3. `data/<season>/` — `rosters-*.json`, `traded-picks.json`, `trades.json`, every season
4. Regenerate: `node dist/index.js --generate <season>` per season, then check `git diff -- output/`

Miss step 3 and nothing errors: the column simply falls back to alphabetical ordering because the `DRAFT_ORDERS` entry no longer matches any owner in the snapshot.

## Season Checklist

Operational cadence, verification steps, and automation notes live in `RUNBOOK.md`.

**Draft day** (typically late August):
0. Update `DEFAULT_LEAGUE_ID` in `src/index.ts` to the new season's league (see League section)
1. Before draft: `npm run dev -- --snapshot pre-draft`
2. After draft: `npm run dev -- --snapshot-draft <season>`

**After NFL Week 18** (~early January):
3. Final rosters: `npm run dev -- --snapshot end-of-season`

All three steps auto-fetch traded picks. Post-draft snapshots can be created retroactively; pre-draft cannot — the draft consumes the keeper selections, so they must be captured while `status` is still `pre_draft`. Re-run step 1 as keepers trickle in; the last run before the draft is the one that counts.

**Pre-draft overwrite guard**: re-capturing pre-draft is the expected workflow, so plain existence never blocks a write. Two things do, both bypassable with `--force`:
- **League past `pre_draft`** (`preDraftWindowClosed()` in `snapshot.ts`, checked in `snapshotAndGenerate()` before the 15MB player fetch). Sleeper has already consumed `roster.keepers`, so the capture could only be worse than the file it replaces. This is what stops a daily keeper-watch job left running past draft day from erasing the record.
- **Fewer keepers than the saved capture** (`saveSnapshot()`). Nothing legitimately un-picks a keeper, so this is a bad read, not an update. Equal or greater counts write normally.

Both throw `SnapshotGuardError`, which `index.ts` prints without a stack trace. The catch handler sets `process.exitCode` rather than calling `process.exit()`: on Windows, exiting outright while a just-completed `fetch` is still tearing down trips a libuv assertion and returns a crash status instead of 1.

## Project Structure
- `src/types.ts` — TypeScript interfaces, `SNAPSHOT_TYPE_LABELS` map
- `src/sleeper-api.ts` — Sleeper API fetch wrappers
- `src/snapshot.ts` — Snapshot capture/save/load, path helpers, draft round lookup, traded picks resolution + display filters (`picksForDraft()`, `picksAwaitingDraft()`, `newestDataSeason()`), trade log resolution/save/load (`resolveTrades()`, `saveTrades()`, `loadTrades()` — `loadTrades()` has no caller since the page was dropped; it is the read half of the archive, not dead code to prune), page discovery + nav (`discoverPages()`, `pageFileName()`, `exportFileName()`), pre-draft overwrite guard (`preDraftWindowClosed()`, `SnapshotGuardError`). `OWNER_NAME_OVERRIDES`, see Team Names below
- `src/roster-grid.ts` — the roster table as data, one step short of markup: `buildRosterGrid()` picks the layout (sequential, tiered, post-draft-by-round), sorts the owner columns, and returns `GridRow[]` plus `columnsInDraftOrder`. Also `columnOrderNote()`, the one place the column-order footnote's wording and its per-type rule live. Both renderers build from it, so the page and its workbook cannot drift. `DraftRoundLookup` lives here
- `src/html.ts` — HTML generation from the grid, plus the index and League History pages. `THEME` holds the palette. Shared constants: `CELL`, `TH`, `TABLE_WRAP`, `PILL_LINK`, `PILL_ACTIVE`, `PILL_EXPORT`, `LABEL_TYPE`, `SECTION_H2`, `ROW_LABEL`, `CARD_BASE`, `CARD`, `HERO_CARD`, `PLANNED`, `LINK`, `TP_TH`, `TP_TD`, `LAST_ROW_FLUSH`, plus `HONOR_ICONS` / `HONOR_TONES` for the honor cards. Helpers: `htmlHead()`, `siteHeader()`, `navBar()`, `renderGridRows()`, `tableNotes()`, `tradedPicksTable()`, `honorsHtml()`, `heroHtml()`, `draftOrderHtml()`, `galleryHtml()`, `siteLinksHtml()`, `esc()`. Page generators: `generateHtml()`, `generateIndexHtml()`, `generateHistoryHtml()`
- `src/league-info.ts` — hand-maintained league facts no Sleeper endpoint carries: `SITE` (wordmark, tagline), `SITE_NAV`, `DRAFT_DATES`, `SEASON_HONORS`, `PRIZE_WINNERS`, `GALLERY`, `ARCHIVE_LINKS`. Same role `tiers.ts` plays for tier boundaries. Keyed by season so old years stay put. **`PRIZE_WINNERS` has no renderer** — the home page's prize table came out with the Aug 2026 gallery pass and the Prize Tracker page that replaces it does not exist yet. Keep it; it is settled by hand in the league chat and exists in no API
- `src/xlsx.ts` — Excel generation from the same grid (`generateWorkbook()`, `writeWorkbook()`): styles, both sheets, and the OOXML parts
- `src/zip.ts` — minimal write-only zip (`zipSync()`), the container an `.xlsx` needs. Node's `zlib` does the compressing
- `src/tiers.ts` — `TIER_CONFIGS` (season:snapshotType → tier boundaries), `DRAFT_ORDERS` (season → owner pick order)
- `src/index.ts` — CLI entry point
- `.github/workflows/refresh.yml` — scheduled Sleeper refresh (see Deployment). The August step runs
  `--snapshot pre-draft` with `continue-on-error`, then repeats `--traded-picks` / `--trades` as
  their own steps: the keeper guard throws inside `snapshotAndGenerate()` *before* those run
  ([index.ts](src/index.ts) `saveSnapshot` precedes them), so without the repeat a refused capture
  would also cost that day's trade refresh
- `docs/` — background reference, listed under Project Overview
- `data/<season>/rosters-<type>.json` — Snapshots
- `data/<season>/draft-picks.json` — Immutable draft picks
- `data/<season>/draft-traded-picks.json` — Immutable traded pick data for specific draft
- `data/<season>/traded-picks.json` — League-level traded picks, unfiltered; re-fetched per command until sealed
- `data/<season>/trades.json` — Season trade log; re-fetched per command until sealed. Archive only, nothing renders it
- `assets/` — static files served as-is, mirrored into `output/assets/` by `syncStaticAssets()` on every run. The brand marks (`ffl-avatar-128.png`, `ffl-avatar-512.png`, `ffl-logo-999.png`) and `photos/`. **Web-ready files only**: `output/` is committed, so anything here is stored twice in git forever, and the refresh workflow's `git add -A` will mirror a committed original into `output/assets/` unattended. Full-res originals stage in the gitignored `photos-inbox/` and are deleted once downscaled. Targets, the mark ladder, and the optimize commands: `docs/photos.md`. **`syncStaticAssets()` copies, never deletes** — renaming a file here leaves the old name behind in `output/assets/`, still tracked and still served, so delete the stray in the same commit (the rule the Excel section states for renamed outputs)
- `photos-inbox/` — gitignored staging for photo and artwork originals. Never commit its contents. Currently holds the two brand masters (`ffl-avatar.png` 1024², `ffl-logo.png` 2172×724) plus the two 2025 draft-day originals already cut into `assets/photos/`. Brand masters, unlike a photo original, are **not** disposable — archive them off-repo rather than deleting
- `output/index.html` — Home page
- `output/history.html` — League History page, served at `/history`. Placeholder content; rewritten by every run
- `output/assets/` — generated copy of `assets/`. Committed, since Cloudflare serves `output/` directly
- `output/<season>/rosters-<type>.html` — Roster pages
- `output/<season>/rosters-<type>-<season>-ffl.xlsx` — Excel twin of each roster page, rewritten with it
- `.gitattributes` — marks `*.xlsx` binary so no line-ending filter can corrupt a workbook

## Traded Picks

One file per season: `data/<season>/traded-picks.json`, holding **every** pick the league reports across all draft seasons. Filtering happens at render time via `picksForDraft()` / `picksAwaitingDraft()` in `snapshot.ts`.

- **The `season` field means which draft the pick belongs to, never when it was traded.** A 2026 league's list is mostly trades made during 2025.
- **Trade dates come from a lineage-wide transaction sweep**, since `/traded_picks` carries no timestamp. Query a single league alone and every date silently vanishes — a fresh league returns the picks but zero transactions. Keying, collision rules, and the causes of a missing `tradedOn`: `docs/data-capture.md`.
- **Sealing**: a season's file stops being rewritten once a newer season has a data directory (`saveTradedPicks()` returns `undefined` when it skips). Re-fetching a sealed season would re-resolve owner names against current team names and quietly rewrite history.
- **Roster pages are the only place picks render.** The home page carried its own table until the Aug 2026 gallery pass; its hero card now reads "Current Tiers & Traded Picks" and links to the newest roster page instead. That is why `regenerateIndex()` loads no pick data at all, and why nothing on the home page needs a live fetch.

**Display rules** (columns Season, Round, Original Owner, Current Owner, Traded On; heading always "Traded Picks"; "None" when empty):

| Page | Shows |
|------|-------|
| Season N pre-draft | `season === N` — only the draft about to happen |
| Season N post-draft | `season > N` |
| Season N end-of-season | `season > N` |

## Data Mutability
| Data Type | Mutable | Notes |
|-----------|---------|-------|
| Rosters | Yes | Snapshot at 3 key moments per season |
| Draft picks | No | Immutable; always available from API |
| League traded picks | Until sealed | Re-fetched per command while the season is current; frozen once a newer season has data |
| Trade log | Until sealed | Same rule as traded picks |
| Player data | N/A | Fetched in-memory only; not persisted |

## Roster & Player Ordering
- **HTML column order**: Draft slot order (post-draft round 1 pick order) via `loadDraftOrder()`. With no post-draft snapshot yet it falls back to `DRAFT_ORDERS[season]` in `tiers.ts`, which keeps a pre-draft page's columns lined up with the post-draft page that will sit beside it; alphabetical only if neither exists.
- **Post-draft tables**: "Round" column (1, 2, 3...). Multi-pick rounds: letter suffixes (4a, 4b). Empty cells for owners without a pick in that round.
- **Live snapshots**: JSON alphabetical by owner; players sorted by position (QB, RB, WR, TE, K, DEF) then alphabetically.
- **Post-draft snapshots**: JSON by draft slot; players in draft pick order with `round` number.
- **End-of-season tiered**: Players grouped by original draft round (tier follows player, not owner). Sort by draft round within tier. Undrafted go in last tier. In last tier: DEF second-to-last, K last. Round lookup via `loadDraftRoundsFor()`.
- **Pre-draft tiered**: Same tiered layout, but keepers float to the top of their own tier — keeping a player never moves them to a different tier, and several keepers in one tier just stack there in round order. Below the keepers the normal sort resumes, so DEF/K still land last in the final tier.

## League Rules

**Throwback Years**: Every 5 years (2025, 2030, 2035, ...), no players are kept from the previous season — everyone drafts fresh. This affects:
- End-of-season tier labels are descriptive (e.g., "TIER 1 — Drafted Rounds 1–5") because players represent only what was drafted that year
- Pre-draft snapshot is skipped (no keepers = no interesting pre-draft state to record); throwback seasons show no pre-draft chip on the index page
- Non-throwback years (2026, 2027, ...) have keeper rules that affect tier boundaries and labels — to be determined when those seasons arrive

**Non-throwback tier rules** (2026 and beyond): post-draft and end-of-season boundaries are still TBD — they depend on which rounds keepers count as. Add to `TIER_CONFIGS` when known. `2026:pre-draft` is already set (it tiers by the 2025 draft, so it needed no such rule).
Confirmed in the 2026 league (Aug 4, 2026): `settings.max_keepers` is `3` and `roster.keepers` is the authoritative selection (kept players also remain in the carryover `players` array, so `keepers` is the only way to tell them apart). Keeper selection was still in progress — 1 of 10 teams had picked.

## Tiers
Full-width colored separator rows dividing the table by draft value. Configured per `"season:snapshotType"` in `src/tiers.ts`.

- **Config**: `TIER_CONFIGS` map; each entry is `{ label, beforeRound }[]`
- **Colors**: T1 dark green `#1a6b2a`, T2 dark gold `#8b6914`, T3 dark red `#8b1a1a`
- **2025 boundaries** (throwback): T1 = rounds 1–5, T2 = 6–10, T3 = 11+ and undrafted. End-of-season labels are descriptive (see League Rules above).
- **2026 pre-draft**: same 1–5 / 6–10 / 11+ boundaries, but the rounds are **2025's**. `loadDraftRoundsFor()` sends pre-draft snapshots to the *previous* season's post-draft file, since nobody on a carryover roster has been drafted in the upcoming draft yet. Labels name the year ("Drafted Rounds 1–5 (2025)") so they don't read as 2026 rounds on a page headed 2026.
- **Adding a season**: Add entry to `TIER_CONFIGS`. No config = no tier rows.
- **Rendering**: Post-draft: `buildPostDraftRows()`. Pre-draft and end-of-season: `buildTieredRows()` (buckets by tier, sorts within — keepers first — max-players determines row count).
- **`beforeRound` is not one thing.** `buildPostDraftRows()` and `buildTieredRows()` read it as a **draft round**; `buildSequentialRows()` reads it as a **1-based row index**. Sequential is the fallback when a tier config exists but `draftRounds` comes back empty, so the same config puts the bars in different places depending on which path runs, silently and with no error. Spelled out in the `TIER_CONFIGS` JSDoc.

## Draft Order
Upcoming season's draft order on index page. Configured in `DRAFT_ORDERS` in `src/tiers.ts` (key: season, value: owner names in pick order). `getLatestDraftOrder()` returns most recent. Add new entry each year; previous entries can remain.

## Page UI

Structure, section order, and layout reasoning for all three page parts (site header, index page, roster page) live in `docs/site-design.md`. Exact classes live in `html.ts`. What follows is only the set of rules that break something silently if violated.

- **Sticky header depends on `TABLE_WRAP`'s height cap.** `TH` carries `sticky top-0 z-10`, which pins to the nearest scrolling ancestor. Drop the `max-h` and the header stops sticking with no error. The cap is `100dvh - 15rem`, where 15rem is everything above the table; changing the site header's height means changing that number. Also expect no visible effect above 1080p — the table fits inside the cap there and only scrolls on short viewports.
- **Keeper highlight must stay after the position rules.** `.keeper { background: #ffff00 }` overrides the position tint by source order, since both are single-class selectors. Moving it up kills the highlight.
- **`PILL_EXPORT` swaps `inline-block` for `inline-flex`, never adds it.** Two `display` utilities on one element resolve by stylesheet order, not attribute order, so the loser is picked silently.
- **`SECTION_H2` is the only section heading style.** Both the index sections and `tradedPicksSection()` use it. A hand-written duplicate existed once and had to be kept in sync; don't reintroduce a second one. `ROW_LABEL` (the inline label on the closing link rows) is the same typography with different spacing, so both are built from `LABEL_TYPE` rather than repeating it.
- **`CARD` is `CARD_BASE` plus a radius, and hero cards take `CARD_BASE` alone.** Two `border-radius` utilities on one element resolve by stylesheet order, not attribute order — the `PILL_EXPORT` trap again. Never write `${CARD} rounded-[14px]`.
- **Wrap floors go through `flexFloor(px)`, never a bare `min-w-[Npx]`.** It emits `min-w-[min(Npx,100%)]`. A plain `min-width` is a floor the box cannot shrink past even when it is alone on its row, so the home page's 460px gallery column would push a 430px phone into horizontal scroll. Capping at `100%` keeps the desktop wrap point and lets the column collapse.
- **The draft order card is sized to its longest team name, and the gallery absorbs the remainder.** A row is `px-5` + an 18px number + `gap-4` + the name, so the card needs `74px + text`; "South Town Freedom Fighters" measures 210px at 15px Schibsted Grotesk, hence the 320px `flexFloor` and the `flex-1` / `flex-[1.9]` split. The row has no `whitespace-nowrap`, so a longer name added to `DRAFT_ORDERS` wraps onto a second line silently. Re-check both numbers when one lands, and remember the two columns are zero-sum: narrowing the card widens the photos, which crop tighter rather than growing taller.
- **The gallery's `max-h-[620px]` is what makes its photos crop at all.** They are `object-cover` in `min-h-0` flex children, so without a cap their intrinsic heights set the column and it runs roughly twice the draft order card beside it. `object-position` (`GalleryPhoto.focus`) also does nothing without it. Reasoning for 620 over the card's own ~443: `galleryHtml()` in [html.ts](src/html.ts).
- **Two inert spans sit in home page body copy**, not just the nav: "All 20XX prize winners" and "More in the Photo Gallery". Both use `PLANNED`, the body-copy twin of `NAV_PLANNED`, and both point at pages `SITE_NAV` also lists as planned. Build either page and the span becomes a link in one edit.
- **Planned nav items render as `span`, not a dimmed `a`.** `NavItem.href` in `league-info.ts` is the only switch. A relative `href` names a file at the **output root** — `navItemHtml()` prefixes it with `chrome.base` so one entry resolves from both the root and a season directory. Absolute hrefs (Sleeper) pass through untouched.
- **The header mark's filename is a contract between two files.** `SITE_MARK` in [snapshot.ts](src/snapshot.ts) and the `<img src>` in [html.ts](src/html.ts) must name the same file in `assets/`. A mismatch does not error: `hasSiteMark()` goes false and the header degrades to wordmark-only, which is a designed state and so looks intentional. Currently `ffl-avatar-128.png`.
- **Root-level pages are flat files, not directories.** `output/history.html` rather than `history/index.html`: Cloudflare Pages serves it at `/history` either way, but a flat file also opens over `file://` during local preview, which is how this project is previewed. Nav links keep the `.html`.
- **`noindex` without a `robots.txt` `Disallow`.** Disallowing blocks the fetch, so the crawler never reads the `noindex`. Staying crawlable is what makes the directive work.
- **The roster table itself was left alone by the Aug 2026 redesign.** Position tints, tier bars, keeper yellow, and cell borders are duplicated into `xlsx.ts` — changing one means changing both.
- **Column-order note** comes from `columnOrderNote()` in [roster-grid.ts](src/roster-grid.ts), which both renderers call. It requires `columnsInDraftOrder` and is excluded outright on end-of-season pages; the reasoning for that exclusion is in `docs/site-design.md` and has already been argued once.

## Excel Export

`output/<season>/rosters-<type>-<season>-ffl.xlsx`, generated by `generateWorkbook()` in `src/xlsx.ts` and written by the same call that writes the page. Two sheets: the grid, and that page's traded picks. Write-only — nothing reads it back, and the page's download link is the only consumer.

Hand-rolled OOXML with no dependency: `src/zip.ts` writes the zip container, `src/xlsx.ts` writes the XML parts. Both are deliberately narrow — no reading, no zip64, no shared-string table (cells use `t="inlineStr"`).

Sheet layout, naming reasoning, and the CSV export it replaced: `docs/excel-export.md`.

**Edit traps:**
- **`STYLE` ids in `xlsx.ts` are bare indexes into the `cellXfs` list in `STYLES_XML`.** Inserting an entry mid-list silently repaints every cell after it. Edit the two together.
- **Fill 0 (`none`) and fill 1 (`gray125`) are reserved by the format.** Excel misreads the whole style table if anything else takes those slots.
- **Colors are duplicated from `ROSTER_STYLES` in `html.ts`** — position tints, keeper yellow, the three tier colors. Surviving the export is the entire point, so change both lists together.
- **Zip timestamps are fixed at 1980-01-01** (`src/zip.ts`) so regeneration over unchanged data produces identical bytes. A real clock would make every run a diff and break the `git diff -- output/` check.
- **`.gitattributes` marks `*.xlsx binary`** so no CRLF filter can ever touch a deflate stream.
- **Both renderers consume `buildRosterGrid()`.** Column order, tier placement, keeper-first sorting, and round labels are decided once. Never render a workbook straight off the JSON.
- **Renaming either output orphans the committed file under the old name** — the generator writes the new name and leaves the old beside it, still tracked and still served. `git rm` the strays in the same commit. Names come from `pageFileName()` and `exportFileName()` in `snapshot.ts`.

**Before committing a styles or sheet change, open the workbook in Excel.** Static XML checks don't prove it opens. Procedure and its traps: `docs/excel-export.md`.

## Deployment
Hosted on **Cloudflare Pages**, serving the `output/` directory directly from the `main` branch. No build step — HTML is pre-generated locally and committed.

- `output/` is **committed to the repo** (not gitignored) so Cloudflare Pages can serve it
- Cloudflare Pages config: build command = *(empty)*, output directory = `output`
- Deploy workflow: generate HTML locally → commit `output/` → push to `main` → Cloudflare auto-deploys
- **Scheduled refresh**: `.github/workflows/refresh.yml` runs the CLI on GitHub's runners
  (daily in Aug, Thursdays Sep–Jan), commits `data/` and `output/`, and pushes to `main`, which
  Cloudflare then deploys. Free (public repo) and secret-free (Sleeper needs no auth). Git stays
  the archive of record, which is why the scheduler lives at GitHub rather than on Cloudflare:
  Pages build containers are ephemeral and Workers have no filesystem, so neither can persist a
  capture. Operational detail in `RUNBOOK.md`.

## Manual Editing
Snapshot JSON files are human-readable and editable. Regenerate the pages and their workbooks after edits: `npm run dev -- --generate <season> [type]`

## Verifying Changes
- No test framework. Exercise logic with `node --input-type=module -e '...'` importing from `./dist/` after `npm run build`.
- `output/` is committed, so regenerate then `git diff -- output/`: an empty diff proves no visual regression, a non-empty one shows exactly what changed. Only `--generate` is deterministic this way; anything that re-fetches rewrites `capturedAt`/`fetchedAt`, so its diff is never empty. **Read the diff, not `git status`** — the repo checks out CRLF and the generator writes LF, so every regenerated file shows as modified whether or not a byte of content changed.
- To eyeball a generated file (page in a browser, workbook in Excel), use PowerShell `Start-Process <absolute path>`.
- `gh` is installed and authenticated: `gh run watch <id> --exit-status` follows a workflow run, `gh run view <id> --log` reads one, `gh api repos/<owner>/<repo>/releases/latest --jq .tag_name` gets an action's current major.
- No YAML parser is installed (Python has no `yaml` module either). Validate workflow edits with `npx --yes js-yaml <file>`, which leaves `package.json` untouched.
- `ffmpeg`/`ffprobe` are installed (winget `Gyan.FFmpeg`) and are the only image tooling: resize with `-vf "scale=W:H:flags=lanczos"`, encode with `-c:v mjpeg -q:v 2` (photos) or `-c:v png -compression_level 100` (marks). Read dimensions with `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0`. The Read tool renders both PNG and JPEG directly now that nothing is WebP, so a cut can be eyeballed without converting first; judge a downscale or compression artifacts by cropping a region and magnifying it with `flags=neighbor`.
- Before assuming API drift, diff live response keys against `src/types.ts` rather than trusting the docs (their `/players/nfl` size is 3x stale).
