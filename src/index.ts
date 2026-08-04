import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { takeSnapshot, takePostDraftSnapshot, saveSnapshot, loadSnapshot, getSnapshotPath, getDraftPicksPath, getOutputPath, buildNavLinks, buildIndexNavLinks, getIndexOutputPath, loadDraftOrder, loadDraftRounds, buildRosterOwnerMap, resolveTradedPicks, saveTradedPicks, loadTradedPicks, picksForDraft, picksAwaitingDraft } from "./snapshot.js";
import { generateHtml, generateIndexHtml, writeHtml } from "./html.js";
import { getDraftPicks, fetchAllPlayers, getLeagueTradedPicks, getLeague } from "./sleeper-api.js";
import { getTierConfig, getLatestDraftOrder } from "./tiers.js";
import type { SnapshotType, DraftPick, ResolvedTradedPick } from "./types.js";

const DEFAULT_LEAGUE_ID = "1220634180434526208";
const LEAGUE_NAME = "Fantasy For Life (FFL)";
const SNAPSHOT_TYPES: SnapshotType[] = ["pre-draft", "post-draft", "end-of-season"];

function isSnapshotType(value: string): value is SnapshotType {
  return (SNAPSHOT_TYPES as string[]).includes(value);
}

async function fetchAndSaveTradedPicks(leagueId: string, season: string): Promise<ResolvedTradedPick[]> {
  console.log("Fetching traded picks...");
  const [rawPicks, rosterOwnerMap] = await Promise.all([
    getLeagueTradedPicks(leagueId),
    buildRosterOwnerMap(leagueId),
  ]);

  const tradedPicks = resolveTradedPicks(rawPicks, rosterOwnerMap);
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
      console.log(`  ${pick.season} Rd ${pick.round}: ${pick.originalOwner}'s pick → ${pick.currentOwner}`);
    }
  }

  return tradedPicks;
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
    (l) => l.season === latestSeason && l.snapshotType !== "pre-draft",
  );
  const lastDraftedSeason = latestHasDrafted ? latestSeason : String(Number(latestSeason) - 1);
  const upcomingPicks = picksAwaitingDraft(allPicks, lastDraftedSeason);

  const draftOrder = getLatestDraftOrder();
  const html = generateIndexHtml(LEAGUE_NAME, navLinks, upcomingPicks, draftOrder);
  const outputPath = getIndexOutputPath();
  await writeHtml(html, outputPath);
  console.log(`Index written: ${outputPath}`);
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

  npm run dev -- --snapshot <type> [league_id]
    Take a new roster snapshot and generate HTML.
    type: pre-draft | post-draft | end-of-season

  npm run dev -- --snapshot-draft <season> [league_id]
    Generate post-draft roster snapshot from draft picks data.
    Uses existing data/<season>/draft-picks.json if available,
    otherwise fetches from the Sleeper API.

  npm run dev -- --generate <season> [type]
    Generate HTML from existing snapshot(s).
    If type is omitted, generates for all existing snapshots in the season.

  npm run dev -- --traded-picks [league_id]
    Fetch and save traded picks for upcoming seasons.
