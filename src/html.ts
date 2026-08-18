import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Snapshot, SnapshotType, SnapshotRoster, SnapshotPlayer, NavLink, TierConfig, ResolvedTradedPick } from "./types.js";
import { SNAPSHOT_TYPE_LABELS } from "./types.js";
import type { DraftOrder } from "./tiers.js";
import { buildRosterGrid, columnOrderNote, type DraftRoundLookup, type GridRow } from "./roster-grid.js";
import { exportFileName, newestNavLink } from "./snapshot.js";
import {
  SITE,
  SITE_NAV,
  SURVIVOR,
  ARCHIVE_LINKS,
  GALLERY,
  SEASON_HONORS,
  LEAGUE_HISTORY,
  LEAGUE_FIRST_SEASON,
  type SeasonResult,
  TEAM_CITIES,
  PRIZE_SEASONS,
  getDraftDate,
  getLatestHonors,
  prizeSeasons,
  type Honor,
  type HonorIcon,
  type NavItem,
  type PrizeSeason,
} from "./league-info.js";

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
const TH = `${CELL} bg-forest text-parchment sticky top-0 z-10`;
/**
 * Roster table wrapper. The max-height is what makes `sticky top-0` on the header work:
 * an overflow container is the scrollport its sticky descendants pin to, so without a
 * height cap the box never scrolls vertically and the header never sticks. 15rem is the
 * block above the table (site header bar + page padding + h1 + league name + nav), so the
 * box runs to the bottom of the viewport. Horizontal scrolling on mobile is unchanged.
 */
const TABLE_WRAP = "overflow-auto max-h-[calc(100dvh_-_15rem)]";
const PILL_BOX = "px-3.5 py-1.5 text-sm font-medium rounded-lg";
const PILL = `inline-block ${PILL_BOX}`;
/** Colors only, so a pill that needs a different `display` can borrow them without a conflict. */
const PILL_LINK_COLORS = "text-ink bg-white border border-line transition-colors hover:border-moss hover:text-moss no-underline";
const PILL_LINK = `${PILL} ${PILL_LINK_COLORS}`;
const PILL_ACTIVE = `${PILL} text-parchment bg-forest border border-forest`;
/**
 * The Excel export pill. `inline-flex` replaces `inline-block` rather than joining it — two
 * `display` utilities on one element resolve by stylesheet order, not attribute order, so
 * whichever Tailwind emits last would win silently.
 */
const PILL_EXPORT = `inline-flex items-center gap-1.5 ${PILL_BOX} ${PILL_LINK_COLORS} ml-auto`;
/**
 * Section label. Small uppercase tracked type sitting directly on the background rather than
 * a heavier heading — the tables and cards below carry the weight, so the labels stay out of
 * the way. Also used, unchanged, for the roster page's own headings.
 */
const LABEL_TYPE = "text-xs font-medium tracking-[0.14em] uppercase text-stone";
const SECTION_H2 = `${LABEL_TYPE} mb-3.5 mt-0`;
/** The same treatment with no margins, for a label sitting inline at the head of a link row. */
const ROW_LABEL = `${LABEL_TYPE} w-[130px]`;
/**
 * Card surface without a radius, so a caller that wants a different one can set it alone. Two
 * `border-radius` utilities on one element resolve by stylesheet order, not attribute order —
 * the same trap `PILL_EXPORT` documents for `display`.
 */
const CARD_BASE = "bg-white border border-line";
const CARD = `${CARD_BASE} rounded-xl`;
/**
 * A destination that hasn't been built yet, in body copy. Same call as `NAV_PLANNED` in the
 * site nav: an inert span rather than a link to nowhere, so it never invites a dead click.
 * Both places it appears today point at pages `SITE_NAV` also lists as planned.
 */
const PLANNED = "text-stone cursor-default";
const TP_TH = "text-left text-xs font-medium uppercase tracking-wide text-stone px-3 pb-2.5 border-b border-line";
/** Cell geometry with no color, so a cell that needs a different one can take it without a conflict. */
const TP_TD_BOX = "px-3 py-2.5 border-b border-rule";
const TP_TD = `${TP_TD_BOX} text-ink`;
/**
 * The cell for a fact that isn't recorded, carrying the em dash that stands in for it.
 *
 * A separate constant rather than `${TP_TD} text-gray-400` appended at the call site: two color
 * utilities on one element resolve by stylesheet order, not attribute order, so which of the two
 * won would be Tailwind's decision rather than this file's — the same trap `PILL_EXPORT` and
 * `CARD_BASE` document for `display` and `border-radius`. Muted in the site's own `stone` too,
 * rather than a Tailwind default gray that belongs to no palette here.
 */
const TP_TD_MUTED = `${TP_TD_BOX} text-stone`;
/**
 * Drops the trailing hairline so a list of rows ends flush instead of underlined. Goes on the
 * `tbody`, since the rule lives on each `td` and only the last row's should go.
 */
const LAST_ROW_FLUSH = "[&>tr:last-child>td]:border-b-0";
/** Plain text link in body copy. */
const LINK = "text-moss no-underline transition-opacity hover:opacity-70";

/**
 * The palette, as Tailwind v4 theme tokens.
 *
 * v4 has no JS config, so the theme block is the config — every `bg-forest` / `text-stone`
 * in this file resolves here and nowhere else. Names are deliberately not `green-800`-style:
 * these are one league's colors, not a scale, and a name like `--color-green-800` would sit
 * in the same namespace as Tailwind's own and silently shadow it.
 *
 * The roster table's position tints, tier bars, and keeper yellow are NOT here — they live in
 * `ROSTER_STYLES` as plain CSS and are duplicated into `xlsx.ts`, so they stay a matched pair.
 */
const THEME = `    @theme {
      --font-sans: "Schibsted Grotesk", system-ui, -apple-system, sans-serif;
      --color-ink: #16211a;        /* body text */
      --color-cream: #faf9f5;      /* page background */
      --color-forest: #183f24;     /* header bar, active pills */
      --color-parchment: #f2ecdc;  /* text on forest */
      --color-sage: #b9c4ae;       /* muted text on forest */
      --color-moss: #1d4a2c;       /* links */
      --color-stone: #8a9284;      /* muted labels */
      --color-fern: #6f7a6e;       /* secondary body text */
      --color-line: #d8d6cc;       /* card and table borders */
      --color-rule: #e9e7dd;       /* hairline row dividers */
      --color-brass: #c9a53c;      /* the season's top honor */
      --color-shell: #eeece2;      /* neutral fill: honor icon discs, table header strips */
      --color-clay: #f0ead8;       /* toilet-bowl honor card: fill */
      --color-clay-line: #ddd3b8;  /* toilet-bowl honor card: border */
      --color-clay-ink: #8a7a4a;   /* toilet-bowl honor card: label and glyph */
    }
`;

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
  <link href="https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
  <style type="text/tailwindcss">
${THEME}  </style>${extraStyles ? `\n  <style>\n${extraStyles}  </style>` : ""}
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
          : `<td class="${TP_TD_MUTED}">&mdash;</td>`);
      }
      return `      <tr>${cells.join("")}</tr>`;
    })
    .join("\n");
  return `  <div class="overflow-x-auto -mx-1">
  <table class="text-sm w-auto">
    <thead><tr>${headers}</tr></thead>
    <tbody class="${LAST_ROW_FLUSH}">
${rows}
    </tbody>
  </table>
  </div>`;
}

/**
 * Footnotes under the roster table: the keeper legend, then the column-order note.
 *
 * The legend renders only when a cell actually carries the class. `.keeper` ships in
 * `ROSTER_STYLES` on every roster page but only pre-draft snapshots set the flag
 * (`snapshot.ts` clears the keeper id set for other types), so keying off the data keeps the
 * legend off pages with nothing highlighted, and picks it up automatically if another type
 * ever flags keepers. The swatch reuses the `.keeper` class rather than repeating the hex.
 *
 * The column-order note says what the header row can't: that the owners run in pick order
 * rather than alphabetically. Both the sentence and the rule for when it applies come from
 * `columnOrderNote()`, which the Excel export calls too.
 *
 * Each note brings its own leading newline, so a page with neither emits nothing at all
 * rather than a blank line. The first sits `mt-3` off the table and the second tucks `mt-2`
 * under it, so the two read as one block instead of two loose lines.
 */
