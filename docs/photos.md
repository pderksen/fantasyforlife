# Photos

How a photo gets from a phone or a shoebox scan onto the site.

## The two directories

| Directory | Tracked | Holds |
|-----------|---------|-------|
| `photos-inbox/` | No (gitignored) | Full-res originals, straight off the camera, any name |
| `assets/photos/` | Yes | Web-ready derivatives, final names, the only copies that ship |

Drop originals in `photos-inbox/` with whatever filenames they came with. They get renamed,
downscaled, and written to `assets/photos/`, then deleted from the inbox. Originals are kept
outside this repo.

`syncStaticAssets()` mirrors `assets/` into `output/assets/` on every run, so a file in
`assets/photos/` needs no other step to be served. Reference it from a page as
`${chrome.base}assets/photos/<name>.webp`, never a bare relative path: `chrome.base` is what
makes one href resolve from both the output root and a season directory.

## Why originals must never be committed

`output/` is committed so Cloudflare can serve it, which means every file in `assets/` is
stored **twice** in git history. Commit a 4MB original and the repo carries 8MB of it forever,
plus another two blobs when it is later replaced by the optimized version. Git has no
forgetting.

The scheduled refresh compounds it. `.github/workflows/refresh.yml` runs `git add -A` and
pushes to `main`, daily through August. It checks out a clean tree, so it cannot see an
untracked local file, but the moment an original is committed and pushed the next run mirrors
it into `output/assets/` and commits that copy too, with no human in the loop.

Hence the gitignored inbox. Nothing full-res ever sits in a tracked directory.

## Target dimensions

The content column is `max-w-[1080px]` with `px-8` at `sm` and up, so roughly **1016 CSS px**
of usable width. Everything below is that measure divided by the slot, then doubled for 2x
displays.

| Slot | CSS width | Export width |
|------|-----------|--------------|
| Full width of the column (hero, banner) | ~1016px | **2000px** |
| Two side by side | ~496px | **1000px** |
| Three-up gallery grid | ~323px | **650px** |
| Inline portrait or avatar | 128px | **256px** |

Height follows from the crop, which follows from the slot: a hero wants something near 16:9 or
3:1, a gallery thumb usually wants 4:3 or square. That is why the inbox takes originals
uncropped and as large as they come. Downscaling and cropping are lossless decisions to defer;
they cannot be undone once the original is gone.

**A slot has to exist before a target is real.** No page currently renders a photo. The numbers
above are what the current layout implies, not a spec anything is built against. Deciding "these
twelve go in a three-up grid on the history page" is what turns the 650px row into the answer.

## Format

**WebP, quality 80.** Photographic content, universally supported by the browser baseline this
site already requires (Tailwind v4 needs Safari 16.4+ / Chrome 111+ / Firefox 128+), and no
`<picture>` fallback to maintain.

AVIF is roughly 30% smaller again and clears the same baseline, but encodes slowly and buys
little at these dimensions. Worth reaching for only on a single large hero. Keep PNG for
graphics with flat color and hard edges, like the header shield; it is the wrong format for a
photograph.

## Naming

Lowercase, hyphenated, dated or seasoned where it helps sorting:
`2019-draft-table.webp`, `2024-champion-trophy.webp`, `owner-clovis-jets.webp`. The name ships
in the URL and never changes without breaking a link, so pick it at optimize time rather than
renaming later.

## Optimizing

No image tooling is installed and the project holds zero runtime dependencies, so this is a
manual pass rather than a build step:

```
npx --yes @squoosh/cli --webp '{"quality":80}' --resize '{"width":2000}' \
  -d assets/photos photos-inbox/IMG_4417.jpg
```

Then rename the output, confirm it looks right at full size, and delete the inbox copy. If this
ever becomes routine rather than a few times a year, the upgrade is a `sharp` devDependency and
an `--optimize-assets` CLI step; it was not worth the dependency at current volume.
