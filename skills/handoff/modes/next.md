# Next mode (`--next`)

> Read [write.md](write.md) alongside this file — Next mode runs Write
> mode's steps 1–4 with the four differences below.

For a session that began with `--read` and has been keeping that document current
per [Read mode](read.md) step 7. The document already *is* the handoff; a second one would
fragment the record across two files and leave the next reader guessing which is
live. So: **bring the existing document fully current, arm the relaunch on that
same path, and write no new file.**

`--next` is not "skip the write and relaunch". A maintained doc is current as of
the last time you touched it, not as of now — the trailing stretch of the session
is exactly the part that is missing, and exactly the part the next session needs.
Refresh it.

**Unless that trailing stretch is empty.** In a session that has been running
[Read mode](read.md) step 7 properly, the last update may *be* the current state: you ticked the
item, logged the line, stamped `**Last Updated**`, and the next thing that happened
was the user typing `--next`. Refreshing then costs a digest, a subagent and a
rewrite to conclude the file was already right.

So Next mode resolves the target first (difference 1 below), then takes one of two
paths:

- **The session has moved since the document was last updated** — refresh it, per
  the four differences below.
- **The session has not moved** — skip to step 4 alone, per *Already current* below.
  Arm the relaunch on that same path and report. No digest, no subagent, no edit.

Run [Write mode](write.md) steps 1–4 with four differences:

1. **Determine the target, then keep the rest of the arguments as tailoring.**
   For the target, in order: a file path token after `--next`; else the
   document this session loaded in Read mode. **Do not fall
   back to the most recent file in `.claude/handoffs/`** — Read mode may do that
   because reading the wrong document costs one turn, whereas rewriting the wrong
   one destroys it.

   **If there is no document to refresh, say so in one line and write a fresh one.**
   That covers both ways it happens: no path was given and this session never read a
   handoff, or the path after `--next` names a file that does not exist. Do not stop
   to ask — there is nothing to destroy, and the user asking for `--next` wants a
   current handoff either way. Say which it was, then run Write mode as if the
   `--next` were absent: create mode rather than revise mode in step 3, the trailing
   text still tailoring, and the target being the path the user gave if they gave one,
   otherwise a new kebab-case name for the work. Report the new file per Write mode,
   not with the "Refreshed" line below.

   ```
   No handoff to refresh (this session never read one) — writing a fresh one.
   ```

   Any remaining text after `--next` — everything but the file-path token, if there
   was one — is Write mode's tailoring argument: **a description of what the next
   session will focus on, to be written into the document.** Pass it to the subagent
   in step 3 as Tailoring. **Do not act on it in this session.** A session that
   arrived here through `--read` has just spent its life under the opposite rule —
   trailing text after `--read` *is* kickoff instructions to carry out — and
   carrying that reading forward is the specific mistake to avoid: `--next` writes
   the document, so its arguments describe the next session's work rather than
   commissioning more of your own. If the text reads like a command
   (*"fix the flaky seed script"*), it is telling you what the next session should
   fix, not asking you to fix it.

   **The pull in the other direction is real, so name it.** Write mode's
   *"Resolve, don't hedge"* rule tells you to check anything checkable, and a
   bug report full of checkable things reads like an invitation. It is not:
   that rule is scoped to claims the document itself asserts. Verify the state
   you describe; never develop the remedy you recommend. Trailing text that
   reports a problem gets *described* accurately — including one command to
   confirm the problem is still real, if the document asserts that — and the
   diagnosis is left to the session that will act on it.
2. **Step 2's brief covers the delta**, not the session: what changed since the
   document last said anything — work finished, items discovered, decisions
   settled, traps hit, and anything now *wrong* in the file. Name the sections you
   believe are stale. You are the only one who can see the difference between what
   the file claims and what you know.
