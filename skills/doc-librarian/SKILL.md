---
name: doc-librarian
description: >-
  Expert documentation librarian for managing, organizing, indexing, and
  curating a repository's docs/ directory. Use when the user wants to audit,
  reorganize, index, tag, deduplicate, archive, or set standards for
  documentation — or when creating/placing a new doc and deciding where it goes,
  what type it is, and what metadata it needs. Applies library-science
  discipline: taxonomy (MECE folders, controlled vocabulary), information
  architecture (Diátaxis doc types), cataloging (YAML frontmatter, Dublin Core),
  findability (README indexes, hub-and-spoke linking), and records-management
  lifecycle (draft → active → deprecated → archived). Triggers: "organize the
  docs", "where should this doc go", "audit our documentation", "clean up docs/",
  "add an index", "documentation standards", "is this doc stale", "archive old docs".
license: Apache-2.0
compatibility: >-
  Core procedures (A–H) are portable to any Agent Skills client. The
  authoring-time enforcement — /doc-librarian setup, the PostToolUse(Write)
  hook, and .claude/settings.json registration — is Claude Code-specific.
  Requires git and Node.js >=22; scripts/analyze-docs.py optionally uses uv/Python 3.
metadata:
  author: "Troy Molander"
  version: "1.0"
---

# Doc Librarian

You are acting as a professional documentation librarian. Your job is to keep a
`docs/` directory **findable, trustworthy, and maintainable at scale** by
applying information-science discipline — not ad-hoc tidying.

A repository's docs are a library. Libraries decay predictably: sprawl,
duplication, orphaned items, stale shelves, no catalog. This skill gives you the
five librarian competencies and the procedures to apply them.

## First principles (the five competencies)

1. **Taxonomy** — Folders carry ONE primary axis; everything else is frontmatter
   tags. Keep ≤7 categories per level, depth ≤4, MECE (no overlapping siblings).
2. **Information architecture** — Every doc is exactly ONE Diátaxis type:
   tutorial, how-to, reference, or explanation. Never mix types in one file.
3. **Cataloging** — Every doc carries required YAML frontmatter (the catalog
   record): `title, doc_type, status, owner, updated, tags`.
4. **Findability** — Every folder has a README index; hub-and-spoke linking;
   descriptive link text; the root README is the master catalog.
5. **Lifecycle** — Docs move draft → active → deprecated → archived. Date
   everything; deprecate before deleting; flag staleness.

Detailed rules for each live in `references/principles.md`. Read it before any
non-trivial reorganization. The frontmatter schema and controlled-vocabulary
rules are in `references/frontmatter-schema.md`.

## Recommended order of operations

The procedures below are a **catalog keyed by intent, not a sequence** — the
letters are stable IDs, not an order. For an end-to-end cleanup of a neglected
`docs/`, run them like this:

1. **Bootstrap the vocabulary — Procedure G.** Draft `TAGS.md` from the corpus.
   It's cheap, and the domain map it produces helps you spot obsolete/duplicate
   topic clusters in the next step. (Finalize it after weeding.)
2. **Triage relevance — Procedure E.** Weed obsolete/stale docs *before* investing
   in structure. Auditing or reorganizing docs you're about to delete is wasted
   work, and dead content lends false authority to a clean new tree. For the large
   REVIEW bucket, fan out a deep per-doc appraisal with **Procedure H**
   (multi-agent) to get evidence-based verdicts before deciding.
3. **Audit structure — Procedure A.** Assess sprawl, indexing, naming — on the
   *survivors*, so the numbers reflect what you're keeping.
4. **Set standards — Procedure F.** Finalize `TAGS.md` against the surviving
   corpus; add templates, naming policy, ownership.
5. **Reorganize — Procedure B.** Move survivors into the taxonomy (staged, `git mv`).
6. **Index — Procedure D.** READMEs, hub-and-spoke linking, master catalog.
7. **Ongoing.** Procedure C for each new doc; re-run Procedure E on a schedule.

The through-line: **relevance (E) precedes structure (A/B/D); governance (G/F)
brackets them.** Don't audit or reshuffle a collection you haven't weeded.

## Golden rules (do not violate)

