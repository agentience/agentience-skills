#!/usr/bin/env bash
# Rename the window that owns THIS Claude session — and only that one.
#
# Two backends: tmux (the original, unchanged) and Herdr, which names a pane
# and — only when that pane has its tab to itself — the tab. See the herdr
# block below. Everything from here to it is about the tmux path.
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
#                                       *** CURRENTLY UNREGISTERED — see below ***
#
# Status: EXPLICIT-CALL ONLY as of 2026-08-11.
#
# The SessionStart/SessionEnd registrations were removed from
# ~/.claude/settings.json. Hook mode below is intact but nothing invokes it.
#
# Why: the automatic path could only ever write two names — basename(cwd) on
# SessionStart and term<index> on SessionEnd — never a task-descriptive slug.
# In practice windows sat at the generic project name for the life of a
# session, and three paths clobbered a name that had been set deliberately:
#   1. SessionStart with source=clear overwrote unconditionally, bypassing the
#      "already meaningful, leave it alone" guard below;
#   2. SessionEnd reset to term<index> on logout/prompt_input_exit/other;
#   3. the seed itself planted the generic name that then had to be corrected.
# The descriptive rename is now solely the explicit call, per the tmux section
# of ~/.claude/CLAUDE.md.
#
# To re-enable hook mode, restore in settings.json (and fix the three clobbers
# above first, or the same complaint returns):
#   "SessionStart": [ { "hooks": [ { "type": "command",
#     "command": "~/.claude/hooks/tmux-rename.sh" } ] } ],
#   "SessionEnd":   [ { "hooks": [ { "type": "command",
#     "command": "~/.claude/hooks/tmux-rename.sh" } ] } ]

set -uo pipefail

# Sanitize: single line, no control bytes, spaces -> dashes, bounded length.
sanitize_title() {
  printf '%s' "${1:-}" | tr -d '\000-\037' | tr ' ' '-' | cut -c1-40
}

# ------------------------------------------------------------------ herdr ---
# A Claude session running in a Herdr pane has no tmux window at all, and no
# $TMUX_PANE, so everything below this block bails out at the pane check and
# exits 0. That silence is what made the handoff slug contract a no-op under
# Herdr for a week: Read mode calls this script, the script does nothing, and
# the window keeps whatever name the relaunch hook wrote.
#
# Herdr names two things, and they are not interchangeable:
#   pane  — always renamed. One pane is one session, so a pane label can always
#           describe the work truthfully.
#   tab   — renamed ONLY when it holds exactly one pane. `beside` relaunch mode
#           puts two sessions in one tab, and a tab name can then only ever
#           describe one of them; overwriting it would mislabel the other.
#
# Hook mode (no argument, JSON on stdin) is deliberately not implemented here:
# it is unregistered in settings.json, and the only names it could write are
# the generic ones the tmux comments above explain were the problem.
HERDR_PANE="${HERDR_PANE_ID:-}"
if [ -n "$HERDR_PANE" ]; then
  HERDR_BIN="$(command -v herdr 2>/dev/null || true)"
  for h in "$HOME/.cargo/bin/herdr" "$HOME/.local/bin/herdr" \
           /opt/homebrew/bin/herdr /usr/local/bin/herdr; do
    [ -n "$HERDR_BIN" ] && break
    [ -x "$h" ] && HERDR_BIN="$h"
  done
  [ -z "$HERDR_BIN" ] && exit 0

  # How many panes share this session's tab. Any failure to count answers 2,
  # the conservative reading: leave the tab name alone.
  herdr_tab_pane_count() {
    local out
    [ -n "${HERDR_TAB_ID:-}" ] && [ -n "${HERDR_WORKSPACE_ID:-}" ] || { printf '2'; return; }
    out="$("$HERDR_BIN" pane list --workspace "$HERDR_WORKSPACE_ID" 2>/dev/null)" || { printf '2'; return; }
    printf '%s' "$out" \
      | jq --arg t "$HERDR_TAB_ID" '[.result.panes[] | select(.tab_id == $t)] | length' 2>/dev/null \
      || printf '2'
  }

  # Whether the tab gets the name too. `auto` (the default) applies the
  # single-pane rule above. A caller that KNOWS what the tab is about to hold —
  # the handoff relaunch hook, which has just split a second pane in and knows
  # whether it is about to close the first — overrides it, because at the moment
  # it asks, the count is momentarily wrong in both directions.
  herdr_should_rename_tab() {
    [ -n "${HERDR_TAB_ID:-}" ] || return 1
    case "${HERDR_RENAME_TAB:-auto}" in
      never) return 1 ;;
      force) return 0 ;;
      *)     [ "$(herdr_tab_pane_count)" = "1" ] ;;
    esac
  }

  herdr_title="${1:-}"

  if [ "$herdr_title" = "--reset" ]; then
    "$HERDR_BIN" pane rename "$HERDR_PANE" --clear >/dev/null 2>&1
    if herdr_should_rename_tab; then
      # Herdr has no `tab rename --clear`; its neutral label is the tab number,
      # which is what an unnamed tab displays anyway.
      idx="$("$HERDR_BIN" tab list --workspace "${HERDR_WORKSPACE_ID:-}" 2>/dev/null \
        | jq -r --arg t "$HERDR_TAB_ID" '.result.tabs[] | select(.tab_id == $t) | .number' 2>/dev/null)"
      [ -n "$idx" ] && [ "$idx" != "null" ] \
        && "$HERDR_BIN" tab rename "$HERDR_TAB_ID" "$idx" >/dev/null 2>&1
    fi
    exit 0
  fi

  herdr_title=$(sanitize_title "$herdr_title")
  [ -z "$herdr_title" ] && exit 0

  "$HERDR_BIN" pane rename "$HERDR_PANE" "$herdr_title" >/dev/null 2>&1
  herdr_should_rename_tab \
    && "$HERDR_BIN" tab rename "$HERDR_TAB_ID" "$herdr_title" >/dev/null 2>&1
  exit 0
fi

# ------------------------------------------------------------------- tmux ---

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

title=$(sanitize_title "$title")
[ -z "$title" ] && exit 0

# automatic-rename is off globally in ~/.tmux.conf; rename-window turns it off for
# the window anyway, but set it explicitly so the name cannot be reclaimed.
"$TMUX_BIN" set-window-option -t "$pane" automatic-rename off >/dev/null 2>&1
"$TMUX_BIN" rename-window -t "$pane" "$title" >/dev/null 2>&1

exit 0
