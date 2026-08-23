/**
 * The league's official rules, and where every past season's rules live.
 *
 * Its own module rather than another block of `league-info.ts` for the same reason `tiers.ts` is
 * one: a full rules set runs about four thousand words, which is more than the rest of that file
 * holds put together, and it turns over completely every August while everything beside it is
 * keyed by season and accumulates. Same job though, hand-kept league facts no Sleeper endpoint
 * carries, read by a renderer that owns none of them.
 *
 * Two halves that do not mix. `RULES_SECTIONS` is the current season's rules as structured data,
 * rendered as the page itself. The archive below it is a list of links to seasons already closed,
 * which arrive in two forms and will only ever arrive in those two: a published Google Doc for
 * the years before this site carried rules, and a frozen page here for 2026 on.
 */

/**
 * The season `RULES_SECTIONS` describes, and the only season this page renders in full.
 *
 * Every earlier season is a link in the archive, so this is what changes when the rules turn
 * over: last year's page is frozen to `rules-<season>.html`, its season is added to
 * `RULES_PAGE_SEASONS`, and this moves forward a year.
 */
export const RULES_SEASON = "2026";

/**
 * One piece of a rules section.
 *
 * Deliberately a small vocabulary. Anything a rules document actually does is a paragraph, a
 * list, or a table of numbers, and every rules doc this league has published since 2008 is
 * expressible in those three. Add a block variant when a rule needs it and not before.
 *
 * Text is plain and is escaped by the renderer, so an ampersand is typed as `&` and never as an
 * entity. Same call `GalleryPhoto.caption` makes, and for the same reason: an entity written
 * here ships to the page as its own literal characters. Two things survive the escaping, both
 * handled by `rulesText()` in `html.ts`:
 *
 * - **`[label](href)` renders as a link**, mid-sentence. The 2026 set outsources every how-to to
 *   Sleeper's own support pages rather than transcribing them, so the link has to sit where the
 *   mechanic is named. Absolute `https://` hrefs open a new tab; relative ones (a page here, a
 *   `#anchor` on this page) stay put.
 * - **`{token}` fills from the object that owns the figure**: `{rosterLimit}`, `{keeperCount}`,
 *   `{teamCount}`, `{qbLimit}`, `{faabBudget}`, `{tradeDeadlineWeek}` and the derived
 *   `{draftRounds}` from `LEAGUE_FACTS`, `{entryFee}` from `PRIZE_SEASONS`. Never type one of
 *   those numbers into a rule: the tokens are what make a roster-size change a one-line edit.
 */
export type RulesBlock =
  | { kind: "text"; text: string }
  /** A named part within a section, for the sections that hold more than one thing. */
  | { kind: "heading"; text: string }
  | { kind: "list"; items: string[]; ordered?: boolean }
  | { kind: "table"; columns: string[]; rows: string[][] };

/**
 * A section of the rules, which is one anchor, one heading and one entry in the page's contents.
 *
 * `id` is the anchor and it is permanent. A reader who links a teammate to the trade deadline is
 * linking to `#trades`, so renaming an id breaks that link to fix nothing anybody sees, which is
 * the call the League History page already made for its own section ids. Reword `title` freely.
 */
export interface RulesSection {
  id: string;
  title: string;
  blocks: RulesBlock[];
}

/**
 * A major part of the rules, for navigation only. One tab in the page's sticky sub-nav and one
 * labelled group in the contents card; sections render identically whatever part holds them.
 * `from` names the part's first section, and the part runs until the next part's `from`, so the
 * grouping is contiguous by construction and a new section slots into whichever part it lands
 * inside with no edit here.
 */
export interface RulesPart {
  label: string;
  from: string;
}

/**
 * The sub-nav's parts, in document order.
 *
 * This exists because thirteen per-section tabs cannot hold one row and six can: the bar has to
 * fit a single line at `md` (704px of measure), which is what keeps these labels terse.
 * "Scoring" covers Lineups and Injured Reserve too; the contents card, whose groups carry these
 * same labels, is what spells that out. Measure before growing a label or adding a part (14px
 * Schibsted Grotesk at ~7.5px per character, plus 28px per gap; the current six tabs run
 * ~660px).
 *
 * `rulesPartSpans()` in `html.ts` resolves each part to its span of sections and **throws** on
 * anything that would drop a section from the nav (a `from` naming no section, parts out of
 * document order, a first part not starting at the first section), so a mistake fails the
 * `--generate` run instead of quietly thinning the bar. Rewrite this list alongside
 * `RULES_SECTIONS` each August; while that array is empty, this one is ignored.
 */