function tableNotes(rosters: SnapshotRoster[], columnNote?: string): string {
  // Each entry takes the margin that puts it in the right place, which depends on whether
  // anything precedes it — hence the deferred call rather than a list of strings.
  const notes: ((margin: string) => string)[] = [];

  if (rosters.some((r) => r.players.some((p) => p.keeper))) {
    notes.push((m) => `<p class="${m} flex items-center gap-2 text-xs text-fern">
    <span class="keeper inline-block w-3.5 h-3.5 rounded-sm border border-line"></span>
    Keeper
  </p>`);
  }

  if (columnNote) {
    notes.push((m) => `<p class="${m} text-xs text-fern">${esc(columnNote)}</p>`);
  }

  return notes.map((note, i) => `\n  ${note(i === 0 ? "mt-3" : "mt-2")}`).join("");
}

function tradedPicksSection(tradedPicks?: ResolvedTradedPick[]): string {
  const heading = `  <h2 class="${SECTION_H2} mt-8">Traded Picks</h2>`;
  if (!tradedPicks || tradedPicks.length === 0) {
    return `${heading}\n  <p class="text-sm text-fern">None</p>`;
  }
  return `${heading}\n${tradedPicksTable(tradedPicks)}`;
}

// ── Shared page furniture ──

/**
 * Where a page sits relative to the output root, and what the site header can show from there.
 *
 * Every page carries the same header, but the index sits at `output/` and roster pages sit a
 * directory down, so the avatar and the "Current Tiers" link need a prefix that differs per
 * page. Passing it in beats guessing from the season, and keeps `generateIndexHtml` pure.
 */
export interface SiteChrome {
  /** Prefix from this page back to `output/`: "" for the index, "../" for a season page. */
  base: string;
  /**
   * Whether the avatar asset is on disk to be linked. The design makes the mark optional
   * (its `showMark` toggle), so a missing file degrades to the wordmark on its own rather
   * than to a broken image.
   */
  hasMark: boolean;
  /** Newest tiers page, relative to this page. Absent before any roster page exists. */
  tiersHref?: string;
  /**
   * Run the header's contents to the page edges instead of the home page's 1080px measure.
   *
   * Roster tables are as wide as ten owners make them and already run full-bleed, so a
   * centred header on those pages would sit in a narrow column above a much wider table.
   * The gutters here match the roster page wrapper's so the wordmark lines up with the h1.
   */
  fullBleed?: boolean;
}

const NAV_LINK = "no-underline text-parchment transition-opacity hover:opacity-70";
/**
 * A nav item whose page hasn't been built yet. Rendered as a `span`, not a dimmed `a` — a
 * link that goes nowhere invites the click and then does nothing, which reads as broken.
 * `NavItem.href` in `league-info.ts` is the only switch: fill one in and it becomes a link.
 */
const NAV_PLANNED = "text-sage/50 cursor-default";
const NAV_PILL = "no-underline text-forest bg-parchment rounded-full px-4 py-1.5 font-medium transition-opacity hover:opacity-80";

/** An href that already names its own destination, rather than one relative to the output root. */
function isAbsoluteHref(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:|^\/\//i.test(href) || href.startsWith("/");
}

function navItemHtml(item: NavItem, chrome: SiteChrome): string {
  // `tiersHref` is resolved by the caller and already relative to this page; a plain
  // `href` names a file at the output root, so it needs the prefix back out of a
  // season directory. Absolute ones (Sleeper) are left alone.
  const own = item.href && !isAbsoluteHref(item.href) ? `${chrome.base}${item.href}` : item.href;
  const href = item.tiers ? chrome.tiersHref : own;
  const label = esc(item.label) + (item.external ? " &#8599;" : "");

  if (!href) return `<span class="${NAV_PLANNED}" title="Coming soon">${label}</span>`;

  const target = item.external ? ` target="_blank" rel="noopener noreferrer"` : "";
  return `<a href="${esc(href)}"${target} class="${item.pill ? NAV_PILL : NAV_LINK}">${label}</a>`;
}

/**
 * The green bar every page opens with: avatar, wordmark, and the site nav.
 *
 * Full-bleed background with the contents held to the same 1080px measure the page body uses,
 * so the bar spans the viewport while its text lines up with everything below it.
 */
