#!/usr/bin/env tsx
/**
 * suggest-tags.ts — Bootstrap a controlled vocabulary (TAGS.md) from a docs
 * corpus (non-destructive).
 *
 * A controlled vocabulary must exist BEFORE you tag or reorganize docs, but it
 * shouldn't be invented from thin air. This script mines the collection for the
 * terms people actually use — directory names (structural topics) and the
 * high-frequency words/phrases in doc titles and headings (topical vocabulary) —
 * and emits a DRAFT TAGS.md for a human to curate (pick preferred terms, fold in
 * synonyms, delete noise). It reads only; it writes a single draft file.
 *
 * Usage:
 *   node --experimental-strip-types scripts/suggest-tags.ts [options]
 *   # or: npx tsx scripts/suggest-tags.ts   (where esbuild matches the platform)
 *
 * Options:
 *   --root <path>   Repo root (default: git toplevel)
 *   --docs <rel>    Docs dir relative to root (default: docs)
 *   --out <path>    Output draft (default: <root>/.doc-librarian/TAGS.draft.md).
 *                   Out of the audited tree on purpose — a draft left in docs/
 *                   is picked up as a document by the next scan.
 *   --top <n>       Max topical candidates to list (default: 60)
 *   --min-docs <n>  Min document frequency to include a candidate (default: 3)
 *   --include-generated   Include generated dirs (api/) — excluded by default
 *   --help
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
// Working directory for everything this skill emits, relative to the repo root.
// Deliberately OUTSIDE the tree being audited: a report or a draft written into
// docs/ becomes a document, and the next scan then appraises the skill's own
// output alongside the corpus. `setup.sh` adds this to .gitignore.
const WORKDIR = ".doc-librarian";


interface Opts {
  root: string; docs: string; out: string | null;
  top: number; minDocs: number; includeGenerated: boolean; nlp: string | null;
}

/** Enrichment from analyze-docs.py (scikit-learn TF-IDF salience + NMF themes). */
interface NlpTags {
  tags?: { candidates?: { term: string; df: number; salience: number; topic: number | null }[] };
  topics?: { id: number; terms: string[]; weight: number }[];
  params?: Record<string, unknown>;
}

function loadNlpTags(opts: Opts, docsAbs: string): NlpTags | null {
  const candidates = [
    opts.nlp,
    opts.out ? path.join(path.dirname(opts.out), "nlp-analysis.json") : null,
    path.join(docsAbs, "nlp-analysis.json"),
    path.join(process.cwd(), "nlp-analysis.json"),
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return JSON.parse(fs.readFileSync(c, "utf8")) as NlpTags; }
    catch { /* ignore */ }
  }
  return null;
}

function parseArgs(argv: string[]): Opts {
  const get = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(1, 30)
      .map((l) => l.replace(/^\s?\*\/?/, "").replace(/^\//, "")).join("\n"));
    process.exit(0);
  }
  let root = get("--root");
  if (!root) { try { root = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim(); } catch { root = process.cwd(); } }
  const num = (f: string, d: number) => { const v = get(f); const n = v ? Number(v) : NaN; return Number.isFinite(n) ? n : d; };
  return {
    root: path.resolve(root), docs: get("--docs") ?? "docs", out: get("--out") ?? null,
    top: num("--top", 60), minDocs: num("--min-docs", 3),
    includeGenerated: argv.includes("--include-generated"),
    nlp: get("--nlp") ?? null,
  };
}

// Generic words that are never useful as topical tags.
const STOP = new Set([
  // english function words
  "the","a","an","and","or","of","to","for","in","on","with","by","from","at","as","is","are","be",
  "this","that","these","those","it","its","you","your","we","our","can","will","should","how","what",
  "when","which","not","no","yes","if","then","else","into","out","up","down","via","per","vs",
  // doc-generic noise
  "guide","guides","plan","plans","planning","note","notes","overview","summary","intro","introduction",
  "readme","index","doc","docs","documentation","implementation","implementing","spec","specification",
  "reference","tutorial","example","examples","using","use","used","new","update","updates","updated",
  "fix","fixes","fixed","setup","getting","started","complete","completed","final","draft","wip","todo",
  "misc","general","part","section","phase","step","steps","status","support","supported","overview",
  "add","adding","added","remove","create","creating","creation","change","changes","changed","work",
  "working","file","files","list","table","design","approach","strategy","solution","issue","issues",
  "problem","process","system","page","pages","data","test","tests","testing","report","reports",
  // common heading-structure words (not topics)
  "next","key","points","point","result","results","current","related","required","background",
  "context","goal","goals","purpose","prerequisites","conclusion","benefits","details","description",
  "cases","case","options","option","requirements","tasks","task","items","item","before","after",
]);

const CODE_LIKE = /^[a-z]+[A-Z]/; // camelCase identifiers -> likely code, not a tag

function walkMd(dir: string, includeGenerated: boolean): string[] {
  const out: string[] = []; const stack = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[]; try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        if (["node_modules", ".git", ".agentics"].includes(e.name)) continue;
        if (!includeGenerated && e.name === "api" && path.dirname(full) === dir) continue;
        stack.push(full);
      } else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) out.push(full);
    }
  }
  return out.sort();
}

