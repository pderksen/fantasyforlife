# FFL Sleeper Tools — Design & History

## Goal
Pull roster data from a Sleeper fantasy football league, save snapshots at key moments each season, and generate HTML tables from those snapshots. Provides a historical record of how rosters evolve through drafts and the season.

## Reference Layout (from Google Sheet "2025 Post-Draft" tab)
- Columns = owner/team names
- Rows = roster slots (numbered top to bottom)
- Cells = `Last, First TEAM POS`

## Three Snapshots Per Season

Each NFL season produces three roster snapshots, taken at specific moments:

| Snapshot | When | Example (2025 season) |
|---|---|---|
| **Pre-draft** | Day of draft, before it starts | Aug 23, 2025 |
| **Post-draft** | Immediately after draft completes | Aug 23, 2025 |
| **End-of-season** | After NFL Week 18 concludes | Jan/Feb 2026 |

The user runs the CLI manually at each moment. No auto-scheduling.

## Season Checklist

**Draft day** (typically late August):
1. Before draft starts: `npm run dev -- --snapshot pre-draft`
2. After draft completes: `npm run dev -- --draft-snapshot <season>`

**After NFL Week 18** (~early January):
3. Final rosters: `npm run dev -- --snapshot end-of-season`

If you forget step 1 or 2 on draft day, the post-draft snapshot can be created retroactively anytime from the draft picks data. The pre-draft snapshot cannot — it requires capturing live rosters before the draft happens.

## Project Structure
```
ffl-sleeper-tools/
  package.json
  tsconfig.json
  .gitignore
  src/
    types.ts          — Sleeper API interfaces, draft types, snapshot types, NavLink
    sleeper-api.ts    — fetch wrappers for each endpoint (incl. getDraftPicks)
    snapshot.ts       — take snapshots (live + from draft picks), save/load, nav link discovery
    html.ts           — generate roster HTML table + index page from snapshots
    index.ts          — CLI entry point (--snapshot / --draft-snapshot / --generate)
  data/
    2025/
      rosters-pre-draft.json        — roster snapshot before draft
      rosters-post-draft.json       — roster snapshot after draft (generated from draft picks)
      rosters-end-of-season.json    — roster snapshot after Week 18
      draft-picks.json              — draft picks (immutable, always re-fetchable)
      draft-traded-picks.json       — traded draft picks (immutable)
  output/
    index.html                      — home page linking to all seasons/snapshots
    2025/
      rosters-pre-draft.html        — generated HTML (with nav bar)
      rosters-post-draft.html
      rosters-end-of-season.html
```

## Snapshot Design

A snapshot is a single JSON file that captures the fully-resolved league state at one point in time. It contains everything needed to render the HTML without hitting the API again.

**File naming:** `data/<season>/rosters-<type>.json` where type is `pre-draft`, `post-draft`, or `end-of-season`. Each type is taken once per season, so the phase name is the unique identifier. The exact capture timestamp is stored in the JSON `capturedAt` field.

**Shape:**
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

The snapshot stores **resolved, human-readable data** — no raw player IDs. Snapshots are self-contained and small (~20KB). The full player DB (~5MB) is fetched fresh from the Sleeper API at snapshot time to resolve player IDs, but is not cached locally.

**Post-draft snapshots** are a special case: they are generated from `draft-picks.json` rather than the live rosters API. Draft picks already contain full player metadata (name, position, team) embedded in each pick's `metadata` field, plus `roster_id` to identify which team drafted the player. This means post-draft rosters can be perfectly reconstructed without the ~5MB player DB fetch, and can be retroactively created for past seasons. The `takePostDraftSnapshot()` function in `snapshot.ts` handles this — it still calls the league/rosters/users APIs for owner name resolution, but skips `fetchAllPlayers()`.

## CLI Usage

