import type { Snapshot, SnapshotRoster, SnapshotPlayer, TierConfig } from "./types.js";

/** Map of "Last, First" player name → draft round number */
export type DraftRoundLookup = Map<string, number>;

/** A full-width tier separator. Rendered as one colspan bar in HTML, as a label in CSV. */
export interface GridTierRow {
  kind: "tier";
  label: string;
  tierIndex: number;
}

/** One row of player cells. `label` is the post-draft round ("4a"); absent on other layouts. */
export interface GridDataRow {
  kind: "data";
  label?: string;
  /** One entry per owner column, in `RosterGrid.rosters` order. `undefined` = empty cell. */
  cells: (SnapshotPlayer | undefined)[];
}

export type GridRow = GridTierRow | GridDataRow;

/**
 * The roster table as data, one step short of markup.
 *
 * Both renderers (HTML page, CSV export) build from this, so the two can't drift: the
 * layout choice — sequential, tiered, or post-draft by round — is made once, here.
 */
export interface RosterGrid {
  /** Owner columns in display order. */
  rosters: SnapshotRoster[];
  /** Post-draft layouts carry a leading "Round" column; the others don't. */
  hasRoundColumn: boolean;
  rows: GridRow[];
}

function dataRow(cells: (SnapshotPlayer | undefined)[], label?: string): GridDataRow {
  return label == null ? { kind: "data", cells } : { kind: "data", label, cells };
}

function buildSequentialRows(rosters: SnapshotRoster[], maxPlayers: number, tiers?: TierConfig): GridRow[] {
  const tierAtRow = new Map<number, GridTierRow>();
  if (tiers) {
    for (let i = 0; i < tiers.length; i++) {
      tierAtRow.set(tiers[i].beforeRound - 1, { kind: "tier", label: tiers[i].label, tierIndex: i });
    }
  }

  const rows: GridRow[] = [];
  for (let i = 0; i < maxPlayers; i++) {
    const tier = tierAtRow.get(i);
    if (tier) rows.push(tier);
    rows.push(dataRow(rosters.map((r) => r.players[i])));
  }
  return rows;
}

const POS_SORT_TAIL: Record<string, number> = { DEF: 1, K: 2 };

function buildTieredRows(
  rosters: SnapshotRoster[],
  tiers: TierConfig,
  draftRounds: DraftRoundLookup,
): GridRow[] {
  const tierRanges = tiers.map((t, i) => ({
    min: t.beforeRound,
    max: i + 1 < tiers.length ? tiers[i + 1].beforeRound : Infinity,
  }));

  function getTierIndex(p: SnapshotPlayer): number {
    const round = draftRounds.get(p.name);
    if (round == null) return tiers.length - 1;
    for (let i = 0; i < tierRanges.length; i++) {
      if (round >= tierRanges[i].min && round < tierRanges[i].max) return i;
    }
    return tiers.length - 1;
  }

  function playerSortKey(p: SnapshotPlayer, tierIdx: number): number {
    const round = draftRounds.get(p.name);
    if (tierIdx === tiers.length - 1 && POS_SORT_TAIL[p.position]) {
      return 90000 + POS_SORT_TAIL[p.position] * 1000;
    }
    if (round != null) return round;
    return 80000;
  }

  const rosterBuckets = rosters.map((r) => {
    const buckets: SnapshotPlayer[][] = tiers.map(() => []);
    for (const p of r.players) buckets[getTierIndex(p)].push(p);
    // Keepers float to the top of whichever tier their draft round earned them — a team
    // may keep several from one tier, and they simply stack there in round order.
    for (let t = 0; t < buckets.length; t++) {
      buckets[t].sort((a, b) =>
        Number(!!b.keeper) - Number(!!a.keeper) || playerSortKey(a, t) - playerSortKey(b, t));
    }
    return buckets;
  });

  const rows: GridRow[] = [];
  for (let t = 0; t < tiers.length; t++) {
    const maxInTier = Math.max(...rosterBuckets.map((rb) => rb[t].length));
    if (maxInTier === 0) continue;
    rows.push({ kind: "tier", label: tiers[t].label, tierIndex: t });
    for (let i = 0; i < maxInTier; i++) {
      rows.push(dataRow(rosterBuckets.map((rb) => rb[t][i])));
    }
  }
  return rows;
}

function buildPostDraftRows(rosters: SnapshotRoster[], tiers?: TierConfig): GridRow[] {
  const allRounds = new Set<number>();
  for (const r of rosters) {
    for (const p of r.players) {
      if (p.round != null) allRounds.add(p.round);
    }
  }
  const sortedRounds = [...allRounds].sort((a, b) => a - b);

  const roundMaxPicks = new Map<number, number>();
  for (const round of sortedRounds) {
    let max = 1;
    for (const r of rosters) {
      const count = r.players.filter((p) => p.round === round).length;
      if (count > max) max = count;
    }
    roundMaxPicks.set(round, max);
  }

  const tierAtRound = new Map<number, GridTierRow>();
  if (tiers) {
    for (let i = 0; i < tiers.length; i++) {
      tierAtRound.set(tiers[i].beforeRound, { kind: "tier", label: tiers[i].label, tierIndex: i });
    }
  }

  const rows: GridRow[] = [];
  for (const round of sortedRounds) {
    const tier = tierAtRound.get(round);
    if (tier) rows.push(tier);

    const maxPicks = roundMaxPicks.get(round)!;
    const needsSuffix = maxPicks > 1;

    for (let slot = 0; slot < maxPicks; slot++) {
      const label = needsSuffix ? `${round}${String.fromCharCode(97 + slot)}` : `${round}`;
      rows.push(dataRow(
        rosters.map((r) => r.players.filter((p) => p.round === round)[slot]),
        label,
      ));
    }
  }
  return rows;
}

/**
 * Lay a snapshot out as a table: owners across, players down.
 *
 * Which of the three layouts runs is decided here and nowhere else — see the
 * `beforeRound` note in `TIER_CONFIGS`, since sequential reads it as a row index
 * while the other two read it as a draft round.
 */
export function buildRosterGrid(
  snapshot: Snapshot,
  ownerOrder?: string[],
  tiers?: TierConfig,
  draftRounds?: DraftRoundLookup,
): RosterGrid {
  const rosters = [...snapshot.rosters].sort((a, b) => {
    if (ownerOrder) {
      const idxA = ownerOrder.indexOf(a.ownerName);
      const idxB = ownerOrder.indexOf(b.ownerName);
      if (idxA >= 0 && idxB >= 0) return idxA - idxB;
      if (idxA >= 0) return -1;
      if (idxB >= 0) return 1;
    }
    return a.ownerName.localeCompare(b.ownerName);
  });
  const maxPlayers = Math.max(...rosters.map((r) => r.players.length));

  const isPostDraft = snapshot.snapshotType === "post-draft" && rosters.some((r) => r.players.some((p) => p.round != null));
  const useTieredLayout = !isPostDraft && tiers && draftRounds && draftRounds.size > 0;
  const rows = isPostDraft
    ? buildPostDraftRows(rosters, tiers)
    : useTieredLayout
      ? buildTieredRows(rosters, tiers!, draftRounds!)
      : buildSequentialRows(rosters, maxPlayers, tiers);

  return { rosters, hasRoundColumn: isPostDraft, rows };
}
