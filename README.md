# agentience-skills

**Last Updated: 2026-08-11 11:35**

Claude Code skills I use daily and think are worth sharing. Each one is
self-contained: a directory under `skills/`, installable on its own, with its own
README and its own opt-in `install.sh`.

## Skills

| Skill | What it does |
|---|---|
| [`handoff`](skills/handoff) | End a session by writing a handoff document; start the next by reading it. On tmux, the writing session respawns its own window into a fresh session already reading the doc. |

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
- **Diagrams are mermaid**, colorless, with the `.mmd` source committed beside
  the doc that uses it. Color lives in the renderer's theme so diagrams adapt to
  light and dark mode.

## License

MIT — see [LICENSE](LICENSE).
