import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Snapshot, SnapshotRoster, NavLink } from "./types.js";
import { SNAPSHOT_TYPE_LABELS } from "./types.js";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function playerCell(p: { name: string; position: string; team: string } | undefined): string {
  if (!p) return "      <td></td>";
  const posClass = `pos-${p.position.toLowerCase()}`;
  const display = `${escapeHtml(p.name)} ${escapeHtml(p.team)} ${escapeHtml(p.position)}`;
  return `      <td class="${posClass}">${display}</td>`;
}

function buildSequentialRows(rosters: SnapshotRoster[], maxPlayers: number): string[] {
  const rows: string[] = [];
  for (let i = 0; i < maxPlayers; i++) {
    const cells = rosters.map((r) => playerCell(r.players[i])).join("\n");
    rows.push(`    <tr>\n${cells}\n    </tr>`);
  }
  return rows;
}

function buildPostDraftRows(rosters: SnapshotRoster[]): string[] {
  // Collect all rounds across all rosters
  const allRounds = new Set<number>();
  for (const r of rosters) {
    for (const p of r.players) {
      if (p.round != null) allRounds.add(p.round);
    }
  }
  const sortedRounds = [...allRounds].sort((a, b) => a - b);

  // For each round, find max picks any owner has
  const roundMaxPicks = new Map<number, number>();
  for (const round of sortedRounds) {
    let max = 1;
    for (const r of rosters) {
      const count = r.players.filter((p) => p.round === round).length;
      if (count > max) max = count;
    }
    roundMaxPicks.set(round, max);
  }

  // Build row labels and map picks
  const rows: string[] = [];
  for (const round of sortedRounds) {
    const maxPicks = roundMaxPicks.get(round)!;
    const needsSuffix = maxPicks > 1;

    for (let slot = 0; slot < maxPicks; slot++) {
      const label = needsSuffix
        ? `${round}${String.fromCharCode(97 + slot)}`  // 97 = 'a'
        : `${round}`;

      const cells = rosters.map((r) => {
        const roundPlayers = r.players.filter((p) => p.round === round);
        return playerCell(roundPlayers[slot]);
      }).join("\n");

      rows.push(`    <tr>\n      <td>${label}</td>\n${cells}\n    </tr>`);
    }
  }

  return rows;
}

