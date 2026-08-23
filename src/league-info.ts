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
  // Written to output/rules.html, served at /rules. Live from the day the page carried only the
  // archive of past seasons' rulebooks, before the current season's rules were written into it:
  // seventeen years of rules documents that exist nowhere else on the site are worth the nav
  // item on their own, and the page says plainly which season it is still waiting on.
  { label: "Official Rules", href: "rules.html" },
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
  "2026": "2026-08-29T12:00:00-07:00",
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
 * the Old League Sites section of the League History page instead.
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
  // Retired, and both named by the history doc's "FFL Stats & Records" section, where they hold
  // one scoring record each. Neither ever placed in a bracket. Booty Bay reached `LEAGUE_HISTORY`
  // anyway once 2006-2011 Total Points was computed (they led 2009), so the Trophy Case counts
  // them on a Retired Owners line; Arroyo Grande led no season and is still a name this map
  // shortens and nothing else counts.
  //
  // **Both are retired teams in their own right, not old names** (confirmed Aug 2026), so
  // neither takes a `TEAM_ALIASES` entry. The tiers workbook makes this look otherwise and the
  // trap is worth knowing: one season's draft-order tab reads `Sanger Skunkheads` in the same
  // slot its tier tabs read `Arroyo Grande`, with the other nine teams identical and in the
  // same order. That is a franchise slot changing hands between seasons, not the
  // Winnemucca-to-Riverstone rename it resembles. Do not fold Arroyo Grande into Sanger.
  "Arroyo Grande Bottom Feeders": "Arroyo Grande",
  "Booty Bay Bandits": "Booty Bay",
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
  // 2006–2023's bracket finishes come from the "FFL Champions" section of the hand-kept
  // `FFL History & Records` Google Doc. The doc is private, so it is not in `ARCHIVE_LINKS`; find
  // it in Drive by name. That section records the three bracket finishes and nothing else.
  //
  // **Total Points for 2012-2022 comes from MyFantasyLeague, not the doc**, read off the Season
  // Records report (`options?L=30136&O=204`, most total points scored, weeks 1-17) in Aug 2026.
  // MFL computes it from the game logs, and the two seasons the repo already had by hand match it
  // to the cent (2023 Dinkey Creek 2,211.66 and 2024 Lemoore 2,336.34, both from the prize
  // workbook), which is what makes the basis interchangeable: points accumulated over the whole
  // season, playoff weeks included. A deeper playoff run therefore means more games to accumulate
  // in, exactly as the prize was awarded.
  //
  // **2006-2011 is the regular season alone, computed rather than transcribed** (Aug 2026). The
  // history doc records no Total Points at all for those years, and that era measured a season
  // over weeks 1-13: MFL's `playoffBrackets` reports `startWeek` 14 for all six. That is the same
  // window `STAT_ERAS` labels `Regular season only`, so the column now reads each era the way the
  // era itself recorded one. **The page says none of this**, deliberately: the column names a
  // team and never a figure, so there is nothing on the table for a reader to compare across the
  // boundary, and a note under it would explain a discrepancy nobody can see. A basis note
  // shipped and was pulled the same day. The record of the split is here.
  //
  // The figures come from a sweep of `export?TYPE=weeklyResults` weeks 1-13 against each season's
  // own id in `MFL_SEASONS`, filtered to the ten franchises of the `F.F.L.` conference, since the
  // league ran inside the Keeper Alliance Network until 2015 and MFL's database still mixes the
  // two (the trap `STAT_ERAS` documents). The sweep reproduces both of that era's transcribed
  // records exactly, which is what makes it trustworthy: 1130 for Canton in 2011, the era high,
  // and 612 for South Town in 2011, the era low. Season by season, runner-up in brackets:
  //
  //   2006  1065  Dinkey Creek Dirt Clods   (Winnemucca Muckers 1050)
  //   2007   978  Canton HOFers             (Booty Bay Bandits 974)
  //   2008   995  Visalia Viagra Vipers     (Winnemucca Muckers 959)
  //   2009  1014  Booty Bay Bandits         (Canton HOFers 955)
  //   2010   970  Canton HOFers             (Winnemucca Muckers 892)
  //   2011  1130  Canton HOFers             (Arroyo Grande Bottom Feeders 1032)
  //
  // **Three of the six name a different team over the full season**, so the basis is doing real
  // work rather than splitting hairs: counting the playoff weeks hands 2006 and 2008 to
  // Winnemucca and 2007 to Booty Bay. No figure here carries decimals because MFL recorded whole
  // points until 2023, the same reason `StatRecord.value` is a string.
  //
  // Retired teams (Chico, Canton, Collet, Biola, Booty Bay) are kept as their source writes them;
  // they join on nothing and appear only here. Winnemucca is not one of them: it is the
  // Riverstone Stoners' old name, folded by `TEAM_ALIASES` where the counting happens. **2009 puts Booty Bay Bandits
  // in this table for the first time**, which is what gives them a Retired Owners line in the
  // Trophy Case and what returns the Total Points column to that table; they had been a
  // `TEAM_CITIES` entry and nothing else.
  { season: "2006", champion: "Winnemucca Muckers", runnerUp: "Chico Pico de Gallo", toiletBowl: "Biola Slugglords", totalPoints: "Dinkey Creek Dirt Clods" },
  { season: "2007", champion: "Chico Pico de Gallo", runnerUp: "Dinkey Creek Dirt Clods", toiletBowl: "Visalia Viagra Vipers", totalPoints: "Canton HOFers" },
  { season: "2008", champion: "Winnemucca Muckers", runnerUp: "Chico Pico de Gallo", toiletBowl: "Dinkey Creek Dirt Clods", totalPoints: "Visalia Viagra Vipers" },
  { season: "2009", champion: "Kingsburg Killaz", runnerUp: "Canton HOFers", toiletBowl: "Chico Pico de Gallo", totalPoints: "Booty Bay Bandits" },
  { season: "2010", champion: "Clovis Jets", runnerUp: "Winnemucca Muckers", toiletBowl: "Chico Pico de Gallo", totalPoints: "Canton HOFers" },
  { season: "2011", champion: "Chico Pico de Gallo", runnerUp: "Kingsburg Killaz", toiletBowl: "South Town Freedom Fighters", totalPoints: "Canton HOFers" },
  { season: "2012", champion: "Kingsburg Killaz", runnerUp: "Visalia Viagra Vipers", toiletBowl: "Chico Pico de Gallo", totalPoints: "Kingsburg Killaz" },
  { season: "2013", champion: "Visalia Viagra Vipers", runnerUp: "Chico Pico de Gallo", toiletBowl: "Winnemucca Muckers", totalPoints: "South Town Freedom Fighters" },
  { season: "2014", champion: "South Town Freedom Fighters", runnerUp: "Canton HOFers", toiletBowl: "Visalia Viagra Vipers", totalPoints: "South Town Freedom Fighters" },
  { season: "2015", champion: "Kingsburg Killaz", runnerUp: "Easton Evil Empire", toiletBowl: "Chico Pico de Gallo", totalPoints: "Kingsburg Killaz" },
  { season: "2016", champion: "Vancouver Moose Drool", runnerUp: "Kingsburg Killaz", toiletBowl: "Collet Winners", totalPoints: "Vancouver Moose Drool" },
  { season: "2017", champion: "Chico Pico de Gallo", runnerUp: "South Town Freedom Fighters", toiletBowl: "Clovis Jets", totalPoints: "Easton Evil Empire" },
  { season: "2018", champion: "Dinkey Creek Dirt Clods", runnerUp: "Winnemucca Muckers", toiletBowl: "South Town Freedom Fighters", totalPoints: "Kingsburg Killaz" },
  { season: "2019", champion: "Easton Evil Empire", runnerUp: "Clovis Jets", toiletBowl: "Dinkey Creek Dirt Clods", totalPoints: "Easton Evil Empire" },
  { season: "2020", champion: "Clovis Jets", runnerUp: "Sanger Squatty Pottys", toiletBowl: "South Town Freedom Fighters", totalPoints: "Easton Evil Empire" },
  { season: "2021", champion: "Easton Evil Empire", runnerUp: "Kingsburg Killaz", toiletBowl: "South Town Freedom Fighters", totalPoints: "Kingsburg Killaz" },
  { season: "2022", champion: "Sanger Squatty Pottys", runnerUp: "Easton Evil Empire", toiletBowl: "Visalia Viagra Vipers", totalPoints: "Vancouver Moose Drool" },
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
 * One holder of a scoring record: who set it, and when.
 *
 * A separate shape from the record itself only because of ties. The 2006-2011 single-player
 * high is held by two teams in two different seasons, so a flat `team`/`season` pair on the
 * record could not carry it without either dropping a holder or inventing a joined string
 * that nothing could shorten at render.
 */
