# Fantasy For Life

## Project Overview
Fantasy football roster viewer for a long-running league. Pulls roster data from the Sleeper API and generates HTML tables showing all rostered players organized by owner.

## Tech Stack
- TypeScript 7 (`^7.0.2`) / Node.js 24 LTS (ES modules). `package.json` declares `"engines": { "node": ">=24" }`; `@types/node` is held at `^24` to match the runtime, so ignore `npm outdated` nagging about 25/26 until Node 26 reaches LTS (Oct 2026).
  - **TS 7 does not auto-discover `@types/node`.** `tsconfig.json` must keep `"types": ["node"]`, or every `node:` import and `process` reference fails with `TS2591`.
- `tsconfig`: `module`/`moduleResolution` `nodenext`, `target` `ES2024`
- Native `fetch` (no HTTP library)
- Zero npm runtime dependencies
- Tailwind CSS v4 via browser CDN (loaded in generated HTML, not installed): `https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4`. The `@4` auto-tracks the latest 4.x, so no repo change is needed to pick up updates.
  - **v4 has no JS config.** Theme customization goes in `<style type="text/tailwindcss">` with an `@theme { --font-sans: ... }` block in `htmlHead()`. Do not reintroduce `tailwind.config = {...}`; the v4 browser build ignores it.
  - Requires Safari 16.4+ / Chrome 111+ / Firefox 128+.
- Inter font via Google Fonts CDN. Self-hosting was weighed and declined (Aug 2026): a dead font CDN falls back to system fonts with the pages still readable, so there is no durability case worth a build step. Same call as the Tailwind CSS inlining decision above.
- All styling: Tailwind utility classes + ~10 lines of inline `<style>` for custom colors (position, tier, round). Each HTML file carries all its own markup and custom CSS, but is **not** fully self-contained: Tailwind and Inter both load from CDNs at page view. Deliberate — see the two notes above.

## Key Concepts

**Roster Snapshots**: Three point-in-time JSON captures per season in `data/<season>/`:
- `rosters-pre-draft.json` — full carryover roster with keepers flagged, captured before the draft
- `rosters-post-draft.json` — generated from draft picks (can be created retroactively)
- `rosters-end-of-season.json` — after NFL Week 18
- Each snapshot is self-contained with resolved player names, positions, NFL teams. NFL seasons span calendar years (e.g., 2025 = Sep 2025 – Feb 2026).

