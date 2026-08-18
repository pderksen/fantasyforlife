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
  // Written to output/prizes.html, served at /prizes. Same flat-file rule as history.html.
  { label: "Prize Tracker", href: "prizes.html" },
  // No Survivor item: it is not a page and never will be. `SURVIVOR` below says where it lives.
  { label: "Official Rules" },
  // Written to output/history.html, which Cloudflare Pages serves at /history. The link
  // keeps the extension so it also resolves over file:// during local preview.
  { label: "League History", href: "history.html" },
  { label: "Photo Gallery" },
  { label: "Sleeper", href: "https://sleeper.com/leagues", pill: true, external: true },
];

/**
 * The Survivor contest, which runs in its own Sleeper league.
 *
 * A standing notice on the home page rather than a nav item: there is no page to link and no
 * URL worth giving, since Sleeper only renders a survivor league in its mobile app. A desktop
 * click that lands nowhere is worse than plain text naming the constraint, which is the whole
 * content of the notice.
 */
export const SURVIVOR = {
  label: "Survivor",
  line: "Runs in a separate Sleeper league, visible only in the Sleeper mobile app.",
} as const;

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

/**
 * The city word each team is known by, keyed by the full name every other file carries.
 *
 * For the places a full slate of names cannot fit: the League History table's tie cells, its
 * Total Points and Best Record columns, and its whole stacked mobile layout, where a phone has
 * room for one word. Same call `PRIZE_WINNERS` already makes by hand, kept here so the two
 * can't drift once that table gets a page.
 *
 * The folded teams below appear only in `LEAGUE_HISTORY`'s pre-Sleeper rows and join on nothing.
 * They are here because the mobile layout shortens every name it renders, so a name this map
 * doesn't know would sit at full length beside a column of city words.
 */
export const TEAM_CITIES: Record<string, string> = {
  "Clovis Jets": "Clovis",
  "Dinkey Creek Dirt Clods": "Dinkey Creek",
  "Easton Evil Empire": "Easton",
  "Kingsburg Killaz": "Kingsburg",
  "Lemoore Liberators": "Lemoore",
  "Riverstone Stoners": "Riverstone",
  "Sanger Squatty Pottys": "Sanger",
  "South Town Freedom Fighters": "South Town",
  "Vancouver Moose Drool": "Vancouver",
  "Visalia Viagra Vipers": "Visalia",
  // Folded, and named only by the history doc's FFL Champions section.
  "Biola Slugglords": "Biola",
  "Canton HOFers": "Canton",
  "Chico Pico de Gallo": "Chico",
  "Collet Winners": "Collet",
  "Winnemucca Muckers": "Winnemucca",
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
  /** Most regular-season points scored. The team, not the number — the total lives on the honor card. */
  totalPoints?: string;
  /** Best regular-season record. Same rule: the team, not the record. */
  bestRecord?: string;
}

/**
 * Every season's headline result, one row each, oldest-first in the source and rendered newest-first.
 *
 * Deliberately separate from `SEASON_HONORS` rather than derived from it. Honors are a season's
 * free-form highlight reel (a year might record three cards or five, with labels chosen to suit),
 * while this is a fixed six-column spine that has to line up down twenty years. Matching a card
 * by its label string to fill this table would break the day a label is reworded.
 *
 * The cost is that a season with both records names its champion twice, so **change the two
 * together.** A row may leave any name blank; only the pre-Sleeper seasons should need to.
 */
