# Controlled Vocabulary (TAGS.md)

The authoritative list of allowed frontmatter tags. Frontmatter `tags:` must use
**preferred terms only**. If a needed tag is missing, add a row here — with a
definition — before using it. Never invent a tag inline.

## This starter is deliberately domain-free

The rows below name only what a document *is* — its kind and its lifecycle —
because that axis is the same in every repository. **They are not enough on their
own.** The tags that make a corpus findable name its *subsystems*, and nobody can
guess those for you.

Run **Procedure G** to derive them from the corpus you actually have:

```bash
uv run <skill>/scripts/analyze-docs.py --out nlp-analysis.json          # optional, better ranking
<skill>/scripts/suggest-tags.ts --nlp nlp-analysis.json --out docs/TAGS.draft.md
```

then curate the draft down to roughly 20–40 terms and fold them in below. Expect
the raw candidates to be mostly folder names and heading noise — curation is the
work, not the script.

A worked example of a fuller vocabulary, for a fictitious AWS/TypeScript app,
is in `references/example-target-structure.md`. It is an illustration of shape,
not a list to copy.

## Kind — what the document is

| Tag | Definition | Use instead of |
|-----|------------|----------------|
| `architecture` | System design and structure, and the reasoning behind it | arch, design |
| `standards` | Binding conventions the project enforces | conventions, rules |
| `adr` | An Architecture Decision Record | decision-record |
| `onboarding` | Material for someone meeting the system for the first time | getting-started |
| `investigation` | A dated inquiry into a specific defect or question | report, analysis |
| `experiment` | A measured trial with a stated hypothesis and result | trial, benchmark |
| `retrospective` | A point-in-time account of what happened | retro, postmortem |
| `runbook` | Steps to operate or recover something in production | operations, oncall |

## Concern — what it is about, in any codebase

| Tag | Definition | Use instead of |
|-----|------------|----------------|
| `testing` | Test patterns, mocking, coverage, test infrastructure | tests, qa |
| `ci-cd` | Build, test and deploy automation | pipeline, actions |
| `deployment` | Shipping to an environment | deploy, release, ship |
| `security` | Authentication, authorization, secrets, threat modelling | authn, authz, appsec |
| `performance` | Latency, throughput, cost and resource use | perf, optimization |
| `migration` | Moving from one architecture, API or version to another | port, upgrade |
| `tooling` | Developer tooling and local workflow | devtools, dx |

## Subsystem — derive these yourself (Procedure G)

_Empty on purpose. Add one row per major component of your system._

| Tag | Definition | Use instead of |
|-----|------------|----------------|
