/**
 * sweep-handoffs.ts — archive aged-out documents from .claude/handoffs/ into
 * .claude/handoffs/archive/, and keep every existing reference in sync.
 *
 * Retention rule: age is the only archive trigger. A handoff is archived once
 * its `**Last Updated: YYYY-MM-DD HH:mm**` line (falling back to file mtime
 * if that line is missing or unparseable) is >= --days old (default 15) —
 * regardless of whether it still has open `## Work items`. An aged-out
 * handoff with unchecked items is labeled `stale` rather than `resolved`;
 * nobody is coming back to finish it just because the box is still unticked.
 * Boxes under a Follow-on / out-of-scope / next-pull heading do NOT count —
 * see OUT_OF_SCOPE_HEADING_RE for why a finished handoff kept getting called
 * abandoned.
 *
 * Usage:
 *   npx tsx sweep-handoffs.ts [--days 15] [--dry-run] [--handoffs-dir <path>]
 *   npx tsx sweep-handoffs.ts --file <path/to/handoff.md> [--dry-run]
 *
 * --file archives one document immediately, bypassing the age check — used
 * by /agentic:handoff --next when a refresh finds zero open items left and
 * the user confirms archiving now instead of waiting for the age sweep.
 *
 * --handoffs-dir overrides where handoffs live, relative to --root unless
 * given as an absolute path (default `.claude/handoffs`). The archive
 * subdirectory is always `<handoffs-dir>/archive`. This exists so the sweep
 * can be dry-run or exercised for real against a sandbox copy of a handoffs
 * folder without touching the live one — e.g.
 * `--root /tmp/sandbox --handoffs-dir .claude/handoffs` against a copy at
 * `/tmp/sandbox/.claude/handoffs`. **Use the same relative layout in the
 * sandbox as the real repo** — the documents themselves contain literal
 * `.claude/handoffs/...` path text, so renaming the directory in the sandbox
 * (e.g. to a bare `handoffs`) makes those embedded paths not match what the
 * sandbox's `--handoffs-dir` computes, which is a test-setup bug, not a
 * script bug. `.claude/journal/` is unaffected by this flag — it is always
 * resolved under --root, so a sandboxed handoffs-only copy naturally has no
 * journal dir to rewrite (skipped, not an error).
 *
 * Two reference styles get fixed on every archive:
 *  - Absolute, repo-root-relative paths — the literal text
 *    `<handoffs-dir>/<name>.md` — rewritten to `<handoffs-dir>/archive/<name>.md`
 *    everywhere they appear: .claude/journal/*.md and every other handoff.
 *  - Relative markdown links between handoffs — `](./<name>.md)` — rewritten
 *    to `](./archive/<name>.md)` or `](../<name>.md)` depending on which side
 *    of the move each end of the link lands on, computed from the FINAL
 *    planned location of every file in this run (not the order files happen
 *    to be processed in) so a same-run pair that both move stays a same-dir
 *    link instead of picking up a spurious ../ or archive/.
 */

import * as fs from 'fs';
import * as path from 'path';

interface Args {
  days: number;
  dryRun: boolean;
  file?: string;
  root: string;
  handoffsDir: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { days: 15, dryRun: false, root: process.cwd(), handoffsDir: '.claude/handoffs' };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--days': a.days = parseInt(argv[++i], 10); break;
      case '--dry-run': a.dryRun = true; break;
      case '--file': a.file = argv[++i]; break;
      case '--root': a.root = argv[++i]; break;
      case '--handoffs-dir': a.handoffsDir = argv[++i]; break;
      default:
        console.error(`Unknown arg: ${argv[i]}`);
        process.exit(1);
    }
  }
  return a;
}

function resolveHandoffsDir(root: string, handoffsDir: string): string {
  return path.isAbsolute(handoffsDir) ? handoffsDir : path.join(root, handoffsDir);
}

