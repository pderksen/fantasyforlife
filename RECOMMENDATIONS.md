# Improvement Report — Fantasy For Life

Audit of the codebase, UI, tech stack, and deployment setup. Produced 2026-08-04 against the
current `main` branch. Versions in the stack table were verified against npm and the local
machine on that date. Revised 2026-08-04 after a Sleeper API review added #1, #5, #12, and #16.

**Revised 2026-08-04 (later same day)** after Tailwind was upgraded and every remaining item
was re-checked against the working tree. Item numbers are stable; status lines were added.
Two items closed (#1 fixed, #5 expired), one partly done (#6), two changed shape (#3, #4), and
#9 gained a hard prerequisite that was found by actually running the upgrade rather than
reasoning about it.

**Revised again 2026-08-04 (third pass)** after the TypeScript/tsconfig batch was actually
applied. #9, #10, and #11 are now done and verified in the working tree; #15 is done as a
side effect. The stack table has nothing outstanding.

**Revised again 2026-08-04 (fourth pass)** after #2 was implemented. The draft record now
writes itself on draft day, so the highest-priority open item is closed. Two draft-day items
remain: the `2026:post-draft` tier config (#3) and the pre-draft overwrite guard (#4).

**Overall verdict:** unchanged. The architecture is right for what this is (a 10-reader
archival site regenerated ~3x a year). Pre-generated HTML committed to `main` with Cloudflare
Pages serving `output/` is the correct setup: keep it. What remains is two draft-day fixes,
a handful of small improvements, and one optional feature.

---

## Tech stack status (re-verified 2026-08-04, third pass)

| Component | Project | Current | Status |
|---|---|---|---|
| Node (installed) | v24.13.0, `engines: >=24` | 24 is Active LTS until Oct 2026 | ✅ Current |
| Tailwind | v4 browser CDN, `@4` range | 4.3.3 | ✅ **Done** (commit `9b24f01`) |
| TypeScript | `^7.0.2` | 7.0.2 | ✅ **Done** |
| @types/node | `^24.13.3` | 26.1.2 published, but **^24 is what this project wants** | ✅ **Done** (deliberate major) |
| `tsconfig` module | `nodenext` | `nodenext` | ✅ **Done** |
| Cloudflare Pages | commit-and-serve | Workers static assets is the steered path for new projects | ✅ Fine as-is |

**Note on the `@types/node` row:** "Current 26.1.2" is the published latest, not the target.
Node 26 released April 2026 and does not become LTS until October 2026. Since the runtime here
is Node 24 LTS, `^24` is correct and `npm outdated` will keep flagging it. Ignore that until
Node 26 goes LTS. See #10.

**Range policy:** both devDependencies use carets, so minor and patch releases are picked up by
a plain `npm install` while majors stay a deliberate decision (`^7.0.2` → any 7.x, `^24.13.3` →
any 24.x). The patch-level floor is documentation of the verified minimum, not a tighter pin;
it does not narrow what an upgrade can resolve to. `package-lock.json` is committed, so actual
installs stay reproducible regardless.

The architecture-level choices (zero runtime deps, native `fetch`, plain `tsc`, static HTML)
are essentially timeless. Do not add a framework, bundler, or test harness.

The Sleeper API itself is unchanged: all seven endpoints the project uses return 200, response
shapes still match `src/types.ts`, and there are no deprecation notices. The gaps are on our
side, below.

### Status changes since the original audit

| Item | Outcome |
|---|---|
| #1 `DEFAULT_LEAGUE_ID` | ✅ **Closed.** Now the 2026 league (`src/index.ts:13`). |
| #2 draft record never saved | ✅ **Closed.** `--snapshot-draft` now writes `draft-picks.json` and `draft-traded-picks.json`, and refuses to overwrite either. Verified byte-identical against the committed 2025 capture. |
| #5 2025 traded-picks backfill | ⛔ **Closed, expired.** `data/2026/` now exists, so the file is sealed. No loss; skipping was the standing recommendation. |
| #6 Tailwind CDN | 🟡 **Partly done.** v4 upgrade landed, so the deprecation is resolved. Inlining the CSS is still open, now as archival durability rather than stack currency. |
| #3 2026 season prep | 🟡 **Mostly done.** Pre-draft ran in production against the right league; `2026:post-draft` tier config still missing. |
| #4 Overwrite guard | 🔄 **Risk reshaped.** Snapshot is now committed, so git backstops it, but a deliberate re-capture is expected before the draft. |
| #9 TypeScript 7 | ✅ **Closed.** Landed at `^7.0.2` with `"types": ["node"]`. Emit byte-identical, `output/` diff empty. |
| #10 `@types/node` / `engines` | ✅ **Closed.** `^24.13.3` + `"engines": { "node": ">=24" }`. |
| #11 tsconfig | ✅ **Closed.** `nodenext`, `ES2024`, `types: ["node"]`, `forceConsistentCasingInFileNames` dropped. |
| #15 CLAUDE.md "Node 18+" | ✅ **Closed.** Fixed in CLAUDE.md and RUNBOOK.md as part of the same batch. |

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

### 2. ✅ DONE — `--snapshot-draft` never saved `draft-picks.json` when fetching from the API

**Type:** Functional (bug) · **Status: landed 2026-08-04 (fourth pass)** · Effort: small

`draftSnapshotAndGenerate()` fetched picks from the API when the local file was absent but
never wrote them to disk, and nothing wrote `draft-traded-picks.json` at all. CLAUDE.md said
both were "saved," but the code only read them (the 2025 files came from an older version or
by hand). Draft day 2026 would have left no immutable draft record, which the whole data
model is built around.

**What landed:**

- `saveDraftPicks()` / `saveDraftTradedPicks()` in `src/snapshot.ts`, both on a shared
  `saveDraftCapture()` that **refuses to overwrite an existing file** and returns `undefined`
  instead, following the `saveTradedPicks()` precedent. Draft data can't change once the
  draft runs, so the file on disk is the record and a rewrite could only degrade it.
- `getDraftTradedPicksPath(season)` alongside the existing `getDraftPicksPath()`.
- On the fetch path, picks are saved before anything else runs.
- `draft-traded-picks.json` is captured **whenever it's missing**, not only on the fetch
  path, so a run that loads picks off disk still backfills it. The draft id comes from
  `draftPicks[0].draft_id` in that case.
- The endpoint decision: capture it. It is per-draft, immutable, and unobtainable from
  `/league/{id}/traded_picks` (which reports only the current owner, so in-draft trades are
  invisible there).

**One subtlety worth keeping:** `draft-traded-picks.json` is stored as the **raw response
text**, not re-serialized JSON. Sleeper returns `draft_id` there as a bare integer past 2^53,
so `JSON.parse` → `JSON.stringify` turns `1220634181302767616` into `...767600`. Verified
against the live endpoint. Nothing in the app reads the file, so keeping the original bytes
costs nothing. `draft-picks.json` has no such field (`draft_id` is a string there) and is
written as normal serialized JSON.

Also folded in: the inline `fetch("https://api.sleeper.app/v1/league/.../drafts")` in
`index.ts` became `getLeagueDrafts()` in `sleeper-api.ts` with a `LeagueDraft` type, so the
one endpoint call that bypassed the API layer no longer does. `fetchJson()` was split over a
shared `fetchOk()` so the raw-text fetch reuses the same error handling.

**Verified:** temporarily removed `data/2025/draft-traded-picks.json`, ran
`--snapshot-draft 2025 1220634180434526208`, and the regenerated file came back
**byte-identical to the committed original** — which also confirms the raw-text choice, since
a round trip would not have. Re-save calls return `undefined` and leave contents untouched.
The only other diffs across `data/` and `output/` were the two capture timestamps; everything
was restored with `git checkout`.

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
Two reference patterns now exist: `saveTradedPicks()` (returns `undefined` rather than
rewriting a sealed season) and, from #2, `saveDraftCapture()` (returns `undefined` rather
than touching an existing immutable file). Neither has a `--force` escape, because neither
needs one — this item is the case that does, so the flag is the new part.

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

### 9. ✅ DONE — Bump TypeScript to 7.x

**Type:** Stack / tooling · **Status: landed 2026-08-04** · Effort: small

Project was on 5.9.3; now `^7.0.2` (the native-compiler line, much faster `tsc`, which is
paid on every `npm run dev` since dev recompiles each run).

**Correction to the original assessment.** "Migration risk is near zero, worst case a tsconfig
flag complaint" understated it. TypeScript 7 **fails outright on this project as configured**:
22 errors, every `node:` import and every `process` reference unresolved with
`error TS2591: Cannot find name ...`.

**Cause:** TS 7 no longer auto-discovers `@types/node` from `node_modules/@types`. It must be
declared. This was isolated in a clean two-line minimal repro, and reproduced identically
against `@types/node` at 24, 25, and 26, so it is a TS 7 behavior change and not a version
pairing problem. TypeScript 5.9.3 compiles the same file with no errors.

**The whole migration was this one line:**

```jsonc
"types": ["node"]
```

**Verified results after landing** (full project source, TS 7.0.2, `nodenext`, `ES2024`,
`@types/node@24.13.3`):

- 0 errors on a clean rebuild
- Emitted JS is **byte-identical** to TypeScript 5.9.3's output (per-file SHA-256 across all
  six `dist/*.js`)
