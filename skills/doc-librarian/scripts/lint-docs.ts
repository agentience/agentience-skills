#!/usr/bin/env -S npx tsx
/**
 * Documentation governance linter (zero-dependency, Node built-ins only).
 *
 * Checks over the ACTIVE docs tree (excludes archive/, reference/api/ generated output, and
 * scripts/ tooling incl. its intentionally-broken test-docs/ fixtures):
 *
 *   links       — every relative markdown link must resolve to an existing file OR dir
 *                 (catches bare directory links without a trailing slash; source-code
 *                 cross-references are out of scope by policy).
 *   tags        — every frontmatter `tags:` value must appear in docs/TAGS.md.
 *   frontmatter — every active content doc (not README.md / TAGS.md) must carry YAML
 *                 frontmatter with title, doc_type, status, owner, updated, tags, and a
 *                 valid doc_type / status.
 *   structure   — doc_type must match its Diátaxis bucket (how-to/→how-to, reference/→reference,
 *                 explanation/→explanation, decisions/→decision, tutorials/→tutorial); filenames
 *                 must be kebab-case (NN- / YYYY-MM-DD- prefixes ok). Naming is a hard error on
 *                 new/staged/single files and a non-blocking warning in the full audit (legacy debt).
 *
 * Usage (from repo root):
 *   npx tsx docs/scripts/lint-docs.ts                 # full active-tree lint (CI / manual)
 *   npx tsx docs/scripts/lint-docs.ts --staged        # only staged active .md (pre-commit)
 *   npx tsx docs/scripts/lint-docs.ts --file=<path>   # lint one file (git/editor hooks)
 *   npx tsx docs/scripts/lint-docs.ts --check=links    # run a subset (links,tags,frontmatter,structure)
 *   npx tsx docs/scripts/lint-docs.ts --staleness [--days=N]   # non-blocking review report
 *
 * Exits non-zero if any ERROR is found (warnings and the --staleness report never fail).
 */
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO = execSync('git rev-parse --show-toplevel').toString().trim();
const DOCS = path.join(REPO, 'docs');
const TAGS_FILE = path.join(DOCS, 'TAGS.md');

const argv = process.argv.slice(2);
const STAGED = argv.includes('--staged');
const STALENESS = argv.includes('--staleness');
const fileArg = argv.find((a) => a.startsWith('--file='));
const FILE = fileArg ? path.resolve(REPO, fileArg.split('=')[1]) : null;
const daysArg = argv.find((a) => a.startsWith('--days='));
const STALE_DAYS = daysArg ? parseInt(daysArg.split('=')[1], 10) : 180;
const checkArg = argv.find((a) => a.startsWith('--check='));
const CHECKS = new Set(
  (checkArg ? checkArg.split('=')[1].split(',') : ['links', 'tags', 'frontmatter', 'structure']).map((s) => s.trim()),
);
// New/staged/single-file runs block on naming; the full audit only warns (legacy names are debt).
const NAMING_BLOCKS = STAGED || FILE !== null;

// Paths under docs/ that are NOT part of the governed active tree.
const EXCLUDED = ['archive', 'reference/api', 'scripts'];
const isExcluded = (relToDocs: string) =>
  EXCLUDED.some((e) => relToDocs === e || relToDocs.startsWith(e + '/'));

const VALID_DOC_TYPE = new Set(['tutorial', 'how-to', 'reference', 'explanation', 'decision']);
const VALID_STATUS = new Set(['draft', 'active', 'deprecated', 'archived']);
const REQUIRED_FM = ['title', 'doc_type', 'status', 'owner', 'updated', 'tags'];
// Diátaxis buckets whose docs must carry the matching doc_type. project/ and archive/ are pragmatic
// buckets (mixed types), so they carry no doc_type↔bucket constraint.
const BUCKET_DOCTYPE: Record<string, string> = {
  'how-to': 'how-to',
  reference: 'reference',
  explanation: 'explanation',
  decisions: 'decision',
  tutorials: 'tutorial',
};
const isIndexFile = (bn: string) => bn === 'README.md' || bn === 'TAGS.md';

interface Finding {
  file: string;
  line?: number;
  msg: string;
}
const errors: Finding[] = [];
const warnings: Finding[] = [];

