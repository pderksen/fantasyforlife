import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Snapshot, SnapshotRoster, SnapshotPlayer, NavLink, TierConfig, ResolvedTradedPick } from "./types.js";
import { SNAPSHOT_TYPE_LABELS } from "./types.js";

/** Map of "Last, First" player name → draft round number */
export type DraftRoundLookup = Map<string, number>;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function playerCell(p: { name: string; position: string; team: string } | undefined): string {
  if (!p) return "      <td></td>";
  const posClass = `pos-${p.position.toLowerCase()}`;
  const display = `${escapeHtml(p.name)} ${escapeHtml(p.team)} ${escapeHtml(p.position)}`;
  return `      <td class="${posClass}">${display}</td>`;
}

function tierRow(label: string, tierIndex: number, colSpan: number): string {
  return `    <tr class="tier tier-${tierIndex + 1}">\n      <td colspan="${colSpan}">${escapeHtml(label)}</td>\n    </tr>`;
}

function buildSequentialRows(rosters: SnapshotRoster[], maxPlayers: number, tiers?: TierConfig): string[] {
  // Build a map of "before row index" → tier row HTML
  const tierAtRow = new Map<number, string>();
  if (tiers) {
    for (let i = 0; i < tiers.length; i++) {
      // beforeRound is 1-based row index for sequential snapshots
      tierAtRow.set(tiers[i].beforeRound - 1, tierRow(tiers[i].label, i, rosters.length));
    }
  }

  const rows: string[] = [];
  for (let i = 0; i < maxPlayers; i++) {
    const tier = tierAtRow.get(i);
    if (tier) rows.push(tier);
    const cells = rosters.map((r) => playerCell(r.players[i])).join("\n");
    rows.push(`    <tr>\n${cells}\n    </tr>`);
  }
  return rows;
}

const POS_SORT_TAIL: Record<string, number> = { DEF: 1, K: 2 };

/**
 * Build rows for non-post-draft snapshots when tiered by draft round.
 * Players are grouped into tiers based on their draft round from the post-draft snapshot.
 * Undrafted players go into the last tier. Within the last tier, DEF and K sort to the bottom.
 */
function buildTieredRows(
  rosters: SnapshotRoster[],
  tiers: TierConfig,
  draftRounds: DraftRoundLookup,
): string[] {
  const colSpan = rosters.length;

  // Compute tier round ranges: tier i covers [tiers[i].beforeRound, tiers[i+1].beforeRound)
  // The last tier covers [tiers[last].beforeRound, Infinity) plus undrafted
  const tierRanges: Array<{ min: number; max: number }> = [];
  for (let i = 0; i < tiers.length; i++) {
    const min = tiers[i].beforeRound;
    const max = i + 1 < tiers.length ? tiers[i + 1].beforeRound : Infinity;
    tierRanges.push({ min, max });
  }

  // Classify a player into a tier index
  function getTierIndex(p: SnapshotPlayer): number {
    const round = draftRounds.get(p.name);
    if (round == null) return tiers.length - 1; // undrafted → last tier
    for (let i = 0; i < tierRanges.length; i++) {
      if (round >= tierRanges[i].min && round < tierRanges[i].max) return i;
    }
    return tiers.length - 1;
  }

  // Sort key for a player within a tier
  function playerSortKey(p: SnapshotPlayer, tierIdx: number): number {
    const round = draftRounds.get(p.name);
    const isLastTier = tierIdx === tiers.length - 1;

    // In the last tier, DEF and K always go to the bottom
    if (isLastTier && POS_SORT_TAIL[p.position]) {
      return 90000 + POS_SORT_TAIL[p.position] * 1000;
    }

    if (round != null) return round;
    // Undrafted (last tier only): after drafted players, before DEF/K
    return 80000;
  }

  // For each roster, split players into tier buckets and sort each bucket
  const rosterTierBuckets: SnapshotPlayer[][][] = rosters.map((r) => {
    const buckets: SnapshotPlayer[][] = tiers.map(() => []);
    for (const p of r.players) {
      buckets[getTierIndex(p)].push(p);
    }
    // Sort each bucket
    for (let t = 0; t < buckets.length; t++) {
      buckets[t].sort((a, b) => playerSortKey(a, t) - playerSortKey(b, t));
    }
    return buckets;
  });

  // Build rows tier by tier
  const rows: string[] = [];
  for (let t = 0; t < tiers.length; t++) {
    // Max players any roster has in this tier
    const maxInTier = Math.max(...rosterTierBuckets.map((rb) => rb[t].length));
    if (maxInTier === 0) continue;

    // Tier header row
    rows.push(tierRow(tiers[t].label, t, colSpan));

    // Player rows for this tier
    for (let i = 0; i < maxInTier; i++) {
      const cells = rosterTierBuckets
        .map((rb) => playerCell(rb[t][i]))
        .join("\n");
      rows.push(`    <tr>\n${cells}\n    </tr>`);
    }
  }

  return rows;
}

