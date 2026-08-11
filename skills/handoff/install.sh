#!/usr/bin/env bash
#
# Install the `handoff` skill for Claude Code.
#
# Deliberately opt-in and deliberately boring: it tells you every path it is
# about to touch, backs up settings.json before editing it, and `--uninstall`
# reverses everything it did. Nothing here runs on its own — you ran it.
#
# Usage:
#   ./install.sh                 symlink the skill, install the writer agent,
#                                register the tmux relaunch Stop hook
#   ./install.sh --copy          copy the skill instead of symlinking it
#   ./install.sh --no-hook       skip the tmux relaunch entirely (see below)
#   ./install.sh --dry-run       print what would happen, change nothing
#   ./install.sh --uninstall     remove everything this script installs
#
# --no-hook is the right choice if you do not use tmux. The relaunch is the only
# tmux-dependent part of this skill; without it you still get the handoff
# document, `--read`, `--next` and the living-record discipline, which is most of
# the value and is harness-agnostic.

set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_NAME="$(basename "$SRC")"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
SKILL_DEST="$CLAUDE_DIR/skills/$SKILL_NAME"
HOOK_DEST="$CLAUDE_DIR/hooks"
AGENT_DEST="$CLAUDE_DIR/agents"
SETTINGS="$CLAUDE_DIR/settings.json"
HOOK_CMD='~/.claude/hooks/handoff-relaunch.sh'

MODE=install
LINK=1
WANT_HOOK=1
DRY=0

for arg in "$@"; do
  case "$arg" in
    --copy)      LINK=0 ;;
    --no-hook)   WANT_HOOK=0 ;;
    --dry-run)   DRY=1 ;;
    --uninstall) MODE=uninstall ;;
    # Print the header comment block: everything from line 3 up to the first
    # line that is not a comment. Line-numbered ranges drift the moment anyone
    # edits the header.
    -h|--help)   awk 'NR>2 { if (!/^#/) exit; sub(/^# ?/, ""); print }' "${BASH_SOURCE[0]}"; exit 0 ;;
    *)           echo "unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

say() { printf '  %s\n' "$*"; }
run() { if [ "$DRY" = 1 ]; then say "would: $*"; else "$@"; fi; }
# Confirmation of something that actually happened. Silent under --dry-run, so a
# dry run never claims to have done what it only described.
did() { [ "$DRY" = 1 ] || say "$*"; }

# ---------------------------------------------------------------- preflight

need_json_tool() {
  command -v jq >/dev/null 2>&1 && { echo jq; return; }
  command -v python3 >/dev/null 2>&1 && { echo python3; return; }
  echo none
}

check_version() {
  # ${CLAUDE_SKILL_DIR} — which SKILL.md relies on to find its own scripts/ —
  # landed in Claude Code 2.1.69. Older versions substitute nothing, the digest
  # step silently reads from /scripts/..., and write mode degrades to a
  # brief-only handoff without saying so. Warn loudly; do not block, because the
  # version string format is not a contract.
  local v
  v="$(claude --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
  [ -z "$v" ] && { say "note: could not determine Claude Code version; this skill needs 2.1.69+"; return; }
  local want=2.1.69
  if [ "$(printf '%s\n%s\n' "$want" "$v" | sort -V | head -1)" != "$want" ]; then
    say "WARNING: Claude Code $v is older than 2.1.69."
    say "         \${CLAUDE_SKILL_DIR} will not be substituted and the transcript"
    say "         digest will silently fail. Upgrade before relying on this."
  else
    say "Claude Code $v (>= 2.1.69, \${CLAUDE_SKILL_DIR} supported)"
  fi
}

# ------------------------------------------------------- settings.json edit

# Both implementations are idempotent: they match on the command string, so
# re-running install never produces a second registration.
register_hook_jq() {
  local tmp; tmp="$(mktemp)"
  jq --arg cmd "$HOOK_CMD" '
    .hooks //= {} | .hooks.Stop //= [] |
    if ([.hooks.Stop[]?.hooks[]?.command] | index($cmd)) then .
    else .hooks.Stop += [{hooks: [{type: "command", command: $cmd, timeout: 15}]}]
    end
  ' "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"
}

unregister_hook_jq() {
  local tmp; tmp="$(mktemp)"
  jq --arg cmd "$HOOK_CMD" '
    if .hooks.Stop then
      .hooks.Stop = [ .hooks.Stop[]
        | .hooks = [ .hooks[]? | select(.command != $cmd) ]
        | select((.hooks | length) > 0) ]
    else . end
  ' "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"
}

edit_hook_py() {   # $1 = add | remove
  python3 - "$SETTINGS" "$HOOK_CMD" "$1" <<'PY'
import json, sys
path, cmd, action = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path) as f:
    s = json.load(f)