export interface RecordHolder {
  /** Full team name, the same string every other join key uses. */
  team: string;
  /** The player, on the records that belong to one. */
  player?: string;
  /** The beaten side, on the two matchup records. */
  against?: string;
  /** Both sides' scores as written, e.g. "175-81". Only meaningful with `against`. */
  score?: string;
  season: string;
  /** Week number as a bare string. Absent on the season-long records. */
  week?: string;
}

/**
 * One line of the scoring records table.
 *
 * `value` is a **string, not a number**, and the reason is sharper than a formatting preference:
 * **the league's scoring precision changed in the middle of an era.** MyFantasyLeague recorded
 * whole points through 2022 and switched to two decimals in 2023, so the 2020-2024 block holds
 * `2622` (a 2020 record) beside `210.12` (a 2024 one) and *both are exact*. Storing them as
 * numbers would force one format across rows that were measured differently, printing "2622.00"
 * and claiming a precision nobody recorded.
 *
 * Verified Aug 2026 against MFL's export API (`TYPE=weeklyResults`): zero decimal scores across
 * every 2020, 2021 and 2022 week sampled, decimals from 2023 on. The same check confirmed the
 * doc's 2020 figures are exact rather than rounded, matching week 5 (175-81) and week 14
 * (164-159, combined 323) to the digit. Do not "add the missing decimals" to a pre-2023 row.
 */
