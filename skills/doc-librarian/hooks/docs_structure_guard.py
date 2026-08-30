#!/usr/bin/env python3
"""
PostToolUse(Write) hook — docs/ structure guard (portable, stdlib-only).

When an agent writes a new/edited `docs/**/*.md` that doesn't fit the organizational
structure (wrong doc_type for its bucket, missing/invalid frontmatter, invented tag,
broken intra-docs link, non-kebab filename), nudge it through the doc-librarian
Procedure C workflow: identify the Diátaxis type -> start from the matching template
-> place in the correct bucket -> add frontmatter -> wire into the README.

Reuses the single source of truth (docs/scripts/lint-docs.ts --file) rather than
re-implementing the rules. Fires on Write only (the creation path). Exits 2 with the
guidance on stderr so Claude revises the doc; fails OPEN (exit 0) on any infra error so
a broken hook never blocks doc authoring.

Installed by `doc-librarian setup`. Registered in .claude/settings.json PostToolUse with
matcher "Write" and NO `|| true` (the block is intentional; this script self-limits to
genuine non-conformance). Pure stdlib — runs under plain `python3` in any project.
"""
import json
import os
import subprocess
import sys
from pathlib import Path


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    if data.get("tool_name") != "Write":
        sys.exit(0)

    fp = data.get("tool_input", {}).get("file_path", "")
    if not fp or not fp.endswith(".md") or "docs/" not in fp.replace(os.sep, "/"):
        sys.exit(0)

    cwd = data.get("cwd") or os.getcwd()
    path = Path(fp) if os.path.isabs(fp) else (Path(cwd) / fp)

    # Locate the repo + its linter; bail (silently) if either is absent.
    try:
        repo = Path(
            subprocess.check_output(
                ["git", "-C", str(path.parent), "rev-parse", "--show-toplevel"],
                text=True, stderr=subprocess.DEVNULL,
            ).strip()
        )
    except Exception:
        sys.exit(0)

    try:
        path.relative_to(repo / "docs")  # only guard files under <repo>/docs/
    except ValueError:
        sys.exit(0)

    linter = repo / "docs" / "scripts" / "lint-docs.ts"
    if not linter.exists():
        sys.exit(0)

    tsx_local = repo / "node_modules" / ".bin" / "tsx"
    cmd = ([str(tsx_local)] if tsx_local.exists() else ["npx", "tsx"]) + [str(linter), f"--file={path}"]
    try:
        res = subprocess.run(cmd, cwd=str(repo), capture_output=True, text=True, timeout=90)
    except Exception:
        sys.exit(0)  # fail-open on any execution error

    # lint-docs exits 1 for genuine issues, 0 when the file conforms (or is out of scope).
    # Any other code is an infra problem -> stay silent.
    if res.returncode != 1:
        sys.exit(0)

    issues = (res.stdout + res.stderr).strip()
    guidance = f"""This doc doesn't yet fit the docs/ structure:

{issues}

Follow the doc-librarian workflow (Procedure C) before continuing:
  1. Identify its Diátaxis type — tutorial (learning), how-to (task), reference (facts),
     or explanation (why). If it is more than one, split it.
  2. Start from the matching template: <doc-librarian skill dir>/templates/<type>.md
  3. Place it in the correct bucket — docs/{{tutorials,how-to,reference,explanation,decisions}}/
     — and make doc_type match the bucket.
  4. Give it the required frontmatter (title, doc_type, status, owner, updated, tags —
     tags from docs/TAGS.md only) and a kebab-case filename.
  5. Wire it into the folder's README. Verify with: npm run docs:lint
"""
    print(guidance, file=sys.stderr)
    sys.exit(2)


if __name__ == "__main__":
    main()
