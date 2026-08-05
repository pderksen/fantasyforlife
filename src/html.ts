import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Snapshot, SnapshotRoster, SnapshotPlayer, NavLink, TierConfig, ResolvedTradedPick } from "./types.js";
import { SNAPSHOT_TYPE_LABELS } from "./types.js";
import type { DraftOrder } from "./tiers.js";

/** Map of "Last, First" player name → draft round number */
export type DraftRoundLookup = Map<string, number>;

// ── Utility helpers ──

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

/** Trade dates are day-level facts; the time of day adds noise to a compact table. */
export function formatPacificDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shortLabel(link: NavLink): string {
  return SNAPSHOT_TYPE_LABELS[link.snapshotType].replace(" Rosters", "");
}

// ── Shared HTML fragments ──

const CELL = "border border-gray-300 px-2 py-1 whitespace-nowrap";
const TH = `${CELL} bg-gray-800 text-white sticky top-0`;
const PILL = "inline-block px-3.5 py-1.5 text-sm font-medium rounded-lg";
const PILL_LINK = `${PILL} text-gray-700 bg-gray-100 transition-colors hover:bg-gray-200 no-underline`;
const PILL_ACTIVE = `${PILL} text-gray-900 bg-gray-200`;
const SECTION_H2 = "text-base font-semibold text-gray-700 mb-5 mt-0";
const TP_TH = "text-left text-xs font-semibold uppercase tracking-wide text-gray-400 px-3 pb-2.5 border-b-2 border-gray-200";
const TP_TD = "px-3 py-2.5 border-b border-gray-100 text-gray-900";

function htmlHead(title: string, extraStyles = ""): string {
  return `<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
  <style type="text/tailwindcss">
    @theme {
      --font-sans: Inter, system-ui, -apple-system, sans-serif;
    }
  </style>${extraStyles ? `\n  <style>\n${extraStyles}  </style>` : ""}
</head>`;
}

// ── Roster table building ──

function playerCell(p: SnapshotPlayer | undefined): string {
  if (!p) return `      <td class="${CELL}"></td>`;
  const cls = `pos-${p.position.toLowerCase()}${p.keeper ? " keeper" : ""}`;
  return `      <td class="${CELL} ${cls}">${esc(p.name)} ${esc(p.team)} ${esc(p.position)}</td>`;
}

function tierRow(label: string, tierIndex: number, colSpan: number): string {
  return `    <tr class="tier tier-${tierIndex + 1}"><td colspan="${colSpan}">${esc(label)}</td></tr>`;
}

function dataRow(cells: string[]): string {
  return `    <tr>\n${cells.join("\n")}\n    </tr>`;
}

function buildSequentialRows(rosters: SnapshotRoster[], maxPlayers: number, tiers?: TierConfig): string[] {
  const tierAtRow = new Map<number, string>();
  if (tiers) {
    for (let i = 0; i < tiers.length; i++) {
      tierAtRow.set(tiers[i].beforeRound - 1, tierRow(tiers[i].label, i, rosters.length));
    }
  }

  const rows: string[] = [];
  for (let i = 0; i < maxPlayers; i++) {
    const tier = tierAtRow.get(i);
    if (tier) rows.push(tier);
    rows.push(dataRow(rosters.map((r) => playerCell(r.players[i]))));
  }
  return rows;
}

const POS_SORT_TAIL: Record<string, number> = { DEF: 1, K: 2 };

function buildTieredRows(
  rosters: SnapshotRoster[],
  tiers: TierConfig,
  draftRounds: DraftRoundLookup,
): string[] {
  const colSpan = rosters.length;
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

  const rows: string[] = [];
  for (let t = 0; t < tiers.length; t++) {
    const maxInTier = Math.max(...rosterBuckets.map((rb) => rb[t].length));
    if (maxInTier === 0) continue;
    rows.push(tierRow(tiers[t].label, t, colSpan));
    for (let i = 0; i < maxInTier; i++) {
      rows.push(dataRow(rosterBuckets.map((rb) => playerCell(rb[t][i]))));
    }
  }
  return rows;
}