```bash
# Take a new snapshot (pre-draft or end-of-season) and generate its HTML
npm run dev -- --snapshot <pre-draft|post-draft|end-of-season> [league_id]

# Generate post-draft roster from draft picks data (preferred for post-draft)
npm run dev -- --draft-snapshot <season> [league_id]
# Reads data/<season>/draft-picks.json if available, otherwise fetches from API

# Generate HTML from existing snapshot(s) — no API call
npm run dev -- --generate <season> [pre-draft|post-draft|end-of-season]
# Omit type to generate all existing snapshots for that season
```

All commands auto-regenerate `output/index.html` (the home page).

## Data Flow
```
npm run dev -- --snapshot end-of-season
  → takeSnapshot(leagueId, "end-of-season")
      → Promise.all(getLeague, getRosters, getUsers, fetchAllPlayers)
      → resolve owner_id → display name
      → resolve player_ids → name, position, team
      → sort players per roster by position
      → return Snapshot object (with snapshotType)
  → saveSnapshot → data/2025/rosters-end-of-season.json
  → generateHtml(snapshot, navLinks) → output/2025/rosters-end-of-season.html
  → regenerateIndex → output/index.html

npm run dev -- --draft-snapshot 2025
  → load data/2025/draft-picks.json (or fetch from API)
  → takePostDraftSnapshot(leagueId, draftPicks)
      → Promise.all(getLeague, getRosters, getUsers)  ← no fetchAllPlayers needed
      → map roster_id → owner_id → display name
      → build players from draft pick metadata
      → sort and return Snapshot
  → saveSnapshot → data/2025/rosters-post-draft.json
  → generateHtml(snapshot, navLinks) → output/2025/rosters-post-draft.html
  → regenerateIndex → output/index.html

npm run dev -- --generate 2025
  → for each type in [pre-draft, post-draft, end-of-season]:
      → loadSnapshot(data/2025/rosters-<type>.json)
      → generateHtml(snapshot, navLinks) → output/2025/rosters-<type>.html
      → skip missing snapshots with a message
  → regenerateIndex → output/index.html
```

## Draft Data

Draft data is saved as raw JSON from the Sleeper API into `data/<season>/`. Draft data is **immutable** — it never changes after the draft completes and can always be re-fetched from the API.

- **Draft picks** (`/draft/{draft_id}/picks`): All picks with full player metadata (name, position, team), keeper status (`is_keeper` field), roster IDs, round/pick numbers. The 2025 draft had 170 picks across 17 rounds (10 teams, snake format).
- **Traded picks** (`/draft/{draft_id}/traded_picks`): Shows which picks changed hands — includes `roster_id` (original), `owner_id` (current), and `previous_owner_id`.
- Draft ID for 2025: `1220634181302767616` (started 2025-08-23)
- To find drafts for a league: `/league/{id}/drafts` returns an array of draft objects with IDs.

## Data Mutability

| Data Type | Mutable? | File Naming | Notes |
|-----------|----------|-------------|-------|
| Rosters | Yes | `rosters-<type>.json` | Changes with trades/adds/drops; snapshot at 3 key moments per season |
| Draft picks | No | `draft-picks.json` | Immutable after draft; always available from API |
| Traded picks | No | `draft-traded-picks.json` | Immutable after draft; always available from API |

## HTML Navigation

All generated HTML pages include navigation:

- **Index page** (`output/index.html`): Home page listing all seasons (most recent first), each with links to its available snapshots. Auto-regenerated on every CLI command.
- **Roster pages**: Each includes a nav bar at the top with:
  - "Home" link back to `../index.html`
  - Season labels with links to sibling snapshots (Pre-Draft, Post-Draft, End-of-Season)
  - Current page highlighted; vertical separators between seasons
- Navigation is data-driven: `buildNavLinks()` and `buildIndexNavLinks()` in `snapshot.ts` scan `data/` for existing `rosters-*.json` files to determine what links to render. Relative paths between `output/` directories keep everything working as static files.

## Manual Editing

Snapshot JSON and draft data files are human-readable and can be manually edited:
- Roster snapshots: add/remove/move players between rosters, fix names
- Draft traded picks: add or correct trade records
- After manual edits, regenerate HTML with: `npm run dev -- --generate <season> [type]`