function buildPostDraftRows(rosters: SnapshotRoster[], tiers?: TierConfig): string[] {
  // Collect all rounds across all rosters
  const allRounds = new Set<number>();
  for (const r of rosters) {
    for (const p of r.players) {
      if (p.round != null) allRounds.add(p.round);
    }
  }
  const sortedRounds = [...allRounds].sort((a, b) => a - b);

  // For each round, find max picks any owner has
  const roundMaxPicks = new Map<number, number>();
  for (const round of sortedRounds) {
    let max = 1;
    for (const r of rosters) {
      const count = r.players.filter((p) => p.round === round).length;
      if (count > max) max = count;
    }
    roundMaxPicks.set(round, max);
  }

  // Build a map of "before round number" → tier row HTML
  // colspan = rosters + 1 for the Rnd column
  const tierAtRound = new Map<number, string>();
  if (tiers) {
    for (let i = 0; i < tiers.length; i++) {
      tierAtRound.set(tiers[i].beforeRound, tierRow(tiers[i].label, i, rosters.length + 1));
    }
  }

  // Build row labels and map picks
  const rows: string[] = [];
  for (const round of sortedRounds) {
    // Insert tier row before this round if configured
    const tier = tierAtRound.get(round);
    if (tier) rows.push(tier);

    const maxPicks = roundMaxPicks.get(round)!;
    const needsSuffix = maxPicks > 1;

    for (let slot = 0; slot < maxPicks; slot++) {
      const label = needsSuffix
        ? `${round}${String.fromCharCode(97 + slot)}`  // 97 = 'a'
        : `${round}`;

      const cells = rosters.map((r) => {
        const roundPlayers = r.players.filter((p) => p.round === round);
        return playerCell(roundPlayers[slot]);
      }).join("\n");

      rows.push(`    <tr>\n      <td>${label}</td>\n${cells}\n    </tr>`);
    }
  }

  return rows;
}

function tradedPicksSection(tradedPicks?: ResolvedTradedPick[], title = "Traded Picks"): string {
  const heading = `  <h3 style="margin-top:24px;">${escapeHtml(title)}</h3>`;
  if (!tradedPicks || tradedPicks.length === 0) {
    return `${heading}\n  <p class="meta">None</p>`;
  }
  const rows = tradedPicks
    .map((p) =>
      `    <tr><td>${escapeHtml(p.season)}</td><td>Rnd ${p.round}</td><td>${escapeHtml(p.originalOwner)}</td><td>${escapeHtml(p.currentOwner)}</td></tr>`)
    .join("\n");
  return `${heading}
  <table class="traded-picks">
    <tr><th>Season</th><th>Round</th><th>Original Owner</th><th>Current Owner</th></tr>
${rows}
  </table>`;
}

