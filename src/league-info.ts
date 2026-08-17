/**
 * League facts the Sleeper API does not carry.
 *
 * Draft dates, season honors, and prize payouts are settled by hand in the league chat and
 * exist nowhere in a Sleeper response, so this file is the record rather than a cache of one.
 * Same role `tiers.ts` plays for tier boundaries and pick order: hand-maintained config the
 * renderers read, kept out of the renderers themselves.
 *
 * Everything here is keyed by season so old years stay put as new ones land.
 */

/** Wordmark and tagline for the site header. Distinct from the league's Sleeper name. */
export const SITE = {
  wordmark: "Fantasy for Life",
  tagline: "est. 2006",
} as const;

/**
 * Site header navigation.
 *
 * Items with no `href` and no `tiers` flag render dimmed and inert — the page is planned but
 * does not exist yet, and a link that goes nowhere is worse than one that plainly isn't ready.
 * Give an item an `href` and it becomes a live link with no other change needed.
 */
export interface NavItem {
  label: string;
  /** Live destination. Relative hrefs are resolved against the output root by the renderer. */
  href?: string;
  /** Resolves at render time to the newest tiers page that exists. */
  tiers?: boolean;
  /** Renders as the filled pill at the end of the bar. */
  pill?: boolean;
  /** Appends the ↗ mark and opens in a new tab. */
  external?: boolean;
}

export const SITE_NAV: NavItem[] = [
  { label: "Current Tiers", tiers: true },
  { label: "Prize Tracker" },
  { label: "Survivor" },
  { label: "Official Rules" },
  // Written to output/history.html, which Cloudflare Pages serves at /history. The link
  // keeps the extension so it also resolves over file:// during local preview.
  { label: "League History", href: "history.html" },
  { label: "Photo Gallery" },
  { label: "Sleeper", href: "https://sleeper.com/leagues", pill: true, external: true },
];

/**
 * When each season's draft starts, as an ISO string with an explicit offset.
 *
 * The offset is required: the home page counts down to this instant in the viewer's own
 * clock, so a bare local datetime would mean a different moment in every time zone.
 */
export const DRAFT_DATES: Record<string, string> = {
  "2026": "2026-08-29T10:00:00-07:00",
};

/** Draft date for a season, or undefined if it isn't scheduled yet. */
export function getDraftDate(season: string): string | undefined {
  return DRAFT_DATES[season];
}

/**
 * Glyph in an honor card's circle. The paths live in `HONOR_ICONS` in `html.ts`; naming the
 * keys here rather than there makes a typo or a missing glyph a compile error.
 */
export type HonorIcon = "trophy" | "medal" | "trend" | "plunger";

/** A headline result from a completed season, shown as a card on the home page. */
export interface Honor {
  label: string;
  winner: string;
  /** Supporting number, e.g. a point total. Rendered on the label line after a middot. */
  detail?: string;
  icon: HonorIcon;
  /**
   * Card treatment. Omitted is the plain white card; `champion` is the forest card with the
   * brass disc, `toilet` the clay card at the other end of the season. Only one of each
   * belongs in a season, which is why this is a tone and not a boolean.
   */
  tone?: "champion" | "toilet";
}

export const SEASON_HONORS: Record<string, Honor[]> = {
  "2025": [
    { label: "League Champion", winner: "Visalia Viagra Vipers", icon: "trophy", tone: "champion" },
    { label: "Runner-Up", winner: "Sanger Squatty Pottys", icon: "medal" },
    { label: "Total Points", detail: "2,602.3", winner: "Sanger Squatty Pottys", icon: "trend" },
    { label: "Toilet Bowl Champ", winner: "South Town Freedom Fighters", icon: "plunger", tone: "toilet" },
  ],
};

/** The league's first season, and the far end of the history table's "still being compiled" note. */
export const LEAGUE_FIRST_SEASON = "2006";

/** One season's one-line result, as a row of the full league history table. */
export interface SeasonResult {
  season: string;
  /** Left blank (rendered as a dash) for a season whose result hasn't been dug up yet. */
  champion?: string;
  runnerUp?: string;
  toiletBowl?: string;
}

/**
 * Every season's headline result, one row each, oldest-first in the source and rendered newest-first.
 *
 * Deliberately separate from `SEASON_HONORS` rather than derived from it. Honors are a season's
 * free-form highlight reel (a year might record three cards or five, with labels chosen to suit),
 * while this is a fixed four-column spine that has to line up down twenty years. Matching a card
 * by its label string to fill this table would break the day a label is reworded.
 *
 * The cost is that a season with both records names its champion twice, so **change the two
 * together.** A row may leave any name blank; only the pre-Sleeper seasons should need to.
 */
export const LEAGUE_HISTORY: SeasonResult[] = [
  // 2006–2023 are still to be filled in. Nothing in this repo or the Sleeper API records them:
  // those seasons ran on MyFantasyLeague, whose archive carries rosters rather than results.
  {
    season: "2024",
    // The champion and Toilet Bowl winner are the two owners in the trophy photo on the home
    // page; the runner-up isn't recorded anywhere yet.
    champion: "Easton Evil Empire",
    toiletBowl: "Clovis Jets",
  },
  {
    season: "2025",
    champion: "Visalia Viagra Vipers",
    runnerUp: "Sanger Squatty Pottys",
    toiletBowl: "South Town Freedom Fighters",
  },
];

/**
 * One line of a season's prize payout table.
 *
 * Nothing renders this today. The home page carried the full table until the Aug 2026 gallery
 * pass replaced it with the "All 20XX prize winners" link under the honor cards, and that link
 * is inert until a Prize Tracker page exists. The record is kept here, not deleted: it is
 * hand-settled in the league chat and exists in no API, so losing it loses it for good.
 */
