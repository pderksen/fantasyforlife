import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Snapshot, SnapshotType, SnapshotRoster, SnapshotPlayer, NavLink, TierConfig, ResolvedTradedPick } from "./types.js";
import { SNAPSHOT_TYPE_LABELS } from "./types.js";
import type { DraftOrder } from "./tiers.js";
import { buildRosterGrid, columnOrderNote, type DraftRoundLookup, type GridRow } from "./roster-grid.js";
import { exportFileName, newestNavLink } from "./snapshot.js";
import {
  SITE,
  REFRESH_NOTE,
  SITE_NAV,
  SURVIVOR,
  ARCHIVE_LINKS,
  MFL_SEASONS,
  SLEEPER_FIRST_SEASON,
  mflHomeUrl,
  GALLERY,
  SEASON_HONORS,
  LEAGUE_HISTORY,
  LEAGUE_FIRST_SEASON,
  type SeasonResult,
  TEAM_CITIES,
  TEAM_ALIASES,
  ACTIVE_TEAMS,
  PRIZE_SEASONS,
  draftResultsUrl,
  getDraftDate,
  getLatestHonors,
  isThrowbackSeason,
  latestRuleChanges,
  prizeSeasons,
  type Honor,
  type RuleNote,
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

/**
 * The one rule on this site that Tailwind utilities genuinely cannot state, and the reason every
 * scrolling table on every page shares a stylesheet block.
 *
 * `.tbl-scroll` is the classic scroll shadow: two page-colored covers pinned to the *content*
 * with `background-attachment: local`, and two dark edge fades pinned to the *viewport* with
 * `scroll`. The covers travel with the table, so a fade shows only on a side that still has table
 * left, and the whole thing disappears at a width where nothing overflows. That self-hiding is why
 * it beats an absolutely positioned gradient, which would sit over the last column once you
 * reached the end, and it is why the same class is safe to hang on a table that never overflows:
 * it costs nothing until one does.
 *
 * **The cover color is a variable because not every table sits on white.** A table inside a `CARD`
 * gets the `#fff` default; the roster pages' traded-picks table sits straight on the cream page
 * body and sets `--tbl-bg` through `TBL_ON_CREAM`. Get this wrong and the fade reads as two pale
 * rectangles parked over the first and last columns, which is exactly what a cover is supposed to
 * prevent.
 *
 * The frozen column's seam is NOT here. It was `.hist-freeze` while one table had one, but the
 * breakpoint where a table stops overflowing is per-table, so it belongs at the call site as a
 * utility. See `FREEZE_SEAM`.
 */
const TABLE_SCROLL_STYLES = `    .tbl-scroll {
      --tbl-bg: #fff;
      background:
        linear-gradient(to right, var(--tbl-bg) 40%, transparent) left center,
        linear-gradient(to left, var(--tbl-bg) 40%, transparent) right center,
        radial-gradient(farthest-side at 0 50%, #16211a24, #16211a00) left center,
        radial-gradient(farthest-side at 100% 50%, #16211a24, #16211a00) right center;
      background-repeat: no-repeat;
      background-size: 34px 100%, 34px 100%, 13px 100%, 13px 100%;
      background-attachment: local, local, scroll, scroll;
    }
`;

/**
 * The wrapper every scrolling table on the site takes: the fade plus the scroll container it
 * paints on. One constant so a new table cannot get the affordance half-applied.
 */
const TBL_SCROLL = "tbl-scroll overflow-x-auto";

/**
 * The fade's cover color for a table that sits on the page body rather than inside a white card.
 * Only the roster pages' traded-picks table needs it today.
 */
const TBL_ON_CREAM = "[--tbl-bg:var(--color-cream)]";

/**
 * The hairline beside a frozen first column, marking the seam the rest of the table slides under.
 *
 * A `box-shadow` and not a `border-r`, so it adds no width to a column whose width is the thing
 * being conserved. A utility and not a CSS class, because **the width at which a table stops
 * overflowing is a property of that table**: below it the seam is doing real work, above it it is
 * a stray rule beside the first column. `FREEZE_SEAM_TO_LG` is the measured answer for the three
 * History-page tables, which all fit their container at `lg`; the all-time winnings table takes
 * the bare seam because it grows a column a year and has no width where it settles.
 *
 * `lg:shadow-none` beats the base utility because Tailwind sorts variants after their unprefixed
 * forms — the one place two utilities for one property are safe together, unlike the
 * `PILL_EXPORT` / `CARD` traps where both are unprefixed.
 */
const FREEZE_SEAM = "shadow-[1px_0_0_0_var(--color-rule)]";
const FREEZE_SEAM_TO_LG = `${FREEZE_SEAM} lg:shadow-none`;
const PILL_BOX = "px-3.5 py-1.5 text-sm font-medium rounded-lg";
const PILL = `inline-block ${PILL_BOX}`;
/** Colors only, so a pill that needs a different `display` can borrow them without a conflict. */
const PILL_LINK_COLORS = "text-ink bg-white border border-line transition-colors hover:border-moss hover:text-moss no-underline";
const PILL_LINK = `${PILL} ${PILL_LINK_COLORS}`;
const PILL_ACTIVE = `${PILL} text-parchment bg-forest border border-forest`;
/**
 * A pill sitting inside a white card: `PILL`'s geometry with a `bg-shell` fill instead of white,
 * because a white pill on a white card is a border and nothing else. `PILL_LINK` stays white for
 * the pills that sit on the cream page background, where white is what separates them from it.
 *
 * Two users, both lists inside a card: the years in Past Leagues (nineteen of them, wrapping to
 * three rows, which is the point — a comma list of that length reads as prose and gives the eye
 * nothing to land on) and the stage pills on the Keeper Tiers hub.
 */
const PILL_ON_CARD = `${PILL} bg-shell border border-line text-ink no-underline transition-colors hover:border-moss hover:text-moss`;

/**
 * The one pill on the Keeper Tiers hub that points at the newest stage of the newest season.
 *
 * Filled forest, a step darker again than the `PILL_ON_CARD` pills beside it, so the page has
 * three levels: the card, the stages on it, and the one worth opening first. It says `(current)`
 * as well as showing it, since a fill alone only means something next to the pills it is being
 * compared with, and the row it lands on can be the only row on screen.
 *
 * `PILL_ACTIVE` is the same fill and is deliberately not reused: that one marks the page you are
 * already on and is never a link, so it carries no hover. This one is always a link.
 */
const PILL_CURRENT = `${PILL} text-parchment bg-forest border border-forest no-underline transition-colors hover:bg-moss hover:border-moss`;
/**
 * The Excel export pill. `inline-flex` replaces `inline-block` rather than joining it — two
 * `display` utilities on one element resolve by stylesheet order, not attribute order, so
 * whichever Tailwind emits last would win silently.
 *
 * No `ml-auto`: it used to be pushed to the right end of the roster page's chip row, and now
 * closes the page above the capture timestamp, where its alignment is its wrapper's business.
 */
const PILL_EXPORT = `inline-flex items-center gap-1.5 ${PILL_BOX} ${PILL_LINK_COLORS}`;
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
 * A sub-heading inside a section, for the sections that hold more than one thing.
 *
 * Most sections on these pages are a `SECTION_H2` eyebrow over a single card, so a second
 * heading level rarely comes up. Two need it: the League History page's Records, which holds
 * two tables and will hold more, and the home page's rule changes card, whose two lists only
 * work as a split if each says what it is. Three identical uppercase eyebrows would flatten
 * either set into one another. Sentence case at 17px bold reads as the name of the block
 * directly beneath it while staying plainly subordinate to the h1.
 */
const SUB_H3 = "text-[17px] font-bold tracking-tight text-ink mt-0 mb-3";
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
 * The return-to-top link every page closes on. `#top` is the document top with no id to match,
 * which is why nothing on any page carries one.
 *
 * A plain link and not a floating button: a fixed control would have to be reasoned about
 * against the roster table's sticky header, the History table's frozen column and edge fade,
 * and the home page's lightbox dialog, all to save a gesture on pages that run two to four
 * screens. The link costs no viewport and is self-hiding in the only sense that matters, since
 * a page that fits the screen never puts it in front of anyone.
 *
 * It returns the *document*, so on a roster page whose table is scrolling inside its own
 * `max-h` the table stays where it was and the page top (chip bar, Excel button) is what comes
 * back. That is the destination worth returning to on every page here.
 *
 * `spacing` is the only knob, since the four pages close on blocks with different bottom
 * margins and the link should sit the same distance off each.
 */
function backToTopHtml(spacing = "pt-2"): string {
  return `    <div class="${spacing}">
      <a href="#top" class="${LINK} text-sm">&#8593; Back to top</a>
    </div>`;
}

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
      --color-clay: #f0ead8;       /* warm fill: toilet-bowl honor card, throwback history row */
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
  /** Path prefix to the output root, for the icon links. `""` on a root page, `"../"` from a season directory. */
  base?: string;
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
 * The favicon is three PNG cuts of the header mark, not an `.ico`: every page carries
 * the link tags, so nothing ever falls back to a bare `/favicon.ico` request, and the
 * marks ship as PNG and nothing else. 16 and 32 are both cut from `ffl-avatar-512.png`
 * directly, since a browser downscaling the 32 to 16 reads worse than lanczos from the
 * source; 180 is the iOS home-screen size. There is deliberately no `hasSiteMark()`
 * guard here the way the header has one. A missing icon file costs a 404 and a blank tab,
 * not a broken image, and every cut rides the same `assets/` mirror as the mark.
 */
function htmlHead({ title, ogTitle, description, siteName, base = "", extraStyles = "" }: HeadOptions): string {
  return `<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <meta name="robots" content="noindex, nofollow">
  <link rel="icon" type="image/png" sizes="32x32" href="${base}assets/ffl-favicon-32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="${base}assets/ffl-favicon-16.png">
  <link rel="apple-touch-icon" href="${base}assets/ffl-favicon-180.png">
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

// ── Traded picks table (roster pages only; the index dropped its copy in Aug 2026) ──

/**
 * Five columns, two of them full team names, on the one page whose body is cream rather than a
 * white card — hence `TBL_ON_CREAM` on the wrapper, without which the fade's covers paint white
 * rectangles over the first and last columns.
 *
 * **No frozen column, deliberately.** A row's identity here is Season *and* Round together, and
 * pinning Season alone would hold four characters on screen while the half of the row that
 * identifies it scrolls away. The fade carries the whole "more this way" signal instead.
 *
 * `w-auto` stays: the table sizes to its content rather than the page, which is what lets it
 * overflow at all. A `w-full` table squeezes its columns to the container and leaves the browser
 * nothing to scroll, the same trap the History table's `w-max min-w-full` avoids.
 */

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
  return `  <div class="${TBL_SCROLL} ${TBL_ON_CREAM} -mx-1">
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
 * directory down, so the avatar and every relative nav href need a prefix that differs per
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
  // A relative `href` names a file at the output root, so it needs the prefix back out of a
  // season directory. Absolute ones (Sleeper) are left alone.
  const href = item.href && !isAbsoluteHref(item.href) ? `${chrome.base}${item.href}` : item.href;
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
 * Nav bar for a season's pages: back to the tiers hub, then that season's own stages.
 *
 * The back-link replaces the Home pill this row used to carry. The header wordmark above it
 * already goes home, and from a roster page the useful destination is the hub — it is the one
 * place that lists every other season, which this row deliberately does not: a chip per stage
 * per season grows with the league, and the hub is what absorbs that growth. It reads "All
 * Keeper Tiers" rather than "Keeper Tiers" because the page it sits on *is* keeper tiers; the
 * word doing the work is the one saying this opens every season's, not this one's.
 *
 * The Excel export used to sit at the right end of this row and now sits below the table, in
 * `exportRowHtml()`. Its old spot was chosen so it was reachable without scrolling past a full
 * roster; the cost was a download inside the page's own navigation, reading as a place to go.
 */
function navBar(navLinks: NavLink[], season: string, tiersHref: string): string {
  const items = navLinks
    .filter((l) => l.season === season)
    .map((l) => l.current
      ? `<span class="${PILL_ACTIVE}">${esc(l.chip)}</span>`
      : `<a href="${esc(l.href)}" class="${PILL_LINK}">${esc(l.chip)}</a>`)
    .join("\n      ");
  return `  <nav class="flex flex-wrap items-center gap-2 mb-6">
      <a href="${esc(tiersHref)}" class="${PILL_LINK}">&#8592; All Keeper Tiers</a>
      ${items}
    </nav>`;
}

/**
 * The Excel download, below the roster table and its footnotes and above Traded Picks.
 *
 * Left-aligned in its own block, so it reads as the end of the roster rather than as one more
 * destination — which is what it did at the right end of the chip row, where it used to sit.
 * Below the Traded Picks table would be worse than above it: the workbook's second sheet *is*
 * that pick table, so a download sitting under it reads as an export of the picks alone.
 * `mt-8` matches the Traded Picks heading's own top margin, so the two blocks share a rhythm.
 * The label spells the action out because nothing beside it gives the icon context any more.
 */
function exportRowHtml(exportHref: string): string {
  return `  <div class="mt-8">
    <a href="${esc(exportHref)}" download class="${PILL_EXPORT}" title="Download this page as an Excel workbook">${DOWNLOAD_ICON}Download as Excel</a>
  </div>`;
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

/**
 * Is this the newest tiers page the site has — the one the home page's hero card points at?
 *
 * Answered from the page's own nav links rather than the filesystem, since `buildNavLinks()`
 * already listed every page that exists and `newestNavLink()` already owns the definition of
 * "newest" the hero card uses. Matched on season and type, not `href`: a nav link to the page
 * you are standing on is a bare filename while every other season's is `../<season>/...`.
 *
 * Advances on its own. The 2026 pre-draft page carries the note today; the run that first writes
 * the 2026 post-draft page moves the note there and off this one, with no edit here.
 */
function isNewestPage(snapshot: Snapshot, navLinks: NavLink[]): boolean {
  const newest = newestNavLink(navLinks);
  return newest?.season === snapshot.season && newest?.page === snapshot.snapshotType;
}

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

  const navHtml = navBar(navLinks, snapshot.season, `${chrome.base}tiers.html`);
  const refreshHtml = isNewestPage(snapshot, navLinks)
    ? ` <span class="text-stone/70">&middot; ${esc(REFRESH_NOTE)}</span>`
    : "";
  // Sibling file, written by the same run that writes this page.
  const exportHtml = exportRowHtml(exportFileName(snapshot.season, snapshot.snapshotType));

  const styles = TABLE_SCROLL_STYLES + ROSTER_STYLES + (hasRoundColumn ? ROUND_COL_STYLE : "");
  const roundTh = hasRoundColumn ? `      <th class="${TH}">Round</th>\n` : "";

  return `<!DOCTYPE html>
<html lang="en">
${htmlHead({
    title: `${snapshot.leagueName} - ${snapshot.season} ${typeLabel}`,
    ogTitle: `${snapshot.season} ${typeLabel}`,
    description: (OG_DESCRIPTIONS[snapshot.snapshotType] ?? (() => `${snapshot.season} rosters.`))(snapshot.season),
    siteName: snapshot.leagueName,
    base: chrome.base,
    extraStyles: styles,
  })}
<body class="bg-cream text-ink font-sans antialiased">
${siteHeader(chrome)}
  <div class="px-3 sm:px-5 pt-5 sm:pt-6 pb-10">
  <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-ink mb-1">${esc(snapshot.season)} ${esc(typeLabel)}</h1>
  <div class="text-sm text-stone mb-4">${esc(snapshot.leagueName)}${refreshHtml}</div>
${navHtml}
  <div class="${TABLE_WRAP}">
  <table class="border-collapse bg-white text-xs">
    <tr>
${roundTh}${headerCells}
    </tr>
${dataRows.join("\n")}
  </table>
  </div>${tableNotes(rosters, columnOrderNote(snapshot, grid))}
${exportHtml}
${tradedPicksSection(tradedPicks)}
${backToTopHtml("mt-8")}
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
 * The badge on a season that drafts fresh.
 *
 * Filled forest rather than an outline: on the tiers hub it is the one thing on the row that
 * isn't a link, and an outlined chip beside three outlined pills would read as a fourth
 * destination.
 *
 * Two callers, and they are deliberately the same chip: the tiers hub's season row, and the
 * heading over a season's honor cards, which puts it on the League History page beside every
 * throwback year and on the home page while the newest season is one. `isThrowbackSeason()`
 * decides in both, so no season is ever badged by hand and 2030 badges itself.
 *
 * The word alone only means something to a reader who already knows the rule, so the chip
 * carries its own explanation in a `title` and the League History table spells it out in full
 * under the star on its throwback rows.
 */
const THROWBACK_BADGE = "inline-block rounded-md bg-forest text-parchment text-[11px] font-medium tracking-[0.08em] uppercase px-2 py-[3px]";

/** The chip for a throwback season, or an empty string for the four years in five that aren't. */
function throwbackBadgeHtml(season: string): string {
  return isThrowbackSeason(season)
    ? `<span class="${THROWBACK_BADGE}" title="No keepers: the whole league drafted fresh">Throwback Year</span>`
    : "";
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
function honorsSection(
  season: string,
  honors: Honor[],
  opts: { id?: string; footer?: string; badge?: string } = {},
): string {
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

  // The badge rides on the heading rather than in the card grid: it is a fact about the year,
  // not a result, and a fifth card would sit it among the four that are. Passed in rather than
  // computed here, because only the League History page wants it — the home page shows one
  // season and says what that season was elsewhere. The flex only appears with the badge, so a
  // heading without one is exactly the heading it always was.
  const badge = opts.badge ?? "";
  const headingClass = badge ? `${SECTION_H2} flex items-center gap-2.5` : SECTION_H2;

  return `
    <section${anchor} class="mb-10${scrollMargin}">
      <h2 class="${headingClass}">${esc(season)} Season Honors${badge}</h2>
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
 * The pointer at the end of a rule that another page spells out.
 *
 * `LINK` plus weight, and `nowrap` so the label and its arrow never split across lines. Moss
 * alone at 15px, sitting after a sentence that opens on a bold lead-in, does not read as
 * clickable — the same problem `ARCHIVE_NOTE` solves with an underline on the tiers hub. An
 * underline is not available here: that one is the site's only underlined link, and a second
 * would stop the first from meaning anything.
 */
const RULE_LINK = `${LINK} font-semibold whitespace-nowrap`;

/**
 * A list of rules under its own sub-heading, one half of the rule changes card's split.
 *
 * No bullet markers: every line opens on a bold lead-in that already sets it apart, and a
 * marker column beside that would spend width the second column needs on a phone.
 */
function ruleListHtml(title: string, notes: RuleNote[]): string {
  const items = notes
    .map((n) => {
      // Inside the sentence rather than on its own line: a rule that points somewhere is still
      // a rule, and a block-level link under it would read as the list's own navigation.
      const link = n.link
        ? ` <a href="${esc(n.link.href)}" class="${RULE_LINK}">${esc(n.link.label)} &#8594;</a>`
        : "";
      return `                <li class="text-[15px] leading-snug"><span class="font-semibold">${esc(n.label)}</span> ${esc(n.detail)}${link}</li>`;
    })
    .join("\n");

  return `            <div>
              <h3 class="${SUB_H3}">${esc(title)}</h3>
              <ul class="m-0 p-0 list-none flex flex-col gap-3">
${items}
              </ul>
            </div>`;
}

/**
 * The season's rule changes, full width between the hero cards and the draft order row.
 *
 * **Full width rather than a column beside the draft order**, which is where it was first
 * planned. Two things ruled that out. The photo column next to that card renders 900px cuts
 * into a ~618px slot, so moving the photos below to make room would have them upscaled at the
 * 1080px measure, which is the exact resampling `docs/photos.md` cut those files to avoid. And
 * the two cards do not share a shape: the draft order is one column of ten short rows, and this
 * is seven rules that each run to a sentence, so half the measure puts most of them on three
 * lines. At the full width they sit in two columns and most fall to two, which is what makes
 * seven rules read as two short lists rather than one long one.
 *
 * **Below the hero cards, not above them.** The countdown is the most time-sensitive thing on
 * the page in the weeks before a draft, and the honors above it are what the page opens on.
 * This sits directly above the draft order, which three of its own lines are about.
 *
 * **The card is the two lists and nothing else.** `RuleChanges.intro` is optional and 2026 sets
 * none, and the `bg-shell` header strip the other cards carry is gone too. It read "From the
 * commissioner", then "After the owner survey", and both were answering a question the rules
 * do not raise: an owner opening this wants to know what changed, not who decided it or how.
 * The `SECTION_H2` above the card says what it is, and the two `SUB_H3`s say what each half is,
 * so a third label was the page explaining itself three times. Set `intro` on a future season
 * and the paragraph returns above the split with no other edit.
 *
 * **The prize change is a rule in the list, not a figures row in the footer.** The footer
 * carried the entry fee, pot and champion's share read out of `PRIZE_SEASONS` until Aug 2026.
 * What owners need from this card is that the prize structure moved, which is a rule like any
 * other, and the Prize Tracker is one click away through `RuleNote.link` rather than being
 * partially restated here. That is also what stops the two pages disagreeing: this one now
 * quotes no prize figure at all.
 *
 * A plain white `CARD`, rather than the brass band the Survivor notice uses: that band is the
 * page's one announcement treatment, and a second would leave neither reading as the exception.
 * No `overflow-hidden` either, which was only ever there to clip the strip to the radius.
 *
 * `rulesHref` is now the footer's only occupant, so an unset one takes the divider with it and
 * the card closes on its lists.
 */
function ruleChangesHtml(): string {
  const latest = latestRuleChanges();
  if (!latest) return "";
  const { season, rules } = latest;

  let footer = "";

  // Nothing at all without a rules document, rather than the inert span the site nav already
  // carries for that page: one "coming soon" per destination is the whole of what it can say.
  if (rules.rulesHref) {
    footer += `
            <div class="text-sm">
              <a href="${esc(rules.rulesHref)}" class="${LINK}">Official ${esc(season)} rules &#8594;</a>
            </div>`;
  }

  return `    <section class="mb-14">
      <h2 class="${SECTION_H2}">What's new in ${esc(season)}</h2>
      <div class="${CARD}">
        <div class="px-5 sm:px-6 py-5">${rules.intro ? `
          <p class="m-0 max-w-[68ch] text-[15px] leading-relaxed">${esc(rules.intro)}</p>` : ""}
          <div class="${rules.intro ? "mt-6 " : ""}grid gap-x-12 gap-y-6 md:grid-cols-2">
${ruleListHtml("What's changing", rules.changed)}
${ruleListHtml("Staying the same", rules.unchanged)}
          </div>${footer ? `
          <div class="mt-6 pt-4 border-t border-rule flex flex-col gap-2.5">${footer}
          </div>` : ""}
        </div>
      </div>
    </section>
`;
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
 * The link rows the page closes on: where the seasons live off-site, then Sleeper's help centre.
 *
 * Both rows are destinations this site does not hold. The block opened on a "Tiers history" row
 * into the tiers hub until Aug 2026, a third route to that one page: the header nav carries it
 * from every page and the hero card above opens the newest season of it. The hub keeps the two
 * routes it earns, and the foot of the page keeps only what lives elsewhere.
 *
 * The two hosts stack rather than sharing a line, in a `flex-col` beside the label: the Sleeper
 * link keeps the menu path that finds the old leagues sitting next to it, which is the only
 * thing that path explains, and MyFantasyLeague reads as the line below rather than as a third
 * item in a sentence about Sleeper. The outer row is still `items-baseline`, so the label lines
 * up with the first of the two.
 */
function siteLinksHtml(): string {
  return `    <div class="mt-16 border-t border-line pt-5 pb-12 text-sm flex flex-col gap-3.5">
      <div class="flex gap-6 flex-wrap items-baseline">
        <span class="${ROW_LABEL}">Past seasons</span>
        <div class="flex flex-col gap-2">
          <div class="flex gap-6 flex-wrap items-baseline">
            <a href="${ARCHIVE_LINKS.sleeper}" target="_blank" rel="noopener noreferrer" class="${LINK}">2025+ on Sleeper &#x2197;</a>
            <span class="text-stone">Go to Settings &rsaquo; League History &rsaquo; Previous Leagues</span>
          </div>
          <a href="${ARCHIVE_LINKS.myFantasyLeague}" target="_blank" rel="noopener noreferrer" class="${LINK}">2006&ndash;2024 on MyFantasyLeague &#x2197;</a>
        </div>
      </div>
      <div class="flex gap-6 flex-wrap items-baseline">
        <span class="${ROW_LABEL}">Help</span>
        <a href="${ARCHIVE_LINKS.sleeperSupport}" target="_blank" rel="noopener noreferrer" class="${LINK}">Sleeper Support &#x2197;</a>
      </div>
    </div>`;
}

/**
 * The home page.
 *
 * Sections, in order: the season's honors, the two hero cards, the season's rule changes, the
 * draft order beside the photo gallery, the Survivor notice, then the closing link rows. Honors
 * lead because a finished season is the thing worth opening on; the hero cards are navigation,
 * and navigation reads fine second.
 */
export function generateIndexHtml(
  leagueName: string,
  navLinks: NavLink[],
  draftOrder?: DraftOrder,
  hasMark = false,
): string {
  // The newest tiers published, and the only thing on the site that points at a specific
  // stage: it advances on its own as each season's pages are generated. The nav item and the
  // closing link row both go to the hub instead, which lists every stage of every season.
  const latest = newestNavLink(navLinks);
  const chrome: SiteChrome = { base: "", hasMark };

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
  <main class="max-w-[1080px] w-full mx-auto px-5 sm:px-8 pt-10 sm:pt-14 pb-16">
${honorsHtml()}${heroHtml(latest, draftOrder?.season)}${ruleChangesHtml()}${columnsHtml}${survivorNoticeHtml()}${siteLinksHtml()}
${backToTopHtml()}
  </main>
${lightboxHtml()}
${COUNTDOWN_SCRIPT}
${LIGHTBOX_SCRIPT}
</body>
</html>`;
}

// ── Keeper Tiers hub ──

/**
 * A row of the tiers hub: the season, whatever badge it earns, and its stages on the right.
 *
 * `currentHref` is the newest stage of the newest season, from `newestNavLink()`, so exactly one
 * pill on the page is marked and the mark moves on its own the run after a new snapshot lands.
 * Matching on the href rather than on a season/type pair keeps the rule in one place: whatever
 * that function calls newest is what this row marks.
 */
function tiersRowHtml(season: string, links: NavLink[], currentHref?: string): string {
  const pills = links
    .map((l) => {
      const current = l.href === currentHref;
      const label = current ? `${l.chip} (current)` : l.chip;
      return `<a href="${esc(l.href)}" class="${current ? PILL_CURRENT : PILL_ON_CARD}">${esc(label)}</a>`;
    })
    .join("\n            ");
  const badge = throwbackBadgeHtml(season);
  const badgeLine = badge ? `\n          ${badge}` : "";
  // Last in the row, after the stages, and carrying the arrow every off-site pill on this site
  // carries. It is `PILL_ON_CARD` like the stages beside it because there is no fourth level of
  // fill available here, and a season's draft board is a peer of its stages, not a step above.
  const draftHref = draftResultsUrl(season);
  const draftPill = draftHref
    ? `\n            <a href="${draftHref}" target="_blank" rel="noopener noreferrer" class="${PILL_ON_CARD}">Draft Results &#x2197;</a>`
    : "";

  return `        <div class="flex items-center gap-3 flex-wrap px-5 py-3.5 border-t border-rule">
          <span class="text-[19px] font-bold tracking-tight">${esc(season)}</span>${badgeLine}
          <span class="ml-auto flex gap-2 flex-wrap justify-end">
            ${pills}${draftPill}
          </span>
        </div>`;
}

/**
 * The second line under the archive pill: where the pre-Sleeper drafts are, which is not where
 * that pill goes. Small text rather than a pill, because it points sideways to another page of
 * this site instead of naming an entry in this list, and because the card has no fill level
 * left below `PILL_ON_CARD`.
 *
 * Moss and underlined, which makes it the only underlined link on the site. It shipped in stone
 * at the same weight as the muted labels around it and read as a caption, and the usual moss-
 * with-no-underline treatment is not enough on its own at 13px next to a pill. The underline is
 * `decoration-moss/40` so the rule reads as an affordance rather than as emphasis.
 */
const ARCHIVE_NOTE = "text-[13px] text-moss underline underline-offset-2 decoration-moss/40 transition-opacity hover:opacity-70";

/**
 * The Keeper Tiers hub: one row per season with its stages as pills, closing on the row for
 * the seasons that predate Sleeper.
 *
 * The list this page carries used to be a chip grid on the home page, removed in the Aug 2026
 * redesign for taking a third of that page. It comes back here because a hub is what makes the
 * roster pages navigable without the home page's help: every roster page's nav lists only its
 * own season's stages, and this is the one place that crosses seasons.
 *
 * The archive sits in the same card as a row of its own rather than under a heading of its own.
 * Those seasons' tiers really are the next entries in this list, they just live in a Google
 * Sheet, so the row names the range on the left exactly like a season and puts the destination
 * where a season puts its pills.
 *
 * Rows come straight from `discoverPages()` by way of the nav links, so a season appears the
 * run after its first snapshot lands and gains a pill per stage with no edit here.
 */
export function generateTiersHtml(leagueName: string, navLinks: NavLink[], hasMark = false): string {
  const chrome: SiteChrome = { base: "", hasMark };

  // Newest season first, keeping `discoverPages()`' newest-stage-first order within each one.
  const bySeason = new Map<string, NavLink[]>();
  for (const link of navLinks) {
    bySeason.set(link.season, [...(bySeason.get(link.season) ?? []), link]);
  }
  const currentHref = newestNavLink(navLinks)?.href;
  const rows = [...bySeason.keys()].sort().reverse()
    .map((season) => tiersRowHtml(season, bySeason.get(season)!, currentHref))
    .join("\n");

  // Typed exactly like a season row, because it is one: those years' tiers are the next
  // entries in this list and only the destination differs. A lighter year or a plain text
  // link would file them as a footnote to the list instead of a member of it.
  //
  // The note under the pill is the one place the row is *not* typed like a season: those years'
  // drafts are not on the sheet the pill opens, they are on the MFL sites the League History
  // page already lists, and a second pill would claim they were an equal destination in this
  // card. Small stone text pointing sideways at that section says where they are without
  // promising this page holds them.
  const archiveRow = `        <div class="flex items-center gap-3 flex-wrap px-5 py-3.5 border-t border-rule">
          <span class="text-[19px] font-bold tracking-tight">${esc(LEAGUE_FIRST_SEASON)}&ndash;${Number(SLEEPER_FIRST_SEASON) - 1}</span>
          <span class="ml-auto flex flex-col items-end gap-1.5">
            <a href="${ARCHIVE_LINKS.tiersSheet}" target="_blank" rel="noopener noreferrer" class="${PILL_ON_CARD}">Google Sheets Archive &#x2197;</a>
            <a href="history.html#past-leagues" class="${ARCHIVE_NOTE}">Drafts linked on past MFL sites</a>
          </span>
        </div>`;

  return `<!DOCTYPE html>
<html lang="en">
${htmlHead({
    title: `${leagueName} - Keeper Tiers & Drafts`,
    ogTitle: "Keeper Tiers & Drafts",
    description: "Roster tiers for every season and every stage of it, from pre-draft keepers to final rosters, plus each season's draft board.",
    siteName: leagueName,
  })}
<body class="bg-cream text-ink font-sans antialiased">
${siteHeader(chrome)}
  <main class="max-w-[1080px] w-full mx-auto px-5 sm:px-8 pt-10 sm:pt-14 pb-16">
    <h1 class="text-3xl sm:text-4xl font-bold tracking-tight text-ink mb-8">Keeper Tiers &amp; Drafts</h1>
    <div class="${CARD} overflow-hidden">
      <div class="flex items-center justify-between gap-3 px-5 py-[9px] bg-shell text-[11px] font-medium tracking-[0.12em] uppercase text-stone">
        <span>Season</span>
        <span>Stages &amp; Drafts</span>
      </div>
${rows}
${archiveRow}
    </div>
${backToTopHtml("pt-6")}
  </main>
</body>
</html>`;
}

/**
 * The sub-nav's tab-bar geometry.
 *
 * The hairline belongs to the `nav`, and every item overlaps it by a pixel (`-mb-px` against
 * its own `border-b-2`) so the live tab's moss underline lands *on* the rule rather than a
 * pixel above it. Both borders are therefore load-bearing: drop `border-b` from the row and
 * the underline floats, drop `-mb-px` from the items and it doubles the rule's thickness.
 *
 * Items are `whitespace-nowrap`, so the failure mode on a narrow phone is one label dropping
 * to a second line, never a broken label. When that happens the live tab's underline sits on
 * the upper line while the row's rule stays under the lower one — visible, and the reason
 * `gap-y-0` keeps the two lines tight enough to still read as one bar.
 */
const TAB_ROW = "flex flex-wrap items-end gap-x-6 sm:gap-x-7 gap-y-0 mb-11 border-b border-line";
const TAB_BOX = "inline-flex items-baseline gap-2 whitespace-nowrap pb-2.5 -mb-px border-b-2 text-sm font-medium";
const TAB_LINK = `${TAB_BOX} border-moss text-moss no-underline transition-opacity hover:opacity-70`;
/** An unbuilt section: same geometry, no underline, and inert rather than a link to nowhere. */
const TAB_PLANNED = `${TAB_BOX} border-transparent text-stone cursor-default`;
/** The tag marking a tab that isn't built yet. Small tracked caps, so it reads as a status and not part of the label. */
const TAB_SOON = `<span class="text-[10px] font-semibold tracking-[0.12em] uppercase text-stone/70">Soon</span>`;

/**
 * The League History page's own sub-nav: one jump link per section of the page below it.
 *
 * Anchors within the page rather than a file per section. A season's block is a heading and
 * four cards, so twenty of them still make a page shorter than one roster table, and a single
 * file means a new year costs a `SEASON_HONORS` entry and nothing else.
 *
 * The list is the page's sections, not its seasons: per-year pills lived here until Aug 2026
 * and were dropped, because a row that grows by one every August ends up wrapping to a second
 * line while saying nothing a reader scrolling the page doesn't already see. Sections that
 * don't exist yet still get a tab, inert and tagged `TAB_SOON`, so the shape of the page is
 * legible before it's finished; giving one an `href` is the whole edit that turns it live.
 *
 * An underlined tab bar rather than the `PILL_LINK` row the Prize Tracker uses, which is the
 * one place the two pages deliberately differ. Pills are what the roster pages use for
 * *cross-page* chips, so borrowing them here blurs a page switch and a jump down this page, and
 * they gave equal weight to three items back when only one of them went anywhere. The rule also
 * gives the h1 above it something to sit on, which a bare row of links did not.
 *
 * Every tab is underlined because underline means "this one works", not "you are here" — nothing
 * observes the sections, so all three light up now that all three exist.
 *
 * Sits below the h1 rather than at the top of the page so it reads as a switch within League
 * History instead of a second site nav competing with the green bar above it.
 */
const HISTORY_SECTIONS: { label: string; href?: string }[] = [
  { label: "Full League History", href: "#all-time" },
  { label: "Records", href: "#records" },
  { label: "Past Leagues", href: "#past-leagues" },
];

function historyNavHtml(): string {
  const items = HISTORY_SECTIONS.map(({ label, href }) =>
    href
      ? `      <a href="${esc(href)}" class="${TAB_LINK}">${esc(label)}</a>`
      : `      <span class="${TAB_PLANNED}" title="Coming soon">${esc(label)} ${TAB_SOON}</span>`,
  ).join("\n");

  return `    <nav class="${TAB_ROW}">
${items}
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
const HIST_EDGE = "px-2 md:px-4 first:pl-3 md:first:pl-5 last:pr-3 md:last:pr-5";
/**
 * The header cell without an alignment, so a caller can set one. The Trophy Case's count columns
 * are right-aligned, and appending `text-right` to a `HIST_TH` that already says `text-left` is
 * two `text-align` utilities on one element: they resolve by stylesheet order, not attribute
 * order, so the loser is picked silently. Same trap `PILL_EXPORT` swaps rather than adds for.
 */
const HIST_TH_BASE = `${HIST_EDGE} py-[9px] text-[11px] font-medium tracking-[0.12em] uppercase text-stone whitespace-nowrap`;
const HIST_TH = `${HIST_TH_BASE} text-left`;
const HIST_TD = `${HIST_EDGE} py-2.5 border-t border-rule text-[13px] md:text-[15px] whitespace-nowrap`;

/**
 * The frozen first column: the year on the League History table, the team on the Trophy Case
 * tables, pinned to the left edge so the thing a row is about stays put while the rest scrolls
 * under it. Named for the column it was built for, and kept that way because CLAUDE.md and
 * `docs/site-design.md` both name it.
 *
 * Both cells need their own opaque fill: a sticky cell slides over the rows beside it, and the
 * `<tr>` background does not travel with it. `FREEZE_SEAM_TO_LG` is the hairline that marks the seam,
 * and it takes itself off at `lg`, where these three tables fit their container and nothing
 * scrolls under anything.
 */
const HIST_TH_SEASON = `${HIST_TH} sticky left-0 z-20 bg-shell ${FREEZE_SEAM_TO_LG}`;
const HIST_TD_SEASON_BASE = `${HIST_TD} sticky left-0 z-10 font-medium ${FREEZE_SEAM_TO_LG}`;
const HIST_TD_SEASON = `${HIST_TD_SEASON_BASE} bg-white`;

/**
 * A throwback season's row: warm clay behind every cell, so the year the whole league drafted
 * fresh is findable in a twenty-row scan rather than only in the star it carries.
 *
 * The fill is split off `HIST_TD_SEASON` rather than appended to it. Two `background-color`
 * utilities on one element resolve by stylesheet order and not attribute order, so `bg-white
 * bg-clay` would pick a winner silently — the `PILL_EXPORT` trap. The other cells carry no fill
 * of their own, so they may take `HIST_TD_ON` freely.
 *
 * It has to be an opaque colour, not `bg-brass/12`: the season cell is sticky, and a translucent
 * fill would let the rows it slides over show through it. Clay is the palette's one warm fill and
 * is reused here rather than minting a near-identical token — a brass wash over white lands
 * within a shade of it anyway.
 */
const HIST_TD_ON = "bg-clay";
const HIST_TD_SEASON_ON = `${HIST_TD_SEASON_BASE} ${HIST_TD_ON}`;

/**
 * The superscript tying a cell to a note under its table: the star on a throwback season in the
 * League History table, the number on a renamed team in the Trophy Case.
 *
 * `font-normal` against the `font-medium` cell it hangs off, and `text-stone` against the ink, so
 * it reads as an annotation rather than as part of the year or the name. The cell is
 * `whitespace-nowrap` already, so it can never wrap away from what it marks.
 */
const HIST_FOOTMARK = "text-[10px] font-normal text-stone";

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
 * `shortenForHistory()` is the only caller, falling back to it for a tie, where a pair of full
 * names would be twice the width the column is sized for. A name `TEAM_CITIES` doesn't know
 * passes through whole, which is the safe failure: a new team reads long beside a column of city
 * words rather than vanishing.
 */
function cityWords(name: string): string {
  return name.split(" & ").map((n) => TEAM_CITIES[n] ?? n).join(" & ");
}

function shortenForHistory(name: string): string {
  if (name.includes(" & ")) return cityWords(name);
  return HISTORY_SHORT_NAMES[name] ?? name;
}

/**
 * One history cell's team name at two lengths: the city word on a phone, `shortenForHistory()`
 * from `sm` up. Both are in the markup and a Tailwind visibility pair picks one, so nothing here
 * decides over the data and a name is still written once, from one source value.
 *
 * **The phone measure is what forces it.** Five `whitespace-nowrap` columns of full names run
 * about 880px, two and a half screens of sideways travel on a 390px viewport, and the scrollbar
 * that gets you there sits below twenty rows of table. City words cut the table to roughly 450px:
 * still a scroll, but one swipe with the year frozen beside it.
 *
 * A name identical at both lengths renders once — a team `TEAM_CITIES` doesn't know has nothing
 * shorter to show, and duplicating it would only pad the HTML.
 *
 * **`abbreviate: false` skips `HISTORY_SHORT_NAMES` and spells the wide form out in full.** That
 * map exists to buy width for the History table's five name columns; the Trophy Case has one name
 * column beside four narrow counts and about 340px of slack at `lg`, so it can afford "South Town
 * Freedom Fighters" written the way the league writes it. The phone tier is unaffected: below `lg`
 * both tables still drop to the city word.
 */
function historyNameHtml(name: string, { abbreviate = true } = {}): string {
  const wide = esc(abbreviate ? shortenForHistory(name) : name);
  const narrow = esc(cityWords(name));
  if (wide === narrow) return wide;
  return `<span class="lg:hidden">${narrow}</span><span class="hidden lg:inline">${wide}</span>`;
}

/**
 * The four name columns of the League History table, in order, declared once so the header row
 * and the body cells can never disagree about which columns exist.
 *
 * **The three bracket finishes run first, in finish order**, and Total Points follows as the
 * one column that isn't a bracket result. The honor cards above the table run in a different
 * order (Total Points third); the two lists are ordered on their own terms and neither follows
 * the other.
 *
 * Every column names a team at full length, through `shortenForHistory()`; dropping the Best
 * Record column is what bought back the measure that pays for it.
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
 * **One layout at every width.** There is no phone variant: the same table, the same columns, the
 * same rows render on a 390px screen as on a desktop. A stacked block-per-season layout was tried
 * below `sm` and dropped — two renderings of one list is a standing sync cost, and sideways scroll
 * is what a wide table is supposed to do.
 *
 * **Every cell is `whitespace-nowrap`**, so a name never wraps to a second line and the columns
 * stay readable straight down. The cost is width, paid in sideways scroll, and three things make
 * that scroll cheap enough to keep:
 * - `w-max min-w-full` on the table, never `w-full`. A `w-full` table squeezes its columns to the
 *   container instead of overflowing, leaving the browser nothing to scroll.
 * - `historyNameHtml()` drops every name to a city word below `lg`, and `HIST_EDGE` tightens the
 *   padding and the type a step earlier, below `md`. Three tiers, sized so the table fits its
 *   container at every width a tablet or a desktop reports:
 *   - below `md` — city words at 13px, ~490px wide, which clears a 640px viewport (576px of
 *     measure). A phone is the one size nothing fits: 390px leaves 350px, so it still scrolls,
 *     and the frozen column plus the edge fade are what carry it.
 *   - `md` to `lg` — city words at 15px, ~597px, against 704px at a 768px iPad.
 *   - `lg` and up — full names at 15px, ~920px, against 960px at 1024 and 1016px once the
 *     1080px measure caps out. **1024 is the tightest point on the page**, roughly 40px of slack,
 *     so a team name longer than "Dinkey Creek Dirt Clods" (23 characters, and the widest string
 *     in every one of the four columns) spends it and puts the scrollbar back on tablets.
 * - `border-separate border-spacing-0` on the table, so the frozen column keeps its own row rule.
 *   Tailwind's preflight collapses tables, and a collapsed table owns its cells' borders — a
 *   sticky cell then paints without them, which is the same trap `ROSTER_STYLES` redraws a pinned
 *   `th`'s edges for. Separated borders look identical here (only `border-t` is ever set, so
 *   nothing was merging in the first place) and the bug simply doesn't arise.
 * - The Season column is frozen (`HIST_TD_SEASON`), so on the phone widths that do still scroll
 *   the year you are reading stays on screen. That matters more than the scrollbar does: the bar
 *   sits under twenty rows of table, out of reach until you have scrolled past the whole thing,
 *   which is why the fade in `TABLE_SCROLL_STYLES` carries the "there is more this way" signal instead.
 */
function leagueHistoryTableHtml(): string {
  if (LEAGUE_HISTORY.length === 0) return "";

  const rows = [...LEAGUE_HISTORY].sort((a, b) => b.season.localeCompare(a.season));

  const tableRows = rows
    .map((r) => {
      // A throwback row is marked twice on purpose: the fill finds it in a scan, the star ties it
      // to the note under the table that says what it means.
      const throwback = isThrowbackSeason(r.season);
      const td = throwback ? `${HIST_TD} ${HIST_TD_ON}` : HIST_TD;
      const cells = HISTORY_COLUMNS.map((c) => {
        const v = c.value(r);
        return v
          ? `<td class="${td}">${historyNameHtml(v)}</td>`
          : `<td class="${td} text-stone">&mdash;</td>`;
      });
      const star = throwback ? `<sup class="${HIST_FOOTMARK}">&#9733;</sup>` : "";
      const seasonCell = throwback ? HIST_TD_SEASON_ON : HIST_TD_SEASON;
      return `                <tr><td class="${seasonCell}">${esc(r.season)}${star}</td>${cells.join("")}</tr>`;
    })
    .join("\n");

  // The gap between the league's first season and the oldest row on the table. Derived rather
  // than written out, so filling in an older season shortens the sentence on its own.
  const earliest = [...LEAGUE_HISTORY].sort((a, b) => a.season.localeCompare(b.season))[0].season;
  const missing = Number(earliest) > Number(LEAGUE_FIRST_SEASON)
    ? `\n      <p class="text-sm text-stone mt-3">${esc(LEAGUE_FIRST_SEASON)}&ndash;${esc(String(Number(earliest) - 1))} are still being compiled.</p>`
    : "";

  // The star's legend, naming the tinted rows and nothing more: the rule itself is the badge's
  // `title` and the Keeper Tiers hub's job, and a sentence of it here would be a paragraph of
  // explanation hanging off one row in twenty. Derived from the rows, so 2030 brings it back on
  // its own and it takes itself off if this table ever stops reaching a throwback year.
  // Whole-table note first, per-row note second, as the Trophy Case orders its own.
  const throwbackNote = rows.some((r) => isThrowbackSeason(r.season))
    ? `\n      <p class="text-sm text-stone mt-3">&#9733; Throwback year</p>`
    : "";

  const headers = ["Season", ...HISTORY_COLUMNS.map((c) => c.header)]
    .map((h, i) => `<th class="${i === 0 ? HIST_TH_SEASON : HIST_TH}">${h}</th>`)
    .join("");

  return `      <div class="${CARD} overflow-hidden">
        <div class="${TBL_SCROLL}">
          <table class="w-max min-w-full text-left border-separate border-spacing-0">
            <thead><tr class="bg-shell">${headers}</tr></thead>
            <tbody>
${tableRows}
            </tbody>
          </table>
        </div>
      </div>${missing}${throwbackNote}`;
}


/** One team's line in the Trophy Case: a name and one count per `HISTORY_COLUMNS` entry. */
interface TrophyRow {
  team: string;
  counts: number[];
}

/**
 * Every finish in `LEAGUE_HISTORY` tallied per team, counted straight off `HISTORY_COLUMNS`.
 *
 * Driving the count from that list rather than from a second list of its own is the point: the
 * Trophy Case counts exactly the columns the table above it shows, so adding Best Record back to
 * `HISTORY_COLUMNS` adds a Trophy Case column in the same edit and the two can never disagree
 * about what a finish is.
 *
 * Two adjustments the raw rows need:
 * - **A renamed team is one team.** `TEAM_ALIASES` folds the old name into the current one before
 *   the count, so an owner who renamed does not appear twice with their record split in half.
 *   The history rows themselves keep the name that team played under, which is what makes the
 *   fold necessary here rather than a rewrite of the data.
 * - **A tie names two teams in one cell** (` & `), and both earned it, so both are counted.
 *
 * Every team in `ACTIVE_TEAMS` gets a row whether or not the history ever names them: a current
 * owner missing from the table reads as an oversight, while a row of dashes reads as a record.
 * Retired teams get no such floor — they are only here at all because they won something.
 *
 * `rawNames` is what the history actually said, before aliasing, so the footnote below the table
 * can name a former name only while that name is still on the page.
 */
function trophyCounts(): { rows: TrophyRow[]; rawNames: Set<string> } {
  const counts = new Map<string, number[]>();
  const rawNames = new Set<string>();
  const zero = () => HISTORY_COLUMNS.map(() => 0);

  for (const r of LEAGUE_HISTORY) {
    HISTORY_COLUMNS.forEach((c, i) => {
      const v = c.value(r);
      if (!v) return;
      for (const name of v.split(" & ")) {
        rawNames.add(name);
        const team = TEAM_ALIASES[name] ?? name;
        const row = counts.get(team) ?? zero();
        row[i] += 1;
        counts.set(team, row);
      }
    });
  }
  for (const team of ACTIVE_TEAMS) if (!counts.has(team)) counts.set(team, zero());

  const rows = [...counts]
    .map(([team, c]) => ({ team, counts: c }))
    // Champions first, runners-up to break it, then the name so the order is stable rather than
    // whatever insertion order happened to produce. Toilet Bowls deliberately rank nobody.
    .sort((a, b) => b.counts[0] - a.counts[0] || b.counts[1] - a.counts[1] || a.team.localeCompare(b.team));

  return { rows, rawNames };
}

/**
 * The `HISTORY_COLUMNS` indexes a Trophy Case table actually renders: every column some row in it
 * has a count in.
 *
 * The Retired Owners table is the reason this exists. Total Points has only been recorded since
 * 2023 and every retired team left before then, so that column is structurally empty there, and a
 * column of nothing but dashes is width spent claiming a record was kept when it wasn't. Derived
 * rather than a hard-coded "retired tables show three columns", so the column comes back on its
 * own the day a retired team turns out to have won one.
 */
function scoredColumns(rows: TrophyRow[]): number[] {
  return HISTORY_COLUMNS.map((_, i) => i).filter((i) => rows.some((r) => r.counts[i] > 0));
}

/**
 * One Trophy Case table: a team column and one count column per entry in `columnIndexes`.
 *
 * Styled as the League History table and reusing its cells outright — same card, same `bg-shell`
 * header strip, same hairline rows, the same frozen first column and the same `TBL_SCROLL` edge
 * fade. It is the same list of names read the other way round, so the two should look like one
 * object seen twice, not two tables that happen to share a page.
 *
 * The team column takes `historyNameHtml()` for the same reason the table above does: full names
 * at `lg` and up, city words below it, so the count columns don't get pushed off a tablet by one
 * long name. Counts are `tabular-nums` and right-aligned so they compare straight down, and a zero
 * renders as the same em dash a blank history cell does rather than as a `0` the eye has to read
 * past.
 *
 * `marks` numbers the teams that carry a note under the table. It is passed to both tables rather
 * than to whichever one currently holds the marked team, so a renamed team that later retires
 * keeps its marker without an edit here.
 */
function trophyTableHtml(
  rows: TrophyRow[],
  teamHeader: string,
  columnIndexes: number[],
  marks: Map<string, number>,
): string {
  const headers = [
    `<th class="${HIST_TH_SEASON}">${esc(teamHeader)}</th>`,
    ...columnIndexes.map((i) => `<th class="${HIST_TH_BASE} text-right">${esc(HISTORY_COLUMNS[i].header)}</th>`),
  ].join("");

  const body = rows
    .map(({ team, counts }) => {
      const cells = columnIndexes
        .map((i) =>
          counts[i] > 0
            ? `<td class="${HIST_TD} text-right tabular-nums">${counts[i]}</td>`
            : `<td class="${HIST_TD} text-right text-stone">&mdash;</td>`,
        )
        .join("");
      const mark = marks.get(team);
      const sup = mark ? `<sup class="${HIST_FOOTMARK}">${mark}</sup>` : "";
      return `                <tr><td class="${HIST_TD_SEASON}">${historyNameHtml(team, { abbreviate: false })}${sup}</td>${cells}</tr>`;
    })
    .join("\n");

  return `      <div class="${CARD} overflow-hidden">
        <div class="${TBL_SCROLL}">
          <table class="w-max min-w-full text-left border-separate border-spacing-0">
            <thead><tr class="bg-shell">${headers}</tr></thead>
            <tbody>
${body}
            </tbody>
          </table>
        </div>
      </div>`;
}

/**
 * The Records section: the same twenty seasons the table above lists, counted per owner.
 *
 * Two tables rather than one, split on `ACTIVE_TEAMS`. A single ranked table would put Chico Pico
 * de Gallo third with three championships and no way to play for a fourth, which reads as a
 * standings error every time it is seen. Splitting them lets the top table answer the question
 * people actually arrive with, who is winning this thing, and still leaves the retired teams their
 * record rather than deleting it.
 *
 * The two tables carry different columns, and neither list is written down: `scoredColumns()`
 * gives each table the columns its own rows scored in, which drops Total Points from Retired
 * Owners because nobody in it played a season where that was recorded.
 *
 * Notes under the Trophy Case run in two groups, and only the second is numbered. The unnumbered
 * one is about the table as a whole (which columns the older seasons never recorded); the numbered
 * ones are about a single line, so they take a superscript on the team they belong to. Both are
 * derived, so both take themselves off when the thing they explain stops being true.
 *
 * Sits directly under the full history table and above the earlier seasons' honor cards, which is
 * the order `HISTORY_SECTIONS` promises: history, records, past leagues.
 *
 * TODO — more records. The private `FFL History & Records` Google Doc's "FFL Stats & Records"
 * section holds all-time bests and worsts (highest and lowest single-game scores, biggest
 * blowouts, closest finishes) that no page renders yet. It is split across three scoring eras
 * (2006-2011, 2012-2019, 2020-2024 PPR) whose numbers are **not comparable**, so any table built
 * from it has to group by era rather than sort one all-time list. Candidate blocks, each its own
 * `SUB_H3` under this same section: Scoring Records (by era), Streaks & Droughts (title droughts,
 * back-to-back champions, consecutive Toilet Bowls), Head-to-Head (all-time series between two
 * owners), Draft Records (keepers held longest, rounds that produced champions).
 */
function recordsHtml(): string {
  if (LEAGUE_HISTORY.length === 0) return "";

  const { rows, rawNames } = trophyCounts();
  const active = rows.filter((r) => ACTIVE_TEAMS.includes(r.team));
  const retired = rows.filter((r) => !ACTIVE_TEAMS.includes(r.team));
  const activeColumns = scoredColumns(active);

  // A former name is worth a note only while the map still knows it *and* the history still says
  // it, so a rewritten row or a deleted alias takes both the note and its superscript away.
  const renames = Object.entries(TEAM_ALIASES).filter(([from]) => rawNames.has(from));
  const marks = new Map(renames.map(([, to], i) => [to, i + 1]));

  // Which columns the older seasons simply never recorded, read off the columns the Trophy Case
  // actually renders. Filling in the missing figures retires the line on its own.
  const thin = activeColumns
    .map((i) => {
      const c = HISTORY_COLUMNS[i];
      const seasons = LEAGUE_HISTORY.filter((r) => c.value(r)).map((r) => r.season).sort();
      return seasons.length < LEAGUE_HISTORY.length
        ? `${c.header} has only been recorded since ${seasons[0]}.`
        : "";
    })
    .filter(Boolean);

  const notes = [...thin, ...renames.map(([from, to], i) => `(${i + 1}) ${to} formerly known as ${from}.`)]
    .map((n) => `      <p class="text-sm text-stone mt-3">${esc(n)}</p>`)
    .join("\n");

  const retiredBlock = retired.length
    ? `
      <h3 class="${SUB_H3} mt-9">Retired Owners</h3>
${trophyTableHtml(retired, "Owner", scoredColumns(retired), marks)}`
    : "";

  return `
    <section id="records" class="mb-14 scroll-mt-6">
      <h2 class="${SECTION_H2}">Records</h2>
      <h3 class="${SUB_H3}">Trophy Case</h3>
${trophyTableHtml(active, "Owner", activeColumns, marks)}
${notes}${retiredBlock}
      <p class="text-sm text-stone mt-6">More records are on the way: scoring highs and lows, streaks, and head-to-head series.</p>
    </section>
`;
}

/**
 * Where every season the league has played actually lives, on the two hosts it has used.
 *
 * The point of the section is that neither host hands you a season directly. Sleeper mints a
 * new league per year and exposes no URL for an old one — `previous_league_id` is an API field,
 * not a route — so the only way in is the app's own Previous Leagues screen, and the copy has to
 * say that rather than pretend a link exists. MyFantasyLeague does have per-season URLs, but
 * they are per-season *ids* with no chain between them, so `MFL_SEASONS` records each one by
 * hand and this renders each as its own `PILL_ON_CARD` tile, newest first.
 *
 * Tiles and not a table: one link per row is four words of content in a five-column frame, and
 * the History table above is already carrying the page's tabular weight. They were a
 * comma-separated line first, which at nineteen years reads as prose and gives the eye nothing
 * to land on; the tiles wrap to three rows in the card and stay scannable as the list grows.
 *
 * The range in each label is derived, never typed. Filling a gap in `MFL_SEASONS` is then the
 * whole edit — the heading moves with the data instead of quietly claiming a year that has no
 * link under it.
 */
function pastLeaguesHtml(): string {
  const byNewest = [...MFL_SEASONS].sort((a, b) => b.season.localeCompare(a.season));
  const mflSpan = byNewest.length
    ? `${esc(byNewest[byNewest.length - 1].season)}&ndash;${esc(byNewest[0].season)}`
    : "";
  const mflLinks = byNewest
    .map(({ season, id }) =>
      `            <a href="${esc(mflHomeUrl(season, id))}" target="_blank" rel="noopener noreferrer" class="${PILL_ON_CARD}">${esc(season)}</a>`,
    )
    .join("\n");

  // Sleeper's first season, so the label stays right the year a third host shows up.
  const sleeperFrom = SLEEPER_FIRST_SEASON;

  const mfl = byNewest.length
    ? `
        <div class="border-t border-rule pt-5">
          <div class="${LABEL_TYPE} mb-2.5">${mflSpan} &middot; MyFantasyLeague</div>
          <div class="flex flex-wrap gap-2">
${mflLinks}
          </div>
        </div>`
    : "";

  return `    <section id="past-leagues" class="mb-14 scroll-mt-6">
      <h2 class="${SECTION_H2}">Past Leagues</h2>
      <div class="${CARD} px-5 py-5 max-w-[720px] flex flex-col gap-5">
        <div>
          <div class="${LABEL_TYPE} mb-2.5">${esc(sleeperFrom)}&ndash;present &middot; Sleeper</div>
          <p class="text-[15px] leading-relaxed">
            <a href="${ARCHIVE_LINKS.sleeper}" target="_blank" rel="noopener noreferrer" class="${LINK}">On Sleeper &#x2197;</a><span class="text-stone">,
            go to Settings &rsaquo; League History &rsaquo; Previous Leagues.</span>
          </p>
        </div>${mfl}
      </div>
    </section>
`;
}

/**
 * The League History page, at `output/history.html` (served as `/history`).
 *
 * A root-level page like the index, so it takes the same `base: ""` chrome and the same 1080px
 * measure. Sections, in order: the sub-nav, the newest season's honors (the same four cards the
 * home page opens on, from the same renderer), the all-time table, Records, then each earlier
 * season.
 *
 * The all-time table sits second rather than last so it holds its place as seasons accumulate;
 * were it below them it would sink another screen every August. The newest season stays above it
 * because a finished season is the thing worth opening on, which is the home page's reasoning too.
 * Records follows the table it counts, and both sit above the earlier seasons' cards so the three
 * sections the sub-nav names appear in the order it names them.
 *
 * Past Leagues closes the page, below the oldest season's cards, matching its place in the
 * sub-nav: it is where to go when this page does not have what you came for, so it reads as the
 * exit rather than as another record.
 */
export function generateHistoryHtml(leagueName: string, navLinks: NavLink[], hasMark = false): string {
  const chrome: SiteChrome = { base: "", hasMark };

  const seasons = Object.keys(SEASON_HONORS).sort().reverse();
  const [newest, ...earlier] = seasons;

  // Every season's cards close with the same prize pointer the home page carries, so the two
  // pages stay a pair and each year routes to whichever record actually holds its money.
  const honorBlocks = (s: string) =>
    honorsSection(s, SEASON_HONORS[s], { id: `s${s}`, badge: throwbackBadgeHtml(s), footer: prizePointerHtml(s) });
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
    extraStyles: TABLE_SCROLL_STYLES,
  })}
