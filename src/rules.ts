/**
 * The league's official rules, and where every past season's rules live.
 *
 * Its own module rather than another block of `league-info.ts` for the same reason `tiers.ts` is
 * one: a full rules set runs about four thousand words, which is more than the rest of that file
 * holds put together, and it turns over completely every August while everything beside it is
 * keyed by season and accumulates. Same job though, hand-kept league facts no Sleeper endpoint
 * carries, read by a renderer that owns none of them.
 *
 * Two halves that do not mix. `RULES_SECTIONS` is the current season's rules as structured data,
 * rendered as the page itself. The archive below it is a list of links to seasons already closed,
 * which arrive in two forms and will only ever arrive in those two: a published Google Doc for
 * the years before this site carried rules, and a frozen page here for 2026 on.
 */

/**
 * The season `RULES_SECTIONS` describes, and the only season this page renders in full.
 *
 * Every earlier season is a link in the archive, so this is what changes when the rules turn
 * over: last year's page is frozen to `rules-<season>.html`, its season is added to
 * `RULES_PAGE_SEASONS`, and this moves forward a year.
 */
export const RULES_SEASON = "2026";

/**
 * One piece of a rules section.
 *
 * Deliberately a small vocabulary. Anything a rules document actually does is a paragraph, a
 * list, or a table of numbers, and every rules doc this league has published since 2008 is
 * expressible in those three. A richer model (inline emphasis, nested lists, links inside a
 * sentence) is what a rules set reaches for when it is being written as a web page rather than
 * transcribed as one, so add a variant when a rule needs it and not before.
 *
 * All text is plain and is escaped by the renderer, so an ampersand is typed as `&` and never as
 * an entity. Same call `GalleryPhoto.caption` makes, and for the same reason: an entity written
 * here ships to the page as its own literal characters.
 */
export type RulesBlock =
  | { kind: "text"; text: string }
  /** A named part within a section, for the sections that hold more than one thing. */
  | { kind: "heading"; text: string }
  | { kind: "list"; items: string[]; ordered?: boolean }
  | { kind: "table"; columns: string[]; rows: string[][] };

/**
 * A section of the rules, which is one anchor, one heading and one entry in the page's contents.
 *
 * `id` is the anchor and it is permanent. A reader who links a teammate to the trade deadline is
 * linking to `#trades`, so renaming an id breaks that link to fix nothing anybody sees, which is
 * the call the League History page already made for its own section ids. Reword `title` freely.
 */
export interface RulesSection {
  id: string;
  title: string;
  blocks: RulesBlock[];
}

/**
 * The current season's rules.
 *
 * Empty while the 2026 rules are being written, which the page renders as a notice pointing at
 * the newest archived set rather than as an empty page. That notice is derived from this being
 * empty, so filling this in is the whole edit that turns the page into the rules: the contents
 * list, the anchors and the sections all follow from it, and the notice takes itself off.
 *
 * 2026 restructures the rules rather than amending 2025's, so this is not a transcription of the
 * doc the archive already links. What changed and what did not is `RULE_CHANGES` in
 * `league-info.ts`, which the home page announces and which is not a substitute for the rules
 * themselves.
 */
export const RULES_SECTIONS: RulesSection[] = [];

/**
 * Rules documents published as Google Docs, one per season, for the years before this site
 * carried its own rules page.
 *
 * A closed list. 2025 is the last season that will ever be added to it, because 2026 onward is
 * written here and frozen here. Every URL is the doc's `/pub` address rather than its editable
 * one, so it renders as a page to anyone with the link and cannot be edited by a reader.
 *
 * **Three seasons are absent and that is the record, not a gap to fill.** No rules document
 * survives for 2006, 2007 or 2010. The page derives that sentence from this map against the
 * league's own season range, so finding one later removes the mention by adding the link.
 *
 * 2008 through 2014 open as "KAN Official Rules", the Keeper Alliance Network the league played
 * in then, and 2015 on as "FFL Official Rules". The page says nothing about that, the same call
 * `MFL_SEASONS` documents for the league's old MFL sites: it is a list of years, and a note about
 * a conference that folded a decade ago is more than the list is worth.
 *
 * **A link here is proved by the body it returns, never by its status code.** Every one was swept
 * anonymously on 2026-08-22 and its title read. Three traps sit in front of that, and each hands
 * back a confident wrong answer rather than an error:
 *
 * - A bare `curl` gets **401 on a doc that is published perfectly well**, because Google rejects
 *   its default user agent. So `-A "Mozilla/5.0"` is not optional, and a plain request reading as
 *   unpublished is not evidence of anything.
 * - With that agent an **unpublished doc answers 200**, serving a sign-in page in place of the
 *   document. A status check therefore passes on exactly the link that is broken.
 * - Drive's permissions API cannot see publish-to-web state at all, and reports owner-only for
 *   all seventeen of these whether or not they are published.
 *
 * What works: `curl -sL -A "Mozilla/5.0" <url>` and then read it. A real document carries a
 * `<title>` and runs ~215KB; the sign-in wall carries no title, runs ~9KB, and contains the
 * string "You must sign in to access this content". 2011 was the one link that failed the first
 * sweep; it was published that same day and has passed since.
 */