interface Candidate {
  absPath: string;
  name: string;
  age: number;
  status: 'resolved' | 'stale';
}

const LAST_UPDATED_RE = /\*\*Last Updated:\s*(\d{4}-\d{2}-\d{2})[^\n]*\*\*/;
const OPEN_ITEM_LINE_RE = /^\s*-\s\[ \]/;
const HEADING_RE = /^(#{1,6})\s+/;
const FENCE_RE = /^\s*(```|~~~)/;
const REL_LINK_RE = /\]\(\.\/([A-Za-z0-9._-]+\.md)\)/g;

/**
 * Headings introducing work the document deliberately does NOT own — the
 * "here is what comes after this" list that nearly every FINISHED handoff
 * ends with. Unchecked boxes under one of these say nothing about whether
 * this document's own work got done, so they must not decide its label.
 *
 * Without this, a handoff that closed out perfectly still archived as
 * `stale` — "treated as abandoned" — purely because it was courteous enough
 * to leave a next-pull list behind, which put that banner directly above the
 * document's own "everything is done" banner. Observed 2026-08-18 on
 * client-ops' pull #4 handoff, and corrected by hand at the time.
 *
 * Kept deliberately narrow. The failure this direction produces is a
 * finished-looking label on genuinely abandoned work, so only headings that
 * are unambiguously about later, out-of-scope work qualify — "Follow-up",
 * for instance, does NOT, because it routinely means "things this document
 * still owes".
 */
const OUT_OF_SCOPE_HEADING_RE = /^#{2,6}\s+.*\b(follow[-\s]?on|out[-\s]of[-\s]scope|not in scope|next pull)\b/i;

/**
 * True when an unchecked `- [ ]` remains that this document actually owns.
 *
 * Skips fenced code blocks (a quoted checklist in an example is not work) and
 * everything under an out-of-scope heading, up to the next heading at the
 * same or a shallower level.
 */
function hasOpenItemInScope(content: string): boolean {
  let excludedDepth: number | null = null;
  let inFence = false;

  for (const line of content.split('\n')) {
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const heading = line.match(HEADING_RE);
    if (heading) {
      const depth = heading[1].length;
      // A heading at the same or a shallower level ends the excluded section.
      if (excludedDepth !== null && depth <= excludedDepth) excludedDepth = null;
      if (excludedDepth === null && OUT_OF_SCOPE_HEADING_RE.test(line)) excludedDepth = depth;
      continue;
    }

    if (excludedDepth === null && OPEN_ITEM_LINE_RE.test(line)) return true;
  }

  return false;
}

function ageInDays(content: string, absPath: string, now: Date): number {
  const m = content.match(LAST_UPDATED_RE);
  let ts: number;
  if (m) {
    ts = new Date(m[1] + 'T00:00:00').getTime();
  } else {
    ts = fs.statSync(absPath).mtime.getTime();
  }
  return Math.floor((now.getTime() - ts) / (1000 * 60 * 60 * 24));
}

function statusOf(content: string): 'resolved' | 'stale' {
  return hasOpenItemInScope(content) ? 'stale' : 'resolved';
}

function listHandoffs(handoffsDir: string): string[] {
  if (!fs.existsSync(handoffsDir)) return [];
  return fs.readdirSync(handoffsDir)
    .filter(f => f.endsWith('.md'))
    .map(f => path.join(handoffsDir, f));
}

function banner(status: 'resolved' | 'stale', dateStr: string, reason: 'sweep' | 'confirmed', handoffsRelDir: string): string {
  if (status === 'resolved') {
    const cause = reason === 'sweep'
      ? 'moved out of the active folder by the age sweep'
      : 'moved out of the active folder on confirmation at session close-out';
    return `> **Archived ${dateStr} — resolved.** All work items were complete; ${cause}.\n`;
  }
  return `> **Archived ${dateStr} — stale.** Open work items remained with no update for the retention window; treated as abandoned, not actively tracked. Move it back to \`${handoffsRelDir}/\` if this is picked up again.\n`;
}

function insertBanner(content: string, bannerLine: string): string {
  const lines = content.split('\n');
  const idx = lines.findIndex(l => LAST_UPDATED_RE.test(l));
  if (idx !== -1) {
    lines.splice(idx + 1, 0, '', bannerLine.trimEnd());
    return lines.join('\n');
  }
  // No Last Updated line: insert after the first heading, or at the very top.
  const headingIdx = lines.findIndex(l => l.startsWith('# '));
  const insertAt = headingIdx !== -1 ? headingIdx + 1 : 0;
  lines.splice(insertAt, 0, '', bannerLine.trimEnd());
  return lines.join('\n');
}

/** Where a handoff named `name` currently sits on disk, or undefined if it isn't a real handoff. */
function currentLocationOf(handoffsDir: string, archiveDir: string, name: string): 'top' | 'archive' | undefined {
  if (fs.existsSync(path.join(handoffsDir, name))) return 'top';
  if (fs.existsSync(path.join(archiveDir, name))) return 'archive';
  return undefined;
}

/** Where `name` will sit once this run's planned moves complete. */
function finalLocationOf(handoffsDir: string, archiveDir: string, name: string, toArchiveNames: Set<string>): 'top' | 'archive' | undefined {
  const cur = currentLocationOf(handoffsDir, archiveDir, name);
  if (cur === 'top' && toArchiveNames.has(name)) return 'archive';
  return cur;
}

/**
 * Rewrites `](./name.md)`-style relative links across every CURRENTLY
 * top-level handoff, using each file's own final location (self) and its
 * link targets' final locations — both computed from `toArchiveNames`, the
 * complete set of names this run will move, so a same-run pair that both
 * archive together keeps a same-directory `./` link instead of picking up a
 * spurious rewrite. Must run before any file in `toArchiveNames` is actually
 * moved, since it reads/writes each file at its pre-move path.
 */
function fixRelativeLinks(handoffsDir: string, archiveDir: string, toArchiveNames: Set<string>, dryRun: boolean): { file: string; count: number }[] {
  const results: { file: string; count: number }[] = [];
  for (const absPath of listHandoffs(handoffsDir)) {
    const name = path.basename(absPath);
    const selfFinalLoc: 'top' | 'archive' = toArchiveNames.has(name) ? 'archive' : 'top';
    const content = fs.readFileSync(absPath, 'utf8');
    let count = 0;
    const rewritten = content.replace(REL_LINK_RE, (whole, target: string) => {
      const targetFinalLoc = finalLocationOf(handoffsDir, archiveDir, target, toArchiveNames);
      if (!targetFinalLoc || targetFinalLoc === selfFinalLoc) return whole;
      count++;
      return selfFinalLoc === 'top' ? `](./archive/${target})` : `](../${target})`;
    });
    if (count === 0) continue;
    results.push({ file: name, count });
    if (!dryRun) fs.writeFileSync(absPath, rewritten, 'utf8');
  }
  return results;
}

function rewriteAbsoluteReferences(root: string, handoffsDir: string, relPath: string, newRelPath: string, dryRun: boolean): { file: string; count: number }[] {
  const targets: string[] = [];
  const journalDir = path.join(root, '.claude', 'journal');
  if (fs.existsSync(journalDir)) {
    for (const f of fs.readdirSync(journalDir)) {
      if (f.endsWith('.md')) targets.push(path.join(journalDir, f));
    }
  }
  for (const f of listHandoffs(handoffsDir)) targets.push(f);
  const archiveDir = path.join(handoffsDir, 'archive');
  if (fs.existsSync(archiveDir)) {
    for (const f of fs.readdirSync(archiveDir)) {
      if (f.endsWith('.md')) targets.push(path.join(archiveDir, f));
    }
  }

  const results: { file: string; count: number }[] = [];
  for (const t of targets) {
    let content: string;
    try {
      content = fs.readFileSync(t, 'utf8');
    } catch {
      continue;
    }
    const count = content.split(relPath).length - 1;
    if (count === 0) continue;
    results.push({ file: path.relative(root, t), count });
    if (!dryRun) {
      const rewritten = content.split(relPath).join(newRelPath);
      fs.writeFileSync(t, rewritten, 'utf8');
    }
  }
  return results;
}

function todayStr(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function archiveOne(root: string, handoffsDir: string, absPath: string, now: Date, dryRun: boolean, reason: 'sweep' | 'confirmed'): void {
  const archiveDir = path.join(handoffsDir, 'archive');
  const name = path.basename(absPath);
  const relPath = path.join(path.relative(root, handoffsDir), name);
  const newRelPath = path.join(path.relative(root, archiveDir), name);
  const content = fs.readFileSync(absPath, 'utf8');
  const status = statusOf(content);
  const dateStr = todayStr(now);

  const refs = rewriteAbsoluteReferences(root, handoffsDir, relPath, newRelPath, dryRun);

  console.log(`${dryRun ? '[dry-run] would archive' : 'archived'}  ${relPath}  (${status})`);
  for (const r of refs) {
    console.log(`  ${dryRun ? 'would rewrite' : 'rewrote'} ${r.count} absolute reference(s) in ${r.file}`);
  }

  if (dryRun) return;

  if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
  const withBanner = insertBanner(content, banner(status, dateStr, reason, path.relative(root, handoffsDir)));
  fs.writeFileSync(path.join(archiveDir, name), withBanner, 'utf8');
  fs.unlinkSync(absPath);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const now = new Date();
  const handoffsDir = resolveHandoffsDir(args.root, args.handoffsDir);
  const archiveDir = path.join(handoffsDir, 'archive');

  let toArchive: Candidate[];
  let scanned: number;
  const reason: 'sweep' | 'confirmed' = args.file ? 'confirmed' : 'sweep';

  if (args.file) {
    const absPath = path.isAbsolute(args.file) ? args.file : path.join(args.root, args.file);
    if (!fs.existsSync(absPath)) {
      console.error(`Not found: ${args.file}`);
      process.exit(1);
    }
    const content = fs.readFileSync(absPath, 'utf8');
    toArchive = [{ absPath, name: path.basename(absPath), age: ageInDays(content, absPath, now), status: statusOf(content) }];
    scanned = 1;
  } else {
    const files = listHandoffs(handoffsDir);
    scanned = files.length;
    toArchive = [];
    for (const absPath of files) {
      const content = fs.readFileSync(absPath, 'utf8');
      const age = ageInDays(content, absPath, now);
      if (age >= args.days) {
        toArchive.push({ absPath, name: path.basename(absPath), age, status: statusOf(content) });
      }
    }
  }

  const toArchiveNames = new Set(toArchive.map(c => c.name));

  // Fix relative ./name.md links before anything moves, using each file's
  // FINAL planned location — not the order files get processed in below.
  const relFixes = fixRelativeLinks(handoffsDir, archiveDir, toArchiveNames, args.dryRun);
  for (const r of relFixes) {
    console.log(`${args.dryRun ? '[dry-run] would rewrite' : 'rewrote'} ${r.count} relative link(s) in ${path.join(path.relative(args.root, handoffsDir), r.file)}`);
  }
  if (relFixes.length) console.log('');

  for (const c of toArchive) {
    archiveOne(args.root, handoffsDir, c.absPath, now, args.dryRun, reason);
  }

  if (!args.file) {
    const kept = scanned - toArchive.length;
    console.log('');
    console.log(`${scanned} handoff(s) scanned, ${toArchive.length} ${args.dryRun ? 'would be archived' : 'archived'}, ${kept} kept (< ${args.days} days).`);
  }
}

main();