// ---- gather the active .md file set -------------------------------------------------
function walk(dir: string, out: string[]) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    const rel = path.relative(DOCS, full);
    if (isExcluded(rel)) continue;
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith('.md')) out.push(full);
  }
}

function isActiveDocMd(abs: string): boolean {
  const rel = path.relative(DOCS, abs);
  return !rel.startsWith('..') && abs.endsWith('.md') && !isExcluded(rel);
}

function stagedMd(): string[] {
  const out = execSync('git diff --cached --name-only --diff-filter=ACMR').toString().trim();
  return out
    .split('\n')
    .filter(Boolean)
    .filter((p) => p.startsWith('docs/') && p.endsWith('.md') && !isExcluded(p.slice('docs/'.length)))
    .map((p) => path.join(REPO, p))
    .filter((p) => fs.existsSync(p));
}

const files = FILE
  ? isActiveDocMd(FILE) && fs.existsSync(FILE) ? [FILE] : [] // non-doc / excluded / missing → no-op
  : STAGED
    ? stagedMd()
    : (() => { const o: string[] = []; walk(DOCS, o); return o; })();

// ---- frontmatter parsing ------------------------------------------------------------
function parseFrontmatter(text: string): Record<string, string> | null {
  if (!text.startsWith('---\n')) return null;
  const end = text.indexOf('\n---', 4);
  if (end === -1) return null;
  const block = text.slice(4, end);
  const fm: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (m) fm[m[1]] = m[2].trim();
  }
  return fm;
}

