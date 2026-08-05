# Improvement Report — Fantasy For Life

Audit of the codebase, UI, tech stack, and deployment setup. Produced 2026-08-04 against the
current `main` branch. Versions in the stack table were verified against npm and the local
machine on that date. Revised 2026-08-04 after a Sleeper API review added #1, #5, #12, and #16.

**Revised 2026-08-04 (later same day)** after Tailwind was upgraded and every remaining item
was re-checked against the working tree. Item numbers are stable; status lines were added.
Two items closed (#1 fixed, #5 expired), one partly done (#6), two changed shape (#3, #4), and
#9 gained a hard prerequisite that was found by actually running the upgrade rather than
reasoning about it.

**Overall verdict:** unchanged. The architecture is right for what this is (a 10-reader
archival site regenerated ~3x a year). Pre-generated HTML committed to `main` with Cloudflare
Pages serving `output/` is the correct setup: keep it. What remains is three draft-day fixes,
one mechanical tooling batch, and a set of small improvements.

---

## Tech stack status (re-verified 2026-08-04)

| Component | Project | Current | Status |
|---|---|---|---|
| Node (installed) | v24.13.0 | 24 is Active LTS until Oct 2026 | ✅ Current |
| Tailwind | v4 browser CDN, `@4` range | 4.3.3 | ✅ **Done** (commit `9b24f01`) |
| TypeScript | ^5.9.3 | 7.0.2 | ⚠️ Two majors behind; see #9 for the prerequisite |
| @types/node | ^25.2.1 | 26.1.2 published, but **^24 is what this project wants** | ⚠️ Wrong major; see #10 |
| `tsconfig` module | `Node16` | `nodenext` | ⚠️ Works, but legacy-ish |
| Cloudflare Pages | commit-and-serve | Workers static assets is the steered path for new projects | ✅ Fine as-is |

**Note on the `@types/node` row:** "Current 26.1.2" is the published latest, not the target.
Node 26 released April 2026 and does not become LTS until October 2026. Since the runtime here
is Node 24 LTS, the correct move is **down to `^24`**, not up to 26. See #10.

The architecture-level choices (zero runtime deps, native `fetch`, plain `tsc`, static HTML)
are essentially timeless. Do not add a framework, bundler, or test harness.

The Sleeper API itself is unchanged: all seven endpoints the project uses return 200, response
shapes still match `src/types.ts`, and there are no deprecation notices. The gaps are on our
side, below.

### Status changes since the original audit

| Item | Outcome |
|---|---|
| #1 `DEFAULT_LEAGUE_ID` | ✅ **Closed.** Now the 2026 league (`src/index.ts:13`). |
| #5 2025 traded-picks backfill | ⛔ **Closed, expired.** `data/2026/` now exists, so the file is sealed. No loss; skipping was the standing recommendation. |
| #6 Tailwind CDN | 🟡 **Partly done.** v4 upgrade landed, so the deprecation is resolved. Inlining the CSS is still open, now as archival durability rather than stack currency. |
| #3 2026 season prep | 🟡 **Mostly done.** Pre-draft ran in production against the right league; `2026:post-draft` tier config still missing. |
| #4 Overwrite guard | 🔄 **Risk reshaped.** Snapshot is now committed, so git backstops it, but a deliberate re-capture is expected before the draft. |
| #9 TypeScript 7 | 🔄 **Prerequisite found.** Fails without `"types": ["node"]`; verified safe with it. |

---

## Recommendations, ranked most to least important

### 1. ✅ DONE — `DEFAULT_LEAGUE_ID` points at the completed 2025 league

**Type:** Functional (bug) · **Status: fixed** · Effort: trivial

Sleeper mints a **new league ID every season**. `DEFAULT_LEAGUE_ID` in `src/index.ts` was
`1220634180434526208`, which the API reports as `season: 2025, status: complete`. The live
league is `1331127568820109312` (draft `1331127568832667648`, scheduled Aug 29, 2026 at
10:00 AM PT), with `previous_league_id` chaining back to 2025.

**Resolved:** `src/index.ts:13` now reads `const DEFAULT_LEAGUE_ID = "1331127568820109312";  // 2026`.
Confirmed downstream: the 2026 pre-draft snapshot on disk carries
`leagueId: "1331127568820109312"`, so the capture went to the right league.

This recurs every season, so the Season Checklist in CLAUDE.md carries it as step 0.

### 2. `--snapshot-draft` never saves `draft-picks.json` when fetching from the API

**Type:** Functional (bug) · **Time-sensitive: fix before draft day** · Effort: small

**Status: still open. Re-confirmed 2026-08-04.** This is now the highest-priority open item.

In `draftSnapshotAndGenerate()` (`src/index.ts:157`), when the local file
doesn't exist it fetches picks from the API but never writes them to disk. CLAUDE.md says
draft picks are "saved as draft-picks.json," but the code only reads that file; it never
creates it (the 2025 file was written by an older version or by hand). Nothing writes
`draft-traded-picks.json` either. On draft day 2026 this would leave no immutable draft
record, which the whole data model is built around.

**Fix:** After fetching from the API, write `draftPicks` to `getDraftPicksPath(season)`
before proceeding. Decide whether `draft-traded-picks.json` should also be captured here.

Mitigating factor: draft picks stay available from the API indefinitely, so a missed write is
recoverable later. Unlike #1, this is not a one-shot capture.

### 3. 2026 season prep: mostly landed, two gaps left

**Type:** Functional · **Time-sensitive: before draft day** · Effort: small

**Status: substantially done.** The two riskiest parts of this item are resolved:

- ✅ The pre-draft snapshot flow **has now run in production**, against the correct league.
  `data/2026/rosters-pre-draft.json` was captured 2026-08-04, holds all 10 rosters, and is
  committed (`7f01617`). This was the one capture that could not be recreated, and it exists.
- ✅ `TIER_CONFIGS` has a `"2026:pre-draft"` entry with labels that name the year explicitly,
  since pre-draft rounds are 2025's carryover.

Two gaps remain:

- ⚠️ **No `"2026:post-draft"` tier config.** `TIER_CONFIGS` currently holds only
  `2025:post-draft`, `2025:end-of-season`, and `2026:pre-draft`. Draft day needs the
  post-draft entry, or the page renders with no tier rows. This is the live piece of #3.
- ⚠️ **Keeper selection is still in progress**, so the snapshot on disk is a partial picture.
  As of 2026-08-04 only 1 of 10 teams (Vancouver Moose Drool, 3 keepers) has any keeper set;
  the other 9 are at zero. Expect to **re-capture pre-draft closer to Aug 29** once selections
  are in. That intent interacts with #4: the guard there should permit a deliberate re-capture,
  not just block writes.

Gotcha still worth carrying: in the sequential layout (`buildSequentialRows()` in
`src/html.ts`), `beforeRound` means *row index*, not draft round. A tier config written with
round semantics will render wrong.

### 4. Overwrite guard for the pre-draft snapshot

**Type:** Functional (data safety) · Effort: small

**Status: still open, and the risk shape changed.** `saveSnapshot()` (`src/snapshot.ts:357`)
warns but overwrites anyway.

What changed: the 2026 pre-draft snapshot now exists *and is committed* (`7f01617`), so git is
a real backstop rather than a hypothetical one. That lowers the severity from "could lose the
irreplaceable capture" to "could lose uncommitted work."

But per #3, keeper selection is incomplete, so a **deliberate** re-capture before Aug 29 is
expected. Design for that: the guard should refuse an accidental overwrite while allowing an
intentional one.

**Fix:** Refuse to overwrite an existing pre-draft snapshot unless a `--force` flag is passed.
`saveTradedPicks()` does something similar (returns `undefined` rather than rewriting a
sealed season) and can serve as the reference pattern.

### 5. ⛔ WINDOW CLOSED — re-fetch the 2025 traded picks

**Type:** Data hygiene · **Status: expired, no action possible or needed** · Effort: n/a

`data/2025/traded-picks.json` predates the unfiltered-storage change, so its resolved `picks`
array holds only the five future-season picks rather than all ten the league reports.

`saveTradedPicks()` seals a season once a newer season has a data directory, and there is no
`--force` escape. **`data/2026/` now exists**, so this file is frozen in its current shape.

**No loss.** Skipping was the standing recommendation: nothing visible changes (the `> 2025`
display filter yields the same rows either way), and the file's `raw` field already contains
the complete unfiltered API response, so no data is actually missing. Recorded here only so a
future reader doesn't go hunting for the discrepancy.

### 6. ✅ PARTLY DONE — Tailwind CDN: v4 upgrade landed, inlining did not

**Type:** Functional / structural · **Status: deprecation resolved; archival concern remains** · Effort: medium for what's left

**Done (commit `9b24f01`):** `htmlHead()` now loads
`https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4` instead of the v3-era
`cdn.tailwindcss.com`. The `@4` range auto-tracks the latest 4.x with no repo change. Theme
config moved from `tailwind.config` (which v4 ignores) to an `@theme` block in a
`<style type="text/tailwindcss">` tag.

Verified before shipping: of the 112 unique classes the generator emits, 111 resolve under
Tailwind 4.3.3, and the one that does not (`keeper`) is project CSS rather than a Tailwind
utility. No markup changes were needed, because the class set uses none of the renamed or
removed v4 utilities and every `border-*` already carries an explicit color, so the new
`currentColor` border default never applies. The payload also shrank, 126 KB over the wire on
v3 versus 71 KB on v4.

**Still open, at reduced scope:** it is still a CDN that compiles in the browser. The original
archival argument stands undiminished, because it never depended on the version: the 2025
pages should still render in 2035, and today they break the day that CDN URL dies. There is
also still a brief unstyled flash on load.

**Remaining fix (unchanged):** run Tailwind CLI at generation time (devDependency only; runtime
stays zero-dep) and inline the ~13 KB compiled CSS into each page. That number is measured, not
estimated: compiling the real `output/` class set with Tailwind 4.3.3 produces 13,458 bytes.
Inlining also makes each file genuinely self-contained, which CLAUDE.md already claims as a
design goal.

**Priority note:** with the deprecation gone, this is no longer a stack-currency issue. It is
purely an archival-durability choice, so it can wait indefinitely without the stack drifting.

### 7. The sticky header row doesn't actually work

**Type:** UI / Visual · Effort: small

The `TH` constant in `src/html.ts` includes `sticky top-0`, but the roster table sits inside
an `overflow-x-auto` wrapper, which becomes the sticky containing scroll box. Since that
wrapper never scrolls vertically, the header never sticks when scrolling the page. On the
end-of-season page (~20 rows × 10 columns) you lose track of which column is which owner.

**Fix:** Give the wrapper a viewport-height `max-height` with `overflow-y: auto` so
stickiness works inside it, or drop the dead classes.

### 8. Favicon + Open Graph tags

**Type:** UI / Visual · Effort: small

No favicon and no `og:title`/`og:description` meta in `htmlHead()`. League links get pasted
into group chats, and previews are currently bare. Ten minutes of work for a
disproportionate polish win.

**Related decision:** Add `noindex` if you'd rather the league's rosters not be Googleable;
it's a public URL today.

### 9. Bump TypeScript to 7.x — requires one tsconfig line, verified

**Type:** Stack / tooling · Effort: small · **Trial-run 2026-08-04**

Project is on 5.9.3; latest is 7.0.2 (the native-compiler line, much faster `tsc`, which is
paid on every `npm run dev` since dev recompiles each run).

**Correction to the original assessment.** "Migration risk is near zero, worst case a tsconfig
flag complaint" understated it. TypeScript 7 **fails outright on this project as configured**:
22 errors, every `node:` import and every `process` reference unresolved with
`error TS2591: Cannot find name ...`.

**Cause:** TS 7 no longer auto-discovers `@types/node` from `node_modules/@types`. It must be
declared. This was isolated in a clean two-line minimal repro, and reproduced identically
against `@types/node` at 24, 25, and 26, so it is a TS 7 behavior change and not a version
pairing problem. TypeScript 5.9.3 compiles the same file with no errors.

**The whole migration is this one line:**

```jsonc
"types": ["node"]
```

**Verified results with that line in place** (full project source, TS 7.0.2, `nodenext`,
`ES2024`, `@types/node@24`):

- 0 errors
- Emitted JS is **byte-identical** to TypeScript 5.9.3's output (full `dist/` diff, sourcemaps
  excluded)