export interface StatRecord {
  /** What the record measures. The league's own nickname where it has one. */
  label: string;
  /** Qualifier under the label, e.g. "17 weeks including playoffs". */
  scope?: string;
  value: string;
  /** One entry, or more than one only for a tie. */
  holders: RecordHolder[];
}

/**
 * A scoring era, and the records set inside it.
 *
 * **The eras exist because the numbers are not comparable across them**, which is the whole
 * reason this is four tables rather than one sorted list. PPR arriving in 2020 lifted every
 * scoring figure at once, and Superflex in 2025 did it again, so an all-time "highest single
 * week" would only ever name the most recent era and would read as though the earlier ones
 * were bad at fantasy football rather than playing a different game.
 *
 * **What a season total measures also changes**, which is subtler and easier to miss: 2006-2011
 * recorded the regular season only, and 2012 onward counts the playoff weeks too. That is why
 * `scope` sits on the record and not on the table, and why the 2006-2011 block says so on its
 * own line rather than relying on a note under the section.
 *
 * Stored oldest-first and rendered newest-first, the same way `LEAGUE_HISTORY` is.
 */
export interface StatEra {
  /** Range label, e.g. "2020-2024". */
  label: string;
  /** What this era changed. The first era changed nothing, so it sets none. */
  scoring?: string;
  records: StatRecord[];
}

