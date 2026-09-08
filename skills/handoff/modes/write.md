# Write mode (default)

> **Before you write anything**, read
> [references/document-contract.md](../references/document-contract.md) — the size
> budget and the living-record rules that govern the document's shape.

Write a handoff document that summarizes the current conversation so a fresh agent
can continue the work. Store it in `.claude/handoffs/` as a kebab-case `.md` file
named after the work (e.g. `.claude/handoffs/e2e-isolation-tags-phase-2.md`).
Provide any details necessary to continue the work without losing necessary context.

Do not duplicate content already captured in other artifacts (PRDs, plans, ADRs,
issues, commits, diffs). Reference them by path or URL instead.

**The document ships ready to read — no caveats delivered to the user.** The
document is the entire deliverable; your closing message is a pointer to it, not a
summary of it (see step 4). This holds in both delegated and `--inline` mode, and
the full statement of it lives in `agents/handoff-writer.md` under Rules. In short:

- **Resolve, don't hedge — within scope.** Anything checkable with a command gets
  checked and written as an answer. *"May already be merged by the time you read
  this"* is homework handed to the next session; run the `git log`.
  **"Checkable" means claims this document asserts — not questions the document
  hands onward.** Verify the state you describe; never develop the remedy you
  recommend. Confirming that a table is still missing, because the document is
  about to say so, is handoff work. Finding out which env file carries the prefix
  that would create it is the next session's first turn, and it is far cheaper
  there — you are at the top of a full context window, which is the single most
  expensive place in a session to spend a turn. If a command's only purpose is to
  make the *recommendation* more specific rather than the *description* more
  accurate, it is out of scope: write what you know and hand the question on.
- **Date what you verified.** Shas, versions and counts go stale fast on an active
  repo. Say what was confirmed and when, and which figures drift.
- **Decisions the user owes go in the doc**, under `## Decisions needed`, with
  options and a recommendation — never left in conversation, which the next session
  cannot read.

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
OUT="${TMPDIR:-/tmp}/handoff-$CLAUDE_CODE_SESSION_ID"; mkdir -p "$OUT"
echo "--- session ---"; echo "$CLAUDE_CODE_SESSION_ID"
echo "--- digest ---"
"${CLAUDE_SKILL_DIR}/scripts/digest.sh" \
  --session "$CLAUDE_CODE_SESSION_ID" --max-text 2000 --out "$OUT/digest.md" \
  || echo "DIGEST FAILED (exit $?)"