`);
}

async function snapshotAndGenerate(snapshotType: SnapshotType, leagueId: string): Promise<void> {
  console.log(`Taking ${snapshotType} snapshot for league: ${leagueId}\n`);

  // Fetch player DB to resolve player IDs to names/positions/teams
  console.log("Fetching player database...");
  const playerDb = await fetchAllPlayers();

  const snapshot = await takeSnapshot(leagueId, snapshotType, playerDb);

  const snapshotPath = await saveSnapshot(snapshot);
  console.log(`\nSnapshot saved: ${snapshotPath}`);

  // Fetch and save traded picks
  const tradedPicks = await fetchAndSaveTradedPicks(leagueId, snapshot.season);

  const ownerOrder = await loadDraftOrder(snapshot.season);
  const navLinks = buildNavLinks(snapshot.season, snapshotType);
  const tiers = getTierConfig(snapshot.season, snapshotType);
  const draftRounds = await loadDraftRounds(snapshot.season);
  // Pre-draft shows the picks in the draft about to happen; post-draft and end-of-season
  // show what's still outstanding for future drafts.
  const picksForType = snapshotType === "pre-draft"
    ? picksForDraft(tradedPicks, snapshot.season)
    : picksAwaitingDraft(tradedPicks, snapshot.season);
  const html = generateHtml(snapshot, navLinks, ownerOrder, tiers, draftRounds, picksForType);
  const outputPath = getOutputPath(snapshot.season, snapshotType);
  await writeHtml(html, outputPath);
  console.log(`HTML written: ${outputPath}`);
}

async function draftSnapshotAndGenerate(season: string, leagueId: string): Promise<void> {
  // Load draft picks from disk or fetch from API
  const draftPicksPath = getDraftPicksPath(season);
  let draftPicks: DraftPick[];

  if (existsSync(draftPicksPath)) {
    console.log(`Loading draft picks from ${draftPicksPath}`);
    const raw = await readFile(draftPicksPath, "utf-8");
    draftPicks = JSON.parse(raw) as DraftPick[];
  } else {
    console.log("No local draft picks found, fetching from API...");
    // Need draft ID — fetch drafts for the league to find it
    const resp = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/drafts`);
    const drafts = await resp.json() as Array<{ draft_id: string; season: string }>;
    const draft = drafts.find((d) => d.season === season);
    if (!draft) {
      throw new Error(`No draft found for season ${season}`);
    }
    draftPicks = await getDraftPicks(draft.draft_id);
  }

  console.log(`\nGenerating post-draft snapshot from ${draftPicks.length} draft picks\n`);

  const snapshot = await takePostDraftSnapshot(leagueId, draftPicks);
  const snapshotPath = await saveSnapshot(snapshot);
  console.log(`\nSnapshot saved: ${snapshotPath}`);

  // Fetch and save traded picks
  const tradedPicks = await fetchAndSaveTradedPicks(leagueId, season);

  const ownerOrder = snapshot.rosters.map((r) => r.ownerName);
  const navLinks = buildNavLinks(season, "post-draft");
  const tiers = getTierConfig(season, "post-draft");
  const html = generateHtml(snapshot, navLinks, ownerOrder, tiers, undefined, picksAwaitingDraft(tradedPicks, season));
  const outputPath = getOutputPath(season, "post-draft");
  await writeHtml(html, outputPath);
  console.log(`HTML written: ${outputPath}`);
}

async function generateFromExisting(season: string, snapshotType?: SnapshotType): Promise<void> {
  const types = snapshotType ? [snapshotType] : SNAPSHOT_TYPES;
  const ownerOrder = await loadDraftOrder(season);
  const draftRounds = await loadDraftRounds(season);
  const tradedPicks = (await loadTradedPicks(season)) ?? [];

  for (const type of types) {
    const snapshotPath = getSnapshotPath(season, type);
    try {
      const snapshot = await loadSnapshot(snapshotPath);
      const navLinks = buildNavLinks(season, type);
      const tiers = getTierConfig(season, type);
      const picksForType = type === "pre-draft"
        ? picksForDraft(tradedPicks, season)
        : picksAwaitingDraft(tradedPicks, season);
      const html = generateHtml(snapshot, navLinks, ownerOrder, tiers, draftRounds, picksForType);
      const outputPath = getOutputPath(season, type);
      await writeHtml(html, outputPath);
      console.log(`HTML written: ${outputPath}`);
    } catch {
      if (!snapshotType) {
        console.log(`Skipping ${type}: no snapshot found at ${snapshotPath}`);
      } else {
        throw new Error(`Snapshot not found: ${snapshotPath}`);
      }
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

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
    await snapshotAndGenerate(type, leagueId);

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

  } else {
    printUsage();
    process.exit(1);
  }

  // Always regenerate the index page to pick up any new snapshots
  await regenerateIndex();

  if (openHomePage) {
    const indexPath = getIndexOutputPath();
    console.log(`Opening ${indexPath} in your default browser...`);
    openInDefaultBrowser(indexPath);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