function tokenize(s: string): string[] {
  return s.toLowerCase().replace(/[`*_#>\[\]()]/g, " ").split(/[^a-z0-9]+/).filter(Boolean);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const docsAbs = path.join(opts.root, opts.docs);
  if (!fs.existsSync(docsAbs)) { console.error(`docs dir not found: ${docsAbs}`); process.exit(1); }
  const files = walkMd(docsAbs, opts.includeGenerated);

  // structural candidates: first + second path segments
  const dirDf = new Map<string, number>();
  // topical candidates: doc-frequency of unigrams + bigrams from title + headings
  const termDf = new Map<string, number>();
  const termDirs = new Map<string, Set<string>>();

  for (const abs of files) {
    const docRel = path.relative(docsAbs, abs).split(path.sep).join("/");
    const segs = docRel.split("/");
    const topSeg = segs[0];
    if (segs.length > 1) { // it's inside a dir, not a root loose file
      dirDf.set(topSeg, (dirDf.get(topSeg) ?? 0) + 1);
    }
    const text = fs.readFileSync(abs, "utf8");
    // title (first H1) + all headings
    const headingLines = text.split("\n").filter((l) => /^#{1,3}\s/.test(l));
    const h1 = text.match(/^#\s+(.+)$/m)?.[1] ?? path.basename(docRel, ".md").replace(/[-_]/g, " ");
    const source = [h1, ...headingLines].join(" ");
    const toks = tokenize(source).filter((t) => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t));
    const present = new Set<string>();
    for (let i = 0; i < toks.length; i++) {
      present.add(toks[i]);
      if (i + 1 < toks.length && !STOP.has(toks[i + 1])) present.add(toks[i] + " " + toks[i + 1]);
    }
    for (const t of present) {
      termDf.set(t, (termDf.get(t) ?? 0) + 1);
      if (!termDirs.has(t)) termDirs.set(t, new Set());
      termDirs.get(t)!.add(topSeg);
    }
  }

  // rank topical candidates: prefer multi-word (more specific) and high df
  const topical = [...termDf.entries()]
    .filter(([t, df]) => df >= opts.minDocs && !CODE_LIKE.test(t))
    .map(([t, df]) => ({ term: t, df, dirs: termDirs.get(t)!.size, words: t.includes(" ") ? 2 : 1 }))
    // collapse a unigram that is dominated by a bigram it belongs to? keep both; curator decides
    .sort((a, b) => b.df - a.df || b.words - a.words || a.term.localeCompare(b.term))
    .slice(0, opts.top);

  const structural = [...dirDf.entries()].sort((a, b) => b[1] - a[1]);

  const now = new Date().toISOString().slice(0, 10);
  const nlp = loadNlpTags(opts, docsAbs);
  let out: string; let mode: string; let nTopical: number;
  if (nlp?.tags?.candidates?.length) {
    out = renderThemed(opts, now, files.length, structural, nlp);
    mode = "TF-IDF salience + NMF themes (scikit-learn)";
    nTopical = Math.min(opts.top, nlp.tags.candidates.length);
  } else {
    out = renderDraft(opts, now, files.length, structural, topical);
    mode = "frequency heuristic (no NLP artifact found — run analyze-docs.py for TF-IDF/themes)";
    nTopical = topical.length;
  }
  const outPath = opts.out ?? path.join(opts.root, WORKDIR, "TAGS.draft.md");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, out);
  console.log(`Scanned ${files.length} docs. Drafted ${nTopical} topical + ${structural.length} structural candidates.`);
  console.log(`Ranking: ${mode}`);
  console.log(`Draft: ${outPath}`);
}

function renderThemed(
  opts: Opts, now: string, scanned: number,
  structural: [string, number][],
  nlp: NlpTags
): string {
  const structRows = structural.map(([d, n]) =>
    `| \`${d.replace(/[_-]+/g, "-")}\` | ${n} | ${d} |`).join("\n");
  const cands = (nlp.tags!.candidates ?? []).slice(0, opts.top);
  const topics = (nlp.topics ?? []).slice().sort((a, b) => b.weight - a.weight);
  const byTopic = new Map<number, typeof cands>();
  const unthemed: typeof cands = [];
  for (const c of cands) {
    if (c.topic === null || c.topic === undefined) unthemed.push(c);
    else { if (!byTopic.has(c.topic)) byTopic.set(c.topic, []); byTopic.get(c.topic)!.push(c); }
  }
  const row = (c: { term: string; df: number; salience: number }) =>
    `| \`${c.term}\` | ${c.df} | ${c.salience} |  |`;
  let themed = "";
  for (const t of topics) {
    const group = (byTopic.get(t.id) ?? []).sort((a, b) => b.salience - a.salience);
    if (!group.length) continue;
    const label = t.terms.slice(0, 4).join(", ");
    themed += `\n### Theme ${t.id}: _${label}_\n\n` +
      `| Candidate tag | df | salience | Use instead of (curate) |\n` +
      `|---------------|---:|---------:|-------------------------|\n` +
      group.map(row).join("\n") + "\n";
  }
  if (unthemed.length) {
    themed += `\n### Other salient terms\n\n` +
      `| Candidate tag | df | salience | Use instead of (curate) |\n` +
      `|---------------|---:|---------:|-------------------------|\n` +
      unthemed.sort((a, b) => b.salience - a.salience).map(row).join("\n") + "\n";
  }
  return `# TAGS.md — DRAFT (scikit-learn TF-IDF + NMF themes)

Generated ${now} by \`suggest-tags.ts\` + \`analyze-docs.py\` from ${scanned} docs
under \`${opts.docs}/\`. **This is a draft, not a finished vocabulary.**

Candidates are ranked by **TF-IDF salience** (distinctive terms, not just frequent
ones) and grouped into **NMF topic themes** so related tags sit together. \`df\` =
docs containing the term; \`salience\` = summed TF-IDF weight across the corpus.

Curate: within each theme pick preferred terms, fold synonyms into "Use instead
of", delete noise; aim for ~20–40 tags total (1–4 per doc). Terms that will become
primary-axis folders don't also need to be tags.

## Structural candidates (directory names)

| Candidate tag | df | Source dir |
|---------------|---:|------------|
${structRows}

## Topical candidates by theme
${themed}
---

### Curation checklist
1. Merge synonyms → one preferred term per concept.
2. Drop terms too generic to filter on, and one-off terms.
3. Keep the set small and mutually exclusive.
4. Move the finished tags into \`${opts.docs}/TAGS.md\` (drop df/salience columns).
5. Wire a CI check that frontmatter \`tags:\` all exist in TAGS.md.
`;
}

function renderDraft(
  opts: Opts, now: string, scanned: number,
  structural: [string, number][],
  topical: { term: string; df: number; dirs: number }[]
): string {
  const structRows = structural.map(([d, n]) =>
    `| \`${d.replace(/[_-]+/g, "-")}\` | ${n} | ${d} |`).join("\n");
  const topRows = topical.map((t) =>
    `| \`${t.term.replace(/ /g, "-")}\` | ${t.df} | ${t.dirs} |  |`).join("\n");
  return `# TAGS.md — DRAFT (auto-generated candidates)

Generated ${now} by \`suggest-tags.ts\` from ${scanned} docs under \`${opts.docs}/\`.
**This is a draft, not a finished vocabulary.** Curate it: pick one preferred term
per concept, fold near-duplicates into the "Use instead of" column, delete noise,
and aim for a small, mutually-exclusive set (~20–40 tags). Then save as
\`${opts.docs}/TAGS.md\` and lint frontmatter \`tags:\` against it.

Candidates come from the words authors actually use (doc titles + headings) and
from directory names — so they reflect the real domain, not a guess.

## Structural candidates (directory names)

These are your existing top-level topics. Most should become tags (or map to the
primary-axis folders). \`df\` = docs under that directory.

| Candidate tag | df | Source dir |
|---------------|---:|------------|
${structRows}

## Topical candidates (from titles & headings)

\`df\` = number of docs whose title/headings contain the term; \`dirs\` = how many
top-level areas it spans (high = a cross-cutting theme, good tag material). Fill
the **Use instead of** column with synonyms you're folding in, then delete rows
you don't want.

| Candidate tag | df | dirs | Use instead of (curate) |
|---------------|---:|-----:|-------------------------|
${topRows}

---

### Curation checklist
1. Merge synonyms → one preferred term (e.g. \`auth\`, \`login\` → \`authentication\`).
2. Drop terms too generic to filter on, and one-off terms you won't reuse.
3. Keep the set small and mutually exclusive; a doc should need only 1–4 tags.
4. Move the finished table into \`${opts.docs}/TAGS.md\` (drop the "df/dirs" columns).
5. Wire a CI check that frontmatter \`tags:\` values all exist in TAGS.md.
`;
}

main();