export const RULES_DOC_LINKS: Record<string, string> = {
  "2008": "https://docs.google.com/document/d/1VflHWUnApcswtZ5SJ7OwLz4L7xxVw6HpG_FxmR_Aikk/pub",
  "2009": "https://docs.google.com/document/d/1aBSVyJAzhNCCXvP6H2tsAgw4SXicdRXCTlBW8TpUAns/pub",
  // The one long URL here, and not a different kind of link. Docs published after 2018 get an
  // opaque token in place of the file id; the rest are short only because they were published
  // before that changed.
  "2011": "https://docs.google.com/document/d/e/2PACX-1vSrXpAOWd60P-nNUDSrc52jwNhvHtqcHfYdwYhd-_K6pgaZ8cRycmD_W5qwezZ38lJe9c3dNEV-hvPN/pub",
  "2012": "https://docs.google.com/document/d/1pXyTXoHox0YcPIbUoSA_08zcNoIeSohvGyU4bMR_IWg/pub",
  "2013": "https://docs.google.com/document/d/1yoEtb49JYj_tO6p2pZtMzlB1QgpFYP6SSuenyT9tnnM/pub",
  "2014": "https://docs.google.com/document/d/1IErWpeX_vk8TRdHxM5ctpoNKxfnm6tK4FhXK30facKg/pub",
  "2015": "https://docs.google.com/document/d/18jDwQhEiKaDXLOmjYNLaC2O0v0AaeTYdii0jf6_Eq0A/pub",
  "2016": "https://docs.google.com/document/d/10CY2dGrHjANIlGUZRpvSFO12lY4mVHdDt6O3UrZcGM8/pub",
  "2017": "https://docs.google.com/document/d/1flFBOFbSQdtKpYRmlhe0m6-UYhGk0dcvGuVNaeZxLbg/pub",
  "2018": "https://docs.google.com/document/d/17OfMmCetCnh9zphKb7uC5vs2c7GwMVyaUqEkE2C2r6A/pub",
  "2019": "https://docs.google.com/document/d/1nfIiQmk1NuXP1JSfcUnqrWXSWeYWsYvNyt3VxS7hy48/pub",
  "2020": "https://docs.google.com/document/d/1NVJjYhGRiN6gH6lxJlgkoYuv0GLFzBIuB4ufEIqVJug/pub",
  "2021": "https://docs.google.com/document/d/1xIHZcPmEjpSUxl9CndJAjFDFmLcdH1q-XRpXMjvn5UU/pub",
  "2022": "https://docs.google.com/document/d/1CTPKgyzXbj0X3cK-Xa_SO5csAnBv4Ak-VG-EJuYSWyI/pub",
  "2023": "https://docs.google.com/document/d/1XwdOIbANP6sQfGE8QepeXo8Voxjc0JZHO4Z9lk70q-w/pub",
  "2024": "https://docs.google.com/document/d/1xLcz7rkS1wAr7-mmS_EAw32SliiBEBpkgsyr1op1KDk/pub",
  "2025": "https://docs.google.com/document/d/1JqLo-wxlIXpqoS6YjYpdxe_aiZNPA0v5lC_8zFGjvcg/pub",
};

/**
 * Seasons whose rules are frozen as a page on this site, at `rules-<season>.html`.
 *
 * Empty until the 2026 season closes, which is when this list starts growing and
 * `RULES_DOC_LINKS` stops. The yearly ritual is three steps and this is the middle one: copy
 * `output/rules.html` to `output/rules-<season>.html` and commit it, add that season here, then
 * move `RULES_SEASON` forward and rewrite `RULES_SECTIONS`.
 *
 * A list of seasons rather than a list of URLs, because the filename is a convention rather than
 * a fact: `rulesPageFile()` builds it, so a season cannot be added under a name the page does not
 * actually serve. Nothing here is generated, so a season added without its file being committed
 * is a link to nothing, which is why the copy comes first.
 */
export const RULES_PAGE_SEASONS: string[] = [];

/** A frozen season's page, at the output root beside the current one. */
export function rulesPageFile(season: string): string {
  return `rules-${season}.html`;
}

/** Where a season's rules can be read, and whether that is somewhere else. */
export interface RulesArchiveEntry {
  season: string;
  href: string;
  /** A Google Doc rather than a page here, so the link opens in a new tab and says so. */
  external: boolean;
}

/**
 * Every past season's rules, newest first.
 *
 * A season frozen as a page here wins over a Google Doc of the same year, which cannot happen
 * today (the doc list ends at 2025 and the page list starts at 2026) and is settled anyway so
 * that it can never come down to object key order.
 */
export function rulesArchive(): RulesArchiveEntry[] {
  const entries = new Map<string, RulesArchiveEntry>();

  for (const [season, href] of Object.entries(RULES_DOC_LINKS)) {
    entries.set(season, { season, href, external: true });
  }
  for (const season of RULES_PAGE_SEASONS) {
    entries.set(season, { season, href: rulesPageFile(season), external: false });
  }

  return [...entries.values()].sort((a, b) => b.season.localeCompare(a.season));
}
