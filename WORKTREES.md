# Worktrees — Fantasy For Life

Running two or more Claude Code sessions at once without their file edits colliding.

A git worktree is a second working directory on its own branch, sharing this repo's history
and remote. Each Claude session gets its own checkout, so one can edit `src/html.ts` while
another edits `src/tiers.ts` and neither sees the other's half-finished state.

---

## The short version

| Step | Where you type it | Command |
|---|---|---|
| Start | Any session | `work in a worktree` |
| Develop | The worktree session | normal prompts, plus the `output/` rule below |
| Commit | The worktree session | `/commit — source only, leave output/ alone` |
| Merge + close | The worktree session | `exit the worktree and merge it` |

That is the whole loop for a single task. The rest of this file covers the setup it assumes,
the one repo-specific rule that prevents merge conflicts, and the different layout to use when
you want two windows side by side.

---

## One-time setup

Set `worktree.baseRef` so new worktrees branch from your current branch instead of `origin/main`:

```json
{ "worktree": { "baseRef": "head" } }
```

Put it in `~/.claude/settings.json` (all projects) or `.claude/settings.json` here. Note that
`.claude/` is gitignored in this repo, so a project-scope copy is local-only and won't be shared.

Without it the default is `"fresh"`, which branches from `origin/main` and does a network fetch
(capped at five seconds) before creating the worktree. `"head"` is local and instant.

**This is a correctness setting, not a speed one.** `"fresh"` starts you at `origin/main`, so every
commit sitting on your local `main` unpushed is missing from the worktree — including any rule or
convention added in one of them. That happened with this very file: a worktree branched under
`"fresh"` couldn't see `WORKTREES.md`, committed `output/` against the step-2 rule below, and hit a
merge conflict from a `src/html.ts` change that was already on `main`. Set `"head"`, or push before
you branch.

Nothing else needs configuring. `.gitignore` already excludes all of `.claude/`, so in-repo
worktrees never show up as untracked files.

---

## 1. Start

```
work in a worktree
```

Claude generates a name, creates `.claude/worktrees/<name>/` on branch `worktree-<name>`, and
switches the session's working directory into it.

**What this does not do:** move your VS Code editor. The extension panel stays bound to
`c:\Dev\fantasyforlife`, so open tabs and the Source Control panel still show the main checkout
while Claude edits files under `.claude/worktrees/`. Fine for "go do this, tell me when it's
done", wrong for watching diffs. For that, see [Side-by-side](#side-by-side-comparison) below.

**The worktree needs a build before anything runs.** `node_modules/` and `dist/` are gitignored,
so a fresh checkout has neither:

```
npm install && npm run build
```

Ask Claude to do it as part of the first request, or it will fail the first time it tries to
verify anything.

---

## 2. Develop

Normal prompts. One standing rule for this repo:

```
regenerate output to verify, but don't commit output/ — source only
```

**Why:** `output/` is committed and served directly by Cloudflare Pages, so it has to be current
on `main`. But it is generated, and two branches that both touch `src/html.ts` will produce two
divergent blobs that conflict on every merge. On top of that,
[`.github/workflows/refresh.yml`](.github/workflows/refresh.yml) runs daily through August and
rewrites `output/` on `main` overnight, so the base moves under you.

So: regenerate freely inside the worktree, because `git diff -- output/` is the verification that
a rendering change is correct (see **Verifying Changes** in `CLAUDE.md`). Just don't commit it.
Regenerating on `main` after the merge produces the same result with no conflict.

`data/` follows the same rule, though it rarely collides since only the snapshot commands write it.

---

## 3. Commit, merge, close

```
/commit — source only, leave output/ alone
```

Then:

```
exit the worktree and merge it
```

Keep these as two commands, not one. The commit is the last cheap moment to reshape the change;
folding it into the merge means approving the whole chain through to `push` on a single look.

The second command runs `ExitWorktree`, which returns the session to `c:\Dev\fantasyforlife`, and
from there: `git pull`, merge the branch, `npm run build && npm run dev -- --generate <season>`,
commit the regenerated `output/`, push, `git worktree remove`, `git branch -d`.

