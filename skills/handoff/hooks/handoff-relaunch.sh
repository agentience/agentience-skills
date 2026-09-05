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
# Split mode:
#   The sentinel may carry `split=1` on a line after the document path, written
#   by `/handoff --split`. The successor then opens in a NEW pane BELOW this one
#   and this pane is left alone -- tmux `split-window -v`, Herdr
#   `pane split --direction down` with no close. Nothing is killed, so the
#   session that wrote the handoff keeps its pane, its scrollback and its ability
#   to answer one more question.
#
#   With no pane to split below -- no $TMUX_PANE and no Herdr pane -- split mode
#   is a NO-OP rather than falling back to a new window or session. The flag asks
#   for a pane beside this one, and a session outside a multiplexer has none;
#   spawning a window somewhere else instead would be a different thing wearing
#   the same name.
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

# Which multiplexer are we relaunching into? Herdr wins when this session is
# running inside one of its panes; otherwise the original tmux path runs
# unchanged. Resolve tmux lazily — a Herdr-only machine has no tmux, and the old
# unconditional `[ -z "$TMUX_BIN" ] && exit 0` would have made this hook a silent
# no-op there.
BACKEND=tmux
if [ "${HERDR_ENV:-}" = 1 ] && [ -n "${HERDR_PANE_ID:-}" ]; then
    BACKEND=herdr
    HERDR_BIN="${HERDR_BIN_PATH:-$(command -v herdr 2>/dev/null || true)}"
    [ -z "$HERDR_BIN" ] && [ -x "$HOME/.local/bin/herdr" ] && HERDR_BIN="$HOME/.local/bin/herdr"
    [ -z "$HERDR_BIN" ] && BACKEND=tmux
fi

TMUX_BIN=""
if [ "$BACKEND" = tmux ]; then
    TMUX_BIN="$(command -v tmux 2>/dev/null || true)"
    [ -z "$TMUX_BIN" ] && [ -x /opt/homebrew/bin/tmux ] && TMUX_BIN=/opt/homebrew/bin/tmux
    [ -z "$TMUX_BIN" ] && [ -x /usr/local/bin/tmux ] && TMUX_BIN=/usr/local/bin/tmux
    [ -z "$TMUX_BIN" ] && exit 0
fi

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
    find "$cwd/.claude/handoffs" -maxdepth 1 -name '.relaunched.*' -mtime +1 \
        -delete 2>/dev/null || true
fi

[ -z "$root" ] && exit 0

sentinel="$root/.claude/handoffs/$sentinel_name"
sentinel_body="$(cat "$sentinel" 2>/dev/null)"
doc="$(printf '%s\n' "$sentinel_body" | head -1 | tr -d '\r\000-\010\013\014\016-\037')"

# Line 1 is the document; every line after it is one `key=value` option. Unknown
# keys are ignored rather than refused, so a newer sentinel read by an older copy
# of this hook still relaunches -- it just relaunches the old way, which is a far
# better failure than not relaunching at all.
SPLIT=0
printf '%s\n' "$sentinel_body" | tail -n +2 \
    | tr -d '\r\000-\010\013\014\016-\037' \
    | grep -qx 'split=1' && SPLIT=1

# Consume unconditionally. A malformed sentinel must not re-fire on every
# subsequent Stop for the rest of the session.
rm -f "$sentinel"
[ -z "$doc" ] && { log "empty sentinel in $root"; exit 0; }

# ONE relaunch per session, enforced here as well as in the command.
#
# Observed 2026-08-26: a session ran `/handoff --next` once, armed, reported, and
# its Stop spawned a successor. Five minutes later a background subagent it had
# launched returned; the task notification re-opened a turn in the session that
# had already finished, and it re-ran step 4 verbatim — arming a SECOND sentinel
# and spawning a SECOND successor. Both landed on the same document, in the same
# tab, and started editing the same worktree. Nothing about either looked wrong
# from inside it.
#
# The command-side guard is the one that keeps the session from wasting a turn;
# this one is the backstop, because the sentinel is consumed on the first fire
# and so cannot itself record that a relaunch already happened. `.relaunched.<sid>`
# is written below only when we actually launch, and is swept with the sentinels.
fired="$root/.claude/handoffs/.relaunched.$sid"
if [ -n "$sid" ] && [ -e "$fired" ]; then
    log "session $sid already relaunched (-> $(head -1 "$fired" 2>/dev/null)); refusing a second one for $doc"
    exit 0