- Regenerating both seasons plus the index leaves `git status -- output/` empty, so no visual
  regression
- Clean full build now ~0.7s versus ~2.4s on 5.9.3

Without that line the upgrade looks broken on first attempt (22 errors, every `node:` import
and `process` reference unresolved). The requirement is recorded in CLAUDE.md so it does not
get dropped by a future tsconfig edit.

### 10. ✅ DONE — Version hygiene: `@types/node` and `engines`

**Type:** Stack / tooling · **Status: landed 2026-08-04** · Effort: trivial

- `@types/node` moved from `^25.2.1` **down** to `^24.13.3`, matching the runtime actually in
  use. `@types/node`'s major tracks the Node major it describes, so types ahead of the runtime
  will happily type-check APIs the running Node lacks — a clean compile, then a runtime throw.
- **Why 24 and not 26.** Node 24 is Active LTS through Oct 2026 (maintenance to April 2028) and
  is what's installed (v24.13.0). Node 26 shipped April 2026 but is still the Current line; it
  becomes LTS in Oct 2026. Node 25, the previous setting here, is an odd-numbered line that
  never goes LTS at all, so it was the worst of the three. `npm outdated` will keep reporting
  26.1.2 as latest — ignore it. **Revisit Oct 2026** and bump runtime, `engines`, and types
  together, not types alone.
