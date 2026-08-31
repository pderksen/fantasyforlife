# Photos

How a photo gets from a phone or a shoebox scan onto the site. The brand marks follow the same
inbox rule but a different format rule; they have their own section at the bottom.

## The two directories

| Directory | Tracked | Holds |
|-----------|---------|-------|
| `_images-inbox/` | No (gitignored) | Full-res photo originals and artwork masters, any name |
| `assets/photos/` | Yes | Web-ready derivatives, final names, the only copies that ship |

Drop originals in `_images-inbox/` with whatever filenames they came with. They get renamed,
downscaled, and written to `assets/photos/`, then deleted from the inbox. Originals are kept
outside this repo.

It was `photos-inbox/` until Aug 2026. The name broadened because the brand masters stage here
too, and the leading underscore sorts it to the top of the tree. The old name is still listed in
`.gitignore`, so a stale copy in another clone cannot be swept into a commit by `git add -A`.

`syncStaticAssets()` mirrors `assets/` into `output/assets/` on every run, so a file in
`assets/photos/` needs no other step to be served. Reference it from a page as
`${chrome.base}assets/photos/<name>.jpg`, never a bare relative path: `chrome.base` is what
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
| Home page gallery column | ~618px | **900px** |
| Two side by side | ~496px | **1000px** |
| Photo Gallery row | ~165–510px | **650px** |
| Inline portrait or avatar | 128px | **256px** |

Height follows from the crop, which follows from the slot: a hero wants something near 16:9 or
3:1, a gallery thumb usually wants 4:3 or square. That is why the inbox takes originals
uncropped and as large as they come. Downscaling and cropping are lossless decisions to defer;
they cannot be undone once the original is gone.

**A slot has to exist before a target is real.** Three do now: the home page's gallery column,
listed above at ~618 CSS px; the Photo Gallery page's justified rows,
which render a photo ~220–300 CSS px tall on desktop and take the 650px row; and the lightbox behind both, which takes the full-column
2000px row because it renders to the viewport. Everything else in the table is what the
current layout implies, not a spec anything is built against.

**The doubling in that table is a ceiling, not a floor.** The gallery row is 900 against ~618,
about 1.45x rather than 2x, because a photograph resampled by ffmpeg holds up at 1.5x far better
than the same photo left to the browser to squeeze from 3x. Match the slot first; buy retina
headroom with what is left.

**The gallery slot crops rather than fits.** Its two figures divide a capped column height and
sit `object-cover`, so a file's own aspect never sets the layout — see `galleryHtml()` in
`html.ts`. That is what lets the rule above (cut uncropped, at native aspect) stay true for
photos that ship into it. What the crop *shows* is `GalleryPhoto.focus`, an `object-position`,
which is a page decision and not something to bake into a file. The Photo Gallery page's grid
makes the opposite call and renders every file at its own aspect, uncropped; the reasoning is
in `docs/site-design.md`.

## Format

**Native formats: JPEG for photographs, PNG for the brand marks.** Ten people look at this
site a few times a year. Squeezing the last 40% off a 400 KB file buys nothing that justifies
carrying a second format to reason about, and both of these open in anything, including the
image tools on the dev machine.

The photo setting is ffmpeg's `-q:v 2` (roughly JPEG quality 93). Measured 2026-08-16 against
the WebP quality-80 cuts it replaced: about 2x the bytes, and visually indistinguishable at
1:1 — on the 2025 group shot the JPEG is marginally *crisper* on the fine magazine text.

This was WebP until 2026-08-16, chosen for bytes. The bytes were never the constraint at this
traffic level, so it was traded away for formats that need no thought.

Format choice still has teeth in exactly one place: **flat art carrying a grain or paper
texture behaves like a photograph to a compressor**, and PNG prices it as one. That is what
decides how far the banner ladder goes. See Brand marks.

## Naming

