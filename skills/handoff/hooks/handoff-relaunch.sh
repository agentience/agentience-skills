#!/bin/bash
#
# Stop hook — relaunch a fresh Claude session in tmux to READ a handoff doc that
# the session just wrote.
#
# Contract: `/handoff` write mode drops a sentinel at
#   <project-root>/.claude/handoffs/.relaunch.<session_id>
# whose first line is the path of the document it wrote (relative to the project
# root). This hook consumes that sentinel — reads it, deletes it, acts on it —
# and is a silent no-op when it is absent, which is every other Stop event.
#
# Why a Stop hook rather than the command doing this inline: replacing the window
# kills the claude process. Done inline, the "Handoff written to ..." line never
# renders and any later turn in the same session is impossible. Stop fires after
# the final message is out and the session is idle, which is exactly when the
# window is safe to take.
#
# Window handling:
#   - inside a tmux pane  -> `respawn-window -k` replaces THAT window in place.
#     Same index, no window growth, and no race between spawning the replacement
#     and killing the process doing the spawning.
#   - outside tmux (VS Code extension: no $TMUX_PANE) -> `new-window` in the
#     session named by ./.tmuxp.yaml, creating that session detached if needed.
#
# Never blocks and never fails a turn: every path exits 0.
#
# Environment overrides (all optional):
#   HANDOFF_RELAUNCH_DISABLE   non-empty -> exit immediately, do nothing. The
#                              off switch; also what a wrapper sets around a
#                              nested/automated `claude` invocation.
#   HANDOFF_COMMAND            the slash command the new session runs.
#                              Default `/handoff`. Set this if you installed the
#                              skill under a different name, or if you reach it
#                              through a plugin namespace (e.g. `/myplugin:handoff`).
#   HANDOFF_CLAUDE_ARGS        args passed to `claude` before the prompt.
#                              Default `--dangerously-skip-permissions` — see the
#                              comment at the launch line for why that default is
#                              load-bearing rather than a preference. Set it to
#                              the empty string to pass no args at all; leave it
#                              unset to get the default.

set -uo pipefail

# The off switch, checked before anything else.
[ -n "${HANDOFF_RELAUNCH_DISABLE:-}" ] && exit 0

LOG="$HOME/.claude/logs/handoff-relaunch.log"
mkdir -p "$(dirname "$LOG")" 2>/dev/null || true
log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"$LOG" 2>/dev/null || true; }

# Nested / automated sessions read the same user settings and would fire this
# hook too. Taking a window out from under a running orchestration is never
# wanted, and a child `claude` inherits $TMUX_PANE from its parent — so an
# unguarded nested session can respawn ITS PARENT'S window.
#
# AGENTIC_ENGINE_SESSION is one such marker (the agentic-workflow engine sets it
# on every session it spawns). Add your own orchestrator's marker here, or have
# it export HANDOFF_RELAUNCH_DISABLE, which is checked above.
[ -n "${AGENTIC_ENGINE_SESSION:-}" ] && exit 0

TMUX_BIN="$(command -v tmux 2>/dev/null || true)"
[ -z "$TMUX_BIN" ] && [ -x /opt/homebrew/bin/tmux ] && TMUX_BIN=/opt/homebrew/bin/tmux
[ -z "$TMUX_BIN" ] && [ -x /usr/local/bin/tmux ] && TMUX_BIN=/usr/local/bin/tmux
[ -z "$TMUX_BIN" ] && exit 0

input="$(cat 2>/dev/null || true)"

cwd=""
sid=""
if command -v jq >/dev/null 2>&1 && [ -n "$input" ]; then
    cwd="$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null || true)"
    sid="$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null || true)"
fi
[ -z "$cwd" ] && cwd="${CLAUDE_PROJECT_DIR:-$PWD}"
[ -z "$sid" ] && sid="${CLAUDE_CODE_SESSION_ID:-}"

# The sentinel is named for the session that wrote it: `.relaunch.<session_id>`.
#
# It used to be a single `.relaunch` per project root, and that is a real bug
# under concurrency, observed 2026-08-11: eight Claude sessions were open on one
# repo, session A wrote the sentinel, and session B's Stop event fired first.
# B consumed A's sentinel and respawned **B's own window** with **A's document** —
# so B's window was destroyed, B's context was lost, A's window survived when it
# should have been replaced, and the document was picked up by a session that had
# never been part of that work. Nothing about it looked like a failure: the
# relaunch "worked", just to the wrong window.
#
# Scoping by session_id makes ownership explicit, so concurrent sessions in one
# repo cannot steal each other's relaunches.
sentinel_name=".relaunch"
[ -n "$sid" ] && sentinel_name=".relaunch.$sid"

root=""
for candidate in "$cwd" "${CLAUDE_PROJECT_DIR:-}" "$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null || true)"; do
    [ -z "$candidate" ] && continue
    if [ -f "$candidate/.claude/handoffs/$sentinel_name" ]; then
        root="$candidate"
        break
    fi
done

# Housekeeping, only when we know our own id: clear a legacy unscoped sentinel
# and any scoped one left behind by a session that has since gone away. Deleting
# rather than acting on them is the point — an unscoped sentinel has no
# recoverable owner, and acting on it is exactly the bug above.
if [ -n "$sid" ]; then
    for d in "$cwd" "${CLAUDE_PROJECT_DIR:-}"; do
        [ -n "$d" ] && [ -f "$d/.claude/handoffs/.relaunch" ] || continue
        rm -f "$d/.claude/handoffs/.relaunch"
        log "removed a legacy unscoped sentinel in $d (owner unknowable — not relaunching)"
    done
    find "$cwd/.claude/handoffs" -maxdepth 1 -name '.relaunch.*' -mtime +1 \
        -delete 2>/dev/null || true
