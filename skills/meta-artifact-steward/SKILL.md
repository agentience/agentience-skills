---
name: meta-artifact-steward
description: >-
  Create a steward for an artifact that several people will keep refining:
  a workbook, a proposal, a SOW, a deck, a spec, a design, any file. The steward
  holds the context and the decisions that got the artifact to where it is,
  answers questions about it with sources, and runs a refinement process that
  records every new decision. It lives beside the artifact in its repo, so every
  collaborator shares one understanding. Modes: `create <artifact>` (default),
  `adopt <steward-dir>` (bring a hand-made steward under the contract) and
  `audit [repo]` (find stale stewards, unrecorded changes and aged open questions).
  Use when the user has just produced an artifact others will build on, says
  "capture the context and decisions", "make a steward for this", or wants
  shared understanding of how a deliverable came to be.
license: MIT
metadata:
  author: "Troy Molander"
  version: "1.0"
---

# Meta-artifact-steward

**Last Updated: 2026-10-28 12:25**

An artifact is only part of the work. The rest is **why it is the way it is**:
what it is for, what it was built from, which choices were made, by whom, and
what is still open. That part usually lives in one person's session and dies
with it. The next session, or the next collaborator, then re-derives it, gets it
wrong, or quietly reverses a decision someone made for a good reason.

A **steward** (`<artifact>-steward`) is a small project skill that keeps that part alive, next to the
artifact, in version control. It answers questions about the artifact with
sources, and it changes the artifact through a process that records each new
decision. **The type of artifact doesn't matter.** A workbook, a document, a deck
and a diagram all get the same steward. What differs is only whether the artifact
has rules a script can check.

**The steward keeps the record and runs the process; people make the decisions.**
Every decision it records names the person or people who made it. Stewardship is care
for the artifact's integrity, not authority over its content.

## Modes

Read the first word of the arguments:

| Arguments begin with | Mode |
|---|---|
| `audit` | **Audit**: see [Audit](#audit) |
| `adopt` | **Adopt**: see [Adopt](#adopt) |
| anything else | **Create**: the rest is the artifact (a path, or a description of it) |

The contract every steward follows (files, fields, rules) is in
[references/steward-contract.md](references/steward-contract.md). Read it before
creating or adopting one. How to find context and decisions, and how to cite
them, is in [references/harvesting.md](references/harvesting.md). Read it before
step 3 of Create.

## Create

1. **Pin down the artifact.** Resolve the path(s). A steward can cover several
   files that move together, such as a document and the page built from it. Settle,
   asking only what you can't infer:
   - **Source of truth.** Is it the artifact itself, or a source it is generated
     from? If a generator exists and people also hand-edit the output, say so: one
     of them has to win, and the steward must state which.
   - **Editing mode.** Text that git can merge → `merge`. Binary (xlsx, docx, pptx,
     images) → `exclusive`: one editor at a time, pull before, push right after.
   - **Collaborators.** Who edits it (`git log` on the path; ask about people who
     haven't committed yet).
   - **Visibility.** Who may see it and its reasoning. Internal material (prices,
     candid remarks, partner terms) becomes a **Don't** in the steward, and also
     decides where the steward lives.
   - **Downstream consumers.** What else uses its content (a contract section, a
     deck, a published page)? A change here may need a change there.
2. **Place the steward.** `<repo>/.claude/skills/<slug>-steward/`, in the repo
   that holds the artifact, **committed**, so a `git pull` gives every
   collaborator the same steward. If `.claude/` is gitignored, or holds files that
   must stay private (handoffs, local settings), adjust `.gitignore` to track
   `.claude/skills/` only, and tell the person exactly what changed. If the
   artifact's visibility forbids that repo, stop and ask where it should live.
3. **Harvest.** Follow [references/harvesting.md](references/harvesting.md):
   gather the purpose, sources, structure, assumptions and **decisions** from the
   current conversation, meeting notes and transcripts, handoffs, briefs, commit
   messages and review comments. **Every decision needs who, when and a source.**
   Anything that was discussed but not settled is an **open question**, not a
   decision. If the record doesn't say who decided something, ask; never write
   "we".
4. **Write the steward** from [templates/](templates/). Each `*.tmpl` becomes the file without the suffix. Fill every `{{…}}`, and delete any template line that doesn't apply:
   - `SKILL.md`: the answer and refine procedures, filled in for this artifact
   - `context.md`: purpose, sources, structure, assumptions with their sources,
     conventions, traps, related material
   - `decisions.md`: numbered decisions plus open questions
   - `steward.json`: the machine-readable contract (artifacts, editing mode,
     collaborators, visibility, consumers)
   - `scripts/state.py`: copied unchanged from this skill's `scripts/state.py`.
     It fingerprints the artifacts, so the steward can tell when one changed
     without a decision being recorded

   **Optional: `scripts/check.*`.** Only if the artifact has rules a script can
   verify, such as totals that must reconcile, IDs that must resolve, required
   sections or banned terms. Write the rules *for this artifact*, with the person.
   See the contract for the exit codes. Many artifacts need none; don't invent
   checks to fill the slot.
5. **Prove it.**
   - From a clean shell, run `scripts/state.py --check` and, if there is one, the
     check script (`env -i HOME="$HOME" PATH=/usr/bin:/bin:<tool dirs>`).
   - If there is a check script, show it **fails** on a deliberately broken copy
     of the artifact. A check that has never failed proves nothing.
   - Ask the new steward three real questions as a cold reader would ("why is X
     like this?", "what is still open?", "who decided Y?"). Each answer must come
     from `context.md` or `decisions.md` with a source. Fix any gaps.
6. **Record the baseline.** `scripts/state.py --record --note "steward created"`.
7. **Hand over.** Show the person the steward's tree and decision count, list
   the open questions, and ask before committing and pushing. Offer to tell the
   other collaborators how they get it and what it needs installed.

## Adopt

For a skill made by hand before this contract existed: an
artifact skill with its own context and decision log.

1. Read the skill's files, and the contract.
2. Add whatever is missing: `steward.json`, `scripts/state.py`, an **Open
   questions** section, sources on the decisions. Map its existing snapshot or
   check script onto the contract rather than replacing it.
3. Keep its content. Adopting changes the shape, not the decisions.
4. Run steps 5–7 of Create.

## Audit

`python3 <this skill>/scripts/audit.py [repo]` (defaults to the current repo).
For every steward under `.claude/skills/`, it reports:
- artifacts missing, or changed since the last recorded state (an unrecorded edit)
- steward files not committed
- open questions, and how long since `decisions.md` was last updated
- hand-made stewards that aren't yet under the contract

Relay the findings. For an unrecorded change, offer to run that steward's
refine procedure: work out what changed, ask who decided it and why, record it.
Don't fix anything unasked.

## Don't

- Don't write a decision without who, when and a source. "Decided in the
  2026-10-28 meeting (Alex, 41:26)" is a decision; "we went with X" is not.
- Don't record what the artifact already shows plainly. Record **why**, and
  where it shows in the artifact.
- Don't copy internal content into a steward that will be seen more widely than
  that content may be.
- Don't build a steward for a throwaway artifact. It earns its place when more
  than one person, or more than one session, will refine the artifact.
