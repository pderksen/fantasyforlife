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
  LeagueTransaction,
  ResolvedTradedPick,
  TradedPicksData,
} from "./types.js";
import { SNAPSHOT_TYPE_LABELS } from "./types.js";
import { getLeague, getRosters, getUsers, fetchAllPlayers } from "./sleeper-api.js";
import { getDraftOrder } from "./tiers.js";

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

    // A pre-draft capture is the whole carryover roster, with the few players held for
    // the upcoming draft flagged. Sleeper leaves kept players in `players` as well, so
    // the lists overlap and `keepers` is the only thing that tells them apart.
    const keeperIds = new Set(snapshotType === "pre-draft" ? roster.keepers ?? [] : []);
    const playerIds = roster.players ?? [];
    const players = playerIds.map((id) => {
      const player = resolvePlayer(id, playerDb);
      return keeperIds.has(id) ? { ...player, keeper: true } : player;
    });
    sortPlayers(players);

    snapshotRosters.push({ ownerName, players });
  }

  // Sort rosters alphabetically by owner name
  snapshotRosters.sort((a, b) => a.ownerName.localeCompare(b.ownerName));

  // Keepers trickle in right up to the draft, so say plainly who is still missing —
  // an unhighlighted column is otherwise indistinguishable from a team that kept nobody.
  if (snapshotType === "pre-draft") {
    const pending = snapshotRosters.filter((r) => !r.players.some((p) => p.keeper));
    if (pending.length > 0) {
      console.warn(`\nWarning: ${pending.length} of ${snapshotRosters.length} teams have not set keepers yet:`);
      for (const r of pending) console.warn(`  ${r.ownerName}`);
      console.warn("Re-run this command any time before the draft to capture them.");
    }
  }

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

/** Identifies one pick landing with one roster: draft season, round, original owner, receiver. */
function pickTradeKey(season: string, round: number, rosterId: number, ownerId: number): string {
  return `${season}|${round}|${rosterId}|${ownerId}`;
}

/**
 * Map each pick-and-receiver to when that trade completed.
 *
 * A pick can change hands more than once, and /traded_picks only reports where it ended
 * up — so key on the receiving roster too and keep the latest completed trade. That way a
 * pick that bounced A → B → C is dated when C got it, not when B did.
 *
 * `status_updated` is when the trade was accepted; `created` is when it was proposed.
 * Those can straddle midnight, so prefer the acceptance.
 */
export function buildTradeDateMap(trades: LeagueTransaction[]): Map<string, string> {
  const latest = new Map<string, number>();
  for (const t of trades) {
    const at = t.status_updated || t.created;
    if (!at) continue;
    for (const p of t.draft_picks ?? []) {
      const key = pickTradeKey(p.season, p.round, p.roster_id, p.owner_id);
      const seen = latest.get(key);
      if (seen == null || at > seen) latest.set(key, at);
    }
  }
  return new Map([...latest].map(([key, ms]) => [key, new Date(ms).toISOString()]));
}

/**
 * Resolve raw traded picks to owner names, dating each one from the trade that moved it.
 * Saved unfiltered — every pick the league reports, across every draft season. Pages
 * narrow this at render time via picksForDraft() / picksAwaitingDraft(), so storage never
 * bakes in a display decision.
 *
 * Picks with no matching transaction (traded during the draft itself, or before this
 * league existed on Sleeper) keep their owners and simply carry no date.
 */
export function resolveTradedPicks(
  tradedPicks: LeagueTradedPick[],
  rosterOwnerMap: Map<number, string>,
  tradeDates?: Map<string, string>,
): ResolvedTradedPick[] {
  return tradedPicks
    .map((p) => {
      const tradedOn = tradeDates?.get(pickTradeKey(p.season, p.round, p.roster_id, p.owner_id));
      return {
        round: p.round,
        season: p.season,
        originalOwner: rosterOwnerMap.get(p.roster_id) ?? `Roster ${p.roster_id}`,
        currentOwner: rosterOwnerMap.get(p.owner_id) ?? `Roster ${p.owner_id}`,
        ...(tradedOn ? { tradedOn } : {}),
      };
    })
    .sort((a, b) => a.season.localeCompare(b.season) || a.round - b.round || a.originalOwner.localeCompare(b.originalOwner));
}

// Pick seasons are 4-digit year strings, so `<` / `>` compare them chronologically.

