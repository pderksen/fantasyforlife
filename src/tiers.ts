import type { SnapshotType, TierConfig } from "./types.js";

/**
 * Tier configurations keyed by "season:snapshotType".
 * Each entry lists tier breaks — the tier label row is inserted right above
 * the specified round (post-draft) or 1-based row index (pre-draft/end-of-season).
 */
const TIER_CONFIGS: Record<string, TierConfig> = {
  "2025:post-draft": [
    { label: "TIER 1", beforeRound: 1 },
    { label: "TIER 2", beforeRound: 6 },
    { label: "TIER 3", beforeRound: 11 },
  ],
  "2025:end-of-season": [
    { label: "TIER 1 — Drafted Rounds 1–5", beforeRound: 1 },
    { label: "TIER 2 — Drafted Rounds 6–10", beforeRound: 6 },
    { label: "TIER 3 — Drafted Rounds 11+ / Free Agency", beforeRound: 11 },
  ],
  // Pre-draft rosters are the prior season's carryover, so these rounds are 2025's.
  // The page is headed 2026, so the labels name the year to keep that unambiguous.
  "2026:pre-draft": [
    { label: "TIER 1 — Drafted Rounds 1–5 (2025)", beforeRound: 1 },
    { label: "TIER 2 — Drafted Rounds 6–10 (2025)", beforeRound: 6 },
    { label: "TIER 3 — Drafted Rounds 11+ / Free Agency (2025)", beforeRound: 11 },
  ],
};

export function getTierConfig(season: string, snapshotType: SnapshotType): TierConfig | undefined {
  return TIER_CONFIGS[`${season}:${snapshotType}`];
}

/**
 * Draft order for upcoming season, displayed on the index page.
 * Only one season shown at a time — update each year with the new order.
 * Keyed by season string.
 */
export interface DraftOrder {
  season: string;
  order: string[];  // owner names in pick order (index 0 = pick 1)
}

const DRAFT_ORDERS: Record<string, string[]> = {
  "2026": [
    "Lemoore Liberators",
    "Easton Evil Empire",
    "Clovis Jets",
    "South Town FF",
    "Kingsburg Killaz",
    "Riverstone Stoners",
    "Dinkey Creek Dirt Clods",
    "Vancouver Moose Drool",
    "Sanger Squatty Pottys",
    "Visalia Viagra Vipers",
  ],
};

/** Configured pick order for one season, or undefined if that season has none. */
export function getDraftOrder(season: string): string[] | undefined {
  return DRAFT_ORDERS[season];
}

/** Returns the most recent draft order config, or undefined if none exist. */
export function getLatestDraftOrder(): DraftOrder | undefined {
  const seasons = Object.keys(DRAFT_ORDERS).sort().reverse();
  if (seasons.length === 0) return undefined;
  const season = seasons[0];
  return { season, order: DRAFT_ORDERS[season] };
}
