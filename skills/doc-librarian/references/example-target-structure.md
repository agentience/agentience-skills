# Example docs/ — worked reorganization target

A worked example of the taxonomy rules applied end-to-end to one (fictitious)
repo — "Acme", a mid-size AWS/TypeScript app mid-migration. Nothing here is a
mandate; it exists to show what a finished mapping looks like, so the same shape
can be produced for a real repo and refined with its team.

## Current state (example audit summary)

- ~1,174 markdown + ~1,205 generated HTML files.
- **50 top-level directories + 25 loose root files** (target: ≤7 top-level).
- Redundant axes: `learnings/` + `acme-app/learnings/` + `tribal-knowledge/`;
  `migration/` + `acme-app/migration/`; `analysis/` + `research/` + `discovery/`;
  `features/` + `feature-requests/` + loose `feature-*.md`; the whole `acme-app/`
  subtree duplicates root categories.
- **44% of directories have no index**; root README lists 26 of 50+ dirs and is
  stale (2025-10-23).
- **0.5% of files use YAML frontmatter**; `**Last Updated**` bold line elsewhere.
- Depth to 11 levels (`archive/workflow-docs/…`); `planning/` has ~44 subdirs of
  mostly completed work; `project-management/` has 69 flat files.

## Proposed target (primary axis: Diátaxis doc-type + a few pragmatic buckets)

```
docs/
  README.md            # master catalog/hub (regenerate last)
  TAGS.md              # controlled vocabulary
  templates/           # per-doc-type templates (already exists — extend)

  tutorials/           # learning-oriented onboarding paths
  how-to/              # task guides: deployment/, devops/, testing/, migration/
  reference/           # facts: api/ (generated), data/, standards/, scripts/, errors/
  explanation/         # architecture/, patterns/, research/, analysis/, discovery/
  decisions/           # ADRs — numbered, immutable (seed from architecture/decisions/)

  project/             # non-technical: pm/, retrospectives/, sprint-reviews/,
                       #   velocity-tracking/, meetings/, reviews/
  archive/             # deprecated & completed work, dated, shallow
```

Secondary axes become **tags**, not folders: app area (`acme-app`, `backend`,
`frontend`), feature (`typesense`, `email`, `technician`, `trip`), and lifecycle
(`migration`, `planning`) all move to `tags:`/`status:` rather than directories.

## Mapping (representative — extend during migration)

| Current | Target | Notes |
|---------|--------|-------|
| `guides/`, `deployment/`, `devops/`, `development/` | `how-to/` | task-oriented |
| `testing/` (guides) / `testing/` (specs) | `how-to/testing/` + `reference/testing/` | split by type |
| `api/` (TypeDoc HTML), `data/`, `standards/`, `scripts/`, `errors/` | `reference/` | facts |
| `architecture/`, `patterns/`, `research/`, `analysis/`, `discovery/`, `dynamoose-investigation/` | `explanation/` | consolidate investigation dirs; tag by topic |
| `architecture/decisions/` | `decisions/` | promote to top-level ADR home |
| `learnings/`, `acme-app/learnings/`, `tribal-knowledge/` | `explanation/learnings/` | single home; tag `acme-app` |
| `migration/`, `acme-app/migration/`, `jest-30-migration.md`, `weasyprint-layer-migration.md` | `how-to/migration/` (active) + `archive/` (done) | tag `migration`; archive completed |
| `planning/` (~44 subdirs), `implementation/`, `proposed-*.md`, `implementation-plan.md` | `archive/` if done, else `explanation/` or `decisions/` | most are completed projects |
| `features/`, `feature-requests/`, `feature-*.md` | `reference/features/` or `explanation/features/` | consolidate; one home |
| `pdf-*.md`, `generateProposalPDF-flow.md` | `explanation/` or `reference/` (pdf topic) | tag `pdf` |
| `technician-*.md`, `trip-management.md` | `reference/features/` | tag `technician`/`trip` |
| `ui-inventory/`, `legacy_ui_inventory/`, `screenshots/`, `ux-style-guide/` | `reference/ui/` + `archive/legacy-ui/` | remove `.agentics/` artifacts |
| `project-management/`, `retrospectives/`, `sprint-reviews/`, `velocity-tracking/`, `meetings/`, `reviews/` | `project/` | split PM's 69 flat files into subfolders |
| `ai_docs/`, `internal/`, `housekeeping/`, `samples/`, `requirements/`, `user-stories/` | fold into `reference/`, `explanation/`, or `project/` | evaluate case-by-case |
| `.madness.yml`, `docker-compose.yml` | project root or `devops` config | not docs content |
| `ux-style-guide/.agentics/` | delete + `.gitignore` | session artifacts |

## Sequencing (per Procedure B)

1. Create `tutorials/how-to/reference/explanation/decisions/project/` with README
   stubs; add `TAGS.md`; extend `templates/`.
2. Migrate safest dirs first (small, few inbound links): `errors/`, `patterns/`,
   `scripts/`, `discovery/`.
3. Consolidate the redundant clusters (learnings, migration, investigation) one
   at a time, fixing links each batch.
4. Sweep `planning/` and `implementation/`: archive completed work.
5. Convert `**Last Updated**` lines to frontmatter as you touch files.
6. Regenerate root README as the master catalog last.

Keep every batch link-clean before starting the next. Nothing is deleted; git
history is preserved via `git mv`.