function siteHeader(chrome: SiteChrome): string {
  const mark = chrome.hasMark
    ? `<img src="${esc(chrome.base)}assets/ffl-avatar-128.png" alt="" width="42" height="42" class="w-[42px] h-[42px] rounded-lg">\n        `
    : "";

  const items = SITE_NAV.map((item) => navItemHtml(item, chrome)).join("\n        ");
  const measure = chrome.fullBleed ? "px-3 sm:px-5" : "max-w-[1080px] mx-auto px-5 sm:px-8";

  return `  <header class="bg-forest text-parchment">
    <div class="${measure} py-4 flex items-center justify-between gap-6 flex-wrap">
      <a href="${esc(chrome.base)}index.html" class="flex items-center gap-3.5 no-underline text-parchment">
        ${mark}<span>
          <span class="block font-bold text-[17px] tracking-tight leading-tight">${esc(SITE.wordmark)}</span>
          <span class="block text-xs text-sage">${esc(SITE.tagline)}</span>
        </span>
      </a>
      <nav class="flex items-center gap-x-6 gap-y-3 text-sm flex-wrap justify-end">
        ${items}
      </nav>
    </div>
  </header>`;
}

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
  chrome: SiteChrome = { base: "../", hasMark: false, fullBleed: true },
): string {
  const typeLabel = SNAPSHOT_TYPE_LABELS[snapshot.snapshotType] ?? "Rosters";
  const grid = buildRosterGrid(snapshot, ownerOrder, tiers, draftRounds);
  const { rosters, hasRoundColumn, rows } = grid;

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
<body class="bg-cream text-ink font-sans antialiased">
${siteHeader(chrome)}
  <div class="px-3 sm:px-5 pt-5 sm:pt-6 pb-10">
  <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-ink mb-1">${esc(snapshot.season)} ${esc(typeLabel)}</h1>
  <div class="text-sm text-stone mb-4">${esc(snapshot.leagueName)}</div>
${navHtml}
  <div class="${TABLE_WRAP}">
  <table class="border-collapse bg-white text-xs">
    <tr>
${roundTh}${headerCells}
    </tr>
${dataRows.join("\n")}
  </table>
  </div>${tableNotes(rosters, columnOrderNote(snapshot, grid))}
${tradedPicksSection(tradedPicks)}
  <footer class="mt-8 text-xs text-stone">Data retrieved ${esc(formatPacificTime(snapshot.capturedAt))}</footer>
  </div>
</body>
</html>`;
}

// ── Home page sections ──

/** Eyebrow label inside a card. Smaller and wider-tracked than `SECTION_H2`. */
const EYEBROW = "block text-[11px] font-medium tracking-[0.16em] uppercase mb-1";
/**
 * Width a flexed column refuses to go below before it wraps to its own row.
 *
 * `min(x, 100%)` rather than a bare `x`: a plain `min-width` is a floor the box cannot shrink
 * past even once it is the only thing on the row, so on a viewport narrower than the floor the
 * column pushes the whole page into horizontal scroll. Capping it at the container's own width
 * keeps the wrap behaviour on desktop and lets it collapse on a phone.
 */
function flexFloor(px: number): string {
  return `min-w-[min(${px}px,100%)]`;
}

/** Hero cards take a slightly softer corner than the 12px `CARD` used everywhere else. */
const HERO_CARD = `flex-1 ${flexFloor(340)} rounded-[14px] px-6 py-4 flex items-center justify-between gap-4`;

/**
 * The two cards below the honors: a shortcut to the newest tiers, and the countdown to the
 * next draft. Either can be absent — a fresh season with no pages yet has no tiers to link,
 * and a season whose draft isn't scheduled has no date in `DRAFT_DATES` — and the row simply
 * carries whichever it has.
 *
 * The tiers card names traded picks as well as tiers because the home page no longer carries a
 * traded-picks table of its own; that card is now the only route to one.
 */
function heroHtml(latest: NavLink | undefined, draftSeason: string | undefined): string {
  const cards: string[] = [];

  if (latest) {
    cards.push(`      <a href="${esc(latest.href)}" class="no-underline text-ink ${CARD_BASE} ${HERO_CARD} transition-colors hover:border-moss">
        <span>
          <span class="${EYEBROW} text-stone">Current Tiers &amp; Traded Picks</span>
          <span class="block text-[21px] font-bold tracking-[-0.02em]">${esc(latest.season)} ${esc(latest.chip)}</span>
        </span>
        <span class="text-sm font-medium text-moss whitespace-nowrap">View tiers &#8594;</span>
      </a>`);
  }

  const draftIso = draftSeason ? getDraftDate(draftSeason) : undefined;
  if (draftSeason && draftIso) {
    // Rendered in Pacific at generate time rather than the viewer's zone: it is a league
    // fixture, everyone is in the same time zone, and a fixed string keeps the output
    // deterministic. Only the counter below it reads the viewer's clock.
    const when = new Date(draftIso);
    const date = when.toLocaleDateString("en-US", {
      timeZone: "America/Los_Angeles", weekday: "long", month: "long", day: "numeric", year: "numeric",
    });
    const time = when.toLocaleTimeString("en-US", {
      timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit", timeZoneName: "short",
    });

    // The dashes are placeholders the inline script overwrites on load; with JS off the card
    // still reads correctly as a date, just without a counter.
    const unit = (key: string, label: string) =>
      `<span class="text-center"><span class="block text-xl font-bold tabular-nums" data-cd="${key}">&ndash;</span><span class="block text-[10px] tracking-[0.1em] text-sage">${label}</span></span>`;

    cards.push(`      <div id="draft-countdown" data-target="${esc(draftIso)}" class="bg-forest text-parchment ${HERO_CARD} flex-wrap">
        <span>
          <span class="${EYEBROW} text-sage">${esc(draftSeason)} Draft</span>
          <span class="block text-[21px] font-bold tracking-[-0.02em]">${esc(date)}</span>
          <span class="block text-sm text-sage mt-0.5">${esc(time)}</span>
        </span>
        <span class="flex gap-[18px]">${unit("days", "DAYS")}${unit("hours", "HRS")}${unit("mins", "MINS")}</span>
      </div>`);
  }

  if (cards.length === 0) return "";
  return `    <div class="flex gap-6 flex-wrap mb-12">\n${cards.join("\n")}\n    </div>\n`;
}

/** Ticks the hero countdown. Vanilla and inline — the project ships no JS bundle. */
const COUNTDOWN_SCRIPT = `  <script>
    (function () {
      var box = document.getElementById("draft-countdown");
      if (!box) return;
      var target = new Date(box.dataset.target).getTime();
      if (isNaN(target)) return;
      function set(key, value) {
        var el = box.querySelector('[data-cd="' + key + '"]');
        if (el) el.textContent = value;
      }
      function tick() {
        var mins = Math.max(0, Math.floor((target - Date.now()) / 60000));
        set("days", Math.floor(mins / 1440));
        set("hours", Math.floor((mins % 1440) / 60));
        set("mins", mins % 60);
      }
      tick();
      setInterval(tick, 30000);
    })();
  </script>`;

/**
 * The Survivor notice: a standing band at the foot of the home page, below the draft order and
 * the gallery, above the closing link rows.
 *
 * It carries no link on purpose. Sleeper renders a survivor league in its mobile app and not
 * on the web, so the fact *is* the message; an anchor here would send a desktop reader to a
 * page that cannot show them the thing. Copy lives in `SURVIVOR` in `league-info.ts`.
 *
 * Brass-tinted rather than another white `CARD`, so a standing fact reads as an announcement
 * instead of one more card in a page of cards. The fill and border are opacity modifiers on
 * the one brass token, so nothing here introduces a colour the theme doesn't already name.
 *
 * No bottom margin: the closing link rows bring their own `mt-16`, and the section above ends
 * in `mb-14`, so the band is spaced by its neighbours rather than adding to them.
 */
function survivorNoticeHtml(): string {
  return `    <div class="bg-brass/12 border border-brass/35 rounded-xl px-6 py-4 flex items-center gap-4">
      <span class="w-10 h-10 rounded-full bg-brass text-forest flex items-center justify-center shrink-0"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/></svg></span>
      <span>
        <span class="${EYEBROW} text-clay-ink">${esc(SURVIVOR.label)}</span>
        <span class="block text-[15px] font-medium leading-snug">${esc(SURVIVOR.line)}</span>
      </span>
    </div>
`;
}

/**
 * Lucide glyphs for the honor cards, inlined — the project ships no icon font or sprite.
 *
 * Stroked in `currentColor`, so each card's tone sets the glyph colour along with its label
 * in one place instead of hard-coding a hex per icon. Keys come from `HonorIcon`, so a card
 * naming a glyph that isn't here fails to compile.
 */
const HONOR_ICONS: Record<HonorIcon, string> = {
  trophy: `<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>`,
  medal: `<path d="M7.21 15 2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.14a2 2 0 0 1 .14 2.2L16.79 15"/><path d="M11 12 5.12 2.2"/><path d="m13 12 5.88-9.8"/><path d="M8 7h8"/><circle cx="12" cy="17" r="5"/><path d="M12 18v-2h-.5"/>`,
  trend: `<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>`,
  plunger: `<path d="M7 12h13a1 1 0 0 1 1 1 5 5 0 0 1-5 5h-.598a.5.5 0 0 0-.424.765l1.544 2.47a.5.5 0 0 1-.424.765H5.402a.5.5 0 0 1-.424-.765L7 18"/><path d="M8 18a5 5 0 0 1-5-5V4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v8"/>`,
};

/**
 * Card treatments, keyed by `Honor.tone` with `default` standing in for an absent one.
 *
 * `disc` and `label` both carry a text colour: the glyph inherits it through `currentColor`,
 * so the disc's entry colours the icon and the label's entry colours the words above the name.
 */
const HONOR_TONES: Record<"default" | "champion" | "toilet", { card: string; disc: string; label: string }> = {
  default: { card: CARD, disc: "bg-shell text-fern", label: "text-stone font-medium" },
  champion: { card: "bg-forest text-parchment rounded-xl", disc: "bg-brass text-forest", label: "text-brass font-semibold" },
  toilet: { card: "bg-clay border border-clay-line rounded-xl", disc: "bg-white text-clay-ink", label: "text-clay-ink font-semibold" },
};

/**
 * One season's headline results, as a row of cards.
 *
 * The cards auto-fit rather than sitting on a fixed 4-column grid: a season could record three
 * honors or five, and `minmax(230px, 1fr)` reflows either without a breakpoint per count.
 *
 * Shared by the home page (newest season only, with the prize-table pointer as its `footer`)
 * and the League History page (every recorded season, each an anchor target for its year pill),
 * so the two can never drift into two different-looking honor rows. `id` is what separates the
 * two calls: it brings `scroll-mt` with it, since a bare anchor jump lands the heading flush
 * against the top of the viewport.
 */
function honorsSection(season: string, honors: Honor[], opts: { id?: string; footer?: string } = {}): string {
  const cards = honors
    .map((h) => {
      const tone = HONOR_TONES[h.tone ?? "default"];
      const label = h.detail ? `${h.label} · ${h.detail}` : h.label;
      return `        <div class="${tone.card} px-[22px] pt-[22px] pb-5">
          <div class="w-10 h-10 rounded-full flex items-center justify-center mb-3.5 ${tone.disc}"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${HONOR_ICONS[h.icon]}</svg></div>
          <div class="text-[11px] tracking-[0.12em] uppercase mb-1.5 ${tone.label}">${esc(label)}</div>
          <div class="text-[19px] font-bold leading-[1.25]">${esc(h.winner)}</div>
        </div>`;
    })
    .join("\n");

  const anchor = opts.id ? ` id="${esc(opts.id)}"` : "";
  const scrollMargin = opts.id ? " scroll-mt-6" : "";

  return `
    <section${anchor} class="mb-10${scrollMargin}">
      <h2 class="${SECTION_H2}">${esc(season)} Season Honors</h2>
      <div class="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(230px,1fr))]">
${cards}
      </div>${opts.footer ?? ""}
    </section>
`;
}

/**
 * Where a season's prize money is recorded, as the line that closes its honor cards.
 *
 * Two destinations, because the record is split at 2026: seasons the Prize Tracker carries get
 * an anchor into it, and the earlier ones point at the hand-kept workbook that holds them. The
 * split is decided per season rather than page-wide, so a 2025 honor block never sends anyone
 * to a page that starts at 2026 — which is the whole reason this isn't one hard-coded link.
 *
 * Root-relative, so both callers (the home page and the History page) resolve it as written.
 */
function prizePointerHtml(season: string): string {
  const link = PRIZE_SEASONS[season]
    ? `<a href="prizes.html#s${esc(season)}" class="${LINK}">${esc(season)} prize tracker &#8594;</a>`
    : `<a href="${ARCHIVE_LINKS.prizeSheet}" target="_blank" rel="noopener noreferrer" class="${LINK}">All ${esc(season)} prize winners &#x2197;</a>`;

  return `
      <div class="text-center mt-[18px] text-sm font-medium">
        ${link}
      </div>`;
}

