# START HERE — bootstrap `doc-librarian` into this repository

**Last Updated: 2026-08-29 21:31**

**You are an AI coding agent and someone has pointed you at this file.** It is
self-contained and written for you, not for a person. Read it to the end before
running anything: the last section is the one that keeps you from doing damage.

Your job is to install a documentation-librarian skill and then use it to
organize the `docs/` directory of the repository you are currently working in.

> **This file is not instructions for reorganizing `agentience-skills` itself.**
> If the repository you are sitting in *is* `agentience-skills`, stop and say so.
> You were almost certainly pointed here from somewhere else and are in the wrong
> working directory.

## What you are installing

`doc-librarian` is a Claude Code skill that applies library science to a `docs/`
tree — taxonomy, [Diátaxis](https://diataxis.fr/) classification, YAML
cataloging, README indexes, and an archive lifecycle. It ships scripts that
measure rather than guess: staleness from git history, orphans from repo-wide
referrer counting, near-duplicates from TF-IDF cosine similarity.

Source: <https://github.com/agentience/agentience-skills/tree/main/skills/doc-librarian>

## Step 1 — check the prerequisites

```bash
git rev-parse --show-toplevel     # you must be inside a git repository
node --version                    # need v22+, or npx tsx available
command -v uv || command -v python3 || echo "no NLP layer (optional)"
```

**git and Node 22+ are load-bearing.** Without git there is no history, no
staleness signal and no referrer counting, and the skill's central claim — that
it never guesses — stops holding. Without Node 22 the `.ts` scripts fail at parse
time with a syntax error about a type annotation, which looks like a corrupt file
rather than a version problem; use `npx tsx` instead.

`uv`/python3 are genuinely optional. Without them near-duplicate detection falls
back to title matching and tag mining to heading frequency, and every script says
which mode it used.

## Step 2 — install the skill

```bash
git clone https://github.com/agentience/agentience-skills.git /tmp/agentience-skills
cd /tmp/agentience-skills/skills/doc-librarian
./install.sh --dry-run     # prints every path it would touch
./install.sh
```

Clone somewhere permanent rather than `/tmp` if the user wants `git pull` to keep
the skill current — the installer symlinks by default, so the clone location
becomes the live copy. `--copy` takes a snapshot instead.

**Installing arms nothing.** It writes to `~/.claude/skills/` and nowhere else —
no `settings.json` edit, no change to any repository.

**Then tell the user to start a new Claude Code session.** A running session keeps
the skill text it loaded at startup, so the skill you just installed is not
available to *you*, in this session, right now. This is not optional and it is the
step agents skip. Everything below happens in that next session.

## Step 3 — install the governance kit into the target repo

From the root of the repository being organized:

```
/doc-librarian setup
```

It copies the linter to `docs/scripts/lint-docs.ts`, installs a `PostToolUse`
guard hook and registers it in that repo's `.claude/settings.json`, seeds
`docs/TAGS.md` if there is none, adds `.doc-librarian/` to `.gitignore`, and adds
`docs:*` npm scripts. It is idempotent and prints what it touched.

This step **does** modify the repository. Show the user the diff before
committing it.

## Step 4 — measure before you move anything

Ask the librarian to audit first:

> "Audit our documentation."

That is Procedure A, and it produces counts — file totals by type, top-level
sprawl, MECE violations, nesting depth, loose root files, orphans. **Do not
propose a reorganization before you have those numbers**, and do not accept your
own impression of the tree as a substitute for them.

Then, and this is the step that most often gets skipped:

**Measure the broken-link baseline before you touch anything.**

```bash
npx tsx docs/scripts/lint-docs.ts 2>&1 | tail -20
```

Record that number. After a migration, an absolute count of broken links tells
you nothing — a corpus that was already broken will still be broken, and without
the baseline you cannot tell the breakage you caused from the breakage you
inherited. The honest claim after a batch is **"no *new* broken links"**, and you
can only make it if you measured first.

## Step 5 — the recommended order

For a neglected tree: **G → E → A → F → B → D**.

| | |
|---|---|
| **G** Bootstrap vocabulary | derive candidate tags from the corpus's own language, then curate |
| **E** Curate | triage every doc KEEP / REVIEW / WEED, sweep staleness, dedupe, archive |
| **A** Audit | assess what survived |
| **F** Govern | standards, templates, the commit-time gate |
| **B** Reorganize | migrate into the target taxonomy, in batches |
| **D** Index | README indexes, master catalog |

**Weed before you reorganize.** Reshuffling documents you are about to discard is
wasted work, and a clean new structure lends false authority to dead content.

Procedure H fans multiple agents out over the REVIEW bucket when it is too large
to read yourself — one small batch of *related* documents each, returning per-doc
verdicts with evidence.

## Step 6 — before you promise this is a docs-only change

**It probably is not.** Documentation gets cited from live source, tests, CI
config, editor and agent config, and root-level `README`/`CLAUDE.md`. Moving a
file any of those names is a cross-cutting change that has to pass the same review
and the same build as a code change.

For every document your migration map moves:

```bash
git grep -l "old/path/to/doc.md" -- ':!docs' | sort
```

Classify each as **soft** (referenced only from within `docs/`) or **hard** (named
by source, tests, config, or a root file), and report the split before the first
`git mv`. On the corpus this skill was hardened against, **56 of 62 moving
documents had referrers outside `docs/`, and 30 of those were hard.** That is the
common case, not the edge.

The skill's executor (`apply-actions.ts`) rewrites links *within* the docs tree
only. Hard referrers are yours to edit by hand, and the batch that moves them
needs the test suite green, not just the link checker.

**Anchored references need a separate manual pass.** In `guide.md#configuration`
the path moves and the fragment does not, so a rewrite that fixes the path leaves
a link resolving to the right file and the wrong place in it. Nothing in this
skill checks anchors — the linter sees paths, not fragments. Grep each fragment
against the destination's headings, and record any anchor that was *already*
dangling before the move rather than silently adopting it as your fault.

## The rules that keep this safe

These are the skill's own golden rules. They are here because an agent that
skips them can destroy a corpus quickly and plausibly.

1. **Never delete a referenced document.** The lifecycle is deprecate → archive →
   much later, dispose. Broken inbound links are not acceptable, and "it's in git
   history" is not a defence.
2. **`git mv`, never `rm` + create.** History follows the file only if you move
   it. `git log --follow` on every moved doc is a cheap check that you did.
3. **Get sign-off on the migration map before moving anything.** Produce the full
   current-path → target-path table, with referrer counts, and have the user agree
   to it. Do not migrate and map at the same time.
4. **Migrate in batches, verify each, commit each.** Never start a batch while the
   previous one has left new broken links.
5. **Never invent a tag.** Tags come from the controlled vocabulary only. If one
   is missing, add it to `TAGS.md` with a definition first.
6. **`apply-actions.ts` is dry-run by default.** Look at the dry-run output before
   passing `--apply`. It refuses to delete a doc with inbound links even under
   `--confirm-delete`; do not go around that.
7. **Frozen artifacts are not documents.** Test fixtures, captured model outputs,
   recorded HTTP sessions and vendored files may live under `docs/` and must never
   be rewritten — rewriting a captured output changes the thing it recorded. Check
   for them before running any link rewriter, and exclude them explicitly.

Rule 7 is the one with teeth. In the migration this skill was hardened on, an
early link-rewriting pass silently corrupted 22 frozen experiment captures — one
of which existed to measure whether a model cites file paths that actually exist,
so rewriting paths inside its own recorded output altered the very variable it
measured. It was caught by a `git diff` against those directories, not by any
check in the tool.

## What this skill will not do for you

Say these out loud to the user rather than discovering them late:

- **Reference counting is liveness-blind.** A citation from a completed-specs
  folder weighs the same as one from live source, so a dead document can hold
  itself out of the WEED bucket on dead referrers. It errs toward human review
  rather than deletion, which is the safe direction — but a high inbound count is
  not proof of relevance.
- **It does not check anchors.** See step 6.
- **It does not rewrite referrers outside `docs/`.** See step 6.
- **It cannot tell you what is *true*.** It measures whether a document is stale,
  orphaned, or duplicated. Whether its content is still correct is a reading task,
  which is what Procedure H's agents are for — and even they return verdicts for a
  human to accept.

## If you get stuck

The full human-facing guide is at
<https://github.com/agentience/agentience-skills/blob/main/skills/doc-librarian/README.md>,
and the agent-facing procedures are in `SKILL.md` beside it. Report what you tried
and what the tool actually printed, rather than retrying a failing command with
different flags.
