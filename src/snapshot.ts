import { existsSync, readdirSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Snapshot,
  SnapshotPlayer,
  SnapshotRoster,
  SnapshotType,
  PlayerDatabase,
  DraftPick,
  NavLink,
} from "./types.js";
import { SNAPSHOT_TYPE_LABELS } from "./types.js";
import { getLeague, getRosters, getUsers, fetchAllPlayers } from "./sleeper-api.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");

const POS_ORDER: Record<string, number> = {
  QB: 1, RB: 2, WR: 3, TE: 4, K: 5, DEF: 6,
};

function resolvePlayer(
  playerId: string,
  playerDb: PlayerDatabase
): SnapshotPlayer {
  const p = playerDb[playerId];
  if (!p) {
    return { name: `Unknown (${playerId})`, position: "??", team: "??" };
  }
  return {
    name: `${p.last_name}, ${p.first_name}`,
    position: p.position ?? p.fantasy_positions?.[0] ?? "??",
    team: p.team ?? "FA",
  };
}

function sortPlayers(players: SnapshotPlayer[]): SnapshotPlayer[] {
  return players.sort((a, b) => {
    const posA = POS_ORDER[a.position] ?? 99;
    const posB = POS_ORDER[b.position] ?? 99;
    if (posA !== posB) return posA - posB;
    return a.name.localeCompare(b.name);
  });
}

export async function takeSnapshot(leagueId: string, snapshotType: SnapshotType): Promise<Snapshot> {
  const [league, rosters, users, playerDb] = await Promise.all([
    getLeague(leagueId),
    getRosters(leagueId),
    getUsers(leagueId),
    fetchAllPlayers(),
  ]);

  console.log(`League: ${league.name} (${league.season})`);
  console.log(`Teams: ${league.total_rosters}`);

  // Map owner_id → display name
  const ownerMap = new Map<string, string>();
  for (const user of users) {
    const name = user.metadata?.team_name || user.display_name;
    ownerMap.set(user.user_id, name);
  }

  // Build resolved rosters
  const snapshotRosters: SnapshotRoster[] = [];
  for (const roster of rosters) {
    const ownerName = roster.owner_id
      ? (ownerMap.get(roster.owner_id) ?? `Owner ${roster.roster_id}`)
      : `Roster ${roster.roster_id} (unowned)`;

    const playerIds = roster.players ?? [];
    const players = playerIds.map((id) => resolvePlayer(id, playerDb));
    sortPlayers(players);

    snapshotRosters.push({ ownerName, players });
  }

  // Sort rosters alphabetically by owner name
  snapshotRosters.sort((a, b) => a.ownerName.localeCompare(b.ownerName));

  return {
    leagueId,
    leagueName: league.name,
    season: league.season,
    snapshotType,
    capturedAt: new Date().toISOString(),
    rosters: snapshotRosters,
  };
}

export async function takePostDraftSnapshot(
  leagueId: string,
  draftPicks: DraftPick[]
): Promise<Snapshot> {
  const [league, rosters, users] = await Promise.all([
    getLeague(leagueId),
    getRosters(leagueId),
    getUsers(leagueId),
  ]);

  console.log(`League: ${league.name} (${league.season})`);
  console.log(`Teams: ${league.total_rosters}`);
  console.log(`Draft picks: ${draftPicks.length}`);

  // Map owner_id → display name
  const ownerMap = new Map<string, string>();
  for (const user of users) {
    const name = user.metadata?.team_name || user.display_name;
    ownerMap.set(user.user_id, name);
  }

  // Map roster_id → owner_id
  const rosterOwnerMap = new Map<number, string>();
  for (const roster of rosters) {
    if (roster.owner_id) {
      rosterOwnerMap.set(roster.roster_id, roster.owner_id);
    }
  }

  // Group picks by roster_id
  const picksByRoster = new Map<number, DraftPick[]>();
  for (const pick of draftPicks) {
    const existing = picksByRoster.get(pick.roster_id) ?? [];
    existing.push(pick);
    picksByRoster.set(pick.roster_id, existing);
  }

  // Build resolved rosters from draft picks
  const snapshotRosters: SnapshotRoster[] = [];
  for (const [rosterId, picks] of picksByRoster) {
    const ownerId = rosterOwnerMap.get(rosterId);
    const ownerName = ownerId
      ? (ownerMap.get(ownerId) ?? `Owner ${rosterId}`)
      : `Roster ${rosterId} (unowned)`;

    const players: SnapshotPlayer[] = picks.map((pick) => ({
      name: `${pick.metadata.last_name}, ${pick.metadata.first_name}`,
      position: pick.metadata.position,
      team: pick.metadata.team,
    }));
    sortPlayers(players);

    snapshotRosters.push({ ownerName, players });
  }

  // Sort rosters alphabetically by owner name
  snapshotRosters.sort((a, b) => a.ownerName.localeCompare(b.ownerName));

  return {
    leagueId,
    leagueName: league.name,
    season: league.season,
    snapshotType: "post-draft",
    capturedAt: new Date().toISOString(),
    rosters: snapshotRosters,
  };
}

