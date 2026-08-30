# agentience-skills

**Last Updated: 2026-08-29 21:31**

Claude Code skills I use daily and think are worth sharing. Each one is
self-contained: a directory under `skills/`, installable on its own, with its own
README and its own opt-in `install.sh`.

## Skills

| Skill | What it does |
|---|---|
| [`handoff`](skills/handoff) | End a session by writing a handoff document; start the next by reading it. In tmux or Herdr, the writing session hands its own window to a fresh session already reading the doc — or, with `--split`, opens one in a pane below and keeps its own. |
| [`doc-librarian`](skills/doc-librarian) | Apply library science to a repository's `docs/`: audit, triage, reorganize into Diátaxis, index and tag it — backing every verdict with counts from git history, repo-wide referrer checks and TF-IDF similarity rather than taste. |

## Installing

Clone the repo somewhere permanent, then run the installer for the skill you
want:

```bash
git clone https://github.com/agentience/agentience-skills.git
cd agentience-skills/skills/handoff
./install.sh --dry-run    # every path it would touch, no changes
./install.sh
```

By default `install.sh` **symlinks** the skill into `~/.claude/skills/`, so
`git pull` updates it in place. Pass `--copy` if you'd rather have a snapshot,
and `--uninstall` to reverse everything.

Start a **new** Claude Code session afterwards — a running session keeps the
skill text it loaded at startup.

## House rules for skills in here

- **Opt-in installation.** Nothing writes to `~/.claude/settings.json` without
  you running a script that says exactly what it will touch first. Every
  installer backs up settings before editing, is safe to re-run, and has an
  `--uninstall`.
- **Degrade, don't break.** A skill that depends on something optional — tmux, a
  particular CLI — works without it, minus that feature, and says so.
- **A skill that exists twice ships a drift check.** Where a skill also lives
  outside this repo — mirrored from a plugin, or installed into `~/.claude` — there
  is a script under `scripts/` that diffs the copies and can push either way. One
  `version` field cannot tell you two trees have diverged.
- **Diagrams are mermaid**, colorless, with the `.mmd` source committed beside
  the doc that uses it. Color lives in the renderer's theme so diagrams adapt to
  light and dark mode.

## License

MIT — see [LICENSE](LICENSE).
