# Improvement Report — Fantasy For Life

Audit of the codebase, UI, tech stack, and deployment setup. Produced 2026-08-04 against the
current `main` branch. Versions in the stack table were verified against npm and the local
machine on that date. Revised 2026-08-04 after a Sleeper API review added #1, #5, #12, and #16.

**Overall verdict:** The architecture is right for what this is (a 10-reader archival site
regenerated ~3x a year). Pre-generated HTML committed to `main` with Cloudflare Pages serving
`output/` is the correct setup: keep it. The items below are four time-sensitive fixes ahead of
the Aug 29, 2026 draft, one time-boxed data decision, one deprecated dependency, and a set of
small improvements.

---

## Tech stack status (verified 2026-08-04)

| Component | Project | Current | Status |
|---|---|---|---|
| Node (installed) | v24.13.0 | 24 is active LTS | ✅ Current |
| TypeScript | ^5.9.3 | 7.0.2 | ⚠️ Two majors behind |
| @types/node | ^25.2.1 | 26.1.2 | ⚠️ Mismatches runtime (Node 24) |
| Tailwind | Play CDN (v3-era) | v4.x | ❌ Deprecated for production use |
| `tsconfig` module | `Node16` | `nodenext` recommended | ⚠️ Works, but legacy-ish |
| Cloudflare Pages | commit-and-serve | Workers static assets is the steered path for new projects | ✅ Fine as-is |

The architecture-level choices (zero runtime deps, native `fetch`, plain `tsc`, static HTML)
are essentially timeless. Do not add a framework, bundler, or test harness.

The Sleeper API itself is unchanged: all seven endpoints the project uses return 200, response
shapes still match `src/types.ts`, and there are no deprecation notices. The gaps are on our
side, below.

---

## Recommendations, ranked most to least important

### 1. `DEFAULT_LEAGUE_ID` points at the completed 2025 league

**Type:** Functional (bug) · **Time-sensitive: fix before draft day (Aug 29, 2026)** · Effort: trivial

Sleeper mints a **new league ID every season**. `DEFAULT_LEAGUE_ID` in `src/index.ts` is
`1220634180434526208`, which the API now reports as `season: 2025, status: complete`. The live
league is `1331127568820109312` (draft `1331127568832667648`, scheduled Aug 29, 2026 at
10:00 AM PT), with `previous_league_id` chaining back to 2025.

Every command that omits an explicit league ID currently hits the finished 2025 league. Left
unfixed, running `--snapshot pre-draft` on draft day would capture stale 2025 rosters into
`data/2025/`, and the real pre-draft state (the one capture that cannot be recreated) would be
lost.

**Fix:** Update the constant. This is a precondition for #3, and it recurs every season, so the
Season Checklist in CLAUDE.md now carries it as step 0.

### 2. `--snapshot-draft` never saves `draft-picks.json` when fetching from the API

**Type:** Functional (bug) · **Time-sensitive: fix before draft day** · Effort: small

In `draftSnapshotAndGenerate()` (`src/index.ts`, fetch at line 137), when the local file
doesn't exist it fetches picks from the API but never writes them to disk. CLAUDE.md says
draft picks are "saved as draft-picks.json," but the code only reads that file; it never
creates it (the 2025 file was written by an older version or by hand). Nothing writes
`draft-traded-picks.json` either. On draft day 2026 this would leave no immutable draft
record, which the whole data model is built around.

**Fix:** After fetching from the API, write `draftPicks` to `getDraftPicksPath(season)`
before proceeding. Decide whether `draft-traded-picks.json` should also be captured here.

Mitigating factor: draft picks stay available from the API indefinitely, so a missed write is
recoverable later. Unlike #1, this is not a one-shot capture.

### 3. 2026 season prep: tier rules and an untested pre-draft path

**Type:** Functional · **Time-sensitive: before draft day** · Effort: small code, but needs league-rule decisions

- `TIER_CONFIGS` in `src/tiers.ts` has no 2026 entries. Keeper-year tier rules are marked
  TBD in CLAUDE.md; that decision is now due. Live data as of Aug 2026: the 2026 league's
  rosters carry a `keepers` array (one team had 3 set, the rest still `null`) and league
  `settings.draft_rounds` is `3`. Selection appears to be in progress, so confirm the actual
  rule before writing boundaries.
- The pre-draft snapshot flow has **never run in production** (2025 was a throwback year, so
  it was skipped). Dry-run `npm run dev -- --snapshot pre-draft` before draft day; it's the
  one snapshot that cannot be recreated afterward. Do #1 first, or it will snapshot the wrong
  league.
- Gotcha to decide up front: in the sequential layout (`buildSequentialRows()` in
  `src/html.ts`), `beforeRound` means *row index*, not draft round. A `2026:pre-draft` tier
  config written with round semantics will render wrong. Also, pre-draft rosters have no
  round data, so how kept players map to "kept rounds" needs a decision.

