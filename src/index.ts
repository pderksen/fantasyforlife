import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { takeSnapshot, takePostDraftSnapshot, saveSnapshot, loadSnapshot, getSnapshotPath, getDraftPicksPath, getDraftTradedPicksPath, saveDraftPicks, saveDraftTradedPicks, getOutputPath, getExportOutputPath, buildNavLinks, buildIndexNavLinks, getIndexOutputPath, getHistoryOutputPath, loadDraftOrder, loadDraftRoundsFor, buildRosterOwnerMap, resolveTradedPicks, buildTradeDateMap, saveTradedPicks, loadTradedPicks, picksForDraft, picksAwaitingDraft, resolveTrades, saveTrades, preDraftWindowClosed, hasSiteMark, syncStaticAssets, newestNavLink, SnapshotGuardError } from "./snapshot.js";
import { generateHtml, generateIndexHtml, generateHistoryHtml, writeHtml, formatPacificDate } from "./html.js";
import { generateWorkbook, writeWorkbook } from "./xlsx.js";
import { getLeagueDrafts, getDraftPicks, getDraftTradedPicksRaw, fetchAllPlayers, getLeagueTradedPicks, getPickTrades, getTrades, getLeague } from "./sleeper-api.js";
import { getTierConfig, getLatestDraftOrder } from "./tiers.js";
import type { Snapshot, SnapshotType, DraftPick, NavLink, ResolvedTradedPick, TierConfig, PlayerDatabase } from "./types.js";
import type { DraftRoundLookup } from "./roster-grid.js";

// Sleeper mints a new league id each season and links back via `previous_league_id`.
// Point this at the current season's league; earlier ones are reachable by walking that
// chain (see getLeagueLineage). 2025: 1220634180434526208.
const DEFAULT_LEAGUE_ID = "1331127568820109312";  // 2026
const LEAGUE_NAME = "Fantasy For Life (FFL)";
const SNAPSHOT_TYPES: SnapshotType[] = ["pre-draft", "post-draft", "end-of-season"];

function isSnapshotType(value: string): value is SnapshotType {
  return (SNAPSHOT_TYPES as string[]).includes(value);
}

async function fetchAndSaveTradedPicks(leagueId: string, season: string): Promise<ResolvedTradedPick[]> {
  console.log("Fetching traded picks...");
  const [rawPicks, rosterOwnerMap, pickTrades] = await Promise.all([
    getLeagueTradedPicks(leagueId),
    buildRosterOwnerMap(leagueId),
    getPickTrades(leagueId),
  ]);

  const tradedPicks = resolveTradedPicks(rawPicks, rosterOwnerMap, buildTradeDateMap(pickTrades));
  const tradedPicksPath = await saveTradedPicks(leagueId, season, tradedPicks, rawPicks);

  // Sealed seasons keep their archived capture; render from that, not the fresh fetch.
  if (!tradedPicksPath) {
    console.log(`Traded picks for ${season} are sealed (a newer season has data) — left unchanged.`);
    return (await loadTradedPicks(season)) ?? [];
  }
  console.log(`Traded picks saved: ${tradedPicksPath} (${tradedPicks.length} traded picks)`);

  if (tradedPicks.length > 0) {
    console.log("\nTraded picks:");
    for (const pick of tradedPicks) {
      const when = pick.tradedOn ? ` (traded ${formatPacificDate(pick.tradedOn)})` : "";
      console.log(`  ${pick.season} Rd ${pick.round}: ${pick.originalOwner}'s pick → ${pick.currentOwner}${when}`);
    }
  }

  return tradedPicks;
}

/**
 * Fetch and save a season's trade log. Nothing renders it today; it is captured so the
 * history exists to render later, and because it can only be read out of the live league.
 *
 * The player database is only needed to name the players in a trade, so it is fetched
 * lazily — a season with no trades yet (every run before September) never pays the 15MB.
 * Callers that already hold one pass it in.
 */
async function fetchAndSaveTrades(leagueId: string, season: string, playerDb?: PlayerDatabase): Promise<void> {
  console.log("Fetching trades...");
  const [rawTrades, rosterOwnerMap] = await Promise.all([
    getTrades(leagueId),
    buildRosterOwnerMap(leagueId),
  ]);

  if (rawTrades.length === 0) {
    // Write nothing rather than an empty log; any earlier capture stands.
    console.log(`No completed trades recorded in the ${season} league.`);
  } else {
    const trades = resolveTrades(rawTrades, rosterOwnerMap, playerDb ?? await fetchAllPlayers());
    const tradesPath = await saveTrades(leagueId, season, trades, rawTrades);
    if (tradesPath) {
      console.log(`Trades saved: ${tradesPath} (${trades.length} trades)`);
    } else {
      console.log(`Trades for ${season} are sealed (a newer season has data) — left unchanged.`);
    }
  }
}

