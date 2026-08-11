/**
 * digest-transcript.ts — reduce a Claude Code session transcript (main loop +
 * all subagent sidecars) to a compact markdown timeline for /journal capture
 * and catchup modes.
 *
 * Usage:
 *   npx tsx digest-transcript.ts --session <session-id> [--project-dir <dir>]
 *   npx tsx digest-transcript.ts --file <path/to/transcript.jsonl>
 *   Flags: --max-text <chars=600> --full-agents --out <file>
 *
 * Keeps: timestamps, user/assistant text (truncated), tool calls as one-liners,
 * tool-result errors, branch/cwd spans and branch-lifecycle commands,
 * per-subagent summaries (task, span, tools, branch, final result).
 * Drops: tool-result bodies, thinking, file-history snapshots, queue noise.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface Args {
  session?: string;
  file?: string;
  projectDir?: string;
  maxText: number;
  fullAgents: boolean;
  out?: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { maxText: 600, fullAgents: false };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--session': a.session = argv[++i]; break;
      case '--file': a.file = argv[++i]; break;
      case '--project-dir': a.projectDir = argv[++i]; break;
      case '--max-text': a.maxText = parseInt(argv[++i], 10); break;
      case '--full-agents': a.fullAgents = true; break;
      case '--out': a.out = argv[++i]; break;
      default:
        console.error(`Unknown arg: ${argv[i]}`);
        process.exit(1);
    }
  }
  if (!a.session && !a.file) {
    console.error('Required: --session <id> or --file <path>');
    process.exit(1);
  }
  return a;
}

function defaultProjectDir(): string {
  const slug = '-' + process.cwd().replace(/^\//, '').replace(/[^a-zA-Z0-9]/g, '-');
  return path.join(os.homedir(), '.claude', 'projects', slug);
}

interface Rec {
  type?: string;
  timestamp?: string;
  message?: { role?: string; content?: unknown };
  isMeta?: boolean;
  cwd?: string;
  gitBranch?: string;
}

function readJsonl(file: string): Rec[] {
  const recs: Rec[] = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { recs.push(JSON.parse(line)); } catch { /* skip unparseable */ }
  }
  return recs;
}

function localDateTime(ts?: string): string {
  if (!ts) return '?';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '?';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function hhmmss(ts?: string): string {
  if (!ts) return '??:??:??';
  const d = new Date(ts);
  return isNaN(d.getTime()) ? '??:??:??' : d.toTimeString().slice(0, 8);
}

function duration(startTs?: string, endTs?: string): string {
  if (!startTs || !endTs) return '?';
  const ms = new Date(endTs).getTime() - new Date(startTs).getTime();
  if (isNaN(ms) || ms < 0) return '?';
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}

function squish(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max) + ' …[truncated]' : t;
}

function toolOneLiner(name: string, input: Record<string, unknown>): string {
  const pick = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = input?.[k];
      if (typeof v === 'string' && v.trim()) return v;
    }
    return undefined;
  };
  const detail =
    pick('description') ??
    pick('file_path', 'path', 'skill', 'pattern', 'query', 'url') ??
    pick('command', 'prompt', 'question') ??
    Object.keys(input ?? {}).join(',');
  return `${name}: ${squish(detail ?? '', 140)}`;
}

interface Block { type?: string; text?: string; name?: string; input?: Record<string, unknown>; is_error?: boolean; content?: unknown }

function blocks(content: unknown): Block[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return Array.isArray(content) ? (content as Block[]) : [];
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return (content as Block[]).filter(b => b.type === 'text' && b.text).map(b => b.text).join(' ');
  }
  return '';
}

/**
 * Branch lifecycle commands worth surfacing in the digest header.
 *
 * A Bash call is split into segments on shell separators first, and each
 * segment must *start* with the operation. That does two jobs at once: a git
 * verb merely quoted inside a heredoc, echo, or grep pattern never sits at the
 * head of a segment, so it is not logged as an operation; and what gets
 * reported is the git segment itself rather than the head of a long compound
 * command, which for `VAR=… && cd … && git worktree add …` is the difference
 * between a useful line and a truncated variable assignment.
 */
