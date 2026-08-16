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
  { label: "History & Records" },
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

/** A headline result from a completed season, shown as a card on the home page. */
export interface Honor {
  label: string;
  winner: string;
  /** Supporting number, e.g. a point total. */
  detail?: string;
  /** The season's top result. Takes the brass rule and heavier weight. */
  headline?: boolean;
}

export const SEASON_HONORS: Record<string, Honor[]> = {
  "2025": [
    { label: "Finalist Champion", winner: "Visalia", headline: true },
    { label: "Finalist Runner-Up", winner: "Sanger" },
    { label: "Total Points", winner: "Sanger", detail: "2,602.3" },
    { label: "Survivor Round 1", winner: "Riverstone" },
  ],
};

/** One line of a season's prize payout table. */
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

/** Where the pre-Sleeper seasons live. Referenced from the home page footer. */
export const ARCHIVE_LINKS = {
  tiersSheet: "https://docs.google.com/spreadsheets/d/16rS1aBhJR0xg7xzCQGEzE2_-8_wO9F1MFlMVSGpS4g8/pubhtml",
  myFantasyLeague: "https://www42.myfantasyleague.com/2024/home/30136",
  sleeper: "https://sleeper.com/leagues",
} as const;