/** Picks belonging to one specific draft. Used on pre-draft pages. */
export function picksForDraft(picks: ResolvedTradedPick[], season: string): ResolvedTradedPick[] {
  return picks.filter((p) => p.season === season);
}

/**
 * Picks whose draft hasn't happened yet, relative to the most recently completed draft.
 * Used on the home page and on post-draft / end-of-season pages.
 */
export function picksAwaitingDraft(
  picks: ResolvedTradedPick[],
  lastDraftedSeason: string,
): ResolvedTradedPick[] {
  return picks.filter((p) => p.season > lastDraftedSeason);
}

export function getTradedPicksPath(season: string): string {
  return join(DATA_DIR, season, "traded-picks.json");
}

/** Newest season with a data directory, or undefined if there is no data yet. */
export function newestDataSeason(): string | undefined {
  if (!existsSync(DATA_DIR)) return undefined;
  const seasons = readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  return seasons[seasons.length - 1];
}

/**
 * Write a season's traded picks. Returns the path written, or undefined if the season
 * is sealed.
 *
 * A season seals once a newer season has data: its league is complete, so its picks can
 * no longer change. Re-fetching one would re-resolve owner names against whatever teams
 * are called today, quietly rewriting history, so leave the archived capture alone.
 */
export async function saveTradedPicks(
  leagueId: string,
  season: string,
  picks: ResolvedTradedPick[],
  raw: LeagueTradedPick[],
): Promise<string | undefined> {
  const newest = newestDataSeason();
  if (newest && season < newest && existsSync(getTradedPicksPath(season))) {
    return undefined;
  }

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

export function getDraftTradedPicksPath(season: string): string {
  return join(DATA_DIR, season, "draft-traded-picks.json");
}

/**
 * Write an immutable draft capture, leaving any existing file untouched.
 *
 * Draft data can't change once the draft runs, so the file already on disk *is* the
 * record — a rewrite could only degrade it (a hand-corrected value lost, or an id
 * rounded off by a round trip). Returns the path written, or undefined if it was
 * already there.
 */
async function saveDraftCapture(filePath: string, season: string, contents: string): Promise<string | undefined> {
  if (existsSync(filePath)) return undefined;
  await mkdir(join(DATA_DIR, season), { recursive: true });
  await writeFile(filePath, contents, "utf-8");
  return filePath;
}

export function saveDraftPicks(season: string, picks: DraftPick[]): Promise<string | undefined> {
  return saveDraftCapture(getDraftPicksPath(season), season, JSON.stringify(picks));
}

/** `raw` is the response body verbatim — see `getDraftTradedPicksRaw()`. */
export function saveDraftTradedPicks(season: string, raw: string): Promise<string | undefined> {
  return saveDraftCapture(getDraftTradedPicksPath(season), season, raw);
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

/** Nav/chip display order within a season: most recent snapshot first. */
const SNAPSHOT_TYPE_ORDER: SnapshotType[] = ["end-of-season", "post-draft", "pre-draft"];

/**
 * Discover all existing snapshot types across all seasons.
 * Returns { season, type }[] in chronological season order, newest snapshot type first within each season.
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
 * Load the draft order (owner names) for a season, for column ordering.
 *
 * The post-draft snapshot is the record of what the slot order actually was, so prefer
 * it. Before the draft that file does not exist yet, so fall back to the order configured
 * in DRAFT_ORDERS — that keeps a pre-draft page's columns lined up with the post-draft
 * page it will sit beside. Returns undefined (caller sorts alphabetically) if neither.
 */
export async function loadDraftOrder(season: string): Promise<string[] | undefined> {
  const path = getSnapshotPath(season, "post-draft");
  if (!existsSync(path)) return getDraftOrder(season);
  const snapshot = await loadSnapshot(path);
  return snapshot.rosters.map((r) => r.ownerName);
}

/**
 * Draft rounds to tier a snapshot's players by.
 *
 * A pre-draft roster is last season's carryover — nobody on it has been drafted in the
 * draft that is about to happen — so its tiers come from the *previous* season's draft.
 * Every other snapshot tiers by its own season's.
 */
export async function loadDraftRoundsFor(
  season: string,
  snapshotType: SnapshotType,
): Promise<Map<string, number> | undefined> {
  const draftedIn = snapshotType === "pre-draft" ? String(Number(season) - 1) : season;
  return loadDraftRounds(draftedIn);
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