function buildPostDraftRows(rosters: SnapshotRoster[], tiers?: TierConfig): string[] {
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

  const tierAtRound = new Map<number, string>();
  if (tiers) {
    for (let i = 0; i < tiers.length; i++) {
      tierAtRound.set(tiers[i].beforeRound, tierRow(tiers[i].label, i, rosters.length + 1));
    }
  }

  const rows: string[] = [];
  for (const round of sortedRounds) {
    const tier = tierAtRound.get(round);
    if (tier) rows.push(tier);

    const maxPicks = roundMaxPicks.get(round)!;
    const needsSuffix = maxPicks > 1;

    for (let slot = 0; slot < maxPicks; slot++) {
      const label = needsSuffix ? `${round}${String.fromCharCode(97 + slot)}` : `${round}`;
      const cells = [
        `      <td class="${CELL}">${label}</td>`,
        ...rosters.map((r) => {
          const roundPlayers = r.players.filter((p) => p.round === round);
          return playerCell(roundPlayers[slot]);
        }),
      ];
      rows.push(dataRow(cells));
    }
  }
  return rows;
}

// ── Traded picks table (shared by roster pages and index page) ──

function tradedPicksTable(picks: ResolvedTradedPick[]): string {
  // Captures taken before trade dates were tracked have none at all — drop the column
  // rather than print one full of placeholders.
  const showTradedOn = picks.some((p) => p.tradedOn);

  const headers = ["Season", "Round", "Original Owner", "Current Owner", ...(showTradedOn ? ["Traded On"] : [])]
    .map((h) => `<th class="${TP_TH}">${h}</th>`)
    .join("");
  const rows = picks
    .map((p) => {
      const cells = [p.season, `Round ${p.round}`, p.originalOwner, p.currentOwner]
        .map((v) => `<td class="${TP_TD}">${esc(v)}</td>`);
      if (showTradedOn) {
        cells.push(p.tradedOn
          ? `<td class="${TP_TD} whitespace-nowrap">${esc(formatPacificDate(p.tradedOn))}</td>`
          : `<td class="${TP_TD} text-gray-400">&mdash;</td>`);
      }
      return `      <tr>${cells.join("")}</tr>`;
    })
    .join("\n");
  return `  <div class="overflow-x-auto -mx-1">
  <table class="text-sm w-auto">
    <thead><tr>${headers}</tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
  </div>`;
}

function tradedPicksSection(tradedPicks?: ResolvedTradedPick[]): string {
  const heading = `  <h2 class="mt-8 mb-4 text-base font-semibold text-gray-700">Traded Picks</h2>`;
  if (!tradedPicks || tradedPicks.length === 0) {
    return `${heading}\n  <p class="text-sm text-gray-500">None</p>`;
  }
  return `${heading}\n${tradedPicksTable(tradedPicks)}`;
}

// ── Roster page styles ──

const ROSTER_STYLES = `    .pos-wr  { background: #d0e8ff; }
    .pos-rb  { background: #d0f0d0; }
    .pos-qb  { background: #ffc0cb; }
    .pos-te  { background: #ffe0b2; }
    .pos-def { background: #d2b48c; }
    .pos-k   { background: #e0d0f0; }
    /* Keepers. Declared after the position tints so it wins — same specificity, later
       rule. The position stays readable in the cell text. */
    .keeper  { background: #ffff00; }
    .tier td { font-weight: bold; color: white; text-align: left; font-size: 12px; letter-spacing: 1px; padding: 3px 8px; }
    .tier-1 td { background: #1a6b2a; }
    .tier-2 td { background: #8b6914; }
    .tier-3 td { background: #8b1a1a; }
`;

const ROUND_COL_STYLE = `    tr:not(.tier) > td:first-child { text-align: center; font-weight: bold; color: #888; width: 30px; }
`;

