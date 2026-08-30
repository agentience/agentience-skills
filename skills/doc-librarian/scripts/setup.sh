#!/usr/bin/env bash
#
# doc-librarian setup — install the docs-governance kit into the repo this is run from.
#
# Invoked by `/doc-librarian setup`. Copies the linter + the PostToolUse structure-guard
# hook out of the skill, registers the hook in .claude/settings.json, seeds docs/TAGS.md if
# missing, and adds npm scripts. Idempotent — safe to re-run. Run from anywhere inside the
# target git repository.
#
set -uo pipefail

# The skill root is the parent of this script's directory (…/doc-librarian/scripts/setup.sh).
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

REPO="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "✗ Not inside a git repository. cd into your project and re-run." >&2
  exit 1
}
cd "$REPO" || exit 1
echo "doc-librarian setup → $REPO"

# 1) The linter (single source of truth for every check).
mkdir -p docs/scripts
cp "$SKILL_DIR/scripts/lint-docs.ts" docs/scripts/lint-docs.ts
echo "  ✓ docs/scripts/lint-docs.ts"

# 2) The PostToolUse structure-guard hook.
mkdir -p .claude/hooks
cp "$SKILL_DIR/hooks/docs_structure_guard.py" .claude/hooks/docs_structure_guard.py
chmod +x .claude/hooks/docs_structure_guard.py
echo "  ✓ .claude/hooks/docs_structure_guard.py"

# 3) A starter controlled vocabulary if the repo has none (the tag check needs it).
if [ ! -f docs/TAGS.md ]; then
  cp "$SKILL_DIR/TAGS.md" docs/TAGS.md
  echo "  ✓ docs/TAGS.md  (starter vocabulary — curate it for this repo)"
fi

# 4) Keep the skill's own working artifacts out of the corpus it audits. A report
#    written into the tree becomes a document the next scan appraises.
if [ -f .gitignore ] && grep -qx '\.doc-librarian/' .gitignore; then
  echo "  • .gitignore already ignores .doc-librarian/ — skipped"
else
  printf '\n# doc-librarian working artifacts (reports, drafts, NLP output)\n.doc-librarian/\n' >> .gitignore
  echo "  ✓ .gitignore  (+ .doc-librarian/)"
fi

# 5) Register the PostToolUse(Write) hook in .claude/settings.json (idempotent).
python3 - <<'PY'
import json, os, sys
p = ".claude/settings.json"
try:
    cfg = json.load(open(p)) if os.path.exists(p) else {}
except Exception as e:
    print(f"  ✗ could not parse {p} ({e}); add the hook manually.", file=sys.stderr); sys.exit(0)
post = cfg.setdefault("hooks", {}).setdefault("PostToolUse", [])
cmd = 'python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/docs_structure_guard.py"'
if any("docs_structure_guard.py" in h.get("command", "") for e in post for h in e.get("hooks", [])):
    print("  • PostToolUse(Write) hook already registered — skipped")
else:
    post.append({"matcher": "Write", "hooks": [{"type": "command", "command": cmd}]})
    with open(p, "w") as f:
        json.dump(cfg, f, indent=2); f.write("\n")
    print("  ✓ registered PostToolUse(Write) hook in .claude/settings.json")
PY

# 6) Convenience npm scripts (if the repo uses npm).
if [ -f package.json ]; then
python3 - <<'PY'
import json, sys
p = "package.json"
try:
    pkg = json.load(open(p))
except Exception:
    print("  • package.json unparseable — skipped npm scripts"); sys.exit(0)
s = pkg.setdefault("scripts", {})
want = {
    "docs:lint": "tsx docs/scripts/lint-docs.ts",
    "docs:lint:staged": "tsx docs/scripts/lint-docs.ts --staged",
    "docs:staleness": "tsx docs/scripts/lint-docs.ts --staleness",
}
added = [k for k in want if k not in s]
for k in added:
    s[k] = want[k]
if added:
    with open(p, "w") as f:
        json.dump(pkg, f, indent=2); f.write("\n")
    print("  ✓ package.json scripts:", ", ".join(added))
else:
    print("  • package.json docs:* scripts already present — skipped")
PY
fi

# 7) Closing guidance, matched to THIS repo: telling a pnpm workspace to run
#    `npm i` is not a cosmetic slip, it corrupts the tree.
if   [ -f pnpm-lock.yaml ]; then PM=pnpm;  RUN="pnpm run";     ADD="pnpm add -D";        X="pnpm exec"
elif [ -f yarn.lock ];      then PM=yarn;  RUN="yarn";         ADD="yarn add -D";        X="yarn"
elif [ -f bun.lockb ];      then PM=bun;   RUN="bun run";      ADD="bun add -d";         X="bunx"
else                             PM=npm;   RUN="npm run";      ADD="npm i -D";           X="npx"
fi

if [ -x node_modules/.bin/tsx ] || grep -q '"tsx"' package.json 2>/dev/null; then
  TSX_NOTE="  tsx is already available — nothing to install."
else
  TSX_NOTE="  Install the runner first:  $ADD tsx"
fi

cat <<EOF

Done. The PostToolUse guard now nudges any agent that writes a non-conforming docs/*.md
(new Claude Code sessions pick up the settings change).

Detected package manager: $PM
$TSX_NOTE

Recommended next step — add the commit-time gate to your pre-commit hook:
  $X tsx docs/scripts/lint-docs.ts --staged      # blocks bad staged docs

Handy commands:
  $RUN docs:lint         # full active-tree audit (links + tags + frontmatter + structure)
  $RUN docs:staleness    # non-blocking review report

Then curate docs/TAGS.md. The seeded starter names only document KIND and
generic CONCERNS — the subsystem tags that actually make a corpus findable are
left empty on purpose. Run Procedure G to derive them from your own docs.
EOF
