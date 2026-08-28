# The handoff document contract

What every handoff document must be, whoever is holding the pen. Write mode
produces a document in this shape; Read mode's step 7 keeps it in that shape for
the rest of the session; Next mode restores it. Read this file whenever you are
about to write or edit a handoff document.

### Size budget

**Target 40 KB (~600 lines). Never exceed 80 KB (~1,200 lines).** Check it with
`wc -c .claude/handoffs/<name>.md` before you hand the document on.

The number exists because a handoff is read *in full* at the start of every session
in its chain, so its size is paid over and over — which inverts the point of this
command, ending an expensive session cheaply. Measured 2026-08-24 on a real chain:
one document had reached 366 KB / 5,357 lines, of which 36% was the bodies of work
items already ticked closed and 22% was a 54-entry progress log against a stated cap
of five.

**Over budget is a signal to prune, never to abbreviate the open work.** Open items,
live traps, and decisions still owed keep their full length — they are the part the
next session acts on, and shortening them is how you turn a fat document into a
useless one. What comes out is *finished* content, in this order:

1. Bodies of ticked work items — collapsed to title, date, and sha.
2. Progress-log entries beyond the recent five.
3. Superseded decisions and stacked point-in-time snapshots — deleted, not demoted.
4. Anything already stated in another artifact, replaced by a reference to it.

If all four are done and the document is still over 80 KB, the work has outgrown one
document. Say so, and split the *finished* thread off into its own archived doc —
never shave the live one to fit.

Read mode step 7 enforces this turn by turn as a session works; this is the number it
enforces against.

### The document is a living record, not a snapshot

A handoff is read by a session that then *works*, and that work changes what the
document says. Write it so the next session can keep it true, and tell it to:

- **Work items go under `## Work items` as a checklist**, one line per item,
  `- [ ]` for not started and `- [x]` for done, with in-flight items marked
  `- [ ] **(in progress)**` and a one-line note on where they stand. An item is a
  unit a reader can finish and tick — not a phase heading, and not a paragraph.
  Anything blocked says what blocks it, on the item.
- **The document carries its own update instruction.** Directly under the
  `## Work items` heading, include the line:

  ```markdown
  > **Keep this current.** Tick items as you complete them, add ones you discover,
  > and update **Last Updated** each time you edit this file. The next session
  > after you reads this file, not your transcript.
  ```

  Read mode enforces the same rule from its side, but a doc read outside this
  command — pasted into a fresh session, opened by a human — carries the
  instruction only if it is written into the file.
- **A `## Progress log` section, seeded with one dated entry for this session.**
  `- YYYY-MM-DD HH:mm — <what changed>`. It gives the resuming session a place to
  append to instead of quietly rewriting history in place, and it is how a third
  session tells what the second one actually did.