export const RULES_PARTS: RulesPart[] = [
  { label: "Basics", from: "league-basics" },
  { label: "Scoring", from: "scoring" },
  { label: "Waivers & Trades", from: "waivers-faab" },
  { label: "Keepers & Draft", from: "keepers" },
  { label: "Season & Prizes", from: "schedule-playoffs" },
];

/**
 * The current season's rules.
 *
 * Built from the 2025 rules doc, rewritten where the league's 2026 Sleeper settings decide
 * differently, and deliberately shorter than any doc in the archive: every mechanic Sleeper
 * itself runs (bidding, IR, AutoSubs, trade screens) is a link into Sleeper's support pages
 * rather than a transcription of them. What this file keeps is what the league decides, which
 * no support article can carry.
 *
 * The scoring tables are the one full transcription, on purpose: they are this league's custom
 * settings, so there is nothing to link. Structural numbers (roster size, keepers, FAAB, the
 * deadline week) are `{tokens}` filled from `LEAGUE_FACTS`, never typed here; see `RulesBlock`.
 *
 * What changed from 2025 renders above these sections, derived from `RULE_CHANGES` in
 * `league-info.ts` so this page and the home card cannot disagree. The body carries no change
 * marks of its own: these sections read as the rules as they stand.
 *
 * If this is ever emptied again the page falls back to a notice pointing at the newest archived
 * set, which is derived from the array being empty and takes itself off when content lands.
 */
