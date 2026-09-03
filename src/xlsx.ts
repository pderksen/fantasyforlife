import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Snapshot, SnapshotPlayer, TierConfig, ResolvedTradedPick } from "./types.js";
import { snapshotLabel } from "./types.js";
import { buildRosterGrid, columnOrderNote, type DraftRoundLookup } from "./roster-grid.js";
import { formatPacificDate, formatPacificTime } from "./html.js";
import { zipSync, type ZipEntry } from "./zip.js";

/**
 * Excel export. Two sheets: the roster grid exactly as the page lays it out, and that
 * page's traded picks.
 *
 * Built by hand rather than with a spreadsheet library, to hold the project's zero
 * runtime dependencies. Only the sliver of SpreadsheetML needed to write one styled
 * workbook is implemented — see `src/zip.ts` for the same bargain on the container.
 */

// ── XML helpers ──

function escXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // Excel rejects the C0 range outright; nothing in a roster should hit this.
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
}

/** 0-based column index → spreadsheet column letters (0 → A, 26 → AA). */
function colName(index: number): string {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/**
 * Style ids, indexes into the `cellXfs` list in `styles.xml` below. The two must be edited
 * together — a cell's `s` attribute is a bare position, so inserting an entry mid-list
 * silently repaints every cell after it.
 */
const STYLE = {
  DEFAULT: 0,
  HEADER: 1,
  CELL: 2,
  QB: 3,
  RB: 4,
  WR: 5,
  TE: 6,
  DEF: 7,
  K: 8,
  KEEPER: 9,
  TIER_1: 10,
  TIER_2: 11,
  TIER_3: 12,
  // 13 was the round column, dropped in Aug 2026. Its `cellXfs` entry stays where it is:
  // reclaiming the slot would renumber everything below it, which is the trap above.
  TP_HEADER: 14,
  TP_CELL: 15,
  TP_MUTED: 16,
  FOOTER: 17,
} as const;

/** Mirrors the `.pos-*` rules in `ROSTER_STYLES`; anything unrecognized falls back to plain. */
const POSITION_STYLE: Record<string, number> = {
  QB: STYLE.QB,
  RB: STYLE.RB,
  WR: STYLE.WR,
  TE: STYLE.TE,
  DEF: STYLE.DEF,
  K: STYLE.K,
};

const TIER_STYLES = [STYLE.TIER_1, STYLE.TIER_2, STYLE.TIER_3];

// ── Cell builders ──

function textCell(ref: string, style: number, text: string): string {
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t>${escXml(text)}</t></is></c>`;
}

function numberCell(ref: string, style: number, value: number): string {
  return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
}

function blankCell(ref: string, style: number): string {
  return `<c r="${ref}" s="${style}"/>`;
}

/** A cell whose value may be text or a number, chosen by the caller. */
type CellValue = { text: string } | { number: number } | { blank: true };

function cell(ref: string, style: number, value: CellValue): string {
  if ("number" in value) return numberCell(ref, style, value.number);
  if ("text" in value) return value.text === "" ? blankCell(ref, style) : textCell(ref, style, value.text);
  return blankCell(ref, style);
}

/** Accumulates rows so cell references stay in step with the row numbers Excel expects. */
class SheetRows {
  private readonly rows: string[] = [];
  private next = 1;

  /** Append a row of (style, value) pairs starting at column A. Returns its 1-based number. */
  add(cells: { style: number; value: CellValue }[]): number {
    const r = this.next++;
    if (cells.length === 0) {
      this.rows.push(`<row r="${r}"/>`);
      return r;
    }
    const xml = cells.map((c, i) => cell(`${colName(i)}${r}`, c.style, c.value)).join("");
    this.rows.push(`<row r="${r}">${xml}</row>`);
    return r;
  }

  get count(): number {
    return this.next - 1;
  }

  toXml(): string {
    return this.rows.join("");
  }
}

// ── Sheet assembly ──

interface SheetSpec {
  name: string;
  cols: string;
  rows: SheetRows;
  /** Merged ranges, e.g. "A2:J2". */
  merges: string[];
  /** Number of leading rows to freeze. */
  freezeRows: number;
  width: number;
}

function sheetXml(spec: SheetSpec): string {
  const lastRef = `${colName(Math.max(spec.width - 1, 0))}${Math.max(spec.rows.count, 1)}`;
  const pane = spec.freezeRows > 0
    ? `<pane ySplit="${spec.freezeRows}" topLeftCell="A${spec.freezeRows + 1}" activePane="bottomLeft" state="frozen"/>`
    : "";
  const merges = spec.merges.length > 0
    ? `<mergeCells count="${spec.merges.length}">${spec.merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${lastRef}"/><sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${spec.cols}<sheetData>${spec.rows.toXml()}</sheetData>${merges}</worksheet>`;
}

/**
 * Sheet tab name: league and season, then what the tab holds.
 *
 * Both tabs carry the prefix because a workbook gets downloaded and its sheets get copied
 * into other books, where a bare "Traded Picks" says nothing about which year it came from.
 * Excel forbids `: \ / ? * [ ]` in tab names and caps them at 31 characters — the longest
 * this produces is "FFL 2026 End-of-Season Rosters" at 30, so the slice is a backstop.
 */
function sheetName(season: string, label: string): string {
  return `FFL ${season} ${label}`.replace(/[:\\/?*[\]]/g, " ").slice(0, 31);
}

function buildRosterSheet(
  snapshot: Snapshot,
  ownerOrder?: string[],
  tiers?: TierConfig,
  draftRounds?: DraftRoundLookup,
): SheetSpec {
  const grid = buildRosterGrid(snapshot, ownerOrder, tiers, draftRounds);
  const { rosters, rows: gridRows } = grid;
  const width = rosters.length;
  const rows = new SheetRows();
  const merges: string[] = [];

  rows.add(rosters.map((r) => ({ style: STYLE.HEADER, value: { text: r.ownerName } as CellValue })));

  for (const row of gridRows) {
    if (row.kind === "tier") {
      // One bar across the table, the way the page draws it. The merge needs a styled cell
      // in every covered column or Excel leaves the tail of the bar unpainted.
      const style = TIER_STYLES[row.tierIndex] ?? TIER_STYLES[TIER_STYLES.length - 1];
      const r = rows.add([
        { style, value: { text: row.label } },
        ...Array.from({ length: width - 1 }, () => ({ style, value: { blank: true } as CellValue })),
      ]);
      merges.push(`A${r}:${colName(width - 1)}${r}`);
    } else {
      rows.add(row.cells.map((p) => ({ style: playerStyle(p), value: playerValue(p) })));
    }
  }

  // No keeper legend here, unlike the page. A stray yellow cell reads as data in a
  // spreadsheet, and the grid is the thing people sort and filter.
  //
  // The column-order note does ship, from the same `columnOrderNote()` the page uses — though
  // the page prints it under the table and this prints it above the timestamp. Once the grid
  // is downloaded it carries no surrounding text, so nothing else would say the columns are
  // in pick order.
  const columnNote = columnOrderNote(snapshot, grid);
  rows.add([]);
  if (columnNote) {
    rows.add([{ style: STYLE.FOOTER, value: { text: columnNote } }]);
  }
  rows.add([{ style: STYLE.FOOTER, value: { text: `Data retrieved ${formatPacificTime(snapshot.capturedAt)}` } }]);

  const cols = `<cols><col min="1" max="${width}" width="26" customWidth="1"/></cols>`;

  const typeLabel = snapshotLabel(snapshot);
  return {
    name: sheetName(snapshot.season, typeLabel),
    cols,
    rows,
    merges,
    freezeRows: 1,
    width,
  };
}

function playerStyle(p: SnapshotPlayer | undefined): number {
  if (!p) return STYLE.CELL;
  // Keeper yellow beats the position tint, matching the source-order win in ROSTER_STYLES.
  if (p.keeper) return STYLE.KEEPER;
  return POSITION_STYLE[p.position] ?? STYLE.CELL;
}

function playerValue(p: SnapshotPlayer | undefined): CellValue {
  return p ? { text: `${p.name} ${p.team} ${p.position}` } : { blank: true };
}

/**
 * Second tab: the picks this page shows, under the same display rules — the roster page and
 * its workbook should never disagree about which drafts are still outstanding.
 */
function buildTradedPicksSheet(season: string, picks: ResolvedTradedPick[]): SheetSpec {
  const rows = new SheetRows();

  if (picks.length === 0) {
    rows.add([{ style: STYLE.TP_HEADER, value: { text: "Traded Picks" } }]);
    rows.add([{ style: STYLE.TP_CELL, value: { text: "None" } }]);
    return {
      name: sheetName(season, "Traded Picks"),
      cols: `<cols><col min="1" max="1" width="16" customWidth="1"/></cols>`,
      rows,
      merges: [],
      freezeRows: 1,
      width: 1,
    };
  }

  // Same rule as the page: a column of placeholders is worse than no column.
  const showTradedOn = picks.some((p) => p.tradedOn);
  const headers = ["Season", "Round", "Original Owner", "Current Owner", ...(showTradedOn ? ["Traded On"] : [])];
  rows.add(headers.map((h) => ({ style: STYLE.TP_HEADER, value: { text: h } as CellValue })));

  for (const p of picks) {
    const cells: { style: number; value: CellValue }[] = [
      { style: STYLE.TP_CELL, value: { text: p.season } },
      { style: STYLE.TP_CELL, value: { number: p.round } },
      { style: STYLE.TP_CELL, value: { text: p.originalOwner } },
      { style: STYLE.TP_CELL, value: { text: p.currentOwner } },
    ];
    if (showTradedOn) {
      cells.push(p.tradedOn
        ? { style: STYLE.TP_CELL, value: { text: formatPacificDate(p.tradedOn) } }
        : { style: STYLE.TP_MUTED, value: { text: "—" } });
    }
    rows.add(cells);
  }

  return {
    name: sheetName(season, "Traded Picks"),
    cols: `<cols><col min="1" max="1" width="10" customWidth="1"/><col min="2" max="2" width="8" customWidth="1"/><col min="3" max="4" width="26" customWidth="1"/><col min="5" max="5" width="16" customWidth="1"/></cols>`,
    rows,
    merges: [],
    freezeRows: 1,
    width: headers.length,
  };
}

// ── Workbook parts ──

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

/**
 * Colors match `ROSTER_STYLES` in `html.ts` — the point of an Excel export over a CSV is
 * that the tints survive, so the two lists have to be changed together.
 *
 * Fill 0 (`none`) and fill 1 (`gray125`) are reserved by the format: Excel misreads the
 * whole table if anything else occupies those slots.
 */
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="5"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FF888888"/><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FF6B7280"/><sz val="10"/><name val="Calibri"/></font><font><color rgb="FF9CA3AF"/><sz val="10"/><name val="Calibri"/></font></fonts><fills count="13"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F2937"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFC0CB"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD0F0D0"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD0E8FF"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFE0B2"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD2B48C"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE0D0F0"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1A6B2A"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF8B6914"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF8B1A1A"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD1D5DB"/></left><right style="thin"><color rgb="FFD1D5DB"/></right><top style="thin"><color rgb="FFD1D5DB"/></top><bottom style="thin"><color rgb="FFD1D5DB"/></bottom><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFE5E7EB"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="18"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/><xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1"/><xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1"/><xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1"/><xf numFmtId="0" fontId="0" fillId="6" borderId="1" xfId="0" applyFill="1" applyBorder="1"/><xf numFmtId="0" fontId="0" fillId="7" borderId="1" xfId="0" applyFill="1" applyBorder="1"/><xf numFmtId="0" fontId="0" fillId="8" borderId="1" xfId="0" applyFill="1" applyBorder="1"/><xf numFmtId="0" fontId="0" fillId="9" borderId="1" xfId="0" applyFill="1" applyBorder="1"/><xf numFmtId="0" fontId="1" fillId="10" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="11" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="12" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf><xf numFmtId="0" fontId="3" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1"/><xf numFmtId="0" fontId="4" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1"/><xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium9" defaultPivotStyle="PivotStyleLight16"/></styleSheet>`;

function workbookXml(sheetNames: string[]): string {
  const sheets = sheetNames
    .map((name, i) => `<sheet name="${escXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets}</sheets></workbook>`;
}

export interface WorkbookInputs {
  ownerOrder?: string[];
  tiers?: TierConfig;
  draftRounds?: DraftRoundLookup;
  /** Already narrowed by the page's display rule, so both show the same picks. */
  tradedPicks?: ResolvedTradedPick[];
}

/** The roster page as a two-sheet .xlsx: the grid, then that page's traded picks. */
export function generateWorkbook(snapshot: Snapshot, inputs: WorkbookInputs = {}): Buffer {
  const rosterSheet = buildRosterSheet(snapshot, inputs.ownerOrder, inputs.tiers, inputs.draftRounds);
  const picksSheet = buildTradedPicksSheet(snapshot.season, inputs.tradedPicks ?? []);

  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", data: CONTENT_TYPES },
    { name: "_rels/.rels", data: ROOT_RELS },
    { name: "xl/workbook.xml", data: workbookXml([rosterSheet.name, picksSheet.name]) },
    { name: "xl/_rels/workbook.xml.rels", data: WORKBOOK_RELS },
    { name: "xl/styles.xml", data: STYLES_XML },
    { name: "xl/worksheets/sheet1.xml", data: sheetXml(rosterSheet) },
    { name: "xl/worksheets/sheet2.xml", data: sheetXml(picksSheet) },
  ];

  return zipSync(entries);
}

export async function writeWorkbook(workbook: Buffer, outputPath: string): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, workbook);
}