hooks = s.setdefault("hooks", {})
stop = hooks.setdefault("Stop", [])
present = any(h.get("command") == cmd for g in stop for h in g.get("hooks", []))
if action == "add":
    if not present:
        stop.append({"hooks": [{"type": "command", "command": cmd, "timeout": 15}]})
else:
    kept = []
    for g in stop:
        g["hooks"] = [h for h in g.get("hooks", []) if h.get("command") != cmd]
        if g["hooks"]:
            kept.append(g)
    hooks["Stop"] = kept
    if not kept:
        del hooks["Stop"]
    if not hooks:
        del s["hooks"]
with open(path, "w") as f:
    json.dump(s, f, indent=2)
    f.write("\n")
PY
}

edit_settings() {  # $1 = add | remove
  local tool; tool="$(need_json_tool)"
  if [ "$tool" = none ]; then
    say "neither jq nor python3 found — edit $SETTINGS by hand:"
    say '  "hooks": { "Stop": [ { "hooks": [ { "type": "command",'
    say "    \"command\": \"$HOOK_CMD\", \"timeout\": 15 } ] } ] }"
    return
  fi
  [ -f "$SETTINGS" ] || run bash -c "mkdir -p '$(dirname "$SETTINGS")' && echo '{}' > '$SETTINGS'"
  if [ "$DRY" = 1 ]; then say "would: $1 Stop hook in $SETTINGS (via $tool)"; return; fi
  cp "$SETTINGS" "$SETTINGS.bak.$(date +%Y%m%d%H%M%S)"
  if [ "$tool" = jq ]; then
    # if/else, not `test && add || remove`: in that form a failing add falls
    # through to remove, which would silently do the opposite of what was asked.
    if [ "$1" = add ]; then register_hook_jq; else unregister_hook_jq; fi
  else
    edit_hook_py "$1"
  fi
  did "$1 Stop hook in $SETTINGS (backup written alongside)"
}

# ------------------------------------------------------------------- main

if [ "$MODE" = uninstall ]; then
  echo "Uninstalling the '$SKILL_NAME' skill"
  [ -e "$SKILL_DEST" ] && run rm -rf "$SKILL_DEST" && did "removed $SKILL_DEST"
  [ -e "$HOOK_DEST/handoff-relaunch.sh" ] && run rm -f "$HOOK_DEST/handoff-relaunch.sh" && did "removed $HOOK_DEST/handoff-relaunch.sh"
  [ -e "$AGENT_DEST/handoff-writer.md" ] && run rm -f "$AGENT_DEST/handoff-writer.md" && did "removed $AGENT_DEST/handoff-writer.md"
  [ -f "$SETTINGS" ] && edit_settings remove
  say "left in place: $HOOK_DEST/tmux-rename.sh (useful on its own, and you may"
  say "               have been using it before this skill)"
  echo "Done."
  exit 0
fi

echo "Installing the '$SKILL_NAME' skill from $SRC"
check_version

run mkdir -p "$CLAUDE_DIR/skills" "$HOOK_DEST" "$AGENT_DEST"

# Skill itself.
if [ -e "$SKILL_DEST" ] || [ -L "$SKILL_DEST" ]; then
  run rm -rf "$SKILL_DEST"
fi
if [ "$LINK" = 1 ]; then
  run ln -s "$SRC" "$SKILL_DEST"
  did "linked $SKILL_DEST -> $SRC (a git pull updates the skill in place)"
else
  run cp -R "$SRC" "$SKILL_DEST"
  did "copied skill to $SKILL_DEST"
fi

# Writer subagent. Without this the skill still works — SKILL.md step 3 falls
# back to a general-purpose agent that reads agents/handoff-writer.md itself.
run cp "$SRC/agents/handoff-writer.md" "$AGENT_DEST/handoff-writer.md"
did "installed writer agent to $AGENT_DEST/handoff-writer.md"

# tmux relaunch.
if [ "$WANT_HOOK" = 1 ]; then
  if command -v tmux >/dev/null 2>&1; then
    run cp "$SRC/hooks/handoff-relaunch.sh" "$HOOK_DEST/handoff-relaunch.sh"
    run cp "$SRC/hooks/tmux-rename.sh"      "$HOOK_DEST/tmux-rename.sh"
    run chmod 755 "$HOOK_DEST/handoff-relaunch.sh" "$HOOK_DEST/tmux-rename.sh"
    did "installed hooks to $HOOK_DEST"
    edit_settings add
  else
    say "tmux not found — skipping the relaunch hook."
    say "Everything except the auto-respawn works without it."
  fi
else
  say "skipping the relaunch hook (--no-hook)"
fi

cat <<EOF

Done. Start a NEW Claude Code session — a running one keeps the skill text it
loaded at startup — then:

  /handoff                 write a handoff document for this session
  /handoff --read          resume from the most recent one
  /handoff --next          refresh the document you resumed from

Reverse all of it with: $SRC/install.sh --uninstall
EOF
