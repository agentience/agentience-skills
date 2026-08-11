#!/usr/bin/env bash
# Rename the tmux window that owns THIS Claude session — and only that one.
#
# Why this exists: a bare `tmux rename-window <title>` does NOT target the
# caller. With no -t and no $TMUX in the environment, tmux falls back to the
# most-recently-active session on the socket, server-wide. Verified: from a
# shell with TMUX unset, `tmux rename-window PROBE` renamed financials:0 —
# a window belonging to an entirely different Claude session. With two
# attached sessions that fallback is a coin flip, so the symptom looks like
# "renames don't work" when in fact they land on the wrong project.
#
# The fix is to resolve the target from $TMUX_PANE, which a claude process
# started inside a pane inherits (e.g. TMUX_PANE=%36 -> financials:0.0), and
# to do NOTHING when that is absent rather than clobber a random window.
#
# Modes:
#   tmux-rename.sh "fix-auth-timeout"   explicit title (Claude calls this)
#   tmux-rename.sh --reset              restore this window to term<index>
#   <hook json on stdin>                dispatches on .hook_event_name:
#                                         SessionStart -> seed from cwd
#                                         SessionEnd   -> reset to term<index>
#                                       *** NOT REGISTERED BY install.sh ***
#
# The `/handoff` skill uses the EXPLICIT-CALL mode only. Read mode calls
#     ~/.claude/hooks/tmux-rename.sh "<slug>"
# with the slug it parsed out of the handoff document's `## Window slug` section.
# Nothing registers this script as a SessionStart/SessionEnd hook, and you should
# think twice before doing so yourself.
#
# Why hook mode is left dormant: the automatic path can only ever write two names
# — basename(cwd) on SessionStart and term<index> on SessionEnd — never a
# task-descriptive slug. In practice windows sit at the generic project name for
# the life of a session, so every window in a repo carries the same label, which
# is exactly what a descriptive title is for. Worse, three paths clobber a name
# that was set deliberately:
#   1. SessionStart with source=clear overwrites unconditionally, bypassing the
#      "already meaningful, leave it alone" guard below;
#   2. SessionEnd resets to term<index> on logout/prompt_input_exit/other;
#   3. the seed itself plants the generic name that then has to be corrected.
# Hook mode is kept intact because it is useful if you want a default label on
# windows nothing has named yet — but fix those three clobbers first, or the
# deliberate slug loses the race.
#
# To enable it, add to ~/.claude/settings.json:
#   "SessionStart": [ { "hooks": [ { "type": "command",
#     "command": "~/.claude/hooks/tmux-rename.sh" } ] } ],
#   "SessionEnd":   [ { "hooks": [ { "type": "command",
#     "command": "~/.claude/hooks/tmux-rename.sh" } ] } ]

set -uo pipefail

# Hooks can run with a minimal PATH; resolve tmux explicitly.
TMUX_BIN="$(command -v tmux 2>/dev/null || true)"
[ -z "$TMUX_BIN" ] && [ -x /opt/homebrew/bin/tmux ] && TMUX_BIN=/opt/homebrew/bin/tmux
[ -z "$TMUX_BIN" ] && [ -x /usr/local/bin/tmux ] && TMUX_BIN=/usr/local/bin/tmux
[ -z "$TMUX_BIN" ] && exit 0

# The only trustworthy target. Absent => this Claude is not in a pane (e.g. the
# VS Code extension, which runs under Code Helper, not the tmux server). Renaming
# anything in that case would hit someone else's window, so bail out quietly.
pane="${CLAUDE_TMUX_PANE:-${TMUX_PANE:-}}"
[ -z "$pane" ] && exit 0

# Restore the window to the neutral term<index> label used before a session
# claimed it. term<N> is also in the placeholder list below, so the next
# SessionStart is free to seed over it.
reset_window() {
  local idx
  idx=$("$TMUX_BIN" display-message -p -t "$pane" '#{window_index}' 2>/dev/null) || return 0
  [ -z "$idx" ] && return 0
  "$TMUX_BIN" set-window-option -t "$pane" automatic-rename off >/dev/null 2>&1
  "$TMUX_BIN" rename-window -t "$pane" "term${idx}" >/dev/null 2>&1
}

