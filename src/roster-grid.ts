import type { Snapshot, SnapshotRoster, SnapshotPlayer, TierConfig } from "./types.js";

/** Map of "Last, First" player name → draft round number */
export type DraftRoundLookup = Map<string, number>;

/** A full-width tier separator. Rendered as one colspan bar in HTML, as a label in CSV. */
export interface GridTierRow {
  kind: "tier";
  label: string;
  tierIndex: number;
}

/** One row of player cells. No layout labels its rows — only tier bars carry text. */
export interface GridDataRow {
  kind: "data";
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
  /**
   * True when every column was placed by `ownerOrder` — i.e. the header really is the
   * season's draft order, and both renderers can say so in their footer. False when no
   * order was supplied, or when it names only some of the owners and the rest fall
   * through to the alphabetical tail below, which is no longer a draft order.
   */
  columnsInDraftOrder: boolean;
  rows: GridRow[];
}

function dataRow(cells: (SnapshotPlayer | undefined)[]): GridDataRow {
  return { kind: "data", cells };
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

/**
 * Post-draft: tier blocks, no round column.
 *
 * The page answers "which tier does each player sit in for next year's keepers", not "what
 * happened in the draft" — Sleeper's own draft board is one click away from the Keeper Tiers
 * hub and is the better record of that. So a round decides which block a player lands in and
 * where he sits inside it, then stops being shown. The round column and its per-round rows
 * went in Aug 2026, and the gaps went with them: a team that traded a pick used to leave a
 * blank in every other column at that round, and a team that cut one left a hole of its own.
 * The league's own 2022 and 2023 post-draft sheets are laid out exactly this way.
 *
 * Keepers open their tier. They were not drafted this season at all, so their block comes
 * from `keeperTier`, the rules' one-tier climb settled at capture by `loadKeeperTiers()` in
 * `snapshot.ts`. A keeper with none falls back to the top tier, which is where the roster
 * slots keepers fill actually sit. Note that the tier labels name drafted rounds and a
 * keeper has none of this draft, so the yellow highlight is the only thing marking the
 * exception — the same arrangement the pre-draft page already runs.
 */
function buildPostDraftTierRows(rosters: SnapshotRoster[], tiers: TierConfig): GridRow[] {
  const tierRanges = tiers.map((t, i) => ({
    min: t.beforeRound,
    max: i + 1 < tiers.length ? tiers[i + 1].beforeRound : Infinity,
  }));

  function getTierIndex(p: SnapshotPlayer): number {
    if (p.keeper) return Math.min(p.keeperTier ?? 0, tiers.length - 1);
    if (p.round == null) return tiers.length - 1;
    for (let i = 0; i < tierRanges.length; i++) {
      if (p.round >= tierRanges[i].min && p.round < tierRanges[i].max) return i;
    }
    return tiers.length - 1;
  }

  const rosterBuckets = rosters.map((r) => {
    const buckets: SnapshotPlayer[][] = tiers.map(() => []);
    for (const p of r.players) buckets[getTierIndex(p)].push(p);
    // Keepers first, then draft order. Keepers all sort equal on round, so the capture's own
    // position order holds between them.
    for (const bucket of buckets) {
      bucket.sort((a, b) =>
        Number(!!b.keeper) - Number(!!a.keeper) || (a.round ?? 0) - (b.round ?? 0));
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

/**
 * Lay a snapshot out as a table: owners across, players down.
 *
 * Which of the three layouts runs is decided here and nowhere else — see the
 * `beforeRound` note in `TIER_CONFIGS`, since sequential reads it as a row index
 * while the other two read it as a draft round.
 *
 * No layout carries a round column any more. Post-draft was the last one that did, and it
 * gave that up in Aug 2026 to become tier blocks like the other two.
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
  const rows = isPostDraft && tiers
    ? buildPostDraftTierRows(rosters, tiers)
    : useTieredLayout
      ? buildTieredRows(rosters, tiers!, draftRounds!)
      : buildSequentialRows(rosters, maxPlayers, tiers);

  const columnsInDraftOrder = !!ownerOrder && rosters.every((r) => ownerOrder.includes(r.ownerName));

  return { rosters, columnsInDraftOrder, rows };
}

/**
 * The footnote naming the draft whose order the columns run in, or undefined when the page
 * shouldn't claim one. The sentence lives here rather than in either renderer so the page
 * and its workbook can't word it differently or disagree about when it applies.
 *
 * End-of-season is excluded on purpose. Its columns *are* that season's draft order — it
 * reads the same post-draft snapshot the post-draft page does — but by January that draft is
 * months gone, and the order anyone reading a final roster has in mind is the next one's. A
 * true statement that invites the wrong reading is worse than no statement.
 */
export function columnOrderNote(snapshot: Snapshot, grid: RosterGrid): string | undefined {
  if (!grid.columnsInDraftOrder || snapshot.snapshotType === "end-of-season") return undefined;
  return `Column order is the ${snapshot.season} draft order.`;
}
