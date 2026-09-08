# Read mode (`--read`)

Resume work by reading a handoff doc and using it to kick off this session. Parse everything after `--read` as follows:

1. **Determine the file to read.** Look at the first token after `--read`:
   - If it looks like a file path — it contains a `/`, ends in `.md`, or names a file that exists (try it as given, then relative to `.claude/handoffs/`, then relative to `.claude/handoffs/archive/`) — use that file. Consume this token. Finding it only under `archive/` means Sweep mode (or the Next-mode finish prompt) already closed it out — say so when you report which file you loaded in step 6, since it changes whether continuing it should update the archived copy in place or start a fresh document instead.
   - Otherwise (including when nothing follows `--read`), default to the **most recent** markdown file in `.claude/handoffs/` by modification time — never fall back to `archive/` for this bare case, since an archived document is deliberately no longer the active one. Determine it with:
     ```
     ls -t .claude/handoffs/*.md | head -1
     ```

2. **Collect kickoff instructions.** Any remaining text after `--read` (i.e. everything except the consumed file-path token, if there was one) is extra instructions from the user to incorporate into how this session begins. If the first token was *not* a file path, all of the text after `--read` is instructions.

3. **Read the chosen file.** Use it to rebuild the context needed to continue the work.

4. **Re-establish AMQ coordination.** If the document has an `## AMQ coordination`
   section — its shape is in
   [references/amq.md](../references/amq.md) — that channel is part of the state you are resuming — rebuild it before
   starting work, in this order.

   a. **Re-resolve the context; do not treat the recorded root as a path.** The
      document tells you *which handle and session*, not where that mailbox lives now
      — roots are per-worktree, and this session may be in a different one.

      ```bash
      amq_context="$(amq env --me <handle> [--session <name>])" && eval "$amq_context"
      amq who --json
      ```

      If `amq` is not in PATH, or the root refuses to resolve (exit `5` — pin or
      context mismatch, or an unconfigured worktree), **stop and say so in your
      kickoff message.** Do not improvise a `--root`: a guessed mailbox is worse than
      a stated failure, because the peer's messages then vanish silently.

   b. **Drain the gap.** Nothing was watching between the two sessions, so mail
      queued while the monitor was down:

      ```bash
      amq drain --include-body
      ```

      Fold anything it returns into the kickoff plan. A peer's reply can change the
      first action the handoff told you to take.

   c. **Restart the background monitor — but only if one is not already running.**
      Check first, in this order; start nothing if any check finds a live watcher:

      - **This session.** `--read` is not always the first turn — the session may have
        armed a monitor earlier, or `--read` may be running a second time. Look at
        your own background tasks before adding one; you started them, so you know.
      - **Outside the session.** For an `amq wake` notifier under launchd/systemd,
        `amq doctor --ops` reports `notifier_live` only when a live wake process is
        verified. That proves notification, not consumption — it is not a substitute
        for the drain in step b. For a plain backgrounded shell loop, match the
        recorded command with `pgrep -f`.
      - **The document says `none`.** Start nothing.

      Otherwise start it exactly as recorded — same primitive, same command, same
      `persistent`/`timeout_ms` or `run_in_background`. Two monitors on one inbox is
      not a harmless duplicate: every message notifies twice, and if the monitor
      consumes (`drain`) rather than peeks (`list --new`), the two race and each
      message reaches only one of them — so half the traffic silently goes to the
      watcher you are not reading.

   d. **Honor what the session owes.** Anything under **Owed** is a message that was
      never sent. Send it, or say in your kickoff message that you are holding it and
      why. Never let it lapse unmentioned — the counterpart is still waiting.

5. **Name the window.** Read the `## Window slug` section — contract in
   [references/window-slug.md](../references/window-slug.md) — and apply it, silently:

   ```bash
   [ -x ~/.claude/hooks/tmux-rename.sh ] && ~/.claude/hooks/tmux-rename.sh "<slug>"
   ```

   Do this early — a session that dies before its first report should still have left
   a correctly labelled window behind. It no-ops outside tmux and when the script is
   absent, so it is safe to run unconditionally.

   **If the document has no `## Window slug` section** (an older handoff, or one
   written elsewhere), derive one from the work the document describes and **add the
   section** while you are there, per step 7's rule about missing sections. Do not
   fall back to the document's basename: it is usually over 40 characters and names
   the document rather than the task, which is the failure this contract exists to
   prevent.

   **Do not report the rename** — it is housekeeping, and the tmux convention in
   `~/.claude/CLAUDE.md` is to rename silently. If the slug turns out to be wrong once
   you understand the work, fix it with the same command and update the document.

6. **Kick off the session — then keep going in the same turn.** Briefly confirm to the user which handoff file you loaded and give a short summary of where things stand and what you understand the next step to be. If kickoff instructions were provided, fold them into that plan and let them steer the focus. If step 4 ran, add one line for it: the monitor you restarted, anything the drain surfaced, and any AMQ step that failed.

   **The confirmation is a preamble to the first action, not a checkpoint.** Every
   verb in the paragraph above is a reporting verb, which makes this step read like
   a place to stop and wait — and stopping *is* simply emitting text with no tool
   call after it, so it costs nothing and happens by default. Do not let it. Unless
   the handoff genuinely blocks (a `## Decisions needed` entry gates the first
   action, an AMQ step failed, or the kickoff instructions are ambiguous), take the
   first action **in this same turn**, after the confirmation text.

   **Never write "starting X now" as the last thing in a turn.** That sentence and
   the stop are the same event — it announces nothing and starts nothing. Either
   the tool call follows it in this turn, or the sentence is false. If you find
   yourself wanting to write it, that is the signal to make the call instead.

   **If you are unsure whether to proceed, ask a real question** with
   `AskUserQuestion` — do not keep the *shape* of asking (announce, pause) while
   dropping the question itself. That leaves the user nothing to answer and the
   work unstarted, which is strictly worse than either alternative.

