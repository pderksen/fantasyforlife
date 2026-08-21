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

/**
 * Wordmark, tagline, and public origin. Distinct from the league's Sleeper name
 * ("Fantasy For Life (FFL)"), which stays verbatim wherever the registered league is
 * being quoted rather than the site being named, which is now exactly one place: the league
 * line under a roster page's h1, read off `snapshot.leagueName`.
 *
 * `origin` is the Cloudflare Pages host, no trailing slash, and it exists for exactly one
 * job: `og:url` and `og:image` are the only two things on the site that cannot be a
 * relative path, since an unfurler resolves them against nothing. Everything else stays
 * relative so the pages still open over `file://` during local preview. Setting it to `""`
 * drops both tags rather than emitting a broken absolute URL, which is the state this
 * project sat in until the host was written down: a wrong canonical URL in a preview card
 * is worse than an absent one.
 */
export const SITE = {
  wordmark: "Fantasy For Life",
  tagline: "est. 2006",
  origin: "https://fantasyforlife.pages.dev",
} as const;

/**
 * Refresh cadence, shown on the newest tiers page only.
 *
 * That page is the one people open to see whether a keeper or a trade has landed yet, so it is
 * the only page where the answer to "how current is this?" is worth the line. Every other roster
 * page is a sealed record and its footer timestamp already says when it stopped moving.
 *
 * Hand-maintained rather than derived from `.github/workflows/refresh.yml`: the schedule there is
 * two cron expressions (daily through August for the keeper watch, Thursdays September through
 * January in season, nothing February through July), and a renderer that guessed at which one is
 * live would state a cadence the workflow was not actually keeping. Reword this when the season
 * turns over.
 */
export const REFRESH_NOTE = "Updated nightly or upon request";

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
  /** Renders as the filled pill at the end of the bar. */
  pill?: boolean;
  /** Appends the ↗ mark and opens in a new tab. */
  external?: boolean;
}