/**
 * Scoring records by era, from the "FFL Stats & Records" section of the private
 * `FFL History & Records` Google Doc, which is the only place the first three eras are written
 * down. Find it in Drive by name; it is private, so it is not in `ARCHIVE_LINKS`.
 *
 * **A record the doc never captured is an absent row, not a blank one.** All four eras happen to
 * carry the same eight rows today, but that is the data rather than a rule: a record with no
 * entry simply makes its table shorter, because a row of em dashes would read as a measured zero.
 *
 * The doc also records a lowest single-week single-player score for three of the four eras.
 * It is deliberately not carried: a bad start is a lineup mistake rather than a league record,
 * and the row was dropped from every era at once so no table implies the others never had one.
 *
 * **The bench rows are computed, and the 2006-2011 one contradicts the doc on purpose.** The doc
 * records "Biola 74 - 2009 Week 1"; a complete sweep of all nineteen MyFantasyLeague seasons puts
 * the era record at 93 (Winnemucca, 2008 week 12), and 74 is beaten four times over. The doc's
 * figure was logged in week 1 of 2009 and never revisited, which is worth knowing generally: its
 * records are what somebody noticed at the time, not exhaustive maxima. The method is not in
 * doubt, since the same sweep reproduces the doc's 74 for Biola in that exact week.
 *
 * **Highs count the playoffs, lows do not, and the `scope` line is the only thing that says so.**
 * Every "lowest" row (single week, regular-season total, bench figure) is measured over the
 * regular season alone; every "highest" row counts all seventeen weeks, which is why two of them
 * sit in weeks 15 and 16. The rule exists because a low score in a dead week is not a league
 * record: Clovis put up 38.50 in week 17 of 2024 at the end of a 2-13 season, and under a
 * whole-season window that would stand as the era's lowest week for good.
 *
 * **Regular season means every week before the playoffs start, and the start week is per
 * season.** Playoffs opened in week 14 from 2006 through 2020 and in week 15 from 2021 on, so the
 * window is weeks 1-13 for the first fifteen seasons and weeks 1-14 from 2021 onward, Sleeper
 * included (`playoff_week_start` is 15 there too). Take it from `export?TYPE=playoffBrackets` per
 * season rather than from `lastRegularSeasonWeek`, which reports 13 for every MFL season and is
 * stale for 2021-2024. (2007 reads 17, a misconfiguration in a season that ran 20 games across 17
 * weeks with no playoff structure at all.)
 *
 * **Week 14 of 2021-2024 is a game against the league median, not a bye.** Its
 * `export?TYPE=schedule` shows a full five-game slate through week 13 and then zero matchups in
 * week 14, which reads as a league-wide bye and is not one. `leagueStandings` gives every
 * franchise 14 decisions in each of those four seasons, and across all forty franchise-seasons the
 * team above that week's league median took the win and the team below took the loss, without a
 * single exception. So the week has no opponent and still produces a W or an L, the regular season
 * runs 14 games from 2021, and any source that counts opponents undercounts a 2021-2024 record by
 * one game. That is what put a wrong figure in `ALL_YEARS_RECORDS` for three weeks in Aug 2026.
 *
 * **Excluding the playoff weeks from every "lowest" row is doing real work**, because MFL scores
 * a lineup whether or not it has an opponent. Clovis put up 38.50 in week 17 of 2024, a week when
 * only four of the ten teams had a game and Clovis was not one of them; on a whole-season window
 * that non-game would stand as the era's lowest week for good.
 *
 * **Audited against MyFantasyLeague in Aug 2026, and five rows were wrong.** MFL keeps computed
 * record reports covering every season the league played there, all reachable from the 2024
 * league: Franchise Records (`options?L=30136&O=156`) for single-week scores, Player Records
 * (`O=157`), Matchup Records (`O=158`), and Season Records (`O=204`) for season totals and W-L.
 * Where MFL can compute a figure it wins over the doc, which records what somebody noticed at the
 * time. What it corrected: the 2020-2024 season high (the doc's "2622, Easton, 2020" transposes
 * Easton's real 2262, and the era leader is Kingsburg with 2372 in 2021), the 2020-2024 Defensive
 * No Show (323 from 2020 had been beaten three times over by 2024, most recently by the same
 * week-16 game that already held the era's single-week high), the 2020-2024 lowest week, the week
 * number on 2012-2019's lowest week (week 5, not week 2), and the best record in
 * `ALL_YEARS_RECORDS`. Everything else MFL can reach was confirmed exactly, including every
 * 2006-2011 and 2012-2019 figure. **That best-record correction was itself wrong** and was
 * corrected again later the same month, once the week-14 median game above was understood; the
 * sourcing now lives on `ALL_YEARS_RECORDS` rather than on a records report.
 *
 * **Three traps in reading those reports**, each producing a plausible wrong answer rather than an
 * error. MFL's records database is the whole **Keeper Alliance Network**, 2004 through 2024, so
 * franchises this league never played (Big Sky Tunder & Lightning, Chuck Norris, Mendota
 * Renegades, Traver Hoodrats) sit in the same sorted lists, and every figure has to be filtered to
 * FFL names first. It also holds 2004 and 2005 seasons under FFL franchise names, which are not
 * this league's and are excluded, since `LEAGUE_FIRST_SEASON` is 2006. And the "Lowest" reports
 * are padded with 0.00 rows in the early years, which are weeks with no game rather than scores.
 *
 * **MFL's own League Champions (`O=194`) and League Awards (`O=202`) reports were wrong for 2023
 * and 2024** until the commissioner corrected them in Aug 2026. They are hand-entered rather than
 * derived, so they are not a source. The playoff brackets are
 * (`export?TYPE=playoffBracket&L=30136&BRACKET_ID=3`), and they agree with `LEAGUE_HISTORY` on
 * every season.
 *
 * **The 2025 era was computed, not transcribed.** The doc carries a `TODO (2025 to current
 * superflex scoring)` heading and nothing under it, so every figure in that block came from a
 * one-time sweep of Sleeper's `/league/{id}/matchups/{week}` for weeks 1-17, cross-checked two
 * ways: the regular-season totals match `rosters[].settings.fpts` to the cent, and the
 * full-season leader is the team `LEAGUE_HISTORY` already names for 2025 Total Points. The
 * script is not in the repo, since nothing here reads matchup data and one season's records do
 * not justify a capture pipeline. Recomputing 2026 means writing it again.
 *
 * **The two counting records the doc lists under "All Years" are deliberately not here.** Most
 * Championships and Most Toilet Bowl Championships are already derived from `LEAGUE_HISTORY` by
 * `trophyCounts()` and rendered by the Trophy Case on this same page. A hand-typed second copy
 * would disagree with it the first time somebody wins a title. The two all-years *records*
 * (best and worst regular-season finish) are not derived anywhere, so they stay, in
 * `ALL_YEARS_RECORDS` below.
 */
