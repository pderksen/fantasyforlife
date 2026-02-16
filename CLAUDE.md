# FFL Sleeper Tools

## Project Overview
Fantasy football roster viewer for a long-running league group. Pulls roster data from the Sleeper API and generates HTML tables showing all rostered players organized by owner.

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
- **Post-Draft Snapshots**: Generated from `draft-picks.json` rather than the live rosters API. Since draft picks contain full player metadata (name, position, team) and roster assignments, post-draft rosters can be perfectly reconstructed from draft data alone. This also means post-draft snapshots can be retroactively created for any past season where draft picks data exists. Use `--snapshot-draft` for this.
- **Draft Data**: Draft picks and traded picks are immutable historical records that can always be re-fetched from the Sleeper API. Saved as `draft-picks.json` and `draft-traded-picks.json` in `data/<season>/` — no date suffix needed since the data never changes.
- **Player Data**: The Sleeper `/players/nfl` endpoint (~5MB) is fetched during `--snapshot` runs and saved to `data/<season>/players-YYYY-MM-DD.json`. Not fetched during `--snapshot-draft` since draft picks already contain all player metadata. The date in the filename allows multiple saves per season (one per snapshot run).
- **HTML Output**: Generated to `output/<season>/` with one HTML file per snapshot type. An `output/index.html` home page links to all snapshots across all seasons and is auto-regenerated with every command. Each roster page includes a nav bar with Home link and cross-links to sibling snapshots.

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
  - `/draft/{draft_id}/traded_picks` — traded pick info (original vs current owner)
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

If you forget step 2 on draft day, the post-draft snapshot can be created retroactively anytime from the draft picks data. The pre-draft snapshot cannot — it requires capturing live rosters before the draft happens.

## Snapshot Timing
Each season has three snapshots taken at specific moments:
- **Pre-draft**: Day of the Sleeper draft, before it starts (captures keeper/offseason roster state). Use `--snapshot pre-draft`.
- **Post-draft**: Generated from draft picks data, not live rosters. Use `--snapshot-draft <season>`. Can be created retroactively.
- **End-of-season**: Monday after NFL Week 18 concludes (~early January of the following year). Use `--snapshot end-of-season`.
- The user runs the CLI manually at each moment — no auto-scheduling
- Note: NFL seasons span two calendar years (e.g., 2025 season runs Sep 2025 – Feb 2026)

## Project Structure
- `src/types.ts` — All TypeScript interfaces (API responses, draft types, snapshots, nav links)
- `src/sleeper-api.ts` — Sleeper API fetch wrappers (league, rosters, users, players, draft picks)
- `src/snapshot.ts` — Snapshot capture (live + from draft picks), save, load, path helpers, nav link discovery
- `src/html.ts` — HTML table generation from snapshots, index page generation
- `src/index.ts` — CLI entry point (`--snapshot`, `--snapshot-draft`, `--generate`)
- `data/<season>/rosters-<type>.json` — Roster snapshots (pre-draft, post-draft, end-of-season)
- `data/<season>/draft-picks.json` — Draft picks from Sleeper API (immutable, no date needed)
- `data/<season>/draft-traded-picks.json` — Traded draft pick data (immutable, no date needed)
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
  players: SnapshotPlayer[];   // already resolved, sorted
}

interface SnapshotPlayer {
  name: string;                // "Last, First"
  position: string;            // "QB", "RB", etc.
  team: string;                // "KC", "SF", etc.
}
```

## Data Mutability
| Data Type | Mutable? | Notes |
|-----------|----------|-------|
| Rosters | Yes | Changes with trades/adds/drops; snapshot at 3 key moments per season |
| Draft picks | No | Immutable after draft; always available from API |
| Traded picks | No | Immutable after draft; always available from API |
| Player data | Yes | Changes as NFL rosters change; saved per snapshot run with date |

## Owner Name Overrides
Some Sleeper display names don't match the preferred team names. These are automatically corrected at snapshot capture time via `OWNER_NAME_OVERRIDES` in `src/snapshot.ts`:
- `ClovisJets` → `Clovis Jets` (Sleeper has no space)

## Manual Editing
Snapshot JSON and draft data files are human-readable and can be manually edited (add/remove/move players, fix names, correct trade records). After manual edits, regenerate HTML with: `npm run dev -- --generate <season> [type]`
