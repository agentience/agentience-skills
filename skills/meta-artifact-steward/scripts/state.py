#!/usr/bin/env python3
"""Fingerprint a steward's artifacts, to catch changes made without a recorded decision.

Copied unchanged into every <artifact>-steward by meta-artifact-steward.
Standard library only. Run from anywhere inside the repo:

    python3 .claude/skills/<slug>-steward/scripts/state.py --check
    python3 .claude/skills/<slug>-steward/scripts/state.py --record --note "what changed"

--check  exit 0: unchanged since the last record
         exit 1: changed (or never recorded); lists what changed
         exit 2: can't run (CANNOT RUN: on stderr)
--record writes state.json beside steward.json: each artifact's sha256 and size,
         plus who recorded it, when, the git commit and the note.
"""
import argparse
import hashlib
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path

STEWARD_DIR = Path(__file__).resolve().parent.parent
CONTRACT = STEWARD_DIR / "steward.json"
STATE = STEWARD_DIR / "state.json"


def cannot_run(msg):
    print(f"CANNOT RUN: {msg}", file=sys.stderr)
    sys.exit(2)


def git(*args, cwd=STEWARD_DIR):
    try:
        return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return ""


def repo_root():
    root = git("rev-parse", "--show-toplevel")
    return Path(root) if root else STEWARD_DIR.parent.parent.parent


def fingerprint(path: Path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return {"sha256": h.hexdigest(), "bytes": path.stat().st_size}


def current(root, artifacts):
    out = {}
    for rel in artifacts:
        p = root / rel
        out[rel] = fingerprint(p) if p.is_file() else None
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--check", action="store_true")
    g.add_argument("--record", action="store_true")
    ap.add_argument("--note", default="")
    a = ap.parse_args()

    if not CONTRACT.exists():
        cannot_run(f"no steward.json in {STEWARD_DIR}. This script belongs to an <artifact>-steward.")
    try:
        contract = json.loads(CONTRACT.read_text())
        artifacts = contract["artifacts"]
    except (json.JSONDecodeError, KeyError) as e:
        cannot_run(f"steward.json is unreadable or has no 'artifacts' list ({e}).")
    root = repo_root()
    now = current(root, artifacts)

    if a.record:
        missing = [k for k, v in now.items() if v is None]
        if missing:
            cannot_run(f"artifact(s) not found, nothing recorded: {', '.join(missing)}")
        STATE.write_text(json.dumps({
            "recorded": datetime.now().strftime("%Y-%m-%d %H:%M"),
            "by": git("config", "user.name") or "unknown",
            "commit": git("rev-parse", "--short", "HEAD") or None,
            "note": a.note,
            "artifacts": now,
        }, indent=2) + "\n")
        print(f"Recorded {len(now)} artifact(s) in {STATE.relative_to(root)}")
        return

    if not STATE.exists():
        print("No recorded state yet. Run --record once the context and decisions are current.")
        sys.exit(1)
    old = json.loads(STATE.read_text())
    changed = []
    for rel, fp in now.items():
        before = old.get("artifacts", {}).get(rel)
        if fp is None:
            changed.append(f"{rel}: missing")
        elif before is None:
            changed.append(f"{rel}: not in the recorded state")
        elif fp["sha256"] != before["sha256"]:
            changed.append(f"{rel}: changed ({before['bytes']:,} → {fp['bytes']:,} bytes)")
    for rel in old.get("artifacts", {}):
        if rel not in now:
            changed.append(f"{rel}: recorded but no longer listed in steward.json")
    when = f"{old.get('recorded', '?')} by {old.get('by', '?')}" + (f" ({old['note']})" if old.get("note") else "")
    if not changed:
        print(f"Unchanged since the last record: {when}")
        return
    print(f"Changed since the last record, {when}:")
    for c in changed:
        print(f"  {c}")
    log = git("log", "--format=%h %an %ad %s", "--date=short", f"{old['commit']}..HEAD", "--", *artifacts, cwd=root) if old.get("commit") else ""
    if log:
        print("Commits touching the artifacts since then:")
        for line in log.splitlines():
            print(f"  {line}")
    print("Find out what changed and who decided it, and record it before making a new change.")
    sys.exit(1)


if __name__ == "__main__":
    main()