- **Never delete a referenced doc.** Deprecate → archive → (much later) dispose.
  Git history is the safety net, but broken inbound links are not acceptable.
- **Never do a big-bang reshuffle.** Reorganization is staged and non-destructive:
  move in small batches, use `git mv` to preserve history, fix inbound links in
  the same change, verify links before and after.
- **Never invent a tag.** Tags come from the controlled vocabulary (`TAGS.md`).
  If a needed tag is missing, add it to `TAGS.md` first, with a definition.
- **One primary axis for folders.** If you find yourself wanting a folder for
  audience AND topic AND lifecycle, two of those become tags.
- **Confirm scope before moving files.** Present the plan; get sign-off; then act.

## When to use which procedure

| The user wants… | Go to |
|-----------------|-------|
| A health check / assessment of the docs | **Procedure A: Audit** |
| To reorganize / consolidate a messy tree | **Procedure B: Reorganize** |
| To place or create a single new doc | **Procedure C: Place a doc** |
| Indexes / navigation / a catalog | **Procedure D: Index** |
| To find & retire stale or duplicate docs | **Procedure E: Curate** |
| Standards / templates / governance set up | **Procedure F: Govern** |
| A tag taxonomy / controlled vocabulary | **Procedure G: Bootstrap vocabulary** |
| Deep, evidence-based appraisal of many docs | **Procedure H: Multi-agent deep-dive** |

---

## Running this skill's scripts

**Every command below runs from the root of the repository being worked on, not
from the skill directory.** The scripts live wherever the skill is installed, so
address them through `${CLAUDE_SKILL_DIR}`, which Claude Code substitutes to this
skill's own directory:

```bash
cd /path/to/the/repo/you/are/organizing
node --experimental-strip-types "${CLAUDE_SKILL_DIR}/scripts/triage-docs.ts"
```

If `${CLAUDE_SKILL_DIR}` is empty, the client is older than Claude Code 2.1.69 —
substitute the install path by hand (`~/.claude/skills/doc-librarian`) and say so,
rather than running a bare `scripts/…` that will resolve against the target repo
and fail with a confusing ENOENT.

Use `npx tsx` in place of `node --experimental-strip-types` where a matching
esbuild binary is already installed; the latter works anywhere on Node ≥ 22.

**Artifacts land in `.doc-librarian/` at the repo root, never inside `docs/`.**
Reports, drafts and the NLP JSON are working output, and anything written into the
tree under audit becomes an input to the next scan of that tree — the scorer would
end up appraising its own report. `setup.sh` adds the directory to `.gitignore`.
Override any single path with `--out`.

## Setup — install the governance kit (`/doc-librarian setup`)

When invoked as **`/doc-librarian setup`** (argument `setup`), install this skill's docs-governance
kit into the repository the command is run from — don't do a manual reorg, just wire up enforcement.

Run **`"${CLAUDE_SKILL_DIR}/scripts/setup.sh"`** from anywhere inside the target repo. It is idempotent and:

1. copies **`scripts/lint-docs.ts`** → the repo's `docs/scripts/lint-docs.ts` (the single source of
   truth for every check: links, tags, frontmatter, structure, staleness);
2. copies **`hooks/docs_structure_guard.py`** → the repo's `.claude/hooks/` and **registers** it as a
   `PostToolUse(Write)` hook in `.claude/settings.json` (merged, never clobbered) so any agent that
   writes a non-conforming `docs/**/*.md` is nudged through **Procedure C** as it authors;
3. seeds `docs/TAGS.md` from this skill's starter vocabulary if the repo has none;
4. adds `.doc-librarian/` to `.gitignore` so this skill's working artifacts never
   become documents the next scan appraises;
5. adds `docs:lint` / `docs:lint:staged` / `docs:staleness` npm scripts when a `package.json` exists.

After it runs, report what changed and tell the user the two remaining manual steps: (a) wire
`npx tsx docs/scripts/lint-docs.ts --staged` into their pre-commit hook for the commit-time gate, and
(b) curate `docs/TAGS.md` for their domain. The hook needs `tsx` available (`npm i -D tsx`).

## Procedure A — Audit the collection

Produce an evidence-backed assessment. Never recommend changes without counts.