Lowercase, hyphenated, dated or seasoned where it helps sorting:
`2019-draft-table.jpg`, `2024-champion-trophy.jpg`, `owner-clovis-jets.jpg`. The name ships
in the URL and never changes without breaking a link, so pick it at optimize time rather than
renaming later.

## Optimizing

The project holds zero runtime dependencies and there is no image build step, so this is a
manual pass. **ffmpeg is installed on the dev machine** (winget, `Gyan.FFmpeg`) and is what
these assets were cut with:

```
ffmpeg -y -i _images-inbox/IMG_4417.jpg -vf "scale=2000:-2:flags=lanczos" \
  -map_metadata -1 -c:v mjpeg -q:v 2 assets/photos/2019-draft-table.jpg
```

Three parts of that are load-bearing:

- **`flags=lanczos`** — ffmpeg's default `bicubic` softens hard edges noticeably on a big
  downscale.
- **`-q:v 2`** — the mjpeg scale runs 1–31 and is *inverted*, so 2 is near the top. 1 costs
  bytes for no visible gain.
- **`-map_metadata -1`** — iPhone originals carry an EXIF block with the camera model, the
  capture timestamp, and potentially GPS coordinates, and these files are served publicly.
  Stripping it also shaves a few KB. Nothing on the site reads EXIF, so there is nothing to
  lose.

`-huffman optimal` is not worth adding: measured 2026-08-16 on the 2000px cut, it changed the
file size by zero bytes.

`-2` in the scale filter (rather than `-1`) keeps the derived dimension even, which some
encoders require and none object to.

Then rename the output, confirm it looks right at full size, and delete the inbox copy. If this
ever becomes routine rather than a few times a year, the upgrade is a `sharp` devDependency and
an `--optimize-assets` CLI step; it was not worth the dependency at current volume.

## What is in `assets/photos/` today

The 2024 trophy and 2025 league-photo cuts landed 2026-08-16, from two iPhone 15 originals shot at the 2025 draft. The other nine photos were cut 2026-08-23 from the originals then staged in the inbox, several of them small or already-compressed files that are the best surviving copy of their year.

| File | Size | Bytes | Is |
|------|------|-------|-----|
| `2006-2018-champions.jpg` | 744×731 | 237 KB | Collage of champions through 2018. Single cut, gallery row + lightbox |
| `2006-2018-toilet-bowl-champs.jpg` | 878×485 | 156 KB | Collage of Toilet Bowl champs through 2018. Single cut |
| `2019-draft-day-2000.jpg` | 2000×1500 | 454 KB | 2019 draft day, one owner joining by iPad. Lightbox |
| `2019-draft-day-650.jpg` | 650×488 | 75 KB | Same, gallery row |
| `2020-champion-clovis-jets.jpg` | 519×827 | 90 KB | The 2020 champion with the trophy. Single cut |
| `2020-draft-day-2000.jpg` | 2000×1158 | 327 KB | The 2020 draft, held over Zoom. Lightbox |
| `2020-draft-day-650.jpg` | 650×376 | 75 KB | Same, gallery row |
| `2021-champion-easton-evil-empire.jpg` | 318×496 | 47 KB | The 2021 champion with the trophy. Single cut |
| `2022-draft-day-2000.jpg` | 2000×1120 | 617 KB | 2022 draft day, two absent owners edited in. Lightbox |
| `2022-draft-day-650.jpg` | 650×364 | 110 KB | Same, gallery row |
| `2023-champion-kingsburg-killaz-2000.jpg` | 1500×2000 | 339 KB | The 2023 champion with the trophy. Lightbox |
| `2023-champion-kingsburg-killaz-650.jpg` | 650×866 | 96 KB | Same, gallery row |
| `2024-champion-toilet-bowl-trophies-1400.jpg` | 1400×1168 | 379 KB | The 2024 champion and toilet-bowl trophies, held by their winners. The lightbox, home page and gallery |
| `2024-champion-toilet-bowl-trophies-900.jpg` | 900×750 | 179 KB | Same, what the home page column renders |
| `2024-champion-toilet-bowl-trophies-650.jpg` | 650×542 | 101 KB | Same, gallery row |
| `2025-draft-board-2000.jpg` | 2000×1348 | 848 KB | The completed 2025 draft board. Lightbox |
| `2025-draft-board-650.jpg` | 650×438 | 135 KB | Same, gallery row |
| `2025-draft-day-league-photo-2000.jpg` | 2000×1184 | 453 KB | All ten owners on 2025 draft day, one attending by laptop. The lightbox, home page and gallery |
| `2025-draft-day-league-photo-900.jpg` | 900×532 | 130 KB | Same, what the home page column renders |
| `2025-draft-day-league-photo-650.jpg` | 650×384 | 76 KB | Same, gallery row |

