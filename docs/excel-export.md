# Excel Export — Format Internals and Verification

Background for `output/<season>/rosters-<type>-<season>-ffl.xlsx`. `CLAUDE.md` carries the
edit traps that will break a workbook if you miss them; this file carries the reasoning, the
layout details, and the procedure for checking a format change.

Written Aug 2026. Read it for reasoning, not as a description of current state.

---

## Why a workbook, and why hand-rolled

**A CSV export shipped first and was replaced (Aug 2026).** Plain text lost the position tints,
the tier bars, and the keeper highlight, which are most of what the table communicates. A
league roster read as bare text is a list of names; read with its colors it's a draft board.
`git show 6187a04` has the CSV if a text export is ever wanted back.

**Hand-rolled OOXML, no dependency.** An `.xlsx` is a zip of XML parts, and Node ships `zlib`,
so `src/zip.ts` writes the container and `src/xlsx.ts` writes the parts rather than pulling in
a spreadsheet library. This holds the project's zero-runtime-dependency line for the sake of
one write-only output.

Both modules are deliberately narrow: no reading, no zip64, no shared-string table (cells use
`t="inlineStr"`). If a future need pushes past any of those, a real library is the better
answer than extending these.

## Mirrors the page, not the snapshot

Both renderers consume `buildRosterGrid()`, so column order, tier placement, keeper-first
sorting, and round labels are decided once. Rendering a workbook straight off the JSON would
have let the two drift apart silently, and the workbook is the one nobody re-reads — a drift
there could sit undetected for a season.

The same reasoning extends to copy: text that both outputs show lives in `roster-grid.ts`, not
in either renderer. `columnOrderNote()` is the example, returning the sentence or `undefined`.

## Sheet layout

**Two sheets**: `FFL <season> <Type> Rosters` (the grid) and `FFL <season> Traded Picks`, named
by `sheetName()` in `xlsx.ts`.

Both tabs carry the league-and-season prefix because sheets get copied out into other
workbooks, where a bare "Traded Picks" names no year. Excel caps a tab at 31 characters and the
longest this produces is "FFL 2026 End-of-Season Rosters" at 30, so a longer league prefix
would start truncating.

- **Grid shape matches the historical Google Sheet**: owners across the header, players down,
  cells reading `Last, First TEAM POS`. Post-draft keeps its leading "Round" column ("4a",
  "4b"). Header row is frozen.
- **Tier bars are merged across the table**, the way the page draws them. Every covered column
  still needs a styled cell or Excel leaves the tail of the bar unpainted.
- **No keeper legend**, unlike the page. A lone yellow swatch cell reads as data in a
  spreadsheet, next to a grid people sort and filter. The keeper tint itself still ships.
- **Footer instead**, after a blank row: the column-order note when `columnOrderNote()` returns
  one, then "Data retrieved", both in the muted `STYLE.FOOTER`. That note ships here even
  though the page states it too — a downloaded grid carries no surrounding page text, so
  nothing else would say the columns run in pick order.
- **The Traded Picks sheet shows what that page shows** — pre-draft gets its own draft's picks,
  the others get what's still outstanding — including the rule that drops the "Traded On"
  column when no pick in the table has a date.

## Why the two filenames differ

**The workbook name carries season and league, the page's carries neither.**

A page is read in place, under a URL that already says which year it is. Its workbook gets
downloaded into a folder alongside every other year's export and every other league's, where a
bare `rosters-pre-draft.xlsx` identifies nothing. Type leads
(`rosters-pre-draft-2026-ffl.xlsx`) so a year's three exports sort together in a downloads
folder.

The two names come from separate helpers in `snapshot.ts`: `pageFileName()` and
`exportFileName()`. The page's download link and `getExportOutputPath()` both route through
`exportFileName()`, so the link can't drift out from under the file.

## Why zip timestamps are fixed at 1980-01-01

`output/` is committed and the repo leans on an empty `git diff` to prove a change was inert. A
real clock in the zip header would make every regeneration a diff, and the verification loop
would stop distinguishing "nothing changed" from "everything changed by one second". Verified:
two runs over unchanged data produce identical bytes.

## Verifying a change to the format

`unzip` is **not on PATH** here. Use .NET from PowerShell for all three jobs:

```powershell
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($path)
```

Read each entry through a `StreamReader` and cast it to `[xml]` — a part that fails the cast is
malformed. Regex the last `<row>` elements out of `xl/worksheets/sheet1.xml` to read footer
rows back without opening Excel.

**None of that proves Excel will open it.** Only opening it does, so do that before committing
a styles or sheet change. Two traps there:

- `Start-Process` uses the OS default handler, which is not necessarily Excel.
- An open workbook drops an untracked lock file into `output/` (`.~lock.<name>#`, or
  `~$<name>` from Excel) that a `git add output/` would sweep in. Close it before staging.