- 1.5s versus 2.4s compile, so roughly 0.9s off every `npm run dev`

Without that line the upgrade looks broken on first attempt. With it, it is genuinely safe.

### 10. Version hygiene: `@types/node` and `engines`

**Type:** Stack / tooling · Effort: trivial

- Pin `@types/node` to `^24` to match the runtime actually in use (types for Node 25 can
  claim APIs Node 24 lacks). Currently `^25.2.1`, installed 25.2.1.
- **This is a downgrade, not an upgrade.** `npm outdated` reports 26.1.2 as latest and will
  keep nagging; ignore it. Node 26 released April 2026 and does not reach LTS until October
  2026, while this project runs Node 24 LTS. Revisit in Oct 2026.
- Add `"engines": { "node": ">=24" }` to `package.json` so the floor is documented.

### 11. tsconfig modernization

**Type:** Stack / tooling · Effort: trivial

While in there: `module`/`moduleResolution` → `"nodenext"` (forward-compatible successor to
`Node16`), `target` → `ES2024` (Node 24 supports it), drop `forceConsistentCasingInFileNames`
(default-on since TS 5.0). Add `"types": ["node"]`, which #9 requires.

**Verified 2026-08-04:** this exact config compiles clean on *both* TypeScript 5.9.3 and 7.0.2,
and both emit byte-identical JS. So the tsconfig change is safe to land independently of #9,
in either order.

