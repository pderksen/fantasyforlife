# Runbook — Fantasy For Life

What to run, when, and what to check afterward. Everything runs from `c:\Dev\fantasyforlife`.

The site is pre-generated HTML committed to `main`. Cloudflare Pages serves `output/` directly,
so **nothing is live until you commit and push**. Running a command locally is only half the job.

---

## The short version

| When | Command | Frequency | Who |
|---|---|---|---|
| Aug, up to draft day (non-throwback years) | `npm run dev -- --snapshot pre-draft` | Daily while keepers trickle in | **Automated** |
| Right after the draft | `npm run dev -- --snapshot-draft <season>` | Once | You |
| During the NFL season | `npm run dev -- --traded-picks`, `npm run dev -- --trades`, then `npm run dev -- --generate <season>` | Tue + Fri | **Automated** |
| After NFL Week 18 (~early Jan) | `npm run dev -- --snapshot end-of-season` | Once | You |
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
refreshes traded picks, regenerates `output/<season>/rosters-pre-draft.html` and the home page.

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
   settled. No entry means no tier rows, which is why `2026:pre-draft` renders flat.

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

## 4. After NFL Week 18

```
npm run dev -- --snapshot end-of-season
```

Final rosters, tiered by each player's original draft round. Run it any time after Week 18 ends
and before the next season's league rolls over.

---

## 5. Deploy (every time)

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
  `Trades saved:`, `HTML written:`, `Index written:`.
- **`git status`** should show the files you expect to have changed. An empty diff after a
  snapshot run means the capture was identical, which is normal for a re-run, and suspicious
  after a real change.
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
| `17 11 * 9-12,1 2,5` | Tue + Fri, Sep–Jan | In-season pick and trade refresh. |

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

The annual config edits in step 2, `--snapshot-draft` on draft night (it needs the draft to have
actually finished), and `--snapshot end-of-season` in January. All three are judgment calls, and
all three are worth eyeballing before they ship.

---

## Yearly calendar at a glance

| Month | Action |
|---|---|
| Early Aug | Update `DEFAULT_LEAGUE_ID`, `DRAFT_ORDERS`, `TIER_CONFIGS`. Re-enable the workflow in the Actions tab if the dead season disabled it. |
| Mid–late Aug | Automated daily. Nothing to do (skip in throwback years: turn the workflow off, or let the keeper-less capture be overwritten). |
| Draft day (late Aug) | Run `--snapshot pre-draft` by hand right before the draft starts, then `--snapshot-draft <season>` after it ends. Commit and push both. In 2026, also settle the post-draft keeper flag (step 2). |
| Sep–Dec | Automated Tue + Fri. Nothing to do. |
| Early Jan | `--snapshot end-of-season` by hand. Commit and push. |
| Feb–Jul | Nothing to run. Expect GitHub to disable the schedule. |