1. **Inventory.** Count files by type; list top-level dirs and loose root files;
   measure max nesting depth. (`find docs -type d | awk -F/ '{print NF}' | sort -rn | head`)
2. **Sprawl check.** Count top-level directories. >7 is a finding. Cluster them
   and look for redundant axes (same concept in multiple places).
3. **MECE check.** Identify overlapping sibling categories (e.g. `learnings/` vs
   `tribal-knowledge/`, `analysis/` vs `research/`). Each overlap is a finding.
4. **Loose-files check.** List markdown files at `docs/` root; each one that
   isn't `README.md` is misplaced — name its logical home.
5. **Index coverage.** Count directories with vs. without `README.md`/`index.md`.
   Report the percentage and name the biggest un-indexed dirs.
6. **Catalog accuracy.** Does root `README.md` list all real dirs? Is its
   `updated` date recent? Flag "planned" sections that never materialized.
7. **Metadata coverage.** Count files with YAML frontmatter (`grep -lc '^---'`).
   Report the percentage and which required fields are typically missing.
8. **Staleness.** Sample `updated`/"Last Updated" dates; report the age
   distribution and the count of docs untouched for >N months.
9. **Naming.** Report convention mix (kebab vs snake vs SCREAMING vs camel;
   pluralization inconsistencies).
10. **Hygiene.** Flag generated output mixed with authored docs, session
    artifacts, config files, and archive-within-archive nesting.

Output a findings table with **Category / Evidence (counts) / Severity** and a
short prioritized recommendation list. Do not modify anything in an audit.

## Procedure B — Reorganize (staged, non-destructive)

> **A reorganization is not necessarily a docs-only change.** Docs get cited from
> live source, tests, CI config, editor and agent config, and the root `README`/
> `CLAUDE.md`. Moving a file that any of those name is a cross-cutting change that
> must pass the same review and the same build as a code change. Measure that
> before you promise anyone this is a tidy-up.

0. **Measure the blast radius.** For every doc the map moves, count referrers
   *outside* `docs/` as well as inside:

   ```bash
   git grep -l "old/path/to/doc.md" -- ':!docs' | sort
   ```

   Classify each doc as **soft** (referenced only from within `docs/`) or **hard**
   (named by source, tests, config, or a root-level file). Report the split before
   any `git mv`. On a real corpus this is not a rounding error — in the run this
   skill was hardened on, **56 of 62 moving documents had referrers outside
   `docs/`, and 30 of those were hard**.

   Hard referrers decide the shape of the work: the batch that moves them edits
   code, so it needs the test suite green, not just the link checker.

1. **Run Procedure A first** if you don't already have an audit.
2. **Design the target taxonomy.** Pick ONE primary axis (topic, audience, or
   lifecycle — see `references/principles.md §1`). Draft ≤7 top-level buckets,
   MECE, depth ≤4. Diátaxis (`tutorials/how-to/reference/explanation` + `decisions/`
   + `project/` + `archive/`) is a strong default. Map every current dir/file to
   a target location. Write this as a **migration map** and get user sign-off.
3. **Set up the destination.** Create target dirs with README index stubs
   (Procedure D). Add `TAGS.md` and templates if absent (Procedure F).
4. **Migrate in batches** (by source dir, smallest/safest first):
   - `git mv` each file to preserve history.
   - Add/normalize frontmatter (Procedure C step 3).
   - Fix inbound links repo-wide (`grep -rl 'old/path'`), update to new relative paths.
     **Including referrers outside `docs/`** — `apply-actions.ts` rewrites links
     within the docs tree only, so anything step 0 classified as *hard* is yours to
     edit by hand.
   - **Check anchored references by hand.** In `guide.md#configuration` the path
     moves and the fragment does not, so a rewrite that fixes the path leaves a
     link that resolves to the right *file* and the wrong *place in it* — or to
     nothing, if the heading was also edited. **Nothing in this skill checks
     anchors**; the link checker only sees the path. Grep the fragment against the
     destination's headings for every anchored referrer, and treat an anchor that
     was already dangling before the move as pre-existing — record it, don't
     silently adopt it.
   - Update the destination README index.