All are uncropped, at the aspect they arrived. Calls worth recording:

- **Year prefix is the photo's subject, not its capture date.** Both were taken on the same
  afternoon, but the trophies are the *2024* season's, awarded at the 2025 draft. A gallery
  sorted by filename therefore separates them, which is the right answer for a history page
  and the wrong one for a "draft day 2025" set. Sort by an explicit date field if that
  second view is ever needed; do not rename the files to fix it.
- **Two widths, not four.** The wide group shot gets the 2000px full-column cut from the table
  above; the near-square trophy shot gets 1400, which is 2x of the ~700 CSS px a 1.2:1 photo
  should actually occupy in a 1016px column — 2000 would render it 848px tall. Both large cuts
  land within 16px of the same height, so they stack or sit side by side cleanly. The 650 pair is
  the gallery row, which the Photo Gallery page now renders.
- **Then a third width, because oversampling is not free.** Added 2026-08-16: the home page
  column is ~618 CSS px wide, and serving the 2000px file into it meant the *browser* did a 3.2x
  downscale on every page view, which reads harsh next to an ffmpeg lanczos cut. The 900px pair
  is what the column renders now — 1.45x the slot, so it still has headroom on a 1.25x or 1.5x
  Windows display, at under a third of the pixels. The large cuts stay in the ladder as what the
  lightbox opens, which is a slot that genuinely wants them: it renders at whatever the viewport
  gives it, and nothing loads it until a photo is clicked.
- **What a photo needs cut, by where it appears.** A gallery photo needs two files: the 650
  cut and a full cut for the lightbox, sized by the frame as above and capped at the
  original's width, since an upscale buys pixels with no detail in them. An original at or
  below ~900px wide gets **one** file at its own size instead, named without a width suffix
  and entered as both `file` and `full`: two files a hundred pixels apart is a rung nothing
  renders. Record every cut's pixel size in the entry's `width`/`height` with ffprobe, never
  by eye: the justified rows and the `<img>` size attributes both read them. A photo also
  featured in the home page column needs the 900 as well, named in its `GALLERY` entry.

## Brand marks

Two master files, both flat vector-style art over a dark green field with a **paper-grain
texture** baked in. They arrived on 2026-08-16 and were staged in the gitignored inbox; as of 2026-08-23 they are no longer on disk there, so confirm the off-repo archive holds them:

| Master | Size | Is |
|--------|------|-----|
| `_images-inbox/ffl-avatar.png` | 1024×1024 | The square shield badge |
| `_images-inbox/ffl-logo.png` | 2172×724 (exactly 3:1) | Shield plus "Fantasy For Life" wordmark, a banner lockup |

Unlike a photo original these are **not disposable once downscaled**. Every future cut comes
from them and nothing else can regenerate them, so archive them outside the repo rather than
deleting the inbox copies.

### The ladder

