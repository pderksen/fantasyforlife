import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Snapshot, SnapshotPlayer, TierConfig } from "./types.js";
import { buildRosterGrid, type DraftRoundLookup } from "./roster-grid.js";

/**
 * Marks a keeper in a CSV cell. The page says it with a yellow highlight, which nothing
 * survives an export, so the flag has to ride along in the text.
 */
const KEEPER_MARK = " *";

/**
 * Excel on Windows reads a .csv as the system codepage unless the file opens with a UTF-8
 * byte order mark, which turns the em dashes in tier labels into mojibake. Sheets and every
 * text editor skip the mark silently, so it costs nothing elsewhere. Spelled as an escape
 * so it stays visible in the source instead of hiding as a zero-width character.
 */
const BOM = "\u{FEFF}";

/** RFC 4180: quote when the value holds a delimiter, a quote, or a newline; double the quotes. */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Same text the page cell carries — "Last, First TEAM POS" — plus the keeper mark. */
function playerText(p: SnapshotPlayer | undefined): string {
  if (!p) return "";
  return `${p.name} ${p.team} ${p.position}${p.keeper ? KEEPER_MARK : ""}`;
}

/**
 * The roster page's table as CSV, built from the same grid the HTML renders, so the export
 * always matches the page beside it.
 *
 * Tier bars have no spreadsheet equivalent (there is no colspan), so each one becomes a row
 * carrying its label in the first column with the rest blank.
 */
export function generateCsv(
  snapshot: Snapshot,
  ownerOrder?: string[],
  tiers?: TierConfig,
  draftRounds?: DraftRoundLookup,
): string {
  const { rosters, hasRoundColumn, rows } = buildRosterGrid(snapshot, ownerOrder, tiers, draftRounds);
  const width = rosters.length + (hasRoundColumn ? 1 : 0);

  const lines: string[][] = [[
    ...(hasRoundColumn ? ["Round"] : []),
    ...rosters.map((r) => r.ownerName),
  ]];

  for (const row of rows) {
    if (row.kind === "tier") {
      lines.push([row.label, ...Array<string>(width - 1).fill("")]);
    } else {
      lines.push([
        ...(hasRoundColumn ? [row.label ?? ""] : []),
        ...row.cells.map(playerText),
      ]);
    }
  }

  return BOM + lines.map((cells) => cells.map(csvCell).join(",")).join("\n") + "\n";
}

export async function writeCsv(csv: string, outputPath: string): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, csv, "utf-8");
}