/** The home page's honors row: the newest season, plus the pointer to its prize money. */
function honorsHtml(): string {
  const latest = getLatestHonors();
  if (!latest) return "";

  return honorsSection(latest.season, latest.honors, { footer: prizePointerHtml(latest.season) });
}

/**
 * Numbered pick order for the upcoming draft, as a bordered card with a header strip.
 *
 * A card rather than a bare table because it now shares a row with the photo column, and the
 * gallery's framed images would otherwise sit beside a list floating on the page background.
 * Its height is also what the gallery column stretches to.
 *
 * **The card is sized to its longest team name, and the names are the only input.** A row is
 * `px-5` + an 18px number + `gap-4` + the name, so the card needs `74px + text`. The longest
 * name today, "South Town Freedom Fighters", measures 210px at 15px Schibsted Grotesk (199px
 * in the Segoe UI fallback, so the swap can never wrap what the webfont fits) — 286px in all,
 * which is what sets the 320px floor below and the 1:1.9 split against the gallery. Add a
 * longer name to `DRAFT_ORDERS` and both numbers have to be re-checked, since nothing here
 * wraps gracefully: the row has no `nowrap`, so an overlong name silently breaks onto a
 * second line rather than erroring.
 */
function draftOrderHtml(draftOrder: DraftOrder | undefined): string {
  if (!draftOrder) return "";

  const rows = draftOrder.order
    .map((owner, i) => `          <div class="flex gap-4 px-5 py-2.5 border-t border-rule text-[15px]"><span class="text-stone w-[18px]">${i + 1}</span>${esc(owner)}</div>`)
    .join("\n");

  return `      <section class="flex-1 ${flexFloor(320)}">
        <h2 class="${SECTION_H2}">${esc(draftOrder.season)} Draft Order</h2>
        <div class="${CARD} overflow-hidden">
          <div class="px-5 py-[9px] bg-shell text-[11px] font-medium tracking-[0.12em] uppercase text-stone">Team</div>
${rows}
        </div>
      </section>`;
}

/**
 * Height the stack of figures is allowed to reach.
 *
 * The photos are `object-cover` inside `min-h-0` flex children, so they fill whatever height
 * this leaves and crop to it — which does nothing at all unless something caps the column,
 * since otherwise the images' own intrinsic heights set it and the gallery runs roughly twice
 * the draft order card's length beside it.
 *
 * 860px is what it takes to keep faces in frame, and the number is derived, not chosen. At the
 * 1080px shell the column measures ~618px wide, where the two files stand uncropped at 366px
 * (2000x1184) and 516px (1400x1168) — 952px once the captions and the gap are added, which is
 * where the cap would stop binding altogether. 860 leaves the near-square trophy photo almost
 * whole and spends the difference on the group shot, which is the one with floor to give:
 * `GalleryPhoto.weight` is what makes that split uneven, and `focus` aims each crop at the
 * bottom, since both photos hold their subjects in the top third.
 *
 * The earlier 620 was picked to pair with the ten-owner draft order card (~443px) and cost the
 * trophy photo half its height, taking the tops of both heads with it. Matching the card is
 * the thing that gave way: the column now runs nearly twice its neighbour and leaves white
 * space beside it, which is the cheaper of the two prices.
 */
const GALLERY_MAX_H = "max-h-[860px]";

/**
 * The photo column beside the draft order.
 *
 * The figures divide the capped column height by weight and crop to fill, so the pair always
 * bottoms out in the same place no matter what aspect the source files are — which is what
 * lets `docs/photos.md` keep cutting photos uncropped at their native aspect.
 *
 * `chrome.base` prefixes the src so the same markup would resolve from a season directory;
 * only the home page uses it today.
 *
 * The `flex-[1.9]` is the draft order's number, not this column's: that card is sized to its
 * longest team name and the row's leftover width has nowhere else to go, so tightening it
 * necessarily widens the photos. Since `GALLERY_MAX_H` caps the height either way, a wider
 * column means a tighter crop rather than taller images.
 *
 * **Each figure is a link to its own full-size file, and that is the whole no-JS story.** The
 * lightbox is an enhancement layered on top by `LIGHTBOX_SCRIPT`; with the script blocked or
 * `<dialog>` unsupported, a click still opens the photo, just in a plain browser tab.
 */
function galleryHtml(chrome: SiteChrome): string {
  if (GALLERY.length === 0) return "";

  const figures = GALLERY
    .map((photo) => {
      // Framing only bites because the image is cropped to a height it did not choose; a
      // photo left at its natural aspect ignores object-position entirely.
      const focus = photo.focus ? ` [object-position:${photo.focus}]` : "";
      // The caption rides along in a data attribute so the overlay can repeat it under the
      // full-size photo; reading it back out of the DOM would tie the two layouts together.
      return `          <figure class="m-0 flex-[${photo.weight ?? 1}] flex flex-col gap-2 min-h-0">
            <a href="${esc(chrome.base)}assets/photos/${esc(photo.full)}" data-lightbox data-caption="${esc(photo.caption)}" class="flex-1 min-h-0 block rounded-xl overflow-hidden cursor-zoom-in focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fern">
              <img src="${esc(chrome.base)}assets/photos/${esc(photo.file)}" alt="${esc(photo.alt)}" loading="lazy" decoding="async" class="w-full h-full object-cover${focus} rounded-xl border border-line box-border">
            </a>
            <figcaption class="text-[13px] text-fern">${esc(photo.caption)}</figcaption>
          </figure>`;
    })
    .join("\n");

  return `      <section class="flex-[1.9] ${flexFloor(460)} flex flex-col">
        <h2 class="${SECTION_H2}">League Photos</h2>
        <div class="flex flex-col gap-4 flex-1 ${GALLERY_MAX_H}">
${figures}
        </div>
        <div class="mt-3 text-[13px]">
          <span class="${PLANNED}" title="Coming soon">More in the Photo Gallery &#8594;</span>
        </div>
      </section>`;
}

/**
 * The overlay the gallery photos open into, and the script that drives it.
 *
 * A native `<dialog>` rather than a hand-built overlay: `showModal()` brings the backdrop, the
 * Escape key, the focus trap, and the inert background with it, none of which is worth
 * re-implementing. Both parts render only on the home page, and only when there are photos.
 *
 * **The links work without any of this.** `galleryHtml()` wraps each photo in a plain anchor to
 * its full-size file, so the script's job is to intercept that click, not to create it — which
 * is why it bails out early rather than falling back to anything when `<dialog>` is missing.
 * Modified clicks (a middle click, a ctrl/cmd click) fall through deliberately, so "open in a
 * new tab" keeps working on an element that looks like a link because it is one.
 *
 * Closing on any click that isn't the photo covers the backdrop, the margins, and the × button
 * in one rule, so the button needs no handler and no enclosing form.
 */
function lightboxHtml(): string {
  if (GALLERY.length === 0) return "";

  return `  <dialog id="lightbox" class="p-0 m-0 w-full h-full max-w-none max-h-none border-0 bg-transparent backdrop:bg-ink/90">
    <div class="w-full h-full flex flex-col items-center justify-center gap-3 p-4 sm:p-8 cursor-zoom-out">
      <img id="lightbox-image" src="" alt="" class="flex-1 min-h-0 max-w-full object-contain">
      <p id="lightbox-caption" class="m-0 shrink-0 text-sm text-parchment"></p>
    </div>
    <button type="button" aria-label="Close" class="absolute top-3 right-4 bg-transparent border-0 p-2 leading-none text-3xl text-sage hover:text-parchment cursor-pointer">&times;</button>
  </dialog>`;
}