// ---- MODE: staleness report (non-blocking) ------------------------------------------
// Living documentation (how-to/reference/explanation/tutorials) whose `updated:` is older than the
// threshold is a review candidate. Excludes decisions/ (immutable ADRs) and project/ (historical
// records: meetings, release-notes, retrospectives, pm) — those are point-in-time, not "stale".
if (STALENESS) {
  const STALE_BUCKETS = ['how-to', 'reference', 'explanation', 'tutorials'];
  const today = new Date();
  const rows: { rel: string; updated: string; age: number }[] = [];
  for (const f of files) {
    const relToDocs = path.relative(DOCS, f);
    if (!STALE_BUCKETS.some((b) => relToDocs === b || relToDocs.startsWith(b + '/'))) continue;
    const fm = parseFrontmatter(fs.readFileSync(f, 'utf8'));
    const updated = fm?.updated?.replace(/^["']|["']$/g, '');
    if (!updated || !/^\d{4}-\d{2}-\d{2}$/.test(updated)) continue; // READMEs / undated: skip
    const age = Math.floor((today.getTime() - new Date(updated + 'T00:00:00').getTime()) / 86_400_000);
    if (age > STALE_DAYS) rows.push({ rel: path.relative(REPO, f), updated, age });
  }
  rows.sort((a, b) => b.age - a.age);
  const asOf = today.toISOString().slice(0, 10);
  console.log(`Staleness report — living docs with updated: > ${STALE_DAYS} days ago (as of ${asOf})\n`);
  if (rows.length === 0) {
    console.log('  none — every living doc is within the freshness window ✓');
  } else {
    for (const r of rows) console.log(`  ${String(r.age).padStart(4)}d  ${r.rel}  (updated ${r.updated})`);
  }
  console.log(`\n[${rows.length} stale of the dated living docs — informational, non-blocking]`);
  process.exit(0);
}

// ---- allowed tags from TAGS.md ------------------------------------------------------
function allowedTags(): Set<string> {
  const set = new Set<string>();
  const txt = fs.readFileSync(TAGS_FILE, 'utf8');
  for (const m of txt.matchAll(/^\|\s*`([a-z0-9-]+)`\s*\|/gm)) set.add(m[1]); // table rows: | `tag` | … |
  return set;
}

// ---- CHECK: links -------------------------------------------------------------------
function checkLinks(file: string) {
  const text = fs.readFileSync(file, 'utf8');
  const base = path.dirname(file);
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      let link = m[1].trim();
      if (!link || /^(https?:|mailto:|file:|#|\/)/.test(link)) continue;
      link = link.split('#')[0];
      if (!link) continue;
      // Gate DOC/asset links (.md, images, directories) only. Source-code cross-references
      // (.ts/.py/…) move independently of docs and are the author's responsibility.
      const ext = path.extname(link).toLowerCase();
      const GATED_EXT = ['', '.md', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.html', '.pdf'];
      if (!GATED_EXT.includes(ext)) continue;
      const target = link.startsWith('docs/') ? path.join(REPO, link) : path.resolve(base, link);
      if (!fs.existsSync(target)) errors.push({ file, line: i + 1, msg: `broken link → ${m[1]}` });
    }
  });
}

// ---- CHECK: tags --------------------------------------------------------------------
function checkTags(file: string, allowed: Set<string>) {
  const fm = parseFrontmatter(fs.readFileSync(file, 'utf8'));
  if (!fm || fm.tags === undefined) return;
  const raw = fm.tags.replace(/^\[|\]$/g, '').trim();
  if (!raw) return;
  for (const t of raw.split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)) {
    if (!allowed.has(t)) errors.push({ file, msg: `tag not in TAGS.md → ${t}` });
  }
}

// ---- CHECK: frontmatter -------------------------------------------------------------
function checkFrontmatter(file: string) {
  if (isIndexFile(path.basename(file))) return; // index/meta files are exempt
  const fm = parseFrontmatter(fs.readFileSync(file, 'utf8'));
  if (!fm) {
    errors.push({ file, msg: 'missing YAML frontmatter' });
    return;
  }
  for (const key of REQUIRED_FM) if (fm[key] === undefined) errors.push({ file, msg: `frontmatter missing '${key}:'` });
  if (fm.doc_type && !VALID_DOC_TYPE.has(fm.doc_type)) errors.push({ file, msg: `invalid doc_type '${fm.doc_type}'` });
  if (fm.status && !VALID_STATUS.has(fm.status)) errors.push({ file, msg: `invalid status '${fm.status}'` });
}

// ---- CHECK: structure (placement + naming) ------------------------------------------
function checkStructure(file: string) {
  const relToDocs = path.relative(DOCS, file);
  const bucket = relToDocs.split(path.sep)[0];
  const bn = path.basename(file);

  // Naming: kebab-case (digits allow NN- and YYYY-MM-DD- prefixes). README/TAGS exempt; the
  // project/ bucket keeps its established date-based record naming (meetings, release notes).
  if (!isIndexFile(bn) && bucket !== 'project') {
    const stem = bn.replace(/\.md$/, '');
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(stem)) {
      const f = { file, msg: `non-kebab filename '${bn}' — use lowercase-with-dashes (NN- / YYYY-MM-DD- prefixes ok)` };
      (NAMING_BLOCKS ? errors : warnings).push(f);
    }
  }

  // Placement: a Diátaxis bucket demands the matching doc_type.
  const expected = BUCKET_DOCTYPE[bucket];
  if (expected && !isIndexFile(bn)) {
    const fm = parseFrontmatter(fs.readFileSync(file, 'utf8'));
    if (fm?.doc_type && fm.doc_type !== expected) {
      errors.push({ file, msg: `doc_type '${fm.doc_type}' does not match bucket '${bucket}/' (expected '${expected}')` });
    }
  }
}

// ---- run ----------------------------------------------------------------------------
const allowed = CHECKS.has('tags') ? allowedTags() : new Set<string>();
for (const f of files) {
  if (CHECKS.has('links')) checkLinks(f);
  if (CHECKS.has('tags')) checkTags(f, allowed);
  if (CHECKS.has('frontmatter')) checkFrontmatter(f);
  if (CHECKS.has('structure')) checkStructure(f);
}

const scope = FILE ? 'file' : STAGED ? 'staged' : 'active-tree';
const fmt = (list: Finding[]) =>
  list
    .sort((a, b) => a.file.localeCompare(b.file))
    .map((e) => `  ${path.relative(REPO, e.file)}${e.line ? ':' + e.line : ''} — ${e.msg}`)
    .join('\n');

if (warnings.length) console.error(`⚠ docs lint (${scope}) — ${warnings.length} warning(s):\n${fmt(warnings)}\n`);

if (errors.length === 0) {
  console.log(`✓ docs lint (${scope}, ${[...CHECKS].join('+')}) — ${files.length} file(s), no errors`);
  process.exit(0);
}
console.error(`✗ docs lint (${scope}) — ${errors.length} error(s):\n${fmt(errors)}`);
process.exit(1);
