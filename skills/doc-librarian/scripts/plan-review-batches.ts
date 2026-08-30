#!/usr/bin/env -S node --experimental-strip-types
/**
 * plan-review-batches.ts — Turn triaged docs into parallelizable deep-dive work
 * packages for a team-enabled Claude Code session (non-destructive).
 *
 * Reads the triage CSV (triage-docs.ts) and the NLP analysis (analyze-docs.py)
 * and groups the selected docs (default: all non-KEEP) into batches where the
 * documents are closely related — same near-duplicate cluster, same TF-IDF
 * "related group", same NMF topic, and/or referencing the same source files — so
 * one agent can appraise a batch while reading the shared code context once.
 *
 * For each batch it writes a self-contained agent brief (documents + signals +
 * shared code files to read + a per-doc verdict rubric + an output schema). An
 * INDEX organizes the batches into WAVES so you can run N at a time and stay
 * within token limits.
 *
 * Grouping = similarity-first hybrid: near-dup ∪ related-group seeds (kept whole),
 * then packed by dominant topic + shared code references, directory as fallback.
 *
 * Usage:
 *   node --experimental-strip-types plan-review-batches.ts \
 *        --triage audits/2026-07-02-docs-triage.csv \
 *        --nlp    audits/nlp-analysis.json \
 *        --out-dir audits/review-batches \
 *        [--buckets REVIEW,WEED] [--batch-size 8] [--max-batch-size 12]
 *        [--wave-size 5] [--max-batches N] [--start-batch K]
 *
 * --max-batches / --start-batch emit only one wave's briefs at a time (the INDEX
 * always shows the full plan). Nothing is modified in docs/.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";

/**
 * Frontmatter owner for generated reports. Derived, never hardcoded: someone
 * running this in their own repo must not inherit another maintainer's name.
 * Env override first, then the repo's configured git user, then a neutral
 * placeholder that reads as "fill this in".
 */
