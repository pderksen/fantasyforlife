# Fantasy For Life

## Project Overview
Fantasy football roster viewer for a long-running league. Pulls roster data from the Sleeper API and generates HTML tables showing all rostered players organized by owner.

## Tech Stack
- TypeScript / Node.js (ES modules)
- Native `fetch` (Node 18+, no HTTP library)
- Zero npm runtime dependencies
- Tailwind CSS via CDN (loaded in generated HTML, not installed)
- Inter font via Google Fonts CDN
- All styling: Tailwind utility classes + ~10 lines of inline `<style>` for custom colors (position, tier, round). Each HTML file is self-contained.

## Key Concepts

**Roster Snapshots**: Three point-in-time JSON captures per season in `data/<season>/`:
- `rosters-pre-draft.json` — before draft (keeper/offseason state)
- `rosters-post-draft.json` — generated from draft picks (can be created retroactively)
- `rosters-end-of-season.json` — after NFL Week 18
- Each snapshot is self-contained with resolved player names, positions, NFL teams. NFL seasons span calendar years (e.g., 2025 = Sep 2025 – Feb 2026).

**Post-Draft Snapshots**: Built from `draft-picks.json` (not live API). Rosters ordered by draft slot; players in draft pick order.

**Draft Data**: Immutable. Saved as `draft-picks.json` and `draft-traded-picks.json` — no date suffix needed.

**Player Data**: Sleeper `/players/nfl` (~5MB) fetched during `--snapshot` runs, used in-memory to resolve player IDs — not saved to disk. Not fetched during `--snapshot-draft` (draft picks already contain metadata).

**Traded Picks**: Fetched from `/league/{id}/traded_picks`, filtered to future seasons only. Re-fetched with each snapshot command. Saved with both resolved (human-readable) and raw API data.

**HTML Output**: `output/<season>/` (one per snapshot type) + `output/index.html` home page. Roster pages include chip-style nav bar. End-of-season pages show a "Traded Picks" section. Table cells color-coded by position. Footer shows capture timestamp in Pacific time.

## Sleeper API
- Docs: https://docs.sleeper.com/ — Base URL: `https://api.sleeper.app/v1` — No auth required
- Key endpoints: `/league/{id}`, `/league/{id}/rosters`, `/league/{id}/users`, `/league/{id}/drafts`, `/draft/{draft_id}/picks`, `/league/{id}/traded_picks`, `/players/nfl`
- `/league/{id}/traded_picks`: `roster_id` = original owner, `owner_id` = current owner (both numeric despite the name)
- Rate limit: 1000 calls/min

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
- Primary league ID: `1220634180434526208`
- Draft ID for 2025 season: `1220634181302767616`
- Find drafts: `/league/{id}/drafts` returns array of draft objects

## Season Checklist

**Draft day** (typically late August):
1. Before draft: `npm run dev -- --snapshot pre-draft`
2. After draft: `npm run dev -- --snapshot-draft <season>`

**After NFL Week 18** (~early January):
3. Final rosters: `npm run dev -- --snapshot end-of-season`

All three steps auto-fetch traded picks. Post-draft snapshots can be created retroactively; pre-draft cannot (requires live rosters before draft starts).

## Project Structure
- `src/types.ts` — TypeScript interfaces, `SNAPSHOT_TYPE_LABELS` map
- `src/sleeper-api.ts` — Sleeper API fetch wrappers
- `src/snapshot.ts` — Snapshot capture/save/load, path helpers, draft round lookup, traded picks resolution. `OWNER_NAME_OVERRIDES`: `ClovisJets` → `Clovis Jets`
- `src/html.ts` — HTML generation (sequential, post-draft, tiered layouts), index page. Shared constants: `CELL`, `TH`, `PILL_LINK`, `PILL_ACTIVE`, `SECTION_H2`, `TP_TH`, `TP_TD`. Helpers: `htmlHead()`, `tradedPicksTable()`, `esc()`
- `src/tiers.ts` — `TIER_CONFIGS` (season:snapshotType → tier boundaries), `DRAFT_ORDERS` (season → owner pick order)
- `src/index.ts` — CLI entry point
- `data/<season>/rosters-<type>.json` — Snapshots
- `data/<season>/draft-picks.json` — Immutable draft picks
- `data/<season>/draft-traded-picks.json` — Immutable traded pick data for specific draft
- `data/<season>/traded-picks.json` — League-level traded picks (re-fetched per command)
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
}
```

## Traded Picks
Fetched from `/league/{id}/traded_picks`, filtered to `season > currentSeason` (current-season picks consumed during draft).

**Display**: End-of-season pages: table (Season, Round, Original Owner, Current Owner). Pre/post-draft: "None". Index page: table if any exist.

**JSON Shape** (`data/<season>/traded-picks.json`):
```typescript
interface TradedPicksData {
  leagueId: string; season: string; fetchedAt: string;
  picks: ResolvedTradedPick[]; // future seasons only
  raw: LeagueTradedPick[];     // full unfiltered API response
}
interface ResolvedTradedPick {
  round: number; season: string; // e.g., "2026"
  originalOwner: string; currentOwner: string;
}
```

## Data Mutability
| Data Type | Mutable | Notes |
|-----------|---------|-------|
| Rosters | Yes | Snapshot at 3 key moments per season |
| Draft picks | No | Immutable; always available from API |
| League traded picks | Yes | Re-fetched per command |
| Player data | N/A | Fetched in-memory only; not persisted |

## Roster & Player Ordering
- **HTML column order**: Draft slot order (post-draft round 1 pick order) via `loadDraftOrder()`. Falls back to alphabetical if no post-draft snapshot exists.
- **Post-draft tables**: "Round" column (1, 2, 3...). Multi-pick rounds: letter suffixes (4a, 4b). Empty cells for owners without a pick in that round.
- **Live snapshots**: JSON alphabetical by owner; players sorted by position (QB, RB, WR, TE, K, DEF) then alphabetically.
- **Post-draft snapshots**: JSON by draft slot; players in draft pick order with `round` number.
- **End-of-season tiered**: Players grouped by original draft round (tier follows player, not owner). Sort by draft round within tier. Undrafted go in last tier. In last tier: DEF second-to-last, K last. Round lookup via `loadDraftRounds()`.

## League Rules

**Throwback Years**: Every 5 years (2025, 2030, 2035, ...), no players are kept from the previous season — everyone drafts fresh. This affects:
- End-of-season tier labels are descriptive (e.g., "TIER 1 — Drafted Rounds 1–5") because players represent only what was drafted that year
- Pre-draft snapshot is skipped (no keepers = no interesting pre-draft state to record); throwback seasons show no pre-draft chip on the index page
- Non-throwback years (2026, 2027, ...) have keeper rules that affect tier boundaries and labels — to be determined when those seasons arrive

**Non-throwback tier rules** (2026 and beyond): TBD — will depend on how many keepers, which rounds they count as, etc. Add to `TIER_CONFIGS` in `src/tiers.ts` when known.

## Tiers
Full-width colored separator rows dividing the table by draft value. Configured per `"season:snapshotType"` in `src/tiers.ts`.

- **Config**: `TIER_CONFIGS` map; each entry is `{ label, beforeRound }[]`
- **Colors**: T1 dark green `#1a6b2a`, T2 dark gold `#8b6914`, T3 dark red `#8b1a1a`
- **2025 boundaries** (throwback): T1 = rounds 1–5, T2 = 6–10, T3 = 11+ and undrafted. End-of-season labels are descriptive (see League Rules above).
- **Adding a season**: Add entry to `TIER_CONFIGS`. No config = no tier rows.
- **Rendering**: Post-draft: `buildPostDraftRows()`. End-of-season: `buildTieredRows()` (buckets by tier, sorts within, max-players determines row count).

