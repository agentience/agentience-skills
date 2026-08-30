#!/usr/bin/env tsx
/**
 * triage-docs.ts — Documentation relevance triage (non-destructive).
 *
 * Scores every authored Markdown doc under a docs/ directory on objective
 * signals and buckets it into KEEP / REVIEW / WEED so you can weed the stale
 * and obsolete material BEFORE reorganizing. Reads only; never modifies docs.
 *
 * Signals per doc:
 *   - git recency     : months since the file's most recent commit
 *   - inbound links   : how many other docs link to it (0 = orphaned)
 *   - code anchors    : links / inline code paths pointing at repo source files,
 *                       and what fraction of them still resolve (dead anchors =
 *                       the doc likely describes code that no longer exists)
 *   - work status     : lives under an "iterative/likely-completed" area
 *                       (archive, planning, implementation, migration, fixes)
 *   - duplicate group : shares a normalized title with other docs
 *
 * Buckets (rules are transparent and printed with each row as "reasons"):
 *   WEED   = (very stale AND orphaned) OR (stale AND orphaned AND corroborated
 *              by dead anchors / completed-work area / duplicate title)
 *   KEEP   = recent AND (linked OR anchors mostly valid)  [indexes kept too]
 *   REVIEW = everything else — the only bucket that needs human judgement
 *
 * Usage:
 *   npx tsx "${CLAUDE_SKILL_DIR}/scripts/triage-docs.ts" [options]
 *
 * Options:
 *   --root <path>       Repo root (default: `git rev-parse --show-toplevel`)
 *   --docs <rel>        Docs dir relative to root (default: docs)
 *   --format <fmt>      md | markdown (default) | csv | spreadsheet | xlsx
 *                       (csv/spreadsheet/xlsx all emit CSV — universal, opens
 *                        in Excel / Google Sheets / Numbers)
 *   --out <path>        Output file (default: <root>/.doc-librarian/triage-report.<ext>).
 *                       Reports default OUT of the audited tree on purpose: a
 *                       report written into docs/ becomes an input to the next
 *                       scan of docs/.
 *   --include-generated Include generated dirs (api/) — excluded by default
 *   --help
 *
 * Exit code is always 0 on success; this is a report, not a gate.
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
// Working directory for everything this skill emits, relative to the repo root.
// Deliberately OUTSIDE the tree being audited: a report or a draft written into
// docs/ becomes a document, and the next scan then appraises the skill's own
// output alongside the corpus. `setup.sh` adds this to .gitignore.
const WORKDIR = ".doc-librarian";


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


// ----------------------------- CLI parsing --------------------------------

interface Opts {
  root: string;
  docs: string;
  format: "md" | "csv";
  out: string | null;
  includeGenerated: boolean;
  recentMonths: number;
  staleMonths: number;
  veryStaleMonths: number;
  nlp: string | null;
}

/** Optional enrichment produced by analyze-docs.py (scikit-learn). */
interface NlpData {
  near_duplicates?: {
    threshold?: number;
    clusters?: { id: number; size: number; mean_sim: number; docs: string[] }[];
    by_doc?: Record<string, { cluster: number | null; nn: string | null; sim: number }>;
  };
}

function loadNlp(opts: Opts, docsAbs: string): NlpData | null {
  const candidates = [
    opts.nlp,
    opts.out ? path.join(path.dirname(opts.out), "nlp-analysis.json") : null,
    path.join(opts.root, WORKDIR, "nlp-analysis.json"),
    path.join(docsAbs, "nlp-analysis.json"),
    path.join(process.cwd(), "nlp-analysis.json"),
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return JSON.parse(fs.readFileSync(c, "utf8")) as NlpData;
    } catch { /* ignore malformed */ }
  }
  return null;
}

function parseArgs(argv: string[]): Opts {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelpAndExit();
  }
  let root = get("--root");
  if (!root) {
    try {
      root = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
    } catch {
      root = process.cwd();
    }
  }
  const fmtRaw = (get("--format") ?? "md").toLowerCase();
  const format: "md" | "csv" =
    fmtRaw === "csv" || fmtRaw === "spreadsheet" || fmtRaw === "xlsx" || fmtRaw === "xls"
      ? "csv"
      : "md";
  const num = (flag: string, def: number): number => {
    const v = get(flag);
    const n = v ? Number(v) : NaN;
    return Number.isFinite(n) ? n : def;
  };
  return {
    root: path.resolve(root),
    docs: get("--docs") ?? "docs",
    format,
    out: get("--out") ?? null,
    includeGenerated: argv.includes("--include-generated"),
    // Defaults tuned for a fast-moving repo. Raise for slower-cadence projects.
    recentMonths: num("--recent-months", 4),
    staleMonths: num("--stale-months", 6),
    veryStaleMonths: num("--very-stale-months", 9),
    nlp: get("--nlp") ?? null,
  };
}

