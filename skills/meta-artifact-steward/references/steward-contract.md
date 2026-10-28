# The steward contract

**Last Updated: 2026-10-28 12:25**

What every steward contains, and the rules it keeps. `audit.py` checks the parts that can be checked.

## Location

`<repo>/.claude/skills/<slug>-steward/`, committed, in the repo that holds the artifact. Collaborators get it with `git pull`, and Claude Code loads it as a project skill in any session in that repo. The slug names the artifact (`pricing-steward`, `sow-steward`), not the person or the date.

## Files

| File | Required | Holds |
|---|---|---|
| `SKILL.md` | yes | Frontmatter (`name`, a `description` naming the artifact and when to use the steward), then the **answer** and **refine** procedures for this artifact, and its Don'ts |
| `context.md` | yes | Everything except decisions: purpose and audience, what it was built from, its structure, assumptions with their sources, conventions, traps when editing, related material |
| `decisions.md` | yes | Numbered decisions (`D1`, `D2`…) and **Open questions** |
| `steward.json` | yes | The machine-readable contract (below) |
| `scripts/state.py` | yes | Copied unchanged from meta-steward. Fingerprints the artifacts |
| `state.json` | yes | Written by `state.py --record`. The artifacts' fingerprints at the last recorded change |
| `scripts/check.*` | no | Only when the artifact has rules a script can verify |

Every Markdown file carries `**Last Updated: YYYY-MM-DD HH:mm**` under its title, taken from `date`. Refresh it on every edit.

## `steward.json`

```json
{
  "contract": 1,
  "artifact": "Pricing workbook for the Q3 proposal",
  "artifacts": ["proposal/Pricing.xlsx"],
  "source_of_truth": "proposal/Pricing.xlsx",
  "editing": "exclusive",
  "collaborators": ["Alex Doe", "Sam Roe"],
  "visibility": "internal: Alex and Sam only; never in client material",
  "consumers": ["proposal/Proposal.md §6 (amounts once agreed)"],
  "check": "scripts/check.py",
  "created": "2026-10-28"
}
```

- `artifacts`: paths relative to the repo root. `state.py` fingerprints these.
- `source_of_truth`: one path. If a generator produces the artifact, it's the generator's input, and the steward says so.
- `editing`: `merge` (text; git merges it) or `exclusive` (binary; one editor at a time).
- `check`: the check script's path relative to the steward, or `null`.

## Decisions

```markdown
- **D7. <The ruling, in one sentence.>** <Who>, <when> (<source>). <Why, in one clause.> → <Where it shows in the artifact.>
```

- **Who** is a named person, or several. Never "we". In the refine procedure, the decider is the person driving the session (`git config user.name`), unless they name someone else.
- **Source** is something a reader can open: a meeting summary and timestamp, a commit, a document section, "this session" with a date.
- **Superseding.** Replace the old entry in place and say what it superseded. Don't keep the old one beside it: two rulings make the reader choose, and the choice has already been made.
- **Numbers are stable.** Never renumber. A removed decision leaves its number unused.
- **Open questions** are things discussed but not settled, with who owns them. When one is settled, it becomes a decision and leaves the list.

## The two procedures every steward's `SKILL.md` carries

**Answer.**
1. Read `context.md` and `decisions.md`.
2. Read the artifact's current state from the artifact itself, never from memory or these files.
3. Answer with where in the artifact, the reasoning, and the decision (`D7`) or source behind it.
4. Say when an answer rests on something still open.

**Refine.**
1. Sync with `git pull`. For `exclusive` editing, stop if the file has uncommitted changes or is open (a lock file), and ask.
2. Run `state.py --check`. If the artifact changed since the last record, someone edited it outside the steward. Work out what changed, ask who decided it and why, and record that **before** making the new change.
3. Make the change. Run `check` if there is one: it must pass.
4. Record:
   - a decision, if the change settled something
   - an update to `context.md`, if meaning, structure or an assumption changed
   - any consumer the change affects, flagged as pending
5. Run `state.py --record --note "<what changed>"`. Ask before committing and pushing. For `exclusive` editing, recommend pushing at once.

## Exit codes (`state.py` and any check script)

`0` clean · `1` something to act on (a check failed, or the artifact changed since the last record) · `2` couldn't run (missing tool, bad path). Messages for `2` start with `CANNOT RUN:` on stderr and name the fix.

## Who decides

The steward never decides. It keeps the record, answers from it, and runs the refine procedure. Every decision belongs to named people. An entry saying "the steward decided" is a contract violation.

## What a steward is not

- **Not a handoff.** A handoff carries a *session's* state forward and is finished when the work is.
- **Not memory.** Memory holds one person's preferences.
- **Not a domain expert.** A steward is tied to one artifact and shared by everyone who edits it.