fi

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

# ---------------------------------------------------------------- Herdr ---
# Herdr has no `respawn-window -k`: there is no primitive that replaces a pane's
# process in place. What it does have is a split, which turns out to reproduce the
# tmux behaviour more faithfully than creating a tab would. Splitting inside the
# CURRENT tab and then closing the old pane leaves the surviving pane filling that
# tab — so the tab keeps its position and its label, which is what a window-per-
# session workflow actually cares about. Creating a new tab would append it at the
# end and lose the slot.
#
# The close is issued BY THE NEW PANE, not by this hook. Closing your own pane
# kills the process making the request, which is the same race `respawn-window -k`
# avoids by acting server-side; doing it from the other side removes the race
# entirely rather than betting on it.
#
# HANDOFF_HERDR_MODE:
#   replace  (default) close the old pane — the tmux behaviour
#   beside             keep it, so the finished session stays readable next to the
#                      new one. Only sane on a large window; that is the reason it
#                      exists.
#
# HANDOFF_HERDR_FOCUS:
#   auto (default) focus the new pane only if the OLD pane was focused at fire
#      time — checked live via `herdr pane get`. tmux gave this for free
#      (respawn-window can only ever hit the pane you were just in); Herdr
#      relaunches can instead fire from a pane you're not looking at (a
#      background session's Stop, a subagent-return reopening an idle turn),
#      and `--focus` there would yank you out of whatever tab or pane you were
#      actively typing in. Nothing else in this script depends on the new pane
#      being focused: `pane run`, `pane close` and the rename helper all
#      address panes by id, so this is purely about not stealing your cursor.
#   1              always focus the new pane, regardless of where you were.
#   0              never focus the new pane, regardless of where you were.
herdr_json_field() {
    # jq when present, otherwise a good-enough scrape. A Stop hook must not hard
    # depend on jq being installed.
    if command -v jq >/dev/null 2>&1; then
        printf '%s' "$1" | jq -r "$2 // empty" 2>/dev/null
    else
        printf '%s' "$1" | sed -n 's/.*"pane_id":"\([^"]*\)".*/\1/p' | head -1
    fi
}

