import { existsSync, readdirSync, readFileSync } from "node:fs";
import { readFile, writeFile, mkdir, cp } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Snapshot,
  SnapshotPlayer,
  SnapshotRoster,
  SnapshotType,
  PlayerDatabase,
  Roster,
  LeagueUser,
  DraftPick,
  NavLink,
  LeagueTradedPick,
  LeagueTransaction,
  ResolvedTradedPick,
  TradedPicksData,
  ResolvedTrade,
  TradeParty,
  TradesData,
} from "./types.js";
import { snapshotLabel } from "./types.js";
import { getLeague, getRosters, getUsers, fetchAllPlayers } from "./sleeper-api.js";
import { getDraftOrder, getTierConfig } from "./tiers.js";
import { LEAGUE_FACTS } from "./league-info.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");

const POS_ORDER: Record<string, number> = {
  QB: 1, RB: 2, WR: 3, TE: 4, K: 5, DEF: 6,
};

// Sleeper display names that need correction.
//
// Applied at capture, so the corrected form is what lands in the snapshot JSON and what every
// downstream join key (DRAFT_ORDERS, column ordering) has to match. Changing an entry here
// therefore means hand-editing the already-captured files too — a sealed season never
// re-fetches, so nothing else will ever rewrite them.
const OWNER_NAME_OVERRIDES: Record<string, string> = {
  ClovisJets: "Clovis Jets",
  "South Town FF": "South Town Freedom Fighters",
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

function sortPlayers<T extends { name: string; position: string }>(players: T[]): T[] {
  return players.sort((a, b) => {
    const posA = POS_ORDER[a.position] ?? 99;
    const posB = POS_ORDER[b.position] ?? 99;
    if (posA !== posB) return posA - posB;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Build a roster_id → owner name map from responses already in hand.
 *
 * Split out from `buildRosterOwnerMap()` because `takePostDraftSnapshot()` needs the rosters
 * themselves as well — they carry the keepers — and fetching them twice to get the names
 * would be the only reason to call the fetching form there.
 */
function rosterOwnerMapFrom(rosters: Roster[], users: LeagueUser[]): Map<number, string> {
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

/**
 * Build a roster_id → owner name map from the Sleeper API.
 */
export async function buildRosterOwnerMap(leagueId: string): Promise<Map<number, string>> {
  const [rosters, users] = await Promise.all([getRosters(leagueId), getUsers(leagueId)]);
  return rosterOwnerMapFrom(rosters, users);
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

  // In season the keeper flag and tier travel with the player, not the roster: a kept player
  // is Tier 1 or 2 for the whole year whoever holds him in December, and Sleeper's own
  // `roster.keepers` stays on the team that kept him. So both are read off the season's
  // post-draft record by name, the same join `loadDraftRounds()` uses for everybody else.
  const keptThisSeason = snapshotType === "end-of-season"
    ? await loadKeptPlayers(league.season)
    : new Map<string, number | undefined>();

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
    // `players` is the whole roster, IR slot included; a player on reserve is tiered like
    // anyone else, since keeper eligibility does not care where he sits.
    const playerIds = roster.players ?? [];
    const players = playerIds.map((id) => {
      const player = resolvePlayer(id, playerDb);
      if (keeperIds.has(id)) return { ...player, keeper: true };
      if (keptThisSeason.has(player.name)) {
        const keeperTier = keptThisSeason.get(player.name);
        return keeperTier == null ? { ...player, keeper: true } : { ...player, keeper: true, keeperTier };
      }
      return player;
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

  // The in-season capture becomes the end-of-season record the first time it finds the league
  // finished. Stamped into the file so the label and the seal read the record, not the clock.
  const final = snapshotType === "end-of-season" && league.status === "complete";
  if (final) console.log("League status is complete: this capture is the final one and seals the file.");

  return {
    leagueId,
    leagueName: league.name,
    season: league.season,
    snapshotType,
    capturedAt: new Date().toISOString(),
    ...(final ? { final } : {}),
    rosters: snapshotRosters,
  };
}

/**
 * Who was kept into a season and which tier the climb put each of them in, by name, read off
 * that season's post-draft record. Empty when the season has no post-draft snapshot or (a
 * throwback year) kept nobody. The value is `undefined` for a keeper the post-draft capture
 * could not place, who then falls back to the top tier at render exactly as he does there.
 */
async function loadKeptPlayers(season: string): Promise<Map<string, number | undefined>> {
  const map = new Map<string, number | undefined>();
  const path = getSnapshotPath(season, "post-draft");
  if (!existsSync(path)) return map;
  const snapshot = await loadSnapshot(path);
  for (const roster of snapshot.rosters) {
    for (const player of roster.players) {
      if (player.keeper) map.set(player.name, player.keeperTier);
    }
  }
  return map;
}

/**
 * Which tier each kept player occupies in the season they were kept into, 0-based.
 *
 * The rules give a kept player a **one-tier climb**: keep a Tier 2 player and he is Tier 1
 * next season, keep a Tier 3 and he is Tier 2, and a Tier 1 has nowhere left to climb. The
 * tier he climbs *from* is the one the previous season's draft put him in, which is exactly
 * what this season's own pre-draft page tiers by — so the origin lookup is `<season>:pre-draft`'s
 * config read against the previous season's rounds, and the two pages cannot disagree about
 * where a keeper started. An undrafted player is a free-agent pickup and starts in the last
 * tier, per the same rule.
 *
 * Keyed by player name, the join key `DraftRoundLookup` already uses. An empty map means the
 * climb could not be worked out (no pre-draft tier config, or no previous post-draft
 * snapshot), and the renderer falls back to the top tier.
 */
async function loadKeeperTiers(season: string, keepers: SnapshotPlayer[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const originTiers = getTierConfig(season, "pre-draft");
  if (keepers.length === 0 || !originTiers) return map;

  const originRounds = (await loadDraftRoundsFor(season, "pre-draft")) ?? new Map<string, number>();
  for (const player of keepers) {
    const round = originRounds.get(player.name);
    // The last tier whose `beforeRound` this round has reached. Undrafted skips the scan and
    // lands in the last tier outright, which is where the rules put a free-agent pickup.
    let origin = originTiers.length - 1;
    if (round != null) {
      origin = 0;
      for (let i = 0; i < originTiers.length; i++) {
        if (round >= originTiers[i].beforeRound) origin = i;
      }
    }
    // Tier 1 is index 0, so climbing is a decrement, and Tier 1 stays put.
    map.set(player.name, Math.max(0, origin - 1));
  }
  return map;
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
  const rosterOwnerMap = rosterOwnerMapFrom(rosters, users);
  const rosterById = new Map(rosters.map((r) => [r.roster_id, r]));

  // Sleeper does not put kept players on the draft board. A keeper year's board carries the
  // picks alone and `is_keeper` is null on every one of them (verified against the 2026
  // draft, where none of the 30 kept players appears), so the roster a team leaves the draft
  // with is its keepers plus its picks and the keepers have to come off the live rosters.
  const keepersByRoster = new Map<number, string[]>();
  for (const roster of rosters) {
    if (roster.keepers?.length) keepersByRoster.set(roster.roster_id, roster.keepers);
  }

  // The 15MB player fetch is the only thing that turns a keeper id into a name, and a
  // throwback year keeps nobody — so it stays skipped in exactly the years it buys nothing.
  const playerDb = keepersByRoster.size > 0 ? await fetchAllPlayers() : undefined;

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

  // Build resolved rosters from keepers + draft picks, ordered by draft slot
  const snapshotRosters: SnapshotRoster[] = [];
  const staleRosters: string[] = [];
  for (const rosterId of draftSlotOrder) {
    const picks = picksByRoster.get(rosterId) ?? [];
    const ownerName = rosterOwnerMap.get(rosterId) ?? `Roster ${rosterId} (unowned)`;
    const live = rosterById.get(rosterId);

    const keepers: SnapshotPlayer[] = (keepersByRoster.get(rosterId) ?? []).map((id) => ({
      ...resolvePlayer(id, playerDb ?? {}),
      keeper: true,
    }));
    sortPlayers(keepers);

    // Every roster leaves the draft at exactly the roster limit, so a team drafts only the
    // slots its keepers do not already fill and cuts the rest. Sleeper's board is not
    // trimmed to that — 2026 ran a full 17 rounds and all ten teams dropped back to 14
    // picks afterwards — and which ones a team cut was its own call, one keeping a round-15
    // pick over a round-13 one. So the survivors are read off the live roster rather than
    // guessed by taking the first N in pick order.
    //
    // That makes this a point-in-time capture: run it once the draft ends and before
    // waivers open. A roster that has moved on since (a drop, a pickup) no longer describes
    // the draft, so it falls back to the mechanical trim and is named in a warning.
    const draftedSlots = LEAGUE_FACTS.rosterLimit - keepers.length;
    const held = new Set(live?.players ?? []);
    const survived = picks.filter((p) => held.has(p.player_id));
    const fromLiveRoster = survived.length === draftedSlots;
    if (!fromLiveRoster) staleRosters.push(ownerName);
    const kept = fromLiveRoster ? survived : picks.slice(0, draftedSlots);

    // A cut leaves a hole in the team's round numbers and a trade leaves one too, and only
    // one of them is real. A traded-away round has no pick on the board at all, so its gap
    // is a fact about the draft and stays; a cut round *does* have a pick, so its gap is an
    // artifact of the oversized board and the picks after it shift up to close it. Sanger
    // cut a round-13 pick in 2026 and their last two picks read 14 and 15 without this.
    //
    // Only on the live-roster path: the fallback cannot tell a cut from a stale roster, so
    // it leaves the board's own numbers alone.
    const shift = new Map<string, number>();
    if (fromLiveRoster) {
      let cuts = 0;
      for (const pick of picks) {
        if (held.has(pick.player_id)) shift.set(pick.player_id, cuts);
        else cuts++;
      }
    }

    const drafted: SnapshotPlayer[] = kept.map((pick) => ({
      name: `${pick.metadata.last_name}, ${pick.metadata.first_name}`,
      position: pick.metadata.position,
      team: pick.metadata.team,
      round: pick.round - (shift.get(pick.player_id) ?? 0),
    }));

    snapshotRosters.push({ ownerName, players: [...keepers, ...drafted] });
  }

  // Stamp each keeper with the tier his climb earned him. Done here rather than at render
  // time because it reads the *previous* season's snapshot, and a self-contained capture is
  // what lets a page regenerate from its own file alone.
  const allKeepers = snapshotRosters.flatMap((r) => r.players.filter((p) => p.keeper));
  const keeperTiers = await loadKeeperTiers(league.season, allKeepers);
  for (const player of allKeepers) {
    const tier = keeperTiers.get(player.name);
    if (tier != null) player.keeperTier = tier;
  }
  const untiered = allKeepers.filter((p) => p.keeperTier == null);
  if (untiered.length > 0) {
    console.warn(`\nWarning: ${untiered.length} keeper(s) could not be placed in a tier:`);
    for (const p of untiered) console.warn(`  ${p.name}`);
    console.warn("They render in the top tier. Check the previous season's post-draft snapshot");
    console.warn(`and the ${league.season}:pre-draft entry in TIER_CONFIGS.`);
  }

  if (staleRosters.length > 0) {
    console.warn(`\nWarning: ${staleRosters.length} roster(s) no longer match their draft picks:`);
    for (const name of staleRosters) console.warn(`  ${name}`);
    console.warn("Fell back to the first picks in draft order for those teams. A post-draft");
    console.warn("capture is only accurate between the end of the draft and the first waiver run.");
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

/** Seasons with a data directory, oldest first. */
function listSeasons(): string[] {
  if (!existsSync(DATA_DIR)) return [];
  return readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

/** Newest season with a data directory, or undefined if there is no data yet. */
export function newestDataSeason(): string | undefined {
  return listSeasons().at(-1);
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

// ── Trade log ──

/**
 * Resolve completed trades to owner and player names, newest first.
 *
 * Sleeper describes a trade by what each roster *gained*: `adds` maps player_id → the
 * roster receiving them, `draft_picks[].owner_id` is the roster receiving the pick, and
 * `waiver_budget` moves FAAB from a sender to a receiver. `drops` is the mirror image of
 * `adds` and carries nothing extra, so it is ignored.
 *
 * `status_updated` is when the trade was accepted, `created` when it was proposed — same
 * choice, for the same reason, as buildTradeDateMap().
 */
export function resolveTrades(
  trades: LeagueTransaction[],
  rosterOwnerMap: Map<number, string>,
  playerDb: PlayerDatabase,
): ResolvedTrade[] {
  const ownerName = (rosterId: number) => rosterOwnerMap.get(rosterId) ?? `Roster ${rosterId}`;

  return trades
    .map((t) => {
      const parties = new Map<number, TradeParty>();
      const party = (rosterId: number): TradeParty => {
        let existing = parties.get(rosterId);
        if (!existing) {
          existing = { owner: ownerName(rosterId), players: [], picks: [] };
          parties.set(rosterId, existing);
        }
        return existing;
      };

      // Seed from roster_ids first, so every side of the trade is named and ordered as
      // Sleeper reports it — including one that gave up everything and got nothing back.
      for (const rosterId of t.roster_ids ?? []) party(rosterId);

      for (const [playerId, rosterId] of Object.entries(t.adds ?? {})) {
        // Name and position only — see TradePlayer for why the NFL team is dropped.
        const { name, position } = resolvePlayer(playerId, playerDb);
        party(rosterId).players.push({ name, position });
      }
      for (const pick of t.draft_picks ?? []) {
        party(pick.owner_id).picks.push({
          season: pick.season,
          round: pick.round,
          originalOwner: ownerName(pick.roster_id),
        });
      }
      for (const transfer of t.waiver_budget ?? []) {
        const receiver = party(transfer.receiver);
        receiver.faab = (receiver.faab ?? 0) + transfer.amount;
      }

      for (const p of parties.values()) {
        sortPlayers(p.players);
        p.picks.sort((a, b) => a.season.localeCompare(b.season) || a.round - b.round);
      }

      return {
        tradedOn: new Date(t.status_updated || t.created).toISOString(),
        week: t.leg,
        parties: [...parties.values()],
      };
    })
    .sort((a, b) => b.tradedOn.localeCompare(a.tradedOn));
}

export function getTradesPath(season: string): string {
  return join(DATA_DIR, season, "trades.json");
}

/**
 * Write a season's trade log. Returns the path written, or undefined if the season is
 * sealed.
 *
 * Sealed on the same rule as traded picks: once a newer season has data this league is
 * complete, its trades can't change, and re-fetching would re-resolve owner names against
 * whatever the teams are called today. Callers handle an empty trade list themselves —
 * a season with no trades yet simply gets no file.
 *
 * Nothing renders this log today; it is captured so the history exists to render later.
 */
export async function saveTrades(
  leagueId: string,
  season: string,
  trades: ResolvedTrade[],
  raw: LeagueTransaction[],
): Promise<string | undefined> {
  const newest = newestDataSeason();
  if (newest && season < newest && existsSync(getTradesPath(season))) {
    return undefined;
  }

  const seasonDir = join(DATA_DIR, season);
  await mkdir(seasonDir, { recursive: true });
  const filePath = getTradesPath(season);
  const data: TradesData = {
    leagueId,
    season,
    fetchedAt: new Date().toISOString(),
    trades,
    raw,
  };
  await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
  return filePath;
}

export async function loadTrades(season: string): Promise<TradesData | undefined> {
  const path = getTradesPath(season);
  if (!existsSync(path)) return undefined;
  return JSON.parse(await readFile(path, "utf-8")) as TradesData;
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

/** File name a season's page is written to, within output/<season>/. */
export function pageFileName(page: SnapshotType): string {
  return `rosters-${page}.html`;
}

/**
 * File name a season's Excel export is written to, within output/<season>/.
 *
 * The season and league are in the name where the page's aren't: a page is read in place,
 * under a URL that already says which year it is, while its workbook gets downloaded into a
 * folder next to every other year's and every other league's — where a bare
 * `rosters-pre-draft.xlsx` identifies nothing. Type leads so the three sort together.
 */
export function exportFileName(season: string, page: SnapshotType): string {
  return `rosters-${page}-${season}-ffl.xlsx`;
}

export function getOutputPath(season: string, page: SnapshotType): string {
  return join(DATA_DIR, "..", "output", season, pageFileName(page));
}

/** Companion workbook for a roster page, written alongside it by every generate path. */
export function getExportOutputPath(season: string, page: SnapshotType): string {
  return join(DATA_DIR, "..", "output", season, exportFileName(season, page));
}


/**
 * A refused write, as opposed to an unexpected failure. Carries a message written for the
 * person at the terminal, so the CLI prints it plainly instead of as a crash.
 */
export class SnapshotGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotGuardError";
  }
}

/**
 * Whether the window for capturing keepers has closed.
 *
 * Sleeper reports a league as `pre_draft` until the draft starts, then `drafting` and later
 * `in_season` / `complete`. Keepers live in `roster.keepers` only until the draft consumes
 * them, so a "pre-draft" capture taken afterward is a post-draft roster with zero keepers —
 * and, unguarded, it lands on top of the only copy of the real one. A daily keeper-watch job
 * left running past draft day walks straight into this.
 */
export function preDraftWindowClosed(leagueStatus: string): boolean {
  return leagueStatus !== "pre_draft";
}

/**
 * Refuse to overwrite a season's end-of-season snapshot once it is final, unless `force` is set.
 *
 * The file is re-captured every Thursday from Week 1 as the In-Season Rosters page, and the
 * capture that finds the league `complete` stamps `final` and becomes the End-of-Season record.
 * The weekly refresh keeps running into January, so without this it would go on rewriting
 * `capturedAt` on a finished season (and, the year a league is not frozen promptly, could pick
 * up an offseason move). A capture that is not yet final overwrites freely: that is the point.
 */
export function assertEndOfSeasonUnsealed(season: string, force: boolean): void {
  if (force) return;
  const filePath = getSnapshotPath(season, "end-of-season");
  if (!isFinalSnapshot(season)) return;
  throw new SnapshotGuardError(
    `Refusing to overwrite ${filePath}\n` +
    `  That capture is final: the league had reported complete, so it is the season's\n` +
    `  end-of-season record. Nothing was written. Re-run with --force to replace it anyway.`,
  );
}

/** Does the season's end-of-season snapshot exist and carry `final: true`? Sync, for the nav builder. */
function isFinalSnapshot(season: string): boolean {
  const path = getSnapshotPath(season, "end-of-season");
  if (!existsSync(path)) return false;
  return (JSON.parse(readFileSync(path, "utf-8")) as Snapshot).final === true;
}

/**
 * Refuse to overwrite a season's post-draft snapshot unless `force` is set.
 *
 * The post-draft file is the season's tier record, not just a page of its own: it is where
 * `loadDraftRoundsFor()` finds every player's draft round for the end-of-season page (the
 * tier follows the player through trades, and a waiver pickup with no round there lands in
 * the last tier), and where `loadKeeperTiers()` reads a kept player's origin for the next
 * season's pre-draft page. Re-capturing it after waivers open would read a pickup as drafted
 * and lose a dropped player's round, and both downstream pages would tier people wrong with
 * no error. So the file is locked the moment it exists. Checked here and again by the two CLI
 * paths before their 15MB player fetch, so a refused run costs nothing.
 */
export function assertPostDraftUnlocked(season: string, force: boolean): void {
  if (force) return;
  const filePath = getSnapshotPath(season, "post-draft");
  if (!existsSync(filePath)) return;
  throw new SnapshotGuardError(
    `Refusing to overwrite ${filePath}\n` +
    `  The post-draft snapshot is the season's tier record: the end-of-season page and next\n` +
    `  season's keeper tiers both read draft rounds off it, so it is locked once captured.\n` +
    `  Nothing was written. Re-run with --force to replace it anyway.`,
  );
}

/** Players flagged as kept for the upcoming draft. */
function countKeepers(snapshot: Snapshot): number {
  return snapshot.rosters.reduce(
    (total, roster) => total + roster.players.filter((p) => p.keeper).length,
    0,
  );
}

/**
 * Write a roster snapshot. Returns the path written.
 *
 * Overwriting is normal here and deliberately stays that way: keepers trickle in for weeks,
 * so the runbook has you re-capture pre-draft daily and the newest run is the one that counts.
 * Plain existence is therefore no reason to refuse. Losing keepers is: nothing legitimately
 * un-picks one, so a capture holding fewer than the file on disk is a bad read (the draft
 * already ran, an API hiccup, the wrong league id) rather than an update, and it would
 * destroy the one record that cannot be rebuilt from the API. That case refuses unless
 * `force` is set.
 *
 * Post-draft is the opposite: existence alone refuses (see `assertPostDraftUnlocked()`).
 * End-of-season overwrites weekly until the capture is final (`assertEndOfSeasonUnsealed()`).
 */
export async function saveSnapshot(snapshot: Snapshot, force = false): Promise<string> {
  const seasonDir = join(DATA_DIR, snapshot.season);
  const filePath = join(seasonDir, `rosters-${snapshot.snapshotType}.json`);

  if (snapshot.snapshotType === "post-draft") assertPostDraftUnlocked(snapshot.season, force);
  if (snapshot.snapshotType === "end-of-season") assertEndOfSeasonUnsealed(snapshot.season, force);

  if (snapshot.snapshotType === "pre-draft" && !force && existsSync(filePath)) {
    const saved = countKeepers(await loadSnapshot(filePath));
    const incoming = countKeepers(snapshot);
    if (incoming < saved) {
      throw new SnapshotGuardError(
        `Refusing to overwrite ${filePath}\n` +
        `  The saved capture has ${saved} keeper(s); this one has ${incoming}.\n` +
        `  Keepers only exist until the draft consumes them, so the saved file may be the\n` +
        `  only record. Nothing was written. Re-run with --force to replace it anyway.`,
      );
    }
  }

  await mkdir(seasonDir, { recursive: true });
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
 * Every page that exists for every season, in chronological season order and newest-first
 * within each.
 */
function discoverPages(): Array<{ season: string; page: SnapshotType }> {
  const results: Array<{ season: string; page: SnapshotType }> = [];
  for (const season of listSeasons()) {
    for (const type of SNAPSHOT_TYPE_ORDER) {
      if (existsSync(getSnapshotPath(season, type))) results.push({ season, page: type });
    }
  }
  return results;
}

/**
 * Full page name ("2026 Pre-Draft Rosters") and its short chip form ("Pre-Draft").
 *
 * The end-of-season page is "In-Season" until its file carries `final`, so this reads the file
 * rather than the type alone; that is what moves every nav chip, hub pill and hero card to the
 * new name in the same run that seals the capture.
 */
function pageLabels(season: string, page: SnapshotType): { label: string; chip: string } {
  const name = snapshotLabel({ snapshotType: page, final: page === "end-of-season" && isFinalSnapshot(season) });
  return { label: `${season} ${name}`, chip: name.replace(" Rosters", "") };
}

/**
 * Build nav links relative to a page at output/<currentSeason>/.
 */
export function buildNavLinks(currentSeason: string, currentPage: SnapshotType): NavLink[] {
  return discoverPages().map(({ season, page }) => ({
    season,
    page,
    ...pageLabels(season, page),
    href: season === currentSeason ? pageFileName(page) : `../${season}/${pageFileName(page)}`,
    current: season === currentSeason && page === currentPage,
  }));
}

/**
 * Build nav links relative to the index page at output/.
 */
export function buildIndexNavLinks(): NavLink[] {
  return discoverPages().map(({ season, page }) => ({
    season,
    page,
    ...pageLabels(season, page),
    href: `${season}/${pageFileName(page)}`,
    current: false,
  }));
}

/**
 * The newest tiers page that exists: newest season, newest snapshot type within it.
 *
 * `discoverPages()` walks seasons oldest-first and types newest-first, so the answer is the
 * first link belonging to the last season. The home page's hero card points here and advances
 * on its own — 2026 Pre-Draft today, 2026 Post-Draft the moment that page is generated. The
 * "Keeper Tiers" nav item deliberately does not: it goes to the hub, which lists every stage.
 */
export function newestNavLink(links: NavLink[]): NavLink | undefined {
  const newestSeason = links[links.length - 1]?.season;
  return links.find((l) => l.season === newestSeason);
}

export function getIndexOutputPath(): string {
  return join(DATA_DIR, "..", "output", "index.html");
}

/**
 * The League History page. A flat file at the output root rather than `history/index.html`,
 * so Cloudflare Pages serves it at `/history` and the link still resolves over `file://`
 * during local preview.
 */
export function getHistoryOutputPath(): string {
  return join(DATA_DIR, "..", "output", "history.html");
}

/** The Prize Tracker page. Flat file at the output root, same rule as the History page. */
export function getPrizesOutputPath(): string {
  return join(DATA_DIR, "..", "output", "prizes.html");
}

/**
 * The Keeper Tiers hub, listing every season's tiers pages. Flat file at the output root,
 * same rule as the History and Prize pages.
 */
export function getTiersOutputPath(): string {
  return join(DATA_DIR, "..", "output", "tiers.html");
}

/**
 * The Official Rules page. Flat file at the output root, same rule as the pages above.
 *
 * Only the current season's rules are generated. A past season's rules are a frozen copy of this
 * file under `rules-<season>.html`, made by hand when the season closes and committed as a static
 * page, so nothing here writes one and no generator will ever overwrite one.
 */
export function getRulesOutputPath(): string {
  return join(DATA_DIR, "..", "output", "rules.html");
}

/** The Photo Gallery page. Flat file at the output root, same rule as the pages above. */
export function getGalleryOutputPath(): string {
  return join(DATA_DIR, "..", "output", "gallery.html");
}

// ── Static assets ──

/**
 * Files served as-is rather than generated: the brand marks, of which only the header's
 * avatar is referenced by a page today.
 *
 * They live in `assets/` at the repo root and are copied into `output/assets/` by every run,
 * because `output/` is what Cloudflare serves and what git archives — an image referenced
 * from a page has to be in there too. Copying rather than committing only to `output/` keeps
 * the source of every served file visible outside the generated directory.
 */
const ASSETS_SOURCE_DIR = join(DATA_DIR, "..", "assets");
const SITE_MARK = "ffl-avatar-128.png";

/**
 * Whether the header avatar is available to link. The design treats the mark as optional, so
 * a missing file renders the wordmark alone instead of a broken image.
 */
export function hasSiteMark(): boolean {
  return existsSync(join(ASSETS_SOURCE_DIR, SITE_MARK));
}

/** Mirror `assets/` into `output/assets/`. No-op when there is nothing to copy. */
export async function syncStaticAssets(): Promise<void> {
  if (!existsSync(ASSETS_SOURCE_DIR)) return;
  await cp(ASSETS_SOURCE_DIR, join(DATA_DIR, "..", "output", "assets"), { recursive: true });
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