Resulting `compilerOptions` delta:

```jsonc
"target": "ES2024",              // was ES2022
"module": "nodenext",            // was Node16
"moduleResolution": "nodenext",  // was Node16
"types": ["node"],               // NEW, required by TS 7
// remove: "forceConsistentCasingInFileNames": true
```

### 12. `is_owner` is typed non-nullable but the API returns `null`

**Type:** Types (trivial) · Effort: trivial

`src/types.ts:35` declares `is_owner: boolean` on `LeagueUser`; the live endpoint returns
`null` for some users. Nothing reads the field, so this is latent rather than broken. Fold it
into the mechanical pass alongside #10 and #11.

### 13. `generateFromExisting` swallows real errors

**Type:** Functional (minor) · Effort: small

The bare `catch` in `generateFromExisting()` (`src/index.ts:197`) treats *any* failure
(corrupt JSON from a manual edit, write permission error) as "no snapshot found." With
hand-edited JSON being a supported workflow, a parse error hiding as a silent skip will bite
eventually.

**Fix:** Use `existsSync` for the skip case and let genuine errors propagate.

### 14. Self-host or drop the Google Fonts dependency

**Type:** UI / structural (minor) · Effort: small

Same archival argument as #6 but lower stakes, since a dead font CDN degrades gracefully to
fallbacks. Either subset and inline Inter as a data-URI woff2, or use a system font stack
(`system-ui`), which at table-of-names density is visually near-identical.

