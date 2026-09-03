// ── Sleeper API Response Types ──

export interface League {
  league_id: string;
  name: string;
  season: string;
  sport: string;
  total_rosters: number;
  roster_positions: string[];
  status: string;
  previous_league_id: string | null;  // Sleeper mints a new league each season
  [key: string]: unknown;
}

export interface Roster {
  roster_id: number;
  owner_id: string | null;
  league_id: string;
  players: string[] | null;
  starters: string[] | null;
  reserve: string[] | null;
  keepers: string[] | null;  // Kept for the upcoming draft; null until the owner picks
  [key: string]: unknown;
}

export interface LeagueUser {
  user_id: string;
  username: string;
  display_name: string;
  avatar: string | null;
  metadata: {
    team_name?: string;
    [key: string]: unknown;
  };
  is_owner: boolean | null;  // null for non-commissioners, not false (verified against the 2025 league)
}

export interface SleeperPlayer {
  player_id: string;
  first_name: string;
  last_name: string;
  position: string | null;
  fantasy_positions: string[] | null;
  team: string | null;
  status: string;
  sport: string;
  [key: string]: unknown;
}

export type PlayerDatabase = Record<string, SleeperPlayer>;

// ── Draft Types ──

/** Draft as listed by /league/{id}/drafts. One per season in this league. */
export interface LeagueDraft {
  draft_id: string;
  league_id: string;
  season: string;
  status: string;              // "pre_draft", "drafting", "complete"
  [key: string]: unknown;
}

export interface DraftPick {
  draft_id: string;
  draft_slot: number;
  is_keeper: null;
  metadata: {
    first_name: string;
    last_name: string;
    position: string;
    team: string;
    player_id: string;
    [key: string]: unknown;
  };
  pick_no: number;
  picked_by: string;
  player_id: string;
  roster_id: number;
  round: number;
  [key: string]: unknown;
}

// ── Snapshot Types ──

export type SnapshotType = "pre-draft" | "post-draft" | "end-of-season";

export const SNAPSHOT_TYPE_LABELS: Record<SnapshotType, string> = {
  "pre-draft": "Pre-Draft Rosters",
  "post-draft": "Post-Draft Rosters",
  "end-of-season": "End-of-Season Rosters",
};

/** What the end-of-season file is called while the season is still being played. */
export const IN_SEASON_LABEL = "In-Season Rosters";

/**
 * The page name for a snapshot. Two of the three types have one name each; the end-of-season
 * file is captured weekly from Week 1 and reads "In-Season Rosters" until the capture that
 * finds the league complete stamps `final`, at which point the same file, page, workbook, nav
 * chip and hub pill read "End-of-Season Rosters". One evolving record rather than a fourth
 * snapshot type, so no URL, filename or nav link moves when the season ends; the type name is
 * the file's for life and "In-Season" is its state on the way there. (A single unchanging
 * label was tried on 2026-09-03 and reversed the same day: the flip is what lets the hub row
 * show which seasons are finished.)
 */
export function snapshotLabel(s: Pick<Snapshot, "snapshotType" | "final">): string {
  if (s.snapshotType === "end-of-season" && !s.final) return IN_SEASON_LABEL;
  return SNAPSHOT_TYPE_LABELS[s.snapshotType];
}

export interface SnapshotPlayer {
  name: string;       // "Last, First"
  position: string;   // "QB", "RB", etc.
  team: string;       // "KC", "SF", "FA", etc.
  round?: number;     // Draft round (post-draft snapshots only)
  /**
   * Pre-draft: held for the upcoming draft. Post-draft and end-of-season: kept into this
   * season, so the flag follows the player through trades and drops for the whole year.
   */
  keeper?: boolean;
  /**
   * Which tier a kept player occupies this season, 0-based. Keepers alone carry it: they were
   * not drafted this year, so no round places them. Settled at post-draft capture by
   * `loadKeeperTiers()` in `snapshot.ts` from the rules' one-tier climb, and copied onto every
   * end-of-season capture of the same season by name, so the in-season page tiers a keeper
   * from its own file. Never set on a pre-draft snapshot, whose keepers have not climbed yet.
   */
  keeperTier?: number;
}

export interface SnapshotRoster {
  ownerName: string;
  players: SnapshotPlayer[];
}