title="${1:-}"

if [ "$title" = "--reset" ]; then
  reset_window
  exit 0
fi

# No argument: hook mode. Read the payload and dispatch on the event.
if [ -z "$title" ]; then
  payload=$(cat 2>/dev/null || true)
  event=$(printf '%s' "$payload" | jq -r '.hook_event_name // empty' 2>/dev/null) || event=""

  if [ "$event" = "SessionEnd" ]; then
    # SessionEnd does NOT mean "exiting". Per the hooks reference it fires for
    # six reasons: clear, resume, logout, prompt_input_exit,
    # bypass_permissions_disabled, other. Skip the ones that are not the end of
    # a task:
    #
    #   clear                        -> session lives on; the new task is
    #                                   labelled by SessionStart(source=clear)
    #   bypass_permissions_disabled  -> session lives on in the same window
    #   resume                       -> task is coming back later, so keep its
    #                                   label; symmetric with SessionStart,
    #                                   which preserves a real title on resume
    #
    # Deny-list rather than allow-list on purpose: a missed reset just leaves a
    # stale label, whereas a wrong reset clobbers a live session's window.
    reason=$(printf '%s' "$payload" | jq -r '.reason // empty' 2>/dev/null) || reason=""
    case "$reason" in
      clear|bypass_permissions_disabled|resume) exit 0 ;;
    esac
    reset_window
    exit 0
  fi

  # SessionStart: derive a title from cwd. Fires with source in {startup, resume,
  # clear, compact, fork}.
  cwd=$(printf '%s' "$payload" | jq -r '.cwd // empty' 2>/dev/null) || cwd=""
  [ -z "$cwd" ] && cwd="$PWD"
  title=$(basename "$cwd")

  source_kind=$(printf '%s' "$payload" | jq -r '.source // empty' 2>/dev/null) || source_kind=""

  # /clear wipes the context to begin a genuinely new task, so the window label
  # left over from the previous task is stale by definition — overwrite it
  # unconditionally and let Claude rename once the new task takes shape.
  #
  # Handled here rather than as a SessionEnd(clear) reset: SessionEnd and
  # SessionStart both fire for /clear, so doing it there would make the final
  # name depend on hook ordering and would flash term<N> in between. One writer.
  #
  # resume/compact/fork all carry the task forward, so those keep the guard.
  if [ "$source_kind" != "clear" ]; then
    current=$("$TMUX_BIN" display-message -p -t "$pane" '#{window_name}' 2>/dev/null) || exit 0
    case "$current" in
      # shells and bare commands
      zsh|bash|sh|fish|node|claude|python|python3) ;;
      # tmuxp/tmux defaults and the term<N> label written back by reset_window
      term[0-9]*|window[0-9]*|base|'') ;;
      # what automatic-rename-format "#{pane_current_command}" produces for the
      # Claude CLI: its argv[0] resolves to the version dir, e.g. "2.1.220"
      [0-9]*.[0-9]*.[0-9]*) ;;
      *) exit 0 ;;   # already a meaningful title — leave it alone
    esac
  fi
fi

# Sanitize: single line, no control bytes, spaces -> dashes, bounded length.
title=$(printf '%s' "$title" | tr -d '\000-\037' | tr ' ' '-' | cut -c1-40)
[ -z "$title" ] && exit 0

# automatic-rename is off globally in ~/.tmux.conf; rename-window turns it off for
# the window anyway, but set it explicitly so the name cannot be reclaimed.
"$TMUX_BIN" set-window-option -t "$pane" automatic-rename off >/dev/null 2>&1
"$TMUX_BIN" rename-window -t "$pane" "$title" >/dev/null 2>&1

exit 0
