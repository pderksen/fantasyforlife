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
- Inter font via Google Fonts CDN
- All styling: Tailwind utility classes + ~10 lines of inline `<style>` for custom colors (position, tier, round). Each HTML file is self-contained.

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

**HTML Output**: `output/<season>/` (one per snapshot type) + `output/index.html` home page. Roster pages include chip-style nav bar. Every roster page and the home page show a "Traded Picks" section. Table cells color-coded by position. Footer shows capture timestamp in Pacific time.

## Sleeper API
- Docs: https://docs.sleeper.com/ — Base URL: `https://api.sleeper.app/v1` — No auth required
- Key endpoints: `/league/{id}`, `/league/{id}/rosters`, `/league/{id}/users`, `/league/{id}/drafts`, `/draft/{draft_id}/picks`, `/league/{id}/traded_picks`, `/league/{id}/transactions/{week}`, `/players/nfl`
- `/league/{id}/traded_picks`: `roster_id` = original owner, `owner_id` = current owner (both numeric despite the name). Carries **no date** — trade dates come from transactions.
- `/league/{id}/transactions/{week}`: one week per call, no all-weeks endpoint. `getPickTrades()` sweeps weeks 1–18 across the **whole league lineage** (`getLeagueLineage()` walks `previous_league_id`) and keeps completed trades with a non-empty `draft_picks` array. `status_updated` = accepted, `created` = proposed.
- Rate limit: 1000 calls/min
- **Consumed picks persist**: a completed league still returns its own season's traded picks, so pre-draft pick state stays recoverable after the draft
- `roster_id` → `owner_id` is stable across the season rollover (verified 2025→2026), so raw pick data isn't ambiguous between leagues
- `/players/nfl?position=X` filters, but repeated `position` params are **last-wins, not OR** — multi-position needs one call per position, so the single 15MB fetch (~0.5s) is usually better

## Commands
- `npm run build` — compile TypeScript
- `npm run dev` — regenerate `output/index.html` and open it in the OS default browser (local preview; no server, pages load over `file://`)
- `npm run dev -- --help` — usage
- `npm run dev -- --snapshot <pre-draft|post-draft|end-of-season> [league_id]`
- `npm run dev -- --snapshot-draft <season> [league_id]` — post-draft from draft-picks.json; works retroactively
- `npm run dev -- --generate <season> [type]` — regenerate HTML (omit type for all)
- `npm run dev -- --traded-picks [league_id]` — fetch traded picks standalone
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

## Project Structure
- `src/types.ts` — TypeScript interfaces, `SNAPSHOT_TYPE_LABELS` map
- `src/sleeper-api.ts` — Sleeper API fetch wrappers
- `src/snapshot.ts` — Snapshot capture/save/load, path helpers, draft round lookup, traded picks resolution + display filters (`picksForDraft()`, `picksAwaitingDraft()`, `newestDataSeason()`). `OWNER_NAME_OVERRIDES`: `ClovisJets` → `Clovis Jets`
- `src/html.ts` — HTML generation (sequential, post-draft, tiered layouts), index page. Shared constants: `CELL`, `TH`, `PILL_LINK`, `PILL_ACTIVE`, `SECTION_H2`, `TP_TH`, `TP_TD`. Helpers: `htmlHead()`, `tradedPicksTable()`, `esc()`
- `src/tiers.ts` — `TIER_CONFIGS` (season:snapshotType → tier boundaries), `DRAFT_ORDERS` (season → owner pick order)
- `src/index.ts` — CLI entry point
- `data/<season>/rosters-<type>.json` — Snapshots
- `data/<season>/draft-picks.json` — Immutable draft picks
- `data/<season>/draft-traded-picks.json` — Immutable traded pick data for specific draft
- `data/<season>/traded-picks.json` — League-level traded picks, unfiltered; re-fetched per command until sealed
- `output/index.html` — Home page
- `output/<season>/rosters-<type>.html` — Roster pages

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

## Data Mutability
| Data Type | Mutable | Notes |
|-----------|---------|-------|
| Rosters | Yes | Snapshot at 3 key moments per season |
| Draft picks | No | Immutable; always available from API |
| League traded picks | Until sealed | Re-fetched per command while the season is current; frozen once a newer season has data |
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

## Draft Order
Upcoming season's draft order on index page. Configured in `DRAFT_ORDERS` in `src/tiers.ts` (key: season, value: owner names in pick order). `getLatestDraftOrder()` returns most recent. Add new entry each year; previous entries can remain.