export const RULES_SECTIONS: RulesSection[] = [
  {
    id: "league-basics",
    title: "League Basics",
    blocks: [
      {
        kind: "text",
        text: "The FFL (Fantasy For Life) is a {teamCount}-owner keeper league established in 2006, hosted on [Sleeper](https://sleeper.com/leagues) since 2025. Every season back to the beginning is on the [League History](history.html) page.",
      },
      {
        kind: "list",
        items: [
          "Weekly starting lineup: 1 QB, 2 RB, 2 WR, 1 TE, 1 Flex (RB/WR/TE), 1 Superflex (QB/RB/WR/TE), 1 K, 1 Def/ST.",
          "Roster limit: {rosterLimit} players, with at most {qbLimit} QBs.",
          "Your roster must always hold enough players at each position to field a full lineup.",
          "{keeperCount} players are kept into the next season, except into a throwback year (every fifth season: 2025, 2030, ...), when nobody keeps anyone and all {teamCount} teams draft fresh.",
        ],
      },
    ],
  },
  {
    id: "scoring",
    title: "Scoring",
    blocks: [
      {
        kind: "text",
        text: "Points are scored to two decimal places. The full settings live under League Settings in the Sleeper app or website, and every player's weekly line can be opened play by play. [How can I see my player's points breakdown?](https://support.sleeper.com/en/articles/4126744-how-can-i-see-my-player-s-points-breakdown)",
      },
      { kind: "heading", text: "Passing" },
      {
        kind: "table",
        columns: ["Play", "Points"],
        rows: [
          ["Passing TD", "5"],
          ["Passing yards", "1 per 25 (0.04 per yard)"],
          ["Interception thrown", "-2"],
          ["2-point conversion", "2"],
        ],
      },
      { kind: "heading", text: "Rushing / Receiving" },
      {
        kind: "table",
        columns: ["Play", "Points"],
        rows: [
          ["Rushing or receiving TD", "6"],
          ["Rushing or receiving yards", "1 per 10 (0.1 per yard)"],
          ["Reception", "1 (full PPR)"],
          ["2-point conversion", "2"],
        ],
      },
      { kind: "heading", text: "Kicking" },
      {
        kind: "table",
        columns: ["Play", "Points"],
        rows: [
          ["Extra point", "1"],
          ["Field goal, up to 49 yards", "3"],
          ["Field goal, 50+ yards", "4"],
        ],
      },
      { kind: "heading", text: "Defense / Special Teams" },
      {
        kind: "table",
        columns: ["Play", "Points"],
        rows: [
          ["TD (any type)", "6"],
          ["Safety", "5"],
          ["Interception", "2"],
          ["Fumble recovery", "2"],
          ["Blocked punt or field goal", "2"],
          ["Sack", "1"],
          ["Shutout (0 points allowed)", "10"],
          ["1–6 points allowed", "5"],
          ["35+ points allowed", "-5"],
          ["Defensive 2-point conversion return", "2"],
        ],
      },
      { kind: "heading", text: "Scoring notes" },
      {
        kind: "list",
        items: [
          "Every TD is worth 6 points except a passing TD (5). Return and defensive TDs count for the individual player and for the Def/ST when its unit was on the field.",
          "All offensive players can score in every category. A kicker who throws a TD pass on a fake field goal gets the passing points.",
          "Return yardage is not scored, for individuals or defenses. Return TDs are.",
          "Points allowed counts only what the opposing offense and special teams score. A touchdown by the opposing defense (an interception returned for a score, say) does not add to it, because your defense was not on the field to prevent it. [How are Points Allowed calculated?](https://support.sleeper.com/en/articles/4126495-how-are-points-allowed-calculated)",
          "Sleeper applies official NFL stat corrections automatically in the days after the games. [Stat Corrections](https://support.sleeper.com/en/articles/2441282-stat-corrections)",
          "Scoring disputes go to the commissioner by Wednesday 9pm PT of that week; scores are final after that week's corrections land.",
        ],
      },
    ],
  },
  {
    id: "lineups",
    title: "Lineups",
    blocks: [
      {
        kind: "list",
        items: [
          "Set your lineup in the Sleeper app or website. Lineups carry over from week to week, and a carried-over lineup will happily start players on bye or out injured, so check yours every week.",
          "Players lock at kickoff of their own game, starters and bench alike. A locked player can't be moved in or out of your lineup.",
          "Sleeper's AutoSubs can automatically replace a starter who is ruled inactive with a bench player you designate ahead of time, up to 3 substitutions per week. [How does Player AutoSubs work?](https://support.sleeper.com/en/articles/9731991-how-does-player-autosubs-work)",
          "Submitting a deliberately partial lineup for tactical reasons is allowed.",
          "Abandoning your lineup is a serious offense: an obviously dead lineup left to ride costs $25 of FAAB, and a pattern of it is grounds for not being invited back.",
        ],
      },
    ],
  },
  {
    id: "injured-reserve",
    title: "Injured Reserve",
    blocks: [
      {
        kind: "list",
        items: [
          "One IR slot per team, usable all season.",
          "A player is IR-eligible when Sleeper lists them as IR, Out, or Doubtful. Suspensions and holdouts do not qualify. [Injury Statuses and IR Eligibility](https://support.sleeper.com/en/articles/3570017-injury-statuses-and-ir-eligibility)",
          "When a stashed player's status improves, the slot turns illegal and you must activate or drop them before making other moves. [How does Injured Reserve (IR) work?](https://support.sleeper.com/en/articles/1983643-how-does-injured-reserve-ir-work)",
        ],
      },
    ],
  },
  // TODO (2026-08-23): one thing below is still unconfirmed, and it is the part the whole week
  // turns on. Whether a custom waiver day really blocks direct adds for the entire window
  // before it is with Sleeper support: Sleeper's daily waivers normally put only *dropped*
  // players on the board, which would leave never-rostered free agents addable straight through
  // Monday night and collapse the waiver window into nothing. The other two are settled by the
  // commissioner and are safe to state as rules. Free agency runs continuously from Wednesday's
  // run to the following Monday, with each player locking at their own kickoff, and a player
  // dropped during free agency hits the board immediately rather than re-entering waivers.
  //
  // Separately, the 2026 league's settings do not express any of this yet
  // (`daily_waivers_days` currently carries more than one active day at `daily_waivers_hour`
  // 20, not the single Wednesday run these rules describe), so the league has to be
  // reconfigured before the season opens or the page describes a week nobody plays.
  {
    id: "waivers-faab",
    title: "Waivers & Free Agency",
    blocks: [
      {
        kind: "text",
        text: "There are two ways to add a player and only one of them is running at any moment. From Monday night to Wednesday night everybody unrostered is on waivers, and a blind FAAB bid is the only way in. The rest of the week is free agency: no bidding, nothing to spend, whoever gets there first. You make your own moves either way, and commissioners are not responsible for running pickups for anyone.",
      },
      { kind: "heading", text: "The weekly cycle" },
      {
        kind: "list",
        ordered: true,
        items: [
          "Monday, 8pm PT. Waivers open. Every player not on a roster locks and stays locked until Wednesday, so nobody can be added directly.",
          "Monday 8pm to Wednesday 8pm PT. Get your bids in. Bidding is blind, nobody sees what anyone else has offered, and you can bid on as many players as you want.",
          "Wednesday, 8pm PT. Every bid in the league processes at once. The highest bid on a player wins them, the money comes off that team's budget, and losing bids cost nothing.",
          "Wednesday, just after 8pm PT. Free agency opens the moment that run finishes. Anyone still unrostered is free to add, first come first served, at no cost.",
          "Wednesday 8pm to Monday 8pm PT. Free agency runs all the way to Monday night, when waivers open again and the cycle repeats.",
        ],
      },
      { kind: "heading", text: "Bidding" },
      {
        kind: "list",
        items: [
          "Each team gets a {faabBudget} FAAB budget for the season (virtual dollars, nothing to do with real money). It has to cover the whole year, playoffs included, and it never refills. [How does FAAB bidding work?](https://support.sleeper.com/en/articles/1876040-how-does-faab-bidding-work)",
          "Whole dollars only, and $0 bids are allowed. A $0 bid still beats not bidding at all.",
          "Tied bids go to the higher waiver priority, which starts the season as reverse draft order. Winning a claim drops you to the back of it.",
          "A claim that would push you past {rosterLimit} players has to name the player you are dropping, or it fails. [Why was my waiver claim invalid?](https://support.sleeper.com/en/articles/3978623-why-was-my-waiver-claim-invalid)",
          "You can still drop a player during the waiver window. They go straight onto the board with everybody else, biddable in that same Wednesday run.",
          "FAAB dollars can be traded, as long as nobody ends up holding more than {faabBudget}.",
        ],
      },
      { kind: "heading", text: "Free agency" },
      {
        kind: "list",
        items: [
          "No bidding and no cost, so a free agent is gone the second another owner wants them.",
          "Drops take effect immediately: a player you release is on the board for anyone to claim right away, with no waiting period.",
          "A player locks when their own game kicks off and stays locked for the rest of the week, so a Thursday night player is out of reach by Thursday evening. A player whose team is on bye never kicks off, so they stay available all week.",
          "The {rosterLimit} roster limit still applies, so drop first or make the add name a drop.",
          "Two teams using drops and pickups to walk a player from one roster to the other is a fair-play violation, and the commissioner can undo it. See [Fair Play & Sportsmanship](#fair-play).",
        ],
      },
      { kind: "heading", text: "Through the season" },
      {
        kind: "list",
        items: [
          "The cycle runs every week from the draft through the last playoff week, whether or not you are still alive in the bracket.",
          "Keepers are taken from rosters as they stand after the final week, so playoff-week moves change what you can keep.",
        ],
      },
    ],
  },
  {
    id: "trades",
    title: "Trades",
    blocks: [
      {
        kind: "list",
        items: [
          "The trade deadline is the end of week {tradeDeadlineWeek}: trading stays open through that week's games and closes when its last one ends. Trading reopens after the Super Bowl and runs all offseason. [When is my trade deadline?](https://support.sleeper.com/en/articles/2435411-when-is-my-trade-deadline)",
          "No limit on trades per season. Propose, counter and accept in the app. [How to Trade](https://support.sleeper.com/en/articles/3188802-how-to-trade)",
          "Trades can include players, draft picks and FAAB dollars. Picks can come from any round of any future season, except that picks landing on a throwback year (2030 is the next) cannot be traded. [Can I trade draft picks?](https://support.sleeper.com/en/articles/3974639-can-i-trade-draft-picks)",
          "An accepted trade sits in review for up to 2 days before it processes. Trades are reviewed by the commissioner, not by league vote.",
          "A trade may not leave either roster over {rosterLimit} players. If you need room, drop before the trade processes.",
          "After keepers are declared, only kept players and draft picks can change hands until the draft.",
          "Trade-backs are banned: no trading a player away with a plan to get the same player back in the weeks after.",
          "Trades must be fair, balanced and mutually beneficial, and the commissioner can reject any that isn't. See [Fair Play & Sportsmanship](#fair-play).",
        ],
      },
    ],
  },
  {
    id: "keepers",
    title: "Keepers",
    blocks: [
      {
        kind: "text",
        text: "This is a {keeperCount}-player keeper league. Keeping only {keeperCount} is what keeps the draft meaningful and gives a losing season a real reset. Rosters split into three tiers by draft round, and you keep one player from each tier.",
      },
      {
        kind: "text",
        text: "The tier boundaries depend on which kind of draft the players came out of. A keeper year is the usual case: the {keeperCount} keepers fill the top roster slots and the draft runs {draftRounds} rounds. A throwback year (and the league's first year) drafts the full {rosterLimit}-man roster instead, so the same three tiers spread across all {rosterLimit} rounds.",
      },
      {
        kind: "table",
        columns: ["Tier", "Keeper-year draft", "Throwback-year draft"],
        rows: [
          ["1", "Rounds 1–3", "Rounds 1–5"],
          ["2", "Rounds 4–8", "Rounds 6–10"],
          ["3", "Rounds 9+, and undrafted pickups", "Rounds 11+, and undrafted pickups"],
        ],
      },
      {
        kind: "list",
        items: [
          "A player's tier reads off the draft he was actually taken in. Picking 2026 keepers means the 2025 throwback rounds; picking 2027 keepers next winter will mean the 2026 keeper-year rounds.",
          "You can always substitute downward: in place of a higher-tier keeper, keep an extra player from a lower tier (two Tier 3s and a Tier 1, say). Never the reverse.",
          "A kept player climbs one tier for the next season, no matter how many keepers shared his tier.",
          "Free agent pickups count as Tier 3. A traded player keeps the tier he was originally drafted in, and a dropped and re-added player keeps his drafted round.",
          "Declare keepers in the Sleeper app or website. Selections can be set and changed freely up to 24 hours before draft time, when they lock. Until then everyone holds their full {rosterLimit}-man roster to study and trade with.",
          "Keeper rosters lock when the final week of the season completes, so playoff-week pickups and drops change your keeper options.",
          "Where everyone's roster actually tiers out, season by season, is on [Keeper Tiers](tiers.html).",
        ],
      },
      { kind: "heading", text: "Examples" },
      {
        kind: "list",
        items: [
          "Throwback year, which is how 2026's keepers come off the 2025 roster. Nobody was kept into 2025, so every tier reads off that one draft: a round-2 pick is Tier 1, a round-8 pick is Tier 2, and a waiver add is Tier 3. Keep one of each and they move up for 2026: the round-2 pick stays Tier 1, the round-8 pick becomes Tier 1, and the waiver add becomes Tier 2.",
          "Keeper year, which is how 2027's keepers will come off the 2026 roster. A round-2 pick is Tier 1, a round-6 pick is Tier 2, and a round-12 pick or a waiver add is Tier 3. Keep one of each and they move up for 2027: the round-2 pick is already Tier 1 and stays there, the round-6 pick becomes Tier 1, and the round-12 pick becomes Tier 2.",
        ],
      },
    ],
  },
  {
    id: "draft",
    title: "Draft Day",
    blocks: [
      {
        kind: "list",
        items: [
          "Draft order comes out of the previous season's brackets: every eliminated team plays on for its slot, the champion picks last and the losers bracket winner picks first. The full slotting is under [Schedule & Playoffs](#schedule-playoffs). In a throwback year the order is drawn by lottery instead.",
          "After round 1, the draft snakes: standard serpentine order.",
          "Be there. An owner who truly cannot attend (or part of it) must send a representative, and the representative cannot be another owner in this league. No double drafting and no phone drafting; a stand-in leaves when the owner arrives.",
          "You can trade picks during the draft, but the clock does not stop while you work out the details. Trade while other teams are picking. [Can I trade during a draft?](https://support.sleeper.com/en/articles/4027030-can-i-trade-during-a-draft)",
          "Every roster leaves the draft at exactly {rosterLimit} players, so teams that traded picks away or collected extras make their final picks accordingly.",
        ],
      },
    ],
  },
  {
    id: "schedule-playoffs",
    title: "Schedule & Playoffs",
    blocks: [
      {
        kind: "text",
        text: "The regular season runs 14 weeks. With divisions gone, the schedule is drawn at random: which opponents you meet twice is the luck of the draw, and week 14 is a second meeting with a randomly drawn opponent. Week 14 counts like any other game in the standings.",
      },
      { kind: "heading", text: "Playoffs" },
      {
        kind: "list",
        items: [
          "Playoffs run weeks 15–17. The top 6 records make the championship bracket, and the top 2 take the first-round byes; the other 4 teams enter the losers bracket.",
          "Round 1 is #3 vs #6 and #4 vs #5. The bracket re-seeds after round 1, so the #1 seed faces the lowest surviving seed.",
          "One loss eliminates. The champion's name goes on the trophy, which they hold until the next champion takes it.",
          "A regular-season tie stands as a tie on your record. A playoff tie goes to the higher seed.",
        ],
      },
      { kind: "heading", text: "Seeding tiebreakers" },
      {
        kind: "text",
        text: "Teams with the same record are seeded by total points scored, then total points against: the same order the standings show all season, applied by Sleeper automatically. Anything still tied after that goes to a coin toss.",
      },
      { kind: "heading", text: "Losers bracket" },
      {
        kind: "list",
        items: [
          "Round 1 is #7 vs #10 and #8 vs #9. In round 2 the winners play each other and the losers play each other.",
          "The loser of the round 1 losers' matchup is the Toilet Bowl champion, with a trophy of their own to hold all year. [Consolation Bracket vs. Toilet Bowl](https://support.sleeper.com/en/articles/2203534-consolation-bracket-vs-toilet-bowl)",
        ],
      },
      { kind: "heading", text: "Next season's draft order" },
      {
        kind: "list",
        items: [
          "The champion picks last (#10) next year and the runner-up #9.",
          "Semifinal losers play once more: the winner takes 3rd place and pick #5, the loser #6.",
          "Round 1 playoff losers play once more: the winner takes #7, the loser #8.",
          "The losers bracket winner picks first (#1) and its runner-up #2. The Toilet Bowl champion picks #4, and the team that beat them #3.",
          "Want a later slot than you earned? Throw your losers bracket games without punishment, or trade picks with another owner.",
        ],
      },
    ],
  },
  {
    id: "prizes",
    title: "Entry Fee & Prizes",
    blocks: [
      {
        kind: "text",
        text: "The entry fee is {entryFee}, due by draft day, and every dollar of it goes back out as prize money. Payouts, season status and the all-time ledger live on the [Prize Tracker](prizes.html).",
      },
    ],
  },
  {
    id: "fair-play",
    title: "Fair Play & Sportsmanship",
    blocks: [
      {
        kind: "list",
        items: [
          "Every transaction must be made with the intent of improving your own team or its standing.",
          "Collusion is banned: no two owners agreeing to moves that benefit one team at the other's expense (roster dumping).",
          "The commissioner can cancel any transaction that violates these rules.",
          "For anything these rules don't cover, the commissioner has the final say.",
        ],
      },
    ],
  },
  // Rewritten for 2026, when the contest moved off elimination and onto revives: a miss costs a
  // revive and the run continues, so every entry plays all seventeen weeks and the winner is the
  // one who spent the fewest. Two things about that are worth keeping written down.
  //
  // **The tiebreaker is here because the format makes ties likely, not because one happened.**
  // Ten entries choosing over seventeen weeks will regularly finish level on revives, and a tie
  // discovered in January is settled by whoever argues hardest. The ladder walks the revives in
  // order (latest first revive, then the second, and so on), which keeps the whole contest scored
  // on survivor performance rather than importing a points total from the main league to break it.
  //
  // **Sleeper's own article describes the default format, in which a wrong pick ends the season,
  // and it does not document the revive settings at all.** So the link below names what it is
  // actually good for, making and changing picks, and the sentence around it says plainly that
  // this league overrides the elimination it describes. Linking it unqualified would put a page
  // saying "you'll be eliminated" one click from a rule saying nobody is.
  //
  // **Straight scoring is stated rather than left to the default.** Sleeper offers Straight and
  // Spread, and the choice decides whether a pick has to win outright or only cover, which is
  // the whole mechanic. It happens to be Sleeper's default, which is exactly why it is written
  // down: a rule that matches a default is indistinguishable from a setting nobody looked at.
  //
  // **There is no separate buy-in, and the prize figure is not typed here.** Survivor is one of
  // the eight lines in `PRIZE_SEASONS`, funded by the league entry fee like the rest, so the
  // rules point at the Prize Tracker instead of naming an amount that could drift from it.
  {
    id: "survivor",
    title: "Survivor Contest",
    blocks: [
      {
        kind: "text",
        text: "The prize is one of the lines on the [Prize Tracker](prizes.html), covered by the league entry fee like every other prize. It runs in its own Sleeper league, visible only in the Sleeper mobile app.",
      },
      { kind: "heading", text: "How it works" },
      {
        kind: "list",
        items: [
          "The contest runs Weeks 1 through 17.",
          "Each week, pick one NFL team to win. The pick can be changed until that team's game kicks off.",
          "Straight scoring, not spread. The pick has to win its game outright, with no point spread applied either way.",
          "A team can only be used once all season. Picking the Bills in Week 1 spends them for the year.",
          "A loss or a tie costs one revive. Nobody is knocked out: you keep picking the following week, and every team you have already used stays used.",
          "After Week 17, the fewest revives wins.",
        ],
      },
      {
        kind: "text",
        text: "Sleeper's [NFL Survivor](https://support.sleeper.com/en/articles/9689521-nfl-survivor) article covers making and changing picks, and both scoring formats, but it describes the default elimination rules, in which one wrong pick ends your season. This league runs Straight scoring with revives switched on, so a miss costs a revive and nothing more.",
      },
      { kind: "heading", text: "Tiebreakers" },
      {
        kind: "text",
        text: "Ten entries over seventeen picks makes a tie on revives likely rather than remote, so it is settled in advance. Everything below is survivor performance: no points, and nothing carried over from the main league.",
      },
      {
        kind: "list",
        ordered: true,
        items: [
          "Fewest revives.",
          "Still tied: the latest first revive, so whoever went furthest into the season before their first miss.",
          "Still tied: the latest second revive, then the third, and on down until one entry is ahead.",
          "Still tied after every revive has been compared: co-champions, and the prize splits evenly.",
        ],
      },
    ],
  },
];

