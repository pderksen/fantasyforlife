import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { takeSnapshot, takePostDraftSnapshot, saveSnapshot, savePlayerData, loadSnapshot, getSnapshotPath, getDraftPicksPath, getOutputPath, buildNavLinks, buildIndexNavLinks, getIndexOutputPath, loadDraftOrder } from "./snapshot.js";
import { generateHtml, generateIndexHtml, writeHtml } from "./html.js";
import { getDraftPicks, fetchAllPlayers } from "./sleeper-api.js";
import type { SnapshotType, DraftPick } from "./types.js";

const DEFAULT_LEAGUE_ID = "1220634180434526208";
const LEAGUE_NAME = "Fantasy For Life (FFL)";
const SNAPSHOT_TYPES: SnapshotType[] = ["pre-draft", "post-draft", "end-of-season"];

function isSnapshotType(value: string): value is SnapshotType {
  return (SNAPSHOT_TYPES as string[]).includes(value);
}

async function regenerateIndex(): Promise<void> {
  const navLinks = buildIndexNavLinks();
  if (navLinks.length === 0) return;
  const html = generateIndexHtml(LEAGUE_NAME, navLinks);
  const outputPath = getIndexOutputPath();
  await writeHtml(html, outputPath);
  console.log(`Index written: ${outputPath}`);
}

function printUsage(): void {
  console.log(`Usage:
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
`);
}

async function snapshotAndGenerate(snapshotType: SnapshotType, leagueId: string): Promise<void> {
  console.log(`Taking ${snapshotType} snapshot for league: ${leagueId}\n`);

  // Fetch player DB so we can both use it for the snapshot and save it
  console.log("Fetching player database...");
  const playerDb = await fetchAllPlayers();

  const snapshot = await takeSnapshot(leagueId, snapshotType, playerDb);

  const playerDataPath = await savePlayerData(playerDb, snapshot.season);
  console.log(`Player data saved: ${playerDataPath}`);

  const snapshotPath = await saveSnapshot(snapshot);
  console.log(`\nSnapshot saved: ${snapshotPath}`);

  const ownerOrder = await loadDraftOrder(snapshot.season);
  const navLinks = buildNavLinks(snapshot.season, snapshotType);
  const html = generateHtml(snapshot, navLinks, ownerOrder);
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

  const ownerOrder = snapshot.rosters.map((r) => r.ownerName);
  const navLinks = buildNavLinks(season, "post-draft");
  const html = generateHtml(snapshot, navLinks, ownerOrder);
  const outputPath = getOutputPath(season, "post-draft");
  await writeHtml(html, outputPath);
  console.log(`HTML written: ${outputPath}`);
}

async function generateFromExisting(season: string, snapshotType?: SnapshotType): Promise<void> {
  const types = snapshotType ? [snapshotType] : SNAPSHOT_TYPES;
  const ownerOrder = await loadDraftOrder(season);

  for (const type of types) {
    const snapshotPath = getSnapshotPath(season, type);
    try {
      const snapshot = await loadSnapshot(snapshotPath);
      const navLinks = buildNavLinks(season, type);
      const html = generateHtml(snapshot, navLinks, ownerOrder);
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

  if (args[0] === "--snapshot") {
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

  } else {
    printUsage();
    process.exit(1);
  }

  // Always regenerate the index page to pick up any new snapshots
  await regenerateIndex();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
