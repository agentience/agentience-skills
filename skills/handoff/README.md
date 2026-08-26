# `/handoff` — a document, not a transcript, carries the work forward

**Last Updated: 2026-08-26 11:47**

A Claude Code skill that ends a session by writing a handoff document, and starts
the next one by reading it. On tmux it closes the loop: the session that writes
the document arms a `Stop` hook which replaces its own window with a fresh
`claude` already reading that document, so the next session is waiting, primed,
whenever you come back.

The document is the unit of continuity. Not the transcript, not your memory of
what you were doing, not a TodoWrite list that dies with the session.

```mermaid
---
config:
  layout: elk
---
flowchart LR
    work("session does the work") --> cmd("/handoff<br/>write mode")
    cmd --> digest("digest the transcript")
    digest --> writer("handoff-writer subagent<br/>on Sonnet")
    writer --> doc[/"handoff document"/]
    cmd --> sentinel[/".relaunch sentinel"/]
    sentinel --> stop("Stop hook<br/>handoff-relaunch.sh")
    stop --> tmuxwin["tmux respawn-window -k"]
    tmuxwin --> fresh("fresh session<br/>/handoff --read")
    doc -.->|"read at startup"| fresh
    fresh --> work
    work -.->|"tick items, append progress"| doc
    classDef external stroke-dasharray:4 3
    class tmuxwin external
```

## Install

```bash
git clone https://github.com/agentience/agentience-skills.git
cd agentience-skills/skills/handoff
./install.sh --dry-run     # see every path it would touch
./install.sh
```

Then **start a new Claude Code session** — a running one keeps the skill text it
loaded at startup.

| Flag | Effect |
|---|---|
| *(none)* | symlink the skill, install the writer agent, register the `Stop` hook |
| `--copy` | copy the skill instead of symlinking it (default symlink means `git pull` updates it in place) |
| `--no-hook` | skip the tmux relaunch entirely |
| `--dry-run` | print what would happen, change nothing |
| `--uninstall` | reverse everything it installed |

It backs up `settings.json` before editing, matches on the command string so
re-running never double-registers, and removes only its own entry on uninstall.

### Requirements

| | Why | If missing |
|---|---|---|
| **Claude Code 2.1.69+** | the skill finds its bundled `digest-transcript.ts` through `${CLAUDE_SKILL_DIR}`, added in that release | the variable isn't substituted and the digest fails *silently*, degrading write mode to a brief-only document that looks identical to a well-sourced one |
| **Node 18+** | the digest runs through `npx tsx` | write mode falls back to `--inline` and says so |
| **tmux** | only for the relaunch | install with `--no-hook`; everything else works |
| **jq or python3** | only for editing `settings.json` during install | `install.sh` prints the JSON for you to paste |

`install.sh` checks all of these and tells you which case you're in.

**If you use nvm, fnm, asdf or volta, read this.** Those put `node` on your PATH
from an *interactive* shell rc, and the shell Claude Code's Bash tool spawns is
not interactive — so `node --version` working in your terminal does not mean the
skill can find it. `scripts/digest.sh` exists for exactly this: it probes the
usual version-manager layouts before giving up. Check with:

```bash
./scripts/digest.sh --probe
```

## The three modes

```mermaid
---
config:
  layout: elk
---
flowchart LR
    args{"how was /handoff<br/>invoked?"}
    args -->|"--read"| read("Read mode")
    args -->|"--next"| next("Next mode")
    args -->|"bare, or a description"| write("Write mode")

    write --> newdoc[/"a NEW document"/]
    next --> samedoc[/"the SAME document,<br/>revised in place"/]
    read --> resume("rebuild context,<br/>then keep the doc current")

    newdoc --> arm("arm the relaunch sentinel")
    samedoc --> arm
    resume -.->|"at session end"| next
    classDef external stroke-dasharray:4 3
```

**Write mode** (`/handoff`) digests the session transcript — main loop plus every
subagent sidecar — to about 1.5% of its raw size, then hands that digest plus a
salience brief to a Sonnet subagent that drafts the document. Delegating matters
more than it looks: write mode runs at the *end* of a long session, where every
main-loop turn re-sends the full accumulated context. The digest also survives
compaction, so it still holds the early dead ends your context window no longer
does.

