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

export interface SnapshotPlayer {
  name: string;       // "Last, First"
  position: string;   // "QB", "RB", etc.
  team: string;       // "KC", "SF", "FA", etc.
  round?: number;     // Draft round (post-draft snapshots only)
  keeper?: boolean;   // Held for the upcoming draft (pre-draft snapshots only)
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
