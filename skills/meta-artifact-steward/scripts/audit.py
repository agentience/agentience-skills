#!/usr/bin/env python3
"""Audit the artifact stewards in a repo.

    python3 audit.py [repo]        # default: the repo containing the current directory

For each .claude/skills/*/steward.json it reports missing or unrecorded-changed
artifacts, uncommitted steward files, open questions and how long since
decisions.md was updated. It also lists hand-made skills that look like stewards
(a decisions.md beside a SKILL.md) but have no steward.json yet.
Standard library only. Exit 0 if nothing needs attention, 1 if something does,
2 if it can't run.
"""
import json
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

STALE_DAYS = 14


def git(root, *args):
    try:
        return subprocess.run(["git", *args], cwd=root, capture_output=True, text=True, check=True).stdout
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None


def last_updated(path: Path):
    m = re.search(r"\*\*Last Updated: (\d{4}-\d{2}-\d{2})", path.read_text()) if path.exists() else None
    return datetime.strptime(m.group(1), "%Y-%m-%d") if m else None


def open_questions(path: Path):
    if not path.exists():
        return None
    text = path.read_text()
    m = re.search(r"^## Open questions\s*$(.*?)(?=^## |\Z)", text, re.M | re.S | re.I)
    return len(re.findall(r"^- ", m.group(1), re.M)) if m else None


def state_check(skill: Path):
    script = skill / "scripts" / "state.py"
    if not script.exists():
        return 2, "scripts/state.py missing"
    r = subprocess.run([sys.executable, str(script), "--check"], capture_output=True, text=True)
    return r.returncode, (r.stdout + r.stderr).strip()


def main():
    start = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()
    top = git(start, "rev-parse", "--show-toplevel")
    if top is None:
        print(f"CANNOT RUN: {start} is not inside a git repository.", file=sys.stderr)
        sys.exit(2)
    root = Path(top.strip())
    skills = root / ".claude" / "skills"
    if not skills.is_dir():
        print(f"No .claude/skills in {root}: no stewards here.")
        return
    attention = 0
    stewards = sorted(p.parent for p in skills.glob("*/steward.json"))
    candidates = sorted(p.parent for p in skills.glob("*/decisions.md")
                        if (p.parent / "SKILL.md").exists() and not (p.parent / "steward.json").exists())
    print(f"Repo: {root}\nStewards: {len(stewards)}" + (f"   Not yet under the contract: {len(candidates)}" if candidates else ""))
    for skill in stewards:
        rel = skill.relative_to(root)
        issues, notes = [], []
        try:
            contract = json.loads((skill / "steward.json").read_text())
        except json.JSONDecodeError as e:
            print(f"\n{rel}\n  ! steward.json unreadable: {e}")
            attention += 1
            continue
        for a in contract.get("artifacts", []):
            if not (root / a).exists():
                issues.append(f"artifact missing: {a}")
        code, out = state_check(skill)
        if code == 1:
            issues.append("artifact changed without a recorded decision:\n      " + out.replace("\n", "\n      "))
        elif code == 2:
            issues.append(f"state check couldn't run: {out}")
        for f in ("SKILL.md", "context.md", "decisions.md"):
            if not (skill / f).exists():
                issues.append(f"{f} missing")
        untracked = git(root, "status", "--porcelain", "--", str(rel))
        if untracked and untracked.strip():
            issues.append("steward files not committed:\n      " + untracked.strip().replace("\n", "\n      "))
        oq = open_questions(skill / "decisions.md")
        lu = last_updated(skill / "decisions.md")
        age = (datetime.now() - lu).days if lu else None
        if oq:
            notes.append(f"{oq} open question(s)")
            if age is not None and age > STALE_DAYS:
                issues.append(f"{oq} open question(s) and decisions.md not updated for {age} days")
        if age is not None:
            notes.append(f"decisions.md updated {age} day(s) ago")
        print(f"\n{rel}  ({contract.get('artifact', '?')}; {contract.get('editing', '?')} editing)")
        for i in issues:
            print(f"  ! {i}")
        if notes:
            print(f"  · {'; '.join(notes)}")
        if not issues:
            print("  ok")
        attention += bool(issues)
    for c in candidates:
        print(f"\n{c.relative_to(root)}\n  ! looks like a steward but has no steward.json: run meta-artifact-steward adopt")
        attention += 1
    sys.exit(1 if attention else 0)


if __name__ == "__main__":
    main()