export const LEAGUE_HISTORY: SeasonResult[] = [
  // 2006–2023 come from the "FFL Champions" section of the hand-kept `FFL History & Records`
  // Google Doc, which is the only place those seasons are written down — they ran on
  // MyFantasyLeague, whose archive carries rosters rather than results. The doc is private, so
  // it is not in `ARCHIVE_LINKS`; find it in Drive by name. That
  // section records the three bracket finishes and nothing else, so every pre-2025 row leaves
  // Total Points and Best Record blank. Names of folded teams (Winnemucca, Chico, Canton,
  // Collet, Biola) are kept as the doc writes them; they join on nothing and appear only here.
  { season: "2006", champion: "Winnemucca Muckers", runnerUp: "Chico Pico de Gallo", toiletBowl: "Biola Slugglords" },
  { season: "2007", champion: "Chico Pico de Gallo", runnerUp: "Dinkey Creek Dirt Clods", toiletBowl: "Visalia Viagra Vipers" },
  { season: "2008", champion: "Winnemucca Muckers", runnerUp: "Chico Pico de Gallo", toiletBowl: "Dinkey Creek Dirt Clods" },
  { season: "2009", champion: "Kingsburg Killaz", runnerUp: "Canton HOFers", toiletBowl: "Chico Pico de Gallo" },
  { season: "2010", champion: "Clovis Jets", runnerUp: "Winnemucca Muckers", toiletBowl: "Chico Pico de Gallo" },
  { season: "2011", champion: "Chico Pico de Gallo", runnerUp: "Kingsburg Killaz", toiletBowl: "South Town Freedom Fighters" },
  { season: "2012", champion: "Kingsburg Killaz", runnerUp: "Visalia Viagra Vipers", toiletBowl: "Chico Pico de Gallo" },
  { season: "2013", champion: "Visalia Viagra Vipers", runnerUp: "Chico Pico de Gallo", toiletBowl: "Winnemucca Muckers" },
  { season: "2014", champion: "South Town Freedom Fighters", runnerUp: "Canton HOFers", toiletBowl: "Visalia Viagra Vipers" },
  { season: "2015", champion: "Kingsburg Killaz", runnerUp: "Easton Evil Empire", toiletBowl: "Chico Pico de Gallo" },
  { season: "2016", champion: "Vancouver Moose Drool", runnerUp: "Kingsburg Killaz", toiletBowl: "Collet Winners" },
  { season: "2017", champion: "Chico Pico de Gallo", runnerUp: "South Town Freedom Fighters", toiletBowl: "Clovis Jets" },
  { season: "2018", champion: "Dinkey Creek Dirt Clods", runnerUp: "Winnemucca Muckers", toiletBowl: "South Town Freedom Fighters" },
  { season: "2019", champion: "Easton Evil Empire", runnerUp: "Clovis Jets", toiletBowl: "Dinkey Creek Dirt Clods" },
  { season: "2020", champion: "Clovis Jets", runnerUp: "Sanger Squatty Pottys", toiletBowl: "South Town Freedom Fighters" },
  { season: "2021", champion: "Easton Evil Empire", runnerUp: "Kingsburg Killaz", toiletBowl: "South Town Freedom Fighters" },
  { season: "2022", champion: "Sanger Squatty Pottys", runnerUp: "Easton Evil Empire", toiletBowl: "Visalia Viagra Vipers" },
  { season: "2023", champion: "Kingsburg Killaz", runnerUp: "Winnemucca Muckers", toiletBowl: "Lemoore Liberators" },
  {
    season: "2024",
    // Champion and Toilet Bowl are the two owners in the trophy photo on the home page; the
    // runner-up comes from the history doc.
    champion: "Easton Evil Empire",
    runnerUp: "Kingsburg Killaz",
    toiletBowl: "Clovis Jets",
  },
  {
    season: "2025",
    champion: "Visalia Viagra Vipers",
    runnerUp: "Sanger Squatty Pottys",
    toiletBowl: "South Town Freedom Fighters",
    totalPoints: "Sanger Squatty Pottys",
    // Two teams finished 10-4; the prize was split, so the cell names both. Full names here and
    // in every row: ` & ` is the tie the table's renderer keys on to drop the pair to city words.
    bestRecord: "Vancouver Moose Drool & Visalia Viagra Vipers",
  },
];

/**
 * One line of a season's prize payout table.
 *
 * Nothing renders this, and the Prize Tracker page will not: it starts at 2026, where a new
 * prize structure starts. The home page's "All 2025 prize winners" link now points at
 * `ARCHIVE_LINKS.prizeSheet`, which carries the same numbers plus 2024's.
 *
 * Kept rather than deleted only because it is a second copy of a hand-settled record that
 * exists in no API. If the sheet is judged durable enough on its own, this and its `Prize`
 * interface can go in one edit — nothing imports either. **Not** the shape to extend for a
 * new season; that is `PrizeSeason` below.
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

// ── Prize Tracker (2026 and beyond) ──

/**
 * One prize line: what it pays, and who is winning or has won it.
 *
 * **`amount` is a number, not a formatted string**, because the page sums it three ways: the
 * status band's awarded and still-open figures, and the per-team winnings tiles. A tie splits
 * it evenly across `winners`, which is how every split in the league's history has worked.
 */