if [ "$BACKEND" = herdr ]; then
    sleep 1   # let the final assistant message render before the layout moves

    old_pane="$HERDR_PANE_ID"
    direction="${HANDOFF_HERDR_DIRECTION:-right}"
    herdr_mode="${HANDOFF_HERDR_MODE:-replace}"

    focus_flag="--focus"
    case "${HANDOFF_HERDR_FOCUS:-auto}" in
        1) focus_flag="--focus" ;;
        0) focus_flag="--no-focus" ;;
        *)
            # `pane get` on the OLD pane, not the not-yet-created new one: the
            # question is "was the user looking at the thing that just finished,"
            # and the new pane has no history to answer that with. No jq fallback
            # needed beyond a substring test -- this is a single pane object, not
            # a list, so "focused":true cannot appear here for any pane but this
            # one.
            old_info="$("$HERDR_BIN" pane get "$old_pane" 2>>"$LOG")"
            case "$old_info" in
                *'"focused":true'*) focus_flag="--focus" ;;
                *)                  focus_flag="--no-focus" ;;
            esac
            ;;
    esac

    # `--split` names both halves of the geometry: below, and keep the old pane.
    # It overrides the two env knobs on purpose -- they are ambient defaults for
    # how this machine relaunches, and the flag is a per-invocation instruction.
    if [ "$SPLIT" = 1 ]; then
        direction=down
        herdr_mode=beside
    fi

    split_out="$("$HERDR_BIN" pane split --pane "$old_pane" --direction "$direction" \
        --cwd "$root" "$focus_flag" 2>>"$LOG")" || {
        log "herdr pane split failed from $old_pane"
        exit 0
    }
    new_pane="$(herdr_json_field "$split_out" '.result.pane.pane_id')"
    [ -n "$new_pane" ] || { log "could not read the new pane id from: $split_out"; exit 0; }

    # `pane run` is fire-and-forget: it writes into the pane's terminal without
    # checking that a shell is reading yet, and a command sent before the first
    # prompt is swallowed with exit 0 and no error. Prove the shell is consuming
    # input before sending the real command.
    ready_marker="$(mktemp -u "${TMPDIR:-/tmp}/handoff-relaunch.ready.XXXXXX")"
    ready=0
    for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
        "$HERDR_BIN" pane run "$new_pane" ": > $ready_marker" >/dev/null 2>&1
        for _ in 1 2 3 4 5; do
            [ -f "$ready_marker" ] && { ready=1; break; }
            sleep 0.2
        done
        [ "$ready" = 1 ] && break
    done
    rm -f "$ready_marker"
    if [ "$ready" != 1 ]; then
        log "new pane $new_pane never reached a prompt — leaving it as a shell"
        exit 0
    fi

    # The close is a single fire-and-forget call no one checks — and on
    # 2026-08-26 it did not take. `w8:p21` was told to close `w8:p1X` at 14:48:54;
    # `w8:p1X` was still alive at 14:53:45, when the hook successfully split it a
    # second time. A predecessor that outlives its own replacement is the pane
    # half of the duplicate-session bug guarded above, and because the call was
    # `>/dev/null 2>&1` its failure left no trace anywhere.
    #
    # So: retry until `pane list` stops reporting the pane, and if it never does,
    # say so in the log. `herdr pane close` has no force flag and no useful exit
    # status, which is why this reads the pane list rather than trusting a code.
    # Still issued BY THE NEW PANE — closing your own pane kills the process
    # making the request, which is the race the split-then-close design avoids.
    # ASCII only in the failure message: bash's `printf %q` renders any non-ASCII
    # byte as a $'\\nnn' escape, which survives the trip through zsh but makes the
    # dispatched command unreadable in a log or a `pane run` trace.
    close_stamp="$(date '+%Y-%m-%d %H:%M:%S')"
    close_loop="$(printf \
        'for _ in 1 2 3 4 5; do %q pane close %q >/dev/null 2>&1; sleep 0.4; %q pane list 2>/dev/null | grep -q %q || break; done; %q pane list 2>/dev/null | grep -q %q && echo %q >> %q; ' \
        "$HERDR_BIN" "$old_pane" \
        "$HERDR_BIN" "\"pane_id\":\"$old_pane\"" \
        "$HERDR_BIN" "\"pane_id\":\"$old_pane\"" \
        "$close_stamp herdr: pane close $old_pane FAILED after 5 tries - predecessor survived its replacement" \
        "$LOG")"

    case "$herdr_mode" in
        beside) pane_cmd="$launch" ;;
        *)      pane_cmd="$close_loop$launch" ;;
    esac

    log "herdr: $old_pane -> $new_pane ($herdr_mode, $direction) -> $doc_rel"

    # Record the relaunch BEFORE dispatching, for the same reason the rename goes
    # first: in replace mode the new pane closes this one, and anything after the
    # dispatch may never run. A marker written after the fact is a marker that is
    # missing exactly when the duplicate it guards against is possible.
    [ -n "$sid" ] && printf '%s\n' "$doc_rel" > "$fired" 2>/dev/null

    # Rename BEFORE dispatching: in replace mode the new pane closes this one,
    # which kills this process, so anything after the dispatch may never run.
    #
    # Defer to ~/.claude/hooks/tmux-rename.sh rather than renaming here, so
    # there is ONE naming rule across the relaunch hook and the slug contract
    # instead of two that drift apart. Target the NEW pane: the old one is
    # about to close under `replace`, and under `beside` it keeps its own name.
    # The tab policy is passed explicitly because the helper's single-pane test
    # cannot be right at this instant — the tab holds two panes either way, and
    # only this hook knows whether one of them is about to go.
    rename_helper="$HOME/.claude/hooks/tmux-rename.sh"
    case "$herdr_mode" in
        beside) tab_policy=never ;;   # two sessions share the tab; a tab name would lie
        *)      tab_policy=force ;;   # the old pane closes, leaving this session alone in it
    esac
    if [ -x "$rename_helper" ]; then
        HERDR_PANE_ID="$new_pane" \
        HERDR_TAB_ID="${HERDR_TAB_ID:-}" \
        HERDR_WORKSPACE_ID="${HERDR_WORKSPACE_ID:-}" \
        HERDR_RENAME_TAB="$tab_policy" \
            "$rename_helper" "$title" >/dev/null 2>&1
    elif [ -n "${HERDR_TAB_ID:-}" ] && [ "$tab_policy" = force ]; then
        "$HERDR_BIN" tab rename "$HERDR_TAB_ID" "$title" >/dev/null 2>&1
    fi

    "$HERDR_BIN" pane run "$new_pane" "$pane_cmd" >/dev/null 2>>"$LOG" || {
        log "herdr pane run failed for $new_pane"
        rm -f "$fired" 2>/dev/null
        exit 0
    }

    exit 0