echo "--- git ---"
git branch --show-current; git log --oneline -5; git status --short
ls -t .claude/handoffs/*.md 2>/dev/null | head -5
if command -v amq >/dev/null 2>&1; then
  echo "--- amq env ---";   amq env --json
  echo "--- amq who ---";   amq who --json
  echo "--- amq inbox ---"; amq list --new
else echo "--- amq: not in PATH ---"; fi
```

**The sections are separated by `;` and not `&&` on purpose.** They used to be one
`&&` chain, which meant a failed digest silently took the git facts down with it —
you would lose the branch, the recent commits and the working-tree state at the same
moment, and the most likely reason for that failure (`npx` not on PATH) has nothing
to do with git. Each block now stands or falls alone.

else echo "--- amq: not in PATH ---"; fi
```

Keep it to **one** call — batching is the point; each extra round trip costs a full
context re-send, which is what this mode exists to avoid.

- `CLAUDE_CODE_SESSION_ID` is exported to every Bash call and is per-session, so it
  is safe under concurrent sessions. Never fall back to picking the newest `.jsonl`
  by mtime.
- **The `--- session ---` line is the value you carry into step 3** for the
  document's `## Session trail` row. Nothing depends on env vars crossing the
  subagent boundary: the subagent receives the digest **path** and the session ID
  as a **literal string in its prompt**, never `$CLAUDE_CODE_SESSION_ID` to
  expand for itself — a subagent's shell is not this session's shell, and an ID it
  resolved on its own would name the wrong session.
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
- **Verification state** — what was actually run and observed *during the session*,
  and what was not. This is a report of work already done, not a prompt to go do
  more: an unverified claim is disclosed as unverified, per the scope clause on
  *Resolve, don't hedge* above. The one exception is a load-bearing fact the
  document asserts and time may have invalidated — confirm that with a command.
- **Open loops with others** — anything this session owes a party outside itself: a reply
  owed to a peer agent (AMQ), a review or PR someone is waiting on, a background job whose
  result another party expects, a promise made in a message you sent. Name the channel, the
  counterpart, and the exact commitment — and if a task's completion depends on reporting
  the result, say so where that task is described, not only here. A transcript records the
  messages but not that one of them created an obligation, so this is the class the
  subagent structurally cannot recover. Omit it and the next session defaults silently.
  **Each of these also becomes an unticked work item naming the counterparty** — see
  the *living record* rules in
  [references/document-contract.md](../references/document-contract.md). Described in a
  section alone, an obligation reads as already-arranged and therefore already met.
- **Window slug** — 2–4 dashed words naming the work the *next* session picks up, per
  the [`## Window slug` contract](../references/window-slug.md). You are the only
  one who can pick this: the
  transcript shows what this session did, whereas the title has to name what the next
  one will do. Never the project directory name.
- **AMQ state** — if this session talked to another agent over AMQ, the next session
  has to be able to rejoin the conversation, not just read about it. Supply everything
  in the [`## AMQ coordination` contract](../references/amq.md). The step-1 capture
  gives you the
  mechanical half (handle, root, session, peers, undrained count); you supply what it
  cannot see: which threads carry live work, what each peer is currently doing or
  waiting on, and **the background monitor**. See the contract for why the monitor is
  the piece that must not be lost.

### 3. Delegate

Launch the `handoff-writer` subagent (Sonnet) with: the digest path, the salience
brief verbatim, the git facts from step 1, the AMQ capture from step 1 (verbatim —
including the monitor command, which the digest shows only as a single opaque tool
call), the window slug from step 2, **the session ID from step 1's `--- session ---`
line**, the target file path, and any tailoring the user passed.

The session ID is a literal to copy, not a variable to pass — it seeds the
document's [`## Session trail`](../references/session-trail.md), whose whole value
is that it names the session whose transcript stands behind the document.

### 4. Arm the relaunch, then report

**Arm first — it is a tool call, and the report is your last message, so nothing
can come after it.** Unless `--no-relaunch` appears in the arguments, write the
document's project-relative path as the only line of a sentinel file:

```bash
ARMED=".claude/handoffs/.relaunched.$CLAUDE_CODE_SESSION_ID"
if [ -e "$ARMED" ]; then
  echo "ALREADY RELAUNCHED for $(cat "$ARMED") — not arming again"
else
  {
    printf '%s\n' ".claude/handoffs/<name>.md"
    printf 'split=1\n'   # ONLY if --split was passed — drop this line otherwise
  } > ".claude/handoffs/.relaunch.$CLAUDE_CODE_SESSION_ID"
  echo "sentinel armed"
fi
```

The first line is the document and is the whole sentinel in the ordinary case.
Lines after it are `key=value` options for the hook; `split=1` is the only one, and
it is written **only** when `--split` appears in the arguments (see `--split`
below). The hook ignores keys it does not know, so a sentinel written by a newer
command still relaunches under an older hook — it just relaunches the old way.

**If it prints `ALREADY RELAUNCHED`, this session has already handed off and its
successor is already running.** Stop: do not arm, do not re-report a path as
though this were a fresh handoff, and do not redo the write. Answer whatever woke
you, or say the handoff already went out, and end the turn.

**Why the guard, the session-id suffix and the sentinel exist at all** — including
the two incidents that put them there, and what the `Stop` hook does once this turn
ends — are in [references/relaunch.md](../references/relaunch.md). Read it before
changing any of this; do not re-derive it.

**Do not mention the relaunch in your message.** It either happened or the hook
logged why to `~/.claude/logs/handoff-relaunch.log`; narrating it spends the
context this skill exists to end. Skip the sentinel entirely when `--inline`
was used because the digest failed and the document is thin, or when the user is
plainly still working in this session — arming it takes the window out from under
them. (`--split` is the other answer to that second case: the successor opens in a
pane below and this session keeps its own.)

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

The `## Session trail` contract applies unchanged too: seed it with your own row,
`wrote`, using the session ID step 1 printed.

The `## AMQ coordination` contract applies unchanged — run step 1's `amq` block and
write the section yourself. Working from live context makes this *easier* to skip,
not harder: you still remember the monitor, so it does not feel like something that
needs writing down. It does.

### `--split`

Relaunch **into a new pane below this one** instead of taking this one over. The
successor comes up beside the session that wrote the document, already reading it;
this session keeps its pane, its scrollback, and its ability to answer one more
question.

Mechanically it is one extra line on the sentinel — `split=1`, per step 4. Nothing
else changes: same document, same one-relaunch-per-session guard, same silence
about the relaunch in your closing message.

Use it when the finished session is still worth having on screen — checking what
the document claimed against what the successor does with it, or a handoff written
as a checkpoint you expect to refer back to. `--no-relaunch` is the stronger form
of the same instinct and spawns nothing at all; `--split` is the middle ground,
relaunching without evicting anyone.

**It composes with the other flags**, because it changes only where the successor
lands: `--next --split` refreshes the loaded document and opens the successor
below it, `--inline --split` writes the document in this session and does the same.
`--no-relaunch` wins over it — there is no sentinel to carry the option.

**Outside tmux and Herdr it does nothing at all** — not even the new-window
fallback the default path uses. A pane below this one is the entire request, and a
session that is in no multiplexer has no pane to sit below; spawning a window in
some other tmux session instead would be a different behaviour wearing this flag's
name. So in a VS Code extension session `--split` means "write the document,
relaunch nothing", and the hook logs that rather than acting.

The two backends and how they reach the same result are described in
[references/relaunch.md](../references/relaunch.md).

### `--no-relaunch`

Write the document and stop there — no sentinel, so the window this session is
running in survives. Use it when the handoff is a checkpoint rather than an exit:
you are writing the doc but staying in this session, or you want to read the
document over before anything acts on it.
