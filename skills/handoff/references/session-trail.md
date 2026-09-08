# The `## Session trail` contract

Every session that touches a handoff document adds itself to the document. The
trail is the chain's provenance record: it names, in order, each session that
wrote, read, or refreshed this file.

```markdown
## Session trail

| Session ID | Date | Did |
|---|---|---|
| `628e2071-2216-4b55-9536-4d24e59f3e2b` | 2026-09-08 | wrote |
| `9f3c1d20-7a44-4e18-b0c2-5511ad83e7f1` | 2026-09-09 | read, refreshed |
```

**It goes last in the document**, after `## Progress log`. It is metadata about
the record rather than part of it, and putting it at the bottom keeps it out of
the way of the sections a resuming session actually acts on.

### Why a session ID and not just a date

The progress log says *what* each session changed. The session ID is what lets a
later reader find out **why** — it is the key to that session's full transcript,
which the log summarizes and the handoff compresses:

```bash
# Re-digest any session in the chain
"${CLAUDE_SKILL_DIR}/scripts/digest.sh" --session <id> --out /tmp/d.md

# Or open it directly
claude --resume <id>
```

Without the ID that transcript is unaddressable in practice — the only other way
to find it is guessing among `~/.claude/projects/<slug>/*.jsonl` by modification
time, across every session the machine ran that day, which is exactly the
guess Write mode forbids elsewhere. One line per session buys the whole chain
back.

### Rules

- **The ID is `$CLAUDE_CODE_SESSION_ID`, read in a Bash call.** Never derive it
  from the newest `.jsonl` by mtime, and never carry a value forward from a
  document you read — that ID belongs to the session that wrote the row.
- **One row per session, appended in chronological order.** A session that reads
  a document and later refreshes it with `--next` **updates its own row's `Did`
  column** — `read` becomes `read, refreshed` — rather than adding a second row.
  The trail counts sessions, not visits.
- **Never edit or delete another session's row.** Rows below yours are history;
  the only row you own is your own. This is the one section in the document that
  is strictly append-only.
- **`Did` is one or more of `wrote`, `read`, `refreshed`, comma-separated.**
  `wrote` is Write mode creating the file, `read` is Read mode loading it,
  `refreshed` is Next mode bringing it current. Nothing else goes in the column —
  what the session *did to the work* belongs in `## Progress log`.
- **The trail is never pruned.** It is exempt from the size-budget cuts in
  [document-contract.md](document-contract.md): a row is under 80 bytes, so a
  twenty-session chain costs 1.5 KB, and there is no prune order in which
  deleting provenance beats deleting a closed item's body. A trail long enough
  to notice is a signal that the work has outgrown one document, not a section
  to trim.
- **Sweep mode does not add a row.** Archiving is bookkeeping over documents the
  sweeping session never worked in; a row there would claim a session touched
  work it never read. The trail travels with the file into
  `.claude/handoffs/archive/` unchanged, which is the point — an archived
  document stays traceable back to every session that produced it.
- **Add the section if it is missing.** A document written before this contract,
  or one written elsewhere, has no trail. Start it with your own row; do not
  invent rows for the sessions that came before, since their IDs are not
  recoverable from the file.