5. **Verify each batch.** Run the link checker; confirm no *new* broken
   references against a baseline measured before the migration started (an
   absolute count means nothing — a corpus that was already broken will still be
   broken, and you need to know which half is yours); confirm the moved docs
   render; and if the batch touched hard referrers, run the test suite. Commit the
   batch with a clear message.
6. **Handle completed/abandoned work.** Move finished planning/implementation
   docs to `archive/` with `status: archived` and a dated note — don't leave
   them in active navigation.
7. **Refresh the master catalog** (root README) last, once structure is stable.

Never proceed to the next batch if the previous one left broken links.

## Procedure C — Place or create a single doc

Use this whenever a new doc is written or an existing one needs a home.

1. **Classify the Diátaxis type.** Ask: is it teaching a newcomer (tutorial),
   helping a competent user hit a goal (how-to), stating facts (reference), or
   explaining why (explanation)? If it's "more than one," it must be split.
2. **Find the one correct folder** on the primary axis. If unsure between two,
   that's a MECE smell — pick the reader's most likely mental model and add a
   cross-link from the other.
3. **Add required frontmatter** from `references/frontmatter-schema.md`
   (`title, doc_type, status, owner, updated, tags`). Tags from `TAGS.md` only.
4. **Name it** `kebab-case.md` (date-prefix `YYYY-MM-DD-` for dated content;
   `NN-` for ordered sequences; `README.md` only for indexes).
5. **Wire it in.** Add a linked, one-line entry to the folder's README index;
   add on-ramp/off-ramp links (prerequisites, next steps) so it stands alone.

## Procedure D — Index (findability)

1. **Every folder gets a `README.md`** stating its purpose (its MECE scope) and
   listing each child with a linked one-line description — a local catalog.
2. **Root `README.md` is the master hub**: lists every top-level area, links to
   each sub-index, states the doc-type scheme and where the `TAGS.md` lives.
3. **Hub-and-spoke**: index pages (hubs) link to content (spokes); spokes link
   back to their hub and laterally to siblings.
4. **Descriptive link text** carrying information scent — never "here"/"click".
5. **Keep indexes current**: updating a folder's contents means updating its
   README in the same change. A stale index is worse than none.

Index stub template:
```markdown
# <Area Name>

> **Purpose:** <one sentence — what belongs here and what does not (MECE scope)>
> **Owner:** @<dri>   ·   **Updated:** <YYYY-MM-DD>

## Contents
- [<doc title>](./file.md) — <one-line description>
```

## Procedure E — Curate (lifecycle & dedup)

> **Run this BEFORE Procedure B (Reorganize).** Weeding precedes reclassification
> — never re-shelve and re-index docs you're about to discard, and never let a
> clean new structure lend false authority to obsolete content.

0. **Triage relevance with data, not by reading everything.**
   - *(Recommended first)* Run `analyze-docs.py` (scikit-learn) to produce
     `nlp-analysis.json` — TF-IDF cosine **near-duplicate clusters**, tag salience,
     and NMF topic themes. The triage and tag scripts auto-consume it when present.
     Deps are declared inline (PEP 723), so `uv run` provisions them automatically.
     ```
     uv run "${CLAUDE_SKILL_DIR}/scripts/analyze-docs.py"
     ```
   - Then run `triage-docs.ts` — a non-destructive scorer that buckets
     every doc into KEEP / REVIEW / WEED using git recency, inbound links (orphan
     detection), code-anchor validity (does the source it references still exist?),
     work-area, and near-duplicate signals (cosine when the NLP artifact is
     present, else title matching). Markdown by default; `--format csv` for a
     spreadsheet. Tune `--recent-months/--stale-months/--very-stale-months` to the
     repo's commit velocity. Confirm WEED → skim REVIEW (sort by score) → only then
     curate the survivors with the steps below.
     ```
     node --experimental-strip-types "${CLAUDE_SKILL_DIR}/scripts/triage-docs.ts"
     ```
   (Both default their output into `.doc-librarian/`, and `triage-docs.ts` picks up
   `.doc-librarian/nlp-analysis.json` automatically — pass `--nlp` only to point it
   somewhere else. The Python layer is optional; everything degrades gracefully
   without it.)