### 15. CLAUDE.md stale line: "Node 18+"

**Type:** Docs · Effort: trivial

`CLAUDE.md:8` reads "Native `fetch` (Node 18+, no HTTP library)", which lands as a support
statement, but Node 18 went EOL in April 2025. Once #10 lands, that line should say Node 24 LTS.

The Tailwind lines in that same Tech Stack block were already updated alongside the v4 upgrade,
and now record that v4 has no JS config so a future session doesn't reintroduce
`tailwind.config` and quietly break the font.

### 16. Optional feature: trade log from the transactions endpoint

**Type:** Feature · Effort: medium

`/league/{id}/traded_picks` carries no timestamp (only `round`, `season`, `roster_id`,
`owner_id`, `previous_owner_id`), so the site can show *what* was traded but never *when*.
`/league/{id}/transactions/{week}` does carry dates and includes pick trades: all five 2026
picks were traded between Oct 2 and Nov 13, 2025.

This is a **backward-looking history** view, distinct from the forward-looking "who owns
upcoming picks" table the site has now. Neither replaces the other. Costs 18 calls per season
(one per week) versus the current 1, and would add a new per-season file that becomes
immutable once the season ends.

Build only if reading the trade history is something you actually want.

### 17. Cloudflare: no action, one awareness note

**Type:** Stack (informational) · Effort: none

Cloudflare steers new projects toward Workers with static assets and has slowed Pages feature
work, but existing Pages sites are fully supported. Migrating would buy nothing; revisit only
if Pages ever gets a formal sunset date.

---

## Explicitly not recommended

- **Changing the deploy workflow.** Generate locally → commit `output/` → push → auto-deploy
  is ideal here.
- **CI / build pipeline.** Generation needs API timing plus a human anyway.
- **Formal tests, ESLint, Prettier.** At this scale the committed `output/` acts as a
  golden-file diff: run `--generate`, and `git diff` shows exactly what changed.
- **Frameworks or bundlers.** Zero runtime dependencies is a feature; keep it.
- **Filtering traded picks at save time.** Removed deliberately; storage stays unfiltered and
  pages narrow at render. Re-introducing a save-time filter is what caused the index table to
  blank on draft day.

---

## Suggested batching

| Batch | Items | When |
|---|---|---|
| **Draft-day blockers** | #2, #3 (post-draft tier config), #4 | **Before Aug 29, 2026. 25 days out as of this revision.** |
| Pre-draft re-capture | #3 (keepers) | Once keeper selection completes; needs #4 to allow a deliberate overwrite |
| Quick mechanical pass | #9, #10, #11, #12, #15 (tooling) + #7, #8, #13 | Any time; one sitting. Do #11 with #9, it is the prerequisite. |
| CSS inlining | #6 remainder (then #14 alongside) | Any time; archival durability only, no longer stack-currency |
| Optional feature | #16 | Only if you want trade history |
| Closed | #1, #5 | ✅ done / ⛔ expired |
| No action | #17 | Awareness only |

**Recommended order:** the draft-day batch first. It has a real deadline; the tooling batch has
none. #2 and #4 are both small and independent of each other.

After the mechanical pass lands, the stack table has nothing outstanding: Node, Tailwind,
TypeScript, `@types/node`, tsconfig, and Cloudflare would all be current or deliberate.