/** Opens a gallery photo in the `<dialog>` above. Vanilla and inline — the project ships no JS bundle. */
const LIGHTBOX_SCRIPT = `  <script>
    (function () {
      var dlg = document.getElementById("lightbox");
      if (!dlg || typeof dlg.showModal !== "function") return;
      var img = document.getElementById("lightbox-image");
      var caption = document.getElementById("lightbox-caption");
      var links = document.querySelectorAll("a[data-lightbox]");
      for (var i = 0; i < links.length; i++) {
        links[i].addEventListener("click", function (e) {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault();
          var thumb = this.querySelector("img");
          img.src = this.href;
          img.alt = thumb ? thumb.alt : "";
          caption.textContent = this.dataset.caption || "";
          dlg.showModal();
        });
      }
      dlg.addEventListener("click", function (e) {
        if (e.target !== img) dlg.close();
      });
    })();
  </script>`;

/**
 * The link rows the page closes on: every tiers page that isn't already the hero card, then
 * where the pre-Sleeper seasons live.
 *
 * This replaced the "Tiers by Season" chip grid and the "Past Seasons" section, which between
 * them took a third of the page to say what two rows of links say. The consequence to know: the
 * Throwback badge went with them, and nothing else on the site marks a throwback year.
 */
function siteLinksHtml(navLinks: NavLink[], latest: NavLink | undefined): string {
  // Newest season first, keeping `discoverPages()`' newest-type-first order within each one,
  // and dropping whichever link the hero card is already showing.
  const bySeason = new Map<string, NavLink[]>();
  for (const link of navLinks) {
    bySeason.set(link.season, [...(bySeason.get(link.season) ?? []), link]);
  }
  const history = [...bySeason.keys()].sort().reverse()
    .flatMap((season) => bySeason.get(season)!)
    .filter((l) => l !== latest);

  const tiers = [
    ...history.map((l) => `<a href="${esc(l.href)}" class="${LINK}">${esc(l.season)} ${esc(l.chip)}</a>`),
    `<a href="${ARCHIVE_LINKS.tiersSheet}" target="_blank" rel="noopener noreferrer" class="${LINK}">2006&ndash;2024 archive &#x2197;</a>`,
  ].join("\n        ");

  return `    <div class="mt-16 border-t border-line pt-5 pb-12 text-sm flex flex-col gap-3.5">
      <div class="flex gap-6 flex-wrap items-baseline">
        <span class="${ROW_LABEL}">Tiers history</span>
        ${tiers}
      </div>
      <div class="flex gap-6 flex-wrap items-baseline">
        <span class="${ROW_LABEL}">Past seasons</span>
        <a href="${ARCHIVE_LINKS.sleeper}" target="_blank" rel="noopener noreferrer" class="${LINK}">2025+ on Sleeper &#x2197;</a>
        <span class="text-stone">Settings &rsaquo; League History &rsaquo; Previous Leagues</span>
        <a href="${ARCHIVE_LINKS.myFantasyLeague}" target="_blank" rel="noopener noreferrer" class="${LINK}">2006&ndash;2024 on MyFantasyLeague &#x2197;</a>
      </div>
    </div>`;
}

/**
 * The home page.
 *
 * Sections, in order: the season's honors, the two hero cards, the draft order beside the photo
 * gallery, the Survivor notice, then the closing link rows. Honors lead because a finished season is the
 * thing worth opening on; the hero cards are navigation, and navigation reads fine second.
 */
export function generateIndexHtml(
  leagueName: string,
  navLinks: NavLink[],
  draftOrder?: DraftOrder,
  hasMark = false,
): string {
  // The newest tiers published. Same helper the roster pages use for their header link, so
  // the hero card, the closing link rows, and every page's "Current Tiers" agree by construction.
  const latest = newestNavLink(navLinks);
  const chrome: SiteChrome = { base: "", hasMark, tiersHref: latest?.href };

  // Draft order and gallery share a row on wide screens and stack on narrow ones.
  const columnsHtml = `
    <div class="flex gap-10 lg:gap-18 flex-wrap mb-14">
${[draftOrderHtml(draftOrder), galleryHtml(chrome)].filter(Boolean).join("\n")}
    </div>
`;

  return `<!DOCTYPE html>
<html lang="en">
${htmlHead({
    title: leagueName,
    description: "Season honors, roster tiers, draft order, and photos from the league. Est. 2006.",
    siteName: leagueName,
  })}
<body class="bg-cream text-ink font-sans antialiased">
${siteHeader(chrome)}
  <main class="max-w-[1080px] w-full mx-auto px-5 sm:px-8 pt-10 sm:pt-14">
${honorsHtml()}${heroHtml(latest, draftOrder?.season)}${columnsHtml}${survivorNoticeHtml()}${siteLinksHtml(navLinks, latest)}
  </main>
${lightboxHtml()}
${COUNTDOWN_SCRIPT}
${LIGHTBOX_SCRIPT}
</body>
</html>`;
}

/**
 * The League History page's own sub-nav: the all-time table, then one pill per recorded season.
 *
 * Anchors within the page rather than a file per season. Every season's block is a heading and
 * four cards, so twenty of them still make a page shorter than one roster table, and a single
 * file means a new year costs a `SEASON_HONORS` entry and nothing else.
 *
 * Newest season first, and that ordering is the point: a year appended on the right would push
 * the season people actually want further along the row every August, and wrap to a second line
 * somewhere in the 2030s. Here the current year is always the second pill.
 *
 * Sits below the h1 rather than at the top of the page so it reads as a switch within League
 * History instead of a second site nav competing with the green bar above it.
 */
function historyNavHtml(seasons: string[]): string {
  const years = seasons
    .map((s) => `      <a href="#s${esc(s)}" class="${PILL_LINK}">${esc(s)}</a>`)
    .join("\n");

  return `    <nav class="flex flex-wrap items-center gap-2 mb-12">
      <a href="#all-time" class="${PILL_LINK}">Full league history</a>
${years}
    </nav>`;
}

/**
 * The League History table's two cell styles, lifted from the draft order card in
 * `draftOrderHtml()` so the two lists match: the same `bg-shell` header strip, the same 15px
 * rows divided by `border-t` hairlines. Edge padding is `px-5` like the card's rows, but only
 * at the two ends — five columns of `px-5` would spend 200px of the measure on gutters. The
 * `first:`/`last:` overrides beat the `px-4` beneath them on specificity, not source order, so
 * this pair is safe in a way `${CARD} rounded-[14px]` is not.
 *
 * `border-t` on every body cell (rather than `border-b` and a flush last row) is what puts the
 * rule under the header strip and leaves the card's own border to close the bottom.
 */
const HIST_TH = "px-4 first:pl-5 last:pr-5 py-[9px] text-left text-[11px] font-medium tracking-[0.12em] uppercase text-stone whitespace-nowrap";
const HIST_TD = "px-4 first:pl-5 last:pr-5 py-2.5 border-t border-rule text-[15px] whitespace-nowrap";

/**
 * Names shortened for the League History table only, where four columns of team names have to
 * fit one line each. Applied at render, so `LEAGUE_HISTORY` keeps the full names the rest of
 * the repo joins on and a widened table only has to drop this step.
 *
 * Two rules, both narrow:
 * - A tie (` & `, the only thing that puts two teams in one cell) drops to city words via
 *   `TEAM_CITIES`, since a pair of full names is twice the width the column is sized for.
 *   A name the map doesn't know passes through whole rather than disappearing.
 * - "South Town Freedom Fighters" loses its nickname. At 26 characters it is the widest name
 *   in the league by a wide margin, and it can land in any of the four columns that use this.
 */
const HISTORY_SHORT_NAMES: Record<string, string> = {
  "South Town Freedom Fighters": "South Town FF",
};

/**
 * Every team named in a cell reduced to its city word, a tie's pair included.
 *
 * The stacked mobile layout runs every value through this, and `shortenForHistory()` falls back
 * to it for a tie. A name `TEAM_CITIES` doesn't know passes through whole, which is the safe
 * failure: a new team reads long beside a column of city words rather than vanishing.
 */
function cityWords(name: string): string {
  return name.split(" & ").map((n) => TEAM_CITIES[n] ?? n).join(" & ");
}

function shortenForHistory(name: string): string {
  if (name.includes(" & ")) return cityWords(name);
  return HISTORY_SHORT_NAMES[name] ?? name;
}

