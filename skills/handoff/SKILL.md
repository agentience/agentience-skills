---
name: handoff
description: Compact the current conversation into a handoff document under .claude/handoffs/, or resume work by reading an existing one. Write mode delegates to a subagent and can arm a tmux relaunch so the next session opens already reading the doc; `--next` refreshes the document the current session has been keeping current; `--read` resumes from one. Use when the user invokes /handoff, asks to hand off / wrap up / write a handoff, or asks to resume from a handoff document.
argument-hint: "[description of next session] [--inline] [--no-relaunch] | --next [file-path] | --read [file-path] [extra instructions]"
disable-model-invocation: true
---

**Last Updated: 2026-08-11 10:36**

This skill has three modes. Look at `$ARGUMENTS` to decide which one applies.

## Mode selection

- If the arguments begin with `--read`, run **Read mode**.
- If the arguments begin with `--next`, run **Next mode** — refresh the handoff
  document *this* session has been keeping current, instead of writing a new one.
- Otherwise, run **Write mode** (the default). Write mode **delegates to a
  subagent by default**; `--inline` anywhere in the arguments opts out.

A bare `/handoff` **always** writes a new document, even in a session that
began with `--read`. Refreshing the loaded document is opt-in, via `--next`, and
deliberately so: silently converting a requested write into an in-place revision
would lose a document the user asked for, and the read-session case is the one
where you are least able to judge that the existing doc is still the right vessel.

---

## Write mode (default)

Write a handoff document that summarizes the current conversation so a fresh agent
can continue the work. Store it in `.claude/handoffs/` as a kebab-case `.md` file
named after the work (e.g. `.claude/handoffs/e2e-isolation-tags-phase-2.md`).
Provide any details necessary to continue the work without losing necessary context.

Do not duplicate content already captured in other artifacts (PRDs, plans, ADRs,
issues, commits, diffs). Reference them by path or URL instead.

If the user passed arguments (other than the flags `--read`, `--next`, `--inline`
and `--no-relaunch`), treat them as a description of what the next session will
focus on and tailor the doc accordingly.

**The document ships ready to read — no caveats delivered to the user.** The
document is the entire deliverable; your closing message is a pointer to it, not a
summary of it (see step 4). This holds in both delegated and `--inline` mode, and
the full statement of it lives in `agents/handoff-writer.md` under Rules. In short:

- **Resolve, don't hedge.** Anything checkable with a command gets checked and
  written as an answer. *"May already be merged by the time you read this"* is
  homework handed to the next session; run the `git log`.
- **Date what you verified.** Shas, versions and counts go stale fast on an active
  repo. Say what was confirmed and when, and which figures drift.
- **Decisions the user owes go in the doc**, under `## Decisions needed`, with
  options and a recommendation — never left in conversation, which the next session
  cannot read.

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
  skill — pasted into a fresh session, opened by a human — carries the
  instruction only if it is written into the file.
- **A `## Progress log` section, seeded with one dated entry for this session.**
  `- YYYY-MM-DD HH:mm — <what changed>`. It gives the resuming session a place to
  append to instead of quietly rewriting history in place, and it is how a third
  session tells what the second one actually did.

### Why this delegates

Write mode is invoked at the *end* of a long session, when every main-loop turn
re-sends the full accumulated context. The document takes 5–8 turns to research and
write; delegating collapses that to two, and moves the reading and drafting onto a
cheaper model against a fresh context. The subagent works from a **digest of this
session's transcript** — which, unlike your in-context view, survives compaction and
still contains the early dead ends.

The one thing a transcript cannot supply is *salience* — what is decided vs. open,
which trap the next session will walk into, what not to touch, what this session owes
someone else. You supply that. It is the step you must not skip, and the reason this
is a hybrid rather than a fire-and-forget delegation.

### 1. Gather (one Bash call)