// ── Page generators ──

export function generateHtml(
  snapshot: Snapshot,
  navLinks: NavLink[] = [],
  ownerOrder?: string[],
  tiers?: TierConfig,
  draftRounds?: DraftRoundLookup,
  tradedPicks?: ResolvedTradedPick[],
): string {
  const typeLabel = SNAPSHOT_TYPE_LABELS[snapshot.snapshotType] ?? "Rosters";
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

  const headerCells = rosters
    .map((r) => `      <th class="${TH}">${esc(r.ownerName)}</th>`)
    .join("\n");

  const isPostDraft = snapshot.snapshotType === "post-draft" && rosters.some((r) => r.players.some((p) => p.round != null));
  const useTieredLayout = !isPostDraft && tiers && draftRounds && draftRounds.size > 0;
  const dataRows = isPostDraft
    ? buildPostDraftRows(rosters, tiers)
    : useTieredLayout
      ? buildTieredRows(rosters, tiers!, draftRounds!)
      : buildSequentialRows(rosters, maxPlayers, tiers);

  // Nav bar — current season links only
  let navHtml = "";
  if (navLinks.length > 0) {
    const items = navLinks
      .filter((l) => l.season === snapshot.season)
      .map((l) => {
        const label = shortLabel(l);
        return l.current
          ? `<span class="${PILL_ACTIVE}">${esc(label)}</span>`
          : `<a href="${esc(l.href)}" class="${PILL_LINK}">${esc(label)}</a>`;
      })
      .join("\n      ");
    navHtml = `  <nav class="flex flex-wrap items-center gap-2 mb-6">
      <a href="../index.html" class="${PILL_LINK}">Home</a>
      ${items}
    </nav>`;
  }

  const styles = ROSTER_STYLES + (isPostDraft ? ROUND_COL_STYLE : "");
  const roundTh = isPostDraft ? `      <th class="${TH}">Round</th>\n` : "";

  return `<!DOCTYPE html>
<html lang="en">
${htmlHead(`${snapshot.leagueName} - ${snapshot.season} ${typeLabel}`, styles)}
<body class="bg-gray-50 text-gray-900 font-sans antialiased">
  <div class="px-3 sm:px-5 pt-4 sm:pt-5 pb-10">
  <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900 mb-1">${esc(snapshot.season)} ${esc(typeLabel)}</h1>
  <div class="text-sm text-gray-500 mb-4">${esc(snapshot.leagueName)}</div>
${navHtml}
  <div class="overflow-x-auto">
  <table class="border-collapse bg-white text-xs">
    <tr>
${roundTh}${headerCells}
    </tr>
${dataRows.join("\n")}
  </table>
  </div>
${tradedPicksSection(tradedPicks)}
  <footer class="mt-8 text-xs text-gray-400">Data retrieved ${esc(formatPacificTime(snapshot.capturedAt))}</footer>
  </div>
</body>
</html>`;
}

