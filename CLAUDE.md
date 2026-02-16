# FFL Sleeper Tools

## Project Overview
Fantasy football roster viewer for a long-running league group. Pulls roster data from the Sleeper API and generates HTML tables showing all rostered players organized by owner (the preferred term for league members/teams).

## Tech Stack
- TypeScript / Node.js (ES modules)
- Native `fetch` (Node 18+, no HTTP library)
- Zero runtime dependencies

## Key Concepts
- **Roster Snapshots**: Point-in-time captures of league roster data saved as JSON in `data/<season>/`. Three snapshots per season:
  - `rosters-pre-draft.json` — captured before the draft (keeper/offseason state)
  - `rosters-post-draft.json` — generated from draft picks data (see Post-Draft Snapshots below)
  - `rosters-end-of-season.json` — captured after NFL Week 18 concludes
  - Rosters are mutable (trades, adds/drops change them), so snapshots preserve a specific moment's state. Each snapshot is self-contained with resolved player names, positions, and teams. Season folders correspond to NFL seasons (e.g., `data/2025` for the 2025-2026 season).
- **Post-Draft Snapshots**: Generated from `draft-picks.json` rather than the live rosters API. Since draft picks contain full player metadata (name, position, team) and roster assignments, post-draft rosters can be perfectly reconstructed from draft data alone. This also means post-draft snapshots can be retroactively created for any past season where draft picks data exists. Use `--snapshot-draft` for this. Rosters are ordered by draft slot (round 1 pick order) and players within each roster appear in draft pick order (not sorted by position).
- **Draft Data**: Draft picks and traded picks are immutable historical records that can always be re-fetched from the Sleeper API. Saved as `draft-picks.json` and `draft-traded-picks.json` in `data/<season>/` — no date suffix needed since the data never changes.
- **Player Data**: The Sleeper `/players/nfl` endpoint (~5MB) is fetched during `--snapshot` runs and saved to `data/<season>/players-YYYY-MM-DD.json`. Not fetched during `--snapshot-draft` since draft picks already contain all player metadata. The date in the filename allows multiple saves per season (one per snapshot run).
- **Traded Picks**: Fetched from the league-level `/league/{id}/traded_picks` endpoint, which returns all traded draft picks including upcoming seasons. Saved as `data/<season>/traded-picks.json` with both resolved (human-readable) and raw API data. Displayed on end-of-season roster pages and on the index page. The data is re-fetched with each snapshot command and can also be fetched standalone with `--traded-picks`.
- **HTML Output**: Generated to `output/<season>/` with one HTML file per snapshot type. An `output/index.html` home page links to all snapshots across all seasons and shows traded picks; auto-regenerated with every command. Each roster page includes a nav bar (grouped by season) with Home link and cross-links to all snapshots. End-of-season pages include a "Traded Picks" section below the roster table. Table cells are color-coded by position (QB pink, RB green, WR blue, TE orange, DEF tan, K purple). Tables include tier separator rows when configured (see Tiers section).

## Sleeper API
- Official docs: https://docs.sleeper.com/
- Base URL: `https://api.sleeper.app/v1`
- No authentication required (public, read-only)
- Key endpoints:
  - `/league/{id}` — league settings/metadata
  - `/league/{id}/rosters` — current rosters
  - `/league/{id}/users` — league members
  - `/league/{id}/drafts` — list of drafts (returns array of draft objects)
  - `/draft/{draft_id}` — draft metadata (settings, draft order, timestamps)
  - `/draft/{draft_id}/picks` — all draft picks with player metadata, keeper status, roster IDs
  - `/draft/{draft_id}/traded_picks` — traded pick info for a specific draft (original vs current owner)
  - `/league/{id}/traded_picks` — all traded picks across seasons (including future picks); `roster_id` is original owner, `owner_id` is current owner (both are numeric roster IDs despite the field name)
  - `/league/{id}/transactions/{week}` — all transactions (trades, waivers, FA) for a given week; trade transactions include player adds/drops and draft pick exchanges
  - `/players/nfl` — full player database (~5MB)
- Stay under 1000 calls/min

## Commands
- `npm run build` — compile TypeScript
- `npm run dev` — build + run
- `npm start` — run compiled JS
- Take a snapshot: `npm run dev -- --snapshot <pre-draft|post-draft|end-of-season> [league_id]`
- Generate post-draft roster from draft picks: `npm run dev -- --snapshot-draft <season> [league_id]`
  - Reads `data/<season>/draft-picks.json` if available, otherwise fetches from API
  - Preferred method for post-draft snapshots (works retroactively)
- Generate HTML from existing snapshot(s): `npm run dev -- --generate <season> [pre-draft|post-draft|end-of-season]`
  - Omit type to generate HTML for all existing snapshots in that season
