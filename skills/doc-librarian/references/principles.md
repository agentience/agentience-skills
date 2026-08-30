# Librarian principles — full reference

Detailed rules behind the five competencies in `SKILL.md`. Cite the frameworks
by name when explaining recommendations to users.

## 1. Taxonomy & classification

**Enumerative vs. faceted.** Enumerative/hierarchical classification (Dewey, LCC)
gives each item exactly one place in a fixed tree — this is your **folder
structure**. Faceted classification (Ranganathan) decomposes a subject into
independent dimensions that combine freely — this is your **tag/frontmatter
system**. Core rule: **folders carry the ONE primary axis; every secondary axis
is a frontmatter facet/tag.**

**MECE** (Mutually Exclusive, Collectively Exhaustive). At any one level, sibling
categories must not overlap and must cover the space. Overlapping siblings are
the #1 cause of "where does this go?" and of duplication. A large `misc/` folder
is a smell that the axis is wrong.

**5–7 rule (Miller's Law, 7±2).** Keep any single level to ~5–7 siblings, hard
ceiling ~9. Over it: add an intermediate level or reconsider the axis. It's a
guide against sprawl, not a mandate to split.

**Depth ≤4.** Keep the tree shallow (2–4 levels under `docs/`). If a leaf is >3
clicks from root, it's too deep. Prefer flat + good facets over deep.

**Primary-axis choice.**
- *Topic-based* (subject/feature/domain) — best default; maps to system components.
- *Audience-based* (end-user / developer / operator) — when the same topics need
  radically different treatment per reader.
- *Lifecycle-based* (onboard → build → deploy → operate) — for workflow order.
- Failure mode: mixing axes at one level (`{developers, deployment, api-reference}`).

**Controlled vocabulary.** A curated list of allowed tags (preferred term +
synonyms) is what makes a governed *taxonomy* instead of an ungoverned
*folksonomy* ("auth"/"authn"/"login" chaos). Keep it in `TAGS.md`; lint against it.

## 2. Information architecture — Diátaxis (https://diataxis.fr/)

Four modes on two axes (practical/theoretical × study/work):

- **Tutorial** — learning-oriented; serves the newcomer; a lesson. Goal is a
  successful *first experience*, not a real task.
- **How-to guide** — task-oriented; serves a competent user with a goal; a recipe.
  Assumes competence; drives at a concrete result.
- **Reference** — information-oriented; serves the fact-seeker; an encyclopedia
  entry. Describes the machinery; NO instruction, NO opinion.
- **Explanation** — understanding-oriented; the reflective reader; an essay. The
  ONLY home for "why," rationale, alternatives, background.

**Each doc is exactly one type.** Mixing types on a page is the chief anti-pattern
— it makes docs bad for beginners and experts at once. Use Diátaxis as a quality
lens: "which of the four is this?" → split if more than one.

**DITA** (OASIS) reaches the same via Concept/Task/Reference topic types.
Portable ideas: topic-based authoring (one self-contained idea per file),
information typing (label the type, keep it pure), single-sourcing (write once,
reuse many).

**Supporting concepts.**
- *Every page is page one* (Baker): readers land anywhere from search. Each page
  states its own context and offers on-ramps/off-ramps.
- *Progressive disclosure* (NN/g): common case first; defer rare detail behind a
  link or collapsible section.
- *Information scent* (Pirolli & Card): descriptive link text/headings so readers
  predict a click's value. Never "here"/"Overview".
- *Findability ≠ organization*: invest in hierarchy (browsers) AND metadata +
  search (searchers).

## 3. Metadata & cataloging

**Dublin Core** — 15 elements (ISO 15836): Title, Creator, Subject, Description,
Publisher, Contributor, Date, Type, Format, Identifier, Source, Language,
Relation, Coverage, Rights. Map the useful ones to frontmatter (see
`frontmatter-schema.md`).

**MARC insight:** the catalog record is separate from the resource and is what
enables retrieval, dedup, and management at scale. Frontmatter IS the catalog
record. *Authority control* (one canonical form per name/subject) = controlled
vocabulary.

**Taxonomy vs. folksonomy:** hybrid is best — folders = governed primary axis;
tags = faceted access but governed by the controlled vocabulary.

## 4. Findability & indexing

- **README-as-index:** every folder's `README.md` is its local catalog (purpose +
  linked child list). No folder without one. Root README = master hub.
- **Hub-and-spoke:** hubs link to spokes; spokes link back + laterally.
- **Cross-references:** relative links (survive moves), descriptive text,
  bidirectional where useful, link-checked in CI (fastest-decaying part of docs).
- **Search:** full-text (primary path) + faceted over frontmatter fields;
  breadcrumbs for search-landers.

## 5. Lifecycle & curation (records management)

Lifecycle: Create → Use → Retain → Archive → Dispose, expressed as `status`:
draft → active → deprecated → archived → (disposed).

- **Retention schedule:** how long each doc type is kept before archive/disposal;
  enforce via `review_by`.
- **Staleness signals (highest ROI):** `updated` date + `review_by` on every doc;
  CI staleness report; surface "Last reviewed" to readers.
- **Deprecate before deleting:** status + banner + successor link, then archive,
  then dispose. Keep `docs/archive/` shallow.
- **Deduplication:** single source of truth; replace dupes with links;
  single-source shared snippets.
- **Docs-as-code:** docs in git beside code; require doc updates in the same PR;
  manage *documentation debt* like technical debt.

## 6. Governance & authoring

- **Style guide:** adopt Google or Microsoft's; record only deltas; enforce with
  Vale + markdownlint.
- **Templates per doc type:** required frontmatter pre-filled + section skeleton.
- **DRY / single-sourcing:** one authoritative home per fact; include/transclude
  shared content.
- **DRI ownership:** exactly one owner per doc/folder (`owner` + `CODEOWNERS`).
- **Naming:** kebab-case; ISO `YYYY-MM-DD-` date prefixes; `NN-` sequence
  prefixes; README for indexes.
- **ADRs** (Nygard): `docs/decisions/`, numbered, immutable; Status / Context /
  Decision (active voice, "We will…") / Consequences; supersede rather than edit.

## Key sources

Diátaxis https://diataxis.fr/ · Dublin Core https://www.dublincore.org/specifications/dublin-core/dcmi-terms/ ·
DITA https://docs.oasis-open.org/dita/v1.0/archspec/topicover.html ·
ADR https://adr.github.io/ , https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions ·
Docs-as-code https://www.writethedocs.org/guide/docs-as-code/ ·
Progressive disclosure https://www.nngroup.com/articles/progressive-disclosure/ ·
Miller's Law https://lawsofux.com/millers-law/ ·
DRI https://handbook.gitlab.com/handbook/people-group/directly-responsible-individuals/