export const STAT_ERAS: StatEra[] = [
  {
    label: "2006-2011",
    records: [
      {
        label: "Highest total points, season",
        // The one era that measured the regular season alone. Spelled out on the row because
        // the three later eras count the playoffs and nothing else on the page would say so.
        scope: "Regular season only",
        value: "1130",
        holders: [{ team: "Canton HOFers", season: "2011" }],
      },
      {
        label: "Highest total points, single week",
        value: "140",
        holders: [{ team: "Winnemucca Muckers", season: "2011", week: "15" }],
      },
      {
        label: "Highest single week, one player",
        value: "45",
        scope: "Tie",
        holders: [
          { team: "Arroyo Grande Bottom Feeders", player: "Michael Vick", season: "2010", week: "10" },
          { team: "Canton HOFers", player: "Aaron Rodgers", season: "2011", week: "4" },
        ],
      },
      {
        label: "Lowest total points, regular season",
        value: "612",
        holders: [{ team: "South Town Freedom Fighters", season: "2011" }],
      },
      {
        label: "Lowest total points, single week",
        scope: "Regular season only",
        value: "13",
        holders: [{ team: "Dinkey Creek Dirt Clods", season: "2010", week: "5" }],
      },
      {
        label: "Biggest Country Boy Whooping",
        scope: "Margin of victory",
        value: "97",
        holders: [{ team: "Kingsburg Killaz", against: "Biola Slugglords", score: "123-26", season: "2009", week: "4" }],
      },
      {
        label: "Biggest Defensive No Show",
        scope: "Largest combined score",
        value: "220",
        holders: [{ team: "Dinkey Creek Dirt Clods", against: "Booty Bay Bandits", score: "134-86", season: "2006", week: "12" }],
      },
      {
        label: "Highest total points on the bench",
        scope: "Regular season only",
        value: "93",
        holders: [{ team: "Winnemucca Muckers", season: "2008", week: "12" }],
      },
    ],
  },
  {
    label: "2012-2019",
    records: [
      {
        label: "Highest total points, season",
        scope: "16 weeks, playoffs included",
        value: "1803",
        holders: [{ team: "Kingsburg Killaz", season: "2018" }],
      },
      {
        label: "Highest total points, single week",
        value: "161",
        holders: [{ team: "Dinkey Creek Dirt Clods", season: "2018", week: "11" }],
      },
      {
        label: "Highest single week, one player",
        value: "53",
        holders: [{ team: "South Town Freedom Fighters", player: "Peyton Manning", season: "2013", week: "1" }],
      },
      {
        label: "Lowest total points, regular season",
        value: "991",
        holders: [{ team: "Clovis Jets", season: "2017" }],
      },
      {
        label: "Lowest total points, single week",
        scope: "Regular season only",
        value: "32",
        holders: [{ team: "Winnemucca Muckers", season: "2012", week: "5" }],
      },
      {
        label: "Biggest Country Boy Whooping",
        scope: "Margin of victory",
        value: "94",
        holders: [{ team: "Easton Evil Empire", against: "Chico Pico de Gallo", score: "149-55", season: "2017", week: "9" }],
      },
      {
        label: "Biggest Defensive No Show",
        scope: "Largest combined score",
        value: "285",
        holders: [{ team: "Winnemucca Muckers", against: "Kingsburg Killaz", score: "156-129", season: "2019", week: "5" }],
      },
      {
        label: "Highest total points on the bench",
        scope: "Regular season only",
        value: "118",
        holders: [{ team: "Dinkey Creek Dirt Clods", season: "2019", week: "1" }],
      },
    ],
  },
  {
    label: "2020-2024",
    scoring: "PPR scoring added",
    records: [
      {
        label: "Highest total points, season",
        scope: "17 weeks, playoffs included",
        value: "2372",
        holders: [{ team: "Kingsburg Killaz", season: "2021" }],
      },
      {
        label: "Highest total points, single week",
        value: "210.12",
        holders: [{ team: "Kingsburg Killaz", season: "2024", week: "16" }],
      },
      {
        label: "Highest single week, one player",
        value: "57",
        holders: [{ team: "Dinkey Creek Dirt Clods", player: "Tyreek Hill", season: "2020", week: "12" }],
      },
      {
        label: "Lowest total points, regular season",
        value: "1318.86",
        holders: [{ team: "Clovis Jets", season: "2024" }],
      },
      {
        label: "Lowest total points, single week",
        scope: "Regular season only",
        value: "47.98",
        holders: [{ team: "Vancouver Moose Drool", season: "2024", week: "3" }],
      },
      {
        label: "Biggest Country Boy Whooping",
        scope: "Margin of victory",
        value: "94",
        holders: [{ team: "Lemoore Liberators", against: "Sanger Squatty Pottys", score: "175-81", season: "2020", week: "5" }],
      },
      {
        label: "Biggest Defensive No Show",
        scope: "Largest combined score",
        value: "354.48",
        holders: [
          { team: "Kingsburg Killaz", against: "Lemoore Liberators", score: "210.12-144.36", season: "2024", week: "16" },
        ],
      },
      {
        label: "Highest total points on the bench",
        scope: "Regular season only",
        value: "130",
        holders: [{ team: "Easton Evil Empire", season: "2022", week: "4" }],
      },
    ],
  },
  {
    label: "2025-current",
    scoring: "Superflex added",
    records: [
      {
        label: "Highest total points, season",
        scope: "17 weeks, playoffs included",
        value: "2602.30",
        holders: [{ team: "Sanger Squatty Pottys", season: "2025" }],
      },
      {
        label: "Highest total points, single week",
        value: "212.24",
        holders: [{ team: "Sanger Squatty Pottys", season: "2025", week: "16" }],
      },
      {
        label: "Highest single week, one player",
        value: "55.40",
        holders: [{ team: "Kingsburg Killaz", player: "Jahmyr Gibbs", season: "2025", week: "12" }],
      },
      {
        label: "Lowest total points, regular season",
        value: "1692.44",
        holders: [{ team: "Clovis Jets", season: "2025" }],
      },
      {
        label: "Lowest total points, single week",
        scope: "Regular season only",
        value: "71.94",
        holders: [{ team: "Clovis Jets", season: "2025", week: "11" }],
      },
      {
        label: "Biggest Country Boy Whooping",
        scope: "Margin of victory",
        value: "107.34",
        holders: [
          { team: "Sanger Squatty Pottys", against: "Vancouver Moose Drool", score: "212.24-104.90", season: "2025", week: "16" },
        ],
      },
      {
        label: "Biggest Defensive No Show",
        scope: "Largest combined score",
        value: "356.46",
        holders: [
          { team: "Kingsburg Killaz", against: "Visalia Viagra Vipers", score: "188.82-167.64", season: "2025", week: "12" },
        ],
      },
      {
        label: "Highest total points on the bench",
        scope: "Regular season only",
        value: "110.72",
        holders: [{ team: "Kingsburg Killaz", season: "2025", week: "3" }],
      },
    ],
  },
];