fi

[ -z "$root" ] && exit 0

sentinel="$root/.claude/handoffs/$sentinel_name"
doc="$(head -1 "$sentinel" 2>/dev/null | tr -d '\r\000-\010\013\014\016-\037')"
# Consume unconditionally. A malformed sentinel must not re-fire on every
# subsequent Stop for the rest of the session.
rm -f "$sentinel"
[ -z "$doc" ] && { log "empty sentinel in $root"; exit 0; }

# Normalize to a project-relative path and confirm the document is really there.
# A bare filename resolves under .claude/handoffs/, matching how read mode itself
# resolves its argument — so a sentinel written either way still works.
case "$doc" in
    /*) doc_abs="$doc"; doc_rel="${doc#"$root"/}" ;;
    *)  doc_abs="$root/$doc"; doc_rel="$doc" ;;
esac
if [ ! -f "$doc_abs" ] && [ -f "$root/.claude/handoffs/$doc" ]; then
    doc_rel=".claude/handoffs/$doc"
    doc_abs="$root/$doc_rel"
fi
if [ ! -f "$doc_abs" ]; then
    log "sentinel named a missing doc: $doc_abs — not relaunching"
    exit 0
fi

# Session name from the project's tmuxp config, else the repo folder name.
session=""
if [ -f "$root/.tmuxp.yaml" ]; then
    strip=$'"\' \t\r'   # quotes and surrounding whitespace around the yaml value
    session="$(grep -m1 -E '^[[:space:]]*session_name:' "$root/.tmuxp.yaml" 2>/dev/null \
        | sed -E 's/^[[:space:]]*session_name:[[:space:]]*//' \
        | tr -d "$strip")"
fi
[ -z "$session" ] && session="$(basename "$root")"

# Window title from the handoff slug, sanitized the same way tmux-rename.sh does.
title="$(basename "$doc_rel" .md | tr -d '\000-\037' | tr ' ' '-' | cut -c1-40)"
[ -z "$title" ] && title="handoff"

# The hook inherits this session's PATH, so `claude` usually resolves here even
# when a bare login shell in a fresh window would not find it.
CLAUDE_BIN="$(command -v claude 2>/dev/null || true)"
if [ -z "$CLAUDE_BIN" ]; then
    for c in "$HOME/.claude/local/claude" "$HOME/.local/bin/claude" \
             /opt/homebrew/bin/claude /usr/local/bin/claude; do
        [ -x "$c" ] && { CLAUDE_BIN="$c"; break; }
    done
fi
[ -z "$CLAUDE_BIN" ] && CLAUDE_BIN="claude"

prompt="${HANDOFF_COMMAND:-/handoff} --read $doc_rel"

# The auto-run design requires `--dangerously-skip-permissions`: the relaunched
# session runs `--read` immediately, in a window nobody is watching. A permission
# prompt there does not get answered — it blocks until the user walks up hours
# later and finds a session that never started. Override via HANDOFF_CLAUDE_ARGS
# if you would rather the window wait for you than act unattended.
#
# Fall back to an interactive shell if claude exits or was never resolvable, so a
# respawn can never leave you with a vanished window and no way back.
# Written out rather than inlined as ${VAR-default}: the default itself starts
# with a dash, which makes the inline form parse correctly but read as a typo.
claude_args="--dangerously-skip-permissions"
[ -n "${HANDOFF_CLAUDE_ARGS+set}" ] && claude_args="$HANDOFF_CLAUDE_ARGS"

# %s, not %q, for the args: it is a word list and must stay splittable.
launch="$(printf '%q %s %q' "$CLAUDE_BIN" "$claude_args" "$prompt")"
launch="$launch; printf '\n[handoff-relaunch] claude exited (%s) — %s\n' \"\$?\" $(printf '%q' "$doc_rel"); exec \"\${SHELL:-/bin/zsh}\" -l"
shell_cmd="$(printf '%q -l -c %q' "${SHELL:-/bin/zsh}" "$launch")"

pane="${CLAUDE_TMUX_PANE:-${TMUX_PANE:-}}"

# Give the final assistant message a beat to render before the window is taken.
sleep 1

if [ -n "$pane" ] && "$TMUX_BIN" display-message -p -t "$pane" '#{window_id}' >/dev/null 2>&1; then
    target="$pane"
    "$TMUX_BIN" respawn-window -k -t "$pane" -c "$root" "$shell_cmd" 2>>"$LOG" || {
        log "respawn-window failed for pane $pane"
        exit 0
    }
    log "respawned $pane in place -> $doc_rel"
else
    if ! "$TMUX_BIN" has-session -t "=$session" 2>/dev/null; then
        "$TMUX_BIN" new-session -d -s "$session" -c "$root" "$shell_cmd" 2>>"$LOG" || {
            log "new-session $session failed"
            exit 0
        }
        target="$session:"
        log "created session $session -> $doc_rel"
    else
        target="$("$TMUX_BIN" new-window -P -F '#{window_id}' -t "=$session:" -c "$root" "$shell_cmd" 2>>"$LOG")" || {
            log "new-window in $session failed"
            exit 0
        }
        log "new window $target in $session -> $doc_rel"
    fi
fi

"$TMUX_BIN" set-window-option -t "$target" automatic-rename off >/dev/null 2>&1 || true
"$TMUX_BIN" rename-window -t "$target" "$title" >/dev/null 2>&1 || true

exit 0