```bash
OUT="${TMPDIR:-/tmp}/handoff-$CLAUDE_CODE_SESSION_ID"; mkdir -p "$OUT" && \
npx tsx "${CLAUDE_SKILL_DIR}/scripts/digest-transcript.ts" \
  --session "$CLAUDE_CODE_SESSION_ID" --max-text 2000 --out "$OUT/digest.md" && \
git branch --show-current && git log --oneline -5 && git status --short && \
ls -t .claude/handoffs/*.md 2>/dev/null | head -5
if command -v amq >/dev/null 2>&1; then
  echo "--- amq env ---";   amq env --json
  echo "--- amq who ---";   amq who --json
  echo "--- amq inbox ---"; amq list --new
else echo "--- amq: not in PATH ---"; fi
```

Keep it to **one** call — batching is the point; each extra round trip costs a full
context re-send, which is what this mode exists to avoid.

- `CLAUDE_CODE_SESSION_ID` is exported to every Bash call and is per-session, so it
  is safe under concurrent sessions. Never fall back to picking the newest `.jsonl`
  by mtime.
- The session ID stays inside this call. The subagent receives the **digest path**,
  so nothing depends on env vars crossing the subagent boundary.
- `--max-text 2000` (vs. the script's 600 default) keeps the long closing summaries
  intact — for a handoff those are the highest-value records in the transcript.
- **If the digest fails, say so and fall back to `--inline`.** Do not delegate a
  brief-only handoff without telling the user; a brief-only document is
  indistinguishable from a well-sourced one, and that is the failure worth avoiding.
- The `amq` block is outside the `&&` chain, so a project with no AMQ in play prints
  one line and costs nothing. It captures the *resolved* routing context
  (`amq env --json` → handle, root, session, base root), the live peers
  (`amq who --json`), and whatever is still sitting in the inbox at exit. Record what
  `amq env` resolved; never a root you typed. **Peek, never drain** — `amq list --new`
  is non-destructive, whereas draining here would consume the messages the next
  session is supposed to receive.

### 2. Write the salience brief

From your live context, not the transcript. 200–400 words, concrete:

- **Next step** — the specific first action for the fresh session.
- **Decided vs. open** — what is settled, and what is still a live question. Split
  "open" honestly: a question you can answer with a command is not open, it is
  unfinished — answer it now rather than briefing it as open. What remains is
  either a genuine unknown (label it) or a decision the user owes (see below).
- **Decisions the user must make** — real forks only, each with options and your
  recommendation. These go *into the document* under `## Decisions needed`, not
  into your closing message.
- **Traps** — what will bite: ordering constraints, stale build artifacts,
  environment gates, anything discovered the hard way this session.
- **Don't touch** — deliberate non-goals and out-of-scope areas.
- **Verification state** — what was actually run and observed, and what was not.
- **Open loops with others** — anything this session owes a party outside itself: a reply
  owed to a peer agent (AMQ), a review or PR someone is waiting on, a background job whose
  result another party expects, a promise made in a message you sent. Name the channel, the
  counterpart, and the exact commitment — and if a task's completion depends on reporting
  the result, say so where that task is described, not only here. A transcript records the
  messages but not that one of them created an obligation, so this is the class the
  subagent structurally cannot recover. Omit it and the next session defaults silently.
- **Window slug** — 2–4 dashed words naming the work the *next* session picks up, per
  the `## Window slug` contract below. You are the only one who can pick this: the
  transcript shows what this session did, whereas the title has to name what the next
  one will do. Never the project directory name.
- **AMQ state** — if this session talked to another agent over AMQ, the next session
  has to be able to rejoin the conversation, not just read about it. Supply everything
  in the `## AMQ coordination` contract below. The step-1 capture gives you the
  mechanical half (handle, root, session, peers, undrained count); you supply what it
  cannot see: which threads carry live work, what each peer is currently doing or
  waiting on, and **the background monitor**. See the contract for why the monitor is
  the piece that must not be lost.

### 3. Delegate

Launch the writer subagent on Sonnet with: the digest path, the salience brief
verbatim, the git facts from step 1, the AMQ capture from step 1 (verbatim —
including the monitor command, which the digest shows only as a single opaque tool
call), the window slug from step 2, the target file path, and any tailoring the user
passed.

**Two ways to reach the writer — use whichever is available:**

- **`handoff-writer` as a subagent type.** `install.sh` copies
  `agents/handoff-writer.md` into `~/.claude/agents/`, which registers it as a
  user-scope agent. If it appears in the available agent types, launch it
  directly.
- **Otherwise, a general-purpose subagent on Sonnet**, whose prompt begins:
  *"Read `${CLAUDE_SKILL_DIR}/agents/handoff-writer.md` and follow it exactly as
  your system instructions."* followed by the same payload. This is the fallback
  for anyone who copied the skill directory without running `install.sh` — the
  writer's instructions ship inside the skill either way, so nothing is lost but
  one extra file read.

Do not skip the Sonnet override. Write mode exists partly to move the drafting off
the main loop's model onto a cheaper one against a fresh context; inheriting the
session model gives up half the benefit.

### 4. Arm the relaunch, then report

**Arm first — it is a tool call, and the report is your last message, so nothing
can come after it.** Unless `--no-relaunch` appears in the arguments, write the
document's project-relative path as the only line of a sentinel file:

```bash
printf '%s\n' ".claude/handoffs/<name>.md" > .claude/handoffs/.relaunch
```

That is the entire obligation. A `Stop` hook
(`~/.claude/hooks/handoff-relaunch.sh`, installed by this skill's `install.sh`)
consumes the sentinel once this turn ends: it replaces the tmux window this
session is running in with a fresh `claude` already running
`/handoff --read <that doc>`, so the next session is waiting, primed, whenever
the user comes back to it. Outside a tmux pane — say the VS Code extension — it
opens a window in the session named by the project's `.tmuxp.yaml` instead. The
hook deletes the sentinel whether or not it acts, so a stale one never re-fires.

**The relaunch half is tmux-only, and that is fine.** With no tmux on the machine,
or with the `Stop` hook not registered, the hook is absent or exits 0 immediately;
the sentinel is a stray dotfile and nothing else happens. Arming it is therefore
always safe. The rest of this skill — the document, the living-record discipline,
`--read`, `--next` — does not touch tmux and works in any harness. If you do not
use tmux, install the skill and skip the hook: you lose the auto-respawn and keep
everything else.

**Do not mention the relaunch in your message.** It either happened or the hook
logged why to `~/.claude/logs/handoff-relaunch.log`; narrating it spends the
context this skill exists to end. Skip the sentinel entirely when `--inline`
was used because the digest failed and the document is thin, or when the user is
plainly still working in this session — arming it takes the window out from under
them.

Then:

**Say that the document was written and where. That is the whole message.**

```
Handoff written to `.claude/handoffs/<name>.md`
```

No summary of the document's contents, no recap of the session, no next-step
advice, no observations you had while reviewing it. The point of this skill is
to *end* a session — commentary here is spent in the context the handoff exists
to escape, and the next session cannot read it anyway.

The subagent's return is input for you, not something to relay: use it to decide
whether the document needs amending, then drop it. Do not re-read the document to
second-guess its prose; it is finished.

**Everything actionable goes in the document instead.** If the subagent reports a
digest-vs-brief conflict, if you spot a gap, or if you learn something after the
write that changes it — the base branch moved, a referenced spec landed, a number
you cited is now wrong, the user asks a question whose answer belongs in the doc —
**amend the file**, then restate the path. A correction spoken in chat dies with
this session; the next agent reads only the file. And if the user does want to
discuss it, they can do that against the written doc in a fresh context window,
which is the cheaper place for it.

The test before you send any message about a handoff: *would the next session need
this?* If yes, it belongs in the document and you are not finished. If no, it does
not belong in your message either. This is a recurring failure — the doc gets
written, then the real state of the world arrives one turn later and gets narrated
instead of filed.

The one thing that may accompany the path is a **caveat about how the document was
produced** — digest unavailable, brief-only source, `--inline` fallback, subagent
failure. That is a statement about the artifact's reliability, which the user needs
now and the next session cannot infer.

### `--inline`

Skip the subagent and write the document yourself in this session, per the rules at
the top of Write mode. Use when the session is short enough that delegation is not
worth it, when the transcript digest is unavailable, or when the handoff turns on
reasoning that only the live context holds.

Step 4 still applies verbatim: arm the sentinel, then report the path, nothing
else. Writing the document yourself makes the pull toward summarizing it stronger,
not weaker — resist it.

The `## AMQ coordination` contract applies unchanged — run step 1's `amq` block and
write the section yourself. Working from live context makes this *easier* to skip,
not harder: you still remember the monitor, so it does not feel like something that
needs writing down. It does.

### `--no-relaunch`

Write the document and stop there — no sentinel, so the window this session is
running in survives. Use it when the handoff is a checkpoint rather than an exit:
you are writing the doc but staying in this session, or you want to read the
document over before anything acts on it.

---

## Next mode (`--next`)

For a session that began with `--read` and has been keeping that document current
per Read mode step 7. The document already *is* the handoff; a second one would
fragment the record across two files and leave the next reader guessing which is
live. So: **bring the existing document fully current, arm the relaunch on that
same path, and write no new file.**

`--next` is not "skip the write and relaunch". A maintained doc is current as of
the last time you touched it, not as of now — the trailing stretch of the session
is exactly the part that is missing, and exactly the part the next session needs.
Refresh it.

Run Write mode steps 1–4 with four differences:

1. **Determine the target.** In order: a file path token after `--next`; else the
   document this session loaded in Read mode; else stop and say so. **Do not fall
   back to the most recent file in `.claude/handoffs/`** — Read mode may do that
   because reading the wrong document costs one turn, whereas rewriting the wrong
   one destroys it. If this session never read a handoff and no path was given,
   say that and offer a bare `/handoff` (new document) or `--next <path>`.
2. **Step 2's brief covers the delta**, not the session: what changed since the
   document last said anything — work finished, items discovered, decisions
   settled, traps hit, and anything now *wrong* in the file. Name the sections you
   believe are stale. You are the only one who can see the difference between what
   the file claims and what you know.
3. **Step 3 delegates in revise mode** — the same `handoff-writer` subagent, but
   pass the document as an **existing document to revise**, not as a target path
   to create. Its Revise mode rules govern what is preserved and what is rewritten.
   `--inline` opts out as usual, and you revise it yourself under those same rules.
4. **Step 4 is unchanged**: arm the sentinel with that same path, then report.
   `--no-relaunch` still opts out, which makes `--next --no-relaunch` the "final
   sweep of the doc, but I'm staying here" form.

Report the refresh rather than implying a new file:

```
Refreshed `.claude/handoffs/<name>.md`
```

**If the work in the document is finished** — every item ticked and nothing
discovered to replace them — say that instead, and do not arm the relaunch.
Respawning a window to read a completed handoff spends the window and the next
session's first turn to learn there is nothing to do.

---

## The `## Window slug` contract

The document carries a short tmux window title naming **the work**, which Read mode
applies to the window it resumes in. Write mode produces it; Read mode consumes it.
Unlike AMQ, this section is **never omitted** — every handoff has work to name.

```markdown
## Window slug

`handoff-relaunch-race`
```

- **2–4 dashed lowercase words, 40 characters max.** The rename script truncates at
  40; longer titles are silently cut mid-word.
- **Name the work, not the project or the file.** A slug that is just the repo's
  name is precisely the failure this exists to prevent — a title identical for every
  session in the repo tells the reader nothing about which window holds what. The
  document's own
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

---

## The `## AMQ coordination` contract

**Optional — skip this whole contract if you do not use [AMQ](https://github.com/agentience/amq).**
Step 1's gather already guards on `command -v amq`, so a machine without it
prints one line and costs nothing, and Write mode omits the section. Nothing else
in this skill depends on AMQ. The contract is kept because the *shape* is the
reusable part: if you coordinate agents over some other channel, this is the
template for recording it — which channel, which peers, what is owed, and above
all what was watching the inbox.

If this session communicated with another agent over AMQ, the handoff document
carries an `## AMQ coordination` section. Write mode produces it; Read mode reads it
back and rebuilds the channel. Both halves depend on the same shape.

**Omit the section entirely when no AMQ traffic occurred.** An empty section reads as
"there was a channel and it is now dead," which is worse than silence.

```markdown
## AMQ coordination

- **Handle**: `claude` (`AM_ME`)
- **Root**: `.agent-mail/collab` — session `collab`, base root `.agent-mail`
- **Entered via**: `amq coop exec claude -- --dangerously-skip-permissions`
  (or: plain shell + `eval "$(amq env --me claude)"`)
- **Peers**: `codex` — same project, same session, last seen 2026-08-03 17:40
- **Live threads**: `p2p/claude__codex` (implementation), `spec/e2e-isolation` (design)
- **Owed**: reply to codex on `p2p/claude__codex` confirming the tag format, msg `<id>`
- **Inbox at exit**: 0 new, verified 2026-08-03 18:02 (`amq list --new`)
- **Background monitor**: (see below, or `none`)
```

- **Record what `amq env` resolved, never a path you typed.** Roots are per-worktree
  and per-session, so a hardcoded root can point the next session's messages at a
  mailbox nobody reads.
- **Cross-project peers**: name the project as well as the handle, and say whether the
  peer is registered in `.amqrc` on *both* sides — round-trip messaging needs both.
- **Owed replies go here *and* beside the task they gate.** A reader working the task
  list must not have to find this section to learn that a task is not done until
  someone has been told.

### The background monitor

This is the piece most likely to be lost. A monitor is nearly invisible in a
transcript digest — one tool call at the top of the session, after which its
notifications look like they arrive from nowhere. If the next session does not
restart it, the peer's messages land in the inbox unseen and the session works on
happily while another agent waits. Record it verbatim:

````markdown
- **Background monitor**: yes — `Monitor` tool, `persistent: true`,
  description `"amq inbox — codex"`
  ```bash
  <the exact command, copied from the tool call>
  ```
````

State which primitive ran it, because they restart differently:

| Primitive | Restart with |
|---|---|
| `Monitor` tool | `Monitor` with the same `command`, `description`, and `persistent`/`timeout_ms` |
| Bash `run_in_background` | the same command, `run_in_background: true` |
| `amq wake` under a supervisor (launchd/systemd) | nothing — it outlives the session. Say so, so the next session does not double-start it. |

Also record, where they applied: the poll interval; any filter, label, or priority the
monitor watched rather than the whole inbox; and any `--interrupt-cmd` setting on
`amq wake`. That last one is an operator's decision, not something to re-derive —
`none` is the safe default, while `ctrl-c` sends a real SIGINT to the foreground
process group and can interrupt or crash the agent.

---

## Read mode (`--read`)

Resume work by reading a handoff doc and using it to kick off this session. Parse everything after `--read` as follows:

1. **Determine the file to read.** Look at the first token after `--read`:
   - If it looks like a file path — it contains a `/`, ends in `.md`, or names a file that exists (try it as given and as a path relative to `.claude/handoffs/`) — use that file. Consume this token.
   - Otherwise (including when nothing follows `--read`), default to the **most recent** markdown file in `.claude/handoffs/` by modification time. Determine it with:
     ```
     ls -t .claude/handoffs/*.md | head -1
     ```

2. **Collect kickoff instructions.** Any remaining text after `--read` (i.e. everything except the consumed file-path token, if there was one) is extra instructions from the user to incorporate into how this session begins. If the first token was *not* a file path, all of the text after `--read` is instructions.

3. **Read the chosen file.** Use it to rebuild the context needed to continue the work.

4. **Re-establish AMQ coordination.** If the document has an `## AMQ coordination`
   section, that channel is part of the state you are resuming — rebuild it before
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

5. **Name the window.** Read the `## Window slug` section and apply it, silently:

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

6. **Kick off the session.** Briefly confirm to the user which handoff file you loaded and give a short summary of where things stand and what you understand the next step to be. If kickoff instructions were provided, fold them into that plan and let them steer the focus. If step 4 ran, add one line for it: the monitor you restarted, anything the drain surfaced, and any AMQ step that failed.

7. **Keep the document current for the rest of the session.** The file you just read
   is now *your* working record, not the previous session's artifact. Edit it as the
   work moves — not at the end, when the session may not get an end.

   - **Tick a work item the moment it is done**, `- [ ]` → `- [x]`. Mark one you
     have started `- [ ] **(in progress)**` with a line on where it stands, so an
     interrupted session leaves a half-finished item legible rather than looking
     untouched.
   - **Add items you discover**, and strike or delete ones the work made moot —
     saying why in one clause. A stale item costs the next session a re-investigation.
   - **Append to `## Progress log`**, one dated line per meaningful change
     (`date +"%Y-%m-%d %H:%M"`). Append; do not rewrite earlier entries.
   - **Move the answers up.** When you settle something listed under
     `## Decisions needed` or as an open question, record the decision and its
     rationale in the document and remove it from the open list. When you hit a new
     trap, add it beside the item it bites.
   - **Refresh `**Last Updated**` on every edit**, and re-date any verification
     claim you re-ran (`223/227, verified <date> on <sha>`).
   - **Do not narrate the update.** Editing the file is the report; do not also
     summarize the change back to the user.

   If those sections are missing — an older handoff, or one written elsewhere — add
   them in the shape described under Write mode rather than tracking status only in
   your own head or a TodoWrite list. Both die with the session; the file does not.

   Update the file in place. Do not fork a `-v2` or write a fresh handoff mid-session
   — that splits the record, and a later reader has no way to tell which half is
   current.

8. **End the session with `/handoff --next`.** Because step 7 kept this
   document current, the way to hand off is to bring *it* fully up to date and relaunch
   on it — not to write a second document describing the same work. Next mode does
   both. A bare `/handoff` still writes a new document, which is the right
   call only when the work has genuinely outgrown the file you read.

Read mode does **not** delegate — it is the session's opening move, and the context
it builds is the context the session then works in.

### Examples

- `--read` → read the most recent handoff in `.claude/handoffs/` and continue.
- `--read .claude/handoffs/staging-cutover.md` → read that specific file and continue.
- `--read staging-cutover.md` → resolve to `.claude/handoffs/staging-cutover.md` and continue.
- `--read focus on the failing tests first` → no file path given, so read the most recent handoff **and** prioritize the failing tests.
- `--read staging-cutover.md skip the Typesense rebuild` → read that file **and** incorporate "skip the Typesense rebuild" into the kickoff.

---

## `scripts/digest-transcript.ts`

Ships **inside this skill**, at `${CLAUDE_SKILL_DIR}/scripts/digest-transcript.ts`.
Nothing else needs to be installed for it — `${CLAUDE_SKILL_DIR}` is substituted
into this file at load time and resolves to an absolute path, so the script is
reachable regardless of cwd and regardless of whether the skill was installed
personally (`~/.claude/skills/`), per-project (`.claude/skills/`), or as part of
a plugin.

**The braces are mandatory.** `${CLAUDE_SKILL_DIR}` is a literal text
substitution performed when the skill loads, not an exported environment
variable — bare `$CLAUDE_SKILL_DIR` is never set and silently expands to the
empty string, which turns the path into `/scripts/digest-transcript.ts`.
Requires Claude Code **2.1.69 or newer**, the release that added the variable.

It reduces a session transcript (main loop plus all subagent sidecars) to a
timestamped markdown timeline at roughly 1.5% of raw size — a 1.9 MB session
digests to ~31 KB. It keeps user/assistant text, tool calls as one-liners, and
tool-result *errors*; it drops thinking blocks and non-error tool-result bodies.
That last omission is why step 2 exists.