function printHelpAndExit(): never {
  const header = fs.readFileSync(__filename, "utf8").split("\n").slice(1, 45)
    .filter((l) => l.startsWith(" *") || l.startsWith("/**"))
    .map((l) => l.replace(/^\s?\*\/?/, "").replace(/^\//, ""))
    .join("\n");
  console.log(header);
  process.exit(0);
}

// ----------------------------- helpers ------------------------------------

const NOW = new Date();
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|graphql|gql|css|scss|sass|html|sh|py|yml|yaml|sql|prisma)$/i;
const GENERATED_SEGMENTS = new Set(["api"]);
const COMPLETED_WORK_SEGMENTS = new Set([
  "archive", "planning", "implementation", "migration", "fixes",
]);

function monthsBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
}

function walkMarkdown(dir: string, root: string, includeGenerated: boolean): string[] {
  const out: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".git" || e.name === ".agentics") continue;
        const relSeg = path.relative(path.join(root, "docs"), full).split(path.sep)[0];
        if (!includeGenerated && GENERATED_SEGMENTS.has(e.name) &&
            path.dirname(full) === dir) {
          continue; // skip top-level generated dir (e.g. docs/api)
        }
        void relSeg;
        stack.push(full);
      } else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
        out.push(full);
      }
    }
  }
  return out.sort();
}

/** repo-root-relative, forward-slash path */
function relPosix(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join("/");
}

/** Most-recent commit date per docs file, from a single `git log` pass. */
function gitLastCommitMap(root: string, docsRel: string): Map<string, Date> {
  const map = new Map<string, Date>();
  let raw = "";
  try {
    raw = execSync(
      `git log --pretty=format:'C%ad' --date=format:'%Y-%m-%d' --name-only -- ${JSON.stringify(docsRel)}`,
      { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 * 256 }
    );
  } catch {
    return map;
  }
  let curDate: Date | null = null;
  for (const line of raw.split("\n")) {
    if (line.startsWith("C")) {
      const d = line.slice(1).trim();
      curDate = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + "T00:00:00Z") : null;
    } else if (line.trim() && curDate) {
      const f = line.trim();
      if (!map.has(f)) map.set(f, curDate); // first = most recent (git log is reverse-chron)
    }
  }
  return map;
}

/**
 * Inbound references from OUTSIDE the docs tree — source code, tests, skills,
 * scripts, handoffs. Counting only doc->doc links makes a doc that live code
 * cites by path look orphaned, and orphanhood gates the WEED bucket. Measured on
 * a real corpus: a report cited from a service, its test, and four handoffs was
 * reported as having zero inbound links.
 *
 * One `git grep -F -f` pass over everything outside `docs/`. A doc is matched by
 * its repo-relative path, its docs-relative path, and — only when the basename
 * is distinctive and unique in the corpus — its bare basename, since prose
 * routinely cites a report by filename alone.
 */