/**
 * The two records the doc files under "All Years" that survive era boundaries.
 *
 * A win-loss finish is the one figure PPR and Superflex did not touch, so unlike everything in
 * `STAT_ERAS` these two genuinely compare across twenty seasons. That is the entire reason they
 * sit outside the era tables rather than being repeated in each.
 *
 * **Both are computed from every season's standings rather than transcribed**, by a one-time sweep
 * of `export?TYPE=leagueStandings` for each MFL season 2006-2024 plus `rosters[].settings` on
 * Sleeper for 2025, filtered to this league's ten franchises. For 2006-2014 that filter is the
 * `F.F.L.` conference of the Keeper Alliance Network, which ran 30 franchises through 2011 and 20
 * after; every FFL game in those years was inside that conference, so no franchise's record is
 * mixed with a stranger's. Best is 12-2 (.857), ahead of the 11-2 (.846) that 2014 South Town and
 * 2018 Easton share. Worst is 0-13, which nothing can beat.
 *
 * **The 11-2 four-way tie this row carried until Aug 2026 was an artifact of the week-14 median
 * game.** 2021 Easton and 2024 Lemoore went 12-2, not 11-2: their fourteenth decision comes from a
 * week with no scheduled matchup, so a source that counts opponents drops it and files them beside
 * two genuine 13-game 11-2 seasons as though the four were equal. `ALL_YEARS_SCHEDULE_NOTE` is
 * what the page says about it; `STAT_ERAS` carries the mechanism.
 *
 * The doc's other two all-years lines, Most Championships and Most Toilet Bowl Championships,
 * are not here: the Trophy Case on this same page already derives both from `LEAGUE_HISTORY`.
 */
