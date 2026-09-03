# Runbook — Fantasy For Life

What to run, when, and what to check afterward. Everything runs from `c:\Dev\fantasyforlife`.

The site is pre-generated HTML committed to `main`. Cloudflare Pages serves `output/` directly,
so **nothing is live until you commit and push**. Running a command locally is only half the job.

---

## The short version

| When | Command | Frequency | Who |
|---|---|---|---|
| Aug, up to draft day (non-throwback years) | `npm run dev -- --snapshot pre-draft` | Daily while keepers trickle in | **Automated** |
| Right after the draft | `npm run dev -- --snapshot-draft <season>` | Once (locked after) | You |
| During the NFL season | `npm run dev -- --snapshot end-of-season` (the In-Season Rosters page), `npm run dev -- --traded-picks`, `npm run dev -- --trades`, then `npm run dev -- --generate <season>` | Weekly, Thursdays; run the workflow by hand to refresh sooner | **Automated** |
| After the championship (Week 17) | Nothing. The first Thursday capture after Sleeper reports `complete` is final: it relabels the page End-of-Season Rosters and seals the file | Once, on its own | **Automated** |
| After the season settles | Type up the season in `league-info.ts` (see [5](#5-write-up-the-season)) | Once | You |
| After anything you ran by hand | `git add -A && git commit && git push` | Every time | You |

Season = the NFL season year, e.g. `2026` for Sep 2026 – Feb 2027.

**Automated** means [`.github/workflows/refresh.yml`](.github/workflows/refresh.yml) already runs
it overnight and pushes the result. See [Automation](#automation-the-github-actions-refresh) below.
The commands stay listed because running one by hand is always valid, and draft day still wants a
manual final capture.

---

## 1. Preseason: keeper capture

**Window:** roughly two weeks before draft day through the morning of the draft.
**Skip entirely in throwback years** (2025, 2030, 2035, ...), which have no keepers.

```
npm run dev -- --snapshot pre-draft
```

Reads `roster.keepers` from the live API, writes `data/<season>/rosters-pre-draft.json`,
refreshes traded picks, regenerates `output/<season>/rosters-pre-draft.html` (plus its `.xlsx`
twin, written by the same run) and the home page.

Why daily: owners lock keepers on their own schedule, sometimes on draft morning. Each run
overwrites the previous capture, and the console names the teams still missing. **The last run
before the draft starts is the one that counts.** This step cannot be redone retroactively; the
draft consumes the keeper selections and the data is gone.

Because of that, the command refuses two writes that would destroy the record, and only those:

| Refusal | Means | What to do |
|---|---|---|
| `reports status "complete", not "pre_draft"` | The draft has already run, so there are no keepers left to read. Nothing is fetched or written. | Nothing. You wanted `--snapshot-draft <season>`. |
| `The saved capture has N keeper(s); this one has M` | The new read came back with fewer keepers than the file on disk. Nothing is written. | Check you're on the right league and re-run. If Sleeper really did clear a keeper, `--force`. |

Everything else writes as normal: a re-run with the same keepers, or with more, is the whole
point of running daily. Append `--force` (anywhere in the command) to override either refusal.

---

## 2. Draft day: annual config first

Do these **before** the draft, by hand. They are the only steps that require a human, and every
later command depends on them being right.

1. **Update `DEFAULT_LEAGUE_ID`** in [src/index.ts:13](src/index.ts#L13). Sleeper mints a new
   league ID every season. Find it with `/user/{user_id}/leagues/nfl/{season}`, grabbing any
   `user_id` from the current league's `/users`. Record it in the League table in
   [CLAUDE.md](CLAUDE.md).
2. **Add the new season to `DRAFT_ORDERS`** in [src/tiers.ts:42](src/tiers.ts#L42). Verify
   against `draft.draft_order` (maps `user_id` → slot) from `/league/{id}/drafts`. This drives
   both the home page draft order list and the column order on the pre-draft page.
3. **Add `TIER_CONFIGS` entries** in [src/tiers.ts:8](src/tiers.ts#L8) for
   `<season>:post-draft` and `<season>:end-of-season` once keeper rules for the year are
   settled. No entry means no tier rows at all, silently. **Both 2026 entries are still
   missing**; `2026:pre-draft` is the only one configured, and it renders its three tier rows
   normally (bucketed by 2025's draft rounds, which is why its labels name the year).

Then, after the draft finishes:

```
npm run dev -- --snapshot-draft <season>
```

Builds the post-draft rosters from draft picks, refreshes traded picks, writes
`output/<season>/rosters-post-draft.html`.

It also lays down the season's immutable draft record on the first run: if
`data/<season>/draft-picks.json` is missing it fetches `/draft/{id}/picks` and saves it, and
if `data/<season>/draft-traded-picks.json` is missing it fetches that too. Both writes skip a
file that already exists, so neither can be clobbered by a re-run. After the draft, confirm
both files landed and commit them.

**The roster snapshot itself locks the same way.** A second run of `--snapshot-draft` (or of
`--snapshot post-draft`) refuses with `Refusing to overwrite .../rosters-post-draft.json` and
writes nothing, because that file is what the end-of-season page and next year's keeper tiers
read draft rounds from. Run it once, after the last draft-day cut and before waivers open. If
the capture was genuinely bad (wrong league id, a roster that had not finished cutting down),
re-run with `--force` before any waiver moves land, and never after.

This one **is** safe to redo later. Draft picks are immutable and always retrievable.

### Open after the 2026 draft: keepers on the post-draft page

Post-draft rosters carry no `keeper: true`, so the yellow highlight and its "Keeper" legend
(`keeperLegend()` in [src/html.ts](src/html.ts), which keys off the data, not the snapshot type)
render on pre-draft pages only. 2025 hid this: it was a throwback year with no keepers at all, so
the page looked correct by accident. 2026 is the first year the gap is visible.

Decide once the draft has run, in this order:

1. **Check `is_keeper` on the fresh picks.** `takeSnapshot()` never sets the flag for post-draft
   ([src/snapshot.ts:119](src/snapshot.ts#L119)), but Sleeper's own draft picks have an
   `is_keeper` field. It is `null` on all 170 of 2025's, which proves nothing in a throwback year.
   If 2026 populates it, `snapshotFromDraft()` can read it straight through:
   `node -e "const p=require('./data/2026/draft-picks.json'); console.log([...new Set(p.map(x=>String(x.is_keeper)))])"`
2. **Otherwise carry the flag over from the pre-draft capture.** Match `data/2026/rosters-pre-draft.json`
   players marked `keeper: true` by name against the post-draft roster. Degrades cleanly: no
   pre-draft file means no flags, which is right for throwback years.

Either way, re-run `--snapshot-draft 2026` afterward and confirm the legend appears.

### Waiver day: the two Tuesday weeks

Waivers run one night a week at 8pm PT, normally Wednesday. Two weeks a year the NFL opens the
week with a Wednesday game, so the run has to move up to Tuesday to stay ahead of kickoff:
**Week 1** and **Week 12** (Thanksgiving week). Sleeper's waiver day is one league-wide value
rather than a per-week schedule, so each one is a change and a change back.

| When | Set the Sleeper waiver day to |
|---|---|
| Before Week 1's run (Sep 8 in 2026) | Tuesday |
| After that run | Wednesday |
| Before Week 12's run (Nov 24 in 2026) | Tuesday |
| After that run | Wednesday |

**Leaving either one set moves every following week off Wednesday**, and nothing will tell you.
No command reads these settings and no page renders them, so the only check is the league's own
settings screen.

Two things to confirm in the same pass, both of which the published rules assume:

- **One run day, not several.** `daily_waivers_days` is a bitmask, and both 2025 and 2026 have
  carried more than one day active. The rules describe a single weekly run.
- **Free agents stay locked during the window.** Try adding a never-rostered player on a Monday
  night. If it goes straight onto your roster instead of queuing as a claim, the league is not
  running the week the rules describe.

The published copy is `waivers-faab` in [src/rules.ts](src/rules.ts), and its date table is
hand-written per season. Update it when the NFL schedule comes out.

---

## 3. In-season: traded picks and trade log refresh

Trades happen all season: players move now, and pick trades apply to next year's draft. Three
commands, and the last one is not optional:

```
npm run dev -- --traded-picks
npm run dev -- --trades
npm run dev -- --generate <season>
```

`--traded-picks` re-fetches, re-dates (sweeping transactions weeks 1–18 across the whole league
lineage), saves `data/<season>/traded-picks.json`, and regenerates **only the home page**. The
roster pages keep their stale tables until `--generate` runs. Weekly during the season is plenty.

`--trades` sweeps the same 18 weeks for *this* league only and saves `data/<season>/trades.json`.
It generates no page: the per-season trade log page was removed in Aug 2026, and the file is now
an archive kept because the data is only readable while the league is live. It defaults to
`DEFAULT_LEAGUE_ID`; pass an explicit league id to backfill an older season, since trades live in
the league that recorded them. A season with no trades yet writes nothing at all.

Capture during the season, not years later: player names resolve against the live database, so
a late backfill still gets names and positions right but has no way to know a player's NFL team
at the time. That is why the log doesn't show one.

---

## 4. In season, and after the championship

```
npm run dev -- --snapshot end-of-season
```

The workflow runs this every Thursday from Week 1. It captures every roster as it stands (IR
slot included), tiered by each player's original draft round, and writes
`output/<season>/rosters-end-of-season.html` under the heading **In-Season Rosters**. Each run
overwrites the last. Run the workflow by hand from the Actions tab (`Run workflow`) whenever the
tiers need refreshing before Thursday.

Tiers follow the player, not the roster: a drafted player keeps his round's tier whether he is
traded or dropped and re-added, a keeper keeps the tier his climb put him in (stamped off the
post-draft record), and a never-drafted pickup is Tier 3. That is the rules page's own wording,
and it is why the post-draft snapshot is locked (step 2): it is the record this page tiers from.

The capture that finds the league `complete` is the last one. It writes `final: true` into the
file, the same page and workbook relabel themselves **End-of-Season Rosters** (the hub pill and
the home page's hero card follow), the "Updated weekly" note drops off, and every later run
refuses with `Refusing to overwrite .../rosters-end-of-season.json` and writes nothing. The
workflow expects that refusal from the first January run after the championship onward and flags
it in the run summary. Nothing to type in January; confirm the file carries `final` and the hub
pill reads End-of-Season. `--force` is the only way past the seal, for a final capture that was
genuinely wrong.

---

## 5. Write up the season

Nothing in the CLI writes any of this. It is all hand-maintained in
[`src/league-info.ts`](src/league-info.ts), and a season nobody types up leaves the site a year
stale without erroring anywhere, so it belongs on the checklist rather than in someone's memory.

| What | Add |
|---|---|
| `LEAGUE_HISTORY` | The season's champion, runner-up, toilet bowl, and Total Points team |
| `SEASON_HONORS` | That year's honor cards (rendered on both the home page and League History) |
| `STAT_ERAS` | Any scoring record the season broke, in the **current era's** block |
| `PRIZE_SEASONS` | Final payouts, and flip the season's state to `final` |

Two of these are easy to get wrong:

**A champion is named twice**, once in `LEAGUE_HISTORY` and once in `SEASON_HONORS`, and nothing
reconciles them. Change both together.

**`STAT_ERAS` needs the season checked against every row its era already carries**, not just the
records that obviously moved. Sleeper's `/league/{id}/matchups/{week}` carries everything needed
for weeks 1-17: `points` per roster per week, `matchup_id` to pair them, `starters` and
`players_points` for the single-player and bench figures. Pre-2025 seasons are on MyFantasyLeague
instead, whose export API answers the same questions (`TYPE=weeklyResults`), with two traps worth
knowing: it rate-limits hard enough to silently drop weeks, so verify coverage before trusting a
maximum, and 2006-2014 the league is the two-conference Keeper Alliance Network, so results must
be filtered to the F.F.L. conference. Ignore D.F.L. entirely.

Add a new era to `STAT_ERAS` only when a **scoring rule** changes, not every year. The eras exist
because the numbers stop being comparable, which is what PPR did in 2020 and Superflex in 2025.

---

## 6. Deploy (every time)

```
git add -A
git commit -m "Update <season> <what changed>"
git push
```

Cloudflare Pages picks it up from `main` automatically. There is no build step on their side.
Both `data/` and `output/` are committed on purpose; only `dist/` and `node_modules/` are ignored.

---

## Verifying a run worked

- **Console output** names every file written: `Snapshot saved:`, `Traded picks saved:`,
  `Trades saved:`, `HTML written:`, `Excel written:`, `Index written:`.
- **`git diff`** should show the files you expect to have changed. An empty diff after a snapshot
  run means the capture was identical, which is normal for a re-run, and suspicious after a real
  change. `git status` agrees with it now that `.gitattributes` pins LF; until Aug 2026 it flagged
  every regenerated file over line endings.
- **`git diff -- output/`** shows exactly what visitors will see differently.
- **Page footer** carries a "Data retrieved" timestamp in Pacific time. If it didn't move, the
  page wasn't regenerated.

---

## Gotchas

- **Never run bare `npm run dev` unattended.** It opens the home page in your OS default
  browser. Fine when you're sitting there, wrong in a scheduled task. Use
  `npm run dev -- --generate <season>` to regenerate without opening anything.
- **`--traded-picks` doesn't touch roster pages.** Always pair it with `--generate <season>`.
- **`--snapshot <type>` regenerates only that one page**, plus the home page.
- **Traded picks and the trade log seal.** Once `data/<newer season>/` exists, the older
  season's `traded-picks.json` and `trades.json` stop being rewritten and the command prints
  `... are sealed (a newer season has data) — left unchanged.` That's correct behavior, not a
  failure: re-fetching would re-resolve owner names against current team names and quietly
  rewrite history.
- **`--trades` writes no HTML.** It only refreshes `data/<season>/trades.json`. A season with no
  trades yet writes nothing at all; nothing is wrong, there just haven't been any trades.
- **Pre-draft is the only unrecoverable capture.** Post-draft and traded picks can be rebuilt
  from the API later; keepers cannot. The guard in step 1 is the backstop; `--force` is the
  only way past it, so never put `--force` in a scheduled prompt.
- **Every command auto-regenerates `output/index.html`**, so the home page never drifts.
- **Roster pages ship with an Excel twin.** Anything that writes `output/<season>/rosters-<type>.html`
  writes `rosters-<type>-<season>-ffl.xlsx` beside it in the same call, and the page's Excel pill
  links it (the export names the season and league because it gets downloaded away from its
  folder). If a download 404s, the page was committed without its workbook — re-run
  `--generate <season>`. **Renaming the export orphans the old files**: the generator writes the
  new name and leaves the old one committed beside it, so `git rm` the strays by hand.
- **The workbook is written by hand** (`src/zip.ts` + `src/xlsx.ts`), so a change to its styles or
  sheet XML can produce a file Excel refuses to open. Structural checks — `unzip -t` on the file,
  a PowerShell `[xml]` cast over each entry — catch malformed parts, but only opening it in Excel
  proves it. Do that before committing such a change. Regenerating alone is not a test: the bytes
  are deterministic, so a broken workbook regenerates broken every time, quietly.
- **Node 24 LTS** is the supported runtime (`engines: >=24`); native `fetch` needs no HTTP
  library. `npm run dev` runs `tsc` first, so a TypeScript error blocks the run before any
  network call.
- **A fresh league returns picks but zero transactions.** If every `tradedOn` suddenly vanishes,
  the lineage walk (`previous_league_id`) is broken, not the API.

---

## Automation: the GitHub Actions refresh

[`.github/workflows/refresh.yml`](.github/workflows/refresh.yml) does steps 3 and 5 on a
schedule, and takes a run at step 1 while the keeper window is open. GitHub lends a throwaway
Ubuntu VM with the repo checked out, runs the CLI on Node 24, commits `data/` and `output/`,
and pushes to `main`. Cloudflare Pages deploys that push like any other, so **a green run means
the site is already live** — no local step, no machine of yours involved.

It costs nothing. Actions minutes are unlimited on public repos, and there are no secrets to
manage: Sleeper needs no auth, and `GITHUB_TOKEN` is minted per run.

### What it runs

Every run: `--traded-picks`, `--trades`, `--generate <newest data season>`, then commit and push
if anything changed. In August it first attempts `--snapshot pre-draft`.

The season argument is derived from the newest four-digit directory under `data/`, so it needs
no annual edit. `--traded-picks` and `--trades` take the league from `DEFAULT_LEAGUE_ID`, which
does (see step 2).

### The two schedules

Both crons are UTC. `17 11` lands at 4:17am PDT in summer and 3:17am PST in winter, overnight
Pacific year-round; the odd minute dodges the top-of-hour queue on GitHub's schedulers.

| Cron | When | Why |
|---|---|---|
| `17 11 * 8 *` | Daily, all August | Keeper watch. `--snapshot pre-draft` also refreshes picks and trades, so this covers everything. |
| `17 11 * 9-12,1 4` | Thursdays, Sep–Jan | In-season pick and trade refresh. |

**The draft-day handover is automatic.** The daily cron stops firing on Sep 1 by month, and any
August run after the draft hits the guard, which refuses and exits without writing. Nothing to
remember to switch off. That was the one way schedule A could previously do damage.

`--force` appears nowhere in the workflow and must not be added. It exists to override the guard
that protects the keeper record.

### Why the trade refresh is repeated outside `--snapshot`

`--snapshot pre-draft` refreshes traded picks and trades internally, but only *after*
`saveSnapshot()`. When the keeper guard throws, those never run. Since August is also when
trades are heaviest, the workflow marks the snapshot step `continue-on-error` and then runs
`--traded-picks` and `--trades` as their own steps, so a refused capture costs you the keeper
read and nothing else.

A refusal leaves the run green, because the rest of the refresh did succeed. The workflow writes
a warning into the run summary so it is visible without opening the logs.

### Watching and being told

- **Live**: `github.com/pderksen/fantasyforlife` → **Actions** tab → the running entry → click the
  `refresh` job. Logs stream as they happen. The GitHub mobile app shows the same.
- **After the fact**: the run's summary page carries what changed, or "No changes".
- **Manual run**: Actions → **Refresh Sleeper data** → **Run workflow**. It has a `pre_draft`
  checkbox for forcing a keeper attempt outside August.
- **Notifications**: github.com → Settings → Notifications → **Actions**. Pick email and/or
  web+mobile, and either failures only (the default) or every run. GitHub sends scheduled-workflow
  failure mail to whoever last committed to the cron, which is you.

### Known quirks

- **Expect a commit on every run, even a quiet one.** `capturedAt` and `fetchedAt` are rewritten
  each time, which moves the "Data retrieved" footer, so the diff is never empty in practice. That
  is the freshness signal working: the page truthfully says it was checked today. The workflow's
  "No changes" path is therefore mostly reserved for runs where the keeper step is skipped and
  nothing was traded. If the commit noise ever outweighs the signal, the fix is to compare diffs
  ignoring those two fields, not to stop stamping them.
- **Fires are queued, not exact.** A few minutes late is normal, more at busy times. Irrelevant here.
- **No catch-up.** A fire missed during a GitHub outage is skipped, not replayed. The next run
  self-heals, since every command re-fetches complete state.
- **60-day auto-disable.** GitHub switches off schedules in a repo with no activity for 60 days.
  In season the workflow's own pushes keep it alive; over the Feb–Jul dead months it will be
  disabled, and GitHub emails first. Re-enable it in the Actions tab each August (see step 2).

### What stays manual

The annual config edits in step 2 and `--snapshot-draft` on draft night (it needs the draft to
have actually finished). Both are judgment calls, and both are worth eyeballing before they ship.
The end-of-season record was a January hand-run until Sep 2026 and is now the last in-season
capture (step 4), sealed on its own.

---

## Yearly calendar at a glance

| Month | Action |
|---|---|
| Early Aug | Update `DEFAULT_LEAGUE_ID`, `DRAFT_ORDERS`, `TIER_CONFIGS`. Re-enable the workflow in the Actions tab if the dead season disabled it. |
| Mid–late Aug | Automated daily. Nothing to do (skip in throwback years: turn the workflow off, or let the keeper-less capture be overwritten). |
| Draft day (late Aug) | Run `--snapshot pre-draft` by hand right before the draft starts, then `--snapshot-draft <season>` after it ends. Commit and push both. In 2026, also settle the post-draft keeper flag (step 2). |
| Week 1 (early Sep) and Week 12 (Thanksgiving) | Move the Sleeper waiver day to Tuesday for that week, then back to Wednesday after the run. See [step 2](#2-draft-day-annual-config-first). |
| Sep–Dec | Automated weekly on Thursdays: rosters (the In-Season page), traded picks, trades. Run the workflow by hand whenever the tiers need refreshing sooner. |
| Early Jan | Nothing to run: the first Thursday after the championship seals the end-of-season record on its own. Check `data/<season>/rosters-end-of-season.json` carries `final: true` and the hub pill reads End-of-Season. |
| Early Jan, once results settle | Type the season into `LEAGUE_HISTORY`, `SEASON_HONORS`, `STAT_ERAS` and `PRIZE_SEASONS`. Nothing writes these for you. |
| Feb–Jul | Nothing to run. Expect GitHub to disable the schedule. |