### 4. Overwrite guard for the pre-draft snapshot

**Type:** Functional (data safety) · Effort: small

`saveSnapshot()` (`src/snapshot.ts`) warns but overwrites anyway. Accidentally running
`--snapshot pre-draft` *after* the draft would destroy the only irreplaceable snapshot. Git
is the backstop only if the file was committed.

**Fix:** Refuse to overwrite an existing pre-draft snapshot unless a `--force` flag is passed.
`saveTradedPicks()` now does something similar (returns `undefined` rather than rewriting a
sealed season) and can serve as the reference pattern.

### 5. Time-boxed: re-fetch the 2025 traded picks before any 2026 data exists

**Type:** Data hygiene · **Window closes when `data/2026/` is created** · Effort: trivial

`data/2025/traded-picks.json` predates the unfiltered-storage change, so its resolved `picks`
array holds only the five future-season picks rather than all ten the league reports.

The sequencing catch: `saveTradedPicks()` seals a season once a newer season has a data
directory, and there is no `--force` escape. The moment #1 and #3 create `data/2026/`, this
file is frozen in its current shape permanently. Running
`npm run dev -- --traded-picks 1220634180434526208` beforehand would backfill it.

**Recommendation: skip it.** Nothing visible changes (the `> 2025` display filter yields the
same rows either way), and the file's `raw` field already contains the complete unfiltered API
response, so no data is actually missing. Listed only because the window is genuinely one-way.

### 6. Replace the Tailwind Play CDN with compiled, inlined CSS

**Type:** Functional / structural (also the one genuinely outdated stack component) · Effort: medium

`htmlHead()` in `src/html.ts` loads `cdn.tailwindcss.com`: the play/dev CDN, explicitly not
for production, deprecated since Tailwind v4, and it compiles classes in the browser on every
page view (brief unstyled flash, ~100KB of JS, slower on phones). Bigger issue for this site:
it's an archive. The 2025 pages should still render in 2035, and today they break the day
that CDN URL dies.

**Fix:** Since the utility-class surface is small and stable, run Tailwind CLI at generation
time (devDependency only; runtime stays zero-dep) and inline the ~10KB compiled CSS into each
page. That also makes each file genuinely self-contained, which CLAUDE.md already claims as a
design goal.

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

### 9. Bump TypeScript to 7.x

**Type:** Stack / tooling · Effort: small

Project is on 5.9.3; latest is 7.0.2 (the native-compiler line, much faster `tsc`, which is
paid on every `npm run dev` since dev recompiles each run). For six strict-mode files the
migration risk is near zero; worst case is a tsconfig flag complaint. Two majors behind is
the kind of gap that gets harder the longer it sits.

### 10. Version hygiene: `@types/node` and `engines`

**Type:** Stack / tooling · Effort: trivial

- Pin `@types/node` to `^24` to match the runtime actually in use (types for Node 25 can
  claim APIs Node 24 lacks). Revisit when Node 26 becomes LTS (Oct 2026).
- Add `"engines": { "node": ">=24" }` to `package.json` so the floor is documented.

### 11. tsconfig modernization

**Type:** Stack / tooling · Effort: trivial

While in there: `module`/`moduleResolution` → `"nodenext"` (forward-compatible successor to
`Node16`), `target` → `ES2024` (Node 24 supports it), drop `forceConsistentCasingInFileNames`
(default-on since TS 5.0). Near-zero behavior change.

### 12. `is_owner` is typed non-nullable but the API returns `null`

**Type:** Types (trivial) · Effort: trivial

`src/types.ts:33` declares `is_owner: boolean` on `LeagueUser`; the live endpoint returns
`null` for some users. Nothing reads the field, so this is latent rather than broken. Fold it
into the mechanical pass alongside #10 and #11.

### 13. `generateFromExisting` swallows real errors

**Type:** Functional (minor) · Effort: small

The bare `catch` in `generateFromExisting()` (`src/index.ts`, line 176) treats *any* failure
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

"Native `fetch` (Node 18+, no HTTP library)" reads as a support statement, but Node 18 went
EOL in April 2025. Once #10 lands, that line should say Node 24 LTS. (Don't pre-edit the
Tailwind line; update docs when the code actually changes.)

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
| Draft-day blockers | #1, #2, #3, #4 | Before Aug 29, 2026 (#1 first) |
| One-way window | #5 | Before #1/#3 create `data/2026/`; recommended skip |
| Quick mechanical pass | #7, #8, #9, #10, #11, #12, #13, #15 | Any time; one sitting |
| CSS overhaul | #6 (then #14 alongside) | Any time; the only real project |
| Optional feature | #16 | Only if you want trade history |
| No action | #17 | Awareness only |