export interface PrizeLine {
  label: string;
  /** Qualifier shown small under the label, e.g. "(lowest strikes)". */
  note?: string;
  /** Payout in whole dollars, before any split. */
  amount: number;
  /**
   * Empty or absent until the prize has someone attached to it. More than one name is an
   * even split. Full team names, as everywhere else; the renderer shortens them to fit.
   */
  winners?: string[];
  /** The number winning it: a point total, a record. Blank for prizes decided by bracket. */
  stat?: string;
  /**
   * Whether the result can still change. A named winner on an unsettled line is a *leader*,
   * and renders as one, which is the whole difference between this page in October and the
   * same page in February.
   */
  settled?: boolean;
  /** The season's top payout. Rendered bold with a brass amount. */
  headline?: boolean;
}

/**
 * A labelled run of prize lines, rendered under a divider row inside the one table.
 *
 * Groups exist because the result column means different things in different parts of the
 * list (a point total above the line, a win-loss record below it), and because that split
 * happens to be the same line as computed-from-Sleeper versus settled-by-hand.
 */
export interface PrizeGroup {
  label: string;
  prizes: PrizeLine[];
}

/** One season's prize pool: what was put in, what it pays out, and how current that is. */
export interface PrizeSeason {
  /** Per owner. Stated on the page, never used in a subtraction. */
  entryFee: number;
  /**
   * What the entry fees make. Shown beside the awarded and still-open figures rather than
   * having either derived from it: the prize list has historically totalled more than the
   * pot, and a "remaining" number computed against the pot would render as a negative and
   * read as a bug rather than as a fact about the league.
   */
  pot: number;
  /**
   * How current the numbers are, e.g. "Week 12". Omitted before the season starts, which is
   * a third state the band renders on its own ("Not started").
   */
  through?: string;
  /** Every line decided. Swaps the status band to its settled treatment and drops "leader". */
  final?: boolean;
  groups: PrizeGroup[];
  /** House rules, listed under the table. */
  notes?: string[];
}

/**
 * The prize pool, per season, from 2026 forward.
 *
 * **2023–2025 are deliberately absent.** They ran a different structure (three partial-season
 * points windows, two Survivor contests) that the 2026 rules replaced, and they are already
 * recorded in `ARCHIVE_LINKS.prizeSheet`, which the page links at the bottom. Carrying them
 * here would mean maintaining a second prize shape forever to render a table that will never
 * change again.
 */
export const PRIZE_SEASONS: Record<string, PrizeSeason> = {
  "2026": {
    entryFee: 160,
    pot: 1600,
    // No `through` and no `final`: the season has not started, so every line is open. As
    // results land, set `through` each week and flip `settled` on the lines that close.
    groups: [
      {
        // Every line here is derivable from `/league/{id}/matchups/{week}`, which is why the
        // 2026 rules could drop the partial-season windows the old sheet called hard to total.
        label: "Points",
        prizes: [
          { label: "Total points, regular season", amount: 200 },
          { label: "Total points runner-up, regular season", amount: 100 },
          { label: "Highest points, single week", note: "Regular season", amount: 100 },
          { label: "Top single player, single week", note: "New for 2026", amount: 100 },
        ],
      },
      {
        label: "Records & brackets",
        prizes: [
          { label: "Finalist Champion", amount: 500, headline: true },
          { label: "Finalist Runner-Up", amount: 250 },
          { label: "Best regular season record", amount: 100 },
          { label: "Division winner — Keepers", amount: 75 },
          { label: "Division winner — Sleepers", amount: 75 },
        ],
      },
      {
        label: "Survivor",
        prizes: [
          { label: "Survivor winner", note: "All 17 weeks, fewest revives and strikes", amount: 100 },
        ],
      },
    ],
    notes: [
      "Owners can win multiple prizes.",
      "If both finalists agree, they may split the pot or go winner-takes-all, decided before that weekend's games start.",
      "Side bets are optional and must be posted in the forums.",
    ],
  },
};

/** Seasons with a prize pool recorded, newest first. */
export function prizeSeasons(): string[] {
  return Object.keys(PRIZE_SEASONS).sort().reverse();
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
  /**
   * The hand-kept prize workbook, one tab per season. It is the record for 2023–2025, which
   * the Prize Tracker page deliberately does not carry: those seasons ran a different prize
   * structure, and re-typing them into `PRIZE_SEASONS` would mean maintaining two shapes to
   * render a table nobody updates. Linked from the bottom of the tracker and from the home
   * page's honors footer instead.
   */
  prizeSheet: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTK8Z1nYo4iLi97t49Nxgdn6m6dSBQo_OyXw3IXe1FTN8KLiPSFBQICBKvdqv-U1CtLieOB9GIvvpAf/pubhtml",
  myFantasyLeague: "https://www42.myfantasyleague.com/2024/home/30136",
  sleeper: "https://sleeper.com/leagues",
} as const;