## Index Page UI
Generated by `generateIndexHtml` in `src/html.ts`. Light mode, Tailwind CDN + Inter font, centered `max-w-2xl mx-auto px-4 sm:px-6 py-10 sm:py-20` container.

**Sections**:
1. **"Tiers"** — Season rows (year left, chip links right), most-recent first. Archive link ("Tiers 2006–2024", `text-sm text-blue-600`) appears below the oldest season row, inside this section.
2. **"20XX Draft Order"** — Numbered 1–10 list; only latest season shown.
3. **Traded Picks** — Always shown; table of picks whose draft hasn't happened yet, or "None". Uses shared `tradedPicksTable()`.
4. **"Past Seasons"** — Two rows: (1) "Seasons 2025+ on Sleeper ↗" link to `https://sleeper.com/leagues`, with navigation instructions (inline cog SVG icon) on the line below it; (2) link to MyFantasyLeague for seasons 2006–2024.

**Throwback Year badge**: Seasons with snapshots but no pre-draft page show `bg-green-800 text-white rounded px-1.5 py-0.5 text-xs font-medium` badge, positioned `mr-auto ml-3`. Rare (once every 5–10 years).

**Season chips**: `bg-gray-100 text-gray-700 rounded-lg`, hover `bg-gray-200`. Labels from `SNAPSHOT_TYPE_LABELS` with " Rosters" stripped. Season rows use `flex flex-wrap gap-y-2` so chips wrap on narrow screens.

**Chip order**: Within a season, chips run most-recent-first left to right (End-of-Season, Post-Draft, Pre-Draft). Controlled by `SNAPSHOT_TYPE_ORDER` in `snapshot.ts`, which feeds both index chips and roster page nav bars.

## Roster Page UI
Generated by `generateHtml` in `src/html.ts`. Light mode, `bg-gray-50` body. Content in `px-3 sm:px-5 pt-4 sm:pt-5 pb-10` wrapper div. Roster table wrapped in `overflow-x-auto` (scrolls horizontally on mobile by design). Nav uses `flex flex-wrap`.

**Styling**:
- Class constants at top of `html.ts` keep markup DRY (`CELL`, `TH`, `PILL_LINK`, `PILL_ACTIVE`, `SECTION_H2`, `TP_TH`, `TP_TD`)
- **Gotcha**: `SECTION_H2` is used for index page headings; `tradedPicksSection()` on roster pages has its own inline heading style — keep both in sync when changing heading styles
- Inline `<style>` via `ROSTER_STYLES` / `ROUND_COL_STYLE`: position colors (`.pos-qb` etc.), keeper highlight (`.keeper`), tier colors (`.tier-1` etc.), round label column
- **Keeper highlight**: `.keeper { background: #ffff00 }` (fluorescent yellow) deliberately overrides the position tint — it is declared *after* the `.pos-*` rules and wins on source order, since both are single-class selectors. Keep it there. The position is still spelled out in the cell text, so nothing is lost. `ROSTER_STYLES` is shared, so this rule ships on every roster page; it is inert wherever no cell carries the class.

**Traded Picks**: `<h2>` heading + `overflow-x-auto` scroll wrapper on every snapshot type (contents differ per the Traded Picks display rules), or "None" when empty. Table uses `w-auto` (not full-width) so it only spans its content. The "Traded On" column renders only when at least one pick in that table has a `tradedOn`, so captures predating the field drop it instead of showing a column of placeholders; individual undated picks inside a dated table show a gray em dash. Dates use `formatPacificDate()` (date only, no time).

**Footer**: "Data retrieved" timestamp in Pacific time via `formatPacificTime()` (`America/Los_Angeles`).

## Deployment
Hosted on **Cloudflare Pages**, serving the `output/` directory directly from the `main` branch. No build step — HTML is pre-generated locally and committed.

- `output/` is **committed to the repo** (not gitignored) so Cloudflare Pages can serve it
- Cloudflare Pages config: build command = *(empty)*, output directory = `output`
- Deploy workflow: generate HTML locally → commit `output/` → push to `main` → Cloudflare auto-deploys

## Manual Editing
Snapshot JSON files are human-readable and editable. Regenerate HTML after edits: `npm run dev -- --generate <season> [type]`

## Verifying Changes
- No test framework. Exercise logic with `node --input-type=module -e '...'` importing from `./dist/` after `npm run build`.
- `output/` is committed, so regenerate then `git diff -- output/`: an empty diff proves no visual regression, a non-empty one shows exactly what changed.
- Before assuming API drift, diff live response keys against `src/types.ts` rather than trusting the docs (their `/players/nfl` size is 3x stale).