async function regenerateIndex(): Promise<void> {
  const navLinks = buildIndexNavLinks();
  if (navLinks.length === 0) return;

  // Latest saved capture wins — no live fetch here, so --generate stays offline.
  const latestSeason = navLinks[navLinks.length - 1].season;
  const allPicks = (await loadTradedPicks(latestSeason)) ?? [];

  // The latest season has drafted once it has any snapshot beyond pre-draft. Until then
  // its own picks are still upcoming and belong on the home page alongside future years.
  const latestHasDrafted = navLinks.some(
    (l) => l.season === latestSeason && (l.page === "post-draft" || l.page === "end-of-season"),
  );
  const lastDraftedSeason = latestHasDrafted ? latestSeason : String(Number(latestSeason) - 1);
  const upcomingPicks = picksAwaitingDraft(allPicks, lastDraftedSeason);

  const draftOrder = getLatestDraftOrder();
  const html = generateIndexHtml(LEAGUE_NAME, navLinks, upcomingPicks, draftOrder, hasSiteMark());
  const outputPath = getIndexOutputPath();
  await writeHtml(html, outputPath);
  console.log(`Index written: ${outputPath}`);
}

/**
 * Rewrite the League History page. Unlike the index it depends on no snapshot data, so it is
 * written on every run regardless of whether any roster page exists yet — the only thing it
 * takes from the nav links is where "Current Tiers" points.
 */
async function regenerateHistory(): Promise<void> {
  const outputPath = getHistoryOutputPath();
  await writeHtml(generateHistoryHtml(LEAGUE_NAME, buildIndexNavLinks(), hasSiteMark()), outputPath);
  console.log(`History written: ${outputPath}`);
}

interface RosterPageInputs {
  navLinks: NavLink[];
  ownerOrder?: string[];
  tiers?: TierConfig;
  draftRounds?: DraftRoundLookup;
  tradedPicks?: ResolvedTradedPick[];
}

/**
 * Write a season's page and its Excel export. The two always ship together — the page links
 * its own workbook as a sibling, so a run that wrote one and not the other would serve a
 * dead link or a stale download. Every generate path goes through here for that reason.
 */
async function writeRosterOutputs(snapshot: Snapshot, inputs: RosterPageInputs): Promise<void> {
  const { navLinks, ownerOrder, tiers, draftRounds, tradedPicks } = inputs;
  const { season, snapshotType } = snapshot;

  // Roster pages sit one directory down from the output root, so the site header's avatar
  // and "Current Tiers" link need to climb back out.
  const chrome = { base: "../", hasMark: hasSiteMark(), tiersHref: newestNavLink(navLinks)?.href, fullBleed: true };

  const outputPath = getOutputPath(season, snapshotType);
  await writeHtml(generateHtml(snapshot, navLinks, ownerOrder, tiers, draftRounds, tradedPicks, chrome), outputPath);
  console.log(`HTML written: ${outputPath}`);

  const exportPath = getExportOutputPath(season, snapshotType);
  await writeWorkbook(generateWorkbook(snapshot, { ownerOrder, tiers, draftRounds, tradedPicks }), exportPath);
  console.log(`Excel written: ${exportPath}`);
}

/**
 * Open a local file in the OS default browser (detached, so npm exits immediately).
 * Hand-rolled rather than pulling in an `open` package — this project has zero runtime deps.
 */
function openInDefaultBrowser(filePath: string): void {
  const [cmd, args] =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", filePath]] :
    process.platform === "darwin" ? ["open", [filePath]] :
    ["xdg-open", [filePath]];

  spawn(cmd, args as string[], { detached: true, stdio: "ignore" }).unref();
}

function printUsage(): void {
  console.log(`Usage:
  npm run dev
    Regenerate the home page and open it in your default browser.

  npm run dev -- --snapshot <type> [league_id] [--force]
    Take a new roster snapshot and generate HTML.
    type: pre-draft | post-draft | end-of-season
    Re-running pre-draft is expected while keepers trickle in. --force is only
    needed to overwrite a saved capture with one holding fewer keepers, or to
    capture pre-draft after the draft has already run.

  npm run dev -- --snapshot-draft <season> [league_id]
    Generate post-draft roster snapshot from draft picks data.
    Uses existing data/<season>/draft-picks.json if available,
    otherwise fetches from the Sleeper API.

  npm run dev -- --generate <season> [type]
    Generate HTML from existing snapshot(s).
    If type is omitted, generates for all existing snapshots in the season.

  npm run dev -- --traded-picks [league_id]
    Fetch and save traded picks for upcoming seasons.

  npm run dev -- --trades [league_id]
    Fetch and save that league's completed trades to data/<season>/trades.json.
    Archive only — no page is generated. Also runs as part of every --snapshot.
`);
}

