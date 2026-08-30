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
- **Anything owed to a party outside this session is a work item, never prose.**
  Write it as an unticked `- [ ]` that **names the counterparty**, in the same
  checklist as everything else:

  ```markdown
  - [ ] **OWED to `ifti-dev2-91` (re-resolve — the handle changes):** collect the
        three agreed captures when they report the run, and write the results
        into the verification ledger.
  ```

  A narrative section describing the arrangement — "we report outcomes to the
  other session", "there is a channel open with X" — is read by the next session
  as **context about something already in place, and therefore already
  satisfied**. Only an unticked box reads as a debt.

  Measured 2026-08-29 on a three-session chain: the first session held a standing
  obligation to report each run's outcome to a peer, recorded in prose. It ended
  **without ever sending the report**. The second session rewrote it as an
  unfulfilled item naming the counterparty, and it then survived two further
  handovers intact. The distinction is not "write it down" — it was written down
  the first time. It is "write it down as *not done yet*, and say *to whom*".

  Naming the counterparty does a second job: it tells the next session **who to
  re-resolve**. Handles are session-scoped and go stale, so `report the outcome`
  is unactionable after a handover in a way that `report to <handle>, re-resolve
  first` is not — the stale handle still names the *kind* of party to look for.

  **A box must describe an action, not a state.** `- [ ] #12, #13 filed, not
  scheduled` is a status wearing a checkbox: nobody can tick it, and it makes the
  list look like it holds open work when it holds none. Either it is something
  someone does, or it belongs in a narrative section.

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