/**
 * The four name columns of the League History table, in order, declared once because two
 * layouts render them: the table at `sm` and up, the stacked blocks below it.
 *
 * **The three bracket finishes run first, in finish order**, and Total Points follows as the
 * one column that isn't a bracket result. The honor cards above the table run in a different
 * order (Total Points third); the two lists are ordered on their own terms and neither follows
 * the other.
 *
 * Every column names a team at full length on the wide layout, through `shortenForHistory()`;
 * dropping the Best Record column is what bought back the measure that pays for it. The stack
 * shortens everything to a city word regardless, since a phone has room for one word.
 */
interface HistoryColumn {
  header: string;
  value: (r: SeasonResult) => string | undefined;
}

const HISTORY_COLUMNS: HistoryColumn[] = [
  { header: "Champion", value: (r) => r.champion },
  { header: "Runner-Up", value: (r) => r.runnerUp },
  { header: "Toilet Bowl", value: (r) => r.toiletBowl },
  { header: "Total Points", value: (r) => r.totalPoints },
];

const HIST_STACK_DT = "text-[11px] font-medium tracking-[0.1em] uppercase text-stone pt-[5px]";
const HIST_STACK_DD = "text-[15px]";

/**
 * The same seasons as one block each, for phones.
 *
 * Five columns of team names do not fit a 390px viewport at any font size, so below `sm` the
 * table stops being a table: each season becomes its own labeled block and the page scrolls the
 * one direction a phone scrolls. **Every name here is a city word** — a block is read one
 * season at a time, so the full name buys nothing and costs a wrapped line.
 *
 * A field with no name recorded is **left out**, not dashed. The dash on the wide layout is
 * holding a column open; here there is no column to hold, and seventeen of the twenty seasons would
 * otherwise carry a dashed Total Points line. A season with nothing at all still renders its
 * year, so the list never skips one.
 */
function historyStackHtml(rows: SeasonResult[]): string {
  return rows
    .map((r) => {
      const lines = HISTORY_COLUMNS
        .flatMap((c) => {
          const v = c.value(r);
          return v
            ? [`              <dt class="${HIST_STACK_DT}">${esc(c.header)}</dt><dd class="${HIST_STACK_DD}">${esc(cityWords(v))}</dd>`]
            : [];
        })
        .join("\n");
      const body = lines
        ? `\n            <dl class="grid grid-cols-[100px_1fr] gap-x-3 gap-y-1.5 mt-2">\n${lines}\n            </dl>`
        : `\n            <p class="text-[15px] text-stone mt-1.5">Not recorded.</p>`;
      return `          <div class="px-5 py-4">
            <div class="text-[15px] font-semibold">${esc(r.season)}</div>${body}
          </div>`;
    })
    .join("\n");
}

/**
 * Every season on one line: champion, runner-up, Toilet Bowl, total points.
 *
 * Total Points names a team the same way the bracket columns do, with no point total beside it:
 * five columns of names stay scannable down the year, and the number is already on the honor
 * card above. It reads at full length now that Best Record is gone; that column's width is what
 * pays for it.
 *
 * Rendered newest-first, against a source list kept oldest-first, so `LEAGUE_HISTORY` reads as a
 * timeline while the page opens on the seasons anyone remembers. A row may name nobody at all,
 * which is the state most of the pre-Sleeper seasons are in — hence the dash for a blank cell
 * and the note under the table, which keeps an incomplete record from reading as a complete one.
 *
 * **Styled as the home page's draft order card**, not as the traded-picks tables: the same
 * bordered card, `bg-shell` header strip, hairline row rules and 15px rows. It is the same kind
 * of object — a short standing list of team names — and the two now read as a pair across the
 * two pages.
 *
 * **Two layouts inside one card, and both are always in the markup.** The table renders at `sm`
 * and up, `historyStackHtml()` below it, and which one shows is a Tailwind visibility pair
 * (`sm:hidden` / `hidden sm:block`), not a decision made over the data. So a season added to
 * `LEAGUE_HISTORY` lands in both with no second edit, and the price is the season list
 * appearing twice in the HTML — cheap on a static page, and why both layouts build from
 * `HISTORY_COLUMNS` rather than two hand-written lists that could disagree about a column.
 *
 * **Every table cell is `whitespace-nowrap`**, so a name never wraps to a second line and the
 * columns stay readable straight down. The cost is width: the card scrolls sideways rather than
 * reflowing once five names exceed the measure, which is what the `overflow-x-auto` inside it is
 * for, and what `shortenForHistory()` is holding off. The stack has no such budget to protect,
 * so it does not use it.
 */
function leagueHistoryTableHtml(): string {
  if (LEAGUE_HISTORY.length === 0) return "";

  const rows = [...LEAGUE_HISTORY].sort((a, b) => b.season.localeCompare(a.season));

  const tableRows = rows
    .map((r) => {
      const cells = HISTORY_COLUMNS.map((c) => {
        const v = c.value(r);
        return v
          ? `<td class="${HIST_TD}">${esc(shortenForHistory(v))}</td>`
          : `<td class="${HIST_TD} text-stone">&mdash;</td>`;
      });
      return `                <tr><td class="${HIST_TD} font-medium">${esc(r.season)}</td>${cells.join("")}</tr>`;
    })
    .join("\n");

  // The gap between the league's first season and the oldest row on the table. Derived rather
  // than written out, so filling in an older season shortens the sentence on its own.
  const earliest = [...LEAGUE_HISTORY].sort((a, b) => a.season.localeCompare(b.season))[0].season;
  const missing = Number(earliest) > Number(LEAGUE_FIRST_SEASON)
    ? `\n      <p class="text-sm text-stone mt-3">${esc(LEAGUE_FIRST_SEASON)}&ndash;${esc(String(Number(earliest) - 1))} are still being compiled.</p>`
    : "";

  const headers = ["Season", ...HISTORY_COLUMNS.map((c) => c.header)]
    .map((h) => `<th class="${HIST_TH}">${h}</th>`)
    .join("");

  return `      <div class="${CARD} overflow-hidden">
        <div class="sm:hidden divide-y divide-rule">
${historyStackHtml(rows)}
        </div>
        <div class="hidden sm:block overflow-x-auto">
          <table class="w-full text-left">
            <thead><tr class="bg-shell">${headers}</tr></thead>
            <tbody>
${tableRows}
            </tbody>
          </table>
        </div>
      </div>${missing}`;
}

/**
 * The League History page, at `output/history.html` (served as `/history`).
 *
 * A root-level page like the index, so it takes the same `base: ""` chrome and the same 1080px
 * measure. Sections, in order: the sub-nav, the newest season's honors (the same four cards the
 * home page opens on, from the same renderer), the all-time table, then each earlier season.
 *
 * The all-time table sits second rather than last so it holds its place as seasons accumulate;
 * were it below them it would sink another screen every August. The newest season stays above it
 * because a finished season is the thing worth opening on, which is the home page's reasoning too.
 */