export function generateHtml(snapshot: Snapshot, navLinks: NavLink[] = [], ownerOrder?: string[], tiers?: TierConfig, draftRounds?: DraftRoundLookup, tradedPicks?: ResolvedTradedPick[]): string {
  const typeLabel = SNAPSHOT_TYPE_LABELS[snapshot.snapshotType] ?? "Rosters";
  // Sort rosters by draft order if available, otherwise alphabetically
  const rosters = [...snapshot.rosters].sort((a, b) => {
    if (ownerOrder) {
      const idxA = ownerOrder.indexOf(a.ownerName);
      const idxB = ownerOrder.indexOf(b.ownerName);
      // Owners not in the order list go to the end, sorted alphabetically
      if (idxA >= 0 && idxB >= 0) return idxA - idxB;
      if (idxA >= 0) return -1;
      if (idxB >= 0) return 1;
    }
    return a.ownerName.localeCompare(b.ownerName);
  });
  const maxPlayers = Math.max(...rosters.map((r) => r.players.length));

  // Build header row
  const headerCells = rosters
    .map((r) => `      <th>${escapeHtml(r.ownerName)}</th>`)
    .join("\n");

  // Build data rows
  const isPostDraft = snapshot.snapshotType === "post-draft" && rosters.some((r) => r.players.some((p) => p.round != null));
  const useTieredLayout = !isPostDraft && tiers && draftRounds && draftRounds.size > 0;
  const dataRows: string[] = isPostDraft
    ? buildPostDraftRows(rosters, tiers)
    : useTieredLayout
      ? buildTieredRows(rosters, tiers!, draftRounds!)
      : buildSequentialRows(rosters, maxPlayers, tiers);

  // Build nav bar
  let navHtml = "";
  if (navLinks.length > 1) {
    // Group by season
    const seasons = new Map<string, NavLink[]>();
    for (const link of navLinks) {
      const group = seasons.get(link.season) ?? [];
      group.push(link);
      seasons.set(link.season, group);
    }

    const seasonBlocks: string[] = [];
    for (const [season, links] of seasons) {
      const items = links
        .map((l) => {
          const shortLabel = SNAPSHOT_TYPE_LABELS[l.snapshotType]
            .replace(" Rosters", "");
          if (l.current) {
            return `<span class="nav-current">${escapeHtml(shortLabel)}</span>`;
          }
          return `<a href="${escapeHtml(l.href)}">${escapeHtml(shortLabel)}</a>`;
        })
        .join("");
      seasonBlocks.push(`<span class="nav-season">${escapeHtml(season)}</span>${items}`);
    }
    navHtml = `  <nav class="nav"><a href="../index.html">Home</a><span class="nav-sep"></span>${seasonBlocks.join('<span class="nav-sep"></span>')}</nav>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(snapshot.leagueName)} - ${escapeHtml(snapshot.season)} ${escapeHtml(typeLabel)}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      margin: 20px;
      background: #f5f5f5;
    }
    h1 { margin-bottom: 4px; }
    .meta { color: #666; margin-bottom: 16px; }
    .nav {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 16px;
      font-size: 13px;
    }
    .nav-season {
      font-weight: 600;
      color: #444;
      margin-left: 4px;
    }
    .nav-season:first-child { margin-left: 0; }
    .nav a {
      color: #2a5a8a;
      text-decoration: none;
      padding: 2px 8px;
      border-radius: 3px;
    }
    .nav a:hover {
      background: #e0e8f0;
      text-decoration: underline;
    }
    .nav-current {
      color: #333;
      font-weight: 600;
      padding: 2px 8px;
      background: #d8e2ec;
      border-radius: 3px;
    }
    .nav-sep {
      width: 1px;
      height: 16px;
      background: #ccc;
      margin: 0 6px;
    }
    table {
      border-collapse: collapse;
      background: white;
      font-size: 13px;
    }
    th, td {
      border: 1px solid #ccc;
      padding: 4px 8px;
      white-space: nowrap;
    }
    th {
      background: #333;
      color: white;
      position: sticky;
      top: 0;
    }
    .tier td {
      font-weight: bold;
      color: white;
      text-align: left;
      font-size: 12px;
      letter-spacing: 1px;
      padding: 3px 8px;
    }
    .tier-1 td { background: #1a6b2a; }
    .tier-2 td { background: #8b6914; }
    .tier-3 td { background: #8b1a1a; }
${isPostDraft ? `    tr:not(.tier) > td:first-child {
      text-align: center;
      font-weight: bold;
      color: #888;
      width: 30px;
    }` : ""}
    .pos-wr  { background: #d0e8ff; }
    .pos-rb  { background: #d0f0d0; }
    .pos-qb  { background: #ffc0cb; }
    .pos-te  { background: #ffe0b2; }
    .pos-def { background: #d2b48c; }
    .pos-k   { background: #e0d0f0; }
    .traded-picks { margin-top: 8px; }
    .traded-picks th { background: #555; }
  </style>
</head>
<body>
  <h1>${escapeHtml(snapshot.leagueName)}</h1>
  <h2>${escapeHtml(snapshot.season)} ${escapeHtml(typeLabel)}</h2>
${navHtml}
  <div class="meta">Captured ${escapeHtml(snapshot.capturedAt)}</div>
  <table>
    <tr>
${isPostDraft ? '      <th>Rnd</th>\n' : ''}${headerCells}
    </tr>
${dataRows.join("\n")}
  </table>
${tradedPicksSection(tradedPicks)}
</body>
</html>`;
}

export function generateIndexHtml(leagueName: string, navLinks: NavLink[], futureTradedPicks?: ResolvedTradedPick[]): string {
  // Group by season (most recent first)
  const seasons = new Map<string, NavLink[]>();
  for (const link of navLinks) {
    const group = seasons.get(link.season) ?? [];
    group.push(link);
    seasons.set(link.season, group);
  }
  const sortedSeasons = [...seasons.keys()].sort().reverse();

  const seasonRows = sortedSeasons
    .map((season) => {
      const links = seasons.get(season)!;
      const items = links
        .map((l) => {
          const shortLabel = SNAPSHOT_TYPE_LABELS[l.snapshotType].replace(" Rosters", "");
          return `<a href="${escapeHtml(l.href)}">${escapeHtml(shortLabel)}</a>`;
        })
        .join("");
      return `    <div class="season"><span class="year">${escapeHtml(season)}</span>${items}</div>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(leagueName)}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      margin: 40px 20px;
      background: #f5f5f5;
    }
    h1 { margin-bottom: 24px; }
    .seasons { display: flex; flex-direction: column; gap: 8px; }
    .season {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 14px;
    }
    .year {
      font-weight: 600;
      color: #444;
      min-width: 48px;
    }
    .season a {
      color: #2a5a8a;
      text-decoration: none;
      padding: 3px 10px;
      border-radius: 3px;
    }
    .season a:hover {
      background: #e0e8f0;
      text-decoration: underline;
    }
    .traded-picks { margin-top: 8px; }
    .traded-picks th {
      background: #555;
      color: white;
      border: 1px solid #ccc;
      padding: 4px 8px;
      white-space: nowrap;
    }
    .traded-picks td {
      border: 1px solid #ccc;
      padding: 4px 8px;
      white-space: nowrap;
      background: white;
    }
    table { border-collapse: collapse; font-size: 13px; }
  </style>
</head>
<body>
  <h1>${escapeHtml(leagueName)}</h1>
  <div class="seasons">
${seasonRows}
  </div>
${futureTradedPicks && futureTradedPicks.length > 0 ? tradedPicksSection(futureTradedPicks) : ''}
</body>
</html>`;
}

export async function writeHtml(
  html: string,
  outputPath: string
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, html, "utf-8");
}