export function generateHtml(snapshot: Snapshot, navLinks: NavLink[] = [], ownerOrder?: string[]): string {
  const typeLabel = SNAPSHOT_TYPE_LABELS[snapshot.snapshotType] ?? "Rosters";
  // Sort rosters by draft order if available, otherwise alphabetically
  const rosters = [...snapshot.rosters].sort((a, b) => {
    if (ownerOrder) {
      const idxA = ownerOrder.indexOf(a.ownerName);
      const idxB = ownerOrder.indexOf(b.ownerName);
      // Owners not in the order list go to the end, sorted alphabetically
      if (idxA >= 0 && idxB >= 0) return idxA - idxB;
      if (idxA >= 0) return -1;
      if (idxB >= 0) return 1;
    }
    return a.ownerName.localeCompare(b.ownerName);
  });
  const maxPlayers = Math.max(...rosters.map((r) => r.players.length));

  // Build header row
  const headerCells = rosters
    .map((r) => `      <th>${escapeHtml(r.ownerName)}</th>`)
    .join("\n");

  // Build data rows
  const isPostDraft = snapshot.snapshotType === "post-draft" && rosters.some((r) => r.players.some((p) => p.round != null));
  const dataRows: string[] = isPostDraft
    ? buildPostDraftRows(rosters)
    : buildSequentialRows(rosters, maxPlayers);

  // Build nav bar
  let navHtml = "";
  if (navLinks.length > 1) {
    // Group by season
    const seasons = new Map<string, NavLink[]>();
    for (const link of navLinks) {
      const group = seasons.get(link.season) ?? [];
      group.push(link);
      seasons.set(link.season, group);
    }

    const seasonBlocks: string[] = [];
    for (const [season, links] of seasons) {
      const items = links
        .map((l) => {
          const shortLabel = SNAPSHOT_TYPE_LABELS[l.snapshotType]
            .replace(" Rosters", "");
          if (l.current) {
            return `<span class="nav-current">${escapeHtml(shortLabel)}</span>`;
          }
          return `<a href="${escapeHtml(l.href)}">${escapeHtml(shortLabel)}</a>`;
        })
        .join("");
      seasonBlocks.push(`<span class="nav-season">${escapeHtml(season)}</span>${items}`);
    }
    navHtml = `  <nav class="nav"><a href="../index.html">Home</a><span class="nav-sep"></span>${seasonBlocks.join('<span class="nav-sep"></span>')}</nav>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(snapshot.leagueName)} - ${escapeHtml(snapshot.season)} ${escapeHtml(typeLabel)}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      margin: 20px;
      background: #f5f5f5;
    }
    h1 { margin-bottom: 4px; }
    .meta { color: #666; margin-bottom: 16px; }
    .nav {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 16px;
      font-size: 13px;
    }
    .nav-season {
      font-weight: 600;
      color: #444;
      margin-left: 4px;
    }
    .nav-season:first-child { margin-left: 0; }
    .nav a {
      color: #2a5a8a;
      text-decoration: none;
      padding: 2px 8px;
      border-radius: 3px;
    }
    .nav a:hover {
      background: #e0e8f0;
      text-decoration: underline;
    }
    .nav-current {
      color: #333;
      font-weight: 600;
      padding: 2px 8px;
      background: #d8e2ec;
      border-radius: 3px;
    }
    .nav-sep {
      width: 1px;
      height: 16px;
      background: #ccc;
      margin: 0 6px;
    }
    table {
      border-collapse: collapse;
      background: white;
      font-size: 13px;
    }
    th, td {
      border: 1px solid #ccc;
      padding: 4px 8px;
      white-space: nowrap;
    }
    th {
      background: #2a5a8a;
      color: white;
      position: sticky;
      top: 0;
    }
${isPostDraft ? `    td:first-child {
      text-align: center;
      font-weight: bold;
      color: #888;
      width: 30px;
    }` : ""}
    .pos-wr  { background: #d0e8ff; }
    .pos-rb  { background: #d0f0d0; }
    .pos-qb  { background: #ffc0cb; }
    .pos-te  { background: #ffe0b2; }
    .pos-def { background: #d2b48c; }
    .pos-k   { background: #e0d0f0; }
  </style>
</head>
<body>
  <h1>${escapeHtml(snapshot.leagueName)}</h1>
  <h2>${escapeHtml(snapshot.season)} ${escapeHtml(typeLabel)}</h2>
${navHtml}
  <div class="meta">Captured ${escapeHtml(snapshot.capturedAt)}</div>
  <table>
    <tr>
${isPostDraft ? '      <th>Rnd</th>\n' : ''}${headerCells}
    </tr>
${dataRows.join("\n")}
  </table>
</body>
</html>`;
}

export function generateIndexHtml(leagueName: string, navLinks: NavLink[]): string {
  // Group by season (most recent first)
  const seasons = new Map<string, NavLink[]>();
  for (const link of navLinks) {
    const group = seasons.get(link.season) ?? [];
    group.push(link);
    seasons.set(link.season, group);
  }
  const sortedSeasons = [...seasons.keys()].sort().reverse();

  const seasonRows = sortedSeasons
    .map((season) => {
      const links = seasons.get(season)!;
      const items = links
        .map((l) => {
          const shortLabel = SNAPSHOT_TYPE_LABELS[l.snapshotType].replace(" Rosters", "");
          return `<a href="${escapeHtml(l.href)}">${escapeHtml(shortLabel)}</a>`;
        })
        .join("");
      return `    <div class="season"><span class="year">${escapeHtml(season)}</span>${items}</div>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(leagueName)}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      margin: 40px 20px;
      background: #f5f5f5;
    }
    h1 { margin-bottom: 24px; }
    .seasons { display: flex; flex-direction: column; gap: 8px; }
    .season {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 14px;
    }
    .year {
      font-weight: 600;
      color: #444;
      min-width: 48px;
    }
    .season a {
      color: #2a5a8a;
      text-decoration: none;
      padding: 3px 10px;
      border-radius: 3px;
    }
    .season a:hover {
      background: #e0e8f0;
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(leagueName)}</h1>
  <div class="seasons">
${seasonRows}
  </div>
</body>
</html>`;
}

export async function writeHtml(
  html: string,
  outputPath: string
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, html, "utf-8");
}
