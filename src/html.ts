import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Snapshot, SnapshotType, SnapshotRoster, SnapshotPlayer, NavLink, TierConfig, ResolvedTradedPick } from "./types.js";
import { SNAPSHOT_TYPE_LABELS } from "./types.js";
import type { DraftOrder } from "./tiers.js";
import { buildRosterGrid, columnOrderNote, type DraftRoundLookup, type GridRow } from "./roster-grid.js";
import { exportFileName, newestNavLink, pageFileName } from "./snapshot.js";
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
  PHOTO_ARCHIVE,
  type ArchivePhoto,
  SEASON_HONORS,
  LEAGUE_HISTORY,
  LEAGUE_FIRST_SEASON,
  type SeasonResult,
  STAT_ERAS,
  ALL_YEARS_RECORDS,
  ALL_YEARS_SCHEDULE_NOTE,
  type StatRecord,
  type RecordHolder,
  TEAM_CITIES,
  TEAM_ALIASES,
  ACTIVE_TEAMS,
  PRIZE_SEASONS,
  LEAGUE_FACTS,
  RULE_CHANGES,
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
import {
  RULES_PARTS,
  RULES_SEASON,
  RULES_SECTIONS,
  rulesArchive,
  type RulesArchiveEntry,
  type RulesBlock,
  type RulesSection,
} from "./rules.js";

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
 * Roster table wrapper. The max-height is what makes `sticky top-0` on the header work: an
 * overflow container is the scrollport its sticky descendants pin to, so a wrapper that never
 * scrolls vertically is a header that never sticks.
 *
 * The cap is a whole screen, deliberately not "a screen minus the block above the table". That
 * subtraction is what this replaced, and it was the wrong shape: it reserved ~240px for page
 * furniture that scrolls away the moment the page scrolls, then held the box to 582px of an
 * 822px window for the rest of the session. The grids render 619-694px, so the reservation
 * alone was enough to put a second scrollbar beside a table that would otherwise have fitted
 * the screen. At `100dvh` the box is scrollable only when the grid genuinely cannot fit a
 * screen, which is the same moment the sticky header starts earning its keep; below that the
 * wrapper is simply as tall as its table and the page does all the scrolling.
 *
 * The nested scroll container itself is not optional, and that is a CSS constraint rather than
 * a preference: the grid is wider than any viewport, containing that sideways scroll needs
 * `overflow-x`, and a box with one axis scrollable computes the other from `visible` to `auto`
 * and so becomes the scrollport for every sticky descendant. Contained horizontal scroll and a
 * viewport-pinned header cannot both be had. Handing the horizontal scroll to the page instead
 * would slide the site header, the footnotes and the Traded Picks table sideways with the grid.
 */
const TABLE_WRAP = "overflow-auto max-h-[100dvh]";

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
 * Scroll-margin for anything the League History sub-nav can jump to.
 *
 * That bar is sticky from `md` up and stands about 47px tall, so an anchor jump with the plain
 * `scroll-mt-6` lands its heading underneath it. The `md` step is sized to the bar plus air;
 * below `md` the bar is not sticky and the original 24px is still right.
 *
 * Only the History page needs it. `honorsSection()` applies it gated on `opts.id`, which the
 * home page does not pass, so the one shared renderer stays correct on both pages.
 */
const ANCHOR_OFFSET = "scroll-mt-6 md:scroll-mt-16";

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
 * Two users, both lists inside a card: the years in Old League Sites (nineteen of them, wrapping
 * to three rows, which is the point — a comma list of that length reads as prose and gives the
 * eye nothing to land on) and the stage pills on the Keeper Tiers hub.
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
 * `SUB_H3_BASE` carries no margins so a caller can set its own, which the rules page needs: a
 * named part of a rules section wants space above it and the first one in a card does not, and
 * appending `mt-6` to a `SUB_H3` that already says `mt-0` is two `margin-top` utilities on one
 * element, resolved by stylesheet order rather than by intent. Same split, same reason, as
 * `HIST_TH_BASE`. The `first:mt-0` a caller adds on top is a variant, so it sorts after both.
 *
 * Most sections on these pages are a `SECTION_H2` eyebrow over a single card, so a second
 * heading level rarely comes up. Two need it: the League History page's Records, which holds
 * two tables and will hold more, and the home page's rule changes card, whose two lists only
 * work as a split if each says what it is. Three identical uppercase eyebrows would flatten
 * either set into one another. Sentence case at 17px bold reads as the name of the block
 * directly beneath it while staying plainly subordinate to the h1.
 */
const SUB_H3_BASE = "text-[17px] font-bold tracking-tight text-ink";
const SUB_H3 = `${SUB_H3_BASE} mt-0 mb-3`;
/**
 * A note under a table, qualifying what the rows above it mean.
 *
 * Five callers now, across the League History page and the Prize Tracker, so it is a constant for
 * the same reason `SECTION_H2` is: a hand-copied class string is a second definition that has to be
 * kept in step. Every one of them is a `<p>` sitting outside the card it qualifies, at the reading
 * size the tables are deliberately below.
 */
const TABLE_NOTE = "text-sm text-stone mt-3";
/**
 * The traded-picks cells' horizontal padding, tightened a step below `md` — `HIST_EDGE`'s job on
 * the History tables, for the same reason. Five columns, two of them full team names, is more
 * than a phone's measure holds, so the padding is width spent on nothing.
 */
const TP_EDGE = "px-2 md:px-3";
const TP_TH = `text-left text-xs font-medium uppercase tracking-wide text-stone ${TP_EDGE} pb-2.5 border-b border-line whitespace-nowrap`;
/**
 * Cell geometry with no color, so a cell that needs a different one can take it without a conflict.
 *
 * **`whitespace-nowrap` is what makes the table scroll instead of shredding.** Without it a phone
 * squeezes a `w-auto` table down to its container and "Dinkey Creek Dirt Clods" stacks one word
 * per line — a `w-auto` table only overflows while its *min-content* width exceeds the measure,
 * and a wrappable name has almost none. Same rule the History table's cells live by.
 */
const TP_TD_BOX = `${TP_EDGE} py-2.5 border-b border-rule whitespace-nowrap`;
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
  /**
   * This page's path from the output root, for `og:url`: `""` for the home page,
   * `"tiers.html"`, `"2026/rosters-pre-draft.html"`. Unused when `SITE.origin` is empty.
   */
  path?: string;
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
 *
 * `og:url` and `og:image` are the two tags that need an absolute URL, since an unfurler has
 * no page to resolve a relative one against, and they render only while `SITE.origin` is set.
 * The image is the 512px avatar, which is square and so is paired with `twitter:card:
 * summary` (the small thumbnail card); `summary_large_image` wants a 1.91:1 banner and would
 * letterbox the shield. It is the one asset reference on the site that does not take `base`.
 */
function htmlHead({ title, ogTitle, description, siteName, base = "", path = "", extraStyles = "" }: HeadOptions): string {
  const absolute = SITE.origin
    ? `\n  <meta property="og:url" content="${esc(`${SITE.origin}/${path}`)}">` +
      `\n  <meta property="og:image" content="${esc(`${SITE.origin}/assets/ffl-avatar-512.png`)}">` +
      `\n  <meta property="og:image:width" content="512">` +
      `\n  <meta property="og:image:height" content="512">` +
      `\n  <meta property="og:image:alt" content="${esc(`${SITE.wordmark} shield`)}">`
    : "";
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
  <meta property="og:description" content="${esc(description)}">${absolute}
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
function renderGridRows(rows: GridRow[], colSpan: number): string[] {
  return rows.map((row) =>
    row.kind === "tier"
      ? tierRow(row.label, row.tierIndex, colSpan)
      : dataRow(row.cells.map(playerCell)));
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
          ? `<td class="${TP_TD}">${esc(formatPacificDate(p.tradedOn))}</td>`
          : `<td class="${TP_TD_MUTED}">&mdash;</td>`);
      }
      return `      <tr>${cells.join("")}</tr>`;
    })
    .join("\n");
  return `  <div class="${TBL_SCROLL} ${TBL_ON_CREAM} -mx-1">
  <table class="text-[13px] md:text-sm w-auto">
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
  const { rosters, rows } = grid;

  const headerCells = rosters
    .map((r) => `      <th class="${TH}">${esc(r.ownerName)}</th>`)
    .join("\n");

  const dataRows = renderGridRows(rows, rosters.length);

  const navHtml = navBar(navLinks, snapshot.season, `${chrome.base}tiers.html`);
  const refreshHtml = isNewestPage(snapshot, navLinks)
    ? ` <span class="text-stone/70">&middot; ${esc(REFRESH_NOTE)}</span>`
    : "";
  // Sibling file, written by the same run that writes this page.
  const exportHtml = exportRowHtml(exportFileName(snapshot.season, snapshot.snapshotType));

  const styles = TABLE_SCROLL_STYLES + ROSTER_STYLES;

  return `<!DOCTYPE html>
