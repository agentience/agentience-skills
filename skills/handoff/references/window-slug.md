# The `## Window slug` contract

The document carries a short tmux window title naming **the work**, which Read mode
applies to the window it resumes in. Write mode produces it; Read mode consumes it.
Unlike AMQ, this section is **never omitted** — every handoff has work to name.

```markdown
## Window slug

`handoff-relaunch-race`
```

- **2–4 dashed lowercase words, 40 characters max.** The rename script truncates at
  40; longer titles are silently cut mid-word.
- **Name the work, not the project or the file.** `agentic-workflow` is precisely the
  failure this exists to prevent — a title that is identical for every session in the
  repo tells the reader nothing about which window holds what. The document's own
  filename is usually too long and too descriptive of the *document* rather than the
  *task*; derive a shorter title from the work instead of reusing the basename.
- **It describes where the work is going, not where it has been.** The next session
  acts on the open items, so title it after those — a slug naming the thing that was
  just finished labels a window for work nobody is doing.
- **Revise mode re-derives it.** When `--next` refreshes a document whose remaining
  work has moved on, the slug moves with it; a stale title outlives the task it named.

Read mode applies it through the same helper Claude calls by hand, which no-ops
outside tmux and when the script is absent:

```bash
[ -x ~/.claude/hooks/tmux-rename.sh ] && ~/.claude/hooks/tmux-rename.sh "<slug>"
```

**Why the document owns this rather than the relaunch hook.** `handoff-relaunch.sh`
also names the window it respawns, but on the respawn path that rename is a **race it
loses often enough to be unreliable**: it runs *after* `respawn-window -k`, which kills
the pane the hook itself is running in, so the process may die before the rename is
issued. Both outcomes were observed on 2026-08-11 — a scratch tmux session showed a
script failing to survive respawning its own window, while a real relaunch at 10:30:53
did reach the rename and titled the window. Do not rely on either result: an
intermittent rename is worse than none, and the name it applies is the *document's
basename*, not the slug. Putting the slug in the document moves the rename into a live
session that is in no danger of being killed, makes it deterministic, and covers every
way a handoff gets read — pasted into a fresh session, opened by hand — not just the
respawn path. Read mode's step 5 runs after the hook either way, so it wins regardless
of which side of the race the hook lands on.