const SEGMENT_SPLIT = /;|&&|\|\||\||\n|\bdo\b|\bthen\b|\belse\b|[({]/;
const SEG_GIT = /^\s*(?:sudo\s+)?git\s+(?:-C\s+\S+\s+)?(?:checkout|switch|worktree|branch|merge|rebase)\b/;
// Path-shaped prefix charset (no quotes or colons) so a heredoc embedding this
// path as data does not read as an invocation of it.
const SEG_WORKTREE_SCRIPT = /^\s*(?:(?:bash|sh|zsh)\s+)?[\w./~$@-]*worktree-flow\/scripts\/(?:start|finish)\.sh\b/;
// Read-only forms — including `git branch --show-current`, which /journal
// itself runs on every capture.
const SEG_NOISE = /\bgit\s+branch\s+(?:--show-current|--list|--all|-a\b|-r\b|-v\b)|\bgit\s+worktree\s+list\b|\bgit\s+checkout\s+(?:--\s|\.\s*$)/;

/** The branch-op segments of a Bash command; empty when it performs none. */
function branchOpSegments(cmd: string): string[] {
  const hits: string[] = [];
  for (const seg of cmd.split(SEGMENT_SPLIT)) {
    if (!SEG_GIT.test(seg) && !SEG_WORKTREE_SCRIPT.test(seg)) continue;
    if (SEG_NOISE.test(seg)) continue;
    const s = squish(seg, 100);
    if (s && !hits.includes(s)) hits.push(s);
  }
  return hits;
}

/**
 * One contiguous run of records on the same branch. Spans collapse on branch
 * alone, not on (branch, cwd) — a bare `cd` shifts the recorded cwd without
 * changing what was worked on, and git forbids two worktrees sharing a branch,
 * so a genuine worktree move always shows up as a branch change anyway.
 */
interface BranchSpan {
  branch: string;
  cwd: string;
  firstTs?: string;
  lastTs?: string;
}

interface Digest {
  lines: string[];
  firstTs?: string;
  lastTs?: string;
  toolCounts: Map<string, number>;
  userTexts: string[];
  assistantTexts: string[];
  branchSpans: BranchSpan[];
  branchOps: { ts?: string; command: string }[];
  rawBytes: number;
}

function digestRecords(recs: Rec[], maxText: number, rawBytes: number): Digest {
  const d: Digest = {
    lines: [], toolCounts: new Map(), userTexts: [], assistantTexts: [],
    branchSpans: [], branchOps: [], rawBytes,
  };
  for (const r of recs) {
    if (r.type !== 'user' && r.type !== 'assistant') continue;
    if (r.timestamp) {
      if (!d.firstTs) d.firstTs = r.timestamp;
      d.lastTs = r.timestamp;
    }
    // Every user/assistant record stamps the branch and cwd it was written
    // under — collapse consecutive identical pairs into spans. This is the
    // authoritative branch source: it works identically in catchup mode,
    // where no live `git branch` call is possible.
    if (r.gitBranch !== undefined || r.cwd !== undefined) {
      const branch = r.gitBranch ?? '';
      const cwd = r.cwd ?? '';
      const last = d.branchSpans[d.branchSpans.length - 1];
      if (last && last.branch === branch) {
        if (r.timestamp) last.lastTs = r.timestamp;
      } else {
        d.branchSpans.push({ branch, cwd, firstTs: r.timestamp, lastTs: r.timestamp });
      }
    }
    const t = hhmmss(r.timestamp);
    for (const b of blocks(r.message?.content)) {
      if (b.type === 'text' && b.text?.trim()) {
        // Skip harness-injected user records (system reminders, command scaffolding)
        if (r.type === 'user' && (r.isMeta || /^<(system-reminder|command-name|local-command)/.test(b.text.trim()))) continue;
        const who = r.type === 'user' ? 'USER' : 'CLAUDE';
        const text = squish(b.text, maxText);
        d.lines.push(`[${t}] ${who}: ${text}`);
        (r.type === 'user' ? d.userTexts : d.assistantTexts).push(text);
      } else if (b.type === 'tool_use' && b.name) {
        d.toolCounts.set(b.name, (d.toolCounts.get(b.name) ?? 0) + 1);
        const cmd = b.input?.command;
        if (b.name === 'Bash' && typeof cmd === 'string') {
          for (const seg of branchOpSegments(cmd)) d.branchOps.push({ ts: r.timestamp, command: seg });
        }
        d.lines.push(`[${t}]   → ${toolOneLiner(b.name, b.input ?? {})}`);
      } else if (b.type === 'tool_result' && b.is_error) {
        d.lines.push(`[${t}]   ✗ ERROR: ${squish(resultText(b.content), 300)}`);
      }
      // thinking blocks and non-error tool results are dropped deliberately
    }
  }
  return d;
}

function toolSummary(counts: Map<string, number>): string {
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n}×${c}`).join(', ') || 'none';
}

const branchLabel = (s: BranchSpan): string => s.branch || '(no branch)';
const spanKey = (s: BranchSpan): string => s.branch;

/**
 * `main` — or, when the session moved, `main 09:12:04–10:03:51 → feat/x …`.
 * A span carries its cwd only when the cwd changed along with the branch,
 * which is the signature of a worktree move rather than a plain checkout.
 */
function branchSummary(spans: BranchSpan[], maxShown = 8): string {
  if (!spans.length) return 'unknown (transcript records carry no cwd/gitBranch)';
  if (spans.length === 1) return branchLabel(spans[0]);
  const parts = spans.slice(0, maxShown).map((s, i) => {
    const moved = i > 0 && s.cwd && s.cwd !== spans[i - 1].cwd;
    return `${branchLabel(s)} ${hhmmss(s.firstTs)}–${hhmmss(s.lastTs)}${moved ? ` [${s.cwd}]` : ''}`;
  });
  const more = spans.length > maxShown ? ` (+${spans.length - maxShown} more transitions)` : '';
  return parts.join(' → ') + more;
}

function branchOpsSummary(ops: { ts?: string; command: string }[], maxShown = 10): string {
  const shown = ops.slice(0, maxShown).map(o => `[${hhmmss(o.ts)}] ${o.command}`).join(' · ');
  return ops.length > maxShown ? `${shown} (+${ops.length - maxShown} more)` : shown;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const projectDir = args.projectDir ?? defaultProjectDir();

  const mainFile = args.file ?? path.join(projectDir, `${args.session}.jsonl`);
  if (!fs.existsSync(mainFile)) {
    console.error(`Transcript not found: ${mainFile}`);
    process.exit(2);
  }
  const sessionId = args.session ?? path.basename(mainFile, '.jsonl');
  const rawMain = fs.statSync(mainFile).size;
  const main_ = digestRecords(readJsonl(mainFile), args.maxText, rawMain);

  // Subagent sidecars: <projectDir>/<sessionId>/subagents/agent-*.jsonl (+ .meta.json)
  const subDir = path.join(path.dirname(mainFile), sessionId, 'subagents');
  const agentFiles: string[] = fs.existsSync(subDir)
    ? fs.readdirSync(subDir).filter((f: string) => f.endsWith('.jsonl')).sort()
    : [];

  // Digest the sidecars up front: their branch spans feed the header, and a
  // worktree-isolated subagent is the one case where a branch appears in the
  // session that the main loop never stood on.
  let rawTotal = rawMain;
  const agents = agentFiles.map(f => {
    const fp = path.join(subDir, f);
    rawTotal += fs.statSync(fp).size;
    let meta: { name?: string; agentType?: string; description?: string } = {};
    const metaPath = fp.replace(/\.jsonl$/, '.meta.json');
    if (fs.existsSync(metaPath)) {
      try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch { /* ignore */ }
    }
    return { file: f, meta, digest: digestRecords(readJsonl(fp), args.maxText, 0) };
  });

  const mainSpanKeys = new Set(main_.branchSpans.map(spanKey));
  const foreignSpans = new Map<string, BranchSpan>();
  for (const a of agents) {
    for (const s of a.digest.branchSpans) {
      if (!mainSpanKeys.has(spanKey(s)) && !foreignSpans.has(spanKey(s))) foreignSpans.set(spanKey(s), s);
    }
  }
  const allBranchOps = [...main_.branchOps, ...agents.flatMap(a => a.digest.branchOps)]
    .sort((x, y) => (x.ts ?? '').localeCompare(y.ts ?? ''));

  const out: string[] = [];
  out.push(`# Session digest: ${sessionId}`);
  out.push('');
  out.push(`- Main loop: ${hhmmss(main_.firstTs)}–${hhmmss(main_.lastTs)} (${duration(main_.firstTs, main_.lastTs)}), ` +
    `${main_.userTexts.length} user / ${main_.assistantTexts.length} assistant messages, tools: ${toolSummary(main_.toolCounts)}`);
  out.push(`- Branches: ${branchSummary(main_.branchSpans)}`);
  if (allBranchOps.length) out.push(`- Branch ops: ${branchOpsSummary(allBranchOps)}`);
  out.push(`- Subagents: ${agentFiles.length}`);
  if (foreignSpans.size) {
    out.push(`- Subagent-only branches: ${[...foreignSpans.values()]
      .map(s => `${branchLabel(s)} [${s.cwd || 'unknown cwd'}]`).join(', ')}`);
  }
  out.push(`- Local start: ${localDateTime(main_.firstTs)} · local end: ${localDateTime(main_.lastTs)} (use the LOCAL start date for journal-file routing)`);
  out.push(`- Raw UTC: ${main_.firstTs ?? '?'} · ${main_.lastTs ?? '?'}`);
  out.push('');
  out.push('## Main timeline');
  out.push('');
  out.push(...main_.lines);

  if (agents.length) {
    out.push('');
    out.push('## Subagents');
    for (const { file: f, meta, digest: ad } of agents) {
      out.push('');
      out.push(`### ${meta.name ?? f} (${meta.agentType ?? 'unknown type'}) — ${f}`);
      if (meta.description) out.push(`- Label: ${meta.description}`);
      out.push(`- Span: ${hhmmss(ad.firstTs)}–${hhmmss(ad.lastTs)} (${duration(ad.firstTs, ad.lastTs)}) · tools: ${toolSummary(ad.toolCounts)}`);
      if (ad.branchSpans.some(s => !mainSpanKeys.has(spanKey(s)))) {
        out.push(`- Branches: ${branchSummary(ad.branchSpans)}`);
      }
      out.push(`- Task: ${squish(ad.userTexts[0] ?? '(no prompt text found)', 400)}`);
      out.push(`- Result: ${squish(ad.assistantTexts[ad.assistantTexts.length - 1] ?? '(no final text found)', 500)}`);
      if (args.fullAgents) {
        out.push('');
        out.push(...ad.lines.map(l => '  ' + l));
      }
    }
  }

  const text = out.join('\n') + '\n';
  const footer = `---\nDigest: ${(text.length / 1024).toFixed(1)} KB from ${(rawTotal / 1024).toFixed(1)} KB raw ` +
    `(${(100 * text.length / Math.max(rawTotal, 1)).toFixed(1)}%)\n`;
  const final = text + footer;
  if (args.out) {
    fs.writeFileSync(args.out, final);
    console.log(`Wrote ${args.out} (${(final.length / 1024).toFixed(1)} KB)`);
  } else {
    process.stdout.write(final);
  }
}

main();
