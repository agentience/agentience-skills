#!/usr/bin/env bash
#
# Run digest-transcript.ts, resolving Node the hard way.
#
# Why this wrapper exists: SKILL.md used to call `npx tsx ...` directly, which
# fails outright for anyone whose Node comes from a version manager. nvm, fnm,
# asdf and volta all put node on PATH from an interactive shell rc file, and the
# shell Claude Code's Bash tool spawns is not interactive — so `npx` is simply
# not found, even though `node --version` works fine in the user's terminal.
# Observed on a stock Ubuntu box with nvm: `/bin/bash: line 11: npx: command not
# found`, while ~/.nvm/versions/node/v24.1.0/bin/npx existed the whole time.
#
# Usage: digest.sh --session <id> --max-text <n> --out <path>
#        digest.sh --probe        resolve node, print where it landed, exit 0/127
#
# All other arguments are passed straight through to digest-transcript.ts.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TS="$HERE/digest-transcript.ts"

[ -f "$TS" ] && : || { echo "digest.sh: cannot find $TS" >&2; exit 1; }

# 1. Already on PATH: nothing to do.
if ! command -v npx >/dev/null 2>&1; then
  # 2. Version managers, newest version first. We read the directory rather than
  #    ask the manager, because its "current" pointer lives in a shell function
  #    we cannot call from here.
  #
  #    `sort -Vr | head -5`, NOT `sort -V | tail -5 | tac` — macOS ships no
  #    `tac`, so that pipeline fails there and falls back to ascending order,
  #    silently selecting the OLDEST installed node instead of the newest.
  for base in "$HOME/.nvm/versions/node" "$HOME/.local/share/fnm/node-versions" \
              "$HOME/.asdf/installs/nodejs" "$HOME/.volta/tools/image/node"; do
    [ -d "$base" ] || continue
    for v in $(ls "$base" 2>/dev/null | sort -Vr | head -5); do
      for bin in "$base/$v/bin" "$base/$v/installation/bin"; do
        if [ -x "$bin/npx" ]; then
          PATH="$bin:$PATH"
          export PATH
          break 3
        fi
      done
    done
  done
fi

# 3. Common system locations, last.
if ! command -v npx >/dev/null 2>&1; then
  for d in /opt/homebrew/bin /usr/local/bin /usr/bin; do
    [ -x "$d/npx" ] && { PATH="$d:$PATH"; export PATH; break; }
  done
fi

if ! command -v npx >/dev/null 2>&1; then
  cat >&2 <<'EOF'
digest.sh: no `npx` found.

This skill needs Node (>= 18) to run the transcript digest. Either install it,
or — if you use nvm/fnm/asdf/volta — make sure the version directory is one of
the ones probed above.

Without the digest, /handoff still works: fall back to `--inline` and say so, per
step 1 of SKILL.md. Do NOT silently delegate a brief-only handoff.
EOF
  exit 127
fi

if [ "${1:-}" = "--probe" ]; then
  printf 'npx: %s\nnode: %s\n' \
    "$(command -v npx)" "$(node --version 2>/dev/null || echo unknown)"
  exit 0
fi

exec npx -y tsx "$TS" "$@"
