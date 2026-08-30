# Librarian Competencies for Documentation Management — Research Report

**Prepared for:** the `doc-librarian` skill — expert document management
**Date:** 2026-07-02
**Scope:** Taxonomy & structure, indexing & findability, lifecycle & curation, authoring standards
**Purpose:** Establish the information-science foundation for a reusable "document management" skill, and ground it in a worked audit of an example `docs/` directory.

---

## Executive summary

Professional librarianship is not "tidying files." It is a set of disciplines — classification, cataloging, information architecture, records management, and collection curation — developed over a century to keep large bodies of information *findable, trustworthy, and maintainable at scale*. A software `docs/` directory with 1,000+ files is a library, and it decays the same way an ungoverned library does: sprawl, duplication, orphaned items, stale shelves, and no catalog.

This report translates six librarian competency areas into concrete, CI-enforceable rules, then applies them to a worked example: the `docs/` directory of "Acme", a fictitious mid-size AWS/TypeScript app part-way through a migration. The audit found a collection under real strain: **50 top-level directories** (should be ≤7), **25 loose files at the root**, **44% of directories with no index**, **only 0.5% of files carrying structured metadata**, nesting up to **11 levels deep**, and multiple **redundant taxonomies** (`learnings` in three places, `migration` in two, `analysis`/`research`/`discovery` overlapping). None of this is unusual for a fast-moving migration project — it is exactly the condition a librarian discipline exists to correct.

The companion `SKILL.md` operationalizes everything below.

---

## Part 1 — The six competency areas

### 1. Taxonomy & classification

