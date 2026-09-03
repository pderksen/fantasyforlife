# Data Capture — Traded Picks and the Trade Log

Background reasoning for the two Sleeper captures that aren't roster snapshots. `CLAUDE.md`
carries the operative rules (display filters, sealing, which command writes what); this file
carries the why, the JSON shapes, and the history behind the calls.

Written Aug 2026 alongside the captures themselves. Read it for reasoning, not as a
description of current state — if it disagrees with the code, the code won.

---

## Traded Picks

### Why storage is unfiltered

`data/<season>/traded-picks.json` holds **every** pick the league reports across all draft
seasons, with both resolved (human-readable) and raw API data. Storage bakes in no display
decision; filtering happens at render time via `picksForDraft()` / `picksAwaitingDraft()` in
`snapshot.ts`.

The alternative — saving only the picks a page shows — would have meant re-fetching to change
a display rule, and re-fetching a sealed season is exactly what sealing exists to prevent.

### The `season` field means the draft, not the trade

The `season` field on a pick means **which draft the pick belongs to**, never when it was
traded. Pick trades carry forward into the league they apply to, so a 2026 league's list is
mostly trades made during 2025. This reads backwards the first time and is worth re-checking
before assuming a date is wrong.

### How trade dates get attached

`/traded_picks` carries no timestamp (only `round`, `season`, `roster_id`, `owner_id`,
`previous_owner_id`), so `getPickTrades()` sweeps `/league/{id}/transactions/{week}` for weeks
1–18 and `buildTradeDateMap()` keys each completed pick trade by
`season|round|roster_id|owner_id`.

Three things about that keying, each of which was a bug before it was a rule:

- **The sweep spans the league lineage, not just the current league.** Next year's picks are
  traded during this year's season, so a fresh league returns the picks but zero transactions.
  Query it alone and every date silently vanishes. `getLeagueLineage()` walks
  `previous_league_id` to assemble the chain.
- **Stable `roster_id`s across the rollover are what let the keys match.** Verified 2025→2026.
  If Sleeper ever renumbered rosters between seasons, this whole scheme would need a
  translation layer.
- **Keying on the receiving roster matters.** A pick that went A → B → C must be dated when C
  got it, and `/traded_picks` only reports the final destination. Where a key repeats, the
  latest trade wins.

Picks with no matching transaction get no `tradedOn`. Two known causes: in-draft trades (see
`draft-traded-picks.json`) and anything predating the league's existence on Sleeper. Neither
has a transaction record, so the absence is correct rather than a gap to fill.

### Why the home page reads saved data, not the API

The home page derives `lastDraftedSeason` from the latest season's snapshots: it has drafted
once any non-pre-draft snapshot exists, otherwise the previous season is used. It reads the
latest saved capture, never a live fetch, so `--generate` stays offline and deterministic —
which is what makes the "regenerate, then `git diff -- output/`" verification loop work at all.

### Why seasons seal

A season's file stops being rewritten once a newer season has a data directory.
`saveTradedPicks()` returns `undefined` when it skips.

The league is complete so the picks can't change, but that's the weaker half of the reason.
The real one: re-fetching would re-resolve owner names against *current* team names, quietly
rewriting history. A team renamed in 2027 would retroactively appear under its new name in the
2025 file, with nothing in the diff explaining why.

### JSON shape

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

---

## Trade Log

Backward-looking history: what actually changed hands, and when. Distinct from the
forward-looking Traded Picks table, which only says who owns an *upcoming* pick. Neither
replaces the other.

### Captured but not published

A per-season `output/<season>/trades.html` shipped and was pulled a day later (Aug 2026) — not
wanted per season. The capture deliberately stayed: transactions are only readable out of the
live league and a season seals, so an un-captured year is gone for good.

Treat `trades.json` as an archive with no current reader. `loadTrades()` in `snapshot.ts` is
its read half and has had no caller since the page was dropped; that's intentional, not dead
code to prune. Reviving a page (per-season or one combined log) means writing the renderer
again; `git show f4f3914` has the original.

Cost is 18 calls (one per week) against the current 1 for traded picks, which is why it isn't
free to run casually but is nowhere near the 1000/min rate limit.

### No NFL team on trade players, deliberately

Player IDs resolve against the live `/players/nfl`, which describes players as they are
*today*. A roster snapshot escapes that by being captured in the moment; a trade log can be
written months later and is then sealed for good.

Measured on the 2025 backfill: 2 of 15 drafted players had changed NFL teams, and
waiver-added players were worse. Name and position are stable, so the log carries only those.
`raw` keeps the player ids if anyone ever wants more.

### Only what each side received

Sleeper records both halves of every swap, so `TradeParty` records only the gains: the mirror
image adds no facts, and `drops` carries nothing `adds` doesn't.

### JSON shape

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

---

## Snapshot JSON shape

Kept here beside the other two for reference. `src/types.ts` is the source of truth.

```typescript
type SnapshotType = "pre-draft" | "post-draft" | "end-of-season";

interface Snapshot {
  leagueId: string; leagueName: string; season: string;
  snapshotType: SnapshotType; capturedAt: string; // ISO timestamp
  final?: boolean;   // end-of-season only: the league was complete at capture, so the
                     // In-Season Rosters page becomes End-of-Season Rosters and the file seals
  rosters: SnapshotRoster[];
}
interface SnapshotRoster { ownerName: string; players: SnapshotPlayer[]; }
interface SnapshotPlayer {
  name: string;         // "Last, First"
  position: string;     // "QB", "RB", etc.
  team: string;         // "KC", "SF", etc.
  round?: number;       // post-draft only
  keeper?: boolean;     // pre-draft: held for the upcoming draft; post-draft and end-of-season:
                        // kept into this season, following the player through trades and drops
  keeperTier?: number;  // 0-based tier a keeper climbed into; stamped at post-draft capture and
                        // copied onto every end-of-season capture by name. Never on pre-draft
}
```
