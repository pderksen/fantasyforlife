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
  LeagueTradedPick,
  ResolvedTradedPick,
  TradedPicksData,
} from "./types.js";
import { SNAPSHOT_TYPE_LABELS } from "./types.js";
import { getLeague, getRosters, getUsers, fetchAllPlayers } from "./sleeper-api.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");

const POS_ORDER: Record<string, number> = {
  QB: 1, RB: 2, WR: 3, TE: 4, K: 5, DEF: 6,
};

// Sleeper display names that need correction
const OWNER_NAME_OVERRIDES: Record<string, string> = {
  ClovisJets: "Clovis Jets",
};

function applyOwnerNameOverride(name: string): string {
  return OWNER_NAME_OVERRIDES[name] ?? name;
}

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

/**
 * Build a roster_id → owner name map from the Sleeper API.
 */
export async function buildRosterOwnerMap(leagueId: string): Promise<Map<number, string>> {
  const [rosters, users] = await Promise.all([getRosters(leagueId), getUsers(leagueId)]);
  const userMap = new Map<string, string>();
  for (const user of users) {
    const name = applyOwnerNameOverride(user.metadata?.team_name || user.display_name);
    userMap.set(user.user_id, name);
  }
  const rosterOwnerMap = new Map<number, string>();
  for (const roster of rosters) {
    if (roster.owner_id) {
      rosterOwnerMap.set(roster.roster_id, userMap.get(roster.owner_id) ?? `Roster ${roster.roster_id}`);
    }
  }
  return rosterOwnerMap;
}

