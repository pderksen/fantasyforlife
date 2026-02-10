import type {
  League,
  Roster,
  LeagueUser,
  PlayerDatabase,
  DraftPick,
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
