# Procedure H — Deep-dive appraisal at scale (multi-agent)

Full detail for Procedure H. `SKILL.md` carries a short stub under **When to use
which procedure**; read this file before running a deep-dive.

Automated triage (E) sorts by signal but can't read intent. For the large REVIEW
bucket — and any WEED you want double-checked — fan the work out to a team-enabled
Claude Code session: many agents, each carefully reading a small batch of *related*
documents and returning a per-doc verdict backed by evidence.

1. **Prerequisites.** A triage CSV (Procedure E, `--format csv`) and
   `nlp-analysis.json` (the NLP layer) — the planner needs both.
2. **Plan the batches** with `plan-review-batches.ts`, run from the target repo's
   root (see *Running this skill's scripts* in `SKILL.md`):
   ```bash
   node --experimental-strip-types "${CLAUDE_SKILL_DIR}/scripts/plan-review-batches.ts" \
     --triage .doc-librarian/triage-report.csv \
     --buckets REVIEW,WEED --batch-size 8 --wave-size 5
   ```
   Grouping is **similarity-first**: near-duplicate ∪ TF-IDF related-group seeds
   are kept in the *same* batch (so one agent can decide a merge), then packed by
   NMF topic and shared code references so a batch shares context.

   Do **not** add `--max-batches` here. It caps how many briefs are written, so a
   capped plan silently appraises only part of the corpus — no warning, and the
   unwritten batches simply never get a verdict. Use it only together with
   `--start-batch` to emit one wave at a time.

   It writes an
   `INDEX.md` (full plan + waves + status), `batches.json`, and one self-contained
   `batch-NNN.md` brief per batch. Each brief lists the source files to read once,
   the docs with their signals, likely in-batch merges, the verdict taxonomy
   (KEEP / UPDATE / MERGE→x / DEPRECATE / ARCHIVE / DELETE), and an output schema.
3. **Run a wave.** In a team-enabled session, spawn **one agent per batch in the
   wave** (`--wave-size` at a time bounds tokens). Tell each: "Read
   `.doc-librarian/review-batches/batch-NNN.md` and follow it exactly — read the shared code
   first, appraise each doc, then write `.doc-librarian/review-batches/results/batch-NNN.result.md`
   using the schema." Emit the next wave's briefs with `--start-batch`.
4. **Aggregate** all `results/*.result.md` verdicts with `aggregate-results.ts`
   into coverage + action lists (`appraisal-summary.md`, `appraisal-actions.md/.csv`).
   Re-run after each wave — it's idempotent. Groups MERGE by canonical target and
   flags DELETE-with-inbound / low-confidence for a second look.
5. **Apply** the mechanical verdicts with `apply-actions.ts` (Procedure E/B
   execution — see Procedure E). Dry-run first; stage per batch.

Appraisal only — agents produce verdicts + evidence, never edits. Execution is a
separate, gated step (`apply-actions.ts`), not something the appraiser agents do.
