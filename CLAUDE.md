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

**Private league records** live in the commissioner's Google Drive, reachable through the claude.ai Google Drive connector (search by title): `FFL Prize Pool Tracker & Distributions` (the workbook `ARCHIVE_LINKS.prizeSheet` publishes), `FFL History & Records` (source of `LEAGUE_HISTORY` 2006–2023, from its "FFL Champions" section; its "FFL Stats & Records" section holds all-time bests and worsts that no page renders yet, split across three scoring eras of 2006–2011, 2012–2019, and 2020–2024 PPR, whose numbers are not comparable), `FFL Official Rules 2025`, `FFL Commish Notes, Duties & Forum Posts`. Read-only by default: **confirm before editing any of them.**

## Tech Stack
- TypeScript 7 (`^7.0.2`) / Node.js 24 LTS (ES modules). `package.json` declares `"engines": { "node": ">=24" }`; `@types/node` is held at `^24` to match the runtime, so ignore `npm outdated` nagging about 25/26 until Node 26 reaches LTS (Oct 2026).
  - **TS 7 does not auto-discover `@types/node`.** `tsconfig.json` must keep `"types": ["node"]`, or every `node:` import and `process` reference fails with `TS2591`.
- `tsconfig`: `module`/`moduleResolution` `nodenext`, `target` `ES2024`
- Native `fetch` (no HTTP library). **Zero npm runtime dependencies** — hold this line.
- Tailwind CSS v4 and Schibsted Grotesk both load from CDNs at page view; pages are not self-contained. **v4 has no JS config** — theme lives in the `@theme` block (`THEME` in `html.ts`), never `tailwind.config = {...}`. Requires Safari 16.4+ / Chrome 111+ / Firefox 128+. Rationale, palette token names, and the declined self-hosting proposals: `docs/site-design.md`.
- All styling: Tailwind utilities + the `@theme` palette + two small page-scoped `<style>` blocks, both passed through `htmlHead({ extraStyles })`: `ROSTER_STYLES` (roster table colors) and `HISTORY_STYLES` (the League History edge fade and frozen-column seam). `extraStyles` is the only escape hatch from utilities — reach for it when a rule can't be one (layered backgrounds, `background-attachment`, a shadow that has to redraw a border).
- Three brand marks in `assets/` plus six photo cuts in `assets/photos/`, mirrored into `output/assets/` by `syncStaticAssets()` on every run. **Native formats only — PNG for the marks, JPEG for the photos**; there is no WebP or AVIF here and adding one needs an argument, since ten people view this site occasionally and the bytes were never the constraint. Referenced by a page today: `ffl-avatar-128.png` (every page's header mark) and both photo subjects at two sizes each (`GALLERY` in `league-info.ts` — `file` is the 900px cut the home page column renders, `full` is the large cut its lightbox opens). The larger avatar, the banner cut, and the two 650px thumbs are staged for slots not yet built. **Match the cut to its slot**: serving a 2000px file into a 618px box makes the browser do the downscale and it reads harsh, which is what the 900px pair fixed. Ladder, photo ledger, and rationale: `docs/photos.md`.

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
- All commands rewrite all three root pages: `output/index.html`, `output/history.html`, `output/prizes.html`. History and Prizes read no snapshot data, so they are written even when nothing has been captured.

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

Abbreviating is fine where a full slate of names would not fit and the reader already has the context. The League History table and the Prize Tracker both do it **at render**, so the data keeps the full names every join key uses. History abbreviates via `shortenForHistory()` in `html.ts`, so `LEAGUE_HISTORY` still stores full names: a tie drops both teams to city words via `TEAM_CITIES`, and "South Town Freedom Fighters" renders "South Town FF" there and only there. Full names are the default everywhere a team is identified on its own — roster column headers, the draft order card, honor cards, traded-pick owners.

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
- `src/html.ts` — HTML generation from the grid, plus the index and League History pages. `THEME` holds the palette. Shared constants: `CELL`, `TH`, `TABLE_WRAP`, `PILL_LINK`, `PILL_ACTIVE`, `PILL_EXPORT`, `LABEL_TYPE`, `SECTION_H2`, `ROW_LABEL`, `CARD_BASE`, `CARD`, `HERO_CARD`, `PLANNED`, `LINK`, `TP_TH`, `TP_TD_BOX`, `TP_TD`, `TP_TD_MUTED`, `LAST_ROW_FLUSH`, plus `HONOR_ICONS` / `HONOR_TONES` for the honor cards. Helpers: `htmlHead()`, `siteHeader()`, `navBar()`, `renderGridRows()`, `tableNotes()`, `tradedPicksTable()`, `honorsSection()`, `honorsHtml()`, `heroHtml()`, `draftOrderHtml()`, `galleryHtml()`, `siteLinksHtml()`, `historyNavHtml()`, `leagueHistoryTableHtml()`, `backToTopHtml()`, `esc()`. Prize Tracker: `money()`, `winningsFor()`, `prizeState()`, `prizeBandHtml()`, `winningsHtml()`, `prizeTableHtml()`, `prizeSeasonHtml()`, `allTimeWinningsHtml()`, `prizesNavHtml()`, `prizeArchiveHtml()`, plus `prizePointerHtml()` shared with the honor cards and the `PRZ_*` / `LEADING_TAG` constants. Page generators: `generateHtml()`, `generateIndexHtml()`, `generateHistoryHtml()`, `generatePrizesHtml()`
- `src/league-info.ts` — hand-maintained league facts no Sleeper endpoint carries: `SITE` (wordmark, tagline), `SITE_NAV`, `DRAFT_DATES`, `SEASON_HONORS`, `SURVIVOR`, `LEAGUE_HISTORY` (+ `LEAGUE_FIRST_SEASON`), `PRIZE_SEASONS` (+ `prizeSeasons()`), `PRIZE_WINNERS`, `GALLERY`, `ARCHIVE_LINKS`. Same role `tiers.ts` plays for tier boundaries. Keyed by season so old years stay put. **`PRIZE_SEASONS` is the shape to extend for a new season**; `PRIZE_WINNERS` is the superseded 2025-only blob, still unrendered and kept only as a second copy of a hand-settled record. Nothing imports it, so it and its `Prize` interface can go in one edit
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
- `output/history.html` — League History page, served at `/history`. Rewritten by every run. Sub-nav tab bar (`HISTORY_SECTIONS` in `html.ts`, one tab per section of the page) → newest season's honor cards → the all-time table → earlier seasons → Past Leagues → "Back to top". Anchors within the one page, not a file per season
- `output/prizes.html` — Prize Tracker page, served at `/prizes`. Rewritten by every run. **2026 and beyond only**: 2023–2025 ran the structure 2026 replaced and stay in the league's own workbook (`ARCHIVE_LINKS.prizeSheet`), linked at the bottom of the page. Per season: status band → winnings tiles → grouped prize ledger. Then the all-time table, then earlier seasons
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

**One layout at every width.** When something doesn't fit a phone, shrink what's in it (type, padding, name length); don't render a second structure. The League History table's stacked-block phone variant was built and reverted for exactly this reason.

- **Sticky header depends on `TABLE_WRAP`'s height cap.** `TH` carries `sticky top-0 z-10`, which pins to the nearest scrolling ancestor. Drop the `max-h` and the header stops sticking with no error. The cap is `100dvh - 15rem`, where 15rem is everything above the table; changing the site header's height means changing that number. Also expect no visible effect above 1080p — the table fits inside the cap there and only scrolls on short viewports.
- **Keeper highlight must stay after the position rules.** `.keeper { background: #ffff00 }` overrides the position tint by source order, since both are single-class selectors. Moving it up kills the highlight.
- **`PILL_EXPORT` swaps `inline-block` for `inline-flex`, never adds it.** Two `display` utilities on one element resolve by stylesheet order, not attribute order, so the loser is picked silently.
- **`SECTION_H2` is the only section heading style.** Both the index sections and `tradedPicksSection()` use it. A hand-written duplicate existed once and had to be kept in sync; don't reintroduce a second one. `ROW_LABEL` (the inline label on the closing link rows) is the same typography with different spacing, so both are built from `LABEL_TYPE` rather than repeating it.
- **`CARD` is `CARD_BASE` plus a radius, and hero cards take `CARD_BASE` alone.** Two `border-radius` utilities on one element resolve by stylesheet order, not attribute order — the `PILL_EXPORT` trap again. Never write `${CARD} rounded-[14px]`.
- **Wrap floors go through `flexFloor(px)`, never a bare `min-w-[Npx]`.** It emits `min-w-[min(Npx,100%)]`. A plain `min-width` is a floor the box cannot shrink past even when it is alone on its row, so the home page's 460px gallery column would push a 430px phone into horizontal scroll. Capping at `100%` keeps the desktop wrap point and lets the column collapse.
- **The draft order card is sized to its longest team name, and the gallery absorbs the remainder.** A row is `px-5` + an 18px number + `gap-4` + the name, so the card needs `74px + text`; "South Town Freedom Fighters" measures 210px at 15px Schibsted Grotesk, hence the 320px `flexFloor` and the `flex-1` / `flex-[1.9]` split. The row has no `whitespace-nowrap`, so a longer name added to `DRAFT_ORDERS` wraps onto a second line silently. Re-check both numbers when one lands, and remember the two columns are zero-sum: narrowing the card widens the photos, which crop tighter rather than growing taller.
- **The gallery's `max-h-[860px]` is what makes its photos crop at all.** They are `object-cover` in `min-h-0` flex children, so without a cap their intrinsic heights set the column. `object-position` (`GalleryPhoto.focus`) and `GalleryPhoto.weight` also do nothing without it. The cap is set by where the photos' subjects sit, not by the draft order card (~443px) beside it: pairing with the card is what the old 620 did, and it cut the tops of heads off in both photos. Derivation: `GALLERY_MAX_H` in [html.ts](src/html.ts).
- **The gallery lightbox is an enhancement over a working link, and must stay one.** Each photo is a plain `<a>` to its own full-size file; `LIGHTBOX_SCRIPT` intercepts the click into a native `<dialog>` and returns early when `showModal` is missing, so the fallback is the anchor itself. Swapping the `href` for a `#` or a `data-` attribute silently deletes the no-JS path. The dialog markup renders only on the home page, only when `GALLERY` is non-empty, and closes on any click that isn't the image — which is the entire close behavior, including the × button.
- **One inert span sits in home page body copy**, not just the nav: "More in the Photo Gallery", using `PLANNED`, the body-copy twin of `NAV_PLANNED`. It points at a page `SITE_NAV` also lists as planned; build it and the span becomes a link in one edit. The second such span, "All 20XX prize winners", became a live link in Aug 2026.
- **The prize band never subtracts.** Entry, Pot, Awarded and Still open all render as stated figures, with Awarded and Still open both sums over the prize list. The league has paid out more than the entry fees make (2025 paid $1,680 against a $1,600 pot), so any "remaining" derived from the pot renders negative and reads as a bug in the page. A `final` season drops Still open rather than showing $0 forever.
- **`winningsFor()` counts settled lines only**, and it feeds three things: the tiles, the band's Awarded figure, and the all-time table. A leader has won nothing, so counting a lead would be wrong every time the lead changed hands. Splits divide evenly across `winners`.
- **The prize ledger's label column wraps, deliberately breaking the History table's nowrap rule.** History is six name columns where sideways scroll is the right trade; this is one prose column beside three short ones on the page most likely to be opened from a phone. Only the three short columns take `whitespace-nowrap`.
- **Two team-name treatments, one rule**: a team as a row or tile identity takes the city word (winnings tiles, all-time table), a team as a value inside a prize row goes through `shortenForHistory()`. Both are render-time; `PRIZE_SEASONS` stores full names.
- **`prizePointerHtml()` routes per season, not per page.** A season in `PRIZE_SEASONS` gets an anchor into `prizes.html`; an earlier one gets the workbook link. Hard-coding either destination sends a 2025 honor block to a page that starts at 2026. The sub-nav and the all-time table also self-hide below two seasons, so both reappear on their own when 2027 lands.
- **Every page closes on "Back to top", and nothing else on the site is sticky.** One renderer, `backToTopHtml()` in [html.ts](src/html.ts), called by all four page generators; `#top` is the document top so no page carries a matching id. A sticky site header was weighed and passed over: it costs 74px of desktop and 120–140px of a wrapped phone header on a site whose two longest pages are tables, and on a roster page it would pin a second frozen bar directly above the table's own `sticky` `TH`. Its `spacing` argument is the only knob, since the four pages close on blocks with different bottom margins (`pt-2` everywhere but a roster page, which takes `mt-8` and puts the link *above* its capture-timestamp footer). The home and Prize pages carry `pb-16` on `main` for it, which History already had. Reasoning, including the floating-button version: `docs/site-design.md`.
- **Survivor is a notice, not a nav item.** It runs in its own Sleeper league that only the mobile app renders, so there is no page to build and no URL worth linking; `survivorNoticeHtml()` in [html.ts](src/html.ts) puts it as a brass-tinted band at the foot of the home page, below the draft order and gallery row and above the closing link rows, with the copy in `SURVIVOR` in `league-info.ts`. Putting it back in `SITE_NAV` would hang a "Coming soon" span on something that already exists.
- **Planned nav items render as `span`, not a dimmed `a`.** `NavItem.href` in `league-info.ts` is the only switch. A relative `href` names a file at the **output root** — `navItemHtml()` prefixes it with `chrome.base` so one entry resolves from both the root and a season directory. Absolute hrefs (Sleeper) pass through untouched. The League History sub-nav makes the same call in its own styles: an entry in `HISTORY_SECTIONS` without an `href` renders a `TAB_PLANNED` span carrying a `TAB_SOON` tag, and adding the `href` is the only edit that turns it into a jump link. That sub-nav is an underlined tab bar, deliberately *not* the `PILL_LINK` row the Prize Tracker uses: pills would weight three items equally when two go nowhere, and would read as the roster pages' cross-page chips rather than a jump down this page. **Its rule and its `-mb-px` are a pair**: the hairline is on the `nav`, the tabs overlap it by a pixel, so removing either leaves the live tab's underline floating above the rule or doubling it.
- **The header mark's filename is a contract between two files.** `SITE_MARK` in [snapshot.ts](src/snapshot.ts) and the `<img src>` in [html.ts](src/html.ts) must name the same file in `assets/`. A mismatch does not error: `hasSiteMark()` goes false and the header degrades to wordmark-only, which is a designed state and so looks intentional. Currently `ffl-avatar-128.png`.
- **The honor cards have one renderer, `honorsSection()`, and two callers.** The home page passes the newest season plus the prize-table pointer as its `footer`; the League History page passes every season plus an `id` (which is also what brings `scroll-mt`, since a bare anchor jump lands the heading flush against the viewport top). Editing a card edits both pages. Adding a season to `SEASON_HONORS` adds a History pill, an anchor, and a card block with no other edit.
- **The League History table is styled off the home page's draft order card, not off the traded-picks tables.** Same `CARD` + `bg-shell` header strip + 15px rows on `border-t` hairlines (`HIST_TH` / `HIST_TD` in [html.ts](src/html.ts)), so the two lists read as a pair. Every cell is `whitespace-nowrap` — no row ever wraps to a second line, so a name too long for the measure makes the card scroll sideways instead. That is the budget `shortenForHistory()` protects; a longer name or a sixth column spends it. **One layout at every width** — the phone gets the same table, the same columns and the same rows, scrolled sideways inside its `overflow-x-auto` wrapper. A stacked phone variant existed briefly in Aug 2026 (`historyStackHtml()`, a `sm:hidden` / `hidden sm:block` pair) and was removed: two renderings of one list is a standing sync cost. Below `lg` the names shorten instead, so the only width that still scrolls is a phone. Six rules hold that together, and each breaks silently on its own:
  - **`w-max min-w-full` on the table, never `w-full`.** A `w-full` table squeezes its columns to the container instead of overflowing, so the browser has nothing to scroll and the bar never appears. `min-w-full` is what still fills a wide screen.
  - **`historyNameHtml()` renders every name twice**, city word and full, picked by a `lg:hidden` / `hidden lg:inline` pair, with `HIST_EDGE` tightening padding and type a step earlier at `md`. Three tiers, sized against the measure each width actually has: below `md` city words at 13px (~490px, clears a 640px viewport's 576px), `md`–`lg` city words at 15px (~597px against 704px on a 768px iPad), `lg` and up full names at 15px (~920px against 960px at 1024). **Only a phone still scrolls** — 390px leaves 350px of measure and nothing fits it. Identical strings render once, so a team missing from `TEAM_CITIES` costs nothing but reads long.
  - **1024px is the tightest width on the page**, roughly 40px of slack, and the four columns are all sized by the same 23-character string ("Dinkey Creek Dirt Clods"). A longer team name puts the scrollbar back on tablets, so re-measure when one lands rather than trusting the layout to absorb it.
  - **`border-separate border-spacing-0` on the table.** Tailwind's preflight collapses tables, and a collapsed table owns its cells' borders, so a sticky cell paints without them and the row rule breaks at the frozen column (the same trap `ROSTER_STYLES` redraws a pinned `th`'s edges for). Separated borders look identical here, since only `border-t` is ever set.
  - **The Season column is frozen** (`sticky left-0` plus its own opaque fill in `HIST_TH_SEASON` / `HIST_TD_SEASON` — a `<tr>` background does not travel with a sticky cell, so dropping the `bg-*` makes rows show through it).
  - **`HISTORY_STYLES` carries `.hist-scroll` and `.hist-freeze`**, passed to `htmlHead()` as the history page's `extraStyles` the way `ROSTER_STYLES` is for roster pages. `.hist-scroll` is the edge fade, built from `background-attachment: local, local, scroll, scroll` — the two `local` layers are white covers that travel with the table, which is what makes the fade appear only on a side with table left and vanish entirely at a width where nothing overflows. Changing those keywords turns it into a gradient permanently parked over the last column. The fade is doing the "more this way" signalling because the scrollbar itself sits under twenty rows, unreachable until you have scrolled past the whole table.
- **A champion is named twice, in `SEASON_HONORS` and in `LEAGUE_HISTORY`, and nothing reconciles them.** The table is deliberately not derived from the cards: honors are a free-form set per season, the table is a fixed five-column spine (Season, Champion, Runner-Up, Toilet Bowl, Total Points), and matching a card by its label string would break the day a label is reworded. The price is that a reworded winner has to be changed in both. **Column order is the table's own** — the three bracket finishes in finish order, then Total Points; the honor cards run Total Points third and the two are not kept in sync. Total Points names a **team only** — no point total, that stays on the honor card — and it spells the team out at full length like the bracket columns, which is what dropping the Best Record column (Aug 2026) paid for. `SeasonResult.bestRecord` is still in `league-info.ts` holding 2025's split tie, unrendered; re-adding the column is one entry in `HISTORY_COLUMNS`. `LEAGUE_HISTORY` is stored oldest-first and rendered newest-first. All 20 seasons are now filled in, 2006–2023 from the FFL Champions section of the private `FFL History & Records` Google Doc — that section records the three bracket finishes only, so every pre-2023 row leaves Total Points blank (rendered as an em dash); 2023 and 2024's Total Points come from the 2023/2024 tabs of `ARCHIVE_LINKS.prizeSheet`. Folded teams (Winnemucca, Chico, Canton, Collet, Biola) live only in those rows and join on nothing, but they do need a `TEAM_CITIES` entry: that map is what `historyNameHtml()` renders on a phone and what shortens a tie cell, so a team missing from it reads at full length in both. The "still being compiled" note under the table is derived from the oldest row, so it took itself out.
- **An MFL league id is per *season*, and a wrong one is silent.** `MFL_SEASONS` in `league-info.ts` records a league id per year because MyFantasyLeague chains nothing between seasons: 2016–2024 happen to share `30136`, every year from 2015 back is its own id, and pointing any of them at a year outside its own range serves a **stranger's league at HTTP 200**, not a 404. So every entry is verified by opening `mflHomeUrl()` and reading the `<title>`, never inferred from a neighbouring year. `curl -sL "https://www.myfantasyleague.com/<year>/home/<id>" | grep -o -i -m1 '<title>[^<]*</title>'` is the check; the MFL directory (`https://api.myfantasyleague.com/<year>/export?TYPE=leagueSearch&SEARCH=<name>&JSON=1`) finds an id only while that season's league was public. Both range labels in the Past Leagues section are **derived from the data**, so a gap shows as a shorter range instead of a heading claiming years that link nowhere. `mflHomeUrl()` builds on the bare `www` host on purpose — MFL's numbered boxes (`www42`, `www46`) move, and `www.myfantasyleague.com` redirects. Expect titles that aren't the league's own name: 2006–2014 open as the Keeper Alliance Network, the conference the league played in then. The page says nothing about that (a `formerName` field and a derived footnote were built and dropped as more than a year list is worth), so the fact lives in the `MFL_SEASONS` doc comment for whoever checks the next id.
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
- No linter or formatter is configured for `src/`; `npm run build` (tsc) is the only gate.
- **Size a layout before picking a breakpoint** — nothing here renders CSS. Import the data from `./dist/` and multiply character counts by the font metric (15px Schibsted Grotesk ~ 8px/char; 11px uppercase at `0.12em` tracking ~ 7.4px/char), then compare against viewport minus the page's `px-5` / `sm:px-8` gutters. That is how the League History table's three width tiers were set, and it ruled out shrinking type alone.
- A scratchpad `.mjs` importing from `dist/` needs a **`file:///C:/...` URL**: a relative path resolves against the script's own directory, and a bare `c:\...` path is rejected as an unsupported URL scheme. `node --input-type=module -e` has neither problem.
- **Backticks die inside an inline `python -c "..."`.** Bash command-substitutes them within double quotes, so a replacement string carrying `` `HIST_TD` ``-style markup lands with those words deleted and the script reports success. Write the script to the scratchpad behind a quoted heredoc (`<<'PYEOF'`) and run it. That is also the better tool than a `head`/`cat`/`sed` splice for multi-point edits to a file of template literals.
- **Don't heredoc TypeScript through Bash.** A `<<'EOF'` block carrying `html.ts`-style template literals dies with ``unexpected EOF while looking for matching `'` ``. For a multi-function rewrite, write the block to the scratchpad with the Write tool, then splice with `head -n N` + `cat` + `sed -n 'M,$p'` and rebuild. Single edits go through Edit. **Re-read both seams after a splice**: an off-by-one boundary leaves a stray line rather than an error, and in a `.md` file nothing will ever flag it.
- **Multi-line prose edits (`.md`, doc blocks) go through a Python heredoc**, never `sed`: `python - <<'PY'` doing `s.replace(old, new)` guarded by `assert old in s`, written back with `io.open(p, 'w', encoding='utf-8', newline='\n')`. The assert is the point: a silent no-match is what `sed` gives you for free. `newline='\n'` stops Python emitting CRLF and turning a two-line change into a whole-file diff. (`python` is 3.11, `python3` is 3.14: separate installs.)
- **Assert the match *count*, not just membership**, when a replacement targets page shell markup. The home and Prize Tracker pages open with a byte-identical `<main class="max-w-[1080px] ...">`, and several card/section wrappers repeat across generators, so `assert old in s` passes while `s.replace()` edits two pages. Use `assert s.count(old) == N`.
- **Backslash escapes are eaten on the way into a Python heredoc.** `\n` in a `python - <<'PY'` block reaches the file as a real newline despite the quoted delimiter, so replacement text carrying `.join("\n")` lands corrupted while `assert old in s` still passes — the assert guards the *old* string. Use a raw string (`r'...'`) or double every backslash. Verified: `\\n`, `chr(92)`, and `r'\n'` all write correctly. A `.ts` file surfaces this as a tsc syntax error; a `.md` file surfaces it as nothing.
- **Anchor an insertion on the doc comment, not the declaration.** Replacing `export const X` to add a const above it drops the new one *between* `X` and its JSDoc, silently reassigning the comment to the wrong symbol. Both compile; only reading the seam catches it.
- **Renaming or dropping an `html.ts` constant is a docs edit too.** This file and `docs/` name them directly (`PILL_EXPORT`, `HISTORY_SECTIONS`, `TAB_ROW`), so `grep -rn '<OLD_NAME>' src/ docs/ CLAUDE.md` before committing. A stale name reads as current and nothing will ever flag it, the same trap as a renamed output file left behind in `output/`.
- **A page-UI change is three edits and a regenerate**: the treatment in `html.ts`, its rule in the Page UI list above, its reasoning in `docs/site-design.md`, then `node dist/index.js --generate <season>` and read the `output/` diff.
- `output/` is committed, so regenerate then `git diff -- output/`: an empty diff proves no visual regression, a non-empty one shows exactly what changed. Only `--generate` is deterministic this way; anything that re-fetches rewrites `capturedAt`/`fetchedAt`, so its diff is never empty. **Read the diff, not `git status`** — the repo checks out CRLF and the generator writes LF, so every regenerated file shows as modified whether or not a byte of content changed. `core.autocrlf` is `true` against an all-LF working tree, so this is **not only an `output/` effect**: a `src/` or `.md` file can show `M` and then clear itself once git re-stats it. A session-start `git status` is not a list of anyone's actual changes.
- **To exercise a render state the committed data can't reach**, import the config object from `./dist/` and mutate it before calling the generator: `PRIZE_SEASONS["2026"] = {...}` then `generatePrizesHtml(...)`, writing the result to the scratchpad. Works for anything exported from `league-info.ts` or `tiers.ts`. This is how the prize page's live band, leading tag, split payout and all-time table were verified before shipping, since the real 2026 season has none of them yet.
- **Reading a published Google Sheet**: `pubhtml` renders its tables in JS now, so `WebFetch` and a plain `curl` both come back with only the title. Use the CSV endpoint instead: `curl -sL "<pub-base>/pub?gid=<gid>&single=true&output=csv"`. Find the gids by fetching the `pubhtml` once and grepping it for `gid=[0-9]+`; omitting `gid` gives the first tab. `ARCHIVE_LINKS.prizeSheet`'s tabs are `gid=0` (2023), `461470939` (2024), `1933704036` (2025), and it names teams by city word, so a value lifted from it has to be expanded before it lands in `league-info.ts`.
- To eyeball a generated file (page in a browser, workbook in Excel), use PowerShell `Start-Process <absolute path>`.
- `gh` is installed and authenticated: `gh run watch <id> --exit-status` follows a workflow run, `gh run view <id> --log` reads one, `gh api repos/<owner>/<repo>/releases/latest --jq .tag_name` gets an action's current major.
- No YAML parser is installed (Python has no `yaml` module either). Validate workflow edits with `npx --yes js-yaml <file>`, which leaves `package.json` untouched.
- `ffmpeg`/`ffprobe` are installed (winget `Gyan.FFmpeg`) and are the only image tooling: resize with `-vf "scale=W:H:flags=lanczos"`, encode with `-c:v mjpeg -q:v 2` (photos) or `-c:v png -compression_level 100` (marks). Read dimensions with `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0`. The Read tool renders both PNG and JPEG directly now that nothing is WebP, so a cut can be eyeballed without converting first; judge a downscale or compression artifacts by cropping a region and magnifying it with `flags=neighbor`.
- Before assuming API drift, diff live response keys against `src/types.ts` rather than trusting the docs (their `/players/nfl` size is 3x stale).