export const ALL_YEARS_RECORDS: StatRecord[] = [
  {
    label: "Best regular-season record",
    scope: "Tie",
    value: "12-2",
    holders: [
      { team: "Easton Evil Empire", season: "2021" },
      { team: "Lemoore Liberators", season: "2024" },
    ],
  },
  {
    label: "Worst regular-season record",
    value: "0-13",
    holders: [{ team: "South Town Freedom Fighters", season: "2018" }],
  },
];

/**
 * The one change that stops the two all-years records from being measured over the same schedule.
 *
 * A win-loss finish survives PPR and Superflex, which is why these two sit outside the era tables
 * at all. It does not survive a schedule change: 2006-2020 ran 13 regular-season games and 2021
 * onward runs 14, so the 12-2 above is measured over a longer season than the 0-13 below it.
 *
 * **The note states the change and stops; the mechanism behind it is deliberately not on the
 * page.** Week 14 of 2021-2024 has no opponent: the playoffs moving back a week freed it, and the
 * league filled it with a game against the league median, so `export?TYPE=schedule` reports zero
 * matchups there while `leagueStandings` gives every franchise 14 decisions. That is a fact about
 * MyFantasyLeague's export rather than about the league's own history, and a reader of this page
 * wants the denominator, not the plumbing. It is written down twice where it is actually needed,
 * on `ALL_YEARS_RECORDS` and in the `STAT_ERAS` doc above, since it is what makes an
 * opponent-counting source undercount a 2021-2024 record by a game. **The one cost of leaving it
 * out**: somebody who opens MFL's schedule to check the fourteenth game will not find it there,
 * and the page gives them nothing to explain that. Standings are where it shows.
 *
 * Written out rather than derived, since nothing here holds a per-season schedule. The figures are
 * one-time checks: MFL's `export?TYPE=playoffBracket` opens brackets 1 through 3 in week 14 for
 * 2020 and week 15 for 2021, and Sleeper reports `playoff_week_start` 15 for 2025.
 *
 * Rendered under the All Years table only. The era tables score points rather than games, and the
 * window each of their rows uses is already stated on the row by `StatRecord.scope`. The window
 * itself did not move with this discovery: weeks 1-14 was already the regular season for those
 * seasons, so every points figure in `STAT_ERAS` stands.
 */