- Fetch traded picks: `npm run dev -- --traded-picks [league_id]`
  - Fetches traded picks for upcoming seasons from the Sleeper API and saves to `data/<season>/traded-picks.json`
- All commands auto-regenerate `output/index.html`

## League
- Primary league ID: `1220634180434526208`
- Draft ID for 2025 season: `1220634181302767616`
- To find drafts for a league: `/league/{id}/drafts` returns an array of draft objects with IDs

## Season Checklist

**Draft day** (typically late August):
1. Before draft starts: `npm run dev -- --snapshot pre-draft`
2. After draft completes: `npm run dev -- --snapshot-draft <season>`

**After NFL Week 18** (~early January):
3. Final rosters: `npm run dev -- --snapshot end-of-season`

Steps 1, 2, and 3 automatically fetch and save traded picks from the Sleeper API (no separate `--traded-picks` call needed). Use `--traded-picks` standalone if you only want to update the traded picks data without taking a snapshot.

If you forget step 2 on draft day, the post-draft snapshot can be created retroactively anytime from the draft picks data. The pre-draft snapshot cannot — it requires capturing live rosters before the draft happens.

## Snapshot Timing
Each season has three snapshots taken at specific moments:
- **Pre-draft**: Day of the Sleeper draft, before it starts (captures keeper/offseason roster state). Use `--snapshot pre-draft`.
- **Post-draft**: Generated from draft picks data, not live rosters. Use `--snapshot-draft <season>`. Can be created retroactively.
- **End-of-season**: Monday after NFL Week 18 concludes (~early January of the following year). Use `--snapshot end-of-season`.
- The user runs the CLI manually at each moment — no auto-scheduling
- Note: NFL seasons span two calendar years (e.g., 2025 season runs Sep 2025 – Feb 2026)

## Project Structure
- `src/types.ts` — All TypeScript interfaces (API responses, draft types, snapshots, nav links, tier types) and `SNAPSHOT_TYPE_LABELS` display name map
- `src/sleeper-api.ts` — Sleeper API fetch wrappers (league, rosters, users, players, draft picks, traded picks)
- `src/snapshot.ts` — Snapshot capture (live + from draft picks), save, load, path helpers, nav link discovery, draft round lookup, traded picks resolution
- `src/html.ts` — HTML table generation from snapshots (sequential, post-draft round-based, tiered), index page generation
- `src/tiers.ts` — Tier configuration per season/snapshot-type (round boundaries, labels)
- `src/index.ts` — CLI entry point (`--snapshot`, `--snapshot-draft`, `--generate`, `--traded-picks`)
- `data/<season>/rosters-<type>.json` — Roster snapshots (pre-draft, post-draft, end-of-season)
- `data/<season>/draft-picks.json` — Draft picks from Sleeper API (immutable, no date needed)
- `data/<season>/draft-traded-picks.json` — Traded draft pick data (immutable, no date needed)
- `data/<season>/traded-picks.json` — League-level traded picks with resolved owner names (re-fetched with each snapshot/traded-picks command)
- `data/<season>/players-YYYY-MM-DD.json` — Player database snapshot (saved with each snapshot run)
- `output/index.html` — Home page linking to all snapshots across all seasons
- `output/<season>/rosters-<type>.html` — Generated HTML tables per snapshot type

## Snapshot JSON Shape
```typescript
type SnapshotType = "pre-draft" | "post-draft" | "end-of-season";

interface Snapshot {
  leagueId: string;
  leagueName: string;
  season: string;
  snapshotType: SnapshotType;
  capturedAt: string;          // ISO timestamp
  rosters: SnapshotRoster[];
}

interface SnapshotRoster {
  ownerName: string;           // team name or display name
  players: SnapshotPlayer[];   // already resolved; see ordering notes below
}

interface SnapshotPlayer {
  name: string;                // "Last, First"
  position: string;            // "QB", "RB", etc.
  team: string;                // "KC", "SF", etc.
  round?: number;              // Draft round (post-draft snapshots only)
}
```

## Traded Picks
Traded picks are fetched from the league-level `/league/{id}/traded_picks` endpoint and filtered to **future seasons only** (`season > currentSeason`). This means for the 2025 season, only 2026+ picks are saved — picks traded for the current season are consumed during the draft and don't need tracking.

