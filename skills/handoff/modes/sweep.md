# Sweep mode (`--sweep`)

`.claude/handoffs/` accumulates one document per session that used Write mode,
and most of them finish their working life long before anyone deletes them —
[Next mode's](next.md) finish branch only catches the ones that happen to close
out through this skill. Sweep mode is the backstop: it ages everything else out.

**The retention rule is age only, not open/closed status.** A handoff is
archived once its `**Last Updated**` line (falling back to file mtime if that
line is missing or unparseable) is **15 days old or older** — full stop. Open
`## Work items` do not exempt it. A handoff that still has unchecked items
after 15 days with no update is not "still in progress," it is abandoned —
nobody is coming back to finish it on the strength of an unticked box, and
leaving it in the active folder because of that box is exactly the clutter
this mode exists to remove. What the open-items check changes is only the
**label** applied when archiving:

- No unchecked `## Work items` remaining → archived as **resolved**.
- At least one unchecked item remaining → archived as **stale** — a signal to
  a later reader that this was abandoned mid-work, not finished.

**Boxes the document does not own are excluded from that count.** Unchecked
items under a heading matching *Follow-on*, *Out of scope*, *Not in scope* or
*Next pull* — the "here is what comes after this" list most finished handoffs
end with — never make a document `stale`, and neither does a checklist quoted
inside a fenced code block. The exclusion runs until the next heading at the
same or a shallower level, so a real `## Work items`-style section after a
Follow-on section still counts normally.

This exists because the naive any-unchecked-box rule labelled a *completed*
handoff "stale — treated as abandoned" purely because it was courteous enough
to leave a next-pull list behind, printing that banner directly above the
document's own "everything is done, merged and verified" banner. Observed
2026-08-18 on client-ops' pull #4 handoff; corrected by hand at the time, then
fixed in the script.

The exclusion list is deliberately narrow, because the error it can introduce
runs the dangerous way — a finished-looking label on genuinely abandoned work.
**"Follow-up" is deliberately NOT on the list**: it routinely means "things
this document still owes", which is exactly what `stale` is for.

### Running it

```bash
npx tsx "${CLAUDE_SKILL_DIR}/scripts/sweep-handoffs.ts" [--days 15] [--dry-run]
```

- Moves each qualifying file from `.claude/handoffs/<name>.md` to
  `.claude/handoffs/archive/<name>.md`, prepending a one-line banner
  (`> **Archived YYYY-MM-DD — resolved|stale.** …`) directly under the
  `**Last Updated**` line.
- **Rewrites every existing reference to the moved path** — the literal string
  `.claude/handoffs/<name>.md` — across every file in `.claude/journal/*.md`
  and every other document in `.claude/handoffs/` (including ones that
  themselves get archived in the same run; the rewrite reads each target's
  current on-disk location, not a snapshot taken at the start). This is what
  keeps old journal entries and `**Supersedes:**` links resolving instead of
  404ing into a file that quietly moved.
- `--days N` overrides the 15-day default. `--dry-run` reports what would
  move and which files would gain rewritten references, without touching
  anything — run this first when sweeping a folder for the first time.
- Never move or edit anything under `.claude/handoffs/archive/` itself — the
  scan only reads the top level of `.claude/handoffs/`, so archived files are
  never re-processed.

### Reporting

Print the script's own summary (`N handoff(s) scanned, M archived, K kept`)
and, if any were archived, the one-line list of names and their resolved/stale
labels. That is the whole report — do not re-open or summarize the archived
documents' contents.

### When to run it

Manual only — there is no automatic trigger. Run it when the folder feels
cluttered, or periodically via `/loop` or a scheduled task if the user sets
one up. This is deliberate: mass-moving files and rewriting references across
`.claude/journal/` is exactly the kind of action that should not fire silently
as a side effect of something else. The one exception is the single-file,
user-confirmed archive in [Next mode's](next.md) finish branch, which is scoped to
one document the user just explicitly approved — not a sweep.
