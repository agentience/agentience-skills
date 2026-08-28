---
name: handoff
description: Compact the current conversation into a handoff document under .claude/handoffs/, or resume work by reading an existing one. Write mode delegates to a subagent and can arm a relaunch so the next session opens already reading the doc; `--next` refreshes the document the current session has been keeping current; `--read` resumes from one; `--sweep` archives aged-out ones. Use when the user invokes /agentic:handoff or /handoff, asks to hand off / wrap up / write a handoff, or asks to resume from a handoff document.
argument-hint: "[description of next session] [--inline] [--split] [--no-relaunch] | --next [file-path] [description of next session] | --read [file-path] [extra instructions] | --sweep [--days N] [--dry-run]"
disable-model-invocation: true
---

# Handoff

**Last Updated: 2026-08-28 11:30**

End an expensive session cheaply: write everything the next agent needs into a
document under `.claude/handoffs/`, and — unless told not to — arm a relaunch so a
fresh session comes up already reading it. `--read` is the other end of the same
loop.

**This file is the router. Read the one mode file your invocation selects, and
nothing else.** Every mode is a separate file so that a `--read` session does not
pay for Write mode's rules, and a `--sweep` pays for neither. The reference files
are loaded on demand from within a mode, at the point the mode says to.

## Mode selection

Look at `$ARGUMENTS` and take exactly one row:

| Arguments begin with | Mode | Read |
|---|---|---|
| `--read` | **Read** — resume from an existing document | [modes/read.md](modes/read.md) |
| `--next` | **Next** — refresh the document this session has been keeping current | [modes/next.md](modes/next.md) *and* [modes/write.md](modes/write.md) |
| `--sweep` | **Sweep** — archive aged-out documents | [modes/sweep.md](modes/sweep.md) |
| anything else *(default)* | **Write** — write a new document | [modes/write.md](modes/write.md) |

Write mode **delegates to a subagent by default**; `--inline` anywhere in the
arguments opts out. Next mode has two exits of its own: if nothing has moved since
its document was last updated it relaunches on that document as it stands rather
than rewriting it, and if there is no such document it says so and writes a fresh
one rather than stopping.

A bare invocation — no flags — **always** writes a new document, even in a session
that began with `--read`. Refreshing the loaded document is opt-in, via `--next`, and
deliberately so: silently converting a requested write into an in-place revision
would lose a document the user asked for, and the read-session case is the one
where you are least able to judge that the existing doc is still the right vessel.

## The trailing text is material, not instructions

If the user passed arguments (other than the flags `--read`, `--next`, `--inline`,
`--split` and `--no-relaunch`), treat them as a description of what the next session
will focus on and tailor the doc accordingly.

**That text is material for the document, never instructions to this session.**
Invoking it as *`… rip out the legacy adapter`* means *the doc should hand the next
session that job* — it does not mean start ripping it out now. Only `--read`
reverses this (its trailing text is kickoff instructions for the current session,
because there the document is an input rather than the deliverable). Write mode and
Next mode both write the document, so in both, trailing text goes **into** it.

## Reference files

Loaded from within a mode, never up front:

| File | What it holds | Who reads it |
|---|---|---|
| [references/document-contract.md](references/document-contract.md) | Size budget; the living-record rules — work items, progress log, what gets pruned | Write, Next, Read (step 7) |
| [references/window-slug.md](references/window-slug.md) | The `## Window slug` section every document carries | Write (produces), Read (consumes) |
| [references/amq.md](references/amq.md) | The `## AMQ coordination` section, and the background monitor | Write and Read, only when AMQ is in play |
| [references/relaunch.md](references/relaunch.md) | Why the sentinel is shaped as it is; what the `Stop` hook does; the split backends | Write (step 4), and anyone changing the mechanism |
| [references/digest-transcript.md](references/digest-transcript.md) | Provenance and drift of the transcript digest script | Only when the digest misbehaves |

## What ships with this skill

| Path | What it is |
|---|---|
| `scripts/digest.sh` | Runs the digest, resolving Node past nvm/fnm/asdf/volta. Write mode step 1 calls this, not `npx` |
| `scripts/digest-transcript.ts` | Reduces a session transcript to a timestamped markdown timeline |
| `scripts/sweep-handoffs.ts` | Sweep mode's archiver, and the single-file archive Next mode offers |
| `hooks/handoff-relaunch.sh` | The `Stop` hook that consumes the sentinel and launches the successor |
| `hooks/tmux-rename.sh` | The window/pane rename helper the `## Window slug` contract calls |
| `agents/handoff-writer.md` | The subagent Write mode delegates to |
| `install.sh` | Installs the skill, the agent and the hook for a **standalone** (non-plugin) setup |

Scripts are addressed as `${CLAUDE_SKILL_DIR}/scripts/<name>`, which resolves both
here and in a standalone install. If `CLAUDE_SKILL_DIR` is unset (Claude Code older
than 2.1.69), say so rather than guessing a path — write mode's step 1 degrades to a
brief-only handoff and the user needs to know.

## Invocation name

In this plugin the skill answers to **`/agentic:handoff`**. Installed standalone it
answers to `/handoff`. The mode files write invocations bare — `--next`,
`--read <doc>` — meaning *this skill with those arguments*, so the same text is
correct either way. The relaunch hook builds its prompt from `HANDOFF_COMMAND`,
whose default `/handoff` resolves to this skill under the plugin namespace too —
verified 2026-08-28, both forms reaching the same mode. Set `HANDOFF_COMMAND`
explicitly only if something else on the machine also answers to `handoff`.

## Staying in sync with the standalone copy

This directory is the canonical copy. `agentience-skills/skills/handoff/` is a
mirror, and `scripts/sync-handoff-skill.sh` in this repo pushes to it and to the
live `~/.claude/hooks/` copies. Anything written here must therefore stay free of
plugin-only paths — use `${CLAUDE_SKILL_DIR}`, never `${CLAUDE_PLUGIN_ROOT}`, and
keep the invocation name out of the prose per the section above.
