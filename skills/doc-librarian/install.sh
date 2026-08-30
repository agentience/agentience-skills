#!/usr/bin/env bash
#
# Install the `doc-librarian` skill for Claude Code.
#
# Skip this if you use the skill through a plugin that already ships it — the
# plugin's copy is on the skill path already and a second one only confuses the
# resolver.
#
# Deliberately opt-in and deliberately boring: it tells you every path it is
# about to touch, and `--uninstall` reverses everything it did. Nothing here
# runs on its own — you ran it.
#
# Usage:
#   ./install.sh                 symlink the skill into ~/.claude/skills/
#   ./install.sh --copy          copy the skill instead of symlinking it
#   ./install.sh --dry-run       print what would happen, change nothing
#   ./install.sh --uninstall     remove everything this script installs
#
# Note what this does NOT do: it writes nothing to ~/.claude/settings.json.
# Unlike a session-scoped skill, doc-librarian's enforcement is per-repository —
# the linter, the PostToolUse structure guard, and the settings entry that
# registers it are installed into a project by `/doc-librarian setup`, which you
# run from inside that project and which tells you what it touched. Installing
# the skill arms nothing on its own.
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

# --------------------------------------------------------------- preflight

check_node() {
  # The TS scripts are run with `node --experimental-strip-types`, which needs
  # Node 22. On an older Node they fail at parse time with a syntax error about
  # a type annotation, which reads like a corrupt file rather than a version
  # problem. Warn; do not block — `npx tsx` is a valid alternative and someone
  # may have it.
  local v
  v="$(node --version 2>/dev/null | grep -oE '[0-9]+' | head -1 || true)"
  if [ -z "$v" ]; then
    say "WARNING: no node found. The triage, tagging and apply scripts need"
    say "         Node 22+ (or npx tsx). Procedures A-D and F still work by hand."
  elif [ "$v" -lt 22 ]; then
    say "WARNING: node $(node --version) is older than v22, so"
    say "         --experimental-strip-types will reject the .ts scripts. Either"
    say "         upgrade, or run them with 'npx tsx' instead."
  else
    say "node $(node --version) (>= v22, --experimental-strip-types supported)"
  fi
}

check_optional() {
  # The NLP layer is genuinely optional — every consumer degrades to a weaker
  # heuristic when nlp-analysis.json is absent. Report it as a capability, not a
  # missing dependency, so nobody goes installing Python to use the skill.
  if command -v uv >/dev/null 2>&1; then
    say "uv found (near-duplicate clustering and topic themes available)"
  elif command -v python3 >/dev/null 2>&1; then
    say "python3 found, uv not — analyze-docs.py needs scikit-learn on the PATH"
    say "         python, or install uv and it provisions deps itself (PEP 723)."
  else
    say "note: no uv/python3. The optional NLP layer is unavailable; triage and"
    say "      tag mining fall back to title matching and heading frequency."
  fi
  command -v git >/dev/null 2>&1 || say "WARNING: git not found. Every procedure uses it for history and referrers."
}

# -------------------------------------------------------------------- main

if [ "$MODE" = uninstall ]; then
  echo "Uninstalling the '$SKILL_NAME' skill"
  if [ -e "$SKILL_DEST" ] || [ -L "$SKILL_DEST" ]; then
    run rm -rf "$SKILL_DEST"
    did "removed $SKILL_DEST"
  else
    say "nothing at $SKILL_DEST"
  fi
  say ""
  say "Left alone, because they live in your projects and not here:"
  say "  docs/scripts/lint-docs.ts, .claude/hooks/docs_structure_guard.py, the"
  say "  .claude/settings.json entry, and docs/TAGS.md in any repo where you ran"
  say "  '/doc-librarian setup'. Those are that repo's files now — the linter is"
  say "  its commit gate and TAGS.md is its curated vocabulary. Remove them per"
  say "  repo if you want them gone."
  echo "Done."
  exit 0
fi

echo "Installing the '$SKILL_NAME' skill from $SRC"
check_node
check_optional

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

Done. Start a NEW Claude Code session — a running one keeps the skill text it
loaded at startup — then, from inside a repository you want to organize:

  /doc-librarian setup        install the linter + structure guard into THIS repo
  "audit our documentation"   Procedure A: an evidence-backed assessment
  "where should this doc go"  Procedure C: classify and place one document

Working artifacts land in .doc-librarian/ at the repo root, never inside docs/.
'setup' adds that directory to .gitignore.

Reverse all of it with: $SRC/install.sh --uninstall
EOF
