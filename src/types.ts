// ── Sleeper API Response Types ──

export interface League {
  league_id: string;
  name: string;
  season: string;
  sport: string;
  total_rosters: number;
  roster_positions: string[];
  status: string;
  [key: string]: unknown;
}

export interface Roster {
  roster_id: number;
  owner_id: string | null;
  league_id: string;
  players: string[] | null;
  starters: string[] | null;
  reserve: string[] | null;
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
  is_owner: boolean;
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
  snapshotType: SnapshotType;
  label: string;
  href: string;       // relative path from current HTML file
  current: boolean;   // true if this is the page being rendered
}