export function generateHistoryHtml(leagueName: string, navLinks: NavLink[], hasMark = false): string {
  const chrome: SiteChrome = { base: "", hasMark, tiersHref: newestNavLink(navLinks)?.href };

  const seasons = Object.keys(SEASON_HONORS).sort().reverse();
  const [newest, ...earlier] = seasons;

  // Every season's cards close with the same prize pointer the home page carries, so the two
  // pages stay a pair and each year routes to whichever record actually holds its money.
  const honorBlocks = (s: string) => honorsSection(s, SEASON_HONORS[s], { id: `s${s}`, footer: prizePointerHtml(s) });
  const table = leagueHistoryTableHtml();

  const allTime = table
    ? `
    <section id="all-time" class="mb-14 scroll-mt-6">
      <h2 class="${SECTION_H2}">Full League History</h2>
${table}
    </section>
`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
${htmlHead({
    title: `${leagueName} - League History`,
    ogTitle: "League History",
    description: "Champions, runners-up, and season honors for every recorded season.",
    siteName: leagueName,
  })}
<body class="bg-cream text-ink font-sans antialiased">
${siteHeader(chrome)}
  <main class="max-w-[1080px] w-full mx-auto px-5 sm:px-8 pt-10 sm:pt-14 pb-16">
    <h1 class="text-3xl sm:text-4xl font-bold tracking-tight text-ink mb-8">League History</h1>
${historyNavHtml(seasons)}
${newest ? honorBlocks(newest) : ""}${allTime}${earlier.map(honorBlocks).join("")}  </main>
</body>
</html>`;
}

// ── Prize Tracker page ──

/** Whole dollars with a thousands separator. Every amount on the page is an integer split. */
function money(n: number): string {
  const whole = Number.isInteger(n);
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** Every prize line in a season, flattened out of its groups. */
function prizeLines(ps: PrizeSeason) {
  return ps.groups.flatMap((g) => g.prizes);
}

/**
 * What a season has actually paid, per team, settled lines only.
 *
 * A leader has won nothing yet, so leading money is deliberately excluded: the tiles and the
 * band's "awarded" figure are the same number sliced two ways, and a tile that quietly counted
 * a Week 6 points lead as winnings would be wrong every time the lead changed hands. Where the
 * leads stand is the table's job, one row at a time.
 *
 * A split divides evenly, which is how every tie in the league's history has been settled.
 */
function winningsFor(ps: PrizeSeason): { team: string; total: number }[] {
  const totals = new Map<string, number>();
  for (const line of prizeLines(ps)) {
    if (!line.settled || !line.winners?.length) continue;
    const share = line.amount / line.winners.length;
    for (const team of line.winners) totals.set(team, (totals.get(team) ?? 0) + share);
  }
  return [...totals]
    .map(([team, total]) => ({ team, total }))
    .sort((a, b) => b.total - a.total || a.team.localeCompare(b.team));
}

/** How current a season's numbers are, as the band reads it. */
function prizeState(ps: PrizeSeason): { text: string; live: boolean } {
  if (ps.final) return { text: "Final", live: false };
  if (ps.through) return { text: `Through ${ps.through}`, live: true };
  return { text: "Not started", live: false };
}

/**
 * The band above each season's prizes: whose season, how current, and the four money figures.
 *
 * **Nothing here is a subtraction.** Awarded and still-open are both sums over the prize list,
 * and the pot sits beside them as a stated fact rather than as the thing they are measured
 * against. The league has historically paid out more than the entry fees make (2025 paid
 * $1,680 against a $1,600 pot), so a "remaining" figure derived from the pot would render
 * negative and read as a bug in this page rather than as a fact about the league.
 *
 * Forest while a season is running, the plain card once it is final or has not started —
 * the same tone-per-state idea `HONOR_TONES` uses, so live-versus-done is legible at a glance
 * rather than only in the small print.
 */
function prizeBandHtml(season: string, ps: PrizeSeason): string {
  const { text, live } = prizeState(ps);
  const lines = prizeLines(ps);
  const awarded = lines.filter((l) => l.settled).reduce((sum, l) => sum + l.amount, 0);
  const open = lines.filter((l) => !l.settled).reduce((sum, l) => sum + l.amount, 0);

  const shell = live
    ? "bg-forest text-parchment"
    : `${CARD_BASE} text-ink`;
  const eyebrow = live ? "text-sage" : "text-stone";
  const figureLabel = live ? "text-sage" : "text-stone";

  const figure = (label: string, value: string) =>
    `<span class="text-center sm:text-right"><span class="block text-[10px] tracking-[0.12em] uppercase ${figureLabel}">${esc(label)}</span><span class="block text-[19px] font-bold tabular-nums">${esc(value)}</span></span>`;

  return `      <div class="${shell} rounded-[14px] px-6 py-4 mb-8 flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
        <span>
          <span class="${EYEBROW} ${eyebrow}">Prize Pool</span>
          <span class="block text-[21px] font-bold tracking-[-0.02em]">${esc(text)}</span>
        </span>
        <span class="flex flex-wrap gap-x-7 gap-y-3">${figure("Entry", money(ps.entryFee))}${figure("Pot", money(ps.pot))}${figure("Awarded", money(awarded))}${ps.final ? "" : figure("Still open", money(open))}</span>
      </div>`;
}

/**
 * Per-team winnings as an auto-fit row of tiles rather than a second table.
 *
 * This is the standings, and it sits above the ledger because "am I winning money" is the
 * question people open the page with and "which prize paid it" is the follow-up. Tiles rather
 * than a table because two stacked tables read as one undifferentiated slab, and because the
 * honors row already established this exact grid idiom on the home page and the History page.
 *
 * City words, not full names: a tile is a 150px box and "South Town Freedom Fighters" is not
 * a 150px string. Renders nothing at all until something has been settled, which is the true
 * state of a season in August and reads better than ten tiles of $0.
 */
function winningsHtml(ps: PrizeSeason): string {
  const winnings = winningsFor(ps);
  if (winnings.length === 0) return "";

  const top = winnings[0].total;
  const tiles = winnings
    .map(({ team, total }) => {
      const lead = total === top;
      const box = lead ? "bg-forest text-parchment" : CARD;
      const label = lead ? "text-sage" : "text-stone";
      return `        <div class="${box} rounded-xl px-4 py-3.5">
          <div class="text-[11px] tracking-[0.08em] uppercase mb-1 ${label}">${esc(TEAM_CITIES[team] ?? team)}</div>
          <div class="text-[19px] font-bold tabular-nums">${esc(money(total))}</div>
        </div>`;
    })
    .join("\n");

  return `
      <h3 class="${SECTION_H2}">${ps.final ? "Final Winnings" : "Winnings So Far"}</h3>
      <div class="grid gap-3 mb-8 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
${tiles}
      </div>
`;
}

/**
 * The prize ledger's cell styles.
 *
 * Deliberately **not** the History table's rule that every cell is `whitespace-nowrap`. That
 * table is five columns of team names, where wrapping helps nobody and sideways scroll is the
 * right trade. This one is a single prose column ("Top single player, single week") beside
 * three short ones, on the page most likely to be opened from a phone on a Tuesday, so the
 * label wraps and only the short columns hold their line.
 */
const PRZ_TH = "px-4 first:pl-5 last:pr-5 py-[9px] text-left text-[11px] font-medium tracking-[0.12em] uppercase text-stone whitespace-nowrap";
const PRZ_TD = "px-4 first:pl-5 last:pr-5 py-3 border-t border-rule text-[15px] align-top";
const PRZ_TD_TIGHT = `${PRZ_TD} whitespace-nowrap`;
/** The group divider: the page background showing through the card, carrying the group's name. */
const PRZ_GROUP = `px-5 py-2 border-t border-rule bg-cream ${LABEL_TYPE}`;
/** The provisional marker on a line that has a leader but has not closed. */
const LEADING_TAG = `<span class="ml-2 align-middle inline-block bg-brass text-forest rounded px-1.5 py-px text-[10px] font-semibold tracking-[0.08em] uppercase">Leading</span>`;

/**
 * One season's prizes, as a single table divided into labelled groups.
 *
 * The three states a line can be in are carried by the winner cell rather than by a fifth
 * status column, which keeps the table at four columns on a page where width is already the
 * scarce thing: a settled line names its winner plainly, an open one shows the em dash this
 * site uses everywhere for an unrecorded fact, and a line with a leader names them with the
 * provisional tag beside it. An unsettled line's amount is muted for the same reason — that
 * money has not moved yet.
 *
 * Names run through `shortenForHistory()`, so a split renders as city words and South Town
 * loses its nickname, exactly as in the History table and for the same width reason.
 */
function prizeTableHtml(ps: PrizeSeason): string {
  const winnerHeader = ps.final ? "Winner" : "Leader or Winner";
  const headers = ["Prize", winnerHeader, "Result", "Amount"]
    .map((h, i) => `<th class="${PRZ_TH}${i === 3 ? " text-right" : ""}">${esc(h)}</th>`)
    .join("");

  const body = ps.groups
    .map((group) => {
      const rows = group.prizes
        .map((line) => {
          const named = (line.winners?.length ?? 0) > 0;
          const label = `<td class="${PRZ_TD}${line.headline ? " font-semibold" : ""}">${esc(line.label)}${line.note ? `<span class="block text-[13px] text-stone">${esc(line.note)}</span>` : ""}</td>`;

          const winner = named
            ? `<td class="${PRZ_TD_TIGHT}">${esc(shortenForHistory(line.winners!.join(" & ")))}${line.settled ? "" : LEADING_TAG}</td>`
            : `<td class="${PRZ_TD_TIGHT} text-stone">&mdash;</td>`;

          const result = line.stat
            ? `<td class="${PRZ_TD_TIGHT} tabular-nums">${esc(line.stat)}</td>`
            : `<td class="${PRZ_TD_TIGHT} text-stone">&mdash;</td>`;

          const amountTone = line.settled ? (line.headline ? "font-semibold" : "") : "text-stone";
          const amount = `<td class="${PRZ_TD_TIGHT} text-right tabular-nums ${amountTone}">${esc(money(line.amount))}</td>`;

          return `              <tr>${label}${winner}${result}${amount}</tr>`;
        })
        .join("\n");

      return `              <tr><td colspan="4" class="${PRZ_GROUP}">${esc(group.label)}</td></tr>
${rows}`;
    })
    .join("\n");

  const notes = ps.notes?.length
    ? `\n      <ul class="text-sm text-fern mt-3 list-disc pl-5 flex flex-col gap-1">
${ps.notes.map((n) => `        <li>${esc(n)}</li>`).join("\n")}
      </ul>`
    : "";

  return `      <div class="${CARD} overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-left">
            <thead><tr class="bg-shell">${headers}</tr></thead>
            <tbody>
${body}
            </tbody>
          </table>
        </div>
      </div>${notes}`;
}

/**
 * One season: the band, the winnings tiles, the ledger, and a link across to that season's
 * honor cards. `id` is what the sub-nav pills jump to, and it brings `scroll-mt` with it for
 * the same reason `honorsSection()` does — a bare anchor lands the heading against the top.
 */
function prizeSeasonHtml(season: string, ps: PrizeSeason): string {
  const honors = SEASON_HONORS[season]
    ? `<a href="history.html#s${esc(season)}" class="${LINK} text-sm font-medium">Season honors &#8594;</a>`
    : "";

  const heading = honors
    ? `      <div class="flex items-baseline justify-between gap-4 mb-3.5">
        <h2 class="${LABEL_TYPE}">${esc(season)} Season</h2>
        ${honors}
      </div>`
    : `      <h2 class="${SECTION_H2}">${esc(season)} Season</h2>`;

  return `
    <section id="s${esc(season)}" class="mb-14 scroll-mt-6">
${heading}
${prizeBandHtml(season, ps)}${winningsHtml(ps)}
${prizeTableHtml(ps)}
    </section>
`;
}

