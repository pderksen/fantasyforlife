# Photos

How a photo gets from a phone or a shoebox scan onto the site. The brand marks follow the same
inbox rule but a different format rule; they have their own section at the bottom.

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
graphics with flat color and hard edges, like the header mark; it is the wrong format for a
photograph.

That PNG rule has one loud exception, measured below: **flat art carrying a grain or paper
texture behaves like a photograph to a compressor**, and PNG prices it as one. See Brand marks.

## Naming

Lowercase, hyphenated, dated or seasoned where it helps sorting:
`2019-draft-table.webp`, `2024-champion-trophy.webp`, `owner-clovis-jets.webp`. The name ships
in the URL and never changes without breaking a link, so pick it at optimize time rather than
renaming later.

## Optimizing

The project holds zero runtime dependencies and there is no image build step, so this is a
manual pass. **ffmpeg is installed on the dev machine** (winget, `Gyan.FFmpeg`) and its
`libwebp` encoder is what these assets were cut with:

```
ffmpeg -y -i photos-inbox/IMG_4417.jpg -vf "scale=2000:-2:flags=lanczos" \
  -c:v libwebp -preset picture -quality 80 -compression_level 6 assets/photos/2019-draft-table.webp
```

`flags=lanczos` matters: ffmpeg's default `bicubic` softens hard edges noticeably on a big
downscale. `-preset picture` tunes libwebp for stills rather than the default photo profile.

On a machine without ffmpeg, `npx --yes @squoosh/cli --webp '{"quality":80}' --resize
'{"width":2000}' -d assets/photos <file>` is the fallback, but squoosh is archived upstream and
is not guaranteed to run on Node 24.

Then rename the output, confirm it looks right at full size, and delete the inbox copy. If this
ever becomes routine rather than a few times a year, the upgrade is a `sharp` devDependency and
an `--optimize-assets` CLI step; it was not worth the dependency at current volume.

## Brand marks

Two master files, both flat vector-style art over a dark green field with a **paper-grain
texture** baked in. They arrived on 2026-08-16 and live in the gitignored inbox:

| Master | Size | Is |
|--------|------|-----|
| `photos-inbox/ffl-avatar.png` | 1024×1024 | The square shield badge |
| `photos-inbox/ffl-logo.png` | 2172×724 (exactly 3:1) | Shield plus "Fantasy For Life" wordmark, a banner lockup |

Unlike a photo original these are **not disposable once downscaled**. Every future cut comes
from them and nothing else can regenerate them, so archive them outside the repo rather than
deleting the inbox copies.

### The ladder

| File | Size | Bytes | Slot |
|------|------|-------|------|
| `assets/ffl-avatar-128.png` | 128×128 | 17.7 KB | The site header mark, rendered at 42 CSS px |
| `assets/ffl-avatar-512.webp` | 512×512 | 13.8 KB | Social card, `og:image`, re-uploading the Sleeper avatar |
| `assets/ffl-logo-1998.webp` | 1998×666 | 36.3 KB | Banner at full column width, 2x |
| `assets/ffl-logo-999.webp` | 999×333 | 14.8 KB | Same banner, 1x, or half-column at 2x |

82 KB in total, down from 3.2 MB of masters. That figure is the point of the exercise:
`output/` is committed and `assets/` is mirrored into it, so every byte here is stored **twice**
in git forever.

Four decisions worth not re-litigating:

- **WebP everywhere except the header mark.** The grain texture is what settles this. At 512×512
  the square is 321 KB as PNG and 13.8 KB as WebP, a 23x difference, because PNG's filters have
  nothing to predict against per-pixel noise. The header mark stays PNG anyway: at 128px the
  format costs 14 KB, and `SITE_MARK` in [snapshot.ts](../src/snapshot.ts) plus the `<img src>`
  in [html.ts](../src/html.ts) would both need editing to serve a `.webp`. Those two are the
  filename contract, so **renaming any header mark means changing both**.
- **128px, not 84.** The slot is 42 CSS px, so 84 would be the exact 2x. 128 covers 3x phones
  and, more importantly, 1024/128 is a clean integer 8, where 1024/84 is 12.19 and resamples
  slightly soft.
- **Banner widths divisible by 3.** The master is exactly 3:1, so 2000 wide (the full-column
  target in the table above) lands on a fractional 666.67 height and the 1x and 2x cuts end up
  at 666 and 334, not proportional. A `srcset` pairing those two shifts layout by a pixel when
  the browser swaps sources. 1998 and 999 are exact and the 2px shortfall is invisible.
- **Neither master has an alpha channel.** Both are 24-bit RGB with an opaque background, and
  the background is *not* `--color-forest` (`#183f24`): the square sits on roughly `#0a2e14` and
  the banner vignettes to near-black at its edges. So the avatar reads as a deliberate darker
  tile against the header bar, which `rounded-lg` already supports, and the banner only works on
  a dark surface of its own. Dropping either onto cream, or onto forest expecting it to blend,
  will look broken. Cutting a transparent version means removing the grain from the field, which
  is an artwork change, not an export setting.

### Cutting a new size

```
ffmpeg -y -i photos-inbox/ffl-logo.png -vf "scale=999:333:flags=lanczos" \
  -c:v libwebp -preset picture -quality 85 -compression_level 6 assets/ffl-logo-999.webp
```

Quality 85 rather than the photo default of 80: the wordmark has hard cream-on-green edges that
show ringing sooner than a photograph does. Verify by cropping a region at 1:1 and looking at
it, never by trusting the byte count.
