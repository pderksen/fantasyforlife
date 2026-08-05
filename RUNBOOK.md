# Runbook — Fantasy For Life

What to run, when, and what to check afterward. Everything runs from `c:\Dev\fantasyforlife`.

The site is pre-generated HTML committed to `main`. Cloudflare Pages serves `output/` directly,
so **nothing is live until you commit and push**. Running a command locally is only half the job.

---

## The short version

| When | Command | Frequency |
|---|---|---|
| Aug, up to draft day (non-throwback years) | `npm run dev -- --snapshot pre-draft` | Daily while keepers trickle in |
| Right after the draft | `npm run dev -- --snapshot-draft <season>` | Once |
| During the NFL season | `npm run dev -- --traded-picks` then `npm run dev -- --generate <season>` | Weekly |
| After NFL Week 18 (~early Jan) | `npm run dev -- --snapshot end-of-season` | Once |
| After any of the above | `git add -A && git commit && git push` | Every time |

Season = the NFL season year, e.g. `2026` for Sep 2026 – Feb 2027.

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

---

## 3. In-season: traded picks refresh

Pick trades happen all season and apply to next year's draft. Two commands, and the second one
is not optional:

```
npm run dev -- --traded-picks
npm run dev -- --generate <season>
```

`--traded-picks` re-fetches, re-dates (sweeping transactions weeks 1–18 across the whole league
lineage), saves `data/<season>/traded-picks.json`, and regenerates **only the home page**. The
roster pages keep their stale tables until `--generate` runs. Weekly during the season is plenty.

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
  `HTML written:`, `Index written:`.
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
- **Traded picks seal.** Once `data/<newer season>/` exists, the older season's
  `traded-picks.json` stops being rewritten and the command prints `... are sealed (a newer
  season has data) — left unchanged.` That's correct behavior, not a failure: re-fetching would
  re-resolve owner names against current team names and quietly rewrite history.
- **Pre-draft is the only unrecoverable capture.** Post-draft and traded picks can be rebuilt
  from the API later; keepers cannot.
- **Every command auto-regenerates `output/index.html`**, so the home page never drifts.
- **Node 24 LTS** is the supported runtime (`engines: >=24`); native `fetch` needs no HTTP
  library. `npm run dev` runs `tsc` first, so a TypeScript error blocks the run before any
  network call.
- **A fresh league returns picks but zero transactions.** If every `tradedOn` suddenly vanishes,
  the lineage walk (`previous_league_id`) is broken, not the API.

---

## Automating with Claude scheduled tasks

Safe to run unattended (idempotent, read-only against Sleeper, overwrite their own outputs):
`--snapshot pre-draft`, `--traded-picks` + `--generate`, `--snapshot end-of-season`.

Keep human-driven: the annual config edits in step 2, and the post-draft snapshot (it needs the
draft to have actually finished).

Whether the schedule should also commit and push is your call. Auto-pushing means the site
updates itself; it also means an unreviewed diff goes live. My recommendation: let the
in-season traded-picks job commit and push on its own (low-stakes, small diffs), and have the
preseason and end-of-season jobs stop after generating and report what changed, since those are
the runs where a bad capture is worth catching before it ships.

Suggested schedules, seasonal so remember to turn them off:

**A. Keeper watch** — daily ~7am Pacific, mid-Aug through draft day, non-throwback years only:

> In c:\Dev\fantasyforlife, run `npm run dev -- --snapshot pre-draft`. Report which teams have
> not set keepers yet and whether the snapshot changed from the previous run (`git diff --stat`).
> Do not commit. If the run fails, say so with the error output.

**B. Traded picks refresh** — weekly, Tuesday ~6am Pacific, Sep through early Jan:

> In c:\Dev\fantasyforlife, run `npm run dev -- --traded-picks` followed by
> `npm run dev -- --generate <season>`. If `git status` shows changes, commit them with a message
> describing which picks moved, and push. If nothing changed, report that and stop.

**C. End-of-season capture** — once, early January after Week 18:

> In c:\Dev\fantasyforlife, run `npm run dev -- --snapshot end-of-season`. Report the diff summary.
> Do not commit until I confirm.

Replace `<season>` with the literal year in the scheduled prompt. The scripts take it as an
argument and won't infer it.

---

## Yearly calendar at a glance

| Month | Action |
|---|---|
| Early Aug | Update `DEFAULT_LEAGUE_ID`, `DRAFT_ORDERS`, `TIER_CONFIGS`. Enable schedule A. |
| Mid–late Aug | Daily pre-draft snapshots (skip in throwback years) |
| Draft day (late Aug) | Final pre-draft snapshot, then `--snapshot-draft` after. Disable A, enable B. |
| Sep–Dec | Weekly traded picks refresh |
| Early Jan | `--snapshot end-of-season`. Disable B. |
| Jan–Jul | Nothing to run |
