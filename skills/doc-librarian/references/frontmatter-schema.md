# Frontmatter schema & controlled vocabulary

The frontmatter block is the doc's **catalog record**. It must be the very first
thing in the file, delimited by `---`, and valid YAML (spaces, never tabs).

## Required fields (lint these; fail CI on missing)

```yaml
---
title: "Deploying to Staging"          # human-readable name (Dublin Core: Title)
doc_type: how-to                       # tutorial | how-to | reference | explanation
status: active                         # draft | active | deprecated | archived
owner: "@team-platform"                # the DRI — one person or team
updated: 2026-06-19                    # last substantive review/edit (ISO 8601)
tags: [deployment, ci-cd, staging]     # from TAGS.md controlled vocabulary ONLY
---
```

## Recommended / optional fields

```yaml
created: 2025-03-01                     # first authored
review_by: 2026-12-19                   # freshness deadline (drives staleness report)
related: [../reference/env-config.md]   # Dublin Core: Relation
supersedes: null                        # path/ID of the doc this replaces
superseded_by: null                     # set when this doc is deprecated
summary: "One-line description for indexes and search."
```

## `doc_type` values (Diátaxis)

| Value | For | Contains | Never contains |
|-------|-----|----------|----------------|
| `tutorial` | Newcomers learning | A guided lesson to a safe first result | Real-world task focus, exhaustive options |
| `how-to` | Competent users with a goal | Ordered steps to an outcome | Teaching, background theory |
| `reference` | Fact-seekers | Structured facts mirroring the code/product | Instruction, opinion, tutorials |
| `explanation` | Reflective readers | Why, rationale, alternatives, context | Step-by-step procedures |

If a doc needs two of these, split it.

## `status` lifecycle

| `status` | Meaning | Navigation | Action to advance |
|----------|---------|------------|-------------------|
| `draft` | WIP, not authoritative | Hidden / marked WIP | Promote to `active` on review |
| `active` | Current, authoritative | Normal | Refresh, or deprecate when superseded |
| `deprecated` | Superseded but kept | Banner + successor link; out of default search | Archive after grace period |
| `archived` | Historical only | In `docs/archive/`, dated | Dispose after retention lapses (with confirmation) |

Deprecation banner to insert at the top of a deprecated doc:

```markdown
> **⚠️ Deprecated.** This document is superseded by
> [<new doc title>](../path/to/replacement.md) as of <YYYY-MM-DD>. Kept for
> historical reference; do not rely on it for current behavior.
```

## Controlled vocabulary (`TAGS.md`)

Tags are governed, not free-form. `TAGS.md` lists every allowed tag with a
definition and its non-preferred synonyms (which map to the preferred term).
Frontmatter tags are linted against this list.

Starter `TAGS.md` row format:

```markdown
| Tag | Definition | Use instead of |
|-----|------------|----------------|
| `authentication` | Cognito, login, identity, sessions | auth, authn, login |
| `deployment` | Shipping to an environment | deploy, release, ship |
| `dynamodb` | DynamoDB single-table design, Dynamoose | ddb, dynamo |
```

Rule: if a needed tag isn't in `TAGS.md`, add it there (with a definition) before
using it. Never invent tags inline.

## Migrating the existing `**Last Updated: …**` convention

Many repos already carry a bold `**Last Updated: YYYY-MM-DD**` line. When
touching a file, convert that into structured `updated:` frontmatter (keep the
date), and backfill the other required fields. This can be scripted for a batch:
parse the date from the bold line, infer `doc_type` from the folder, default
`status: active`, set `owner` from `CODEOWNERS` or git blame.
