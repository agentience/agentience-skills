# The relaunch mechanism

Why the sentinel is shaped the way it is, and what the `Stop` hook does with it.
Write mode's step 4 states the rules; this file is the reasoning behind them and
the two incidents that produced them. Read it before changing how the sentinel is
written or how the hook consumes it — every rule here was paid for once already.

The hook itself ships with this skill at
[hooks/handoff-relaunch.sh](../hooks/handoff-relaunch.sh); it is installed to
`~/.claude/hooks/` and registered as a `Stop` hook by
[install.sh](../install.sh).

## One relaunch per session

**The guard exists because a finished turn can be reopened.** Step 4 reads as the
last thing a session ever does, and usually is — but a background subagent that
returns after the report re-opens the turn with a task notification, and a session
resuming there will run step 4 again from the top, arming a second time. Observed
2026-08-26: one `--next`, one report at 14:48:53, a successor spawned at 14:48:54.
At 14:53:09 a `handoff-writer` subagent launched five minutes earlier finally
returned; the session woke, re-armed at 14:53:40, reported again, and a **second**
successor spawned at 14:53:45. Both opened the same document, in the same tab, and
began editing the same worktree — neither with any way to see the other. The
sentinel cannot carry this guard itself: the hook consumes it on the first fire, so
by the second arm there is nothing left to detect. `.relaunched.<session-id>` is
written by the hook when it actually launches, and outlives the sentinel.

## Why the sentinel is named after the session

**The `$CLAUDE_CODE_SESSION_ID` suffix is load-bearing — do not drop it.** The
sentinel used to be a single `.relaunch` per project root, which is fine for one
session and broken for two. Observed 2026-08-11 with eight Claude sessions open on
this repo: one session wrote the sentinel, a *different* session's `Stop` fired
first, consumed it, and respawned **its own** window running **the first
session's** document. The second session's context was destroyed, the first
survived when it should have been replaced, and the handoff was picked up by a
session that had never been part of that work. Nothing looked like a failure —
the relaunch "worked", just to the wrong window. Naming the sentinel after the
session that wrote it makes ownership explicit.

## What the hook does with it

That is the entire obligation. A `Stop` hook
(`~/.claude/hooks/handoff-relaunch.sh`) consumes the sentinel once this turn
ends: it replaces the tmux window this session is running in with a fresh
`claude` already running this skill's `--read <that doc>`, so the next
session is waiting, primed, whenever the user comes back to it. Outside tmux it
opens a window in the session named by the project's `.tmuxp.yaml` instead —
and with `split=1` on the sentinel it opens a pane below instead of taking this
window, leaving this session running. The
hook deletes the sentinel whether or not it acts, so a stale one never re-fires,
and it stamps `.claude/handoffs/.relaunched.<session-id>` with the document it
launched — the marker Write mode's step-4 guard reads, and the one the hook itself
checks
before relaunching a session that already has a successor.

**The marker is removed once the relaunched-from session is gone.** It guards a
session that can still reopen a turn, and nothing else. On the replace paths —
tmux `respawn-window -k`, Herdr's default close — the successor deletes it as its
first act, after the predecessor has been killed (tmux) or `pane list` confirms the
close (Herdr; a failed close leaves the marker in place, because that predecessor
can still wake). Where the predecessor keeps running — `split=1`, Herdr `beside`,
a new window opened from outside tmux — nothing observes it ending, so the marker
stays until the hook's day-old sweep.

## Split mode, backend by backend

The two backends reach the same result by different primitives, and the user-visible
behaviour is deliberately identical: tmux splits this pane with `split-window -v`,
Herdr with `pane split --direction down` and its close step skipped — that close is
only how Herdr imitates tmux's `respawn-window -k` on the default path, and split
mode is precisely the case where nothing should be replaced. Both focus the new
pane. Neither renames the window or tab: it now holds two sessions, and a name can
describe only one of them.
