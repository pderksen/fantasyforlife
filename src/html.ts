import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Snapshot, SnapshotRoster, SnapshotPlayer, NavLink, TierConfig, ResolvedTradedPick } from "./types.js";
import { SNAPSHOT_TYPE_LABELS } from "./types.js";
import type { DraftOrder } from "./tiers.js";

/** Map of "Last, First" player name → draft round number */
export type DraftRoundLookup = Map<string, number>;

function formatPacificTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }) + " PT";
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function playerCell(p: { name: string; position: string; team: string } | undefined): string {
  if (!p) return `      <td class="border border-gray-300 px-2 py-1 whitespace-nowrap"></td>`;
  const posClass = `pos-${p.position.toLowerCase()}`;
  const display = `${escapeHtml(p.name)} ${escapeHtml(p.team)} ${escapeHtml(p.position)}`;
  return `      <td class="border border-gray-300 px-2 py-1 whitespace-nowrap ${posClass}">${display}</td>`;
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

      rows.push(`    <tr>\n      <td class="border border-gray-300 px-2 py-1 whitespace-nowrap">${label}</td>\n${cells}\n    </tr>`);
    }
  }

  return rows;
}

function tradedPicksSection(tradedPicks?: ResolvedTradedPick[], title = "Traded Picks"): string {
  const heading = `  <h3 class="mt-6 text-lg font-semibold text-gray-900">${escapeHtml(title)}</h3>`;
  if (!tradedPicks || tradedPicks.length === 0) {
    return `${heading}\n  <p class="text-sm text-gray-500">None</p>`;
  }
  const rows = tradedPicks
    .map((p) =>
      `    <tr><td class="px-2 py-1.5 border-b border-gray-100 text-sm text-gray-900">${escapeHtml(p.season)}</td><td class="px-2 py-1.5 border-b border-gray-100 text-sm text-gray-900">Round ${p.round}</td><td class="px-2 py-1.5 border-b border-gray-100 text-sm text-gray-900">${escapeHtml(p.originalOwner)}</td><td class="px-2 py-1.5 border-b border-gray-100 text-sm text-gray-900">${escapeHtml(p.currentOwner)}</td></tr>`)
    .join("\n");
  return `${heading}
  <table class="mt-2 w-full">
    <tr><th class="text-left text-xs font-semibold uppercase tracking-wide text-gray-400 px-2 pb-2 border-b-2 border-gray-200">Season</th><th class="text-left text-xs font-semibold uppercase tracking-wide text-gray-400 px-2 pb-2 border-b-2 border-gray-200">Round</th><th class="text-left text-xs font-semibold uppercase tracking-wide text-gray-400 px-2 pb-2 border-b-2 border-gray-200">Original Owner</th><th class="text-left text-xs font-semibold uppercase tracking-wide text-gray-400 px-2 pb-2 border-b-2 border-gray-200">Current Owner</th></tr>
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
    .map((r) => `      <th class="border border-gray-300 px-2 py-1 whitespace-nowrap bg-gray-800 text-white sticky top-0">${escapeHtml(r.ownerName)}</th>`)
    .join("\n");

  // Build data rows
  const isPostDraft = snapshot.snapshotType === "post-draft" && rosters.some((r) => r.players.some((p) => p.round != null));
  const useTieredLayout = !isPostDraft && tiers && draftRounds && draftRounds.size > 0;
  const dataRows: string[] = isPostDraft
    ? buildPostDraftRows(rosters, tiers)
    : useTieredLayout
      ? buildTieredRows(rosters, tiers!, draftRounds!)
      : buildSequentialRows(rosters, maxPlayers, tiers);

  // Build nav bar — only links for the current season
  let navHtml = "";
  if (navLinks.length > 0) {
    const currentSeasonLinks = navLinks.filter((l) => l.season === snapshot.season);
    const navItems = currentSeasonLinks
      .map((l) => {
        const shortLabel = SNAPSHOT_TYPE_LABELS[l.snapshotType].replace(" Rosters", "");
        if (l.current) {
          return `<span class="inline-block px-3.5 py-1.5 text-sm font-medium text-gray-900 bg-gray-200 rounded-lg">${escapeHtml(shortLabel)}</span>`;
        }
        return `<a href="${escapeHtml(l.href)}" class="inline-block px-3.5 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg transition-colors hover:bg-gray-200 no-underline">${escapeHtml(shortLabel)}</a>`;
      })
      .join("\n      ");
    navHtml = `  <nav class="flex items-center gap-2 mb-6">
      <a href="../index.html" class="inline-block px-3.5 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg transition-colors hover:bg-gray-200 no-underline">Home</a>
      ${navItems}
    </nav>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(snapshot.leagueName)} - ${escapeHtml(snapshot.season)} ${escapeHtml(typeLabel)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: {
            sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
          },
        },
      },
    }
  </script>
  <style>
    /* Position colors */
    .pos-wr  { background: #d0e8ff; }
    .pos-rb  { background: #d0f0d0; }
    .pos-qb  { background: #ffc0cb; }
    .pos-te  { background: #ffe0b2; }
    .pos-def { background: #d2b48c; }
    .pos-k   { background: #e0d0f0; }
    /* Tier colors */
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
${isPostDraft ? `    /* Round label column */
    tr:not(.tier) > td:first-child {
      text-align: center;
      font-weight: bold;
      color: #888;
      width: 30px;
    }` : ""}
  </style>
</head>
<body class="bg-gray-50 text-gray-900 font-sans antialiased p-5">
  <h1 class="text-3xl font-bold tracking-tight text-gray-900 mb-1">${escapeHtml(snapshot.season)} ${escapeHtml(typeLabel)}</h1>
  <div class="text-sm text-gray-500 mb-4">${escapeHtml(snapshot.leagueName)}</div>
${navHtml}
  <table class="border-collapse bg-white text-xs">
    <tr>
${isPostDraft ? '      <th class="border border-gray-300 px-2 py-1 whitespace-nowrap bg-gray-800 text-white sticky top-0">Round</th>\n' : ''}${headerCells}
    </tr>
${dataRows.join("\n")}
  </table>
${tradedPicksSection(tradedPicks)}
  <footer class="mt-8 text-xs text-gray-400">Data retrieved ${escapeHtml(formatPacificTime(snapshot.capturedAt))}</footer>
</body>
</html>`;
}

export function generateIndexHtml(leagueName: string, navLinks: NavLink[], futureTradedPicks?: ResolvedTradedPick[], draftOrder?: DraftOrder): string {
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
      const linkTypes = new Set(links.map((l) => l.snapshotType));
      const hasPreDraft = linkTypes.has("pre-draft");

      const pills = links
        .map((l) => {
          const shortLabel = SNAPSHOT_TYPE_LABELS[l.snapshotType].replace(" Rosters", "");
          return `<a href="${escapeHtml(l.href)}" class="inline-block px-3.5 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg transition-colors hover:bg-gray-200 no-underline">${escapeHtml(shortLabel)}</a>`;
        })
        .join("\n          ");

      // Show "Throwback Year" label if this season has snapshots but no pre-draft
      const throwbackLabel = !hasPreDraft && links.length > 0
        ? `<span class="text-xs text-amber-700 mr-auto pl-1">Throwback Year</span>`
        : "";

      return `      <div class="flex items-center py-4 border-b border-gray-100 first:border-t">
        <span class="text-xl font-semibold text-gray-900 min-w-[72px]">${escapeHtml(season)}</span>
        ${throwbackLabel}
        <div class="flex gap-2 flex-wrap ml-auto">
          ${pills}
        </div>
      </div>`;
    })
    .join("\n");

  // Draft order section
  let draftOrderHtml = "";
  if (draftOrder) {
    const draftRows = draftOrder.order
      .map((owner, i) =>
        `          <tr>
            <td class="px-3 py-2 border-b border-gray-100 text-gray-400 font-medium w-10">${i + 1}</td>
            <td class="px-3 py-2 border-b border-gray-100 text-gray-900">${escapeHtml(owner)}</td>
          </tr>`)
      .join("\n");
    draftOrderHtml = `
    <section class="mb-12">
      <h2 class="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-5">${escapeHtml(draftOrder.season)} Draft Order</h2>
      <table class="w-full text-sm">
        <tbody>
${draftRows}
        </tbody>
      </table>
    </section>`;
  }

  // Traded picks table (built inline to avoid touching the shared helper)
  let tradedPicksHtml = "";
  if (futureTradedPicks && futureTradedPicks.length > 0) {
    const tpRows = futureTradedPicks
      .map((p) =>
        `          <tr>
            <td class="px-3 py-2.5 border-b border-gray-100 text-gray-900">${escapeHtml(p.season)}</td>
            <td class="px-3 py-2.5 border-b border-gray-100 text-gray-900">Round ${p.round}</td>
            <td class="px-3 py-2.5 border-b border-gray-100 text-gray-900">${escapeHtml(p.originalOwner)}</td>
            <td class="px-3 py-2.5 border-b border-gray-100 text-gray-900">${escapeHtml(p.currentOwner)}</td>
          </tr>`)
      .join("\n");
    tradedPicksHtml = `
    <section class="mb-12">
      <h2 class="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-5">Traded Picks</h2>
      <table class="w-full text-sm">
        <thead>
          <tr>
            <th class="text-left text-xs font-semibold uppercase tracking-wide text-gray-400 px-3 pb-2.5 border-b-2 border-gray-200">Season</th>
            <th class="text-left text-xs font-semibold uppercase tracking-wide text-gray-400 px-3 pb-2.5 border-b-2 border-gray-200">Round</th>
            <th class="text-left text-xs font-semibold uppercase tracking-wide text-gray-400 px-3 pb-2.5 border-b-2 border-gray-200">Original Owner</th>
            <th class="text-left text-xs font-semibold uppercase tracking-wide text-gray-400 px-3 pb-2.5 border-b-2 border-gray-200">Current Owner</th>
          </tr>
        </thead>
        <tbody>
${tpRows}
        </tbody>
      </table>
    </section>`;
  }

  // Archive link (always shown)
  const archiveHtml = `
    <div class="pt-2">
      <a href="https://docs.google.com/spreadsheets/d/16rS1aBhJR0xg7xzCQGEzE2_-8_wO9F1MFlMVSGpS4g8/pubhtml" target="_blank" rel="noopener noreferrer" class="text-lg font-medium text-blue-600 no-underline transition-colors hover:text-blue-800 hover:underline">
        Seasons 2006&ndash;2024 &#x2197;
      </a>
    </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(leagueName)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: {
            sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
          },
        },
      },
    }
  </script>
</head>
<body class="bg-white text-gray-900 font-sans antialiased">
  <div class="max-w-2xl mx-auto px-6 py-20">
    <header class="text-center mb-16">
      <h1 class="text-4xl font-bold tracking-tight m-0 mb-1.5">${escapeHtml(leagueName)}</h1>
      <div class="text-sm text-gray-400 tracking-wide">est. 2006</div>
    </header>

    <section class="mb-12">
      <h2 class="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-5">Current Tiers by Season</h2>
${seasonRows}
    </section>
${draftOrderHtml}
${tradedPicksHtml}
${archiveHtml}
    <footer class="pt-8"></footer>
  </div>
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
