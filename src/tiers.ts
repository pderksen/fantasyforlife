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
    { label: "TIER 1", beforeRound: 1 },
    { label: "TIER 2", beforeRound: 6 },
    { label: "TIER 3", beforeRound: 11 },
  ],
};

export function getTierConfig(season: string, snapshotType: SnapshotType): TierConfig | undefined {
  return TIER_CONFIGS[`${season}:${snapshotType}`];
}