1. **Staleness sweep.** Flag `active` docs whose `updated` is older than the
   review cadence, or past `review_by`. Present the list; for each, decide:
   refresh, deprecate, or archive. Don't silently touch content.
2. **Deprecate** a superseded doc: set `status: deprecated`, add a top banner
   linking to its replacement, remove it from default navigation, keep the file.
3. **Archive** historical docs: `git mv` to `docs/archive/`, set
   `status: archived`, add a dated "archived because…" note. Keep archive
   shallow — don't nest archives inside archives.
4. **Deduplicate.** When two docs cover the same thing, pick the single source of
   truth, merge unique content into it, replace the other with a redirect link,
   and update inbound references. Prefer single-sourcing shared snippets.
5. **Dispose** only long-deprecated, unreferenced docs whose retention has
   lapsed — and only with explicit user confirmation. Git retains the history.

**Executing the verdicts at scale.** After a deep-dive (Procedure H) and
`aggregate-results.ts`, run `"${CLAUDE_SKILL_DIR}/scripts/apply-actions.ts"` to carry out the mechanical
verdicts. It is **dry-run by default** (mutates nothing until `--apply`), stages by
`--source-batch`, and enforces the rules above:
- **ARCHIVE** → `git mv` to `docs/archive/<path>`, set `status: archived` + a dated
  banner, and rewrite absolute-path inbound links (relative links are flagged, not
  guessed).
- **DEPRECATE** → in place, `status: deprecated` + a banner linking the replacement.
- **DELETE** → `git rm`, but **only** when `inbound_links == 0` and `--confirm-delete`
  is passed; a referenced doc is never deleted (deprecate/archive instead).
- **MERGE / UPDATE** → never automated (content judgment) → written to `apply-todo.md`.
- `--aggressive` promotes an ARCHIVE to DELETE when triage shows the doc is orphaned
  **and** its subject code is gone (`inbound == 0` ∧ had code anchors that now 0%
  resolve). KEEP is never promoted; promotions still need `--confirm-delete`.
Verify links and render, then commit per batch (Procedure B.5).

## Procedure F — Govern (standards & templates)

1. **`TAGS.md`** — the controlled vocabulary. Every allowed tag with a one-line
   definition and its non-preferred synonyms. Tags in frontmatter are linted
   against this list.
2. **Templates per doc type** in `templates/` (`tutorial.md`, `how-to.md`,
   `reference.md`, `explanation.md`, `adr.md`), each with required frontmatter
   pre-filled and the expected section skeleton. See `templates/` in this skill.
3. **Ownership (DRI).** Every doc/folder has exactly one owner in `owner`
   frontmatter and/or `CODEOWNERS`. Review deadlines attach to that owner.
4. **Naming policy.** kebab-case files; ISO date prefixes for time-series;
   numeric prefixes for sequences; README for indexes.
5. **ADRs.** Significant decisions go in `docs/decisions/` as numbered,
   immutable records (Nygard format: Status / Context / Decision / Consequences).
   Never rewrite an accepted ADR — supersede it with a new one and mark the old
   `superseded by ADR-NNNN`.
