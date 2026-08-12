import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Snapshot, SnapshotType, SnapshotRoster, SnapshotPlayer, NavLink, TierConfig, ResolvedTradedPick } from "./types.js";
import { SNAPSHOT_TYPE_LABELS } from "./types.js";
import type { DraftOrder } from "./tiers.js";
import { buildRosterGrid, type DraftRoundLookup, type GridRow } from "./roster-grid.js";
import { exportFileName } from "./snapshot.js";

// ── Utility helpers ──

export function formatPacificTime(isoString: string): string {
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

// ── Shared HTML fragments ──

const CELL = "border border-gray-300 px-2 py-1 whitespace-nowrap";
const TH = `${CELL} bg-gray-800 text-white sticky top-0 z-10`;
/**
 * Roster table wrapper. The max-height is what makes `sticky top-0` on the header work:
 * an overflow container is the scrollport its sticky descendants pin to, so without a
 * height cap the box never scrolls vertically and the header never sticks. 10rem is the
 * block above the table (page padding + h1 + league name + nav), so the box runs to the
 * bottom of the viewport. Horizontal scrolling on mobile is unchanged.
 */
const TABLE_WRAP = "overflow-auto max-h-[calc(100dvh_-_10rem)]";
const PILL_BOX = "px-3.5 py-1.5 text-sm font-medium rounded-lg";
const PILL = `inline-block ${PILL_BOX}`;
/** Colors only, so a pill that needs a different `display` can borrow them without a conflict. */
const PILL_LINK_COLORS = "text-gray-700 bg-gray-100 transition-colors hover:bg-gray-200 no-underline";
const PILL_LINK = `${PILL} ${PILL_LINK_COLORS}`;
const PILL_ACTIVE = `${PILL} text-gray-900 bg-gray-200`;
/**
 * Index-page chip for the newest tiers that exist. Still a link (unlike `PILL_ACTIVE`,
 * which marks the page you are already on), so it needs a hover state.
 */
const PILL_LATEST = `${PILL} text-white bg-gray-900 transition-colors hover:bg-gray-700 no-underline`;
/**
 * The Excel export pill. `inline-flex` replaces `inline-block` rather than joining it — two
 * `display` utilities on one element resolve by stylesheet order, not attribute order, so
 * whichever Tailwind emits last would win silently.
 */
const PILL_EXPORT = `inline-flex items-center gap-1.5 ${PILL_BOX} ${PILL_LINK_COLORS} ml-auto`;
const SECTION_H2 = "text-base font-semibold text-gray-700 mb-5 mt-0";
const TP_TH = "text-left text-xs font-semibold uppercase tracking-wide text-gray-400 px-3 pb-2.5 border-b-2 border-gray-200";
const TP_TD = "px-3 py-2.5 border-b border-gray-100 text-gray-900";

/** Link-preview copy per snapshot type. Kept next to the labels it mirrors. */
const OG_DESCRIPTIONS: Record<SnapshotType, (season: string) => string> = {
  "pre-draft": (s) => `Carryover rosters with keepers flagged, captured before the ${s} draft.`,
  "post-draft": (s) => `Every roster as drafted in ${s}, by round.`,
  "end-of-season": (s) => `Final ${s} rosters after NFL Week 18.`,
};

interface HeadOptions {
  /** Browser tab / search result title. */
  title: string;
  /** og:title. Defaults to `title`; set it when the tab title carries the league name and the preview card shouldn't repeat it. */
  ogTitle?: string;
  description: string;
  siteName: string;
  extraStyles?: string;
}

/**
 * `noindex` is deliberate — the pages are public URLs but the league's rosters
 * shouldn't be Googleable. It is a meta tag rather than a robots.txt `Disallow`
 * on purpose: disallowing only blocks the fetch, and a URL someone links to can
 * still be listed with no snippet because the crawler never saw a directive.
 * Staying crawlable is what lets `noindex` actually be read and obeyed. The
 * Open Graph tags are unaffected — chat and social unfurlers don't honor robots
 * rules, so previews still render.
 *
 * No favicon by choice; browsers 404 on `/favicon.ico` and move on.
 */
function htmlHead({ title, ogTitle, description, siteName, extraStyles = "" }: HeadOptions): string {
  return `<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <meta name="robots" content="noindex, nofollow">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${esc(siteName)}">
  <meta property="og:title" content="${esc(ogTitle ?? title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta name="twitter:card" content="summary">
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

/** Render a built grid's rows as table markup. Layout decisions all live in `roster-grid.ts`. */
function renderGridRows(rows: GridRow[], colSpan: number, hasRoundColumn: boolean): string[] {
  return rows.map((row) => {
    if (row.kind === "tier") return tierRow(row.label, row.tierIndex, colSpan);
    const roundCell = hasRoundColumn ? [`      <td class="${CELL}">${esc(row.label ?? "")}</td>`] : [];
    return dataRow([...roundCell, ...row.cells.map(playerCell)]);
  });
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

/**
 * Legend for the yellow keeper highlight, shown under the roster table.
 *
 * Rendered only when a cell actually carries the class. `.keeper` ships in `ROSTER_STYLES`
 * on every roster page but only pre-draft snapshots set the flag (`snapshot.ts` clears the
 * keeper id set for other types), so keying off the data keeps the legend off pages with
 * nothing highlighted, and picks it up automatically if another type ever flags keepers.
 * The swatch reuses the `.keeper` class rather than repeating the hex. Carries its own leading
 * newline so pages without keepers emit nothing at all, not a blank line.
 */
function keeperLegend(rosters: SnapshotRoster[]): string {
  const hasKeepers = rosters.some((r) => r.players.some((p) => p.keeper));
  if (!hasKeepers) return "";
  return `
  <p class="mt-3 flex items-center gap-2 text-xs text-gray-600">
    <span class="keeper inline-block w-3.5 h-3.5 rounded-sm border border-gray-400"></span>
    Keeper
  </p>`;
}

function tradedPicksSection(tradedPicks?: ResolvedTradedPick[]): string {
  const heading = `  <h2 class="mt-8 mb-4 text-base font-semibold text-gray-700">Traded Picks</h2>`;
  if (!tradedPicks || tradedPicks.length === 0) {
    return `${heading}\n  <p class="text-sm text-gray-500">None</p>`;
  }
  return `${heading}\n${tradedPicksTable(tradedPicks)}`;
}

// ── Shared page furniture ──

/** Heroicons `arrow-down-tray`, inlined — the project ships no icon font or sprite. */
const DOWNLOAD_ICON = `<svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M10 3a.75.75 0 0 1 .75.75v7.19l2.22-2.22a.75.75 0 1 1 1.06 1.06l-3.5 3.5a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 1 1 1.06-1.06l2.22 2.22V3.75A.75.75 0 0 1 10 3Z"/><path d="M3.75 12.5a.75.75 0 0 1 .75.75v1.25c0 .414.336.75.75.75h9.5a.75.75 0 0 0 .75-.75v-1.25a.75.75 0 0 1 1.5 0v1.25A2.25 2.25 0 0 1 14.75 16.75h-9.5A2.25 2.25 0 0 1 3 14.5v-1.25a.75.75 0 0 1 .75-.75Z"/></svg>`;

/**
 * Nav bar for a season's pages: Home, that season's chips, then the Excel export pushed to
 * the right. The export sits here rather than under the table so it is reachable without
 * scrolling past a full roster, and wears the same pill as its neighbours so it stays quiet.
 */
function navBar(navLinks: NavLink[], season: string, exportHref: string): string {
  const items = navLinks
    .filter((l) => l.season === season)
    .map((l) => l.current
      ? `<span class="${PILL_ACTIVE}">${esc(l.chip)}</span>`
      : `<a href="${esc(l.href)}" class="${PILL_LINK}">${esc(l.chip)}</a>`)
    .join("\n      ");
  return `  <nav class="flex flex-wrap items-center gap-2 mb-6">
      <a href="../index.html" class="${PILL_LINK}">Home</a>
      ${items}
      <a href="${esc(exportHref)}" download class="${PILL_EXPORT}" title="Download this page as an Excel workbook">${DOWNLOAD_ICON}Excel</a>
    </nav>`;
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
    /* Sticky header. border-collapse hands cell borders to the table, so a pinned th
       loses its own borders mid-scroll and the row reads as one merged dark bar.
       Redraw the right and bottom edges as a shadow, which travels with the cell. */
    th.sticky { box-shadow: inset -1px 0 #d1d5db, 0 1px 0 #d1d5db; }
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
  const { rosters, hasRoundColumn, rows } = buildRosterGrid(snapshot, ownerOrder, tiers, draftRounds);

  const headerCells = rosters
    .map((r) => `      <th class="${TH}">${esc(r.ownerName)}</th>`)
    .join("\n");

  const dataRows = renderGridRows(rows, rosters.length + (hasRoundColumn ? 1 : 0), hasRoundColumn);

  // Sibling file, written by the same run that writes this page.
  const navHtml = navBar(navLinks, snapshot.season, exportFileName(snapshot.season, snapshot.snapshotType));

  const styles = ROSTER_STYLES + (hasRoundColumn ? ROUND_COL_STYLE : "");
  const roundTh = hasRoundColumn ? `      <th class="${TH}">Round</th>\n` : "";

  return `<!DOCTYPE html>
<html lang="en">
${htmlHead({
    title: `${snapshot.leagueName} - ${snapshot.season} ${typeLabel}`,
    ogTitle: `${snapshot.season} ${typeLabel}`,
    description: (OG_DESCRIPTIONS[snapshot.snapshotType] ?? (() => `${snapshot.season} rosters.`))(snapshot.season),
    siteName: snapshot.leagueName,
    extraStyles: styles,
  })}
<body class="bg-gray-50 text-gray-900 font-sans antialiased">
  <div class="px-3 sm:px-5 pt-4 sm:pt-5 pb-10">
  <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900 mb-1">${esc(snapshot.season)} ${esc(typeLabel)}</h1>
  <div class="text-sm text-gray-500 mb-4">${esc(snapshot.leagueName)}</div>
${navHtml}
  <div class="${TABLE_WRAP}">
  <table class="border-collapse bg-white text-xs">
    <tr>
${roundTh}${headerCells}
    </tr>
${dataRows.join("\n")}
  </table>
  </div>${keeperLegend(rosters)}
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

  // The newest tiers published: first chip of the newest season, since `discoverPages()`
  // orders each season's links newest-type-first. It moves on its own — 2026 points at
  // Pre-Draft today and at Post-Draft the moment that page exists.
  const latest = seasons.get(sortedSeasons[0])?.[0];

  const seasonRows = sortedSeasons
    .map((season) => {
      const links = seasons.get(season)!;
      const hasPreDraft = links.some((l) => l.page === "pre-draft");

      const pills = links
        .map((l) => `<a href="${esc(l.href)}" class="${l === latest ? PILL_LATEST : PILL_LINK}">${esc(l.chip)}</a>`)
        .join("\n          ");

      const throwback = !hasPreDraft
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
${htmlHead({
    title: leagueName,
    description: "Season-by-season roster tiers, draft order, and traded picks. Est. 2006.",
    siteName: leagueName,
  })}
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