| File | Size | Bytes | Slot |
|------|------|-------|------|
| `assets/ffl-avatar-128.png` | 128×128 | 17.3 KB | The site header mark, rendered at 42 CSS px |
| `assets/ffl-avatar-512.png` | 512×512 | 329 KB | Social card, `og:image`, re-uploading the Sleeper avatar |
| `assets/ffl-logo-999.png` | 999×333 | 331 KB | Banner at full column width, 1x |
| `assets/ffl-favicon-180.png` | 180×180 | 34.4 KB | `apple-touch-icon`, the iOS home-screen size |
| `assets/ffl-favicon-32.png` | 32×32 | 2.0 KB | The tab icon a HiDPI screen actually asks for |
| `assets/ffl-favicon-16.png` | 16×16 | 0.8 KB | The tab icon at 1x |

714 KB in total, down from 3.2 MB of masters. `output/` is committed and `assets/` is mirrored
into it, so every byte here is stored **twice** in git forever — which is the only real argument
against the format, since nobody is waiting on the download.

`ffl-avatar-128.png` and the three favicon cuts are referenced by every page. The 512 and the
banner are staged. All three favicons come from the 512 rather than from each other, and both
small ones are cut from it directly: a 32 downscaled to 16 by the browser reads worse than
lanczos from the source, and at 16px there is nothing left to lose.

Five decisions worth not re-litigating:

- **PNG, knowing the grain makes it expensive.** At 512×512 the square is 329 KB as PNG and
  13.8 KB as WebP, a 24x difference, because PNG's filters have nothing to predict against
  per-pixel noise. Paid deliberately on 2026-08-16 for a native format at a site nobody is
  waiting on. See Format.
- **The header mark's filename is a contract.** `SITE_MARK` in [snapshot.ts](../src/snapshot.ts)
  and the `<img src>` in [html.ts](../src/html.ts) must name the same file, so **renaming any
  header mark means changing both**. A mismatch does not error — `hasSiteMark()` goes false and
  the header quietly degrades to wordmark-only, which is a designed state and so looks
  intentional.
- **No 2x banner cut.** `ffl-logo-1998` was 1.27 MB as PNG, two thirds of the entire ladder, for
  a slot no page has. Dropped 2026-08-16 rather than paid for on spec. Re-cut it from the master
  when a full-width banner slot actually gets built, and weigh JPEG for that one file at that
  point: it is the only asset here big enough for the format to matter.
- **128px, not 84.** The slot is 42 CSS px, so 84 would be the exact 2x. 128 covers 3x phones
  and, more importantly, 1024/128 is a clean integer 8, where 1024/84 is 12.19 and resamples
  slightly soft.
- **999 wide, not 1000.** The master is exactly 3:1, so a width divisible by 3 gives an exact
  integer height (333) instead of 333.33. This matters the day a 2x partner is cut: a `srcset`
  pairing 1000 and 2000 lands on heights 333 and 667, not proportional, and shifts layout by a
  pixel when the browser swaps sources. 999/1998 are exact and the 1px shortfall is invisible.
- **Neither master has an alpha channel.** Both are 24-bit RGB with an opaque background, and
  the background is *not* `--color-forest` (`#183f24`): the square sits on roughly `#0a2e14` and
  the banner vignettes to near-black at its edges. So the avatar reads as a deliberate darker
  tile against the header bar, which `rounded-lg` already supports, and the banner only works on
  a dark surface of its own. Dropping either onto cream, or onto forest expecting it to blend,
  will look broken. Cutting a transparent version means removing the grain from the field, which
  is an artwork change, not an export setting.

### Cutting a new size

```
ffmpeg -y -i _images-inbox/ffl-logo.png -vf "scale=999:333:flags=lanczos" \
  -c:v png -compression_level 100 assets/ffl-logo-999.png
```

No `-map_metadata -1` needed — the masters are artwork exports and carry no EXIF to strip.
`-compression_level 100` is zlib effort only; PNG is lossless either way, so this trades encode
time for bytes and nothing else.

If a cut ever does go to JPEG, the wordmark's hard cream-on-green edges show ringing sooner than
a photograph does, so verify by cropping a region and magnifying it with `flags=neighbor`, never
by trusting the byte count. Checked at `-q:v 2` on 2026-08-16: a faint halo at 1.6x, invisible
at display size.