function textualRefs(root: string, docRels: string[], docsDir: string): Map<string, { inside: number; outside: number }> {
  const out = new Map<string, { inside: number; outside: number }>();
  for (const r of docRels) out.set(r, { inside: 0, outside: 0 });
  if (docRels.length === 0) return out;

  const GENERIC = new Set(["README.md", "index.md", "CHANGELOG.md", "TAGS.md", "LICENSE.md"]);
  const baseCount = new Map<string, number>();
  for (const r of docRels) {
    const b = r.slice(r.lastIndexOf("/") + 1);
    baseCount.set(b, (baseCount.get(b) ?? 0) + 1);
  }

  // Path patterns match as plain substrings (they carry a directory, so they are
  // already unambiguous). A BARE BASENAME must not: `observability.md` is a
  // substring of `agent-a-observability.md`, and counting that as a reference
  // silently rescues a dead doc from the WEED bucket. Basenames therefore need a
  // left boundary — start of line, or a character that cannot be part of a
  // filename.
  // A citation is routinely written RELATIVE to the referring file
  // (`../artifacts/plans/R_kimi.md`), so neither the full path nor the bare
  // basename appears verbatim. A trailing two-segment suffix does — and, guarded
  // by corpus uniqueness, cannot collide with a same-named doc elsewhere.
  const suffixCount = new Map<string, number>();
  const tail2 = (r: string) => { const p2 = r.split("/"); return p2.length >= 2 ? p2.slice(-2).join("/") : null; };
  for (const r of docRels) {
    const t = tail2(r);
    if (t) suffixCount.set(t, (suffixCount.get(t) ?? 0) + 1);
  }

  const patterns = new Map<string, { paths: string[]; bases: string[] }>();
  const all = new Set<string>();
  for (const r of docRels) {
    const paths = [r];
    if (r.startsWith(docsDir + "/")) paths.push(r.slice(docsDir.length + 1));
    const t = tail2(r);
    if (t && (suffixCount.get(t) ?? 0) === 1) paths.push(t);
    const bases: string[] = [];
    const b = r.slice(r.lastIndexOf("/") + 1);
    if (!GENERIC.has(b) && (baseCount.get(b) ?? 0) === 1 && b.length > 6) bases.push(b);
    patterns.set(r, { paths, bases });
    for (const pt of [...paths, ...bases]) all.add(pt);
  }
  const NAME_CHAR = /[A-Za-z0-9_.\-]/;
  const hasBoundedBase = (line: string, base: string): boolean => {
    let i = line.indexOf(base);
    while (i !== -1) {
      if (i === 0 || !NAME_CHAR.test(line[i - 1])) return true;
      i = line.indexOf(base, i + 1);
    }
    return false;
  };

  const tmp = path.join(os.tmpdir(), `doclib-inbound-${process.pid}.txt`);
  // Whole repo, docs INCLUDED: a doc is routinely cited by a plain path inside a
  // shell or JSON block, which is not markdown-link syntax and so never reaches
  // the link graph. Keep the referring file so self-references can be dropped
  // and in-tree citations told apart from code ones.
  let rows: { file: string; text: string }[] = [];
  try {
    fs.writeFileSync(tmp, [...all].join("\n") + "\n");
    const raw = execSync(
      `git grep -F -n -f ${JSON.stringify(tmp)}`,
      { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 * 256, stdio: ["ignore", "pipe", "ignore"] },
    );
    for (const ln of raw.split("\n")) {
      if (!ln) continue;
      const i = ln.indexOf(":");
      if (i < 0) continue;
      rows.push({ file: ln.slice(0, i), text: ln.slice(i + 1) });
    }
  } catch {
    // git grep exits 1 when nothing matches; anything else -> degrade to zeros.
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* best effort */ }
  }

  const inDocs = (f: string) => f === docsDir || f.startsWith(docsDir + "/");
  for (const r of docRels) {
    const pat = patterns.get(r);
    if (!pat) continue;
    // Distinct referring FILES, not matching lines. One spec mentioning a doc
    // forty times is one thing depending on it, not forty.
    const insideF = new Set<string>(), outsideF = new Set<string>();
    for (const row of rows) {
      if (row.file === r) continue;  // a doc citing itself is not a reference
      if (!(pat.paths.some((pt) => row.text.includes(pt)) || pat.bases.some((b) => hasBoundedBase(row.text, b)))) continue;
      (inDocs(row.file) ? insideF : outsideF).add(row.file);
    }
    out.set(r, { inside: insideF.size, outside: outsideF.size });
  }
  return out;
}