fi

# ----------------------------------------------------------------- tmux ---
pane="${CLAUDE_TMUX_PANE:-${TMUX_PANE:-}}"

# Give the final assistant message a beat to render before the window is taken.
sleep 1

# Same reason as the Herdr path: `respawn-window -k` kills the pane this process
# is running in, so the marker has to exist before the call, not after it.
[ -n "$sid" ] && printf '%s\n' "$doc_rel" > "$fired" 2>/dev/null

if [ -n "$pane" ] && "$TMUX_BIN" display-message -p -t "$pane" '#{window_id}' >/dev/null 2>&1; then
    if [ "$SPLIT" = 1 ]; then
        # A pane below, and no `-k`: nothing is killed, so the session that wrote
        # the handoff keeps its pane and its scrollback. `split-window` focuses
        # the new pane, matching Herdr's `--focus` -- the successor is where the
        # work continues.
        target="$("$TMUX_BIN" split-window -v -P -F '#{pane_id}' \
            -t "$pane" -c "$root" "$shell_cmd" 2>>"$LOG")" || {
            log "split-window below pane $pane failed (window too small?)"
            rm -f "$fired" 2>/dev/null
            exit 0
        }
        log "split $pane -> ${target:-?} (below) -> $doc_rel"
        # No rename on this path. The window now holds two sessions and a name can
        # only describe one of them -- the same reason Herdr's `beside` passes
        # tab_policy=never. The successor renames it for itself when read mode
        # applies the document's window slug, which is the point at which the
        # predecessor is done with it.
        exit 0
    fi
    target="$pane"
    "$TMUX_BIN" respawn-window -k -t "$pane" -c "$root" "$shell_cmd" 2>>"$LOG" || {
        log "respawn-window failed for pane $pane"
        rm -f "$fired" 2>/dev/null
        exit 0
    }
    log "respawned $pane in place -> $doc_rel"
else
    if [ "$SPLIT" = 1 ]; then
        # No pane to split below. Falling through to new-window would put the
        # successor in a window elsewhere -- which is what the flag was asking NOT
        # to happen -- so this is where split mode stops.
        log "split requested but this session is not in a tmux pane; not relaunching $doc_rel"
        rm -f "$fired" 2>/dev/null
        exit 0
    fi
    if ! "$TMUX_BIN" has-session -t "=$session" 2>/dev/null; then
        "$TMUX_BIN" new-session -d -s "$session" -c "$root" "$shell_cmd" 2>>"$LOG" || {
            log "new-session $session failed"
            rm -f "$fired" 2>/dev/null
            exit 0
        }
        target="$session:"
        log "created session $session -> $doc_rel"
    else
        target="$("$TMUX_BIN" new-window -P -F '#{window_id}' -t "=$session:" -c "$root" "$shell_cmd" 2>>"$LOG")" || {
            log "new-window in $session failed"
            rm -f "$fired" 2>/dev/null
            exit 0
        }
        log "new window $target in $session -> $doc_rel"
    fi
fi

"$TMUX_BIN" set-window-option -t "$target" automatic-rename off >/dev/null 2>&1 || true
"$TMUX_BIN" rename-window -t "$target" "$title" >/dev/null 2>&1 || true

exit 0