<body class="bg-cream text-ink font-sans antialiased">
${siteHeader(chrome)}
  <main class="max-w-[1080px] w-full mx-auto px-5 sm:px-8 pt-10 sm:pt-14 pb-16">
    <h1 class="text-3xl sm:text-4xl font-bold tracking-tight text-ink mb-8">League History</h1>
${historyNavHtml()}
${newest ? honorBlocks(newest) : ""}${allTime}${recordsHtml()}${earlier.map(honorBlocks).join("")}${pastLeaguesHtml()}${backToTopHtml()}
  </main>
</body>
</html>`;
}

// ── Prize Tracker page ──

/** Whole dollars with a thousands separator. Every amount on the page is an integer split. */
function money(n: number): string {
  const whole = Number.isInteger(n);
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/**
 * Every prize line in a season.
 *
 * A pass-through since the labelled groups went (Aug 2026), kept because three callers read
 * the list and naming it once leaves one place to change if a season ever nests them again.
 */
function prizeLines(ps: PrizeSeason) {
  return ps.prizes;
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
/**
 * The prize tables' header cell, split the same way `HIST_TH_BASE` is: the base carries no
 * alignment so the right-aligned money and count columns can set their own. Appending
 * `text-right` to a `PRZ_TH` that already says `text-left` puts two `text-align` utilities on one
 * element, and those resolve by stylesheet order rather than attribute order.
 */
const PRZ_TH_BASE = "px-4 first:pl-5 last:pr-5 py-[9px] text-[11px] font-medium tracking-[0.12em] uppercase text-stone whitespace-nowrap";
const PRZ_TH = `${PRZ_TH_BASE} text-left`;
const PRZ_TD = "px-4 first:pl-5 last:pr-5 py-3 border-t border-rule text-[15px] align-top";
const PRZ_TD_TIGHT = `${PRZ_TD} whitespace-nowrap`;

/**
 * The all-time winnings table's frozen Team column, the Prize Tracker's answer to
 * `HIST_TH_SEASON` / `HIST_TD_SEASON`.
 *
 * Both cells carry their own opaque fill, because a sticky cell slides over the rows beside it and
 * a `<tr>` background does not travel with it — the same rule the History table's frozen column
 * lives by.
 *
 * It takes the bare `FREEZE_SEAM` with no `lg:shadow-none`, unlike the three History-page tables.
 * Those were measured against a width they fit at; this one grows a season column every year, so
 * there is no width at which it settles and no honest breakpoint to hide the seam at.
 */
const PRZ_TH_TEAM = `${PRZ_TH} sticky left-0 z-20 bg-shell ${FREEZE_SEAM}`;
const PRZ_TD_TEAM = `${PRZ_TD_TIGHT} sticky left-0 z-10 bg-white font-medium ${FREEZE_SEAM}`;
/** The provisional marker on a line that has a leader but has not closed. */
const LEADING_TAG = `<span class="ml-2 align-middle inline-block bg-brass text-forest rounded px-1.5 py-px text-[10px] font-semibold tracking-[0.08em] uppercase">Leading</span>`;

/**
 * One season's prizes, as one flat table.
 *
 * It carried three labelled divider rows until Aug 2026 ("Points", "Records & brackets",
 * "Survivor"). Eight lines never needed chapter headings, and the only thing the grouping
 * decided was the order, which the list itself now carries.
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
    .map((h, i) => `<th class="${i === 3 ? `${PRZ_TH_BASE} text-right` : PRZ_TH}">${esc(h)}</th>`)
    .join("");

  const body = prizeLines(ps)
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

  const notes = ps.notes?.length
    ? `\n      <ul class="text-sm text-fern mt-3 list-disc pl-5 flex flex-col gap-1">