### Display behavior
- **End-of-season pages**: Show a "Traded Picks" table below the roster table listing all future traded picks with columns: Season, Round, Original Owner, Current Owner.
- **Post-draft and pre-draft pages**: Show the "Traded Picks" heading with "None" (no in-season trades have happened yet at that point, and any pre-draft traded picks were consumed during the draft).
- **Index page**: Shows traded picks table if any exist (loaded from the most recent season's `traded-picks.json`).

### Traded Picks JSON Shape (`data/<season>/traded-picks.json`)
```typescript
interface TradedPicksData {
  leagueId: string;
  season: string;          // season the data was fetched during
  fetchedAt: string;       // ISO timestamp
  picks: ResolvedTradedPick[];  // human-readable, filtered to future seasons
  raw: LeagueTradedPick[];      // raw API response (all traded picks, unfiltered)
}

interface ResolvedTradedPick {
  round: number;
  season: string;          // the future season the pick belongs to (e.g., "2026")
  originalOwner: string;   // team name whose pick it originally was
  currentOwner: string;    // team name who now owns the pick
}
```

## Data Mutability
| Data Type | Mutable? | Notes |
|-----------|----------|-------|
| Rosters | Yes | Changes with trades/adds/drops; snapshot at 3 key moments per season |
| Draft picks | No | Immutable after draft; always available from API |
| Draft traded picks | No | Immutable after draft; always available from API |
| League traded picks | Yes | Changes as in-season trades happen; re-fetched with each command |
| Player data | Yes | Changes as NFL rosters change; saved per snapshot run with date |

## Roster & Player Ordering
- **HTML column order**: Draft slot order (round 1 pick order from the post-draft snapshot). All snapshot types within a season use the same owner column order. Falls back to alphabetical if no post-draft snapshot exists for the season. The draft order is loaded from `rosters-post-draft.json` at render time via `loadDraftOrder()`.
- **HTML row labels**: Post-draft tables have a "Rnd" column showing draft round numbers. Pre-draft and end-of-season tables have no row-number column.
- **Live snapshots** (`--snapshot`): JSON rosters alphabetical by owner name. Players sorted by position (QB, RB, WR, TE, K, DEF) then alphabetically within position.
- **Post-draft snapshots** (`--snapshot-draft`): JSON rosters ordered by draft slot (round 1 pick order). Players in draft pick order (preserves draft sequence). Each player includes `round` number. HTML rows are labeled by round (1, 2, 3...). When an owner has multiple picks in one round (from traded picks), rows get letter suffixes (4a, 4b, 4c). Owners without a pick in that round get a blank cell.
- **End-of-season tiered ordering**: When tier config and post-draft data exist, players are grouped into tiers by their original draft round (regardless of which owner they're on at end-of-season). Within each tier, players sort by draft round ascending. Undrafted players (waiver/FA pickups) go into the last tier, after drafted players. In the last tier, DEF sorts second-to-last and K sorts last. The draft round lookup is built from the post-draft snapshot via `loadDraftRounds()`.

## Tiers
Full-width colored separator rows that divide the HTML table into draft value tiers. Configured per season and snapshot type in `src/tiers.ts`.

- **Tier config**: `TIER_CONFIGS` map keyed by `"season:snapshotType"` (e.g., `"2025:post-draft"`). Each entry is an array of `{ label, beforeRound }` objects. Tier boundaries are season-specific and will change for future seasons.
- **Three tier colors** (dark backgrounds, white left-aligned bold text):
  - Tier 1: dark green (`#1a6b2a`)
  - Tier 2: dark gold (`#8b6914`)
  - Tier 3: dark red (`#8b1a1a`)
- **Owner header row**: dark gray (`#333`)
- **Post-draft rendering**: Tier rows inserted before the specified round number. Uses `buildPostDraftRows()`.
- **End-of-season rendering**: Players regrouped into tiers by their draft round from the post-draft snapshot. Uses `buildTieredRows()` which buckets each roster's players by tier, sorts within each bucket, then renders tier-by-tier with the max players in any roster determining row count per tier section.
- **Tier assignment follows the player, not the owner**: A player drafted in round 3 who was traded mid-season is still Tier 1 at end-of-season.
- **2025 boundaries**: Tier 1 = rounds 1–5, Tier 2 = rounds 6–10, Tier 3 = rounds 11+ and undrafted. These boundaries will change for 2026 and beyond.
- **Adding a new season**: Add a new entry to `TIER_CONFIGS` in `src/tiers.ts`. Seasons/snapshot types without a config render with no tier rows.

## Owner Name Overrides
Some Sleeper display names don't match the preferred team names. These are automatically corrected at snapshot capture time via `OWNER_NAME_OVERRIDES` in `src/snapshot.ts`:
- `ClovisJets` → `Clovis Jets` (Sleeper has no space)

## Manual Editing
Snapshot JSON and draft data files are human-readable and can be manually edited (add/remove/move players, fix names, correct trade records). After manual edits, regenerate HTML with: `npm run dev -- --generate <season> [type]`