The foundational insight from library science is the distinction between **enumerative/hierarchical** classification (Dewey Decimal, Library of Congress) and **faceted** classification (Ranganathan's Colon Classification).

An enumerative system gives every item exactly one place in a fixed tree — this is your **folder structure**. A faceted system decomposes a subject into independent dimensions (audience × topic × doc-type × lifecycle stage) that combine freely — this is your **tag/frontmatter system**. The central rule follows directly: **use the folder hierarchy for the single primary axis, and frontmatter facets for every secondary axis.** Trying to encode audience *and* topic *and* lifecycle in the folder path is the root cause of "where does this go?" paralysis and the duplication that follows.

Three principles govern a healthy hierarchy:

**MECE (Mutually Exclusive, Collectively Exhaustive).** At any single level, sibling categories must not overlap (a reader should never be unsure which of two folders a doc belongs in) and must cover the space (or you need a deliberate catch-all — though a large `misc/` folder is a smell that the axis itself is wrong). Overlapping siblings are the number-one driver of duplication.

**The 5–7 rule (Miller's Law, "7 ± 2").** Working memory holds about seven items. Applied to navigation: keep any single level to roughly 5–7 sibling categories, hard ceiling around nine. Exceed it and you either group into an intermediate level or reconsider the axis. This is a guide against sprawl, not a law to force artificial splits.

**Shallow depth.** Keep the tree to 2–4 levels under `docs/`. Deep nesting hides content, produces fragile paths, and adds "which folder was that in?" friction. If a reader needs more than three clicks from the docs root to reach a leaf, the tree is too deep. Prefer a flatter tree with good facets over a deep one.

Choosing the primary axis is a real decision. **Topic-based** (by subject/feature/domain) is the best default when content maps cleanly to system components. **Audience-based** (end-user / developer / operator) fits when the same topics need radically different treatment per reader. **Lifecycle-based** (onboarding → build → deploy → operate) fits a workflow with natural temporal order. The failure mode is mixing axes at one level — `{developers, deployment, api-reference}` mixes audience, lifecycle, and doc-type, and no one can predict where a new doc lands.

Finally, a **controlled vocabulary** — a curated list of allowed tags, each with a preferred term and mapped synonyms — is what separates a governed *taxonomy* from an ungoverned *folksonomy* where "auth," "authn," and "login" all coexist. Maintain it in a `TAGS.md` and lint frontmatter tags against it.

### 2. Information architecture for docs

The dominant IA model for technical documentation is **Diátaxis** (Daniele Procida; adopted by Django, Canonical/Ubuntu, Cloudflare, Gatsby). It sorts all documentation into four modes on two axes — practical vs. theoretical knowledge, and study vs. work:

| Mode | Orientation | Serves | Analogy |
|------|-------------|--------|---------|
| **Tutorial** | Learning | The newcomer | A lesson |
| **How-to guide** | Task | The competent user with a goal | A recipe |
| **Reference** | Information | The user needing facts | An encyclopedia entry |
| **Explanation** | Understanding | The reflective reader | An essay |

The rules that are easy to get wrong: a tutorial teaches a safe first experience and is *not* a how-to (which assumes competence and drives at a real goal); reference *describes the machinery* and contains no instruction or opinion; explanation is the *only* home for "why," rationale, and alternatives. **Each document should be exactly one of the four.** Mixing types on one page is the framework's chief anti-pattern — it is what makes docs simultaneously bad for beginners and experts. Diátaxis is as much a quality lens as a folder layout: for any page, ask "which of the four is this?" and split if the answer is "more than one."

**DITA** (the OASIS topic-based standard) reaches the same place from authoring: its Concept / Task / Reference topic types map onto Explanation / How-to / Reference. Its portable ideas for markdown are *topic-based authoring* (each file is one self-contained idea), *information typing* (label the type in frontmatter, keep the file pure), and *single-sourcing* (write once, reuse many places).

Three supporting IA concepts:

**"Every page is page one"** (Mark Baker). Readers arrive on any page directly from search, not through your front door and not in your intended order. So every page must establish its own context (topic, prerequisites, where it sits) and provide on-ramps and off-ramps (links to prerequisites and next steps). Avoid "continued from…" sequencing that only works linearly.

**Progressive disclosure** (Nielsen Norman Group). Show the common case first; defer advanced or rare detail behind a link or a collapsible section. Lead with the 80% path; push edge cases to "advanced" pages.

**Information scent** (Pirolli & Card's information-foraging theory). The cues — link text, headings, labels — that let readers predict the value of a click before making it. Strengthen scent with descriptive, specific link text and headings; never "click here" or a bare "Overview." And remember that **findability is not the same as organization**: a perfectly organized tree no one can search is not findable, while a flat pile with great search and metadata can be. Invest in hierarchy (for browsers) *and* metadata + search (for searchers), because you do not control how readers arrive.

### 3. Metadata & cataloging

The library baseline is **Dublin Core** — 15 core elements (Title, Creator, Subject, Description, Publisher, Contributor, Date, Type, Format, Identifier, Source, Language, Relation, Coverage, Rights) standardized as ISO 15836. The useful ones map cleanly to markdown frontmatter: Title→`title`, Creator→`owner`, Subject→`tags`, Description→`description`, Date→`created`/`updated`, Type→`doc_type`, Relation→`related`/`supersedes`.

From **MARC** cataloging comes a structural insight: a catalog record is *separate from the resource* and is what enables retrieval, deduplication, and management at scale. Your frontmatter *is* the catalog record. MARC's *authority control* (one canonical form per name/subject) is your controlled vocabulary.

The practical output is a **Minimum Viable Metadata** set required on every doc and linted in CI:

```yaml
---
title: "Deploying to Staging"        # required
doc_type: how-to                     # required: tutorial|how-to|reference|explanation
status: active                       # required: draft|active|deprecated|archived
owner: "@team-platform"              # required: the DRI
updated: 2026-06-19                  # required: last substantive review/edit
tags: [deployment, ci-cd, staging]   # required: controlled vocabulary only
created: 2025-03-01                  # recommended
review_by: 2026-12-19                # recommended: freshness deadline
related: [../reference/env-config.md] # optional
supersedes: null                     # optional
---
```

Frontmatter must be the very first thing in the file, delimited by `---`, valid YAML (spaces, never tabs). The `title`/`updated`/`description` trio is a safe cross-tool baseline (Jekyll, Hugo, Docusaurus, Astro, MkDocs all read it).

On tagging: **taxonomy** (governed, hierarchical) and **folksonomy** (organic, flat, user-generated) each have failure modes — rigidity vs. synonym chaos. The best practice is hybrid: folders provide the governed primary axis; tags provide faceted access but are themselves governed by the controlled vocabulary. Tags let one doc appear under many logical groupings without duplicating the file.

### 4. Findability & indexing

**README-as-index.** Every folder gets a `README.md` that GitHub/GitLab render as its landing page. This file is the local catalog: it states the folder's purpose (its MECE scope), lists and links its children with one-line descriptions, and gives "you are here" context. The rule is simple — *no folder without a README index* — and the root `docs/README.md` is the master hub.

**Hub-and-spoke navigation.** Hubs (curated index pages) link to spokes (content pages); spokes link back to their hub and laterally to siblings. This supports both top-down browsing and the lateral movement that "every page is page one" requires. Hubs should be hand-curated for scent, not auto-generated dumps.

**Cross-referencing.** Use relative links (`../reference/foo.md`) so they survive moves; use descriptive link text; link bidirectionally where it matters (a how-to links to the reference it uses, and back). Run a **link checker in CI** — cross-references are the fastest-decaying part of any doc set.

**Search — full-text and faceted.** Full-text (ripgrep locally; Algolia/Lunr/Pagefind for sites) is the primary retrieval path since most readers arrive by searching. Faceted filtering over frontmatter (`doc_type`, `tags`, `status`, `owner`) is the payoff for investing in metadata: "active reference docs tagged deployment." Support both, plus breadcrumbs so search-landers recover their location.

### 5. Lifecycle & curation

**Records management** gives the lifecycle: Create → Use → Retain → Archive → Dispose. Translated to a document `status` field:

| Stage | `status` | Meaning | Action |
|-------|----------|---------|--------|
| Create | `draft` | In progress, not authoritative | Marked WIP / excluded from published site |
| Use | `active` | Current, authoritative | Subject to review schedule |
| Retain | `deprecated` | Superseded but kept | Banner to replacement; out of default search |
| Archive | `archived` | Historical value only | Moved to `docs/archive/`, dated, read-only |
| Dispose | (deleted) | No value, retention met | Removed (git preserves history) |

**Retention schedule.** Predefine how long each doc type is kept before archive/disposal: release notes indefinitely (archived per version), meeting notes archived after a year, abandoned draft RFCs disposed after six months. Enforce via the `review_by` field.

**Staleness signals** are the single highest-ROI curation practice. Every doc carries a "last reviewed" (`updated`) date and a `review_by` deadline. A CI **staleness report** flags any `active` doc past its deadline or older than N months. Surfacing "Last reviewed: 2026-06-19" to readers is both a trust signal and a way to make rot visible. Undated docs are unmanageable — date everything.

**Deprecate before deleting.** Never silently remove a referenced doc: set `deprecated` with a banner and a link to its successor, then archive, then dispose. Keep a `docs/archive/` so active navigation stays clean while history is preserved.

**Deduplication.** Duplicate and near-duplicate docs are the chief cause of "which one is right?" and version skew. Collapse to a single source of truth and replace duplicates with links. MECE folders plus single-sourcing prevent duplication at the source.

**Docs-as-code** puts docs in git beside the code they describe: plain-text diffs, blame/history as a free audit trail, and — crucially — the ability to *require doc updates in the same PR as the code change*, which is what actually keeps docs accurate. The accumulating cost of missing, stale, duplicated, or wrong docs is **documentation debt**; manage it like technical debt — track it, budget time to pay it down, prevent accrual with the same-PR rule and staleness reports.

### 6. Governance & authoring standards

**Adopt, don't invent, a style guide** (Google Developer Documentation Style Guide or Microsoft Writing Style Guide) and record only your deltas. Enforce mechanically with Vale (prose) and markdownlint (structure) — unenforced style rules are decoration.

**Templates per doc type** (`templates/how-to.md`, `templates/reference.md`, `templates/adr.md`) with required frontmatter pre-filled and the expected section skeleton. This operationalizes Diátaxis typing — authors start from the correct shape.

**Single-sourcing / DRY.** Each fact has one authoritative home. Don't copy shared content (install steps, config tables) across pages; factor it into one snippet and include/transclude it. This kills the deduplication problem at the source.

**Ownership via DRI** (Directly Responsible Individual — Apple's term, formalized in the GitLab Handbook). Every doc and folder has exactly one accountable person or team, recorded in the `owner` field and/or `CODEOWNERS`. A DRI makes review deadlines someone's job and removes "who owns this?" ambiguity.

**Naming conventions**, all mechanically enforceable: `kebab-case` filenames (lowercase, hyphens, URL-safe); descriptive noun/verb phrases that read well in a bare listing; ISO-8601 `YYYY-MM-DD-topic.md` date prefixes for time-series content; numeric `01-`, `02-` prefixes for ordered sequences; `README.md` reserved for folder indexes.

**ADRs (Architecture Decision Records).** Popularized by Michael Nygard, endorsed by Martin Fowler. A short (1–2 page) record of one significant decision with four sections — Status, Context, Decision (full sentences, active voice: "We will…"), Consequences (positive and negative). Governance: stored in-repo (`docs/decisions/`), one decision per file, numbered sequentially and never reused, **immutable once accepted** — if the decision changes you write a *new* ADR that supersedes the old one and mark the old `superseded by ADR-00XX`. ADRs are the whole discipline in miniature: controlled type + template + immutable-with-supersession lifecycle + numeric naming + owner/date metadata.

---

## Part 2 — Worked audit: the "Acme" `docs/` directory

Applying the principles above to an example collection (~1,174 markdown + ~1,205 generated HTML files). "Acme" is a fictitious stand-in — a mid-size AWS/TypeScript app mid-migration — used throughout to show what an audit produces and how the findings translate into a target structure.

### What's healthy

Generated and authored content are cleanly separated — the ~1,205 TypeDoc HTML files live under `api/` and aren't interleaved with hand-written markdown. There's already a lightweight metadata habit (a `**Last Updated: YYYY-MM-DD**` line appears in ~1,180 files), a documented archive convention with a README, and a real `templates/` folder. These are strong foundations to build on.

### The problems, with evidence

**Top-level sprawl (critical).** 50 top-level directories plus 25 loose markdown files — roughly seven times the ~7-category ceiling. No reader can hold this in their head or predict where a new doc goes.

**Redundant taxonomies (critical).** The same axis appears in multiple places: learnings live in `learnings/`, `acme-app/learnings/`, and `tribal-knowledge/`; migration in `migration/` and `acme-app/migration/`; investigation-type content is split across `analysis/`, `research/`, and `discovery/`; features across `features/`, `feature-requests/`, and loose `feature-*.md` files at root; the `acme-app/` subtree duplicates root categories (`architecture`, `deployment`, `development`, `migration`). These overlaps violate MECE and are actively generating duplication.

**Loose root files (high).** 25 markdown files sit at `docs/` root (`feature-21-*.md`, `pdf-generator-*.md`, `technician-*.md`, `trip-management.md`, `proposed-*.md`, etc.), each of which has an obvious home in an existing subdirectory.

**Indexing gaps (high).** 22 of 50 directories (44%) have no `README.md` or `index.md`, including sizeable ones (`migration`, `patterns`, `guides`, `implementation`, `infrastructure`, `retrospectives`). The root `README.md` lists only 26 directories against 50+ actual, still shows "planned" sections that were never built, and was last updated 2025-10-23 — the catalog no longer matches the collection.

**Almost no structured metadata (medium).** Only 6 of 1,174 files (0.5%) use YAML frontmatter. The `**Last Updated**` convention is good intent but unstructured — no `status`, no `owner`, no `doc_type`, no `tags`, and inconsistent date formats — so none of it is machine-queryable for staleness or faceted retrieval.

**Staleness with no lifecycle (medium/high).** A large cohort (~165 files) was last touched in May 2025 and never revisited; there is no `deprecated`/`archived` status mechanism, so stale and current docs are indistinguishable in navigation.

**Excessive depth and lingering projects (medium).** `planning/` holds ~44 subdirectories, many of them apparently completed projects left in place rather than archived; `archive/workflow-docs/` nests up to 11 levels (archive-within-archive). Meanwhile `project-management/` is the opposite failure — 69 files flat in one folder.

**Naming inconsistency (medium).** Mixed conventions: `kebab-case` (most files), `SCREAMING_CASE` (`API_DOCUMENTATION.md`), `camelCase` (`generateProposalPDF-flow.md`), and underscores (`legacy_ui_inventory` vs. hyphenated `ui-inventory`); inconsistent pluralization (`features` vs. `feature-requests`, `guides` vs. `user-guides`).

**Hygiene (low).** `.agentics/` session artifacts sit inside `ux-style-guide/`; `.madness.yml` and `docker-compose.yml` live in `docs/` rather than project root.

### Recommended target structure

Collapse ~50 top-level directories toward a MECE set organized on a **primary topic/lifecycle axis**, for example:

```
docs/
  README.md                 # master hub — the catalog
  TAGS.md                   # controlled vocabulary
  tutorials/                # Diátaxis: learning-oriented
  how-to/                   # Diátaxis: task-oriented (guides, deployment, devops)
  reference/                # Diátaxis: information (api/, data/, standards, scripts)
  explanation/              # Diátaxis: understanding (architecture, patterns, research)
  decisions/                # ADRs — numbered, immutable
  project/                  # PM, retrospectives, sprint/velocity, meetings
  archive/                  # deprecated/superseded, dated
  templates/                # per-doc-type templates
```

Everything currently split by audience or app (`acme-app/*`) or lifecycle (`planning/`, `implementation/`, `migration/`) collapses into these buckets, with the secondary axes (app area, feature, status) expressed as **frontmatter tags** rather than folders. Completed `planning/` projects move to `archive/`. This is a migration to sequence carefully — the skill treats it as staged, non-destructive work (deprecate-then-move, preserve git history, fix links in CI), never a big-bang reshuffle.

---

## Sources

- Diátaxis framework — https://diataxis.fr/ (and https://diataxis.fr/start-here/)
- Dublin Core / DCMI Terms — https://www.dublincore.org/specifications/dublin-core/dcmi-terms/ ; ISO 15836-1:2017 — https://www.iso.org/standard/71339.html
- DITA (OASIS) topic types — https://docs.oasis-open.org/dita/v1.0/archspec/topicover.html
- Architecture Decision Records — https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions ; https://adr.github.io/ ; https://martinfowler.com/bliki/ArchitectureDecisionRecord.html
- Docs-as-code — https://www.writethedocs.org/guide/docs-as-code/ ; https://konghq.com/blog/learning-center/what-is-docs-as-code
- Progressive disclosure (NN/g) — https://www.nngroup.com/articles/progressive-disclosure/
- Miller's Law / 7±2 — https://lawsofux.com/millers-law/ ; https://en.wikipedia.org/wiki/The_Magical_Number_Seven,_Plus_or_Minus_Two
- Faceted vs. enumerative classification — https://en.wikipedia.org/wiki/Faceted_classification
- DRI ownership model — https://handbook.gitlab.com/handbook/people-group/directly-responsible-individuals/
- Records life-cycle — https://en.wikipedia.org/wiki/Records_life-cycle