<html lang="en">
${htmlHead({
    title: `${SITE.wordmark} \u2014 ${snapshot.season} ${typeLabel}`,
    ogTitle: `${snapshot.season} ${typeLabel}`,
    description: (OG_DESCRIPTIONS[snapshot.snapshotType] ?? (() => `${snapshot.season} rosters.`))(snapshot.season),
    siteName: SITE.wordmark,
    base: chrome.base,
    path: `${snapshot.season}/${pageFileName(snapshot.snapshotType)}`,
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
${headerCells}
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
 * The cards below the honors: a shortcut to the newest tiers, then whichever of two seasonal
 * cards is live. Before a scheduled draft the second slot is the countdown; once the draft has
 * run it is the prize pool card, so the row reads "what's next" in the offseason and "what's
 * at stake" during the season. Any card can be absent — a fresh season with no pages yet has
 * no tiers to link, and a league with no `PRIZE_SEASONS` entry has no pool to show — and the
 * row simply carries whichever it has.
 *
 * **The countdown card retires itself the moment its draft starts**, rather than sitting at
 * 0 DAYS / 0 HRS / 0 MINS for the eleven months until the next one. It comes back on its own
 * for the 2027 offseason: add `DRAFT_ORDERS["2027"]` in `tiers.ts` and `DRAFT_DATES["2027"]`
 * here, both of which the season checklist already calls for, and the card returns with no
 * edit to this function. That is the whole restore path — there is nothing commented out.
 *
 * **The prize card takes exactly the slot the countdown vacates** (it renders only while no
 * countdown does), so the two swap on the same clock read and the row never holds three. Its
 * figures come from `PRIZE_SEASONS` through the same `money()` / `prizeState()` the Prize
 * Tracker renders with, so the card cannot disagree with the page it links: the pot bold, and
 * the band's own state line ("Not started" / "Through Week N" / "Final") under it. No
 * `tabular-nums`, per the standalone-figure rule the prize band documents.
 *
 * The tiers card names traded picks as well as tiers because the home page no longer carries a
 * traded-picks table of its own; that card is now the only route to one.
 */
/**
 * The next draft's ISO instant while it is still ahead, otherwise undefined.
 *
 * The card and `COUNTDOWN_SCRIPT` both gate on this, so a page can never ship one without the
 * other: a script hunting an element that was not rendered is dead weight, and a card with no
 * script would show en dashes where its numbers go.
 */
function upcomingDraftIso(draftSeason: string | undefined): string | undefined {
  const iso = draftSeason ? getDraftDate(draftSeason) : undefined;
  if (iso == null) return undefined;
  // A draft in the past has nothing left to count. An unparseable date fails this too, which
  // hides the card rather than rendering "Invalid Date" across the top of the home page.
  return new Date(iso).getTime() > Date.now() ? iso : undefined;
}

/**
 * Whether a season's draft has already run, per its `DRAFT_DATES` entry.
 *
 * Deliberately not `!upcomingDraftIso(...)`: the two differ on a season with no date at all,
 * which has an order worth previewing but no draft known to be over, and on an unparseable
 * date, which should keep the draft-prep card rather than claim the draft happened. This is
 * what swaps the columns row's left card from the draft order to the league fact sheet, on
 * the same clock read that retires the countdown, so the two flips land in the same run.
 */
function draftHasRun(season: string | undefined): boolean {
  const iso = season ? getDraftDate(season) : undefined;
  if (iso == null) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t <= Date.now();
}

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

  const draftIso = upcomingDraftIso(draftSeason);
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

  if (!draftIso) {
    const prizeSeason = prizeSeasons()[0];
    const ps = prizeSeason ? PRIZE_SEASONS[prizeSeason] : undefined;
    if (prizeSeason && ps) {
      cards.push(`      <a href="prizes.html" class="no-underline text-ink ${CARD_BASE} ${HERO_CARD} transition-colors hover:border-moss">
        <span>
          <span class="${EYEBROW} text-stone">${esc(prizeSeason)} Prize Pool</span>
          <span class="block text-[21px] font-bold tracking-[-0.02em]">${money(ps.pot)}</span>
          <span class="block text-sm text-stone mt-0.5">${esc(prizeState(ps).text)}</span>
        </span>
        <span class="text-sm font-medium text-moss whitespace-nowrap">View prizes &#8594;</span>
      </a>`);
    }
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
  const scrollMargin = opts.id ? ` ${ANCHOR_OFFSET}` : "";

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
 * clickable — the same problem `ARCHIVE_NOTE` and `RULES_PROSE_LINK` solve with the soft
 * underline. Weight rather than underline here because a card list holds only a few of these
 * and each closes a line that opened bold, where the arrowed pointer reads as part of the
 * rule's typography; the underline belongs to links sitting in running prose.
 */
const RULE_LINK = `${LINK} font-semibold whitespace-nowrap`;

/**
 * Fills `{token}`s in rules prose from the objects that own each figure.
 *
 * Two sources, deliberately separate. `{entryFee}` comes from `PRIZE_SEASONS`: the one prize
 * figure rules prose is allowed, read out of the object the Prize Tracker renders so the two
 * pages can never quote different numbers. Everything else comes from `LEAGUE_FACTS` in
 * `league-info.ts`, which states each structural number once — `{rosterLimit}`, `{keeperCount}`,
 * `{teamCount}`, `{qbLimit}`, `{faabBudget}`, `{tradeDeadlineWeek}`, `{playoffWeeks}` — plus `{draftRounds}`,
 * derived as roster limit minus keepers so the two can never disagree with their difference.
 * Both the home page's rule-changes card and the Official Rules page fill through this one
 * function, which is what keeps a figure from drifting between them.
 *
 * A season with no prize pool recorded leaves `{entryFee}` standing rather than substituting an
 * empty string, so a missing entry reads as an obvious placeholder instead of a sentence with
 * a word silently cut out of it. The fact tokens have no missing state to guard.
 */
function fillRuleTokens(text: string, season: string): string {
  const fee = PRIZE_SEASONS[season]?.entryFee;
  let out = fee === undefined ? text : text.replaceAll("{entryFee}", money(fee));

  const facts: Record<string, string> = {
    teamCount: String(LEAGUE_FACTS.teamCount),
    rosterLimit: String(LEAGUE_FACTS.rosterLimit),
    keeperCount: String(LEAGUE_FACTS.keeperCount),
    qbLimit: String(LEAGUE_FACTS.qbLimit),
    faabBudget: money(LEAGUE_FACTS.faabBudget),
    tradeDeadlineWeek: String(LEAGUE_FACTS.tradeDeadlineWeek),
    playoffWeeks: LEAGUE_FACTS.playoffWeeks,
    draftRounds: String(LEAGUE_FACTS.rosterLimit - LEAGUE_FACTS.keeperCount),
  };
  for (const [token, value] of Object.entries(facts)) {
    out = out.replaceAll(`{${token}}`, value);
  }
  return out;
}

/**
 * One rule as a list item: bold lead-in, detail, optional pointer at the end of the sentence.
 *
 * The pointer sits inside the sentence rather than on its own line: a rule that points
 * somewhere is still a rule, and a block-level link under it would read as the list's own
 * navigation. Shared by the home card's two lists and the rules page's New-in-season section,
 * so a `RuleNote` renders the same wherever it appears. Returns the `<li>` unindented; the
 * caller owns the whitespace.
 */
function ruleNoteLi(n: RuleNote, season: string): string {
  const link = n.link
    ? ` <a href="${esc(n.link.href)}" class="${RULE_LINK}">${esc(n.link.label)} &#8594;</a>`
    : "";
  return `<li class="text-[15px] leading-snug"><span class="font-semibold">${esc(fillRuleTokens(n.label, season))}</span> ${esc(fillRuleTokens(n.detail, season))}${link}</li>`;
}

/**
 * A list of rules under its own sub-heading, one of the rule changes card's two stacked lists.
 *
 * No bullet markers: every line opens on a bold lead-in that already sets it apart, and a
 * marker column beside that would indent every rule to buy nothing.
 */
function ruleListHtml(title: string, notes: RuleNote[], season: string): string {
  const items = notes
    .map((n) => `                ${ruleNoteLi(n, season)}`)
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
 * the two cards do not share a shape: the draft order is one column of ten short rows, and these
 * are rules that each run to a sentence, so half the measure puts most of them on three lines.
 * At the full measure most fall to one.
 *
 * **The two lists stack, changed above unchanged, and are not columns.** They were a
 * `md:grid-cols-2` split until the waiver rules took the changed list to ten against unchanged's
 * five. Two columns of that ratio leave the right one ending halfway up the left, and they make
 * the reading order a guess: an owner scanning the changes reaches the foot of a column and has
 * to go back up for the rest. Stacked, "what's changing" is finished before "staying the same"
 * starts, which is the order somebody opening this card wants them in. It also matches
 * `rulesChangesSectionHtml()`, which has always rendered this same list as one full-width column
 * on the rules page, so the two pages now render a `RuleNote` identically as well as sourcing it
 * from the same object. The lists take no width cap for that reason: adding one here would put
 * the same rules at two measures on two pages.
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
 * partially restated here.
 *
 * **The entry fee is the one figure that survived**, in the unchanged list, and it is still
 * read out of `PRIZE_SEASONS` through the `{entryFee}` token rather than typed into the rule.
 * A cost to enter is the thing an owner needs before the season starts, where the pot and the
 * champion's share are a breakdown that belongs on the page holding the ledger, which the rule
 * links to. Sourcing it is what keeps the two pages from disagreeing, which was the point of
 * dropping the footer row.
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
          <div class="${rules.intro ? "mt-6 " : ""}flex flex-col gap-8">
${ruleListHtml("What's changing", rules.changed, season)}
${ruleListHtml("Staying the same", rules.unchanged, season)}
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
 * The league fact sheet: the draft order card's in-season replacement, in the same slot beside
 * the gallery. Once a draft has run its order is just round one of the board, which the tiers
 * hub's `Draft Results` pill already links, so the slot goes to the questions owners actually
 * ask mid-season — the trade deadline, the playoff weeks, the budgets and limits.
 *
 * **Every value is read from `LEAGUE_FACTS`**, the same object `fillRuleTokens()` fills rules
 * prose from, so this card cannot disagree with the Official Rules page. That is also why it
 * carries no season in its heading: `LEAGUE_FACTS` is the league as it stands, not a
 * season-keyed record, and a year on the card would claim old years stay put when they don't.
 * The money rows stay off on purpose — the prize hero card above already states the pot, and
 * the rule changes card quotes the entry fee, so a third statement here is drift waiting.
 *
 * No `bg-shell` header strip, unlike the draft order card it replaces: strips on this site
 * label columns ("Team") or list groups ("Stages & Drafts"), and a label/value list needs
 * neither, so the first row drops its `border-t` instead of butting against a strip. Same
 * section shell (`flex-1`, 320px floor) so the gallery column's split is undisturbed.
 */
function leagueFactsHtml(): string {
  const facts: [string, string][] = [
    ["Roster limit", `${LEAGUE_FACTS.rosterLimit} players`],
    ["Keepers", `${LEAGUE_FACTS.keeperCount} per team`],
    ["QB limit", `${LEAGUE_FACTS.qbLimit} per team`],
    ["FAAB budget", money(LEAGUE_FACTS.faabBudget)],
    ["Trade deadline", `End of Week ${LEAGUE_FACTS.tradeDeadlineWeek}`],
    ["Playoffs", `Weeks ${LEAGUE_FACTS.playoffWeeks}`],
  ];
  const rows = facts
    .map(([label, value], i) => `          <div class="flex items-baseline gap-4 px-5 py-2.5${i === 0 ? "" : " border-t border-rule"} text-[15px]"><span class="text-stone">${esc(label)}</span><span class="ml-auto font-semibold">${esc(value)}</span></div>`)
    .join("\n");

  return `      <section class="flex-1 ${flexFloor(320)}">
        <h2 class="${SECTION_H2}">League at a Glance</h2>
        <div class="${CARD} overflow-hidden">
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
          <a href="${esc(chrome.base)}gallery.html" class="${LINK}">More in the Photo Gallery &#8594;</a>
        </div>
      </section>`;
}

/**
 * The lightbox's prev/next buttons, minus their side. Typed off the × above it (same sage, same
 * hover, same transparent chrome) so the three controls read as one set, at a larger size and a
 * wider tap target because these two are aimed at rather than reached for. Vertically centred on
 * the overlay, not on the photo: the photo's height changes with every frame, and a control that
 * moved with it would have to be chased.
 */
const LB_NAV =
  "absolute top-1/2 -translate-y-1/2 bg-transparent border-0 px-3 py-6 leading-none text-4xl text-sage hover:text-parchment cursor-pointer select-none";

/**
 * The overlay the gallery photos open into, and the script that drives it.
 *
 * A native `<dialog>` rather than a hand-built overlay: `showModal()` brings the backdrop, the
 * Escape key, the focus trap, and the inert background with it, none of which is worth
 * re-implementing. Both parts render on the two pages with photos (home and the gallery), and
 * only while the caller's own photo list is non-empty — which list that is differs per page,
 * which is why the guard is a parameter rather than a read of `GALLERY`.
 *
 * **The links work without any of this.** `galleryHtml()` wraps each photo in a plain anchor to
 * its full-size file, so the script's job is to intercept that click, not to create it — which
 * is why it bails out early rather than falling back to anything when `<dialog>` is missing.
 * Modified clicks (a middle click, a ctrl/cmd click) fall through deliberately, so "open in a
 * new tab" keeps working on an element that looks like a link because it is one.
 *
 * Closing on any click that is neither the photo nor a `data-lb-nav` button covers the backdrop,
 * the margins, and the × in one rule, so the × needs no handler and no enclosing form. The nav
 * buttons are the one exception, and they are exempted by that attribute rather than by identity
 * so a third control never has to touch the close rule again.
 *
 * The prev/next pair renders only for a list worth stepping through, so a one-photo page gets
 * the overlay with no arrows in it and the script's own guard never has to fire.
 */
function lightboxHtml(photoCount: number): string {
  if (photoCount === 0) return "";

  const nav = photoCount > 1
    ? `
    <button type="button" data-lb-nav data-lb-step="-1" aria-label="Previous photo" class="${LB_NAV} left-1 sm:left-4">&#10094;</button>
    <button type="button" data-lb-nav data-lb-step="1" aria-label="Next photo" class="${LB_NAV} right-1 sm:right-4">&#10095;</button>`
    : "";

  return `  <dialog id="lightbox" class="p-0 m-0 w-full h-full max-w-none max-h-none border-0 bg-transparent backdrop:bg-ink/90">
    <div class="w-full h-full flex flex-col items-center justify-center gap-3 p-4 sm:p-8 cursor-zoom-out">
      <img id="lightbox-image" src="" alt="" class="flex-1 min-h-0 max-w-full object-contain">
      <p id="lightbox-caption" class="m-0 shrink-0 text-sm text-parchment"></p>
    </div>
    <button type="button" aria-label="Close" class="absolute top-3 right-4 bg-transparent border-0 p-2 leading-none text-3xl text-sage hover:text-parchment cursor-pointer">&times;</button>${nav}
  </dialog>`;
}

/**
 * Opens a gallery photo in the `<dialog>` above, and steps between them. Vanilla and inline —
 * the project ships no JS bundle.
 *
 * The photo links themselves are the playlist, in DOM order, so the arrows walk the page's own
 * running order with nothing to keep in sync: `PHOTO_ARCHIVE`'s order on the gallery, `GALLERY`'s
 * on the home page. `show()` reads a frame out of the link it lands on exactly as the click
 * handler does, which is why opening and stepping cannot drift apart.
 *
 * **Stepping wraps.** Ten photos deep in the gallery, the alternative is a disabled arrow at each
 * end, and disabling a control to say "this list has an end" is a worse answer than simply
 * continuing. It also keeps both arrows live in every frame, so neither has a state to style.
 *
 * **`fit()` is what stops a small photo being blown up.** The image is `flex-1`, so its box grows
 * to whatever the overlay has spare and `object-contain` then scales the picture up to fill it:
 * the 318x496 champion shot rendered at ~1.6x on a laptop, which is exactly the browser-side
 * resampling every cut in `docs/photos.md` was sized to avoid. Capping the box at the frame's own
 * `naturalWidth`/`naturalHeight` holds every photo at 1:1 or below. It reads that off the loaded
 * image rather than off a recorded dimension, so it needs no second copy of a number that lives
 * on disk, covers `GALLERY` (which records none) and the archive alike, and cannot drift from a
 * recut file. The `min(100%, …)` keeps the viewport cap that `max-w-full` was providing, and the
 * inline pair is cleared on every step so a frame never inherits the one before it.
 */
const LIGHTBOX_SCRIPT = `  <script>
    (function () {
      var dlg = document.getElementById("lightbox");
      if (!dlg || typeof dlg.showModal !== "function") return;
      var img = document.getElementById("lightbox-image");
      var caption = document.getElementById("lightbox-caption");
      var links = document.querySelectorAll("a[data-lightbox]");
      if (!links.length) return;
      var index = 0;

      function fit() {
        if (!img.naturalWidth) return;
        img.style.maxWidth = "min(100%, " + img.naturalWidth + "px)";
        img.style.maxHeight = "min(100%, " + img.naturalHeight + "px)";
      }
      img.addEventListener("load", fit);

      function show(next) {
        index = (next + links.length) % links.length;
        var link = links[index];
        var thumb = link.querySelector("img");
        img.style.maxWidth = "";
        img.style.maxHeight = "";
        img.src = link.href;
        img.alt = thumb ? thumb.alt : "";
        caption.textContent = link.dataset.caption || "";
        if (img.complete) fit();
      }

      for (var i = 0; i < links.length; i++) {
        links[i].addEventListener("click", function (e) {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault();
          show(Array.prototype.indexOf.call(links, this));
          dlg.showModal();
        });
      }

      var navs = dlg.querySelectorAll("[data-lb-nav]");
      for (var n = 0; n < navs.length; n++) {
        navs[n].addEventListener("click", function () {
          show(index + Number(this.dataset.lbStep));
        });
      }

      dlg.addEventListener("keydown", function (e) {
        if (navs.length === 0) return;
        if (e.key === "ArrowRight") {
          e.preventDefault();
          show(index + 1);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          show(index - 1);
        }
      });

      dlg.addEventListener("click", function (e) {
        if (e.target === img || (e.target.closest && e.target.closest("[data-lb-nav]"))) return;
        dlg.close();
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
  navLinks: NavLink[],
  draftOrder?: DraftOrder,
  hasMark = false,
): string {
  // The newest tiers published, and the only thing on the site that points at a specific
  // stage: it advances on its own as each season's pages are generated. The nav item and the
  // closing link row both go to the hub instead, which lists every stage of every season.
  const latest = newestNavLink(navLinks);
  const chrome: SiteChrome = { base: "", hasMark };

  // The left card and the gallery share a row on wide screens and stack on narrow ones. From
  // the hour a draft runs until the next one lands in DRAFT_DATES, the left card is the league
  // fact sheet rather than an order that has become round one of the finished board.
  const leftCard = draftOrder && draftHasRun(draftOrder.season)
    ? leagueFactsHtml()
    : draftOrderHtml(draftOrder);
  const columnsHtml = `
    <div class="flex gap-10 lg:gap-18 flex-wrap mb-14">
${[leftCard, galleryHtml(chrome)].filter(Boolean).join("\n")}
    </div>
`;

  return `<!DOCTYPE html>
<html lang="en">
${htmlHead({
    title: SITE.wordmark,
    description: "Keeper tiers, draft order, champions, and prize money for a 10-team keeper league running since 2006.",
    siteName: SITE.wordmark,
  })}
<body class="bg-cream text-ink font-sans antialiased">
${siteHeader(chrome)}
  <main class="max-w-[1080px] w-full mx-auto px-5 sm:px-8 pt-10 sm:pt-14 pb-16">
${honorsHtml()}${heroHtml(latest, draftOrder?.season)}${ruleChangesHtml()}${columnsHtml}${survivorNoticeHtml()}${siteLinksHtml()}
${backToTopHtml()}
  </main>
${lightboxHtml(GALLERY.length)}
${upcomingDraftIso(draftOrder?.season) ? COUNTDOWN_SCRIPT : ""}
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
export function generateTiersHtml(navLinks: NavLink[], hasMark = false): string {
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
            <a href="history.html#old-league-sites" class="${ARCHIVE_NOTE}">Drafts linked on past MFL sites</a>
          </span>
        </div>`;

  return `<!DOCTYPE html>
<html lang="en">
${htmlHead({
    title: `${SITE.wordmark} \u2014 Keeper Tiers & Drafts`,
    ogTitle: "Keeper Tiers & Drafts",
    description: "Every season's roster tiers, from pre-draft keepers to final rosters, plus each season's draft board.",
    siteName: SITE.wordmark,
    path: "tiers.html",
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
 * its own `border-b-2`) so the active tab's moss underline lands *on* the rule rather than a
 * pixel above it. Both borders are therefore load-bearing: drop `border-b` from the row and
 * the underline floats, drop `-mb-px` from the items and it doubles the rule's thickness.
 *
 * Items are `whitespace-nowrap`, so the failure mode on a narrow phone is one label dropping
 * to a second line, never a broken label. `gap-y-1` keeps the two lines tight enough to still
 * read as one bar while giving a wrapped row a little air. It was `gap-y-0` while every tab
 * carried an underline, when any vertical gap read as a broken rule; only one tab is underlined
 * now, so the gap costs nothing.
 *
 * **The row is sticky from `md` up.** The page runs about five screens and this bar is its only
 * route between sections, so it is worth the ~47px. That does not reopen the site-header
 * decision in `docs/site-design.md`: that one turned on three facts and none of them holds here.
 * The header is 74-138px against this row's 47; on a roster page a pinned header would sit a
 * second frozen bar over the grid's own sticky `TH`, and this page has no vertical pin at all,
 * its frozen Season column being horizontal; and the header's payoff was one keystroke to a
 * four-item `SITE_NAV`, where this is four in-page jumps on a page you cannot see the ends of.
 * `position: sticky` is pure CSS too, so unlike the floating button it costs nothing over
 * `file://`.
 *
 * Below `md` it scrolls away as it always did. That is exactly the width where the row wraps to
 * two lines, and a phone can least afford ~80px of pinned furniture.
 *
 * Two things it needs, neither of which errors if missed: an opaque `md:bg-cream`, or the table
 * rows scroll under it, and `ANCHOR_OFFSET` on everything it jumps to, or every heading it
 * lands on arrives beneath the bar.
 */
const TAB_ROW =
  "flex flex-wrap items-end gap-x-6 sm:gap-x-7 gap-y-1 mb-11 border-b border-line md:sticky md:top-0 md:z-30 md:bg-cream md:pt-4";
const TAB_BOX = "inline-flex items-baseline gap-2 whitespace-nowrap pb-2.5 -mb-px border-b-2 text-sm font-medium";
/**
 * A live tab at rest. The moss underline moved off this onto `.tab-on`, so it marks the section
 * you are in rather than the sections that work: with the bar pinned in view, four identical
 * underlines say nothing, and where you are is the one thing worth saying.
 */
const TAB_LINK = `${TAB_BOX} border-transparent text-ink no-underline transition-colors hover:text-moss hover:border-moss/40`;
/** An unbuilt section: same geometry, no underline, and inert rather than a link to nowhere. */
const TAB_PLANNED = `${TAB_BOX} border-transparent text-stone cursor-default`;
/** The tag marking a tab that isn't built yet. Small tracked caps, so it reads as a status and not part of the label. */
const TAB_SOON = `<span class="text-[10px] font-semibold tracking-[0.12em] uppercase text-stone/70">Soon</span>`;

/**
 * The tab you are on.
 *
 * One class rather than a utility swap, because the script toggles a single thing per tab.
 * `a.tab-on` is deliberately element-qualified: at 0,1,1 it beats the `border-transparent` and
 * `text-ink` sitting on the same element whatever order the Tailwind CDN injects its utilities
 * in, which a bare `.tab-on` could not promise. Same hazard as the `PILL_EXPORT` trap, fixed
 * with specificity instead of by hoping for source order.
 */
const TAB_STYLES = `    a.tab-on { color: var(--color-moss); border-color: var(--color-moss); }
`;

/**
 * Which section a sticky sub-nav points at, updated as the page scrolls.
 *
 * One script with two callers, addressed by the nav's own id: the History page's section tabs
 * (`history-tabs`) and the rules page's part tabs (`rules-tabs`). It resolves its targets from
 * the links' own `href`s, so a bar whose tabs jump to the first section of a *span* (the rules
 * bar) gets correct you-are-here marking with no extra wiring: standing anywhere inside a span,
 * the last target crossed is that span's first section.
 *
 * An enhancement over a bar that already works: every tab is a plain in-page link, and with the
 * script blocked the server-rendered first tab stays marked, which is exactly true when the page
 * opens. So the no-JS state is not a broken bar, it is a bar that stops keeping up.
 *
 * It picks the **last** section whose top has crossed a line just under the bar, rather than
 * asking an `IntersectionObserver` what is visible. Both read the same at the top of the page,
 * but only this one is right at the bottom: the closing section is short enough that it never
 * reaches the top of the window, so a visibility test leaves the previous tab marked while you
 * stand in Old League Sites. Scrolling past a heading is the question being asked anyway.
 *
 * `requestAnimationFrame` collapses a scroll burst into one paint, and the listeners are
 * `passive` so they never hold up the scroll itself.
 */
function tabsScriptHtml(navId: string): string {
  return `  <script>
    (function () {
      var nav = document.getElementById("${navId}");
      if (!nav) return;
      var links = [].slice.call(nav.querySelectorAll('a[href^="#"]'));
      var sections = links.map(function (a) { return document.getElementById(a.getAttribute("href").slice(1)); });
      if (!sections.length) return;
      var ticking = false;
      function paint() {
        ticking = false;
        var pick = 0;
        for (var i = 0; i < sections.length; i++) {
          if (sections[i] && sections[i].getBoundingClientRect().top <= 96) pick = i;
        }
        for (var j = 0; j < links.length; j++) links[j].classList.toggle("tab-on", j === pick);
      }
      function onScroll() {
        if (ticking) return;
        ticking = true;
        window.requestAnimationFrame(paint);
      }
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", onScroll, { passive: true });
      paint();
    })();
  </script>`;
}

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
 * The underline means "you are here", which it did not until Aug 2026. Every live tab used to
 * carry one, because nothing observed scroll position; the bar going sticky is what made that
 * worth changing, since a pinned row of four identical underlines states nothing you cannot see.
 * `tabsScriptHtml()` moves the mark and `TAB_STYLES` draws it.
 *
 * A tab's label, the heading it lands on and the section's id all say the same thing, and that
 * is the rule to hold when one of them moves. All three were rewritten in Aug 2026: "Records"
 * and "Scoring Records" sat one word apart with nothing to say which held the trophies, and
 * "Full League History" only repeated the h1 above it. So renaming a section is four edits, the
 * `href` here, the `id` on the section, its `<h2>`, and any cross-page link. `ARCHIVE_NOTE` on
 * the Keeper Tiers hub is the only such link today, pointing at `#old-league-sites`.
 *
 * Sits below the h1 rather than at the top of the page so it reads as a switch within League
 * History instead of a second site nav competing with the green bar above it.
 */
const HISTORY_SECTIONS: { label: string; href?: string }[] = [
  { label: "Season Results", href: "#season-results" },
  { label: "Trophy Case", href: "#trophy-case" },
  { label: "Scoring Records", href: "#scoring-records" },
  { label: "Earlier Seasons", href: "#earlier-seasons" },
  { label: "Old League Sites", href: "#old-league-sites" },
];

function historyNavHtml(hasEarlier: boolean): string {
  // Earlier Seasons is the one tab whose section only exists once a second year is written up,
  // so it drops out rather than pointing at nothing. Same self-retiring rule as `scoredColumns()`
  // and the derived notes: it comes back on its own the run after 2024's honors land.
  const sections = HISTORY_SECTIONS.filter((s) => hasEarlier || s.href !== "#earlier-seasons");

  // The first live tab renders marked. That is true at load, and it is the whole no-JS story.
  let first = true;
  const items = sections
    .map(({ label, href }) => {
      if (!href) return `      <span class="${TAB_PLANNED}" title="Coming soon">${esc(label)} ${TAB_SOON}</span>`;
      const on = first ? " tab-on" : "";
      first = false;
      return `      <a href="${esc(href)}" class="${TAB_LINK}${on}">${esc(label)}</a>`;
    })
    .join("\n");

  return `    <nav id="history-tabs" class="${TAB_ROW}">
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
 * One team name at two lengths: the city word on a phone, `shortenForHistory()` above the
 * caller's `from` breakpoint. Both are in the markup and a Tailwind visibility pair picks one, so
 * nothing here decides over the data and a name is still written once, from one source value.
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
 * Freedom Fighters" written the way the league writes it. The phone tier is unaffected: below the
 * switch both tables still drop to the city word.
 *
 * **`from` is where the wide form takes over, and it is per table, not per site.** `lg` is the
 * History and Trophy tables, which spend their whole measure on name columns. The Prize Tracker's
 * ledger carries one name column beside three narrow ones, so it has room for the wide form from
 * `md` and only the phone needs the city word. Both strings are in the markup either way — the
 * breakpoint only picks which one shows, so nothing here decides over the data.
 */
function historyNameHtml(name: string, { abbreviate = true, from = "lg" }: { abbreviate?: boolean; from?: "md" | "lg" } = {}): string {
  const wide = esc(abbreviate ? shortenForHistory(name) : name);
  const narrow = esc(cityWords(name));
  if (wide === narrow) return wide;
  const [hideNarrow, showWide] = from === "md"
    ? ["md:hidden", "hidden md:inline"]
    : ["lg:hidden", "hidden lg:inline"];
  return `<span class="${hideNarrow}">${narrow}</span><span class="${showWide}">${wide}</span>`;
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
    ? `\n      <p class="${TABLE_NOTE}">${esc(LEAGUE_FIRST_SEASON)}&ndash;${esc(String(Number(earliest) - 1))} are still being compiled.</p>`
    : "";

  // The star's legend, naming the tinted rows and nothing more: the rule itself is the badge's
  // `title` and the Keeper Tiers hub's job, and a sentence of it here would be a paragraph of
  // explanation hanging off one row in twenty. Derived from the rows, so 2030 brings it back on
  // its own and it takes itself off if this table ever stops reaching a throwback year.
  // Whole-table note first, per-row note second, as the Trophy Case orders its own.
  const throwbackNote = rows.some((r) => isThrowbackSeason(r.season))
    ? `\n      <p class="${TABLE_NOTE}">&#9733; Throwback year</p>`
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
 * The Retired Owners table is the reason this exists, and that table has already exercised both
 * directions. Total Points reached back only to 2012 while every retired team had left, so the
 * column was structurally empty there and a column of nothing but dashes is width spent claiming
 * a record was kept when it wasn't. Computing 2006-2011 in Aug 2026 gave Canton three and Booty
 * Bay one, and the column came back on its own, which is the whole argument for deriving this
 * rather than hard-coding "retired tables show three columns".
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
 * The Trophy Case section: the same twenty seasons the table above lists, counted per owner.
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
 * Notes under Current Owners run in two groups, and only the second is numbered. The unnumbered
 * one is about the table as a whole (which columns the older seasons never recorded); the numbered
 * ones are about a single line, so they take a superscript on the team they belong to. Both are
 * derived, so both take themselves off when the thing they explain stops being true.
 *
 * Sits directly under the season results table and above the earlier seasons' honor cards, which
 * is the order `HISTORY_SECTIONS` promises: season results, trophy case, scoring records, old
 * league sites.
 *
 * TODO — more records. The private `FFL History & Records` Google Doc's "FFL Stats & Records"
 * section holds all-time bests and worsts that no page renders yet. Scoring Records shipped out
 * of that doc in Aug 2026 as its own section below this one, and its era-major shape is where
 * anything else built from the doc has to start: the eras' numbers are **not comparable**, so a
 * block groups by era rather than sorting one all-time list. Candidates, each its own `SUB_H3`
 * under this section: Streaks & Droughts (title droughts, back-to-back champions, consecutive
 * Toilet Bowls), Head-to-Head (all-time series between two owners), Draft Records (keepers held
 * longest, rounds that produced champions).
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

  // Which columns the older seasons simply never recorded, read off the columns Current Owners
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
    .map((n) => `      <p class="${TABLE_NOTE}">${esc(n)}</p>`)
    .join("\n");

  const retiredBlock = retired.length
    ? `
      <h3 class="${SUB_H3} mt-9">Retired Owners</h3>
${trophyTableHtml(retired, "Owner", scoredColumns(retired), marks)}`
    : "";

  return `
    <section id="trophy-case" class="mb-14 ${ANCHOR_OFFSET}">
      <h2 class="${SECTION_H2}">Trophy Case</h2>
      <h3 class="${SUB_H3}">Current Owners</h3>
${trophyTableHtml(active, "Owner", activeColumns, marks)}
${notes}${retiredBlock}
    </section>
`;
}

/** The muted second line under a team or a record label. */
const STAT_SUB = "text-[12px] text-stone font-normal";

/**
 * An era's anchor, from its own label, so a new era in `STAT_ERAS` is linkable with no edit
 * here. `era-` prefixes it because the labels are bare year ranges and an id of `2006-2011`
 * reads like nothing in particular next to `all-years` beside it.
 */
const eraSlug = (label: string) => `era-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

/**
 * One record's holder lines, and the matching season lines beside them.
 *
 * Returned as a pair because a tie renders two of each and the two columns have to stay in
 * step: the second season cell belongs to the second team cell, and nothing but emitting them
 * together guarantees that. `Michael Vick in 2010` and `Aaron Rodgers in 2011` share a value
 * and nothing else, so a single joined cell could not be read.
 *
 * Team names go through `historyNameHtml()` at the page default, so this table shortens at
 * exactly the widths the History table and the Trophy Case do.
 */
function statHolderCells(holders: RecordHolder[]): { who: string; when: string } {
  const who = holders
    .map((h) => {
      // The beaten side and the player are the same slot: a record is about one or the other,
      // never both, so nothing has to decide which wins.
      const sub = h.player
        ? esc(h.player)
        : h.against
          ? `over ${historyNameHtml(h.against)}${h.score ? ` &middot; ${esc(h.score)}` : ""}`
          : "";
      return `<div>${historyNameHtml(h.team)}</div>${sub ? `<div class="${STAT_SUB}">${sub}</div>` : ""}`;
    })
    .join('<div class="h-2"></div>');

  const when = holders
    .map((h) => {
      const wk = h.week ? ` <span class="${STAT_SUB}">Wk ${esc(h.week)}</span>` : "";
      // The spacer matches the one above only when that holder also drew a sub-line, which is
      // why it is measured off the same two conditions rather than emitted unconditionally.
      const pad = h.player || h.against ? `<div class="${STAT_SUB}">&nbsp;</div>` : "";
      return `<div>${esc(h.season)}${wk}</div>${pad}`;
    })
    .join('<div class="h-2"></div>');

  return { who, when };
}

/**
 * One era's table, or the all-years block, which is the same four columns over fewer rows.
 *
 * `valueHeader` is a parameter and not a constant because the all-years block scores win-loss
 * finishes rather than points, and heading a column of `12-2` with "Points" states something
 * the numbers plainly are not.
 */
function statTableHtml(records: StatRecord[], valueHeader = "Points"): string {
  const body = records
    .map((r) => {
      const { who, when } = statHolderCells(r.holders);
      const scope = r.scope ? `<div class="${STAT_SUB}">${esc(r.scope)}</div>` : "";
      return `                <tr>
                  <td class="${HIST_TD} font-medium">${esc(r.label)}${scope}</td>
                  <td class="${HIST_TD} text-right tabular-nums font-medium align-top">${esc(r.value)}</td>
                  <td class="${HIST_TD}">${who}</td>
                  <td class="${HIST_TD} align-top">${when}</td>
                </tr>`;
    })
    .join("\n");

  return `      <div class="${CARD} overflow-hidden">
        <div class="${TBL_SCROLL}">
          <table class="w-max min-w-full text-left border-separate border-spacing-0">
            <thead><tr class="bg-shell">
              <th class="${HIST_TH}">Record</th>
              <th class="${HIST_TH_BASE} text-right">${esc(valueHeader)}</th>
              <th class="${HIST_TH}">Held by</th>
              <th class="${HIST_TH}">Season</th>
            </tr></thead>
            <tbody>
${body}
            </tbody>
          </table>
        </div>
      </div>`;
}

/**
 * The Scoring Records section: the league's bests and worsts, split by scoring era.
 *
 * **Four tables and not one sorted list, because the numbers do not compare.** PPR in 2020 and
 * Superflex in 2025 each lifted every scoring figure at once, so an all-time "highest single
 * week" would name the newest era every time and read as though 2011 was played badly rather
 * than played differently. The eras are the point of the section, not a filing convenience,
 * which is why each one gets its own heading and its own table instead of an era column.
 *
 * **Newest era first**, matching `LEAGUE_HISTORY`'s render order and the honor cards above it.
 * The all-years block leads, because those two records are the only ones on the page that
 * genuinely survive an era boundary, and saying so first stops the four tables below from
 * reading like one interrupted list.
 *
 * No frozen column here, unlike the three tables above. The row identity is the record label,
 * which runs to about 270px, and pinning that on a 390px phone would leave 120px for the three
 * columns it is meant to keep readable. The `.tbl-scroll` fade carries the affordance instead,
 * the same call the prize ledger makes for the same reason.
 *
 * Sits directly under the Trophy Case and above the earlier seasons' honor cards, matching its
 * place in `HISTORY_SECTIONS`. Everything it renders comes from `STAT_ERAS` and
 * `ALL_YEARS_RECORDS`, so a new era or a filled-in gap is a data edit with nothing to change here.
 */
function statRecordsHtml(): string {
  // Both halves have to be empty before the section goes, not just the eras: the all-years
  // block is a record of its own and would vanish with them under a bare `STAT_ERAS` check.
  if (STAT_ERAS.length === 0 && ALL_YEARS_RECORDS.length === 0) return "";

  const eras = [...STAT_ERAS].reverse();
  const eraBlocks = eras
    .map((era) => {
      const heading = era.scoring
        ? `${esc(era.label)} <span class="${STAT_SUB}">${esc(era.scoring)}</span>`
        : esc(era.label);
      return `      <h3 id="${eraSlug(era.label)}" class="${SUB_H3} mt-9 ${ANCHOR_OFFSET}">${heading}</h3>
${statTableHtml(era.records)}`;
    })
    .join("\n");

  // The section is close to half the page and its era tables are near-identical at a glance, so
  // it carries its own jump row. Local to the block it indexes, which is what separates it from
  // the per-season pills dropped off the top sub-nav in Aug 2026: those grew by one every August
  // and duplicated a list the page already showed, where the eras are a fixed set that changes
  // when the scoring rules do, about once a decade. Pills rather than tabs because the sub-nav
  // above owns that treatment, and `PILL_LINK` because this row sits on the cream page and not
  // inside a card.
  const jumps = [
    ...(ALL_YEARS_RECORDS.length ? [{ href: "#all-years", label: "All Years" }] : []),
    ...eras.map((era) => ({ href: `#${eraSlug(era.label)}`, label: era.label })),
  ];
  const jumpRow =
    jumps.length > 1
      ? `      <nav class="flex flex-wrap items-center gap-2 mb-6">
${jumps.map((j) => `        <a href="${esc(j.href)}" class="${PILL_LINK}">${esc(j.label)}</a>`).join("\n")}
      </nav>`
      : "";

  // The schedule note belongs to this block alone: it qualifies a win-loss figure, and the era
  // tables below score points, where `StatRecord.scope` already states the window per row.
  const allYears = ALL_YEARS_RECORDS.length
    ? `      <h3 id="all-years" class="${SUB_H3} ${ANCHOR_OFFSET}">All Years</h3>
${statTableHtml(ALL_YEARS_RECORDS, "Result")}
      <p class="${TABLE_NOTE}">${esc(ALL_YEARS_SCHEDULE_NOTE)}</p>`
    : "";

  return `
    <section id="scoring-records" class="mb-14 ${ANCHOR_OFFSET}">
      <h2 class="${SECTION_H2}">Scoring Records</h2>
${jumpRow}
${allYears}
${eraBlocks}
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

  return `    <section id="old-league-sites" class="mb-14 ${ANCHOR_OFFSET}">
      <h2 class="${SECTION_H2}">Old League Sites</h2>
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
 * home page opens on, from the same renderer), Season Results, the Trophy Case, Scoring Records,
 * then each earlier season.
 *
 * The season results table sits second rather than last so it holds its place as seasons
 * accumulate; were it below them it would sink another screen every August. The newest season
 * stays above it because a finished season is the thing worth opening on, which is the home
 * page's reasoning too. The Trophy Case follows the table it counts, and both sit above the
 * earlier seasons' cards so the sections the sub-nav names appear in the order it names them.
 *
 * Old League Sites closes the page, below the oldest season's cards, matching its place in the
 * sub-nav: it is where to go when this page does not have what you came for, so it reads as the
 * exit rather than as another record.
 */
export function generateHistoryHtml(navLinks: NavLink[], hasMark = false): string {
  const chrome: SiteChrome = { base: "", hasMark };

  const seasons = Object.keys(SEASON_HONORS).sort().reverse();
  const [newest, ...earlier] = seasons;

  // Every season's cards close with the same prize pointer the home page carries, so the two
  // pages stay a pair and each year routes to whichever record actually holds its money.
  const honorBlocks = (s: string) =>
    honorsSection(s, SEASON_HONORS[s], { id: `s${s}`, badge: throwbackBadgeHtml(s), footer: prizePointerHtml(s) });
  const table = leagueHistoryTableHtml();

  // The earlier seasons get a section of their own so the sub-nav has something to land on.
  // One heading over the run, rather than a tab per year, on the same reasoning that took the
  // per-season pills off the top bar.
  const earlierSeasons = earlier.length
    ? `
    <section id="earlier-seasons" class="mb-14 ${ANCHOR_OFFSET}">
      <h2 class="${SECTION_H2}">Earlier Seasons</h2>
${earlier.map(honorBlocks).join("")}    </section>
`
    : "";

  const seasonResults = table
    ? `
    <section id="season-results" class="mb-14 ${ANCHOR_OFFSET}">
      <h2 class="${SECTION_H2}">Season Results</h2>
${table}
    </section>
`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
${htmlHead({
    title: `${SITE.wordmark} \u2014 League History`,
    ogTitle: "League History",
    description: "Champions, runners-up, and season honors for every recorded season.",
    siteName: SITE.wordmark,
    path: "history.html",
    extraStyles: TABLE_SCROLL_STYLES + TAB_STYLES,
  })}
<body class="bg-cream text-ink font-sans antialiased">
${siteHeader(chrome)}
  <main class="max-w-[1080px] w-full mx-auto px-5 sm:px-8 pt-10 sm:pt-14 pb-16">
    <h1 class="text-3xl sm:text-4xl font-bold tracking-tight text-ink mb-8">League History</h1>
${historyNavHtml(earlier.length > 0)}
${newest ? honorBlocks(newest) : ""}${seasonResults}${recordsHtml()}${statRecordsHtml()}${earlierSeasons}${pastLeaguesHtml()}${backToTopHtml()}
  </main>
${tabsScriptHtml("history-tabs")}
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
 *
 * The figures carry no `tabular-nums`, and that is deliberate. Schibsted Grotesk's tabular
 * figures give the comma a full digit's advance width, so `$1,600` renders with a visible gap
 * either side of it — a defect at 19px bold, and one nothing here buys off, since these four
 * sit in a wrapping flex row rather than a column and have no vertical alignment to hold. The
 * winnings tiles are the same shape and drop it for the same reason. `tabular-nums` stays on
 * the ledger's and the all-time table's amount columns, where figures really do stack.
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
    `<span class="text-center sm:text-right"><span class="block text-[10px] tracking-[0.12em] uppercase ${figureLabel}">${esc(label)}</span><span class="block text-[19px] font-bold">${esc(value)}</span></span>`;

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
          <div class="text-[19px] font-bold">${esc(money(total))}</div>
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
/**
 * The prize tables' horizontal padding and type, both tightened a step below `md`. Straight copy
 * of `HIST_EDGE`'s reasoning: on a phone that padding is width the four columns need more.
 */
const PRZ_EDGE = "px-2 md:px-4 first:pl-3 md:first:pl-5 last:pr-3 md:last:pr-5";
/**
 * **No `whitespace-nowrap`, unlike `HIST_TH_BASE`.** "Leader or Winner" is 16 uppercase characters
 * at 0.12em tracking, about 120px, and held on one line it sets a floor for a column whose rows
 * mostly hold an em dash — which is what squeezed the label column down to one word per line on a
 * phone. Wrapped, the header costs two short lines once instead of width on every row. The
 * all-time winnings table is unaffected: its headers are years and two five-letter words.
 */
const PRZ_TH_BASE = `${PRZ_EDGE} py-[9px] text-[11px] font-medium tracking-[0.12em] uppercase text-stone`;
const PRZ_TH = `${PRZ_TH_BASE} text-left`;
const PRZ_TD = `${PRZ_EDGE} py-3 border-t border-rule text-[13px] md:text-[15px] align-top`;
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
 * Names run through `historyNameHtml()` at `from: "md"`, so a phone reads city words and every
 * width above it reads `shortenForHistory()` — a split as city words, South Town without its
 * nickname. Same renderer as the History table, one breakpoint earlier: this table spends only
 * one of its four columns on a name, so it has the room from `md` that History does not.
 */
function prizeTableHtml(ps: PrizeSeason): string {
  const winnerHeader = ps.final ? "Winner" : "Leader or Winner";
  const headers = ["Prize", winnerHeader, "Result", "Amount"]
    .map((h, i) => `<th class="${i === 3 ? `${PRZ_TH_BASE} text-right` : PRZ_TH}">${esc(h)}</th>`)
    .join("");

  const body = prizeLines(ps)
    .map((line) => {
      const named = (line.winners?.length ?? 0) > 0;
      const label = `<td class="${PRZ_TD}${line.headline ? " font-semibold" : ""}">${esc(line.label)}${line.note ? `<span class="block text-[12px] md:text-[13px] text-stone">${esc(line.note)}</span>` : ""}</td>`;

      // The name holds its line, the Leading tag is free to drop below it. A `nowrap` cell would
      // add the tag's ~65px to this column's floor on the one page where width is scarcest, and
      // that floor would be paid on a phone all season.
      const winner = named
        ? `<td class="${PRZ_TD}"><span class="whitespace-nowrap">${historyNameHtml(line.winners!.join(" & "), { from: "md" })}</span>${line.settled ? "" : LEADING_TAG}</td>`
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
  // nothing at all — it self-hides, which is exactly why hanging it here is free.
  // `w-max` would be wrong: it would stop the label wrapping and turn a tall cell into a wide one.
  //
  // `min-w-[420px]` is the floor that keeps the wrap readable. A bare `w-full` table has no floor
  // at all: the three short columns take their content, the label column takes whatever is left,
  // and on a 390px phone that left "Total points, regular season" stacked one word per line. The
  // number is the three short columns' phone widths (~100 + ~66 + ~64) plus ~190px of label, which
  // is about 24 characters a line at 13px — a two-line wrap for the longest prize name there is.
  return `      <div class="${CARD} overflow-hidden">
        <div class="${TBL_SCROLL}">
          <table class="w-full min-w-[420px] text-left">
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
      <p class="${TABLE_NOTE}">Settled prizes only. A split is divided evenly between its winners.</p>
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
export function generatePrizesHtml(navLinks: NavLink[], hasMark = false): string {
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
    title: `${SITE.wordmark} \u2014 Prize Tracker`,
    ogTitle: "Prize Tracker",
    description: "Prize winners by season, plus all-time winnings.",
    siteName: SITE.wordmark,
    path: "prizes.html",
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

// ── Official Rules ──

/**
 * An inline link inside rules prose: moss with the soft underline, `ARCHIVE_NOTE`'s treatment
 * at body size.
 *
 * Underlined where almost nothing on the site is, because this is the context the underline
 * convention actually serves: a page of running prose whose links sit mid-sentence, where moss
 * alone at 15px reads as emphasis rather than as somewhere to go. The card lists solve the same
 * problem with `RULE_LINK`'s weight instead, which works at three links and turns spotty at the
 * twenty a rules set carries — bold that often would compete with the bold rule lead-ins around
 * it. `decoration-moss/40` keeps the rule reading as an affordance rather than emphasis, the
 * same call `ARCHIVE_NOTE` documents. Standalone rather than built from `LINK`, which carries
 * `no-underline`: appending `underline` to it would be two text-decoration utilities on one
 * element, the `PILL_EXPORT` trap.
 */
const RULES_PROSE_LINK = "text-moss underline underline-offset-2 decoration-moss/40 transition-opacity hover:opacity-70";

/**
 * Rules prose on its way to the page: tokens filled, text escaped, then `[label](href)` links
 * made real.
 *
 * The one place rules content is allowed inline markup, added when the 2026 set moved from
 * transcribing a document to linking Sleeper's own help for every mechanic the league does not
 * decide — a rules page that outsources the how-to needs its links mid-sentence, where the
 * mechanic is named. Escape-then-linkify order is what makes the syntax safe: label and href
 * are already entity-escaped when the pattern runs, so nothing an author types can open a tag
 * of its own. An absolute `https://` href opens a new tab like every outbound link on the site;
 * a relative one (another page here, or a `#anchor`) stays in the tab.
 *
 * Fills through `fillRuleTokens()` with `RULES_SEASON`, so `{entryFee}` reads the season this
 * page describes rather than the newest one with a prize pool.
 */
function rulesText(text: string): string {
  return esc(fillRuleTokens(text, RULES_SEASON)).replace(
    /\[([^\]]+)\]\(([^()\s]+)\)/g,
    (_m, label: string, href: string) =>
      /^https?:\/\//.test(href)
        ? `<a href="${href}" target="_blank" rel="noopener noreferrer" class="${RULES_PROSE_LINK}">${label}</a>`
        : `<a href="${href}" class="${RULES_PROSE_LINK}">${label}</a>`,
  );
}

/**
 * One block of a rules section.
 *
 * A table reuses the League History cells outright, the same borrowing the Trophy Case does, so
 * the site has one table look rather than a rules-page dialect of it. That carries `HIST_TD`'s
 * `whitespace-nowrap`, which suits the scoring tables this is actually for (a stat and a figure)
 * and is what makes a narrow screen scroll the table rather than shred a two-word cell. A table
 * with a column of prose in it would want the prize ledger's treatment instead, a width floor and
 * one wrapping column, and does not exist yet.
 */
function rulesBlockHtml(block: RulesBlock): string {
  switch (block.kind) {
    case "heading":
      return `        <h3 class="${SUB_H3_BASE} mt-6 mb-3 first:mt-0">${esc(block.text)}</h3>`;

    case "text":
      return `        <p class="text-[15px] leading-relaxed mt-0 mb-3 last:mb-0">${rulesText(block.text)}</p>`;

    case "list": {
      const tag = block.ordered ? "ol" : "ul";
      const marker = block.ordered ? "list-decimal" : "list-disc";
      const items = block.items
        .map((item) => `          <li class="pl-1">${rulesText(item)}</li>`)
        .join("\n");
      return `        <${tag} class="${marker} pl-5 text-[15px] leading-relaxed flex flex-col gap-1.5 mt-0 mb-3 last:mb-0">
${items}
        </${tag}>`;
    }

    case "table": {
      const head = block.columns
        .map((col) => `              <th class="${HIST_TH}">${esc(col)}</th>`)
        .join("\n");
      const body = block.rows
        .map((row) => {
          const cells = row
            .map((cell) => `              <td class="${HIST_TD}">${rulesText(cell)}</td>`)
            .join("\n");
          return `            <tr>\n${cells}\n            </tr>`;
        })
        .join("\n");
      return `        <div class="${TBL_SCROLL} mb-3 last:mb-0">
          <table class="w-max min-w-full border-separate border-spacing-0 text-left">
            <thead class="bg-shell">
            <tr>
${head}
            </tr>
            </thead>
            <tbody>
${body}
            </tbody>
          </table>
        </div>`;
    }
  }
}

/** One section: its anchor, its heading, and its blocks in a single card. */
function rulesSectionHtml(section: RulesSection): string {
  const blocks = section.blocks.map(rulesBlockHtml).join("\n");

  return `    <section id="${esc(section.id)}" class="mb-10 ${ANCHOR_OFFSET}">
      <h2 class="${SECTION_H2}">${esc(section.title)}</h2>
      <div class="${CARD} px-5 py-5">
${blocks}
      </div>
    </section>
`;
}

/**
 * What changed this season, as the rules page's first section.
 *
 * Derived from `RULE_CHANGES[RULES_SEASON]` — the same object the home page's card renders —
 * rather than written into `RULES_SECTIONS`, so the two pages cannot tell different stories
 * about what moved. Only the `changed` half renders here: the sections below ARE the rules as
 * they now stand, so restating "staying the same" would say everything on the page twice.
 *
 * The id is `whats-new` rather than a season-numbered one: ids are permanent, and this section
 * survives the yearly turnover with a new season in its title. A season with no changes
 * recorded renders nothing, and its contents entry goes with it.
 */
const RULES_CHANGES_ID = "whats-new";

function rulesChangesSectionHtml(): string {
  const rules = RULE_CHANGES[RULES_SEASON];
  if (!rules || rules.changed.length === 0) return "";

  const items = rules.changed
    .map((n) => `          ${ruleNoteLi(n, RULES_SEASON)}`)
    .join("\n");

  return `    <section id="${RULES_CHANGES_ID}" class="mb-10 ${ANCHOR_OFFSET}">
      <h2 class="${SECTION_H2}">New in ${esc(RULES_SEASON)}</h2>
      <div class="${CARD} px-5 py-5">
        <ul class="m-0 p-0 list-none flex flex-col gap-3">
${items}
        </ul>
      </div>
    </section>
`;
}

/** A part resolved to the sections it spans, in document order. */
interface RulesPartSpan {
  label: string;
  sections: RulesSection[];
}

/**
 * Resolve `RULES_PARTS` against `RULES_SECTIONS`: each part runs from its `from` section to the
 * one before the next part's `from`, so every section belongs to exactly one part by
 * construction.
 *
 * Anything that would drop a section from the nav **throws** instead: a `from` naming no
 * section, parts out of document order, a first part that does not start at the first section,
 * or no parts at all while sections exist. The failure lands at `--generate` time, which is
 * exactly when the August rewrite of `RULES_SECTIONS` is being done, rather than a section
 * silently missing from the bar and the contents groups (the fate CLAUDE.md documents for a
 * renamed `DRAFT_ORDERS` key). An empty `RULES_SECTIONS` returns no spans, keeping the pending
 * page reachable.
 */
function rulesPartSpans(): RulesPartSpan[] {
  if (RULES_SECTIONS.length === 0) return [];
  if (RULES_PARTS.length === 0) {
    throw new Error("RULES_PARTS is empty while RULES_SECTIONS has content, so no section would reach the sub-nav");
  }

  const starts = RULES_PARTS.map((part) => {
    const index = RULES_SECTIONS.findIndex((s) => s.id === part.from);
    if (index === -1) {
      throw new Error(`RULES_PARTS names "${part.from}", which is no RULES_SECTIONS id`);
    }
    return { label: part.label, index };
  });

  if (starts[0].index !== 0) {
    throw new Error(`The first rules part must start at "${RULES_SECTIONS[0].id}", the first section`);
  }
  for (let i = 1; i < starts.length; i++) {
    if (starts[i].index <= starts[i - 1].index) {
      throw new Error(`RULES_PARTS is out of document order at "${RULES_PARTS[i].from}"`);
    }
  }

  return starts.map((start, i) => ({
    label: start.label,
    sections: RULES_SECTIONS.slice(start.index, i + 1 < starts.length ? starts[i + 1].index : undefined),
  }));
}

/**
 * The rules page's sticky sub-nav: one tab per part, plus the archive.
 *
 * The History page's bar reused at part granularity. Its own contents comment used to record why
 * this page had no tab bar (thirteen per-section tabs wrap into three rows of what reads as a
 * second site nav); grouping is what dissolves that objection, since six tabs is the count the
 * pattern already works at. The labels have to hold one row at `md`, which is what keeps them
 * terse; see `RULES_PARTS`.
 *
 * A tab jumps to its part's *first section*, so the bar adds no anchors and no wrapper markup of
 * its own, and the scroll-spy marks the right tab for every section in the span (see
 * `tabsScriptHtml()`). The one special case: when the New-in-season section renders it sits
 * above the first part's first section, so the first tab targets it instead; either way that tab
 * is the top of its span. First tab pre-marked `tab-on`, the same no-JS story as History's bar.
 */
function rulesNavHtml(parts: RulesPartSpan[], hasChanges: boolean): string {
  if (parts.length === 0) return "";

  const tabs = [
    ...parts.map((part, i) => ({
      label: part.label,
      href: `#${i === 0 && hasChanges ? RULES_CHANGES_ID : part.sections[0].id}`,
    })),
    { label: "Past Years", href: "#past-rules" },
  ];

  const items = tabs
    .map(
      (tab, i) =>
        `      <a href="${esc(tab.href)}" class="${TAB_LINK}${i === 0 ? " tab-on" : ""}">${esc(tab.label)}</a>`,
    )
    .join("\n");

  return `    <nav id="rules-tabs" class="${TAB_ROW}">
${items}
    </nav>`;
}

/** One labelled group of the contents card: a part's label over its sections' jump links. */
interface RulesContentsGroup {
  label: string;
  links: { id: string; title: string }[];
}

/**
 * The page's contents, one jump link per section, grouped under the sub-nav's part labels.
 *
 * Still a list in a card rather than a second tab bar: the full per-section index runs past
 * a dozen entries, and that many underlined tabs wrap into three rows of what reads as a nav
 * competing with the green bar above it. The sticky bar above this card carries the part labels
 * instead, and this card stays the complete index. The groups repeat the bar's labels on
 * purpose: the card is what teaches what each terse tab covers ("Scoring" holds Lineups and
 * Injured Reserve), and both render from `rulesPartSpans()`, so they cannot drift apart.
 *
 * Takes assembled groups rather than `RulesSection`s, because two of the page's sections are not
 * in `RULES_SECTIONS`: the derived New-in-season section joins the first part's group, and the
 * archive closes the list. Group labels take the same `LABEL_TYPE` treatment as the archive
 * card's own group labels below. Row-major across the grid rather than CSS columns, so the order
 * reads left to right and does not depend on the browser balancing column heights.
 */
function rulesContentsHtml(groups: RulesContentsGroup[]): string {
  if (groups.length === 0) return "";

  const groupHtml = groups
    .map(
      (g) => `          <div>
            <div class="${LABEL_TYPE} mb-2.5">${esc(g.label)}</div>
            <div class="flex flex-col gap-1.5">
${g.links.map((l) => `              <a href="#${esc(l.id)}" class="${LINK} text-[15px]">${esc(l.title)}</a>`).join("\n")}
            </div>
          </div>`,
    )
    .join("\n");

  return `    <section class="mb-10">
      <h2 class="${SECTION_H2}">On this page</h2>
      <div class="${CARD} px-5 py-5">
        <div class="grid gap-x-6 gap-y-5 sm:grid-cols-2 md:grid-cols-3">
${groupHtml}
        </div>
      </div>
    </section>
`;
}

/**
 * What the page says while the season's rules are still being written.
 *
 * Derived from `RULES_SECTIONS` being empty, so it takes itself off the moment the rules land.
 * It names the newest archived season rather than saying "coming soon" and stopping: a reader who
 * came for the rules can be sent to the most recent published set in the same sentence, and that
 * set is one click below on this same page.
 */
function rulesPendingHtml(archive: RulesArchiveEntry[]): string {
  const newest = archive[0];
  const pointer = newest
    ? ` Until they land here, the ${esc(newest.season)} rules below are the league&rsquo;s most recent published set.`
    : "";

  return `    <section class="mb-10">
      <div class="${CARD} px-5 py-5 max-w-[720px]">
        <p class="text-[15px] leading-relaxed mt-0 mb-0">
          <span class="font-bold">The ${esc(RULES_SEASON)} rules are being finalized.</span><span class="text-stone">${pointer}</span>
        </p>
      </div>
    </section>
`;
}

/**
 * Every past season's rules, as year tiles.
 *
 * Typed like the Old League Sites tiles on the History page, which is the same object: a row of
 * years, each opening a document that is not this page. Tiles rather than a table for the reason
 * that section gives, one link per row being four words in a five-column frame.
 *
 * The two kinds of entry are labelled rather than mixed, because they behave differently under a
 * click: a Google Doc leaves the site and opens in a new tab, a frozen season stays here. The
 * on-site group renders only once a season has been frozen, so today the card is one group and
 * says nothing about a form of link it does not yet hold.
 *
 * **The missing years are derived**, not typed: any season between the league's first and the one
 * this page describes that has no link is named in the note under the card. So finding a 2010
 * document later is one entry in `RULES_DOC_LINKS`, and the note drops the year on its own.
 */
function rulesArchiveHtml(archive: RulesArchiveEntry[]): string {
  if (archive.length === 0) return "";

  const docs = archive.filter((e) => e.external);
  const pages = archive.filter((e) => !e.external);

  const span = (entries: RulesArchiveEntry[]) =>
    `${esc(entries[entries.length - 1].season)}&ndash;${esc(entries[0].season)}`;

  const tiles = (entries: RulesArchiveEntry[]) =>
    entries
      .map((e) =>
        e.external
          ? `            <a href="${esc(e.href)}" target="_blank" rel="noopener noreferrer" class="${PILL_ON_CARD}">${esc(e.season)} &#x2197;</a>`
          : `            <a href="${esc(e.href)}" class="${PILL_ON_CARD}">${esc(e.season)}</a>`,
      )
      .join("\n");

  // Every group after the first takes a rule above it, so a card holding only one renders no
  // stray divider. Same shape the Past Leagues card uses for its Sleeper and MFL halves.
  const group = (entries: RulesArchiveEntry[], label: string, index: number) =>
    `        <div${index === 0 ? "" : ' class="border-t border-rule pt-5"'}>
          <div class="${LABEL_TYPE} mb-2.5">${span(entries)} &middot; ${label}</div>
          <div class="flex flex-wrap gap-2">
${tiles(entries)}
          </div>
        </div>`;

  const groups = ([[pages, "On this site"], [docs, "Google Docs"]] as const)
    .filter(([entries]) => entries.length > 0)
    .map(([entries, label], i) => group(entries, label, i))
    .join("\n");

  // Every season the league has played that this page neither describes nor links. Read off the
  // range rather than a typed list, so a document that turns up later removes its own year here.
  const linked = new Set(archive.map((e) => e.season));
  const missing: string[] = [];
  for (let year = Number(LEAGUE_FIRST_SEASON); year < Number(RULES_SEASON); year++) {
    if (!linked.has(String(year))) missing.push(String(year));
  }
  const note =
    missing.length === 0
      ? ""
      : `
      <p class="${TABLE_NOTE} max-w-[720px]">No rules document survives for ${esc(formatSeasonList(missing))}.</p>`;

  return `    <section id="past-rules" class="mb-10 ${ANCHOR_OFFSET}">
      <h2 class="${SECTION_H2}">Past Years&rsquo; Rules</h2>
      <div class="${CARD} px-5 py-5 max-w-[720px] flex flex-col gap-5">
${groups}
      </div>${note}
    </section>
`;
}

/** "2006, 2007 or 2010" — a plain English list, so the note reads as a sentence. */
function formatSeasonList(seasons: string[]): string {
  if (seasons.length === 1) return seasons[0];
  if (seasons.length === 2) return `${seasons[0]} or ${seasons[1]}`;
  return `${seasons.slice(0, -1).join(", ")} or ${seasons[seasons.length - 1]}`;
}

/**
 * The Official Rules page, at `output/rules.html` (served as `/rules`).
 *
 * A root-level page like the index, History and the Prize Tracker, so it takes the same
 * `base: ""` chrome and the same 1080px measure. One page with anchors rather than a file per
 * section, the same call the League History page made: a full rules set is shorter than one
 * roster table, it is replaced wholesale each August rather than accumulating, and a single file
 * means a reader can search the whole thing at once.
 *
 * In order: the sticky part bar (below the h1, the same placement and reasoning as the History
 * page's), the contents, the rules themselves, then every past season's rules. The archive sits
 * last because it is the least of what somebody opening this page came for, and it is the one
 * part of the page that grows. A back-to-top link closed each part briefly in Aug 2026 and was
 * pulled the same day: five of them between the cards read as clutter against the one long
 * scroll they saved, so the page keeps only the page-end link every page has.
 */
export function generateRulesHtml(navLinks: NavLink[], hasMark = false): string {
  const chrome: SiteChrome = { base: "", hasMark };
  const archive = rulesArchive();

  const changes = rulesChangesSectionHtml();
  const parts = rulesPartSpans();

  // The contents card's groups mirror the bar's tabs exactly: the derived New-in-season section
  // joins the first part, and the archive closes the list under the same label as its tab.
  const contents: RulesContentsGroup[] = [
    ...parts.map((part, i) => ({
      label: part.label,
      links: [
        ...(i === 0 && changes ? [{ id: RULES_CHANGES_ID, title: `New in ${RULES_SEASON}` }] : []),
        ...part.sections,
      ],
    })),
    { label: "Past Years", links: [{ id: "past-rules", title: "Past Years’ Rules" }] },
  ];

  const body = RULES_SECTIONS.length
    ? `${rulesNavHtml(parts, Boolean(changes))}\n${rulesContentsHtml(contents)}${changes}${RULES_SECTIONS.map(rulesSectionHtml).join("")}`
    : rulesPendingHtml(archive);

  // The scroll-spy only ships with the bar it drives, so the pending page stays script-free.
  const tabsScript = RULES_SECTIONS.length ? `\n${tabsScriptHtml("rules-tabs")}` : "";

  return `<!DOCTYPE html>
<html lang="en">
${htmlHead({
    title: `${SITE.wordmark} \u2014 Official Rules`,
    ogTitle: "Official Rules",
    description: "The league's official rules, plus every past season's rulebook.",
    siteName: SITE.wordmark,
    path: "rules.html",
    extraStyles: TABLE_SCROLL_STYLES + TAB_STYLES,
  })}
<body class="bg-cream text-ink font-sans antialiased">
${siteHeader(chrome)}
  <main class="max-w-[1080px] w-full mx-auto px-5 sm:px-8 pt-10 sm:pt-14 pb-16">
    <h1 class="text-3xl sm:text-4xl font-bold tracking-tight text-ink mb-8">Official Rules</h1>
${body}${rulesArchiveHtml(archive)}
${backToTopHtml()}
  </main>${tabsScript}
</body>
</html>`;
}

// ── Photo Gallery page ──

/**
 * The height, in CSS px, a gallery row starts from. Each figure's flex basis is this times its
 * aspect ratio and its grow factor is the aspect alone, so flexbox hands every photo in a row
 * a width proportional to its aspect — which is the one distribution that renders a row of
 * mixed aspects at a single shared height with no crop. A row then stretches only to fill the
 * measure, so real heights run ~220–300px on desktop; on a phone most photos take a row of
 * their own and render full-width.
 */
const GALLERY_ROW_H = 220;

/**
 * One photo in the gallery: the home column's figure, rendered at the photo's own aspect.
 *
 * No cover crop, deliberately breaking from the home column: the league's photos are
 * edge-to-edge group shots and tight trophy portraits, and any uniform cell must clip the
 * subject of one of them (a uniform 4:3 grid was the first cut here, and it took the tenth
 * owner's face off the 2025 draft photo). The home column crops because it shares a height
 * budget with the draft order card; this page scrolls, so nothing forces a crop, and the
 * justified row above is what keeps uncropped mixed aspects from reading as a ragged grid.
 *
 * `ArchivePhoto.width`/`height` ride on the `<img>` so rows hold their height before files load.
 */
function archiveFigureHtml(photo: ArchivePhoto, chrome: SiteChrome): string {
  const aspect = photo.width / photo.height;
  const grow = Number(aspect.toFixed(4));
  const basis = Math.round(GALLERY_ROW_H * aspect);
  return `      <figure class="m-0 flex-[${grow}_1_${basis}px] flex flex-col gap-2">
        <a href="${esc(chrome.base)}assets/photos/${esc(photo.full)}" data-lightbox data-caption="${esc(photo.caption)}" class="block rounded-xl overflow-hidden cursor-zoom-in focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fern">
          <img src="${esc(chrome.base)}assets/photos/${esc(photo.file)}" alt="${esc(photo.alt)}" width="${photo.width}" height="${photo.height}" loading="lazy" decoding="async" class="w-full h-auto rounded-xl border border-line box-border">
        </a>
        <figcaption class="text-[13px] text-fern">${esc(photo.caption)}</figcaption>
      </figure>`;
}

/**
 * The Photo Gallery page, at `output/gallery.html` (served as `/gallery`).
 *
 * A root-level page like the others, on the same `base: ""` chrome and 1080px measure. One
 * flat run of photos in `PHOTO_ARCHIVE`'s own order — newest subject first, back to the
 * league's start — with no season headings and no sub-nav: the whole archive is one scroll,
 * and the captions carry the years. The rows are the justified flex rows `GALLERY_ROW_H`
 * describes, closed by a high-grow spacer that soaks up the last row's slack so its photos
 * keep their natural size instead of stretching to fill the measure. The home column's pair
 * appears here too; the two lists are deliberately separate (see `PHOTO_ARCHIVE`).
 * No `extraStyles`: the page has no scrolling table and no tab bar.
 */
export function generateGalleryHtml(navLinks: NavLink[], hasMark = false): string {
  const chrome: SiteChrome = { base: "", hasMark };
  const hasPhotos = PHOTO_ARCHIVE.length > 0;

  const body = hasPhotos
    ? `    <div class="flex flex-wrap gap-6">
${PHOTO_ARCHIVE.map((p) => archiveFigureHtml(p, chrome)).join("\n")}
      <div class="flex-[999_1_0px]"></div>
    </div>
`
    : `    <p class="text-stone">No photos yet.</p>
`;

  return `<!DOCTYPE html>
<html lang="en">
${htmlHead({
    title: `${SITE.wordmark} \u2014 Photo Gallery`,
    ogTitle: "Photo Gallery",
    description: "League photos back to 2006: draft days, champions, and the Toilet Bowl.",
    siteName: SITE.wordmark,
    path: "gallery.html",
  })}
<body class="bg-cream text-ink font-sans antialiased">
${siteHeader(chrome)}
  <main class="max-w-[1080px] w-full mx-auto px-5 sm:px-8 pt-10 sm:pt-14 pb-16">
    <h1 class="text-3xl sm:text-4xl font-bold tracking-tight text-ink mb-8">Photo Gallery</h1>
${body}
${backToTopHtml()}
  </main>
${lightboxHtml(PHOTO_ARCHIVE.length)}
${LIGHTBOX_SCRIPT}
</body>
</html>`;
}

export async function writeHtml(html: string, outputPath: string): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, html, "utf-8");
}
