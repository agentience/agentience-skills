# `scripts/digest-transcript.ts`

It reduces a session transcript (main loop plus all subagent sidecars) to a
timestamped markdown timeline at roughly 1.5% of raw size — a 1.9 MB session
digests to ~31 KB. It keeps user/assistant text, tool calls as one-liners, and
tool-result *errors*; it drops thinking blocks and non-error tool-result bodies.
That last omission is why Write mode's step 2 — the salience brief — exists.

**Call it through `scripts/digest.sh`, never `npx` directly.** The wrapper resolves
Node past nvm, fnm, asdf and volta, whose shims live in an interactive shell's rc
file and are therefore absent from the non-interactive shell the Bash tool spawns.
Observed on a stock Ubuntu box with nvm: `npx: command not found`, while
`~/.nvm/versions/node/v24.1.0/bin/npx` existed the whole time. `digest.sh --probe`
prints where it found Node; exit 127 means the dependency is genuinely missing, not
a PATH quirk to work around by hand.

## Provenance

Vendored from the `journal` skill
(`~/.claude/skills/journal/scripts/digest-transcript.ts`), and **resynced from it on
2026-08-28** — this copy, the standalone `agentience-skills` copy and the journal
copy were byte-identical at that point.

The drift that resync closed was one-directional: the journal copy is a functional
superset, carrying the same subagent-sidecar handling (refactored) plus
branch-lifecycle tracking — `cwd`/`gitBranch` fields, `SEGMENT_SPLIT`, `SEG_GIT`,
`SEG_WORKTREE_SCRIPT`, `SEG_NOISE`, and a branch-op extractor. Nothing has ever
existed only here. **So if the two drift again, resync *from* the journal skill,
never toward it:**

```bash
diff "${CLAUDE_SKILL_DIR}/scripts/digest-transcript.ts" \
     ~/.claude/skills/journal/scripts/digest-transcript.ts
```
