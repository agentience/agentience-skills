#!/usr/bin/env -S node --experimental-strip-types
/**
 * aggregate-results.ts — Roll the per-batch deep-dive verdicts
 * (review-batches/results/batch-NNN.result.md) into consolidated, actionable
 * lists that drive the archive/merge/deprecate/reorg campaign (non-destructive).
 *
 * It parses every result file (frontmatter + the Document|Verdict|Target|
 * Confidence|Effort|Evidence table), reconciles them against the planned set in
 * batches.json to compute coverage and find un-run batches / un-appraised docs,
 * cross-checks DELETE candidates against inbound-link counts in the triage CSV,
 * and emits:
 *   - appraisal-summary.md   counts by verdict, coverage %, un-run batches,
 *                            duplicates/invalid rows, and items flagged for a
 *                            second look (low-confidence, DELETE-with-inbound).
 *   - appraisal-actions.csv  one row per appraised doc (verdict, target,
 *                            confidence, effort, inbound, source batch, evidence).
 *   - appraisal-actions.md   grouped action lists — MERGE (clustered by target so
 *                            near-dup sets collapse to one canonical doc),
 *                            DEPRECATE, ARCHIVE, DELETE, UPDATE, KEEP.
 *
 * Idempotent: re-run as waves complete; it overwrites its outputs and only ever
 * writes under --out-dir. Nothing in docs/ is touched.
 *
 * Usage:
 *   node --experimental-strip-types aggregate-results.ts \
 *        [--results-dir audits/review-batches/results] \
 *        [--batches     audits/review-batches/batches.json] \
 *        [--triage      audits/2026-07-02-docs-triage.csv] \
 *        [--out-dir     .doc-librarian]
 *
 * Zero-arg from the repo root: it defaults every path under
 * .doc-librarian/ and auto-detects the newest *-docs-triage.csv.
 */
import * as fs from "node:fs";
import * as path from "node:path";

// Where this skill keeps its working artifacts, relative to the repo root.
// Outside the audited tree on purpose -- see triage-docs.ts for the rationale.
const WORKDIR = ".doc-librarian";
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


const VERDICTS = ["KEEP", "UPDATE", "MERGE", "DEPRECATE", "ARCHIVE", "DELETE"] as const;
type Verdict = (typeof VERDICTS)[number];
const VERDICT_SET = new Set<string>(VERDICTS);

interface Opts {
  root: string;
  docs: string;
  outDir: string;
  resultsDir: string;
  batches: string;
  triage: string | null;
}