/**
 * Rules documents published as Google Docs, one per season, for the years before this site
 * carried its own rules page.
 *
 * A closed list. 2025 is the last season that will ever be added to it, because 2026 onward is
 * written here and frozen here. Every URL is the doc's `/pub` address rather than its editable
 * one, so it renders as a page to anyone with the link and cannot be edited by a reader.
 *
 * **Three seasons are absent and that is the record, not a gap to fill.** No rules document
 * survives for 2006, 2007 or 2010. The page derives that sentence from this map against the
 * league's own season range, so finding one later removes the mention by adding the link.
 *
 * 2008 through 2014 open as "KAN Official Rules", the Keeper Alliance Network the league played
 * in then, and 2015 on as "FFL Official Rules". The page says nothing about that, the same call
 * `MFL_SEASONS` documents for the league's old MFL sites: it is a list of years, and a note about
 * a conference that folded a decade ago is more than the list is worth.
 *
 * **A link here is proved by the body it returns, never by its status code.** Every one was swept
 * anonymously on 2026-08-22 and its title read. Three traps sit in front of that, and each hands
 * back a confident wrong answer rather than an error:
 *
 * - A bare `curl` gets **401 on a doc that is published perfectly well**, because Google rejects
 *   its default user agent. So `-A "Mozilla/5.0"` is not optional, and a plain request reading as
 *   unpublished is not evidence of anything.
 * - With that agent an **unpublished doc answers 200**, serving a sign-in page in place of the
 *   document. A status check therefore passes on exactly the link that is broken.
 * - Drive's permissions API cannot see publish-to-web state at all, and reports owner-only for
 *   all seventeen of these whether or not they are published.
 *
 * What works: `curl -sL -A "Mozilla/5.0" <url>` and then read it. A real document carries a
 * `<title>` and runs ~215KB; the sign-in wall carries no title, runs ~9KB, and contains the
 * string "You must sign in to access this content". 2011 was the one link that failed the first
 * sweep; it was published that same day and has passed since.
 */
