#!/usr/bin/env bash
#
# Install the `meta-artifact-steward` skill for Claude Code.
#
# Opt-in, and it tells you every path it touches. `--uninstall` reverses it.
#
# Usage:
#   ./install.sh                 symlink the skill into ~/.claude/skills/
#   ./install.sh --copy          copy the skill instead of symlinking it
#   ./install.sh --dry-run       print what would happen, change nothing
#   ./install.sh --uninstall     remove everything this script installs
#
# It writes nothing to ~/.claude/settings.json. The stewards it creates
# live in each project's .claude/skills/, committed there; uninstalling this
# skill leaves them alone, since they belong to those projects.
#
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_NAME="$(basename "$SRC")"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
SKILL_DEST="$CLAUDE_DIR/skills/$SKILL_NAME"

MODE=install
LINK=1
DRY=0

for arg in "$@"; do
  case "$arg" in
    --copy)      LINK=0 ;;
    --dry-run)   DRY=1 ;;
    --uninstall) MODE=uninstall ;;
    -h|--help)   awk 'NR>2 { if (!/^#/) exit; sub(/^# ?/, ""); print }' "${BASH_SOURCE[0]}"; exit 0 ;;
    *)           echo "unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

say() { printf '  %s\n' "$*"; }
run() { if [ "$DRY" = 1 ]; then say "would: $*"; else "$@"; fi; }
did() { [ "$DRY" = 1 ] || say "$*"; }

if [ "$MODE" = uninstall ]; then
  echo "Uninstalling the '$SKILL_NAME' skill"
  if [ -e "$SKILL_DEST" ] || [ -L "$SKILL_DEST" ]; then
    run rm -rf "$SKILL_DEST"
    did "removed $SKILL_DEST"
  else
    say "nothing at $SKILL_DEST"
  fi
  say "Stewards already created in your projects are left alone."
  echo "Done."
  exit 0
fi

echo "Installing the '$SKILL_NAME' skill from $SRC"
if command -v python3 >/dev/null 2>&1; then
  say "python3 $(python3 -c 'import sys; print(".".join(map(str, sys.version_info[:2])))') (state.py and audit.py use the standard library only)"
else
  say "WARNING: no python3. state.py and audit.py need it; creating stewards"
  say "         still works, but their change detection won't run until it's installed."
fi
command -v git >/dev/null 2>&1 || say "WARNING: git not found. Stewards rely on it for sync, history and attribution."

run mkdir -p "$CLAUDE_DIR/skills"
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

cat <<EOF

Done. Start a NEW Claude Code session, then from inside a project:

  /meta-artifact-steward <path to an artifact>   create its steward
  /meta-artifact-steward audit                   check the stewards in this repo
  /meta-artifact-steward adopt <skill dir>       bring a hand-made one under the contract

Reverse it with: $SRC/install.sh --uninstall
EOF