export function generateIndexHtml(
  leagueName: string,
  navLinks: NavLink[],
  futureTradedPicks?: ResolvedTradedPick[],
  draftOrder?: DraftOrder,
): string {
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
      const hasPreDraft = links.some((l) => l.snapshotType === "pre-draft");

      const pills = links
        .map((l) => `<a href="${esc(l.href)}" class="${PILL_LINK}">${esc(shortLabel(l))}</a>`)
        .join("\n          ");

      const throwback = !hasPreDraft && links.length > 0
        ? `\n        <span class="text-xs font-medium bg-green-800 text-white rounded px-1.5 py-0.5 mr-auto ml-3">Throwback</span>`
        : "";

      const archiveLink = sortedSeasons.indexOf(season) === sortedSeasons.length - 1
        ? `\n      <div class="pb-4 border-b border-gray-100">
        <a href="https://docs.google.com/spreadsheets/d/16rS1aBhJR0xg7xzCQGEzE2_-8_wO9F1MFlMVSGpS4g8/pubhtml" target="_blank" rel="noopener noreferrer" class="text-sm text-blue-600 no-underline transition-colors hover:text-blue-800 hover:underline">
          Tiers 2006&ndash;2024 &#x2197;
        </a>
      </div>`
        : "";

      return `      <div class="flex flex-wrap items-center gap-y-2 py-4 border-b border-gray-100 first:border-t">
        <span class="text-xl font-semibold text-gray-900 min-w-[72px]">${esc(season)}</span>${throwback}
        <div class="flex gap-2 flex-wrap ml-auto">
          ${pills}
        </div>
      </div>${archiveLink}`;
    })
    .join("\n");

  // Draft order section
  let draftOrderHtml = "";
  if (draftOrder) {
    const rows = draftOrder.order
      .map((owner, i) =>
        `          <tr>
            <td class="px-3 py-2 border-b border-gray-100 text-gray-400 font-medium w-10">${i + 1}</td>
            <td class="px-3 py-2 border-b border-gray-100 text-gray-900">${esc(owner)}</td>
          </tr>`)
      .join("\n");
    draftOrderHtml = `
    <section class="mb-12">
      <h2 class="${SECTION_H2}">${esc(draftOrder.season)} Draft Order</h2>
      <table class="w-full text-sm"><tbody>
${rows}
      </tbody></table>
    </section>`;
  }

  // Traded picks section — always rendered, "None" when nothing is outstanding
  const tradedPicksBody = futureTradedPicks && futureTradedPicks.length > 0
    ? tradedPicksTable(futureTradedPicks)
    : `      <p class="text-sm text-gray-500">None</p>`;
  const tradedPicksHtml = `
    <section class="mb-12">
      <h2 class="${SECTION_H2}">Traded Picks</h2>
${tradedPicksBody}
    </section>`;

  const pastSeasonsHtml = `
    <section class="mb-12">
      <h2 class="${SECTION_H2}">Past Seasons</h2>
      <div class="py-4 border-b border-gray-100 first:border-t">
        <a href="https://sleeper.com/leagues" target="_blank" rel="noopener noreferrer" class="text-sm text-blue-600 no-underline transition-colors hover:text-blue-800 hover:underline">Seasons 2025+ on Sleeper &#x2197;</a>
        <div class="mt-1 text-sm text-gray-700">Go to Settings&nbsp;<svg xmlns="http://www.w3.org/2000/svg" class="inline w-4 h-4 align-text-bottom text-gray-500" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd"/></svg>&nbsp;&rsaquo; League History and Previous Leagues</div>
      </div>
      <div class="flex flex-wrap items-center gap-y-2 py-4 border-b border-gray-100">
        <a href="https://www42.myfantasyleague.com/2024/home/30136" target="_blank" rel="noopener noreferrer" class="text-sm text-blue-600 no-underline transition-colors hover:text-blue-800 hover:underline">Seasons 2006&ndash;2024 on MyFantasyLeague &#x2197;</a>
      </div>
    </section>`;

  return `<!DOCTYPE html>
<html lang="en">
${htmlHead(leagueName)}
<body class="bg-white text-gray-900 font-sans antialiased">
  <div class="max-w-2xl mx-auto px-4 sm:px-6 py-10 sm:py-20">
    <header class="text-center mb-10 sm:mb-16">
      <h1 class="text-3xl sm:text-4xl font-bold tracking-tight m-0 mb-1.5">${esc(leagueName)}</h1>
      <div class="text-sm text-gray-400 tracking-wide">est. 2006</div>
    </header>

    <section class="mb-12">
      <h2 class="${SECTION_H2}">Tiers</h2>
${seasonRows}
    </section>
${draftOrderHtml}
${tradedPicksHtml}
${pastSeasonsHtml}
  </div>
</body>
</html>`;
}

export async function writeHtml(html: string, outputPath: string): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, html, "utf-8");
}