export interface Prize {
  label: string;
  /** Qualifier shown small next to the label, e.g. "(10 players, 2 strikes each)". */
  note?: string;
  winner: string;
  /** The number that won it: a record, a point total. Blank for prizes decided by bracket. */
  stat?: string;
  /** Payout, formatted as it should read. */
  amount: string;
  /** The season's top payout. Rendered in bold. */
  headline?: boolean;
}

export const PRIZE_WINNERS: Record<string, Prize[]> = {
  "2025": [
    { label: "Best regular season record", winner: "Vancouver & Visalia (tied)", stat: "10-4", amount: "$100" },
    { label: "Division winner — Keepers", winner: "Vancouver", stat: "10-4", amount: "$75" },
    { label: "Division winner — Sleepers", winner: "Visalia", stat: "10-4", amount: "$75" },
    { label: "Finalist Champion", winner: "Visalia", amount: "$500", headline: true },
    { label: "Finalist Runner-Up", winner: "Sanger", amount: "$250" },
    { label: "Survivor Round 1", note: "(10 players, 2 strikes each)", winner: "Riverstone", amount: "$100" },
    { label: "Survivor winner #2", note: "(8 players, lowest # of revives)", winner: "Lemoore/Kingsburg", amount: "$80" },
    { label: "Highest points, weeks 1–5", winner: "Visalia", stat: "790.92", amount: "$100" },
    { label: "Highest points, weeks 6–11", winner: "Vancouver", stat: "917.56", amount: "$100" },
    { label: "Highest points, weeks 12–17", winner: "Sanger", stat: "984.16", amount: "$100" },
    { label: "Highest points, entire season", winner: "Sanger", stat: "2602.3", amount: "$100" },
    { label: "Highest points, single week", note: "(week 16)", winner: "Sanger", stat: "212.24", amount: "$100" },
  ],
};

/** The most recent season with honors recorded, or undefined if none are. */
export function getLatestHonors(): { season: string; honors: Honor[] } | undefined {
  const season = Object.keys(SEASON_HONORS).sort().reverse()[0];
  return season ? { season, honors: SEASON_HONORS[season] } : undefined;
}

/** The most recent season with a prize table recorded, or undefined if none are. */
export function getLatestPrizes(): { season: string; prizes: Prize[] } | undefined {
  const season = Object.keys(PRIZE_WINNERS).sort().reverse()[0];
  return season ? { season, prizes: PRIZE_WINNERS[season] } : undefined;
}

/**
 * A photo in the home page's gallery column.
 *
 * Files live in `assets/photos/` and are mirrored into `output/assets/` by every run, so
 * adding one here needs no other step. Cutting and naming rules: `docs/photos.md`.
 */
export interface GalleryPhoto {
  /**
   * The cut the column renders, within `assets/photos/` — the renderer supplies the directory
   * and the base prefix. Sized for the slot (~618 CSS px), not for the archive: a file three
   * times the box gets resampled by the browser rather than by ffmpeg, and reads harsh.
   */
  file: string;
  /**
   * The cut the lightbox opens, same directory. Where the detail lives, since it renders at
   * whatever the viewport gives it. Nothing loads this until the photo is clicked.
   */
  full: string;
  alt: string;
  caption: string;
  /**
   * `object-position` for the `cover` crop, when centring puts the subject in the wrong half.
   * Underscores, not spaces — this goes into a Tailwind arbitrary value.
   */
  focus?: string;
  /** Share of the column's height relative to its siblings. Defaults to an equal split. */
  weight?: number;
}

/**
 * The two photos beside the draft order. The column stretches to the draft order card's
 * height and the figures divide it, so this is a fixed pair rather than a feed — adding a
 * third would squeeze all three into letterbox strips. The gallery page is where more go.
 */
export const GALLERY: GalleryPhoto[] = [
  {
    file: "2025-draft-day-league-photo-900.jpg",
    full: "2025-draft-day-league-photo-2000.jpg",
    alt: "The league's ten owners on 2025 draft day, one attending by laptop",
    caption: "Draft Day 2025",
    // The wide frame is the one with room to lose: below the shoes is rug, above the heads is
    // barely a hand's width of wall. So it takes the smaller share and crops from the floor up.
    focus: "50%_18%",
  },
  {
    file: "2024-champion-toilet-bowl-trophies-900.jpg",
    full: "2024-champion-toilet-bowl-trophies-1400.jpg",
    alt: "The 2024 champion and Toilet Bowl trophies, held by their winners",
    // Plain text, not an entity: the renderer runs every caption through `esc()`, so an `&amp;`
    // written here would ship as a literal "&amp;".
    caption: "2024 Champ (Easton) & Toilet Bowl champ (Clovis)",
    // Nearly square, with a hat brim at the very top edge and the engraved plaques at the very
    // bottom, so there is almost nothing to spare either way — hence the heavier weight, which
    // buys it a crop of a few per cent, and the near-top focus that spends those on the piano.
    weight: 1.55,
    focus: "50%_10%",
  },
];

/** Where the pre-Sleeper seasons live. Referenced from the home page footer. */
export const ARCHIVE_LINKS = {
  tiersSheet: "https://docs.google.com/spreadsheets/d/16rS1aBhJR0xg7xzCQGEzE2_-8_wO9F1MFlMVSGpS4g8/pubhtml",
  myFantasyLeague: "https://www42.myfantasyleague.com/2024/home/30136",
  sleeper: "https://sleeper.com/leagues",
} as const;
