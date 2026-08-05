import type {
  League,
  Roster,
  LeagueUser,
  PlayerDatabase,
  LeagueDraft,
  DraftPick,
  LeagueTradedPick,
  LeagueTransaction,
} from "./types.js";

const BASE_URL = "https://api.sleeper.app/v1";

async function fetchOk(path: string): Promise<Response> {
  const url = `${BASE_URL}${path}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Sleeper API error: ${response.status} ${response.statusText} for ${url}`
    );
  }
  return response;
}

async function fetchJson<T>(path: string): Promise<T> {
  return (await fetchOk(path)).json() as Promise<T>;
}

export async function getLeague(leagueId: string): Promise<League> {
  return fetchJson<League>(`/league/${leagueId}`);
}

export async function getRosters(leagueId: string): Promise<Roster[]> {
  return fetchJson<Roster[]>(`/league/${leagueId}/rosters`);
}

export async function getUsers(leagueId: string): Promise<LeagueUser[]> {
  return fetchJson<LeagueUser[]>(`/league/${leagueId}/users`);
}

export async function fetchAllPlayers(): Promise<PlayerDatabase> {
  return fetchJson<PlayerDatabase>("/players/nfl");
}

export async function getLeagueDrafts(leagueId: string): Promise<LeagueDraft[]> {
  return fetchJson<LeagueDraft[]>(`/league/${leagueId}/drafts`);
}

export async function getDraftPicks(draftId: string): Promise<DraftPick[]> {
  return fetchJson<DraftPick[]>(`/draft/${draftId}/picks`);
}

/**
 * A draft's own traded picks, as the exact response body rather than parsed JSON.
 * This one is archived verbatim: Sleeper returns `draft_id` here as a bare integer past
 * 2^53 (`...767616` comes back from a parse/stringify round trip as `...767600`), and
 * nothing in the app reads the file, so keeping the original bytes costs nothing.
 */
export async function getDraftTradedPicksRaw(draftId: string): Promise<string> {
  return (await fetchOk(`/draft/${draftId}/traded_picks`)).text();
}

export async function getLeagueTradedPicks(leagueId: string): Promise<LeagueTradedPick[]> {
  return fetchJson<LeagueTradedPick[]>(`/league/${leagueId}/traded_picks`);
}

/** Weeks Sleeper reports transactions for. Week 1 also carries offseason activity. */
const TRANSACTION_WEEKS = 18;

export async function getTransactions(leagueId: string, week: number): Promise<LeagueTransaction[]> {
  return (await fetchJson<LeagueTransaction[] | null>(`/league/${leagueId}/transactions/${week}`)) ?? [];
}

/**
 * This league and every earlier season's league it descends from, newest first.
 *
 * Sleeper mints a fresh league id each season and links back via `previous_league_id`.
 * The guard against a repeated id stops a self-referential chain from looping forever.
 */
export async function getLeagueLineage(leagueId: string): Promise<string[]> {
  const ids: string[] = [];
  let id: string | null = leagueId;
  while (id && !ids.includes(id)) {
    ids.push(id);
    id = (await getLeague(id)).previous_league_id;
  }
  return ids;
}

/**
 * Every completed trade that moved a draft pick, across this league and its predecessors.
 *
 * The only place Sleeper dates a pick trade — /league/{id}/traded_picks reports where a
 * pick ended up but never when it moved. There is no all-weeks endpoint, so sweep them.
 * A week the league hasn't reached yet errors; treat that as "no trades" rather than
 * failing the whole snapshot.
 *
 * The lineage sweep is what makes those dates survive the offseason: next year's picks
 * are traded during this year's season, so they are recorded against the league that has
 * since been replaced. Querying only the current league would find the picks (they carry
 * forward) but none of their dates.
 */
export async function getPickTrades(leagueId: string): Promise<LeagueTransaction[]> {
  const leagueIds = await getLeagueLineage(leagueId);
  const weeks = await Promise.all(
    leagueIds.flatMap((id) =>
      Array.from({ length: TRANSACTION_WEEKS }, (_, i) =>
        getTransactions(id, i + 1).catch(() => [] as LeagueTransaction[]))),
  );
  return weeks
    .flat()
    .filter((t) => t.type === "trade" && t.status === "complete" && (t.draft_picks?.length ?? 0) > 0);
}