${ps.notes.map((n) => `        <li>${esc(n)}</li>`).join("\n")}
      </ul>`
    : "";

  // `TBL_SCROLL` but still `w-full`, which is the one place this site's tables split. The label
  // column wraps on purpose (see CLAUDE.md), so at most widths the table fits and the fade shows
  // nothing at all — it self-hides, which is exactly why hanging it here is free. On a phone the
  // three `nowrap` columns can still push past the measure, and that is the case it is here for.
  // `w-max` would be wrong: it would stop the label wrapping and turn a tall cell into a wide one.
  return `      <div class="${CARD} overflow-hidden">
        <div class="${TBL_SCROLL}">
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
 *
 * It takes the History table's full scrolling kit, and for the same reasons stated there:
 * `w-max min-w-full` so it overflows rather than squeezing (a `w-full` table leaves the browser
 * nothing to scroll), `border-separate border-spacing-0` so the frozen column keeps its own row
 * rule (preflight collapses tables, and a collapsed table owns its cells' borders, which a sticky
 * cell then paints without), `TBL_SCROLL` for the edge fade, and a frozen Team column so the row
 * you are reading stays on screen. Team names are already city words here, so it needs no
 * responsive shortening tier on top.
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
    .map((h, i) => `<th class="${i === 0 ? PRZ_TH_TEAM : `${PRZ_TH_BASE} text-right`}">${esc(h)}</th>`)
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
      return `              <tr><td class="${PRZ_TD_TEAM}">${esc(TEAM_CITIES[team] ?? team)}</td>${cells}<td class="${PRZ_TD_TIGHT} text-right tabular-nums font-semibold">${esc(money(sum(row)))}</td></tr>`;
    })
    .join("\n");

  return `
    <section id="all-time" class="mb-14 scroll-mt-6">
      <h2 class="${SECTION_H2}">All-Time Winnings</h2>
      <div class="${CARD} overflow-hidden">
        <div class="${TBL_SCROLL}">
          <table class="w-max min-w-full text-left border-separate border-spacing-0">
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
 * The closing link: where the seasons this page does not carry actually live.
 *
 * 2023–2025 ran a different prize structure and are settled for good, so they stay in the
 * hand-kept workbook rather than being re-typed into `PRIZE_SEASONS` to render a table that
 * will never change again. Deliberately *not* the home page's labelled closing rows (Aug
 * 2026): those carry two or three destinations each and need a label to say what the set is,
 * while this is one link whose own text says both the years and that it leaves the site.
 *
 * It takes `PILL_LINK` rather than the plain `LINK` it started as, which is the same white
 * pill this page's own season sub-nav uses two screens above it — the site's one treatment for
 * a link sitting on the cream page background. So it reads as a destination rather than as a
 * footnote, without inventing a style: three seasons the tracker does not carry are worth more
 * than 14px of moss text, and `PILL_ON_CARD` was never an option here since nothing is a card.
 *
 * The negative top margin pulls it back under the house-rule notes it follows. A season section
 * carries `mb-14` because that is what separates one season from the next, and this pill is not
 * a section: left at its own positive margin it floated 80px below the last note and read as
 * unattached to anything. `-mt-8` nets ~24px, close enough to belong to the block above it.
 */
function prizeArchiveHtml(): string {
  return `    <div class="-mt-8 pb-12">
      <a href="${ARCHIVE_LINKS.prizeSheet}" target="_blank" rel="noopener noreferrer" class="${PILL_LINK}">Prize winnings 2023&ndash;2025 &#x2197;</a>
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
  const chrome: SiteChrome = { base: "", hasMark };

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
    extraStyles: TABLE_SCROLL_STYLES,
  })}
<body class="bg-cream text-ink font-sans antialiased">
${siteHeader(chrome)}
  <main class="max-w-[1080px] w-full mx-auto px-5 sm:px-8 pt-10 sm:pt-14 pb-16">
    <h1 class="text-3xl sm:text-4xl font-bold tracking-tight text-ink mb-8">Prize Tracker</h1>
${prizesNavHtml(seasons, allTime !== "")}
${blocks}${prizeArchiveHtml()}
${backToTopHtml()}
  </main>
</body>
</html>`;
}

export async function writeHtml(html: string, outputPath: string): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, html, "utf-8");
}