3. **Step 3 delegates in revise mode** — the same `handoff-writer` subagent, but
   pass the document as an **existing document to revise**, not as a target path
   to create. Its Revise mode rules govern what is preserved and what is rewritten.
   `--inline` opts out as usual, and you revise it yourself under those same rules.

   **Still pass the session ID, and say the refresh is by a session already in the
   trail when it is.** A session that arrived through `--read` signed the
   `## Session trail` at Read mode step 7, so the refresh **updates that same row**
   — `read` becomes `read, refreshed` — rather than adding a second one. The
   [contract](../references/session-trail.md) counts sessions, not visits. Only the
   `--next <path>` case, where this session never read the document, appends a new
   row, and there it is `refreshed` alone.
4. **Step 4 is unchanged**: arm the sentinel with that same path, then report.
   `--no-relaunch` still opts out, which makes `--next --no-relaunch` the "final
   sweep of the doc, but I'm staying here" form. `--split` still applies too —
   `--next --split` brings the document current and opens the successor in a pane
   below, rather than over, this session.

Report the refresh rather than implying a new file:

```
Refreshed `.claude/handoffs/<name>.md`
```

### Already current — skipping the refresh

**The question is whether the document is true *right now*, not whether time has
passed since it was written.** Answer it from your own context first: since the turn
in which you last edited this file, has anything happened that the file does not
say? A tick owed, a commit made, a decision settled, a trap hit, an item discovered,
a message sent or received — any of those is movement, and movement means refresh.

Confirm it in one Bash call rather than on memory alone, because the session that
believes it has been diligent is exactly the one that forgets a commit:

```bash
TARGET=".claude/handoffs/<name>.md"
grep -m1 'Last Updated' "$TARGET"
git log -1 --format='%h %cI %s'
git status --short
if command -v amq >/dev/null 2>&1; then amq list --new; fi
```

Movement is anything the document would have had to absorb: a commit newer than its
`**Last Updated**` line, uncommitted changes it does not describe, an inbox message
it does not mention. Read-only exploration that changed nothing the document claims
is **not** movement, and neither is the `--next` invocation itself.

Two cases are never a skip, however quiet the session looks:

- **`--next` carried tailoring text.** That text describes what the next session
  should focus on and it has to land in the file — which is an edit, so refresh.
- **This session never maintained this document** — the path came from a
  `--next <path>` token and [Read mode](read.md) never loaded it. You have no basis for calling
  it current, because you have not been the one keeping it so.

**When in doubt, refresh.** The skip saves one digest and one subagent call; a
wrongly skipped refresh hands the next session a document that is confidently wrong
about where the work stands, and that session will act on it.

On a skip, **do not touch the file at all** — not even to restamp `**Last Updated**`,
and not to touch the `## Session trail`: a skip is only reachable from a session that
read this document, so its row is already there and the refresh it would record did
not happen.
A bumped timestamp on unchanged content claims a review that did not happen, and it
resets the retention clock [Sweep mode](sweep.md) reads off that same line. Do step 4 only — arm
the sentinel on that path, `--no-relaunch` still opting out and `--split` still
placing the successor below — and report:

```
`.claude/handoffs/<name>.md` already current — no changes.
```

The finished-work branch below applies on this path too: check it before arming.

**If the work in the document is finished** — every item ticked and nothing
discovered to replace them — do not arm the relaunch, and ask whether to
archive it now rather than leaving it in `.claude/handoffs/` for the age-based
sweep to find later:

```
This handoff has no open items left — archive it now?
```

- **Yes**: run the sweep script in single-file mode, which moves the document
  to `.claude/handoffs/archive/`, stamps it `resolved`, and rewrites every
  existing reference to it (journal entries, other handoffs) to the new path:

  ```bash
  npx tsx "${CLAUDE_SKILL_DIR}/scripts/sweep-handoffs.ts" --file .claude/handoffs/<name>.md
  ```

  Report `Archived .claude/handoffs/archive/<name>.md` — nothing else.
- **No, or the user doesn't answer**: say the work is finished and leave the
  file in place. **[Sweep mode](sweep.md)** will archive it once it ages past the
  retention window regardless — this prompt only decides whether it happens
  now or later, never whether it happens.

Respawning a window to read a completed handoff spends the window and the next
session's first turn to learn there is nothing to do — that is what not
arming the relaunch avoids either way.
