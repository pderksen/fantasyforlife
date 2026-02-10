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
- **Post-Draft Snapshots**: Generated from `draft-picks.json` rather than the live rosters API. Since draft picks contain full player metadata (name, position, team) and roster assignments, post-draft rosters can be perfectly reconstructed from draft data alone — no ~5MB player DB fetch needed. This also means post-draft snapshots can be retroactively created for any past season where draft picks data exists. Use `--draft-snapshot` for this.
- **Draft Data**: Draft picks and traded picks are immutable historical records that can always be re-fetched from the Sleeper API. Saved as `draft-picks.json` and `draft-traded-picks.json` in `data/<season>/` — no date suffix needed since the data never changes.
- **No player DB cache**: The Sleeper `/players/nfl` endpoint (~5MB) is fetched fresh at snapshot time to resolve player IDs, then discarded. Snapshots and draft-pick files already contain all resolved player data, so caching the full player DB is unnecessary.
- **HTML Output**: Generated to `output/<season>/` with one HTML file per snapshot type. An `output/index.html` home page links to all snapshots across all seasons and is auto-regenerated with every command. Each roster page includes a nav bar with Home link and cross-links to sibling snapshots.

## Sleeper API
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
- Draft ID for 2025 season: `1220634181302767616`

## Commands
- `npm run build` — compile TypeScript
- `npm run dev` — build + run
- `npm start` — run compiled JS
- Take a snapshot: `npm run dev -- --snapshot <pre-draft|post-draft|end-of-season> [league_id]`
- Generate post-draft roster from draft picks: `npm run dev -- --draft-snapshot <season> [league_id]`
  - Reads `data/<season>/draft-picks.json` if available, otherwise fetches from API
  - Preferred method for post-draft snapshots (works retroactively)
- Generate HTML from existing snapshot(s): `npm run dev -- --generate <season> [pre-draft|post-draft|end-of-season]`
  - Omit type to generate HTML for all existing snapshots in that season
- All commands auto-regenerate `output/index.html`

## League
- Primary league ID: `1220634180434526208`

## Snapshot Timing
Each season has three snapshots taken at specific moments:
- **Pre-draft**: Day of the Sleeper draft, before it starts (captures keeper/offseason roster state). Use `--snapshot pre-draft`.
- **Post-draft**: Generated from draft picks data, not live rosters. Use `--draft-snapshot <season>`. Can be created retroactively.
- **End-of-season**: Monday after NFL Week 18 concludes (~early January of the following year). Use `--snapshot end-of-season`.
- The user runs the CLI manually at each moment — no auto-scheduling
- Note: NFL seasons span two calendar years (e.g., 2025 season runs Sep 2025 – Feb 2026)

## Project Structure
- `src/types.ts` — All TypeScript interfaces (API responses, draft types, snapshots, nav links)
- `src/sleeper-api.ts` — Sleeper API fetch wrappers (league, rosters, users, players, draft picks)
- `src/snapshot.ts` — Snapshot capture (live + from draft picks), save, load, path helpers, nav link discovery
- `src/html.ts` — HTML table generation from snapshots, index page generation
- `src/index.ts` — CLI entry point (`--snapshot`, `--draft-snapshot`, `--generate`)
- `data/<season>/rosters-<type>.json` — Roster snapshots (pre-draft, post-draft, end-of-season)
- `data/<season>/draft-picks.json` — Draft picks from Sleeper API (immutable, no date needed)
- `data/<season>/draft-traded-picks.json` — Traded draft pick data (immutable, no date needed)
- `output/index.html` — Home page linking to all snapshots across all seasons
- `output/<season>/rosters-<type>.html` — Generated HTML tables per snapshot type