7. **Keep the document current for the rest of the session.** The file you just read
   is now *your* working record, not the previous session's artifact. Edit it as the
   work moves — not at the end, when the session may not get an end.

   - **Sign the `## Session trail` first — before any work, in your first edit of
     this file.** Append one row for yourself, `read`, per the
     [`## Session trail` contract](../references/session-trail.md):

     ```bash
     echo "$CLAUDE_CODE_SESSION_ID"; date +%Y-%m-%d
     ```

     Do it now rather than at the end for the same reason step 5 renames the
     window early: a session that dies mid-work should still have left behind the
     pointer to its own transcript, and that is precisely the session whose
     transcript someone will want. If the document has no `## Session trail`
     section, add one last in the file and start it with your row — do not invent
     rows for the sessions before you, whose IDs the file does not record.
   - **Tick a work item the moment it is done**, `- [ ]` → `- [x]`. Mark one you
     have started `- [ ] **(in progress)**` with a line on where it stands, so an
     interrupted session leaves a half-finished item legible rather than looking
     untouched.
   - **Collapse a ticked item's body in the same turn you tick it.** The checklist
     line stays; the body under it goes, replaced by title, date, and the commit sha
     or PR that carries it. Do this *as you tick*, never as a cleanup pass deferred
     to a later mode — a collapse that only happens at `--next`, on a branch that
     mostly does not run, is how one document reached 366 KB with 36% of its bytes in
     items that were already closed. **Before deleting the body, move anything still
     load-bearing out of it:** a gotcha specific to this work becomes a
     `## ⚠ <trap>` section in this document, and a gotcha that is really a fact about
     the stack (a package that cannot be imported under Jest, a cache with no
     discriminator) goes to tribal-markdown or `memory/` and leaves a one-line
     pointer here. Nothing else in the body survives — a closed item's reasoning is
     history, and history's home is that session's progress-log entry.
   - **Add items you discover**, and strike or delete ones the work made moot —
     saying why in one clause. A stale item costs the next session a re-investigation.
   - **Point-in-time sections are overwritten, never stacked.** Anything describing
     state as of a moment — `## AMQ coordination`, branch or worktree state, lease
     holders, verification counts, inbox state — is **one dated block, rewritten from
     the current capture**. Never add a second dated snapshot beside the old one and
     leave the reader to diff them: the superseded values are not history, they are
     wrong answers a future session may act on. The same rule governs superseding a
     decision or an item — **the superseded text is deleted, not demoted.** A `D7`
     kept beside a `D7 (superseded)` doubles the document and makes the reader
     adjudicate between two things you already chose between. **`## Session trail`
     is the one exception in the other direction** — it is append-only, so you add
     your row and leave every earlier one exactly as it stands.
   - **Append to `## Progress log`**, one dated line per meaningful change
     (`date +"%Y-%m-%d %H:%M"`). Append; do not rewrite earlier entries. **Keep the
     log to roughly the five most recent entries, trimming as you append** — not at
     `--next`. The log is a short tail on a current document, not an archive; it is
     read in full at the start of every session in the chain. **Before dropping an
     older entry, confirm the fact it carries is represented in a narrative
     section.** An entry whose only record was that line is data loss, and that is
     the failure mode of trimming.
   - **Move the answers up, and drop the argument.** When you settle something listed
     under `## Decisions needed` or as an open question, keep the **ruling** — what
     was decided, by whom, when, and the *why* in one clause — and delete the options
     and the reasoning that produced it. The argument's home is this session's
     progress-log entry. When you hit a new trap, add it beside the item it bites.
   - **Refresh `**Last Updated**` on every edit**, and re-date any verification
     claim you re-ran (`223/227, verified <date> on <sha>`).
   - **Check the size budget before you hand the document on** — `wc -c` it against
     the *Size budget* rule in
     [references/document-contract.md](../references/document-contract.md) (40 KB
     target, 80 KB ceiling). Over budget means
     prune finished content, never shorten the open work.
   - **Do not narrate the update.** Editing the file is the report; do not also
     summarize the change back to the user.

   If those sections are missing — an older handoff, or one written elsewhere — add
   them in the shape described in
   [references/document-contract.md](../references/document-contract.md) rather than
   tracking status only in
   your own head or a TodoWrite list. Both die with the session; the file does not.

   Update the file in place. Do not fork a `-v2` or write a fresh handoff mid-session
   — that splits the record, and a later reader has no way to tell which half is
   current.

8. **End the session with `--next`.** Because step 7 kept this
   document current, the way to hand off is to bring *it* fully up to date and relaunch
   on it — not to write a second document describing the same work. [Next mode](next.md) does
   both. A bare invocation still writes a new document, which is the right
   call only when the work has genuinely outgrown the file you read.

Read mode does **not** delegate — it is the session's opening move, and the context
it builds is the context the session then works in.

### Examples

- `--read` → read the most recent handoff in `.claude/handoffs/` and continue.
- `--read .claude/handoffs/staging-cutover.md` → read that specific file and continue.
- `--read staging-cutover.md` → resolve to `.claude/handoffs/staging-cutover.md` and continue.
- `--read focus on the failing tests first` → no file path given, so read the most recent handoff **and** prioritize the failing tests.
- `--read staging-cutover.md skip the Typesense rebuild` → read that file **and** incorporate "skip the Typesense rebuild" into the kickoff.
