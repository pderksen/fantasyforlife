import type {
  League,
  Roster,
  LeagueUser,
  PlayerDatabase,
  DraftPick,
  LeagueTradedPick,
  LeagueTransaction,
} from "./types.js";

const BASE_URL = "https://api.sleeper.app/v1";

async function fetchJson<T>(path: string): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Sleeper API error: ${response.status} ${response.statusText} for ${url}`
    );
  }
  return response.json() as Promise<T>;
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

export async function getDraftPicks(draftId: string): Promise<DraftPick[]> {
  return fetchJson<DraftPick[]>(`/draft/${draftId}/picks`);
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
 * Every completed trade in the league that moved a draft pick.
 *
 * The only place Sleeper dates a pick trade — /league/{id}/traded_picks reports where a
 * pick ended up but never when it moved. There is no all-weeks endpoint, so sweep them.
 * A week the league hasn't reached yet errors; treat that as "no trades" rather than
 * failing the whole snapshot.
 */
export async function getPickTrades(leagueId: string): Promise<LeagueTransaction[]> {
  const weeks = await Promise.all(
    Array.from({ length: TRANSACTION_WEEKS }, (_, i) =>
      getTransactions(leagueId, i + 1).catch(() => [] as LeagueTransaction[])),
  );
  return weeks
    .flat()
    .filter((t) => t.type === "trade" && t.status === "complete" && (t.draft_picks?.length ?? 0) > 0);
}