**Read mode** (`/handoff --read`) rebuilds context from a document and — this is
the part that makes the system work — takes ownership of it. The document you
just read is now your working record, not the previous session's artifact. You
tick items as you finish them, add ones you discover, and append to the progress
log as you go, not at the end, because the session may not get an end.

**Next mode** (`/handoff --next`) refreshes the document you resumed from instead
of writing a second one describing the same work. A maintained document is
current as of the last time you touched it, not as of now — and the trailing
stretch of a session is exactly the part the next session needs. When that
trailing stretch is empty, though — you updated the document and the very next
thing that happened was `--next` — it relaunches on the document as it stands
rather than spending a digest and a subagent to conclude the file was already
right.

## What the document carries

Beyond the narrative: a `## Work items` checklist that a reader can tick, a dated
`## Progress log` a later session appends to rather than quietly rewriting, a
`## Decisions needed` section for real forks the user owes an answer on, and a
`## Window slug` — a 2–4 word tmux window title naming *the work the next session
picks up*, which read mode applies to its own window.

The document also carries its own update instruction, so it keeps working when
it's pasted into a fresh session or opened by a human rather than loaded through
this skill.

There is an optional `## AMQ coordination` contract for sessions that talk to
other agents over [AMQ](https://github.com/agentience/amq). Skip it if you don't
use AMQ — nothing else depends on it, and the section omits itself when there was
no traffic. The shape is the reusable part: which channel, which peers, what is
owed, and above all *what was watching the inbox*, which is the thing a
transcript makes nearly invisible.

## The tmux half is optional

The relaunch — sentinel, `Stop` hook, `respawn-window` — is the only
tmux-dependent part. Without tmux the hook is absent or exits immediately, the
sentinel is a stray dotfile, and nothing else changes. Install with `--no-hook`
and you keep the document, the living-record discipline, `--read` and `--next`,
which is most of the value and works in any harness.

`--no-relaunch` skips arming for a single run — the right call when the handoff
is a checkpoint and you're staying in the session, since arming it takes the
window out from under you.

## Environment overrides

`handoff-relaunch.sh` reads three variables, all optional:

| Variable | Default | Purpose |
|---|---|---|
| `HANDOFF_RELAUNCH_DISABLE` | unset | Non-empty disables the hook entirely. |
| `HANDOFF_COMMAND` | `/handoff` | The slash command the new session runs. Set it if you installed the skill under another name or reach it through a plugin namespace. |
| `HANDOFF_CLAUDE_ARGS` | `--dangerously-skip-permissions` | Args passed to `claude` before the prompt. Empty string passes none. |

That default is load-bearing rather than a preference: the relaunched session
runs `--read` immediately in a window nobody is watching, and a permission prompt
there is never answered — it blocks until you walk up hours later and find a
session that never started. If you'd rather the window wait for you, set
`HANDOFF_CLAUDE_ARGS` to the empty string.

**One hazard worth knowing:** a child `claude` inherits `$TMUX_PANE` from its
parent, so an unguarded nested session can respawn its *parent's* window. The
hook bails out when `AGENTIC_ENGINE_SESSION` is set; if you run an orchestrator
that spawns Claude sessions, have it export `HANDOFF_RELAUNCH_DISABLE`.

## What's in the box

| Path | What it is |
|---|---|
| `SKILL.md` | the skill itself — all three modes |
| `agents/handoff-writer.md` | the writer subagent, in write and revise modes |
| `scripts/digest.sh` | resolves node, then runs the digest — handles nvm/fnm/asdf/volta |
| `scripts/digest-transcript.ts` | transcript → timestamped markdown timeline |
| `hooks/handoff-relaunch.sh` | the `Stop` hook that consumes the sentinel |
| `hooks/tmux-rename.sh` | explicit window rename, used by read mode's window slug |
| `diagrams/*.mmd` | mermaid sources for the diagrams above |
| `install.sh` | opt-in installer / uninstaller |

`tmux-rename.sh` is left in place on uninstall — it's useful on its own, and you
may have been using it before this skill. It resolves its target from
`$TMUX_PANE` rather than trusting a bare `tmux rename-window`, which with no `-t`
targets the most-recently-active session server-wide and will happily rename a
window belonging to a different project.

## License

MIT — see [LICENSE](../../LICENSE).