## Draft Order
Upcoming season's draft order on index page. Configured in `DRAFT_ORDERS` in `src/tiers.ts` (key: season, value: owner names in pick order). `getLatestDraftOrder()` returns most recent. Add new entry each year; previous entries can remain.

## Index Page UI
Generated by `generateIndexHtml` in `src/html.ts`. Light mode, Tailwind CDN + Inter font, centered `max-w-2xl mx-auto px-4 sm:px-6 py-10 sm:py-20` container.

**Sections**:
1. **"Tiers"** — Season rows (year left, chip links right), most-recent first. Archive link ("Tiers 2006–2024", `text-sm text-blue-600`) appears below the oldest season row, inside this section.
2. **"20XX Draft Order"** — Numbered 1–10 list; only latest season shown.
3. **Traded Picks** — Table if future picks exist. Uses shared `tradedPicksTable()`.
4. **"Past Seasons"** — Two rows: (1) Sleeper navigation instructions with inline cog SVG icon; (2) link to MyFantasyLeague for seasons 2006–2024.

**Throwback Year badge**: Seasons with snapshots but no pre-draft page show `bg-green-800 text-white rounded px-1.5 py-0.5 text-xs font-medium` badge, positioned `mr-auto ml-3`. Rare (once every 5–10 years).

**Season chips**: `bg-gray-100 text-gray-700 rounded-lg`, hover `bg-gray-200`. Labels from `SNAPSHOT_TYPE_LABELS` with " Rosters" stripped. Season rows use `flex flex-wrap gap-y-2` so chips wrap on narrow screens.

**Chip order**: Within a season, chips run most-recent-first left to right (End-of-Season, Post-Draft, Pre-Draft). Controlled by `SNAPSHOT_TYPE_ORDER` in `snapshot.ts`, which feeds both index chips and roster page nav bars.

## Roster Page UI
Generated by `generateHtml` in `src/html.ts`. Light mode, `bg-gray-50` body. Content in `px-3 sm:px-5 pt-4 sm:pt-5 pb-10` wrapper div. Roster table wrapped in `overflow-x-auto` (scrolls horizontally on mobile by design). Nav uses `flex flex-wrap`.

**Styling**:
- Class constants at top of `html.ts` keep markup DRY (`CELL`, `TH`, `PILL_LINK`, `PILL_ACTIVE`, `SECTION_H2`, `TP_TH`, `TP_TD`)
- **Gotcha**: `SECTION_H2` is used for index page headings; `tradedPicksSection()` on roster pages has its own inline heading style — keep both in sync when changing heading styles
- Inline `<style>` via `ROSTER_STYLES` / `ROUND_COL_STYLE`: position colors (`.pos-qb` etc.), tier colors (`.tier-1` etc.), round label column

**Traded Picks**: `<h2>` heading + `overflow-x-auto` scroll wrapper at end-of-season, or "None" for pre/post-draft. Table uses `w-auto` (not full-width) so it only spans its content.

**Footer**: "Data retrieved" timestamp in Pacific time via `formatPacificTime()` (`America/Los_Angeles`).

## Deployment
Hosted on **Cloudflare Pages**, serving the `output/` directory directly from the `main` branch. No build step — HTML is pre-generated locally and committed.

- `output/` is **committed to the repo** (not gitignored) so Cloudflare Pages can serve it
- Cloudflare Pages config: build command = *(empty)*, output directory = `output`
- Deploy workflow: generate HTML locally → commit `output/` → push to `main` → Cloudflare auto-deploys

## Manual Editing
Snapshot JSON files are human-readable and editable. Regenerate HTML after edits: `npm run dev -- --generate <season> [type]`