By hand it is:

```bash
git pull && git merge worktree-NAME
npm run build && npm run dev -- --generate <season>   # once per season with a page
git add output/ && git commit -m "Regenerate output" && git push
git worktree remove .claude/worktrees/NAME && git branch -d worktree-NAME
```

`git branch -d` is the safety check, not a formality: it refuses on a branch that isn't fully
merged, so it will not let you delete work you thought you had landed. Save `-D` for the abandoned
case at the bottom of this file.

---

## Why the merge can't happen inside the worktree

While a session is isolated, Claude Code blocks any tool call that reaches the main checkout:
`Edit`/`Write` targeting a path there, a Bash command whose working directory resolves there, and
git redirected there via `git -C`, `--git-dir`, `GIT_DIR`, or a `cd`. It also refuses shell
constructs it can't statically trace, such as heredocs with unquoted delimiters.

So a worktree session can commit and push, but never merge. Something outside has to do it, which
is why step 3 exits first. Uncommitted changes are invisible to `git merge` regardless, so the
commit is not optional either way.

---

## Side-by-side comparison

The in-place form above can't do this, because the worktree lives inside the repo and the VS Code
window stays pointed at the main checkout. For two real windows, put worktrees outside the repo:

```
c:\Dev\fantasyforlife       main checkout, main branch
c:\Dev\ffl-wt\a             worktree, branch feat-a
c:\Dev\ffl-wt\b             worktree, branch feat-b
```

One prompt sets one up:

```
create a worktree at c:/Dev/ffl-wt/a on branch feat-a from the current branch,
npm install, npm run build, then open it in a new VS Code window
```

By hand:

```bash
git worktree add c:/Dev/ffl-wt/a -b feat-a
cd c:/Dev/ffl-wt/a && npm install && npm run build
code c:/Dev/ffl-wt/a
```

Each window gets working editor tabs, a correct Source Control panel, working search, and a real
folder you can snap with `Win+Left` / `Win+Right`. Steps 2 and 3 are otherwise unchanged, except
that step 3 is typed in the *main checkout's* session, since `ExitWorktree` only applies to
worktrees it created in-session.

To compare the same file across two attempts, this is faster than two scrolling panes:

```bash
git diff feat-a feat-b -- src/html.ts
```

Or in VS Code: right-click in Source Control → **Select for Compare**, then **Compare with
Selected** on the other.

---

## Gotchas

**Never run two Claude sessions in one window.** `Ctrl+Shift+Esc` opens a second conversation with
the *same* working directory. Two tabs editing `src/html.ts` overwrite each other. Separate windows
on separate worktrees is the only safe parallelism here.

**Merge conflicts in `output/` are not hand-mergeable.** If one slips through, take either side
wholesale and regenerate:

```bash
git checkout --theirs output/ && git add output/ && git merge --continue
npm run dev -- --generate <season>
```

The regenerated file is the only correct answer. A clean `git diff -- output/` afterward is the
proof.

Workbooks (`*.xlsx`) can't be inspected in a conflict at all. Same fix, and it is exactly correct
here: the bytes are deterministic, so regenerating reproduces the right file bit for bit.

**The likeliest source conflict is the class-constant block at the top of `src/html.ts`.** Two
independent UI changes both declare a new `PILL_*` next to the existing ones and land on the same
lines. This is the one conflict where taking either side is wrong: keep both declarations. Rebuild
and regenerate afterward, since a merge of two source branches leaves the committed `output/`
matching neither.

**A merged feature branch deploys nothing until `output/` is regenerated on `main` and pushed.**
Cloudflare serves the committed HTML, so a source-only merge changes the site not at all. This is
the same trap as running a command locally and not pushing (see `RUNBOOK.md`).

**Concurrent sessions consume plan usage roughly linearly.** Hitting limits sooner than expected
while running three windows is arithmetic, not a fault.

**Cleanup, if a worktree is abandoned rather than merged:**

```bash
git worktree remove c:/Dev/ffl-wt/a   # add --force to discard uncommitted work
git branch -D feat-a
git worktree list                      # confirm
```
