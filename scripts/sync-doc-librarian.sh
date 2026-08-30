#!/usr/bin/env bash
#
# Keep skills/doc-librarian/ and the installed copy at ~/.claude/skills/
# doc-librarian/ from drifting apart, in either direction.
#
# There are two live copies of this skill and no mechanism that compares their
# behaviour — one `version` field covers both. This repo's copy is canonical:
# it is what people install, and it is where START-HERE.md's raw URLs resolve.
# The other is the one Claude Code actually loads on this machine, tracked in a
# separate dotfiles repo.
#
# The reverse path matters more here than it usually does. Most of this skill's
# fixes were authored by editing the INSTALLED copy while using it, not by
# editing this repo — so `--pull` is a first-class direction, not a rescue hatch.
#
# Usage:
#   sync-doc-librarian.sh --check           report drift, exit 1 if any
#   sync-doc-librarian.sh --push            copy this repo -> installed copy
#   sync-doc-librarian.sh --pull            adopt the installed copy as canonical
#   sync-doc-librarian.sh --push --dry-run  say what it would copy
#
# Whichever direction you run, **commit both repos yourself**. This script never
# commits, because a sync that quietly rewrote a tracked tree in a repo you were
# not looking at is exactly the surprise it exists to prevent.
#
# The installed copy is found at, in order: $DOC_LIBRARIAN_INSTALL, --install
# <path>, then ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/doc-librarian. A
# missing copy is skipped with a note, never an error.
#
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$HERE/skills/doc-librarian"
DEFAULT_INSTALL="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/doc-librarian"
INSTALL="${DOC_LIBRARIAN_INSTALL:-$DEFAULT_INSTALL}"

# The behavioural surface — what changes what the skill DOES. Everything else in
# this directory is publishing material for people who install from the repo
# (install.sh, START-HERE.md, diagrams/) or is addressed to a different reader
# (README.md: the repo copy explains cloning and installing, which is meaningless
# inside ~/.claude). Syncing those would overwrite each copy's own purpose.
SHARED=(SKILL.md TAGS.md references scripts hooks templates)

MODE=""
DRY=0
for arg in "$@"; do
  case "$arg" in
    --check)     MODE=check ;;
    --push)      MODE=push ;;
    --pull)      MODE=pull ;;
    --dry-run)   DRY=1 ;;
    --install=*) INSTALL="${arg#--install=}" ;;
    -h|--help)   awk 'NR>2 { if (!/^#/) exit; sub(/^# ?/, ""); print }' "${BASH_SOURCE[0]}"; exit 0 ;;
    /*)          INSTALL="$arg" ;;
    *)           echo "unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done
[ -z "$MODE" ] && { echo "pick one of --check, --push, --pull (try --help)" >&2; exit 2; }

# A symlinked install is not a second copy — install.sh --copy makes one, the
# default symlink does not. Syncing a symlink onto itself would truncate it.
if [ -L "$INSTALL" ]; then
  target="$(cd "$(dirname "$INSTALL")" && cd "$(readlink "$INSTALL")" 2>/dev/null && pwd || true)"
  if [ "$target" = "$SRC" ]; then
    echo "installed copy is a symlink to this checkout — there is only one copy, nothing to sync."
    exit 0
  fi
fi

drift=0
say() { printf '  %s\n' "$*"; }

# diff -r over a directory pair, reported one line per differing file so the
# output stays readable when a whole script was rewritten.
diff_tree() {   # $1 = a, $2 = b, $3 = label
  local a="$1" b="$2" label="$3"
  if [ ! -e "$b" ]; then say "MISSING  $label"; drift=1; return; fi
  if diff -qr -x '.git' -x '__pycache__' "$a" "$b" >/dev/null 2>&1; then return; fi
  while IFS= read -r line; do
    say "DRIFT    $label — $line"
    drift=1
  done < <(diff -qr -x '.git' -x '__pycache__' "$a" "$b" 2>&1)
}

if [ ! -d "$INSTALL" ] && [ "$MODE" != check ]; then
  echo "installed copy $INSTALL not present — nothing to do."
  exit 0
fi

case "$MODE" in

check)
  echo "canonical: $SRC"
  if [ ! -d "$INSTALL" ]; then
    echo "installed: $INSTALL (not present — skipped)"
    exit 0
  fi
  echo "installed: $INSTALL"
  for item in "${SHARED[@]}"; do
    if [ -d "$SRC/$item" ]; then
      diff_tree "$SRC/$item" "$INSTALL/$item" "$item"
    elif ! diff -q "$SRC/$item" "$INSTALL/$item" >/dev/null 2>&1; then
      say "DRIFT    $item"; drift=1
    fi
  done
  if [ "$drift" = 0 ]; then
    echo "in sync."
  else
    echo "drift found — --push to overwrite the installed copy, --pull to adopt it."
    echo "Neither direction is automatically right: read the diff first."
  fi
  exit "$drift"
  ;;

push|pull)
  run() { if [ "$DRY" = 1 ]; then say "would: $*"; else "$@"; fi; }
  if [ "$MODE" = push ]; then from="$SRC"; to="$INSTALL"; else from="$INSTALL"; to="$SRC"; fi
  echo "copying $from -> $to"
  for item in "${SHARED[@]}"; do
    [ -e "$from/$item" ] || { say "skip $item (absent at source)"; continue; }
    if [ -d "$from/$item" ]; then
      run rm -rf "$to/$item"
      run cp -R "$from/$item" "$to/$item"
    else
      run cp "$from/$item" "$to/$item"
    fi
    say "$item"
  done
  [ "$DRY" = 1 ] && exit 0
  find "$to" -name '__pycache__' -type d -exec rm -rf {} + 2>/dev/null
  echo "done. Commit BOTH repos yourself — this script never commits."
  ;;
esac