export function getSnapshotPath(season: string, snapshotType: SnapshotType): string {
  return join(DATA_DIR, season, `rosters-${snapshotType}.json`);
}

export function getDraftPicksPath(season: string): string {
  return join(DATA_DIR, season, "draft-picks.json");
}

export function getOutputPath(season: string, snapshotType: SnapshotType): string {
  return join(DATA_DIR, "..", "output", season, `rosters-${snapshotType}.html`);
}

export async function saveSnapshot(snapshot: Snapshot): Promise<string> {
  const seasonDir = join(DATA_DIR, snapshot.season);
  await mkdir(seasonDir, { recursive: true });
  const filePath = join(seasonDir, `rosters-${snapshot.snapshotType}.json`);
  if (existsSync(filePath)) {
    console.warn(`Warning: overwriting existing snapshot at ${filePath}`);
  }
  await writeFile(filePath, JSON.stringify(snapshot, null, 2), "utf-8");
  return filePath;
}

export async function loadSnapshot(filePath: string): Promise<Snapshot> {
  const raw = await readFile(filePath, "utf-8");
  return JSON.parse(raw) as Snapshot;
}

const SNAPSHOT_TYPE_ORDER: SnapshotType[] = ["pre-draft", "post-draft", "end-of-season"];

/**
 * Discover all existing snapshot types across all seasons.
 * Returns { season, type }[] in chronological + type order.
 */
function discoverSnapshots(): Array<{ season: string; snapshotType: SnapshotType }> {
  const results: Array<{ season: string; snapshotType: SnapshotType }> = [];
  if (!existsSync(DATA_DIR)) return results;

  const seasons = readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  for (const season of seasons) {
    const seasonDir = join(DATA_DIR, season);
    for (const type of SNAPSHOT_TYPE_ORDER) {
      if (existsSync(join(seasonDir, `rosters-${type}.json`))) {
        results.push({ season, snapshotType: type });
      }
    }
  }
  return results;
}

/**
 * Build nav links relative to a roster page at output/<currentSeason>/.
 */
export function buildNavLinks(currentSeason: string, currentType: SnapshotType): NavLink[] {
  return discoverSnapshots().map(({ season, snapshotType }) => ({
    season,
    snapshotType,
    label: `${season} ${SNAPSHOT_TYPE_LABELS[snapshotType]}`,
    href: season === currentSeason
      ? `rosters-${snapshotType}.html`
      : `../${season}/rosters-${snapshotType}.html`,
    current: season === currentSeason && snapshotType === currentType,
  }));
}

/**
 * Build nav links relative to the index page at output/.
 */
export function buildIndexNavLinks(): NavLink[] {
  return discoverSnapshots().map(({ season, snapshotType }) => ({
    season,
    snapshotType,
    label: `${season} ${SNAPSHOT_TYPE_LABELS[snapshotType]}`,
    href: `${season}/rosters-${snapshotType}.html`,
    current: false,
  }));
}

export function getIndexOutputPath(): string {
  return join(DATA_DIR, "..", "output", "index.html");
}