export const RULES_DOC_LINKS: Record<string, string> = {
  "2008": "https://docs.google.com/document/d/1VflHWUnApcswtZ5SJ7OwLz4L7xxVw6HpG_FxmR_Aikk/pub",
  "2009": "https://docs.google.com/document/d/1aBSVyJAzhNCCXvP6H2tsAgw4SXicdRXCTlBW8TpUAns/pub",
  // The one long URL here, and not a different kind of link. Docs published after 2018 get an
  // opaque token in place of the file id; the rest are short only because they were published
  // before that changed.
  "2011": "https://docs.google.com/document/d/e/2PACX-1vSrXpAOWd60P-nNUDSrc52jwNhvHtqcHfYdwYhd-_K6pgaZ8cRycmD_W5qwezZ38lJe9c3dNEV-hvPN/pub",
  "2012": "https://docs.google.com/document/d/1pXyTXoHox0YcPIbUoSA_08zcNoIeSohvGyU4bMR_IWg/pub",
  "2013": "https://docs.google.com/document/d/1yoEtb49JYj_tO6p2pZtMzlB1QgpFYP6SSuenyT9tnnM/pub",
  "2014": "https://docs.google.com/document/d/1IErWpeX_vk8TRdHxM5ctpoNKxfnm6tK4FhXK30facKg/pub",
  "2015": "https://docs.google.com/document/d/18jDwQhEiKaDXLOmjYNLaC2O0v0AaeTYdii0jf6_Eq0A/pub",
  "2016": "https://docs.google.com/document/d/10CY2dGrHjANIlGUZRpvSFO12lY4mVHdDt6O3UrZcGM8/pub",
  "2017": "https://docs.google.com/document/d/1flFBOFbSQdtKpYRmlhe0m6-UYhGk0dcvGuVNaeZxLbg/pub",
  "2018": "https://docs.google.com/document/d/17OfMmCetCnh9zphKb7uC5vs2c7GwMVyaUqEkE2C2r6A/pub",
  "2019": "https://docs.google.com/document/d/1nfIiQmk1NuXP1JSfcUnqrWXSWeYWsYvNyt3VxS7hy48/pub",
  "2020": "https://docs.google.com/document/d/1NVJjYhGRiN6gH6lxJlgkoYuv0GLFzBIuB4ufEIqVJug/pub",
  "2021": "https://docs.google.com/document/d/1xIHZcPmEjpSUxl9CndJAjFDFmLcdH1q-XRpXMjvn5UU/pub",
  "2022": "https://docs.google.com/document/d/1CTPKgyzXbj0X3cK-Xa_SO5csAnBv4Ak-VG-EJuYSWyI/pub",
  "2023": "https://docs.google.com/document/d/1XwdOIbANP6sQfGE8QepeXo8Voxjc0JZHO4Z9lk70q-w/pub",
  "2024": "https://docs.google.com/document/d/1xLcz7rkS1wAr7-mmS_EAw32SliiBEBpkgsyr1op1KDk/pub",
  "2025": "https://docs.google.com/document/d/1JqLo-wxlIXpqoS6YjYpdxe_aiZNPA0v5lC_8zFGjvcg/pub",
};