export interface Snapshot {
  leagueId: string;
  leagueName: string;
  season: string;
  snapshotType: SnapshotType;
  capturedAt: string;  // ISO timestamp
  /**
   * End-of-season only. True when the league reported `status: "complete"` at capture, which
   * turns the In-Season Rosters page into End-of-Season Rosters (`snapshotLabel()`), drops its
   * refresh note, and seals the file against the weekly refresh (`assertEndOfSeasonUnsealed()`
   * in `snapshot.ts`). Lives in the JSON rather than being read off the clock so the page
   * regenerates from its own file.
   */
  final?: boolean;
  rosters: SnapshotRoster[];
}

export interface NavLink {
  season: string;
  page: SnapshotType;
  label: string;      // full, e.g. "2026 Pre-Draft Rosters"
  chip: string;       // short, for nav pills and index chips, e.g. "Pre-Draft"
  href: string;       // relative path from current HTML file
  current: boolean;   // true if this is the page being rendered
}

// ── Traded Pick Types ──

/** Traded pick from the league-level /league/{id}/traded_picks endpoint. */
export interface LeagueTradedPick {
  round: number;
  season: string;
  roster_id: number;
  owner_id: number;
  previous_owner_id: number;
}

/** Draft pick moved by a trade, as reported inside a transaction. */
export interface TransactionDraftPick {
  round: number;
  season: string;
  roster_id: number;           // original owner
  owner_id: number;            // roster receiving the pick
  previous_owner_id: number;
}

/** FAAB moved by a trade, as reported inside a transaction. */
export interface WaiverBudgetTransfer {
  sender: number;              // roster giving the dollars
  receiver: number;            // roster getting them
  amount: number;
}

/** Transaction from /league/{id}/transactions/{week}. Trades carry `draft_picks`. */
export interface LeagueTransaction {
  type: string;                // "trade", "waiver", "free_agent", ...
  status: string;              // "complete", "failed", ...
  created: number;             // epoch ms — proposed
  status_updated: number;      // epoch ms — accepted/completed
  leg: number;                 // week the transaction was processed in
  roster_ids: number[];        // every roster taking part
  adds: Record<string, number> | null;   // player_id → roster receiving them
  drops: Record<string, number> | null;  // player_id → roster giving them up
  draft_picks: TransactionDraftPick[] | null;
  waiver_budget: WaiverBudgetTransfer[] | null;
  [key: string]: unknown;
}

/** Traded pick resolved with human-readable owner names. */
export interface ResolvedTradedPick {
  round: number;
  season: string;
  originalOwner: string;
  currentOwner: string;
  tradedOn?: string;  // ISO timestamp; absent when no transaction records the trade (e.g. in-draft trades)
}

/** Saved traded picks file shape. */
export interface TradedPicksData {
  leagueId: string;
  season: string;
  fetchedAt: string;
  picks: ResolvedTradedPick[];
  raw: LeagueTradedPick[];
}

// ── Trade Log Types ──

/** A draft pick as it changed hands in a trade. Named by whose pick it originally was. */
export interface TradedPickRef {
  season: string;
  round: number;
  originalOwner: string;
}

/**
 * A player as named in a trade. Deliberately no NFL team, unlike SnapshotPlayer.
 *
 * Player IDs resolve against the live /players/nfl database, which describes players as
 * they are *today*, so a trade log built after the fact would stamp each player with a
 * team they may not have been on. A roster snapshot escapes this by being captured in the
 * moment; a trade log can be written months later and is then sealed for good. Name and
 * position are stable, an NFL team is not, so the log carries what it can vouch for —
 * and `raw` keeps the player ids if anyone ever wants more.
 */
export interface TradePlayer {
  name: string;       // "Last, First"
  position: string;   // "QB", "RB", etc.
}

/** One side of a trade: everything a single roster received. */
export interface TradeParty {
  owner: string;
  players: TradePlayer[];
  picks: TradedPickRef[];
  faab?: number;      // FAAB dollars received; omitted when no budget moved
}

/** A completed trade, resolved to names. */
export interface ResolvedTrade {
  tradedOn: string;   // ISO timestamp — when the trade was accepted
  week: number;       // Sleeper's `leg`
  parties: TradeParty[];
}

/** Saved trade log file shape. */
export interface TradesData {
  leagueId: string;
  season: string;
  fetchedAt: string;
  trades: ResolvedTrade[];      // newest first
  raw: LeagueTransaction[];     // the completed trade transactions, verbatim
}

// ── Tier Types ──

/** Tier boundary: the tier label row appears right above this round (post-draft) or row index (other snapshots). */
export interface TierBreak {
  label: string;         // e.g. "TIER 1", "TIER 2", "TIER 3"
  beforeRound: number;   // For post-draft: round number. For others: 1-based row index.
}

/** Tier configuration for a specific snapshot within a season. */
export type TierConfig = TierBreak[];