function parseArgs(argv: string[]): Opts {
  const get = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(1, 32)
      .map((l) => l.replace(/^\s?\*\/?/, "").replace(/^\//, "")).join("\n"));
    process.exit(0);
  }
  let root = get("--root");
  if (!root) { try { root = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim(); } catch { root = process.cwd(); } }
  root = path.resolve(root);
  const rel = (p: string | undefined, d: string) => (p ? path.resolve(root!, p) : path.resolve(root!, d));
  const outDir = rel(get("--out-dir"), WORKDIR);
  const resultsDir = get("--results-dir")
    ? path.resolve(root, get("--results-dir")!)
    : path.join(outDir, "review-batches", "results");
  const batches = get("--batches")
    ? path.resolve(root, get("--batches")!)
    : path.join(outDir, "review-batches", "batches.json");
  let triage: string | null = get("--triage") ? path.resolve(root, get("--triage")!) : null;
  if (!triage) triage = autodetectTriage(outDir);
  return { root, docs: get("--docs") ?? "docs", outDir, resultsDir, batches, triage };
}

/** Newest *-docs-triage.csv in the audits dir (name-sorted; files are date-prefixed). */
function autodetectTriage(outDir: string): string | null {
  if (!fs.existsSync(outDir)) return null;
  const hits = fs.readdirSync(outDir).filter((f) => f.endsWith("-docs-triage.csv")).sort();
  return hits.length ? path.join(outDir, hits[hits.length - 1]) : null;
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

const csvCell = (v: string | number): string => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvRow = (cells: (string | number)[]): string => cells.map(csvCell).join(",");

// --- normalization helpers ---
/** Docs-relative path: strip backticks, a leading docs/ prefix, and ./ noise. */
function normDoc(p: string): string {
  let s = p.trim().replace(/^`|`$/g, "").trim().replace(/\\/g, "/").replace(/^\.\//, "");
  s = s.replace(/^docs\//, "");
  return s;
}
function normTargetRaw(t: string): string {
  return t.trim().replace(/^`|`$/g, "").trim().replace(/\\/g, "/").replace(/^docs\//, "");
}
const isBlankTarget = (t: string): boolean =>
  !t || /^(—|-+|n\/?a|none|na|null)$/i.test(t.replace(/`/g, "").trim());

function normConfidence(c: string): string {
  const s = c.trim().toLowerCase().replace(/`/g, "");
  if (!s) return "";
  if (s.startsWith("h")) return "high";
  if (s.startsWith("m")) return "med";
  if (s.startsWith("l")) return "low";
  return s;
}
function normEffort(e: string): string {
  const s = e.trim().replace(/`/g, "").toUpperCase();
  if (s.startsWith("S")) return "S";
  if (s.startsWith("M")) return "M";
  if (s.startsWith("L")) return "L";
  return s;
}

interface ParsedRow {
  doc: string;
  verdict: string;      // normalized verdict word (may be invalid)
  verdictRaw: string;
  target: string;       // normalized (may be "")
  confidence: string;
  effort: string;
  evidence: string;
  batchId: number | null;
  sourceFile: string;
}

/** Split a markdown table row "| a | b |" into trimmed cells. */
function splitTableRow(line: string): string[] {
  let s = line.trim();
  s = s.replace(/^\|/, "").replace(/\|$/, "");
  // split on unescaped pipes
  return s.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, "|").trim());
}
const isSeparatorRow = (cells: string[]): boolean =>
  cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c.replace(/\s/g, "")) || c === "");

const CONF_RE = /^(high|hi|med(ium)?|mid|low|lo|h|m|l)$/i;
const looksLikePath = (s: string): boolean => {
  const t = s.replace(/`/g, "").trim();
  return /\//.test(t) || /\.mdx?$/i.test(t);
};
const verdictWord = (s: string): string => {
  const raw = s.replace(/[`*]/g, "").trim();
  const head = raw.split(/\s*(?:→|->|=>|\binto\b|\bto\b)\s*/i)[0];
  return (head.match(/[A-Za-z]+/)?.[0] ?? "").toUpperCase();
};

/**
 * Extract fields from one table row content-first, so it tolerates ragged rows
 * where an agent collapsed "Verdict → target" into a single cell and dropped the
 * separate Target column. Header indices only seed document/verdict location.
 */
function extractRow(cells: string[], cols: Record<string, number>): Omit<ParsedRow, "batchId" | "sourceFile"> {
  // document: prefer the header column if it looks like a path, else first path-like cell
  let docIdx = cols.document ?? -1;
  if (docIdx < 0 || !cells[docIdx] || !looksLikePath(cells[docIdx])) {
    const f = cells.findIndex(looksLikePath);
    docIdx = f >= 0 ? f : (cols.document ?? 0);
  }
  // verdict: first non-doc cell whose leading word is a known verdict; else header col; else next cell
  let vIdx = -1;
  for (let i = 0; i < cells.length; i++) {
    if (i === docIdx) continue;
    if (VERDICT_SET.has(verdictWord(cells[i]))) { vIdx = i; break; }
  }
  if (vIdx < 0) vIdx = cols.verdict !== undefined && cols.verdict !== docIdx ? cols.verdict : docIdx + 1;
  const { verdict, verdictRaw, inlineTarget } = parseVerdictCell(cells[vIdx] ?? "");

  // cells after the verdict, in order (skipping the document cell if it trails)
  const after: string[] = [];
  for (let i = vIdx + 1; i < cells.length; i++) if (i !== docIdx) after.push(cells[i]);

  let target = "";
  let rest = after;
  // If the first post-verdict cell is NOT a confidence token, it's the Target column.
  if (after.length && !CONF_RE.test(after[0].replace(/`/g, "").trim())) {
    if (!isBlankTarget(after[0])) target = normTargetRaw(after[0]);
    rest = after.slice(1);
  }
  if (!target && inlineTarget) target = normTargetRaw(inlineTarget);

  let confidence = "";
  let effort = "";
  if (rest.length) { confidence = normConfidence(rest[0]); rest = rest.slice(1); }
  if (rest.length) { effort = normEffort(rest[0]); rest = rest.slice(1); }
  const evidence = rest.join(" ").replace(/\s+/g, " ").trim();

  return { doc: normDoc(cells[docIdx] ?? ""), verdict, verdictRaw, target, confidence, effort, evidence };
}

interface ParsedFile {
  batchId: number | null;
  appraised: string;
  rows: ParsedRow[];
  file: string;
}

function parseResultFile(file: string): ParsedFile {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split("\n");

  // frontmatter
  let batchId: number | null = null;
  let appraised = "";
  if (lines[0]?.trim() === "---") {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === "---") break;
      const m = lines[i].match(/^([A-Za-z_]+)\s*:\s*(.*)$/);
      if (m) {
        const key = m[1].toLowerCase();
        const val = m[2].trim().replace(/^["']|["']$/g, "");
        if (key === "batch_id") batchId = Number(val) || null;
        else if (key === "appraised") appraised = val;
      }
    }
  }
  // fall back to filename batch-NNN
  if (batchId === null) {
    const fm = path.basename(file).match(/batch-(\d+)/i);
    if (fm) batchId = Number(fm[1]);
  }

  // find the verdict table: header row containing "verdict" (ignoring fenced examples)
  const rows: ParsedRow[] = [];
  let headerIdx = -1;
  const cols: Record<string, number> = {};
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (!line.includes("|")) { if (headerIdx !== -1 && line.trim() === "") continue; if (headerIdx !== -1) break; continue; }
    const cells = splitTableRow(line);
    const lower = cells.map((c) => c.toLowerCase());
    if (headerIdx === -1) {
      if (lower.some((c) => c === "verdict")) {
        headerIdx = i;
        lower.forEach((h, idx) => {
          if (h.includes("document") || h === "doc" || h === "path") cols.document = idx;
          else if (h === "verdict") cols.verdict = idx;
          else if (h === "target") cols.target = idx;
          else if (h.includes("confidence") || h === "conf") cols.confidence = idx;
          else if (h.includes("effort")) cols.effort = idx;
          else if (h.includes("evidence") || h.includes("notes") || h.includes("rationale")) cols.evidence = idx;
        });
      }
      continue;
    }
    if (isSeparatorRow(cells)) continue;
    // skip echoed template/placeholder rows (e.g. "| <path> | KEEP/UPDATE/... |")
    const docCell = cols.document !== undefined ? cells[cols.document] ?? cells[0] : cells[0];
    if (/[<>]/.test(docCell)) continue;
    const f = extractRow(cells, cols);
    if (!f.doc) continue;
    // drop echoed template rows: a verdict *token* listing several verdicts ("KEEP/UPDATE/…").
    // Count only the head (before any "→ target"), so a real target path containing
    // words like "archive" doesn't get mistaken for a placeholder.
    const vHead = f.verdictRaw.split(/\s*(?:→|->|=>|\binto\b|\bto\b)\s*/i)[0];
    if ((vHead.match(/\b(KEEP|UPDATE|MERGE|DEPRECATE|ARCHIVE|DELETE)\b/gi) ?? []).length >= 2) continue;
    rows.push({ ...f, batchId, sourceFile: path.basename(file) });
  }
  return { batchId, appraised, rows, file: path.basename(file) };
}

/** A verdict cell may be "MERGE", "MERGE → target.md", "Merge into `x`", etc. */
function parseVerdictCell(cell: string): { verdict: string; verdictRaw: string; inlineTarget: string } {
  const raw = cell.replace(/[`*]/g, "").trim();
  // split off an inline target after an arrow or "into/to"
  const arrow = raw.split(/\s*(?:→|->|=>)\s*/);
  let head = arrow[0];
  let inlineTarget = arrow.length > 1 ? arrow.slice(1).join(" ").trim() : "";
  const intoM = head.match(/^(\w+)\s+(?:into|to)\s+(.+)$/i);
  if (!inlineTarget && intoM) { head = intoM[1]; inlineTarget = intoM[2].trim(); }
  const word = (head.match(/[A-Za-z]+/)?.[0] ?? "").toUpperCase();
  return { verdict: word, verdictRaw: raw, inlineTarget };
}

interface PlannedBatch { id: number; docs: string[]; }

function main() {
  const opts = parseArgs(process.argv.slice(2));

  // planned set
  if (!fs.existsSync(opts.batches)) {
    console.error(`batches.json not found: ${opts.batches} (run plan-review-batches.ts first)`);
    process.exit(1);
  }
  const plan = JSON.parse(fs.readFileSync(opts.batches, "utf8"));
  const plannedBatches: PlannedBatch[] = (plan.batches ?? []).map((b: any) => ({
    id: b.id, docs: (b.docs ?? []).map((d: string) => normDoc(d)),
  }));
  const plannedDocs = new Set<string>();
  const batchOfDoc = new Map<string, number>();
  for (const b of plannedBatches) for (const d of b.docs) { plannedDocs.add(d); if (!batchOfDoc.has(d)) batchOfDoc.set(d, b.id); }

  // inbound-link counts (for DELETE cross-check)
  const inbound = new Map<string, number>();
  if (opts.triage && fs.existsSync(opts.triage)) {
    for (const r of parseCsv(fs.readFileSync(opts.triage, "utf8"))) {
      inbound.set(normDoc(r.doc_path), Number(r.inbound_links) || 0);
    }
  }

  // parse result files
  const resultFiles = fs.existsSync(opts.resultsDir)
    ? fs.readdirSync(opts.resultsDir).filter((f) => /^batch-\d+.*\.result\.md$/i.test(f) || /^batch-\d+.*\.md$/i.test(f)).filter((f) => f.endsWith(".md")).sort()
    : [];
  const parsedFiles: ParsedFile[] = resultFiles.map((f) => parseResultFile(path.join(opts.resultsDir, f)));

  // reconcile
  const seen = new Map<string, ParsedRow>();      // doc -> first verdict
  const duplicates: { doc: string; rows: ParsedRow[] }[] = [];
  const dupTracker = new Map<string, ParsedRow[]>();
  const invalid: ParsedRow[] = [];
  const unexpected: ParsedRow[] = [];             // appraised but not in planned set
  const allRows: ParsedRow[] = [];

  for (const pf of parsedFiles) {
    for (const row of pf.rows) {
      allRows.push(row);
      if (!VERDICT_SET.has(row.verdict)) invalid.push(row);
      if (!plannedDocs.has(row.doc)) unexpected.push(row);
      const bucket = dupTracker.get(row.doc) ?? [];
      bucket.push(row);
      dupTracker.set(row.doc, bucket);
      if (!seen.has(row.doc)) seen.set(row.doc, row);
    }
  }
  for (const [doc, rowsForDoc] of dupTracker) if (rowsForDoc.length > 1) duplicates.push({ doc, rows: rowsForDoc });

  // coverage
  const appraisedDocs = new Set([...seen.keys()].filter((d) => plannedDocs.has(d)));
  const missingDocs = [...plannedDocs].filter((d) => !appraisedDocs.has(d));
  const batchesWithResult = new Set(parsedFiles.map((p) => p.batchId).filter((x): x is number => x !== null));
  const perBatchStatus = plannedBatches.map((b) => {
    const appraisedInBatch = b.docs.filter((d) => appraisedDocs.has(d)).length;
    return { id: b.id, planned: b.docs.length, appraised: appraisedInBatch, hasFile: batchesWithResult.has(b.id) };
  });
  const unrunBatches = perBatchStatus.filter((s) => s.appraised === 0);
  const partialBatches = perBatchStatus.filter((s) => s.appraised > 0 && s.appraised < s.planned);

  // verdict counts (dedup by doc: use first-seen verdict)
  const counts: Record<string, number> = {};
  for (const v of VERDICTS) counts[v] = 0;
  counts["(invalid)"] = 0;
  const dedupRows = [...seen.values()];
  for (const r of dedupRows) counts[VERDICT_SET.has(r.verdict) ? r.verdict : "(invalid)"]++;

  // flagged-for-second-look
  const deleteWithInbound = dedupRows
    .filter((r) => r.verdict === "DELETE" && (inbound.get(r.doc) ?? 0) > 0)
    .sort((a, b) => (inbound.get(b.doc) ?? 0) - (inbound.get(a.doc) ?? 0));
  const lowConfDestructive = dedupRows.filter(
    (r) => r.confidence === "low" && (r.verdict === "DELETE" || r.verdict === "MERGE" || r.verdict === "DEPRECATE" || r.verdict === "ARCHIVE"),
  );
  // Directory-level disagreement. Verdicts are per-doc, but a self-contained
  // bundle — a dated experiment, a report set with its own README — moves as a
  // unit or not at all: its internal links are relative, so archiving half of it
  // breaks the other half. Two agents appraising adjacent subdirectories can
  // return opposite verdicts and nothing else here would notice.
  const MOVES = new Set(["ARCHIVE", "DELETE"]);
  const STAYS = new Set(["KEEP", "UPDATE"]);
  const dirTally = new Map<string, { moves: number; stays: number }>();
  for (const r of dedupRows) {
    if (!r.doc.includes("/")) continue;
    const segs = r.doc.split("/");
    for (let i = 1; i < segs.length; i++) {       // every ancestor directory
      const dir = segs.slice(0, i).join("/");
      const t = dirTally.get(dir) ?? { moves: 0, stays: 0 };
      if (MOVES.has(r.verdict)) t.moves++;
      else if (STAYS.has(r.verdict)) t.stays++;
      dirTally.set(dir, t);
    }
  }
  const splitDirs = [...dirTally.entries()]
    .filter(([, t]) => t.moves > 0 && t.stays > 0)
    .map(([dir, t]) => ({
      dir, ...t,
      // A README (or index) is the strongest hint the directory is one thing.
      bundle: fs.existsSync(path.join(opts.root, opts.docs, dir, "README.md"))
           || fs.existsSync(path.join(opts.root, opts.docs, dir, "index.md")),
      depth: dir.split("/").length,
    }))
    // Keep the most specific split; an ancestor of an already-listed split adds nothing.
    .sort((a, b) => b.depth - a.depth || a.dir.localeCompare(b.dir))
    .filter((d, _i, arr) => !arr.some((o2) => o2 !== d && o2.dir.startsWith(d.dir + "/")));

  const mergeMissingTarget = dedupRows.filter((r) => r.verdict === "MERGE" && !r.target);
  const deprecateMissingTarget = dedupRows.filter((r) => r.verdict === "DEPRECATE" && !r.target);

  // resolve bare-basename targets to a unique planned doc where possible (better MERGE clustering)
  const byBasename = new Map<string, string[]>();
  for (const d of plannedDocs) { const b = path.posix.basename(d); (byBasename.get(b) ?? byBasename.set(b, []).get(b)!).push(d); }
  const resolveTarget = (t: string): string => {
    if (!t) return t;
    if (t.includes("/")) return t;
    const hits = byBasename.get(t);
    return hits && hits.length === 1 ? hits[0] : t;
  };

  fs.mkdirSync(opts.outDir, { recursive: true });
  const now = new Date().toISOString().slice(0, 10);

  // ---- appraisal-actions.csv ----
  const csvLines = [csvRow(["doc_path", "verdict", "target", "confidence", "effort", "inbound_links", "source_batch", "evidence"])];
  for (const r of dedupRows.sort((a, b) => a.verdict.localeCompare(b.verdict) || a.doc.localeCompare(b.doc))) {
    csvLines.push(csvRow([
      r.doc, r.verdict, resolveTarget(r.target), r.confidence, r.effort,
      inbound.get(r.doc) ?? "", r.batchId ?? "", r.evidence,
    ]));
  }
  fs.writeFileSync(path.join(opts.outDir, "appraisal-actions.csv"), csvLines.join("\n") + "\n");

  // ---- appraisal-actions.md (grouped action lists) ----
  fs.writeFileSync(path.join(opts.outDir, "appraisal-actions.md"),
    renderActions(now, dedupRows, resolveTarget, inbound));

  // ---- appraisal-summary.md ----
  fs.writeFileSync(path.join(opts.outDir, "appraisal-summary.md"), renderSummary({
    now, plan, plannedDocs, appraisedDocs, missingDocs, counts, dedupRows,
    perBatchStatus, unrunBatches, partialBatches, duplicates, invalid, unexpected,
    deleteWithInbound, lowConfDestructive, splitDirs, mergeMissingTarget, deprecateMissingTarget,
    inbound, triage: opts.triage, batchOfDoc, resolveTarget,
  }));

  // ---- console ----
  const cov = plannedDocs.size ? Math.round((appraisedDocs.size / plannedDocs.size) * 100) : 0;
  console.log(`Parsed ${parsedFiles.length} result file(s), ${allRows.length} verdict rows.`);
  console.log(`Coverage: ${appraisedDocs.size}/${plannedDocs.size} planned docs appraised (${cov}%); ` +
    `${perBatchStatus.length - unrunBatches.length}/${perBatchStatus.length} batches started.`);
  console.log(`Verdicts: ${VERDICTS.map((v) => `${v} ${counts[v]}`).join(" · ")}` +
    (counts["(invalid)"] ? ` · invalid ${counts["(invalid)"]}` : ""));
  if (deleteWithInbound.length) console.log(`⚠ ${deleteWithInbound.length} DELETE candidate(s) still have inbound links — review before removal.`);
  if (duplicates.length) console.log(`⚠ ${duplicates.length} doc(s) appraised more than once.`);
  console.log(`Wrote appraisal-summary.md, appraisal-actions.md, appraisal-actions.csv to ${opts.outDir}`);
}

function verdictSection(title: string, note: string, rows: ParsedRow[], resolveTarget: (t: string) => string, withTarget: boolean, inbound: Map<string, number>): string {
  if (!rows.length) return `### ${title} (0)\n\n_None._\n`;
  const sorted = [...rows].sort((a, b) => a.doc.localeCompare(b.doc));
  const lines = sorted.map((r) => {
    const tgt = withTarget && r.target ? ` → \`${resolveTarget(r.target)}\`` : withTarget ? ` → **(target missing — assign)**` : "";
    const conf = r.confidence ? ` _(${r.confidence}${r.effort ? `/${r.effort}` : ""})_` : "";
    const inb = r.verdict === "DELETE" && (inbound.get(r.doc) ?? 0) > 0 ? `  ⚠ ${inbound.get(r.doc)} inbound` : "";
    const ev = r.evidence ? ` — ${r.evidence}` : "";
    return `- \`${r.doc}\`${tgt}${conf}${inb}${ev}`;
  });
  return `### ${title} (${rows.length})\n\n${note ? note + "\n\n" : ""}${lines.join("\n")}\n`;
}

function renderActions(now: string, dedupRows: ParsedRow[], resolveTarget: (t: string) => string, inbound: Map<string, number>): string {
  const by = (v: Verdict) => dedupRows.filter((r) => r.verdict === v);

  // MERGE clustered by (resolved) target so near-dup sets collapse to one canonical doc
  const merges = by("MERGE");
  const clusters = new Map<string, ParsedRow[]>();
  for (const r of merges) {
    const key = r.target ? resolveTarget(r.target) : "(no target)";
    (clusters.get(key) ?? clusters.set(key, []).get(key)!).push(r);
  }
  const mergeBlock = clusters.size
    ? [...clusters.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
        .map(([target, rows]) => {
          const head = target === "(no target)" ? `**⚠ MERGE with no target** — resolve manually:` : `Canonical: \`${target}\``;
          const src = rows.sort((a, b) => a.doc.localeCompare(b.doc))
            .map((r) => `  - fold in \`${r.doc}\`${r.confidence ? ` _(${r.confidence}${r.effort ? `/${r.effort}` : ""})_` : ""}${r.evidence ? ` — ${r.evidence}` : ""}`).join("\n");
          return `- ${head}\n${src}`;
        }).join("\n")
    : "_None._";

  return `---
title: "Appraisal action lists"
doc_type: reference
status: active
owner: "${docOwner()}"
updated: ${now}
tags: [standards]
---

# Appraisal Action Lists

**Last Updated: ${now}**

Generated by \`aggregate-results.ts\` from the deep-dive verdicts. Execute in the
safe order: collapse **MERGE** clusters → **DEPRECATE** (banner + target) →
**ARCHIVE** (\`git mv\` to \`docs/archive/\`) → **DELETE** (only after confirming no
inbound links) → **UPDATE** (content fixes). \`git mv\` always — never delete-and-recreate.

## MERGE — collapse duplicates into one canonical doc (${merges.length})

${mergeBlock}

## DEPRECATE — keep with a banner pointing to the replacement

${verdictSection("DEPRECATE", "", by("DEPRECATE"), resolveTarget, true, inbound).replace(/^### .*\n\n/, "")}
## ARCHIVE — move to \`docs/archive/\` (historical only)

${verdictSection("ARCHIVE", "", by("ARCHIVE"), resolveTarget, false, inbound).replace(/^### .*\n\n/, "")}
## DELETE — remove (git retains history); ⚠ items still have inbound links

${verdictSection("DELETE", "", by("DELETE"), resolveTarget, false, inbound).replace(/^### .*\n\n/, "")}
## UPDATE — still relevant, needs content fixes

${verdictSection("UPDATE", "", by("UPDATE"), resolveTarget, false, inbound).replace(/^### .*\n\n/, "")}
## KEEP — current & correct, no action (${by("KEEP").length})

_Listed in \`appraisal-actions.csv\`._
`;
}

interface SummaryCtx {
  now: string; plan: any; plannedDocs: Set<string>; appraisedDocs: Set<string>;
  missingDocs: string[]; counts: Record<string, number>; dedupRows: ParsedRow[];
  perBatchStatus: { id: number; planned: number; appraised: number; hasFile: boolean }[];
  unrunBatches: { id: number }[]; partialBatches: { id: number; planned: number; appraised: number }[];
  duplicates: { doc: string; rows: ParsedRow[] }[]; invalid: ParsedRow[]; unexpected: ParsedRow[];
  deleteWithInbound: ParsedRow[]; lowConfDestructive: ParsedRow[];
  splitDirs: { dir: string; moves: number; stays: number; bundle: boolean; depth: number }[];
  mergeMissingTarget: ParsedRow[]; deprecateMissingTarget: ParsedRow[];
  inbound: Map<string, number>; triage: string | null; batchOfDoc: Map<string, number>;
  resolveTarget: (t: string) => string;
}

function renderSummary(c: SummaryCtx): string {
  const totalPlanned = c.plannedDocs.size;
  const cov = totalPlanned ? Math.round((c.appraisedDocs.size / totalPlanned) * 100) : 0;
  const nBatches = c.perBatchStatus.length;
  const started = nBatches - c.unrunBatches.length;

  const verdictTable = [...VERDICTS, "(invalid)"]
    .filter((v) => c.counts[v] > 0 || v !== "(invalid)")
    .map((v) => `| ${v} | ${c.counts[v]} |`).join("\n");

  const ranges = (ids: number[]): string => {
    if (!ids.length) return "—";
    const s = [...ids].sort((a, b) => a - b);
    const out: string[] = []; let a = s[0], p = s[0];
    for (let i = 1; i <= s.length; i++) {
      if (i < s.length && s[i] === p + 1) { p = s[i]; continue; }
      out.push(a === p ? `${a}` : `${a}–${p}`);
      if (i < s.length) { a = s[i]; p = s[i]; }
    }
    return out.join(", ");
  };

  const secondLook: string[] = [];
  if (c.deleteWithInbound.length) {
    secondLook.push(`**⚠ ${c.deleteWithInbound.length} DELETE candidate(s) still referenced** (inbound links > 0) — do NOT delete; deprecate/archive or fix the referrers first:`);
    secondLook.push(c.deleteWithInbound.slice(0, 30).map((r) => `  - \`${r.doc}\` — ${c.inbound.get(r.doc)} inbound (batch ${r.batchId ?? "?"})`).join("\n"));
  }
  if (c.splitDirs.length) {
    const bundles = c.splitDirs.filter((d) => d.bundle);
    secondLook.push(`**${c.splitDirs.length} director${c.splitDirs.length === 1 ? "y" : "ies"} whose documents disagree** — some children move (ARCHIVE/DELETE) while others stay (KEEP/UPDATE). A directory with its own README, or with relative cross-references, has to move as ONE unit or not at all; splitting it breaks the links inside it. Adjudicate the directory, then re-run:${bundles.length ? `\n\n  ⚠ ${bundles.length} of these have their own README/index — treat as an indivisible bundle.` : ""}`);
    secondLook.push(c.splitDirs.slice(0, 20).map((d) =>
      `  - \`${d.dir}/\`${d.bundle ? " **(has README — bundle)**" : ""} — ${d.moves} move, ${d.stays} stay`).join("\n"));
  }
  if (c.lowConfDestructive.length) {
    secondLook.push(`**${c.lowConfDestructive.length} low-confidence destructive verdict(s)** (DELETE/MERGE/DEPRECATE/ARCHIVE at low confidence) — re-check before executing:`);
    secondLook.push(c.lowConfDestructive.slice(0, 30).map((r) => `  - \`${r.doc}\` → ${r.verdict}${r.target ? ` (\`${c.resolveTarget(r.target)}\`)` : ""} (batch ${r.batchId ?? "?"})`).join("\n"));
  }
  if (c.mergeMissingTarget.length)
    secondLook.push(`**${c.mergeMissingTarget.length} MERGE verdict(s) with no target** — assign a canonical doc:\n` +
      c.mergeMissingTarget.slice(0, 30).map((r) => `  - \`${r.doc}\` (batch ${r.batchId ?? "?"})`).join("\n"));
  if (c.deprecateMissingTarget.length)
    secondLook.push(`**${c.deprecateMissingTarget.length} DEPRECATE verdict(s) with no replacement target** — name the superseding doc:\n` +
      c.deprecateMissingTarget.slice(0, 30).map((r) => `  - \`${r.doc}\` (batch ${r.batchId ?? "?"})`).join("\n"));
  if (c.invalid.length)
    secondLook.push(`**${c.invalid.length} row(s) with an unrecognized verdict** — fix the result file:\n` +
      c.invalid.slice(0, 30).map((r) => `  - \`${r.doc}\` → "${r.verdictRaw}" (${r.sourceFile})`).join("\n"));
  if (c.duplicates.length)
    secondLook.push(`**${c.duplicates.length} doc(s) appraised more than once** (first-seen verdict used in counts):\n` +
      c.duplicates.slice(0, 30).map((d) => `  - \`${d.doc}\`: ${d.rows.map((r) => `${r.verdict}@${r.sourceFile}`).join(", ")}`).join("\n"));
  if (c.unexpected.length)
    secondLook.push(`**${c.unexpected.length} appraised doc(s) not in the planned set** (path typo or out-of-scope):\n` +
      c.unexpected.slice(0, 30).map((r) => `  - \`${r.doc}\` (${r.sourceFile})`).join("\n"));

  const missingByBatch = new Map<number, string[]>();
  for (const d of c.missingDocs) { const b = c.batchOfDoc.get(d) ?? -1; (missingByBatch.get(b) ?? missingByBatch.set(b, []).get(b)!).push(d); }

  const totalEffort = { S: 0, M: 0, L: 0 } as Record<string, number>;
  for (const r of c.dedupRows) if (r.verdict !== "KEEP" && (r.effort === "S" || r.effort === "M" || r.effort === "L")) totalEffort[r.effort]++;

  return `---
title: "Appraisal summary"
doc_type: reference
status: active
owner: "${docOwner()}"
updated: ${c.now}
tags: [standards]
---

# Deep-dive Appraisal Summary

**Last Updated: ${c.now}**

Roll-up of \`review-batches/results/*.result.md\` by \`aggregate-results.ts\`. Re-run
as waves complete. Action lists: \`appraisal-actions.md\` · per-doc data: \`appraisal-actions.csv\`.

## Coverage

- **${c.appraisedDocs.size} / ${totalPlanned}** planned docs appraised (**${cov}%**).
- **${started} / ${nBatches}** batches started; **${c.perBatchStatus.filter((s) => s.appraised >= s.planned && s.planned > 0).length}** complete.
- Triage cross-reference: ${c.triage ? `\`${path.basename(c.triage)}\`` : "_none provided — DELETE inbound cross-check skipped_"}.

## Verdicts (deduped by doc, first-seen)

| Verdict | Count |
|---------|------:|
${verdictTable}

Estimated remaining effort (non-KEEP): **${totalEffort.S} S · ${totalEffort.M} M · ${totalEffort.L} L**.

## Batch status

- **Un-run** (0 appraised): ${c.unrunBatches.length ? `${c.unrunBatches.length} — batches ${ranges(c.unrunBatches.map((b) => b.id))}` : "none 🎉"}
- **Partial** (some docs missing): ${c.partialBatches.length ? `${c.partialBatches.length} — batches ${ranges(c.partialBatches.map((b) => b.id))}` : "none"}
${c.missingDocs.length ? `- **${c.missingDocs.length} planned doc(s) not yet appraised.**` : "- All planned docs appraised. ✅"}

## Flagged for a second look

${secondLook.length ? secondLook.join("\n\n") : "_Nothing flagged._"}

## Next actions

1. Run remaining waves for un-run/partial batches (see \`review-batches/INDEX.md\`).
2. Resolve everything under **Flagged for a second look** above.
3. Execute \`appraisal-actions.md\` in order: MERGE → DEPRECATE → ARCHIVE → DELETE → UPDATE.
   Use \`git mv\` for every move; confirm inbound = 0 before any DELETE.
`;
}

main();