- `"engines": { "node": ">=24" }` added to `package.json` so the floor is documented.

### 11. ✅ DONE — tsconfig modernization

**Type:** Stack / tooling · **Status: landed 2026-08-04** · Effort: trivial

`module`/`moduleResolution` → `"nodenext"` (forward-compatible successor to `Node16`),
`target` → `ES2024` (Node 24 supports it), `forceConsistentCasingInFileNames` dropped
(default-on since TS 5.0), `"types": ["node"]` added, which #9 requires.

Applied `compilerOptions` delta:

```jsonc
"target": "ES2024",              // was ES2022
"module": "nodenext",            // was Node16
"moduleResolution": "nodenext",  // was Node16
"types": ["node"],               // NEW, required by TS 7
// removed: "forceConsistentCasingInFileNames": true
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

### 15. ✅ DONE — CLAUDE.md stale line: "Node 18+"

**Type:** Docs · **Status: landed 2026-08-04** · Effort: trivial

`CLAUDE.md:8` read "Native `fetch` (Node 18+, no HTTP library)", which landed as a support
statement, but Node 18 went EOL in April 2025. The Tech Stack block now names TypeScript 7 and
Node 24 LTS, records the `^24` types decision and its Oct 2026 revisit, and carries the
`"types": ["node"]` gotcha. The same line in `RUNBOOK.md:140` was corrected alongside it.

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
| **Draft-day blockers** | #3 (post-draft tier config), #4 | **Before Aug 29, 2026. 25 days out as of this revision.** |
| Pre-draft re-capture | #3 (keepers) | Once keeper selection completes; needs #4 to allow a deliberate overwrite |
| Quick mechanical pass | #12 + #7, #8, #13 | Any time; one sitting. Tooling half (#9, #10, #11, #15) is done. |
| CSS inlining | #6 remainder (then #14 alongside) | Any time; archival durability only, no longer stack-currency |
| Optional feature | #16 | Only if you want trade history |
| Calendar item | #10 revisit | Oct 2026, when Node 26 goes LTS |
| Closed | #1, #2, #9, #10, #11, #15 (✅ done) · #5 (⛔ expired) | — |
| No action | #17 | Awareness only |

**Recommended order:** finish the draft-day batch first. It has a real deadline; nothing else
does. #4 is small and independent; #3's tier config is the piece that can't be backfilled
without regenerating the page after the fact.

**The stack table now has nothing outstanding:** Node, Tailwind, TypeScript, `@types/node`,
tsconfig, and Cloudflare are all current or deliberate, and the caret ranges mean minor/patch
drift is picked up without a repo change. The only scheduled stack work is the Oct 2026
Node 26 LTS revisit.