export const SITE_NAV: NavItem[] = [
  // Written to output/tiers.html, served at /tiers. The hub listing every season's tiers
  // pages, not the newest one: the nav is where you go when you don't already know which
  // season and stage you want. The home page's hero card is what points at the newest.
  { label: "Keeper Tiers", href: "tiers.html" },
  // Written to output/prizes.html, served at /prizes. Same flat-file rule as history.html.
  { label: "Prize Tracker", href: "prizes.html" },
  // Written to output/history.html, which Cloudflare Pages serves at /history. The link
  // keeps the extension so it also resolves over file:// during local preview.
  { label: "League History", href: "history.html" },
  // No Survivor item: it is not a page and never will be. `SURVIVOR` below says where it lives.
  { label: "Official Rules" },
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
 * The first throwback season, and the cadence after it.
 *
 * Every fifth year nobody keeps a player: the whole league drafts fresh, so a throwback
 * season has no keepers to carry and its pre-draft snapshot is skipped entirely. The tiers
 * hub badges those years, since a season showing only two stages otherwise reads as a
 * capture someone forgot to take.
 *
 * Derived from the cadence rather than inferred from a missing pre-draft page, which is what
 * the pre-redesign badge did: that rule badges any season whose pre-draft capture was simply
 * missed, and it would be wrong silently.
 */
const THROWBACK_FIRST = 2025;
const THROWBACK_EVERY = 5;

/** Whether a season drafts fresh, with no keepers carried from the year before. */
export function isThrowbackSeason(season: string): boolean {
  const year = Number(season);
  return Number.isFinite(year) && year >= THROWBACK_FIRST && (year - THROWBACK_FIRST) % THROWBACK_EVERY === 0;
}

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
 * Sleeper's draft id per season, which is all a public draft board needs.
 *
 * Hand-kept and added the season a draft finishes, deliberately not read out of
 * `data/<season>/draft-picks.json`: a season's row should link its results because the draft
 * happened, not because a snapshot of it landed, and the ids are already written down in
 * CLAUDE.md's League table. A season with no entry simply renders no link, which is the state
 * every upcoming season sits in until its draft runs.
 *
 * Sleeper seasons only. 2006-2024 drafted on MyFantasyLeague, whose boards are reachable from
 * the Past Leagues section of the League History page instead.
 */
export const SLEEPER_DRAFT_IDS: Record<string, string> = {
  "2025": "1220634181302767616",
};

/** A season's public Sleeper draft board, or undefined until that draft has run. */
export function draftResultsUrl(season: string): string | undefined {
  const id = SLEEPER_DRAFT_IDS[season];
  return id ? `https://sleeper.com/draft/nfl/${id}` : undefined;
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
 * The retired teams below appear only in `LEAGUE_HISTORY`'s pre-Sleeper rows and join on nothing.
 * They are here because the mobile layout shortens every name it renders, so a name this map
 * doesn't know would sit at full length beside a column of city words. Same reason Winnemucca
 * Muckers is still listed: a renamed team's old name goes on rendering in the rows it won.
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
  // Retired, and named only by the history doc's FFL Champions section.
  "Biola Slugglords": "Biola",
  "Canton HOFers": "Canton",
  "Chico Pico de Gallo": "Chico",
  "Collet Winners": "Collet",
  // Not retired: the Riverstone Stoners under their old name. See `TEAM_ALIASES`.
  "Winnemucca Muckers": "Winnemucca",
};

/**
 * A team's former name mapped to the name that team goes by today.
 *
 * The League History table is a record of what happened, so a season keeps the name the team
 * actually played under: 2006 says Winnemucca Muckers because that is who won it. The Trophy
 * Case is a record of *owners*, and an owner who renamed their team did not start over at zero,
 * so it folds the old name into the new one before counting. Nothing else consults this map —
 * every join key in the repo is a current name already.
 *
 * A team that leaves the league belongs in neither this map nor `ACTIVE_TEAMS`; it falls through
 * to the Trophy Case's retired table on its own.
 */
export const TEAM_ALIASES: Record<string, string> = {
  // Renamed for the 2024 season; last appears as Winnemucca in the 2023 runner-up row.
  "Winnemucca Muckers": "Riverstone Stoners",
};

/**
 * The ten teams currently in the league, and the only list that decides which Trophy Case table
 * a team lands in: named here it is active, absent it is retired.
 *
 * Hand-maintained rather than read off a snapshot, because the History page reads no snapshot
 * data at all (`generateHistoryHtml()` takes a league name and a nav, nothing else) and giving it
 * a data dependency to answer one yes/no question is a poor trade. A team that joins or leaves is
 * one edit here plus, if they leave, nothing else — the retired table fills itself from whatever
 * the history names that this list does not.
 */
export const ACTIVE_TEAMS: string[] = [
  "Clovis Jets",
  "Dinkey Creek Dirt Clods",
  "Easton Evil Empire",
  "Kingsburg Killaz",
  "Lemoore Liberators",
  "Riverstone Stoners",
  "Sanger Squatty Pottys",
  "South Town Freedom Fighters",
  "Vancouver Moose Drool",
  "Visalia Viagra Vipers",
];

/** The league's first season, and the far end of the history table's "still being compiled" note. */
export const LEAGUE_FIRST_SEASON = "2006";

/** One season's one-line result, as a row of the full league history table. */
export interface SeasonResult {
  season: string;
  /** Left blank (rendered as a dash) for a season whose result hasn't been dug up yet. */
  champion?: string;
  runnerUp?: string;
  toiletBowl?: string;
  /** Most points scored over the full season. The team, not the number — the total lives on the honor card. */
  totalPoints?: string;
  /**
   * Best regular-season record. Same rule: the team, not the record.
   *
   * **Nothing renders this.** The History table dropped its Best Record column in Aug 2026 to
   * buy back the width that lets Total Points spell a team out; the 2025 value is kept because
   * it is a split tie recorded nowhere else in the repo, and re-adding the column is then a
   * one-line edit to `HISTORY_COLUMNS`. A new season need not fill it.
   */
  bestRecord?: string;
}

/**
 * Every season's headline result, one row each, oldest-first in the source and rendered newest-first.
 *
 * Deliberately separate from `SEASON_HONORS` rather than derived from it. Honors are a season's
 * free-form highlight reel (a year might record three cards or five, with labels chosen to suit),
 * while this is a fixed five-column spine that has to line up down twenty years. Matching a card
 * by its label string to fill this table would break the day a label is reworded.
 *
 * The cost is that a season naming the same team on a card and in a row says it twice, so **change
 * the two together.** A row may leave any name blank; only the pre-Sleeper seasons should need to.
 */
export const LEAGUE_HISTORY: SeasonResult[] = [
  // 2006–2023 come from the "FFL Champions" section of the hand-kept `FFL History & Records`
  // Google Doc, which is the only place those seasons are written down — they ran on
  // MyFantasyLeague, whose archive carries rosters rather than results. The doc is private, so
  // it is not in `ARCHIVE_LINKS`; find it in Drive by name. That
  // section records the three bracket finishes and nothing else, so every pre-2023 row leaves
  // Total Points blank. Retired teams (Chico, Canton, Collet, Biola) are kept as the doc writes
  // them; they join on nothing and appear only here. Winnemucca is not one of them — it is the
  // Riverstone Stoners' old name, folded by `TEAM_ALIASES` where the counting happens.
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
  {
    season: "2023",
    champion: "Kingsburg Killaz",
    runnerUp: "Winnemucca Muckers",
    toiletBowl: "Lemoore Liberators",
    // 2,211.66 over the full season, from the 2023 tab of `ARCHIVE_LINKS.prizeSheet` ("Highest
    // total points for the entire season"), which is the same line 2025's figure comes from.
    // The sheet names teams by city word; expanded here, since every row stores the full name.
    totalPoints: "Dinkey Creek Dirt Clods",
  },
  {
    season: "2024",
    // Champion and Toilet Bowl are the two owners in the trophy photo on the home page; the
    // runner-up comes from the history doc.
    champion: "Easton Evil Empire",
    runnerUp: "Kingsburg Killaz",
    toiletBowl: "Clovis Jets",
    // 2,336.34, from the 2024 tab of the same workbook.
    totalPoints: "Lemoore Liberators",
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
  /**
   * Every prize line, in render order: the ones a Sleeper endpoint settles on its own, then
   * the bracket and record lines, then Survivor. These ran under three labelled divider rows
   * ("Points", "Records & brackets", "Survivor") until Aug 2026, when the labels went: eight
   * lines do not need chapter headings, and the only thing the grouping ever decided was this
   * order, which is now just the order of this array.
   */
  prizes: PrizeLine[];
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
    prizes: [
      // The four points lines are all derivable from `/league/{id}/matchups/{week}`, which is
      // why the 2026 rules could drop the partial-season windows the old sheet called hard to
      // total. The bracket and record lines below them are settled by hand.
      { label: "Total points, regular season", amount: 300 },
      { label: "Total points runner-up, regular season", amount: 150 },
      { label: "Highest points, single week, regular season", amount: 100 },
      { label: "Top single player, single week", amount: 100 },
      { label: "Finalist Champion", amount: 500, headline: true },
      { label: "Finalist Runner-Up", amount: 250 },
      { label: "Best regular season record", amount: 100 },
      { label: "Survivor winner", note: "All 17 weeks, fewest revives and strikes", amount: 100 },
    ],
    notes: [
      "Owners can win multiple prizes.",
      "If both finalists agree, they may split the pot or go winner-takes-all, decided before that weekend's games start.",
      "Side bets are optional and must be declared in chat or text group.",
    ],
  },
};

/** Seasons with a prize pool recorded, newest first. */
export function prizeSeasons(): string[] {
  return Object.keys(PRIZE_SEASONS).sort().reverse();
}

// -- Rule changes --

/** One rule, as a bold lead-in and the sentence that qualifies it. */
export interface RuleNote {
  /** The rule in a few words, rendered bold. Ends in a period; it is read as a sentence opener. */
  label: string;
  /** What it means in practice. */
  detail: string;
  /**
   * Where the rule is spelled out in full, when another page holds the detail this line only
   * summarises. Renders at the end of the sentence, so a rule that needs one reads as prose
   * with a pointer rather than as a list item with a button.
   */
  link?: { href: string; label: string };
}

/**
 * What a season's rules do and don't change, as the home page announces them.
 *
 * Hand-kept like `SURVIVOR` and `DRAFT_ORDERS`: no Sleeper endpoint carries a league's own
 * decisions, and half of these describe a scheduler setting that has no API at all.
 *
 * **`unchanged` is not filler.** Four of the 2026 survey questions came back as "leave it
 * alone", and an owner scanning a list of changes has no way to tell a rule that was upheld
 * from one nobody asked about. Listing both is what makes the first column short enough to
 * read, which is the whole reason the card splits in two.
 */
export interface RuleChanges {
  /**
   * An optional note above the two lists, and the site's one place for a first-person voice.
   * 2026 carries none: the rules say what they say, and a paragraph framing them as decisions
   * somebody made belongs in league chat, where an owner can actually answer it. Set it and
   * the paragraph appears above the split with no other edit.
   */
  intro?: string;
  changed: RuleNote[];
  unchanged: RuleNote[];
  /**
   * The full rules document, once there is one to link. Absent renders **nothing** rather than
   * the inert span `SITE_NAV`'s "Official Rules" item carries: the nav already says that page is
   * coming, and a second "coming soon" on the same page is the site saying it twice. Filling
   * this in is the one edit that puts the link on the card.
   */
  rulesHref?: string;
}

/**
 * Rules by season, so 2027's card replaces 2026's without deleting what 2026 was told.
 *
 * The home page renders the newest entry only. Nothing else reads this: the throwback cadence
 * the list mentions is computed by `isThrowbackSeason()`, and the prize figures beside it come
 * from `PRIZE_SEASONS`, so neither number can drift out of step with the page that owns it.
 */
export const RULE_CHANGES: Record<string, RuleChanges> = {
  "2026": {
    changed: [
      {
        label: "No more divisions.",
        detail: "The top two records take the top two seeds and the first-round byes.",
      },
      {
        label: "The schedule is random.",
        detail: "Without divisions, which opponents you play once and which you play twice is drawn at random.",
      },
      {
        label: "Week 14 is a random rematch.",
        detail: "A second meeting with an opponent, also drawn at random. Sleeper gives no way to set it.",
      },
      {
        label: "No trading picks into a throwback year.",
        detail: "Draft picks that land on a throwback season can't change hands. The next throwback year is 2030, five years after the last.",
      },
      {
        label: "Prizes are simplified and updated.",
        detail: "Fewer lines and bigger payouts. The two division prizes retired along with the divisions, and that money went into the points ladder.",
        link: { href: "prizes.html", label: "See Prize Tracker" },
      },
    ],
    unchanged: [
      {
        // `{entryFee}` is filled by the renderer from `PRIZE_SEASONS`, never typed here: the
        // card is allowed one prize figure and it has to be the same object the Prize Tracker
        // renders, or the two pages can disagree about what a season costs.
        label: "Entry fee stays at {entryFee}.",
        detail: "Every dollar of it goes back out as prize money.",
        link: { href: "prizes.html", label: "See the breakdown" },
      },
      {
        label: "Extras are split as we go.",
        detail: "The draft board, draft day food and anything else the group takes on are shared at the time, outside the entry fee.",
      },
      {
        label: "Superflex stays.",
        detail: "For 2027 and beyond, along with the 4 QB roster limit.",
      },
      {
        label: "One IR slot.",
        detail: "Doubtful and Out designations only.",
      },
      {
        label: "Draft slot selection runs as it always has.",
        detail: "Want a later slot than you were awarded? Throw your games in the losers bracket without punishment, or trade draft picks with another owner.",
      },
    ],
  },
};

/** The newest season with rules recorded, or undefined before any are. */
export function latestRuleChanges(): { season: string; rules: RuleChanges } | undefined {
  const season = Object.keys(RULE_CHANGES).sort().reverse()[0];
  return season ? { season, rules: RULE_CHANGES[season] } : undefined;
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

/**
 * The first season played on Sleeper. Hand-kept rather than derived from `MFL_SEASONS`' newest
 * entry: the two only line up because the move happened once, and inferring one from the other
 * would silently mislabel the League History section the day a third host or a gap year lands.
 */
export const SLEEPER_FIRST_SEASON = "2025";

/**
 * The league's MyFantasyLeague seasons, oldest first, by MFL league id.
 *
 * MFL numbers a league per *season*, not per league, so there is no single URL that walks
 * backwards the way Sleeper's `previous_league_id` chain does — every year is its own id and
 * has to be recorded by hand. Only 2016 on reuses one (`30136`); every year before that is
 * unique, and pointing an id at a year outside its own range lands on a stranger's league
 * rather than a 404, which is why every season below was opened and its title checked rather
 * than inferred from a neighbour.
 *
 * The titles these open under are not all the league's own name, which is expected and not a
 * sign of a wrong id: 2006–2014 run as the Keeper Alliance Network, the conference the league
 * played in then, and 2015 records the split in its own title ("FFL (Fantasy for Life, formerly
 * of the KAN)"). The page deliberately does not explain that — it is a list of years, and a
 * footnote about a conference that folded a decade ago is more than the list is worth. Verify a
 * new id against the title anyway; a *stranger's* league is what a wrong year looks like.
 *
 * `mflHomeUrl()` builds the link. Only the League History page renders these.
 */
export const MFL_SEASONS: { season: string; id: string }[] = [
  { season: "2006", id: "81405" },
  { season: "2007", id: "28572" },
  { season: "2008", id: "34931" },
  { season: "2009", id: "47437" },
  { season: "2010", id: "23675" },
  { season: "2011", id: "49538" },
  { season: "2012", id: "36515" },
  { season: "2013", id: "18086" },
  { season: "2014", id: "41092" },
  { season: "2015", id: "31292" },
  { season: "2016", id: "30136" },
  { season: "2017", id: "30136" },
  { season: "2018", id: "30136" },
  { season: "2019", id: "30136" },
  { season: "2020", id: "30136" },
  { season: "2021", id: "30136" },
  { season: "2022", id: "30136" },
  { season: "2023", id: "30136" },
  { season: "2024", id: "30136" },
];

/**
 * An MFL season's home page.
 *
 * The bare `www` host is deliberate: MFL serves each league from a numbered box (`www42`,
 * `www46`, ...) and which box a season sits on is not stable, so a hard-coded number rots.
 * `www.myfantasyleague.com` redirects to whichever one currently holds it.
 */
export function mflHomeUrl(season: string, id: string): string {
  return `https://www.myfantasyleague.com/${season}/home/${id}`;
}

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
  /** Newest MFL season, the one the home page's single archive link points at. */
  myFantasyLeague: mflHomeUrl("2024", "30136"),
  sleeper: "https://sleeper.com/leagues",
  /**
   * Sleeper's fantasy football help centre, linked from the home page footer. Not an archive,
   * but the same kind of off-site destination: something a reader needs and no page here holds.
   */
  sleeperSupport: "https://support.sleeper.com/en/collections/410900-fantasy-football",
} as const;