export const ALL_YEARS_SCHEDULE_NOTE =
  "The regular season grew from 13 games to 14 in 2021, when the playoffs moved from weeks 14–16 to weeks 15–17.";

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

/**
 * The league's structural numbers, stated once.
 *
 * Every figure here appears in rules prose more than once, and each is a `{token}` filled by
 * `fillRuleTokens()` in `html.ts` rather than typed where it is used: change the roster limit
 * to 18 and every sentence quoting it moves together, which is the entire point. A figure used
 * in one place does not earn an entry — type it where it lives.
 *
 * Hand-kept and verified against the current Sleeper league rather than fetched, the same call
 * every constant in this file makes: `--generate` must stay deterministic, and these change by
 * league vote, not by API drift. The entry fee is deliberately absent — it stays in
 * `PRIZE_SEASONS`, which the Prize Tracker renders, so the two pages cannot disagree.
 */
export const LEAGUE_FACTS = {
  /** Owners in the league. */
  teamCount: 10,
  /** Roster limit, bench included (verified: 2026 `roster_positions` has 17 slots). */
  rosterLimit: 17,
  /** Players kept into the next season (`settings.max_keepers`). */
  keeperCount: 3,
  /** Most QBs one roster may hold (`settings.position_limit_qb`, added with Superflex). */
  qbLimit: 4,
  /** FAAB blind-bidding budget for the season, in virtual dollars (`settings.waiver_budget`). */
  faabBudget: 100,
  /**
   * Trading stays open through this week's games and closes when its last one ends
   * (`settings.trade_deadline`; Sleeper's deadline is the end of the named week, not its start).
   */
  tradeDeadlineWeek: 11,
};

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
        label: "Simpler playoff tiebreakers.",
        detail: "Seeding ties break by total points scored, then total points against, the same order the standings show all season. The old head-to-head ladder retires with the divisions.",
        link: { href: "rules.html#schedule-playoffs", label: "See the playoff rules" },
      },
      {
        label: "AutoSubs are on.",
        detail: "Name a bench player ahead of time and Sleeper starts him automatically if your starter is ruled inactive, up to 3 a week.",
        link: { href: "rules.html#lineups", label: "See the lineup rules" },
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
    rulesHref: "rules.html",
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