export async function takeSnapshot(leagueId: string, snapshotType: SnapshotType, playerDb?: PlayerDatabase): Promise<Snapshot> {
  const [league, rosters, users, resolvedPlayerDb] = await Promise.all([
    getLeague(leagueId),
    getRosters(leagueId),
    getUsers(leagueId),
    playerDb ? Promise.resolve(playerDb) : fetchAllPlayers(),
  ]);
  playerDb = resolvedPlayerDb;

  console.log(`League: ${league.name} (${league.season})`);
  console.log(`Teams: ${league.total_rosters}`);

  // Build owner name map from users
  const userMap = new Map<string, string>();
  for (const user of users) {
    const name = applyOwnerNameOverride(user.metadata?.team_name || user.display_name);
    userMap.set(user.user_id, name);
  }
  const rosterOwnerMap = new Map<number, string>();
  for (const roster of rosters) {
    if (roster.owner_id) {
      rosterOwnerMap.set(roster.roster_id, userMap.get(roster.owner_id) ?? `Roster ${roster.roster_id}`);
    }
  }

  // Build resolved rosters
  const snapshotRosters: SnapshotRoster[] = [];
  for (const roster of rosters) {
    const ownerName = roster.owner_id
      ? (rosterOwnerMap.get(roster.roster_id) ?? `Owner ${roster.roster_id}`)
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
  const [league, rosterOwnerMap] = await Promise.all([
    getLeague(leagueId),
    buildRosterOwnerMap(leagueId),
  ]);

  console.log(`League: ${league.name} (${league.season})`);
  console.log(`Teams: ${league.total_rosters}`);
  console.log(`Draft picks: ${draftPicks.length}`);

  // Determine draft slot order from round 1 picks
  const draftSlotOrder: number[] = draftPicks
    .filter((p) => p.round === 1)
    .sort((a, b) => a.pick_no - b.pick_no)
    .map((p) => p.roster_id);

  // Group picks by roster_id, sorted by pick_no (draft order)
  const picksByRoster = new Map<number, DraftPick[]>();
  for (const pick of draftPicks) {
    const existing = picksByRoster.get(pick.roster_id) ?? [];
    existing.push(pick);
    picksByRoster.set(pick.roster_id, existing);
  }
  for (const picks of picksByRoster.values()) {
    picks.sort((a, b) => a.pick_no - b.pick_no);
  }

  // Build resolved rosters from draft picks, ordered by draft slot
  const snapshotRosters: SnapshotRoster[] = [];
  for (const rosterId of draftSlotOrder) {
    const picks = picksByRoster.get(rosterId) ?? [];
    const ownerName = rosterOwnerMap.get(rosterId) ?? `Roster ${rosterId} (unowned)`;

    const players: SnapshotPlayer[] = picks.map((pick) => ({
      name: `${pick.metadata.last_name}, ${pick.metadata.first_name}`,
      position: pick.metadata.position,
      team: pick.metadata.team,
      round: pick.round,
    }));

    snapshotRosters.push({ ownerName, players });
  }

  return {
    leagueId,
    leagueName: league.name,
    season: league.season,
    snapshotType: "post-draft",
    capturedAt: new Date().toISOString(),
    rosters: snapshotRosters,
  };
}

// ── Traded Picks ──

export function resolveTradedPicks(
  tradedPicks: LeagueTradedPick[],
  rosterOwnerMap: Map<number, string>,
  futureOnlySeason?: string,
): ResolvedTradedPick[] {
  const filtered = futureOnlySeason
    ? tradedPicks.filter((p) => p.season > futureOnlySeason)
    : tradedPicks;

  return filtered
    .map((p) => ({
      round: p.round,
      season: p.season,
      originalOwner: rosterOwnerMap.get(p.roster_id) ?? `Roster ${p.roster_id}`,
      currentOwner: rosterOwnerMap.get(p.owner_id) ?? `Roster ${p.owner_id}`,
    }))
    .sort((a, b) => a.season.localeCompare(b.season) || a.round - b.round || a.originalOwner.localeCompare(b.originalOwner));
}

export function getTradedPicksPath(season: string): string {
  return join(DATA_DIR, season, "traded-picks.json");
}

export async function saveTradedPicks(
  leagueId: string,
  season: string,
  picks: ResolvedTradedPick[],
  raw: LeagueTradedPick[],
): Promise<string> {
  const seasonDir = join(DATA_DIR, season);
  await mkdir(seasonDir, { recursive: true });
  const filePath = getTradedPicksPath(season);
  const data: TradedPicksData = {
    leagueId,
    season,
    fetchedAt: new Date().toISOString(),
    picks,
    raw,
  };
  await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
  return filePath;
}

export async function loadTradedPicks(season: string): Promise<ResolvedTradedPick[] | undefined> {
  const path = getTradedPicksPath(season);
  if (!existsSync(path)) return undefined;
  const raw = await readFile(path, "utf-8");
  const data = JSON.parse(raw) as TradedPicksData;
  return data.picks;
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

export function getPlayerDataPath(season: string, date: string): string {
  return join(DATA_DIR, season, `players-${date}.json`);
}

export async function savePlayerData(playerDb: PlayerDatabase, season: string): Promise<string> {
  const seasonDir = join(DATA_DIR, season);
  await mkdir(seasonDir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const filePath = getPlayerDataPath(season, date);
  await writeFile(filePath, JSON.stringify(playerDb), "utf-8");
  return filePath;
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

/**
 * Load the draft order (owner names) for a season from the post-draft snapshot.
 * Returns undefined if no post-draft snapshot exists.
 */
export async function loadDraftOrder(season: string): Promise<string[] | undefined> {
  const path = getSnapshotPath(season, "post-draft");
  if (!existsSync(path)) return undefined;
  const snapshot = await loadSnapshot(path);
  return snapshot.rosters.map((r) => r.ownerName);
}

/**
 * Load a map of player name → draft round from the post-draft snapshot.
 * Returns undefined if no post-draft snapshot exists.
 */
export async function loadDraftRounds(season: string): Promise<Map<string, number> | undefined> {
  const path = getSnapshotPath(season, "post-draft");
  if (!existsSync(path)) return undefined;
  const snapshot = await loadSnapshot(path);
  const lookup = new Map<string, number>();
  for (const roster of snapshot.rosters) {
    for (const player of roster.players) {
      if (player.round != null) {
        lookup.set(player.name, player.round);
      }
    }
  }
  return lookup;
}