function docOwner(): string {
  const env = process.env.DOC_LIBRARIAN_OWNER?.trim();
  if (env) return env.startsWith("@") ? env : `@${env}`;
  try {
    const name = execSync("git config user.name", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (slug) return `@${slug}`;
  } catch {
    /* not a git repo, or user.name unset */
  }
  return "@unassigned";
}


interface Opts {
  root: string; docs: string; triage: string | null; nlp: string | null;
  outDir: string | null; buckets: Set<string>;
  batchSize: number; maxBatchSize: number; waveSize: number;
  maxBatches: number; startBatch: number;
}

function parseArgs(argv: string[]): Opts {
  const get = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const num = (f: string, d: number) => { const v = get(f); const n = v ? Number(v) : NaN; return Number.isFinite(n) ? n : d; };
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(1, 36)
      .map((l) => l.replace(/^\s?\*\/?/, "").replace(/^\//, "")).join("\n"));
    process.exit(0);
  }
  let root = get("--root");
  if (!root) { try { root = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim(); } catch { root = process.cwd(); } }
  const buckets = (get("--buckets") ?? "REVIEW,WEED").split(",").map((s) => s.trim().toUpperCase());
  return {
    root: path.resolve(root), docs: get("--docs") ?? "docs",
    triage: get("--triage") ?? null, nlp: get("--nlp") ?? null,
    outDir: get("--out-dir") ?? null, buckets: new Set(buckets),
    batchSize: num("--batch-size", 8), maxBatchSize: num("--max-batch-size", 12),
    waveSize: num("--wave-size", 5),
    maxBatches: num("--max-batches", Infinity), startBatch: num("--start-batch", 1),
  };
}

// --- minimal CSV parser (quoted fields, embedded commas/quotes) ---
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "", row: string[] = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c === "\r") { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift() ?? [];
  return rows.filter((r) => r.length > 1).map((r) => {
    const o: Record<string, string> = {};
    header.forEach((h, i) => (o[h] = r[i] ?? ""));
    return o;
  });
}

interface Doc {
  rel: string; bucket: string; score: number; topDir: string; lastCommit: string;
  age: string; inbound: string; anchorPct: string; codeRefs: string[];
  simTo: string; simPct: string; reasons: string; topic: number | null; topicLabel: string | null;
}

// --- union-find for merging seed groups ---
class UF {
  p = new Map<string, string>();
  find(x: string): string { if (!this.p.has(x)) this.p.set(x, x); let r = x; while (this.p.get(r) !== r) r = this.p.get(r)!; let c = x; while (this.p.get(c) !== r) { const n = this.p.get(c)!; this.p.set(c, r); c = n; } return r; }
  union(a: string, b: string) { this.p.set(this.find(a), this.find(b)); }
}

interface Batch {
  id: number; topic: number | null; topicLabel: string | null; docs: Doc[];
  dirs: string[]; sharedCode: { file: string; count: number }[];
  mergePairs: { a: string; b: string; pct: string }[];
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const docsAbs = path.join(opts.root, opts.docs);
  const triagePath = opts.triage ?? path.join(docsAbs, "triage-report.csv");
  if (!fs.existsSync(triagePath)) { console.error(`triage CSV not found: ${triagePath} (run triage-docs.ts --format csv)`); process.exit(1); }
  const nlpPath = opts.nlp ??
    [path.join(path.dirname(triagePath), "nlp-analysis.json"), path.join(docsAbs, "nlp-analysis.json")]
      .find((p) => fs.existsSync(p)) ?? "";
  const nlp = nlpPath && fs.existsSync(nlpPath) ? JSON.parse(fs.readFileSync(nlpPath, "utf8")) : null;
  const docTopics: Record<string, { topic: number | null; label: string | null }> = nlp?.doc_topics ?? {};

  // load + select docs
  const rows = parseCsv(fs.readFileSync(triagePath, "utf8"));
  const docs: Doc[] = rows
    .filter((r) => opts.buckets.has((r.bucket || "").toUpperCase()))
    .map((r) => ({
      rel: r.doc_path, bucket: r.bucket, score: Number(r.score) || 0, topDir: r.top_dir,
      lastCommit: r.last_commit, age: r.age_months, inbound: r.inbound_links,
      anchorPct: r.anchor_valid_pct, codeRefs: r.code_refs ? r.code_refs.split(";").filter(Boolean) : [],
      simTo: r.near_dup_of, simPct: r.near_dup_sim_pct, reasons: r.reasons,
      topic: docTopics[r.doc_path]?.topic ?? null, topicLabel: docTopics[r.doc_path]?.label ?? null,
    }));
  const docByRel = new Map(docs.map((d) => [d.rel, d]));
  const selected = new Set(docs.map((d) => d.rel));

  // seeds: near-dup clusters ∪ related groups (only among selected docs)
  const uf = new UF();
  const seedGroups: string[][] = [];
  for (const g of [...(nlp?.near_duplicates?.clusters ?? []), ...(nlp?.near_duplicates?.related_groups ?? [])]) {
    const members = (g.docs as string[]).filter((d) => selected.has(d));
    if (members.length >= 2) { for (let i = 1; i < members.length; i++) uf.union(members[0], members[i]); }
  }
  const seedOf = new Map<string, string>();
  for (const d of docs) seedOf.set(d.rel, uf.find(d.rel));
  const groups = new Map<string, Doc[]>();
  for (const d of docs) { const k = seedOf.get(d.rel)!; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(d); }

  // units = seed groups (kept intact, split if larger than maxBatchSize) + singletons
  interface Unit { docs: Doc[]; topic: number | null; }
  const units: Unit[] = [];
  const majorityTopic = (ds: Doc[]): number | null => {
    const c = new Map<number, number>(); let best: number | null = null, bn = 0;
    for (const d of ds) if (d.topic !== null) { const n = (c.get(d.topic) ?? 0) + 1; c.set(d.topic, n); if (n > bn) { bn = n; best = d.topic; } }
    return best;
  };
  for (const g of groups.values()) {
    if (g.length <= opts.maxBatchSize) units.push({ docs: g, topic: majorityTopic(g) });
    else for (let i = 0; i < g.length; i += opts.maxBatchSize) units.push({ docs: g.slice(i, i + opts.maxBatchSize), topic: majorityTopic(g.slice(i, i + opts.maxBatchSize)) });
  }

  // pack units into batches, grouped by topic; within a topic order by shared code / dir
  const byTopic = new Map<number, Unit[]>();
  for (const u of units) { const t = u.topic ?? -1; if (!byTopic.has(t)) byTopic.set(t, []); byTopic.get(t)!.push(u); }
  const topicOrder = [...byTopic.keys()].sort((a, b) =>
    (byTopic.get(b)!.reduce((s, u) => s + u.docs.length, 0)) - (byTopic.get(a)!.reduce((s, u) => s + u.docs.length, 0)));

  const batches: Batch[] = [];
  for (const t of topicOrder) {
    const us = byTopic.get(t)!.sort((a, b) => {
      const ca = a.docs.flatMap((d) => d.codeRefs)[0] ?? "~"; const cb = b.docs.flatMap((d) => d.codeRefs)[0] ?? "~";
      return ca.localeCompare(cb) || a.docs[0].topDir.localeCompare(b.docs[0].topDir);
    });
    let cur: Doc[] = [];
    const flush = () => {
      if (!cur.length) return;
      const dirs = [...new Set(cur.map((d) => d.topDir))].sort();
      const codeCount = new Map<string, number>();
      for (const d of cur) for (const c of new Set(d.codeRefs)) codeCount.set(c, (codeCount.get(c) ?? 0) + 1);
      const sharedCode = [...codeCount.entries()].sort((a, b) => b[1] - a[1]).map(([file, count]) => ({ file, count }));
      const mergePairs: Batch["mergePairs"] = [];
      const inBatch = new Set(cur.map((d) => d.rel));
      for (const d of cur) if (d.simTo && Number(d.simPct) >= 70) {
        const partner = cur.find((x) => path.posix.basename(x.rel) === d.simTo && inBatch.has(x.rel));
        if (partner && d.rel < partner.rel) mergePairs.push({ a: d.rel, b: partner.rel, pct: d.simPct });
      }
      batches.push({ id: 0, topic: t === -1 ? null : t, topicLabel: cur.find((d) => d.topicLabel)?.topicLabel ?? null, docs: [...cur], dirs, sharedCode, mergePairs });
      cur = [];
    };
    for (const u of us) {
      if (cur.length && cur.length + u.docs.length > opts.batchSize) flush();
      cur.push(...u.docs);
      if (cur.length >= opts.maxBatchSize) flush();
    }
    flush();
  }
  batches.forEach((b, i) => (b.id = i + 1));

  // --- write outputs ---
  const outDir = opts.outDir ?? path.join(path.dirname(triagePath), "review-batches");
  fs.mkdirSync(path.join(outDir, "results"), { recursive: true });
  fs.writeFileSync(path.join(outDir, "results", ".gitkeep"), "");

  const totalDocs = docs.length;
  const nWaves = Math.ceil(batches.length / opts.waveSize);
  fs.writeFileSync(path.join(outDir, "batches.json"), JSON.stringify({
    generated: new Date().toISOString().slice(0, 10),
    params: { buckets: [...opts.buckets], batchSize: opts.batchSize, maxBatchSize: opts.maxBatchSize, waveSize: opts.waveSize },
    totals: { docs: totalDocs, batches: batches.length, waves: nWaves },
    batches: batches.map((b) => ({ id: b.id, topic: b.topic, topicLabel: b.topicLabel, docCount: b.docs.length, dirs: b.dirs, docs: b.docs.map((d) => d.rel), sharedCode: b.sharedCode.slice(0, 15), mergePairs: b.mergePairs })),
  }, null, 1));

  fs.writeFileSync(path.join(outDir, "INDEX.md"), renderIndex(opts, batches, totalDocs, nWaves));

  // emit briefs for the requested range only (wave throttling)
  const start = Math.max(1, opts.startBatch);
  const end = Number.isFinite(opts.maxBatches) ? Math.min(batches.length, start + opts.maxBatches - 1) : batches.length;
  let written = 0;
  for (const b of batches) {
    if (b.id < start || b.id > end) continue;
    fs.writeFileSync(path.join(outDir, `batch-${String(b.id).padStart(3, "0")}.md`), renderBrief(opts, b, batches.length));
    written++;
  }

  console.log(`Selected ${totalDocs} docs (${[...opts.buckets].join("+")}) → ${batches.length} batches, ${nWaves} waves of ${opts.waveSize}.`);
  console.log(`Wrote INDEX.md, batches.json, and ${written} brief(s) [batches ${start}..${end}] to ${outDir}`);
  if (written < batches.length) console.log(`Emit the next wave with: --start-batch ${end + 1} --max-batches ${opts.waveSize}`);
}

function renderIndex(opts: Opts, batches: Batch[], totalDocs: number, nWaves: number): string {
  const now = new Date().toISOString().slice(0, 10);
  let waves = "";
  for (let w = 0; w < nWaves; w++) {
    const ids = batches.slice(w * opts.waveSize, (w + 1) * opts.waveSize);
    const dc = ids.reduce((s, b) => s + b.docs.length, 0);
    waves += `- **Wave ${w + 1}** — batches ${ids[0].id}–${ids[ids.length - 1].id} (${dc} docs). ` +
      `Generate: \`--start-batch ${ids[0].id} --max-batches ${opts.waveSize}\`\n`;
  }
  const statusRows = batches.map((b) =>
    `| ${b.id} | ${b.docs.length} | ${b.topicLabel ? b.topicLabel.split(",")[0] : "—"} | ${b.dirs.slice(0, 3).join(", ")}${b.dirs.length > 3 ? "…" : ""} | ${b.mergePairs.length || ""} | ☐ |`).join("\n");
  return `---
title: "REVIEW deep-dive — batch plan"
doc_type: reference
status: active
owner: "${docOwner()}"
updated: ${now}
tags: [standards]
---

# Deep-dive Batch Plan (${totalDocs} docs → ${batches.length} batches)

Generated ${now} by \`plan-review-batches.ts\`. Non-destructive. Covers buckets:
**${[...opts.buckets].join(", ")}**. Grouping: similarity-first hybrid (near-duplicate
∪ TF-IDF related-group seeds, packed by NMF topic + shared code references).

Each batch has a self-contained brief (\`batch-NNN.md\`) sized to **≤ ${opts.maxBatchSize}
docs** so one agent can appraise it in a single context. Agents produce a
**verdict + evidence** per doc and write results to \`results/batch-NNN.result.md\`.

## Run it in a team-enabled Claude Code session

1. Pick a wave (below). Generate its briefs if not already present:
   \`node --experimental-strip-types plan-review-batches.ts --start-batch <first> --max-batches ${opts.waveSize} …\`
2. Spawn **one agent per batch in the wave** (${opts.waveSize} at a time keeps tokens bounded).
   Give each agent: "Read \`review-batches/batch-NNN.md\` and follow it exactly.
   First read the shared code files it lists, then appraise each document, then
   write \`review-batches/results/batch-NNN.result.md\` using the required schema."
3. When a wave's results are in, move to the next wave. Aggregate at the end
   (all verdicts across \`results/*.result.md\`) to drive the archive/merge plan.

## Waves

${waves}
## Batches

| # | docs | theme | dirs | merge-pairs | done |
|--:|-----:|-------|------|:-----------:|:----:|
${statusRows}

_Full machine-readable plan: \`batches.json\`._
`;
}

function renderBrief(opts: Opts, b: Batch, total: number): string {
  const now = new Date().toISOString().slice(0, 10);
  const shared = b.sharedCode.filter((s) => s.count >= 1).slice(0, 20);
  const sharedList = shared.length
    ? shared.map((s) => `- \`${s.file}\`${s.count > 1 ? `  ← cited by ${s.count} docs (shared context)` : ""}`).join("\n")
    : "_No source-file references detected in this batch — appraise from doc content + git history._";
  const docRows = b.docs.map((d) =>
    `| \`${d.rel}\` | ${d.bucket} | ${d.score} | ${d.lastCommit} | ${d.age}mo | ${d.inbound} | ${d.anchorPct || "—"} | ${d.reasons.replace(/\s*\|\s*/g, "; ")} |`).join("\n");
  const merges = b.mergePairs.length
    ? b.mergePairs.map((m) => `- \`${m.a}\`  ↔  \`${m.b}\`  (~${m.pct}% similar → likely MERGE)`).join("\n")
    : "_None flagged._";
  return `---
title: "Deep-dive batch ${b.id} of ${total}"
doc_type: how-to
status: active
batch_id: ${b.id}
theme: "${b.topicLabel ?? "mixed"}"
updated: ${now}
tags: [standards]
---

# Deep-dive Batch ${b.id} — appraise ${b.docs.length} documents

**Theme:** ${b.topicLabel ?? "mixed"}  ·  **Directories:** ${b.dirs.join(", ")}

You are a documentation appraiser. Decide the fate of each document below with
**evidence**. These docs were grouped because they are topically/textually related
and often touch the same code, so read the shared code context once and reuse it.

## Step 1 — Load shared code context first

Read these source files (referenced by the docs in this batch) before appraising,
so your verdicts are grounded in the current code:

${sharedList}

## Step 2 — Appraise each document

For every doc: open it, compare its claims against the code you just read and its
git history, then assign a verdict.

| Document | bucket | score | last commit | age | inbound | anchors ok | triage reasons |
|----------|--------|------:|-------------|----:|--------:|-----------:|----------------|
${docRows}

### Likely merges within this batch
${merges}

### Verdict taxonomy (choose exactly one per doc)
- **KEEP** — current and correct; no change needed.
- **UPDATE** — still relevant but stale/inaccurate; note what to fix.
- **MERGE → <target>** — duplicate/overlap; fold into the named canonical doc.
- **DEPRECATE** — superseded; keep with a banner pointing to its replacement.
- **ARCHIVE** — historical only; move to \`docs/archive/\`.
- **DELETE** — no value and unreferenced; safe to remove (git retains history).

For each verdict record: **confidence** (high/med/low), **evidence** (which code
paths/commits you checked and what confirms or contradicts the doc), **effort**
(S/M/L), and for MERGE/DEPRECATE the **target** doc.

## Step 3 — Write your results

Create \`results/batch-${String(b.id).padStart(3, "0")}.result.md\` with this schema:

\`\`\`markdown
---
batch_id: ${b.id}
appraised: <date>
---
| Document | Verdict | Target | Confidence | Effort | Evidence |
|----------|---------|--------|-----------|--------|----------|
| <path> | KEEP/UPDATE/MERGE/DEPRECATE/ARCHIVE/DELETE | <merge/dep target or —> | high/med/low | S/M/L | <code paths checked + finding> |
\`\`\`

Do not modify any documents or code — this is appraisal only. Output verdicts only.
`;
}

main();