async function snapshotAndGenerate(snapshotType: SnapshotType, leagueId: string, force: boolean): Promise<void> {
  console.log(`Taking ${snapshotType} snapshot for league: ${leagueId}\n`);

  // Checked here, before the 15MB player fetch, because it is one cheap call and the answer
  // is definitive: past `pre_draft` there are no keepers left to read, so the capture could
  // only be worse than the file it would replace.
  if (snapshotType === "pre-draft" && !force) {
    const league = await getLeague(leagueId);
    if (preDraftWindowClosed(league.status)) {
      throw new SnapshotGuardError(
        `League ${leagueId} reports status "${league.status}", not "pre_draft".\n` +
        `  The draft has already run, so Sleeper has consumed the keeper selections and\n` +
        `  there are none left to capture. Nothing was fetched or written. Any saved\n` +
        `  pre-draft snapshot is the record. Re-run with --force to capture anyway.`,
      );
    }
  }

  // Fetch player DB to resolve player IDs to names/positions/teams
  console.log("Fetching player database...");
  const playerDb = await fetchAllPlayers();

  const snapshot = await takeSnapshot(leagueId, snapshotType, playerDb);

  const snapshotPath = await saveSnapshot(snapshot, force);
  console.log(`\nSnapshot saved: ${snapshotPath}`);

  // Fetch and save traded picks
  const tradedPicks = await fetchAndSaveTradedPicks(leagueId, snapshot.season);

  // Before the roster page renders, so a first trade log puts its chip in that page's nav.
  await fetchAndSaveTrades(leagueId, snapshot.season, playerDb);

  const ownerOrder = await loadDraftOrder(snapshot.season);
  const navLinks = buildNavLinks(snapshot.season, snapshotType);
  const tiers = getTierConfig(snapshot.season, snapshotType);
  const draftRounds = await loadDraftRoundsFor(snapshot.season, snapshotType);
  // Pre-draft shows the picks in the draft about to happen; post-draft and end-of-season
  // show what's still outstanding for future drafts.
  const picksForType = snapshotType === "pre-draft"
    ? picksForDraft(tradedPicks, snapshot.season)
    : picksAwaitingDraft(tradedPicks, snapshot.season);
  await writeRosterOutputs(snapshot, { navLinks, ownerOrder, tiers, draftRounds, tradedPicks: picksForType });
}

async function draftSnapshotAndGenerate(season: string, leagueId: string): Promise<void> {
  // Load draft picks from disk or fetch from API
  const draftPicksPath = getDraftPicksPath(season);
  let draftPicks: DraftPick[];
  let draftId: string | undefined;

  if (existsSync(draftPicksPath)) {
    console.log(`Loading draft picks from ${draftPicksPath}`);
    const raw = await readFile(draftPicksPath, "utf-8");
    draftPicks = JSON.parse(raw) as DraftPick[];
    draftId = draftPicks[0]?.draft_id;
  } else {
    console.log("No local draft picks found, fetching from API...");
    // Need draft ID — fetch drafts for the league to find it
    const drafts = await getLeagueDrafts(leagueId);
    const draft = drafts.find((d) => d.season === season);
    if (!draft) {
      throw new Error(`No draft found for season ${season}`);
    }
    draftId = draft.draft_id;
    draftPicks = await getDraftPicks(draftId);

    // Persist before generating anything. The data model treats these picks as the
    // immutable draft record, and every post-draft rebuild reads them back from here.
    const savedPath = await saveDraftPicks(season, draftPicks);
    if (savedPath) console.log(`Draft picks saved: ${savedPath} (${draftPicks.length} picks)`);
  }

  // Picks traded inside the draft are part of that same immutable record and are only
  // reachable per draft id, so capture them whenever they're missing — including runs
  // that loaded the picks off disk.
  if (draftId && !existsSync(getDraftTradedPicksPath(season))) {
    const savedPath = await saveDraftTradedPicks(season, await getDraftTradedPicksRaw(draftId));
    if (savedPath) console.log(`Draft traded picks saved: ${savedPath}`);
  }

  console.log(`\nGenerating post-draft snapshot from ${draftPicks.length} draft picks\n`);

  const snapshot = await takePostDraftSnapshot(leagueId, draftPicks);
  const snapshotPath = await saveSnapshot(snapshot);
  console.log(`\nSnapshot saved: ${snapshotPath}`);

  // Fetch and save traded picks
  const tradedPicks = await fetchAndSaveTradedPicks(leagueId, season);

  const ownerOrder = snapshot.rosters.map((r) => r.ownerName);
  await writeRosterOutputs(snapshot, {
    navLinks: buildNavLinks(season, "post-draft"),
    ownerOrder,
    tiers: getTierConfig(season, "post-draft"),
    tradedPicks: picksAwaitingDraft(tradedPicks, season),
  });
}