/**
 * Seasons whose rules are frozen as a page on this site, at `rules-<season>.html`.
 *
 * Empty until the 2026 season closes, which is when this list starts growing and
 * `RULES_DOC_LINKS` stops. The yearly ritual is three steps and this is the middle one: copy
 * `output/rules.html` to `output/rules-<season>.html` and commit it, add that season here, then
 * move `RULES_SEASON` forward and rewrite `RULES_SECTIONS`.
 *
 * A list of seasons rather than a list of URLs, because the filename is a convention rather than
 * a fact: `rulesPageFile()` builds it, so a season cannot be added under a name the page does not
 * actually serve. Nothing here is generated, so a season added without its file being committed
 * is a link to nothing, which is why the copy comes first.
 */
export const RULES_PAGE_SEASONS: string[] = [];

/** A frozen season's page, at the output root beside the current one. */
export function rulesPageFile(season: string): string {
  return `rules-${season}.html`;
}

/** Where a season's rules can be read, and whether that is somewhere else. */
export interface RulesArchiveEntry {
  season: string;
  href: string;
  /** A Google Doc rather than a page here, so the link opens in a new tab and says so. */
  external: boolean;
}

/**
 * Every past season's rules, newest first.
 *
 * A season frozen as a page here wins over a Google Doc of the same year, which cannot happen
 * today (the doc list ends at 2025 and the page list starts at 2026) and is settled anyway so
 * that it can never come down to object key order.
 */
export function rulesArchive(): RulesArchiveEntry[] {
  const entries = new Map<string, RulesArchiveEntry>();

  for (const [season, href] of Object.entries(RULES_DOC_LINKS)) {
    entries.set(season, { season, href, external: true });
  }
  for (const season of RULES_PAGE_SEASONS) {
    entries.set(season, { season, href: rulesPageFile(season), external: false });
  }

  return [...entries.values()].sort((a, b) => b.season.localeCompare(a.season));
}