/**
 * Total winnings per team across every recorded season, one column per season plus a total.
 *
 * Renders only once there are two seasons to compare — a one-season all-time table is the
 * season table with the interesting columns removed. Every cell is `nowrap` and the card
 * scrolls sideways, which is the History table's trade and is the right one here: this grows
 * a column a year, and by the 2030s no amount of wrapping saves it.
 */
function allTimeWinningsHtml(seasons: string[]): string {
  if (seasons.length < 2) return "";

  const totals = new Map<string, Map<string, number>>();
  for (const season of seasons) {
    for (const { team, total } of winningsFor(PRIZE_SEASONS[season])) {
      const row = totals.get(team) ?? new Map<string, number>();
      row.set(season, total);
      totals.set(team, row);
    }
  }

  const sum = (row: Map<string, number>) => [...row.values()].reduce((a, b) => a + b, 0);
  const ranked = [...totals].sort((a, b) => sum(b[1]) - sum(a[1]) || a[0].localeCompare(b[0]));
  if (ranked.length === 0) return "";

  const headers = ["Team", ...seasons, "Total"]
    .map((h, i) => `<th class="${PRZ_TH}${i === 0 ? "" : " text-right"}">${esc(h)}</th>`)
    .join("");

  const rows = ranked
    .map(([team, row]) => {
      const cells = seasons
        .map((s) => {
          const v = row.get(s);
          return v === undefined
            ? `<td class="${PRZ_TD_TIGHT} text-right text-stone">&mdash;</td>`
            : `<td class="${PRZ_TD_TIGHT} text-right tabular-nums">${esc(money(v))}</td>`;
        })
        .join("");
      return `              <tr><td class="${PRZ_TD_TIGHT}">${esc(TEAM_CITIES[team] ?? team)}</td>${cells}<td class="${PRZ_TD_TIGHT} text-right tabular-nums font-semibold">${esc(money(sum(row)))}</td></tr>`;
    })
    .join("\n");

  return `
    <section id="all-time" class="mb-14 scroll-mt-6">
      <h2 class="${SECTION_H2}">All-Time Winnings</h2>
      <div class="${CARD} overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-left">
            <thead><tr class="bg-shell">${headers}</tr></thead>
            <tbody>
${rows}
            </tbody>
          </table>
        </div>
      </div>
      <p class="text-sm text-stone mt-3">Settled prizes only. A split is divided evenly between its winners.</p>
    </section>
`;
}

/**
 * The Prize Tracker's own sub-nav, mirroring the League History page's: newest season first,
 * so the year people want never migrates rightward as seasons accumulate. A live season is
 * marked in the pill itself, since that is the one people are arriving for.
 */
function prizesNavHtml(seasons: string[], hasAllTime: boolean): string {
  // One season and no all-time table means every pill points at the only thing on the page.
  if (!hasAllTime && seasons.length < 2) return "";

  const pills = [
    ...(hasAllTime ? [`      <a href="#all-time" class="${PILL_LINK}">All-time winnings</a>`] : []),
    ...seasons.map((s) => {
      const live = prizeState(PRIZE_SEASONS[s]).live;
      const suffix = live ? ` <span class="text-brass font-semibold">&middot; Live</span>` : "";
      return `      <a href="#s${esc(s)}" class="${PILL_LINK}">${esc(s)}${suffix}</a>`;
    }),
  ].join("\n");

  return `    <nav class="flex flex-wrap items-center gap-2 mb-12">
${pills}
    </nav>`;
}

/**
 * The closing link row: where the seasons this page does not carry actually live.
 *
 * 2023–2025 ran a different prize structure and are settled for good, so they stay in the
 * hand-kept workbook rather than being re-typed into `PRIZE_SEASONS` to render a table that
 * will never change again. Styled as the home page's closing link rows so it reads as the
 * same kind of pointer.
 */
function prizeArchiveHtml(): string {
  return `    <div class="mt-4 border-t border-line pt-5 pb-12 text-sm flex gap-6 flex-wrap items-baseline">
      <span class="${ROW_LABEL}">Earlier seasons</span>
      <a href="${ARCHIVE_LINKS.prizeSheet}" target="_blank" rel="noopener noreferrer" class="${LINK}">Prize winnings 2023&ndash;2025 &#x2197;</a>
      <span class="text-stone">Different prize structure, kept in the league's own workbook</span>
    </div>`;
}

/**
 * The Prize Tracker page, at `output/prizes.html` (served as `/prizes`).
 *
 * A root-level page like the index and History, so it takes the same `base: ""` chrome and the
 * same 1080px measure. Sections, in order: the sub-nav, the newest season, the all-time table,
 * then earlier seasons, then the archive link. That is the History page's ordering and for the
 * same two reasons: the season people came for opens the page, and the all-time table holds a
 * fixed position instead of sinking another screen every August.
 */
export function generatePrizesHtml(leagueName: string, navLinks: NavLink[], hasMark = false): string {
  const chrome: SiteChrome = { base: "", hasMark, tiersHref: newestNavLink(navLinks)?.href };

  const seasons = prizeSeasons();
  const [newest, ...earlier] = seasons;
  const allTime = allTimeWinningsHtml(seasons);

  const blocks = [
    newest ? prizeSeasonHtml(newest, PRIZE_SEASONS[newest]) : "",
    allTime,
    ...earlier.map((s) => prizeSeasonHtml(s, PRIZE_SEASONS[s])),
  ].join("");

  return `<!DOCTYPE html>
<html lang="en">
${htmlHead({
    title: `${leagueName} - Prize Tracker`,
    ogTitle: "Prize Tracker",
    description: "Prize winners by season, plus all-time winnings.",
    siteName: leagueName,
  })}
<body class="bg-cream text-ink font-sans antialiased">
${siteHeader(chrome)}
  <main class="max-w-[1080px] w-full mx-auto px-5 sm:px-8 pt-10 sm:pt-14">
    <h1 class="text-3xl sm:text-4xl font-bold tracking-tight text-ink mb-8">Prize Tracker</h1>
${prizesNavHtml(seasons, allTime !== "")}
${blocks}${prizeArchiveHtml()}
  </main>
</body>
</html>`;
}

export async function writeHtml(html: string, outputPath: string): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, html, "utf-8");
}