async function generateFromExisting(season: string, snapshotType?: SnapshotType): Promise<void> {
  const types = snapshotType ? [snapshotType] : SNAPSHOT_TYPES;
  const ownerOrder = await loadDraftOrder(season);
  const tradedPicks = (await loadTradedPicks(season)) ?? [];

  for (const type of types) {
    const snapshotPath = getSnapshotPath(season, type);
    // A missing file is the only thing that means "nothing to generate". Anything else —
    // JSON a hand edit broke, an unwritable output directory — is a real failure and has
    // to surface as one; hand-editing snapshots is a supported workflow, so a parse error
    // reported as "no snapshot found" would send you looking in the wrong place entirely.
    if (!existsSync(snapshotPath)) {
      if (snapshotType) throw new Error(`Snapshot not found: ${snapshotPath}`);
      console.log(`Skipping ${type}: no snapshot found at ${snapshotPath}`);
      continue;
    }

    const snapshot = await loadSnapshot(snapshotPath);
    const picksForType = type === "pre-draft"
      ? picksForDraft(tradedPicks, season)
      : picksAwaitingDraft(tradedPicks, season);
    await writeRosterOutputs(snapshot, {
      navLinks: buildNavLinks(season, type),
      ownerOrder,
      tiers: getTierConfig(season, type),
      draftRounds: await loadDraftRoundsFor(season, type),
      tradedPicks: picksForType,
    });
  }
}

async function main(): Promise<void> {
  // --force is positional-agnostic, so pull it out before anything reads args by index.
  const rawArgs = process.argv.slice(2);
  const force = rawArgs.includes("--force");
  const args = rawArgs.filter((a) => a !== "--force");

  // Bare `npm run dev` — regenerate the index below, then open it locally.
  const openHomePage = args.length === 0;

  if (openHomePage) {
    // Nothing to do here; falls through to regenerateIndex() + open.

  } else if (args[0] === "--help" || args[0] === "-h") {
    printUsage();
    return;

  } else if (args[0] === "--snapshot") {
    const type = args[1];
    if (!type || !isSnapshotType(type)) {
      printUsage();
      process.exit(1);
    }
    const leagueId = args[2] || DEFAULT_LEAGUE_ID;
    await snapshotAndGenerate(type, leagueId, force);

  } else if (args[0] === "--snapshot-draft") {
    const season = args[1];
    if (!season) {
      printUsage();
      process.exit(1);
    }
    const leagueId = args[2] || DEFAULT_LEAGUE_ID;
    await draftSnapshotAndGenerate(season, leagueId);

  } else if (args[0] === "--generate") {
    const season = args[1];
    if (!season) {
      printUsage();
      process.exit(1);
    }
    const type = args[2];
    if (type && !isSnapshotType(type)) {
      printUsage();
      process.exit(1);
    }
    await generateFromExisting(season, type as SnapshotType | undefined);

  } else if (args[0] === "--traded-picks") {
    const leagueId = args[1] || DEFAULT_LEAGUE_ID;
    const league = await getLeague(leagueId);
    await fetchAndSaveTradedPicks(leagueId, league.season);

  } else if (args[0] === "--trades") {
    // Takes a league id rather than a season: trades are read out of the league that
    // recorded them, so backfilling an older year means naming that year's league.
    const leagueId = args[1] || DEFAULT_LEAGUE_ID;
    const league = await getLeague(leagueId);
    await fetchAndSaveTrades(leagueId, league.season);

  } else {
    printUsage();
    process.exit(1);
  }

  // Every run mirrors assets/ into output/, so a page that references the avatar always has
  // it beside them. Cheap, and it means dropping a new file in assets/ needs no other step.
  await syncStaticAssets();

  // Always regenerate the index page to pick up any new snapshots
  await regenerateIndex();
  await regenerateHistory();

  if (openHomePage) {
    const indexPath = getIndexOutputPath();
    console.log(`Opening ${indexPath} in your default browser...`);
    openInDefaultBrowser(indexPath);
  }
}

main().catch((err) => {
  // A tripped guard is a decision the run made on purpose, so print the message it wrote
  // rather than a stack trace. Everything else is a genuine failure and keeps its stack.
  if (err instanceof SnapshotGuardError) {
    console.error(`\n${err.message}`);
  } else {
    console.error("Fatal error:", err);
  }
  // Set the code and let Node unwind rather than calling process.exit(): on Windows,
  // exiting outright while a just-completed fetch is still tearing down trips a libuv
  // assertion, and the shell sees a crash status instead of 1.
  process.exitCode = 1;
});
