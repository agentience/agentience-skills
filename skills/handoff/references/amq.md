# The `## AMQ coordination` contract

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