**Pre-Draft Snapshots**: The **entire** carryover roster (`roster.players` — Sleeper holds last season's roster in the new league until the draft runs), with players listed in `roster.keepers` marked `keeper: true`. Kept players appear in *both* arrays, so `keepers` is the only thing distinguishing them; it is `null` until the owner picks, max 3 per `settings.max_keepers`. Owners choose on their own schedule, sometimes right up to draft day, so `takeSnapshot()` names the teams still missing and the command is safe to re-run — each run overwrites the capture.

**Post-Draft Snapshots**: Built from `draft-picks.json` (not live API). Rosters ordered by draft slot; players in draft pick order.

**Draft Data**: Immutable. Saved as `draft-picks.json` and `draft-traded-picks.json` — no date suffix needed. Both are written by `--snapshot-draft` on the first run that finds them missing, via `saveDraftPicks()` / `saveDraftTradedPicks()` in `snapshot.ts`, which **never overwrite an existing file** — the copy on disk is the record. `draft-traded-picks.json` is stored as the raw response text, not re-serialized JSON: Sleeper returns its `draft_id` as a bare integer past 2^53, so a parse/stringify round trip silently rounds it off.

**Player Data**: Sleeper `/players/nfl` (~15MB as of Aug 2026; their docs still say 5MB) fetched during `--snapshot` runs, used in-memory to resolve player IDs — not saved to disk. Not fetched during `--snapshot-draft` (draft picks already contain metadata).

**Traded Picks**: Fetched from `/league/{id}/traded_picks` and saved **unfiltered** (every pick, every draft season) with both resolved (human-readable) and raw API data. Each pick is dated from the trade transaction that moved it. Re-fetched with each snapshot command until the season seals. Pages narrow the list at render time.

**Trade Log**: Every completed trade in a season's league, resolved to owner and player names and dated, saved as `data/<season>/trades.json`. **Archive only, no page** — the per-season `trades.html` was built and then removed (Aug 2026); the capture stays because a season's transactions can only be read out of the live league, so the history has to be taken while it is takeable. Built by sweeping `/league/{id}/transactions/{week}` for weeks 1–18 of that **one** league (not the lineage — a season's log is what happened that season). Captured by every `--snapshot` run and by `--trades`; seals like traded picks. A season with no trades gets no file.

**HTML Output**: `output/<season>/` (one per snapshot type) + `output/index.html` home page. Roster pages include chip-style nav bar. Every roster page and the home page show a "Traded Picks" section. Table cells color-coded by position. Footer shows capture timestamp in Pacific time.

**Excel Output**: every roster page has a `<season>-rosters-<type>.xlsx` twin beside it, written by the same run through `writeRosterOutputs()` in `index.ts` — the page links its own workbook, so one is never written without the other. Two sheets: the roster grid with its formatting intact, and that page's traded picks. Nothing reads these back; they exist for download. See the Excel Export section.

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
- `npm run build` — compile TypeScript
- `npm start` — run `dist/index.js` without recompiling; takes the same flags as `npm run dev`. This is the form `.github/workflows/refresh.yml` uses.
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
- `src/snapshot.ts` — Snapshot capture/save/load, path helpers, draft round lookup, traded picks resolution + display filters (`picksForDraft()`, `picksAwaitingDraft()`, `newestDataSeason()`), trade log resolution/save/load (`resolveTrades()`, `saveTrades()`, `loadTrades()` — `loadTrades()` has no caller since the page was dropped; it is the read half of the archive), page discovery + nav (`discoverPages()`, `pageFileName()`, `exportFileName()`), pre-draft overwrite guard (`preDraftWindowClosed()`, `SnapshotGuardError`). `OWNER_NAME_OVERRIDES`: `ClovisJets` → `Clovis Jets`
- `src/roster-grid.ts` — the roster table as data, one step short of markup: `buildRosterGrid()` picks the layout (sequential, tiered, post-draft-by-round), sorts the owner columns, and returns `GridRow[]`. Both renderers build from it, so the page and its workbook cannot drift. `DraftRoundLookup` lives here
- `src/html.ts` — HTML generation from the grid, plus the index page. Shared constants: `CELL`, `TH`, `TABLE_WRAP`, `PILL_LINK`, `PILL_ACTIVE`, `PILL_EXPORT`, `SECTION_H2`, `TP_TH`, `TP_TD`. Helpers: `htmlHead()`, `navBar()`, `renderGridRows()`, `tradedPicksTable()`, `esc()`
- `src/xlsx.ts` — Excel generation from the same grid (`generateWorkbook()`, `writeWorkbook()`): styles, both sheets, and the OOXML parts
- `src/zip.ts` — minimal write-only zip (`zipSync()`), the container an `.xlsx` needs. Node's `zlib` does the compressing
- `src/tiers.ts` — `TIER_CONFIGS` (season:snapshotType → tier boundaries), `DRAFT_ORDERS` (season → owner pick order)
- `src/index.ts` — CLI entry point
- `.github/workflows/refresh.yml` — scheduled Sleeper refresh (see Deployment). The August step runs
  `--snapshot pre-draft` with `continue-on-error`, then repeats `--traded-picks` / `--trades` as
  their own steps: the keeper guard throws inside `snapshotAndGenerate()` *before* those run
  ([index.ts](src/index.ts) `saveSnapshot` precedes them), so without the repeat a refused capture
  would also cost that day's trade refresh
- `RUNBOOK.md` — operational cadence: what to run when, verification steps, gotchas, yearly calendar
- `WORKTREES.md` — running parallel Claude Code sessions in git worktrees: the three-command loop, the
  "source only, never commit `output/` on a feature branch" rule that keeps generated HTML out of merge
  conflicts, and the sibling-directory layout for side-by-side windows
- `docs/audit-2026-08-04.md` — **archived** improvement audit (was `RECOMMENDATIONS.md` at the repo root until 2026-08-12). Commit messages cite its item numbers ("Close #14"), so it stays reachable by name rather than through `git show`. Read it for the reasoning behind decisions, especially the declined ones, never as a description of current state: it is a dated audit with revision passes, and a closed item can be reverted afterward without the item being updated. #16 is the live example, still describing a per-season trade log page that was removed a day later. It tracks nothing open; its one unfinished item (`TIER_CONFIGS` entries for 2026) belongs to RUNBOOK.md.
- `data/<season>/rosters-<type>.json` — Snapshots
- `data/<season>/draft-picks.json` — Immutable draft picks
- `data/<season>/draft-traded-picks.json` — Immutable traded pick data for specific draft
- `data/<season>/traded-picks.json` — League-level traded picks, unfiltered; re-fetched per command until sealed
- `data/<season>/trades.json` — Season trade log; re-fetched per command until sealed. Archive only, nothing renders it
- `output/index.html` — Home page
- `output/<season>/rosters-<type>.html` — Roster pages
- `output/<season>/<season>-rosters-<type>.xlsx` — Excel twin of each roster page, rewritten with it
- `.gitattributes` — marks `*.xlsx` binary so no line-ending filter can corrupt a workbook

## Snapshot JSON Shape
```typescript
type SnapshotType = "pre-draft" | "post-draft" | "end-of-season";

interface Snapshot {
  leagueId: string; leagueName: string; season: string;
  snapshotType: SnapshotType; capturedAt: string; // ISO timestamp
  rosters: SnapshotRoster[];
}
interface SnapshotRoster { ownerName: string; players: SnapshotPlayer[]; }
interface SnapshotPlayer {
  name: string;      // "Last, First"
  position: string;  // "QB", "RB", etc.
  team: string;      // "KC", "SF", etc.
  round?: number;    // post-draft only
  keeper?: boolean;  // pre-draft only; held for the upcoming draft
}
```

## Traded Picks
One file per season: `data/<season>/traded-picks.json`, holding **every** pick the league reports across all draft seasons. Storage bakes in no display decision; filtering happens at render time via `picksForDraft()` / `picksAwaitingDraft()` in `snapshot.ts`.

The `season` field on a pick means **which draft the pick belongs to**, never when it was traded. Pick trades carry forward into the league they apply to, so a 2026 league's list is mostly trades made during 2025.

**Trade dates**: `/traded_picks` carries no timestamp (only `round`, `season`, `roster_id`, `owner_id`, `previous_owner_id`), so `getPickTrades()` sweeps `/league/{id}/transactions/{week}` for weeks 1–18 and `buildTradeDateMap()` keys each completed pick trade by `season|round|roster_id|owner_id`. The sweep spans the **league lineage**, not just the current league: next year's picks are traded during this year's season, so a fresh league returns the picks but zero transactions — query it alone and every date silently vanishes. Stable `roster_id`s across the rollover are what let the keys match. Keying on the **receiving** roster matters: a pick that went A → B → C must be dated when C got it, and `/traded_picks` only reports the final destination. Where a key repeats, the latest trade wins. Picks with no matching transaction get no `tradedOn` — in-draft trades (see `draft-traded-picks.json`) and anything predating the league on Sleeper have no transaction record.

**Display rules** (columns Season, Round, Original Owner, Current Owner, Traded On; heading always "Traded Picks"; "None" when empty):

| Page | Shows |
|------|-------|
| Home | `season > lastDraftedSeason` — picks whose draft hasn't happened yet |
| Season N pre-draft | `season === N` — only the draft about to happen |
| Season N post-draft | `season > N` |
| Season N end-of-season | `season > N` |

The home page derives `lastDraftedSeason` from the latest season's snapshots: it has drafted once any non-pre-draft snapshot exists, otherwise the previous season is used. Reads the latest saved capture, never a live fetch, so `--generate` stays offline and deterministic.

**Sealing**: A season's file stops being rewritten once a newer season has a data directory. Its league is complete so the picks can't change, and re-fetching would re-resolve owner names against current team names, quietly rewriting history. `saveTradedPicks()` returns `undefined` when it skips.

**JSON Shape** (`data/<season>/traded-picks.json`):
```typescript
interface TradedPicksData {
  leagueId: string; season: string; fetchedAt: string;
  picks: ResolvedTradedPick[]; // all seasons, unfiltered
  raw: LeagueTradedPick[];     // full API response
}
interface ResolvedTradedPick {
  round: number; season: string; // e.g., "2026"
  originalOwner: string; currentOwner: string;
  tradedOn?: string;             // ISO timestamp; omitted when no transaction records the trade
}
```

## Trade Log

Backward-looking history: what actually changed hands, and when. Distinct from the forward-looking Traded Picks table, which only says who owns an *upcoming* pick. Neither replaces the other.

**Captured but not published.** A per-season `output/<season>/trades.html` shipped and was pulled a day later (Aug 2026) — not wanted per season. The capture deliberately stayed: transactions are only readable out of the live league and a season seals, so an un-captured year is gone for good. Treat `trades.json` as an archive with no current reader. Reviving a page (per-season or one combined log) means writing the renderer again; `git show f4f3914` has the original.

One file per season, `data/<season>/trades.json`, holding every completed trade recorded in that season's league. Costs 18 calls (one per week) against the current 1 for traded picks. Sealed on the same rule as traded picks: once a newer season has a data directory and the file exists, it stops being rewritten.

**No NFL team on trade players, deliberately.** Player IDs resolve against the live `/players/nfl`, which describes players as they are *today*. A roster snapshot escapes that by being captured in the moment; a trade log can be written months later and is then sealed for good. Measured on the 2025 backfill: 2 of 15 drafted players had changed NFL teams, and waiver-added players were worse. Name and position are stable, so the log carries only those; `raw` keeps the player ids if anyone ever wants more.

**Only what each side received.** Sleeper records both halves of every swap, so `TradeParty` records only the gains: the mirror image adds no facts, and `drops` carries nothing `adds` doesn't.

**JSON Shape** (`data/<season>/trades.json`):
```typescript
interface TradesData {
  leagueId: string; season: string; fetchedAt: string;
  trades: ResolvedTrade[];    // newest first
  raw: LeagueTransaction[];   // the completed trade transactions, verbatim
}
interface ResolvedTrade {
  tradedOn: string;  // ISO timestamp — status_updated, i.e. when it was accepted
  week: number;      // Sleeper's `leg`
  parties: TradeParty[];
}
interface TradeParty {
  owner: string;
  players: { name: string; position: string }[];              // no team — see above
  picks: { season: string; round: number; originalOwner: string }[];
  faab?: number;     // FAAB dollars received; omitted when no budget moved
}
```

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

## Index Page UI
Generated by `generateIndexHtml` in `src/html.ts`. Light mode, Tailwind CDN + Inter font, centered narrow container. Exact classes live in `html.ts`; this section documents structure and intent, not the class strings.

**Sections**:
1. **"Tiers"** — Season rows (year left, chip links right), most-recent first. Archive link ("Tiers 2006–2024", `text-sm text-blue-600`) appears below the oldest season row, inside this section.
2. **"20XX Draft Order"** — Numbered 1–10 list; only latest season shown.
3. **Traded Picks** — Always shown; table of picks whose draft hasn't happened yet, or "None". Uses shared `tradedPicksTable()`.
4. **"Past Seasons"** — Two rows: (1) "Seasons 2025+ on Sleeper ↗" link to `https://sleeper.com/leagues`, with navigation instructions (inline cog SVG icon) on the line below it; (2) link to MyFantasyLeague for seasons 2006–2024.

**Throwback Year badge**: Seasons with snapshots but no pre-draft page show a green badge, left-aligned against the chips. Rare (once every 5–10 years).

**Season chips**: labels come from `SNAPSHOT_TYPE_LABELS` with " Rosters" stripped. Season rows wrap, so chips reflow on narrow screens instead of overflowing.

**Chip order**: Within a season, chips run most-recent-first left to right (End-of-Season, Post-Draft, Pre-Draft). Controlled by `discoverPages()` in `snapshot.ts` (ordered by `SNAPSHOT_TYPE_ORDER`), which feeds index chips and every page's nav bar. Every page is a roster snapshot, so `NavLink.page` is a plain `SnapshotType`.

**Latest chip highlight**: exactly one index chip renders dark (`PILL_LATEST`, gray-900 on white) — the newest tiers that exist, i.e. the first chip of the newest season. It follows from the chip order above, so it advances by itself: 2026 Pre-Draft today, 2026 Post-Draft the moment that page is generated. Still a link, unlike `PILL_ACTIVE` on roster-page nav bars, which marks the page you are already on and isn't clickable. Index nav links all carry `current: false`, so the two never collide.

## Roster Page UI
Generated by `generateHtml` in `src/html.ts`. Light mode, gray body, content in a padded wrapper div. Roster table wrapped in `TABLE_WRAP` (scrolls horizontally on mobile by design, and vertically inside a viewport-height cap). Nav wraps. Exact classes live in `html.ts`; the notes below cover the reasoning, which the code does not.

**Styling**:
- Class constants at top of `html.ts` keep markup DRY (`CELL`, `TH`, `TABLE_WRAP`, `PILL_LINK`, `PILL_ACTIVE`, `PILL_EXPORT`, `SECTION_H2`, `TP_TH`, `TP_TD`)
- **Excel pill**: nav's last item, pushed right with `ml-auto` — a download icon plus "Excel", linking `<season>-rosters-<type>.xlsx` as a sibling with the `download` attribute. `PILL_EXPORT` shares `PILL_BOX` and `PILL_LINK_COLORS` with the other pills but swaps `inline-block` for `inline-flex` rather than adding it: two `display` utilities on one element resolve by stylesheet order, not attribute order, so the loser would be picked silently
- **Gotcha**: `SECTION_H2` is used for index page headings; `tradedPicksSection()` on roster pages has its own inline heading style — keep both in sync when changing heading styles
- Inline `<style>` via `ROSTER_STYLES` / `ROUND_COL_STYLE`: position colors (`.pos-qb` etc.), keeper highlight (`.keeper`), sticky-header borders (`th.sticky`), tier colors (`.tier-1` etc.), round label column
- **Sticky header**: `TH` carries `sticky top-0 z-10`, which works *only* because `TABLE_WRAP` caps the wrapper's height. An overflow container is the scrollport its sticky descendants pin to, so a wrapper that never scrolls vertically means a header that never sticks — dropping the `max-h` silently kills it (that was the original bug). Separately, `border-collapse` hands cell borders to the table, so a pinned `th` loses its own borders mid-scroll; `th.sticky` redraws the right and bottom edges as a box-shadow that travels with the cell. **Expect to see no effect on a desktop monitor** — the roster table renders ~695px tall, so at 1080p and up it fits inside the cap and never scrolls. It engages on short viewports (a 1280×800 laptop gets ~165px of scroll). That is the intended range, not a bug.
- **Keeper highlight**: `.keeper { background: #ffff00 }` (fluorescent yellow) deliberately overrides the position tint — it is declared *after* the `.pos-*` rules and wins on source order, since both are single-class selectors. Keep it there. The position is still spelled out in the cell text, so nothing is lost. `ROSTER_STYLES` is shared, so this rule ships on every roster page; it is inert wherever no cell carries the class.
- **Keeper legend**: swatch + "Keeper", between the roster table and the Traded Picks heading, via `keeperLegend()`. Rendered only when a player in that snapshot actually carries `keeper: true`, not by snapshot type, so a throwback year's pages stay legend-free without a special case. `takeSnapshot()` only fills the keeper id set for pre-draft ([snapshot.ts](src/snapshot.ts) `keeperIds`), so today only pre-draft pages qualify. The swatch reuses the `.keeper` class rather than repeating the hex.

**Traded Picks**: `<h2>` heading + `overflow-x-auto` scroll wrapper on every snapshot type (contents differ per the Traded Picks display rules), or "None" when empty. Table uses `w-auto` (not full-width) so it only spans its content. The "Traded On" column renders only when at least one pick in that table has a `tradedOn`, so captures predating the field drop it instead of showing a column of placeholders; individual undated picks inside a dated table show a gray em dash. Dates use `formatPacificDate()` (date only, no time).

**Footer**: "Data retrieved" timestamp in Pacific time via `formatPacificTime()` (`America/Los_Angeles`).

## Excel Export

`output/<season>/<season>-rosters-<type>.xlsx`, generated by `generateWorkbook()` in `src/xlsx.ts` and written by the same call that writes the page. Write-only output: nothing in the codebase reads it back, and the page's own download link is the only consumer. **A CSV export shipped first and was replaced (Aug 2026)** — plain text lost the position tints, the tier bars, and the keeper highlight, which are most of what the table communicates. `git show 6187a04` has it if a text export is ever wanted back.

**Two sheets**: `<season> <Type> Rosters` (the grid) and `Traded Picks`.

**Hand-rolled OOXML, no dependency.** An `.xlsx` is a zip of XML parts, and Node ships `zlib`, so `src/zip.ts` writes the container and `src/xlsx.ts` writes the parts rather than pulling in a spreadsheet library. Both are write-only and deliberately narrow: no reading, no zip64, no shared-string table (cells use `t="inlineStr"`).

- **`STYLE` ids in `xlsx.ts` are bare indexes into the `cellXfs` list in `STYLES_XML`.** Inserting an entry mid-list silently repaints every cell after it. Edit the two together.
- **Fill 0 (`none`) and fill 1 (`gray125`) are reserved by the format.** Excel misreads the whole style table if anything else takes those slots.
- **Colors are duplicated from `ROSTER_STYLES` in `html.ts`** — position tints, keeper yellow, the three tier colors. Surviving the export is the entire point, so change both lists together.
- **Fixed 1980-01-01 zip timestamps** (`src/zip.ts`). `output/` is committed and the repo leans on an empty `git diff` to prove a change was inert; a clock in the header would make every regeneration a diff. Verified: two runs over unchanged data produce identical bytes.
- **`.gitattributes` marks `*.xlsx binary`** so no CRLF filter can ever touch a deflate stream.

**Mirrors the page, not the snapshot.** Both renderers consume `buildRosterGrid()`, so column order, tier placement, keeper-first sorting, and round labels are decided once. Rendering a workbook straight off the JSON would have let the two drift apart silently.

- **Grid shape, matching the historical Google Sheet**: owners across the header, players down, cells reading `Last, First TEAM POS`. Post-draft keeps its leading "Round" column ("4a", "4b"). Header row is frozen.
- **Tier bars are merged across the table**, the way the page draws them. Every covered column still needs a styled cell or Excel leaves the tail of the bar unpainted.
- **No keeper legend**, unlike the page: a lone yellow swatch cell reads as data in a spreadsheet, next to a grid people sort and filter. The keeper tint itself still ships. Only the "Data retrieved" footer follows the grid, after a blank row.
- **The Traded Picks sheet shows what that page shows** — pre-draft gets its own draft's picks, the others get what's still outstanding — including the rule that drops the "Traded On" column when no pick in the table has a date.
- **The page's link comes from `exportFileName()`**, the same helper `getExportOutputPath()` writes through, so the name can't drift out from under the relative link.

**The workbook name repeats the season, the page's does not.** A page is read in place, under a URL that already says which year it is; its workbook gets downloaded into a folder alongside every other year's export, where a bare `rosters-pre-draft.xlsx` identifies nothing. So the two names come from separate helpers in `snapshot.ts` — `pageFileName()` and `exportFileName()`.

**Verifying a change to the format**: `unzip -t <file>` checks the container, and PowerShell's `[xml]` cast over each entry checks the parts are well-formed. Neither proves Excel will open it — only opening it does, so do that before committing a styles or sheet change.

## Page Head Metadata

`htmlHead()` takes a `HeadOptions` object (`title`, optional `ogTitle`, `description`, `siteName`, optional `extraStyles`) and emits the same block on every page.

- **Open Graph**: `og:type`, `og:site_name`, `og:title`, `og:description`, plus `twitter:card` = `summary` (no image exists, so `summary` is correct) and a plain `<meta name="description">`. Roster pages pass `ogTitle` as just `"<season> <label>"` — the league name is already the `og:site_name`, so repeating it wastes the preview card's bold line. Per-page copy comes from `OG_DESCRIPTIONS` in `html.ts`, keyed by snapshot type.
- **No `og:url` / `og:image`**: the deployed hostname isn't recorded anywhere in the repo, and a wrong canonical URL unfurls worse than none. No artwork exists.
- **`noindex`**: `<meta name="robots" content="noindex, nofollow">`. The site is deliberately not Googleable. **Do not "reinforce" this with a `robots.txt` `Disallow`** — disallowing blocks the fetch, so the crawler never reads the `noindex` and the URL can still be listed bare from an inbound link. Staying crawlable is what makes the directive work. Unfurlers ignore robots rules, so previews are unaffected.
- **No favicon**, by choice. `/favicon.ico` 404s harmlessly.

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
- Before assuming API drift, diff live response keys against `src/types.ts` rather than trusting the docs (their `/players/nfl` size is 3x stale).
