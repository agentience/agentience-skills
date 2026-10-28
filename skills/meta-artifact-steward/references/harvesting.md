# Harvesting context and decisions

**Last Updated: 2026-10-28 12:25**

How to find what got an artifact to where it is, and how to write it down so a cold reader can trust it.

## Where to look, in order

1. **The current conversation.** This is usually the richest source, and the one that's lost first. Go through it for:
   - each request that shaped the artifact
   - each correction ("no, make it X")
   - each choice between options the person made
   - each assumption you made that they didn't challenge (that's an assumption, not a decision)
2. **Session transcripts**, if the artifact was built over several sessions. A transcript-digest tool, if you have one, is cheaper than reading raw transcripts.
3. **Meeting summaries and transcripts.** Decisions with timestamps are the best citations there are.
4. **Handoff documents and briefs.** Look in their Decided and Decisions-needed sections, and drafting notes.
5. **Git history** on the artifact and its neighbours: `git log --follow -p` for what changed, and commit messages for why.
6. **Review comments** on the artifact or its published form.
7. **The artifact itself:** notes, comments, README tabs, drafting blocks.

Stop when new sources only repeat what you have.

## Sorting what you find

| It is a… | When | Goes in |
|---|---|---|
| **Decision** | Someone chose, and it was accepted | `decisions.md` with who, when, source, why, and where it shows |
| **Open question** | Raised, not settled, or explicitly deferred | `decisions.md` → Open questions, with an owner |
| **Assumption** | A value or premise used but never chosen by anyone | `context.md` → Assumptions, with its source, or "proposal by <who>, not yet reviewed" |
| **Fact** | True regardless of anyone's choice (a constraint, a source's figure) | `context.md`, with its source |
| **History** | How something was tried and dropped | Only as the *why* of the decision that dropped it. Not a separate entry |

The line between a decision and an assumption matters most. The person who made the artifact will defend a decision and revisit an assumption, and a reader treats the two very differently. **When in doubt, it's an assumption.**

## Citing

- **Meetings:** the summary's path plus a timestamp (`meetings/2026-10-28-sync.md`, 41:26).
- **This session:** "<who>, this session, <date>". The transcript won't survive, so the decision's text must stand on its own.
- **Documents:** path plus section (`proposal/Brief.md` §3).
- **Commits:** the short SHA.

## Attribution

Name people. If two people decided something together, name both. If the record shows only that "it was decided", ask the person who decided it. If they don't know, record it as an open question to confirm.

## Visibility

Harvesting pulls from private places: candid meetings, internal pricing, partner terms. Before writing anything into the steward, check the visibility recorded in `steward.json` against where the steward lives and who can read that repo. Leave anything that shouldn't travel out of the steward, and say so to the person.