function gitTrackedFiles(root: string): Set<string> {
  try {
    const raw = execSync("git ls-files", { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 * 256 });
    return new Set(raw.split("\n").map((s) => s.trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

interface LinkTarget { raw: string; resolved: string | null; }

/**
 * Resolve a link/target (relative, root-anchored, or absolute) to a repo-rel path.
 *
 * `root` matters for absolute targets. Engineering notes routinely paste absolute
 * paths straight out of a terminal, and the naive reading — strip the leading
 * slash and treat the rest as repo-relative — turns every one of them into a
 * bogus miss. Measured on a real corpus that alone scored a doc at 0% valid
 * anchors while every file it cited existed. Two distinct cases:
 *   - absolute and inside this repo  -> rewrite to repo-relative (a real anchor)
 *   - absolute and somewhere else    -> not a claim about this repo at all, so
 *                                       return null rather than scoring it dead
 * Anything else keeps the old root-anchored / doc-relative behaviour.
 */
function resolveTarget(fromRel: string, target: string, root?: string): string | null {
  let t = target.trim();
  if (!t) return null;
  if (/^(https?:|mailto:|tel:|#|data:)/i.test(t)) return null;
  t = t.split("#")[0].split("?")[0];
  if (!t) return null;
  try { t = decodeURIComponent(t); } catch { /* keep raw */ }
  if (!t || t.startsWith("<")) return null;
  const fromDir = path.posix.dirname(fromRel);
  let resolved: string;
  if (t.startsWith("/") || /^[A-Za-z]:[\\/]/.test(t)) {
    const tp = t.split("\\").join("/");
    if (root) {
      const rootPosix = root.split(path.sep).join("/").replace(/\/+$/, "");
      if (tp === rootPosix) return null;
      if (tp.startsWith(rootPosix + "/")) return tp.slice(rootPosix.length + 1);
    }
    // A filesystem-shaped absolute path that is not under this repo: another
    // machine, another checkout, an illustrative example. Out of scope.
    if (/^\/(Users|home|var|tmp|private|opt|mnt|srv|root)\//.test(tp) || /^[A-Za-z]:\//.test(tp)) return null;
    resolved = tp.replace(/^\/+/, "");
  } else {
    resolved = path.posix.normalize(path.posix.join(fromDir, t));
  }
  if (resolved.startsWith("..")) return null;
  return resolved;
}

function fileExists(root: string, rel: string, tracked: Set<string>): string | null {
  const candidates = [rel];
  if (!path.posix.extname(rel)) {
    candidates.push(rel + ".md", path.posix.join(rel, "README.md"), path.posix.join(rel, "index.md"));
  }
  for (const c of candidates) {
    if (tracked.has(c)) return c;
    if (fs.existsSync(path.join(root, c))) return c;
  }
  return null;
}

/**
 * Last-resort resolution for an ABBREVIATED path — prose habitually shortens
 * `packages/planning/src/services/Foo.ts` to `services/Foo.ts`. Counts only when
 * exactly one tracked file ends with the fragment, so an ambiguous shortening
 * stays unresolved instead of being guessed at.
 */
function uniqueSuffixMatch(rel: string, tracked: Set<string>): string | null {
  if (!rel.includes("/")) return null;
  const needle = "/" + rel;
  let hit: string | null = null;
  for (const f of tracked) {
    if (!f.endsWith(needle)) continue;
    if (hit) return null;  // ambiguous
    hit = f;
  }
  return hit;
}

// ----------------------------- analysis -----------------------------------

interface DocRow {
  rel: string;            // repo-rel
  docRel: string;         // relative to docs/
  topSeg: string;
  isIndex: boolean;
  lastCommit: string;     // YYYY-MM-DD or "untracked"
  ageMonths: number;
  inbound: number;
  inboundExternal: number;
  internalLinks: number;  // outbound doc links
  anchorsClassified: number;
  anchorsValid: number;
  anchorValidPct: number | null;
  codeRefs: string[];     // resolved repo source paths this doc references
  completedWork: boolean;
  dupGroup: string | null;
  dupSize: number;
  simTo: string | null;   // nearest neighbor (basename), from NLP
  simPct: number | null;  // cosine similarity %, from NLP
  score: number;
  bucket: "KEEP" | "REVIEW" | "WEED";
  reasons: string[];
}

function normalizeTitle(docRel: string, content: string): string {
  const h1 = content.match(/^#\s+(.+)$/m)?.[1] ?? path.posix.basename(docRel, ".md");
  return h1
    .toLowerCase()
    .replace(/^adr[-\s]?\d+[:\s]*/i, "")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|a|an|for|to|of|and|with|guide|plan|notes?|doc(ument)?)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const docsAbs = path.join(opts.root, opts.docs);
  if (!fs.existsSync(docsAbs)) {
    console.error(`docs directory not found: ${docsAbs}`);
    process.exit(1);
  }

  const files = walkMarkdown(docsAbs, opts.root, opts.includeGenerated);
  const lastCommit = gitLastCommitMap(opts.root, opts.docs);
  const tracked = gitTrackedFiles(opts.root);

  // Pass 1: read content, resolve internal links to build the inbound graph.
  const contents = new Map<string, string>();
  const docSet = new Set(files.map((f) => relPosix(opts.root, f)));
  const inbound = new Map<string, number>();
  for (const r of docSet) inbound.set(r, 0);

  const linkRe = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  const outboundDoc = new Map<string, number>();

  for (const abs of files) {
    const rel = relPosix(opts.root, abs);
    const text = fs.readFileSync(abs, "utf8");
    contents.set(rel, text);
    let m: RegExpExecArray | null;
    let od = 0;
    while ((m = linkRe.exec(text))) {
      const resolved = resolveTarget(rel, m[1], opts.root);
      if (!resolved) continue;
      // treat as internal doc link if it lands on a known doc
      const hit = fileExists(opts.root, resolved, tracked);
      if (hit && docSet.has(hit) && hit !== rel) {
        inbound.set(hit, (inbound.get(hit) ?? 0) + 1);
        od++;
      }
    }
    outboundDoc.set(rel, od);
  }

  const refCounts = textualRefs(opts.root, [...docSet], opts.docs);

  // Pass 2: code anchors + scoring.
  const inlineCodeRe = /`([^`\n]+)`/g;
  const rows: DocRow[] = [];
  const titleGroups = new Map<string, string[]>();

  for (const abs of files) {
    const rel = relPosix(opts.root, abs);
    const docRel = rel.slice(opts.docs.length + 1);
    const text = contents.get(rel)!;
    const topSeg = docRel.split("/")[0];
    const base = path.posix.basename(docRel).toLowerCase();
    const isIndex = base === "readme.md" || base === "index.md";

    // git recency
    const lc = lastCommit.get(rel);
    const lastStr = lc ? lc.toISOString().slice(0, 10) : "untracked";
    const ageMonths = lc ? monthsBetween(lc, NOW) : 0;

    // code anchors: markdown links + inline-code paths that point at repo source
    let anchorsClassified = 0;
    let anchorsValid = 0;
    const seenAnchors = new Set<string>();
    const codeRefs = new Set<string>();

    const classifyAnchor = (targetRaw: string) => {
      const resolved = resolveTarget(rel, targetRaw, opts.root);
      if (!resolved) return;
      if (docSet.has(resolved)) return;            // internal doc link, handled elsewhere
      const looksCode = CODE_EXT.test(resolved) || resolved.includes("/src/") ||
        resolved.startsWith("packages/") || resolved.startsWith("apps/");
      if (!looksCode) return;
      if (seenAnchors.has(resolved)) return;
      seenAnchors.add(resolved);
      anchorsClassified++;
      // Try the resolved path first, then the raw fragment as a unique suffix.
      // The raw form is what matters for an abbreviated citation: prose writes
      // `services/Foo.ts`, which resolves doc-relative to a path that has never
      // existed, while the file it plainly means is one unambiguous suffix match
      // away. Resolving only the doc-relative form scores such docs 0% valid.
      const hit = fileExists(opts.root, resolved, tracked)
        ?? uniqueSuffixMatch(resolved, tracked)
        ?? uniqueSuffixMatch(targetRaw.trim().split("#")[0], tracked);
      if (hit) { anchorsValid++; codeRefs.add(hit); }
    };

    let m: RegExpExecArray | null;
    linkRe.lastIndex = 0;
    while ((m = linkRe.exec(text))) classifyAnchor(m[1]);
    inlineCodeRe.lastIndex = 0;
    while ((m = inlineCodeRe.exec(text))) {
      const c = m[1].trim();
      if (c.includes("/") && CODE_EXT.test(c) && !c.includes(" ")) classifyAnchor(c);
    }
    const anchorValidPct = anchorsClassified > 0
      ? Math.round((anchorsValid / anchorsClassified) * 100)
      : null;

    // Two independent views of "is anything pointing at this?":
    //   inbLinks — resolver-based markdown link graph (handles RELATIVE links,
    //              which a textual grep cannot, and means "reachable by browsing")
    //   refs     — textual citations anywhere (handles plain paths in shell/JSON
    //              blocks and bare basenames, which the link graph cannot)
    // Take the max rather than the sum: a full-path markdown link shows up in
    // both, and inflating it would be as wrong as missing it.
    const inbLinks = inbound.get(rel) ?? 0;
    const refs = refCounts.get(rel) ?? { inside: 0, outside: 0 };
    const inbExt = refs.outside;
    const inb = Math.max(inbLinks, refs.inside + refs.outside);
    const completedWork = COMPLETED_WORK_SEGMENTS.has(topSeg);

    // dedup grouping
    const key = normalizeTitle(docRel, text);
    if (key.length >= 4) {
      const arr = titleGroups.get(key) ?? [];
      arr.push(rel);
      titleGroups.set(key, arr);
    }

    rows.push({
      rel, docRel, topSeg, isIndex,
      lastCommit: lastStr, ageMonths, inbound: inb, inboundExternal: inbExt,
      internalLinks: outboundDoc.get(rel) ?? 0,
      anchorsClassified, anchorsValid, anchorValidPct,
      codeRefs: [...codeRefs].slice(0, 25),
      completedWork, dupGroup: key.length >= 4 ? key : null, dupSize: 1,
      simTo: null, simPct: null,
      score: 0, bucket: "REVIEW", reasons: [],
    });
  }

  // finalize dup sizes from title heuristic (fallback)
  for (const row of rows) {
    if (row.dupGroup) row.dupSize = (titleGroups.get(row.dupGroup) ?? []).length;
  }

  // Prefer NLP cosine near-duplicates when available (analyze-docs.py output).
  const nlp = loadNlp(opts, docsAbs);
  if (nlp?.near_duplicates?.by_doc) {
    const sizeOf = new Map<number, number>();
    for (const c of nlp.near_duplicates.clusters ?? []) sizeOf.set(c.id, c.size);
    for (const r of rows) {
      // analyze-docs.py keys are docs-relative (e.g. "archive/x.md"), matching docRel
      const info = nlp.near_duplicates.by_doc[r.docRel];
      if (!info) continue;
      r.simTo = info.nn ? path.posix.basename(info.nn) : null;
      r.simPct = Number.isFinite(info.sim) ? Math.round(info.sim * 100) : null;
      if (info.cluster !== null && info.cluster !== undefined) {
        r.dupGroup = `nd${info.cluster}`;
        r.dupSize = sizeOf.get(info.cluster) ?? 2;
      } else {
        r.dupGroup = null;
        r.dupSize = 1;
      }
    }
  }

  // scoring + bucketing
  for (const r of rows) {
    const reasons: string[] = [];
    let score = 50;

    const age = r.ageMonths;
    const tracked = r.lastCommit !== "untracked";
    const recent = tracked && age <= opts.recentMonths;
    const veryStale = tracked && age >= opts.veryStaleMonths;
    const stale = tracked && age >= opts.staleMonths && !veryStale;
    if (!tracked) { reasons.push("untracked (new/uncommitted)"); }
    else if (age <= 3) { score += 25; reasons.push(`fresh (${age.toFixed(0)}mo)`); }
    else if (recent) { score += 12; }
    else if (veryStale) { score -= 25; reasons.push(`very stale (${age.toFixed(0)}mo)`); }
    else if (stale) { score -= 15; reasons.push(`stale (${age.toFixed(0)}mo)`); }
    else { score -= 3; reasons.push(`aging (${age.toFixed(0)}mo)`); }

    const orphan = r.inbound === 0;
    if (r.inbound >= 3) { score += 15; }
    else if (r.inbound === 0) { score -= 10; reasons.push("orphaned (no inbound links anywhere)"); }
    else { score += 8; }
    // Cited from outside docs/ but from no other doc: not an orphan, but not
    // reachable by a reader browsing the tree either. Worth an index entry.
    if (r.inbound > 0 && r.inbound === r.inboundExternal) {
      reasons.push(`referenced only from outside ${opts.docs}/ (${r.inboundExternal})`);
    }

    let deadAnchors = false;
    if (r.anchorsClassified >= 3) {
      const pct = r.anchorValidPct ?? 0;
      if (pct >= 80) { score += 15; }
      else if (pct >= 50) { score += 5; }
      else { score -= 15; deadAnchors = true; reasons.push(`dead code anchors (${pct}% resolve)`); }
    }

    if (r.completedWork) { score -= 10; reasons.push(`in "${r.topSeg}/" (iterative/likely-completed)`); }
    if (r.isIndex) { score += 10; }
    if (r.dupSize > 1) {
      score -= 8;
      reasons.push(r.simPct !== null && r.simTo
        ? `near-duplicate (~${r.simPct}% ↔ ${r.simTo})`
        : `possible duplicate title (${r.dupSize} docs)`);
    }

    score = Math.max(0, Math.min(100, score));
    r.score = score;

    // WEED has two routes in, because age alone is the weaker evidence:
    //   very stale + orphaned            -> WEED, "weak" unless corroborated
    //   merely stale + orphaned + content -> WEED, "strong"
    // The second route exists because the first is unreachable in any repo whose
    // docs are younger than --very-stale-months: measured on a real 136-doc
    // corpus it returned WEED=0 while the report itself listed 8-month-old
    // orphans resolving 0% of their code anchors. A triage tool that fails
    // toward "your library is fine" is worse than no triage. Corroborating
    // signals are dead anchors, a completed-work area, or a duplicate title.
    // Indexes are never auto-weeded (they are navigation).
    let bucket: DocRow["bucket"];
    const corroborated = deadAnchors || r.completedWork || r.dupSize > 1;
    if (r.isIndex) {
      bucket = veryStale && orphan ? "REVIEW" : "KEEP";
    } else if (veryStale && orphan) {
      bucket = "WEED";
      reasons.push(corroborated ? "strong: corroborated by content signals" : "weak: age+orphan only — verify");
    } else if (stale && orphan && corroborated) {
      bucket = "WEED";
      reasons.push("strong: stale + orphaned + corroborated by content signals");
    } else if (recent && (!orphan || (r.anchorValidPct !== null && r.anchorValidPct >= 60))) {
      bucket = "KEEP";
    } else {
      bucket = "REVIEW";
    }
    r.bucket = bucket;
    if (reasons.length === 0) reasons.push("mixed/neutral signals");
    r.reasons = reasons;
  }

  rows.sort((a, b) => a.score - b.score || a.rel.localeCompare(b.rel));

  const outPath = opts.out ??
    path.join(opts.root, WORKDIR, opts.format === "csv" ? "triage-report.csv" : "triage-report.md");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const withGit = files.filter((f) => lastCommit.has(relPosix(opts.root, f))).length;
  if (opts.format === "csv") {
    fs.writeFileSync(outPath, renderCsv(rows));
  } else {
    fs.writeFileSync(outPath, renderMarkdown(rows, opts, files.length, withGit, nlp));
  }

  // console summary
  const by = (b: string) => rows.filter((r) => r.bucket === b).length;
  console.log(`Triaged ${rows.length} docs under ${opts.docs}/`);
  console.log(`  KEEP:   ${by("KEEP")}`);
  console.log(`  REVIEW: ${by("REVIEW")}`);
  console.log(`  WEED:   ${by("WEED")}`);
  console.log(`Report: ${outPath}`);
}

// ----------------------------- rendering ----------------------------------

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function bucketTable(rows: DocRow[]): string {
  const head =
    "| Score | Doc | Last commit | Age(mo) | In | Anchors | Reasons |\n" +
    "|------:|-----|-------------|--------:|---:|---------|---------|\n";
  const body = rows.map((r) => {
    const anchors = r.anchorsClassified > 0 ? `${r.anchorValidPct}% of ${r.anchorsClassified}` : "—";
    return `| ${r.score} | \`${r.docRel}\` | ${r.lastCommit} | ${r.ageMonths ? r.ageMonths.toFixed(0) : "0"} | ${r.inbound} | ${anchors} | ${r.reasons.join("; ")} |`;
  }).join("\n");
  return head + body + "\n";
}

function renderMarkdown(rows: DocRow[], opts: Opts, scanned: number, tracked: number, nlp: NlpData | null): string {
  const now = NOW.toISOString().slice(0, 10);
  const keep = rows.filter((r) => r.bucket === "KEEP");
  const review = rows.filter((r) => r.bucket === "REVIEW");
  const weed = rows.filter((r) => r.bucket === "WEED");
  const pct = (n: number) => ((n / rows.length) * 100).toFixed(0);
  const medAge = (rs: DocRow[]) => median(rs.map((r) => r.ageMonths)).toFixed(0);

  const clusters = nlp?.near_duplicates?.clusters ?? [];
  const nlpNote = nlp
    ? `\n> **NLP enrichment active** (scikit-learn): near-duplicate signal is cosine ` +
      `similarity over TF-IDF vectors, not title matching. ${clusters.length} clusters found.\n`
    : `\n> _NLP enrichment not found — near-duplicate signal falls back to title matching. ` +
      `Run \`analyze-docs.py\` first for cosine-similarity clustering._\n`;
  let ndSection = "";
  if (clusters.length) {
    ndSection = `\n## Near-duplicate clusters (${clusters.length})\n\n` +
      `Docs with near-identical content (cosine ≥ ${nlp?.near_duplicates?.threshold ?? "?"}). ` +
      `Collapse each cluster to a single source of truth; the rest are archive/delete candidates.\n\n`;
    for (const c of clusters) {
      ndSection += `- **Cluster ${c.id}** — ${c.size} docs, ~${Math.round(c.mean_sim * 100)}% similar:\n`;
      for (const d of c.docs) ndSection += `    - \`${d}\`\n`;
    }
  }

  return `---
title: "docs/ relevance triage"
doc_type: reference
status: active
owner: "${docOwner()}"
updated: ${now}
tags: [standards]
---

# docs/ Relevance Triage

Generated ${now} by \`triage-docs.ts\` (non-destructive; no files modified).
Scanned **${scanned}** authored Markdown files under \`${opts.docs}/\` (generated
\`api/\` excluded${opts.includeGenerated ? " — but --include-generated was set" : ""}).
Of these, ${tracked} had git commit history (rest treated as new/untracked).
Recency thresholds (tuned to this repo's velocity, override with flags):
**recent ≤ ${opts.recentMonths}mo · stale ≥ ${opts.staleMonths}mo · very stale ≥ ${opts.veryStaleMonths}mo**.
${nlpNote}
## How to read this

Each doc is scored 0–100 for **relevance confidence** from objective signals:
git recency, inbound links (0 = orphaned), code-anchor validity (do the source
files it references still exist?), whether it lives in an iterative/likely-
completed area, and duplicate-title grouping. No single signal decides a bucket —
see each row's *Reasons*. **WEED** and **REVIEW** are candidate lists for human
judgement, not automatic deletions. Nothing here has been changed on disk.

Caveats: a genuinely stable reference doc can be old yet correct (its anchors
still resolve) — that's why it scores KEEP despite age. Conversely, a doc with
few code anchors can't be judged on anchor validity, so recency + links carry it.

## Summary

| Bucket | Count | % | Median age (mo) | Meaning |
|--------|------:|--:|----------------:|---------|
| 🟢 KEEP   | ${keep.length} | ${pct(keep.length)} | ${medAge(keep)} | Recent and connected/valid — retain as-is |
| 🟡 REVIEW | ${review.length} | ${pct(review.length)} | ${medAge(review)} | Mixed signals — needs a human read |
| 🔴 WEED   | ${weed.length} | ${pct(weed.length)} | ${medAge(weed)} | Orphaned and either very stale, or stale with corroborating content signals — likely archive or delete (rows marked "strong" are corroborated by dead anchors / completed-work area / duplicate title) |

Recommended flow: confirm the **WEED** list — start with the "strong" rows, then
verify the "weak" (age+orphan only) ones — → skim **REVIEW** (sort by score) →
then reorganize only what survives.
${ndSection}
## 🔴 WEED candidates (${weed.length})

${weed.length ? bucketTable(weed) : "_None._\n"}

## 🟡 REVIEW candidates (${review.length})

${review.length ? bucketTable(review) : "_None._\n"}

## 🟢 KEEP (${keep.length})

<details>
<summary>Show ${keep.length} retained docs</summary>

${keep.length ? bucketTable(keep) : "_None._\n"}
</details>
`;
}

function renderCsv(rows: DocRow[]): string {
  const esc = (v: string | number | null) => {
    const s = v === null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = [
    "bucket", "score", "doc_path", "top_dir", "is_index", "last_commit",
    "age_months", "inbound_links", "outbound_doc_links", "anchors_classified",
    "anchors_valid", "anchor_valid_pct", "completed_work_area", "dup_group_size",
    "near_dup_sim_pct", "near_dup_of", "code_refs", "reasons",
  ].join(",");
  const lines = rows.map((r) => [
    r.bucket, r.score, r.docRel, r.topSeg, r.isIndex, r.lastCommit,
    r.ageMonths ? r.ageMonths.toFixed(1) : "0", r.inbound, r.internalLinks,
    r.anchorsClassified, r.anchorsValid, r.anchorValidPct ?? "", r.completedWork,
    r.dupSize, r.simPct ?? "", r.simTo ?? "", r.codeRefs.join(";"), r.reasons.join(" | "),
  ].map(esc).join(","));
  return [header, ...lines].join("\n") + "\n";
}

main();
