import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Snapshot, NavLink } from "./types.js";
import { SNAPSHOT_TYPE_LABELS } from "./types.js";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function generateHtml(snapshot: Snapshot, navLinks: NavLink[] = []): string {
  const typeLabel = SNAPSHOT_TYPE_LABELS[snapshot.snapshotType] ?? "Rosters";
  const { rosters } = snapshot;
  const maxPlayers = Math.max(...rosters.map((r) => r.players.length));

  // Build header row
  const headerCells = rosters
    .map((r) => `      <th>${escapeHtml(r.ownerName)}</th>`)
    .join("\n");

  // Build data rows
  const dataRows: string[] = [];
  for (let i = 0; i < maxPlayers; i++) {
    const cells = rosters
      .map((r) => {
        const p = r.players[i];
        if (!p) return "      <td></td>";
        const display = `${escapeHtml(p.name)} ${escapeHtml(p.team)} ${escapeHtml(p.position)}`;
        return `      <td>${display}</td>`;
      })
      .join("\n");
    dataRows.push(`    <tr>\n      <td>${i + 1}</td>\n${cells}\n    </tr>`);
  }

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
    tr:nth-child(even) { background: #f0f4f8; }
    td:first-child {
      text-align: center;
      font-weight: bold;
      color: #888;
      width: 30px;
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(snapshot.leagueName)}</h1>
  <h2>${escapeHtml(snapshot.season)} ${escapeHtml(typeLabel)}</h2>
${navHtml}
  <div class="meta">Captured ${escapeHtml(snapshot.capturedAt)}</div>
  <table>
    <tr>
      <th>#</th>
${headerCells}
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