6. **CI gates (recommend, don't assume).** Suggest: frontmatter-schema lint,
   tag-vocabulary lint, markdown link check, doc_type↔bucket + kebab-naming
   (structure), and a staleness report. Docs change through the same PR + review as
   code. A ready reference implementation of all of these ships in
   `scripts/lint-docs.ts` (zero-dependency `tsx`) — copy it into the target repo's
   `docs/scripts/`, wire `--staged` into pre-commit (blocking), and run `--staleness`
   as the non-blocking review report. It gates only intra-docs links (source-code
   cross-refs are out of scope) and exempts `archive/`, generated `reference/api/`,
   and `scripts/`. The `structure` check enforces placement: a Diátaxis-bucket doc
   must carry the matching `doc_type` (so `reference/` can't hold a `how-to`);
   naming blocks on new/staged files, warns on legacy names in the full audit.
7. **Enforce at authoring time (optional but recommended).** Wire a Claude Code
   `PostToolUse(Write)` hook that runs `lint-docs.ts --file=<path>` on each new
   `docs/**/*.md` and, on failure, nudges the authoring agent through Procedure C
   (identify type → use the matching `templates/` file → place in the right bucket →
   frontmatter). Make it fail **open** on infra errors so a broken hook never blocks
   authoring. This shifts placement/type/metadata enforcement left — the agent gets
   corrected as it writes, not at commit time.

## Procedure G — Bootstrap the controlled vocabulary (TAGS.md)

A controlled vocabulary must exist before you can tag docs or reorganize by
facet — but don't invent it from nothing. Derive it from the terms the corpus
already uses, then curate.

1. **Mine candidates.** Run `suggest-tags.ts` — it emits a **draft**
   `TAGS.md` of candidate tags (non-destructive; writes one draft file). If
   `nlp-analysis.json` (from `analyze-docs.py`) is present, candidates are ranked
   by **TF-IDF salience** and grouped into **NMF topic themes**; otherwise it
   falls back to a directory + heading frequency heuristic.
   ```
   uv run "${CLAUDE_SKILL_DIR}/scripts/analyze-docs.py"          # optional but better
   node --experimental-strip-types "${CLAUDE_SKILL_DIR}/scripts/suggest-tags.ts"
   ```
   The draft lands at `.doc-librarian/TAGS.draft.md`; curate it into `docs/TAGS.md`.
2. **Curate** the draft into a small, MECE set (~20–40 tags): pick one preferred
   term per concept, fold synonyms into the "Use instead of" column, delete
   generic noise (structural heading words, one-offs). A doc should need only 1–4.
3. **Reconcile with the folder axis.** Terms that will become primary-axis folders
   don't also need to be tags; tags are for the *secondary* axes (app area,
   feature, lifecycle).
4. **Finalize** as `docs/TAGS.md`. If you're weeding first (recommended), draft
   early but finalize against the *surviving* corpus so dead topics don't pollute
   the vocabulary.
5. **Enforce.** Add a CI check that every frontmatter `tags:` value exists in
   `TAGS.md` (Procedure F).

---

## Procedure H — Deep-dive appraisal at scale (multi-agent)

For the large REVIEW bucket (and any WEED you want double-checked), fan the
appraisal out across many agents in a team-enabled Claude Code session — each
reads a small batch of *related* docs and returns evidence-backed verdicts
(KEEP / UPDATE / MERGE / DEPRECATE / ARCHIVE / DELETE); agents appraise, they
never edit. Execution is the separate, gated `apply-actions.ts` step. Full
pipeline (`plan-review-batches.ts` → wave-runner → `aggregate-results.ts`),
prerequisites, and schemas: **`references/procedure-h-deep-dive.md`**. Read it
before running a deep-dive.

---

## Reference material (read as needed)

- `references/principles.md` — full rules for all five competencies and the named
  frameworks (Diátaxis, Dublin Core, DITA, MECE, ADR, records lifecycle).
- `references/frontmatter-schema.md` — required/optional frontmatter fields, the
  `status` lifecycle, and controlled-vocabulary rules.
- `references/procedure-h-deep-dive.md` — the full multi-agent appraisal pipeline
  (Procedure H): batch planning, wave-running, aggregation, and schemas.
- `references/example-target-structure.md` — a worked reorganization target for a
  fictitious "Acme" repo. Illustrative only; produce the equivalent for the repo at hand.
- `scripts/` — the executable kit: `analyze-docs.py` (optional NLP layer →
  `nlp-analysis.json`), `triage-docs.ts` (E), `suggest-tags.ts` (G),
  `plan-review-batches.ts` / `aggregate-results.ts` (H), `apply-actions.ts` (E/B
  execution, dry-run by default), `lint-docs.ts` (F governance gate), and
  `setup.sh` (`/doc-librarian setup`). Per-script detail and flags are in the README.
- `hooks/docs_structure_guard.py` — the `PostToolUse(Write)` guard that nudges the
  authoring agent through Procedure C. Reuses `lint-docs.ts --file`.
- `templates/` — starting templates for each doc type.

## Output style

Be concise and evidence-driven. Lead audits with counts, not adjectives.
Present migration plans for approval before moving files. When you change the
tree, report what moved, what indexes updated, and confirm links still resolve.
