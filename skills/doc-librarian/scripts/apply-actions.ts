#!/usr/bin/env -S node --experimental-strip-types
/**
 * apply-actions.ts — Execute the appraisal action lists (aggregate-results.ts)
 * against docs/. This is the ONE step that mutates docs/, so it is DRY-RUN BY
 * DEFAULT, staged, and gated. It follows SKILL.md Procedures E (Curate) & B
 * (Reorganize): git mv to preserve history, deprecate-before-delete, never delete
 * a referenced doc.
 *
 * Per verdict:
 *   ARCHIVE   → git mv docs/<p> → docs/archive/<p>, set status:archived + dated banner
 *   DEPRECATE → keep in place, set status:deprecated + banner linking the replacement
 *   DELETE    → git rm — ONLY if inbound_links == 0 AND --confirm-delete
 *   MERGE     → NOT automated (content judgment) → written to apply-todo.md
 *   UPDATE    → NOT automated (content fix)      → written to apply-todo.md
 *   KEEP      → no-op
 *
 * Aggressive pruning (--aggressive): an ARCHIVE verdict is PROMOTED to DELETE when
 * the triage signals say the doc is orphaned AND its subject code is gone —
 * inbound_links == 0 AND anchors_classified > 0 AND anchor_valid_pct == 0 (it
 * referenced code, none of which still resolves). Promotions still require
 * --confirm-delete, and inbound>0 is never deleted. KEEP is never promoted.
 *
 * Usage:
 *   node --experimental-strip-types apply-actions.ts            # dry-run, all verdicts
 *   node --experimental-strip-types apply-actions.ts --aggressive
 *   node --experimental-strip-types apply-actions.ts --apply --confirm-delete --aggressive
 *   node --experimental-strip-types apply-actions.ts --source-batch 1 --apply   # stage one batch
 *
 * Flags:
 *   --actions <csv>       appraisal-actions.csv (default: audits/appraisal-actions.csv)
 *   --triage <csv>        triage CSV for inbound/anchor signals (default: newest *-docs-triage.csv)
 *   --docs <dir>          docs root (default: docs)
 *   --archive-subdir <d>  archive folder under docs (default: archive)
 *   --verdicts <list>     which verdict classes to process (default: all)
 *   --source-batch <N>    only act on rows from this batch (staged execution)
 *   --apply               actually mutate (default: dry-run, mutate nothing)
 *   --confirm-delete      required for any git rm (explicit or aggressive-promoted)
 *   --aggressive          promote weak ARCHIVE → DELETE (see above)
 *   --out <md>            report path (default: <root>/.doc-librarian/apply-report.md)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
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


const VERDICTS = ["KEEP", "UPDATE", "MERGE", "DEPRECATE", "ARCHIVE", "DELETE"] as const;

interface Opts {
  root: string; docs: string; archiveSubdir: string;
  actions: string; triage: string | null; out: string;
  verdicts: Set<string>; sourceBatch: number | null;
  apply: boolean; confirmDelete: boolean; aggressive: boolean;
}

function parseArgs(argv: string[]): Opts {
  const get = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(1, 48)
      .map((l) => l.replace(/^\s?\*\/?/, "").replace(/^\//, "")).join("\n"));
    process.exit(0);
  }
  let root = get("--root");
  if (!root) { try { root = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim(); } catch { root = process.cwd(); } }
  root = path.resolve(root);
  const rel = (p: string | undefined, d: string) => (p ? path.resolve(root!, p) : path.resolve(root!, d));
  const actions = rel(get("--actions"), `${WORKDIR}/appraisal-actions.csv`);
  const triage = get("--triage") ? path.resolve(root, get("--triage")!) : autodetectTriage(path.dirname(actions));
  const verdicts = new Set((get("--verdicts") ?? VERDICTS.join(",")).split(",").map((s) => s.trim().toUpperCase()).filter(Boolean));
  const sb = get("--source-batch");
  return {
    root, docs: get("--docs") ?? "docs", archiveSubdir: get("--archive-subdir") ?? "archive",
    actions, triage, out: rel(get("--out"), `${WORKDIR}/apply-report.md`),
    verdicts, sourceBatch: sb !== undefined && Number.isFinite(Number(sb)) ? Number(sb) : null,
    apply: argv.includes("--apply"), confirmDelete: argv.includes("--confirm-delete"),
    aggressive: argv.includes("--aggressive"),
  };
}

function autodetectTriage(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const hits = fs.readdirSync(dir).filter((f) => f.endsWith("-docs-triage.csv")).sort();
  return hits.length ? path.join(dir, hits[hits.length - 1]) : null;
}

// --- minimal CSV parser (quoted fields, embedded commas/quotes) ---
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "", row: string[] = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c; }
    else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c === "\r") { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift() ?? [];
  return rows.filter((r) => r.length > 1).map((r) => {
    const o: Record<string, string> = {}; header.forEach((h, i) => (o[h] = r[i] ?? "")); return o;
  });
}

const normDoc = (p: string): string =>
  p.trim().replace(/^`|`$/g, "").trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/^docs\//, "");
const oneLine = (s: string, max = 240): string => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
};

interface TriageSig { inbound: number; anchorsClassified: number; anchorPct: number | null; }

interface Action {
  doc: string; verdict: string; target: string; confidence: string; effort: string;
  inbound: number; batch: string; evidence: string;
  sig: TriageSig | null; promoted: boolean; origVerdict: string;
}

interface Result { verdict: string; doc: string; status: string; detail: string; }

const today = () => new Date().toISOString().slice(0, 10);

function main() {
  const o = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(o.actions)) { console.error(`actions CSV not found: ${o.actions} (run aggregate-results.ts first)`); process.exit(1); }

  const triage = new Map<string, TriageSig>();
  if (o.triage && fs.existsSync(o.triage)) {
    for (const r of parseCsv(fs.readFileSync(o.triage, "utf8"))) {
      triage.set(normDoc(r.doc_path), {
        inbound: Number(r.inbound_links) || 0,
        anchorsClassified: Number(r.anchors_classified) || 0,
        anchorPct: r.anchor_valid_pct === "" || r.anchor_valid_pct === undefined ? null : Number(r.anchor_valid_pct),
      });
    }
  }

  // load actions, join triage, apply aggressive promotion
  const rows = parseCsv(fs.readFileSync(o.actions, "utf8"));
  const actions: Action[] = rows.map((r) => {
    const doc = normDoc(r.doc_path);
    const sig = triage.get(doc) ?? null;
    let verdict = (r.verdict || "").toUpperCase();
    const origVerdict = verdict;
    let promoted = false;
    if (o.aggressive && verdict === "ARCHIVE" && sig
      && sig.inbound === 0 && sig.anchorsClassified > 0 && sig.anchorPct === 0) {
      verdict = "DELETE"; promoted = true;
    }
    return {
      doc, verdict, target: normDoc(r.target || ""), confidence: r.confidence || "", effort: r.effort || "",
      inbound: sig ? sig.inbound : (Number(r.inbound_links) || 0),
      batch: r.source_batch || "", evidence: r.evidence || "", sig, promoted, origVerdict,
    };
  }).filter((a) => o.sourceBatch === null || a.batch === String(o.sourceBatch))
    .filter((a) => o.verdicts.has(a.verdict) || o.verdicts.has(a.origVerdict));

  const results: Result[] = [];
  const todo: string[] = [];
  const linkWarnings: string[] = [];

  for (const a of actions) {
    switch (a.verdict) {
      case "KEEP": break;
      case "ARCHIVE": results.push(doArchive(o, a, linkWarnings)); break;
      case "DEPRECATE": results.push(doDeprecate(o, a)); break;
      case "DELETE": results.push(doDelete(o, a)); break;
      case "MERGE":
        todo.push(`- [ ] **MERGE** \`${a.doc}\` → \`${a.target || "(assign canonical)"}\` — merge unique content into the target, replace this doc with a redirect, fix inbound links. ${a.evidence ? `_(${oneLine(a.evidence, 160)})_` : ""}`);
        results.push({ verdict: "MERGE", doc: a.doc, status: "todo", detail: `manual → apply-todo.md (target: ${a.target || "unassigned"})` });
        break;
      case "UPDATE":
        todo.push(`- [ ] **UPDATE** \`${a.doc}\` — ${a.evidence ? oneLine(a.evidence, 200) : "content fix"}`);
        results.push({ verdict: "UPDATE", doc: a.doc, status: "todo", detail: "manual → apply-todo.md" });
        break;
      default:
        results.push({ verdict: a.verdict || "(none)", doc: a.doc, status: "skip", detail: `unrecognized verdict "${a.origVerdict}"` });
    }
  }

  writeReports(o, actions, results, todo, linkWarnings);
  printConsole(o, results);
}

// ---------- verdict handlers ----------

function doArchive(o: Opts, a: Action, linkWarnings: string[]): Result {
  const srcRel = path.posix.join(o.docs, a.doc);
  if (a.doc.startsWith(`${o.archiveSubdir}/`)) return { verdict: "ARCHIVE", doc: a.doc, status: "skip", detail: "already under archive/" };
  const destDocRel = path.posix.join(o.archiveSubdir, a.doc);       // archive/<subpath>
  const destRel = path.posix.join(o.docs, destDocRel);
  const srcAbs = path.join(o.root, srcRel), destAbs = path.join(o.root, destRel);
  if (!fs.existsSync(srcAbs)) return { verdict: "ARCHIVE", doc: a.doc, status: "skip", detail: "source file not found" };
  if (fs.existsSync(destAbs)) return { verdict: "ARCHIVE", doc: a.doc, status: "skip", detail: `destination exists: ${destRel}` };
  const banner = `> **📦 Archived ${today()}.** ${a.evidence ? oneLine(a.evidence) + " " : ""}Historical record — not current guidance.`;
  const refs = a.inbound; // authoritative inbound count from triage (proper link resolution)
  if (refs > 0) linkWarnings.push(`ARCHIVE \`${a.doc}\` → \`${destDocRel}\`: ${refs} inbound link(s) (triage) — tool rewrites absolute-path refs; verify relative links (Procedure B.4)`);

  // A generated doc must not be moved until its generator is retargeted, or the
  // next run recreates it at the old path and the archive copy becomes a fork.
  const gens = generatorFor(o.root, a.doc, o.docs);
  if (gens.length) {
    linkWarnings.push(`ARCHIVE \`${a.doc}\`: GENERATED by ${gens.map((g) => `\`${g}\``).join(", ")} — retarget the generator first, or the next run recreates it`);
    return { verdict: "ARCHIVE", doc: a.doc, status: "skip", detail: `has a generator (${gens[0]}${gens.length > 1 ? ` +${gens.length - 1}` : ""}) — retarget it first` };
  }

  if (!o.apply) return { verdict: "ARCHIVE", doc: a.doc, status: "dry-run", detail: `git mv → ${destRel}; +status:archived+banner${refs ? `; ⚠ ${refs} inbound` : ""}` };
  fs.mkdirSync(path.dirname(destAbs), { recursive: true });
  gitMv(o.root, srcRel, destRel);
  patchStatusBanner(destAbs, "archived", banner);
  rewriteAbsRefs(o, a.doc, destDocRel);
  return { verdict: "ARCHIVE", doc: a.doc, status: "applied", detail: `moved → ${destRel}${refs ? `; ⚠ ${refs} inbound to verify` : ""}` };
}

function doDeprecate(o: Opts, a: Action): Result {
  const srcRel = path.posix.join(o.docs, a.doc);
  const srcAbs = path.join(o.root, srcRel);
  if (!fs.existsSync(srcAbs)) return { verdict: "DEPRECATE", doc: a.doc, status: "skip", detail: "source file not found" };
  let link = "";
  if (a.target) {
    const relToTarget = path.posix.relative(path.posix.dirname(a.doc), a.target) || path.posix.basename(a.target);
    link = ` Superseded by [${path.posix.basename(a.target)}](${relToTarget}).`;
  } else link = " Superseded (replacement unspecified — assign one).";
  const banner = `> **⚠️ Deprecated ${today()}.**${link} ${a.evidence ? oneLine(a.evidence) : ""}`.trim();
  if (!o.apply) return { verdict: "DEPRECATE", doc: a.doc, status: "dry-run", detail: `in place; +status:deprecated+banner${a.target ? ` → ${a.target}` : " (no target)"}` };
  patchStatusBanner(srcAbs, "deprecated", banner);
  return { verdict: "DEPRECATE", doc: a.doc, status: "applied", detail: `banner added${a.target ? ` → ${a.target}` : " (no target)"}` };
}

function doDelete(o: Opts, a: Action): Result {
  const srcRel = path.posix.join(o.docs, a.doc);
  const srcAbs = path.join(o.root, srcRel);
  const tag = a.promoted ? "DELETE(←ARCHIVE)" : "DELETE";
  if (!fs.existsSync(srcAbs)) return { verdict: tag, doc: a.doc, status: "skip", detail: "source file not found" };
  if (a.inbound > 0) return { verdict: tag, doc: a.doc, status: "blocked", detail: `${a.inbound} inbound link(s) — never delete a referenced doc; deprecate/archive instead` };
  if (!o.confirmDelete) return { verdict: tag, doc: a.doc, status: "blocked", detail: "needs --confirm-delete" };
  if (!o.apply) return { verdict: tag, doc: a.doc, status: "dry-run", detail: `git rm ${srcRel} (0 inbound)` };
  gitRm(o.root, srcRel);
  return { verdict: tag, doc: a.doc, status: "applied", detail: `removed ${srcRel}` };
}

// ---------- git + file helpers ----------

/**
 * Does a script or package emit this doc? A generated doc that is archived
 * without retargeting its generator is silently recreated at the old path on the
 * next run, and the archived copy quietly becomes a fork. Observed on a real
 * corpus: `migration/branded-ids.md` is written by
 * `scripts/build-branded-id-migration-doc.ts`, which hardcodes that path.
 *
 * A doc move is not a docs-only operation — the same lesson as inbound
 * references from source code.
 */
function generatorFor(root: string, docRel: string, docsDir: string): string[] {
  const needle = `${docsDir}/${docRel}`;
  try {
    // Search EVERYTHING outside the docs tree, not a hand-listed set of build
    // directories. The first version of this guard looked only in
    // `scripts packages tools bin Makefile justfile` and would have missed the
    // two real generators in this corpus, both of which live under `.claude/`:
    // an expert skill's self-improve step writes its own user guide. Whatever
    // writes a doc is rarely where you would think to look for it.
    const raw = execSync(
      `git grep -F -l -- ${JSON.stringify(needle)} -- ${JSON.stringify(":!" + docsDir)}`,
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    // A file that merely LINKS to the doc is a referrer, not a generator. Treat
    // it as a generator only when it also looks like it writes: a redirect, a
    // path assignment, or an explicit write call near the mention.
    // Shell redirects and API calls, but also PROSE: the generators in this
    // corpus are instructions to an agent ("**Save the guide** to `<path>`"),
    // not code. A generator is whatever recreates the file, in whatever language
    // — including English.
    const WRITES = /(>>?\s|writeFile|writeFileSync|outputPath|outFile|--out\b|\btee\b|\bcp\b|\bmv\b|target:|dest:|\b(save|write|writes|written|generate|generates|generated|regenerate|emit|emits|output|outputs)\b)/i;
    return raw.split("\n").map((x) => x.trim()).filter(Boolean).filter((f) => {
      try {
        const hay = fs.readFileSync(path.join(root, f), "utf8");
        const idx = hay.indexOf(needle);
        if (idx < 0) return true;                       // matched some other form; keep it
        return WRITES.test(hay.slice(Math.max(0, idx - 400), idx + 400));
      } catch { return true; }
    });
  } catch {
    return [];  // git grep exits 1 on no match
  }
}

function gitMv(root: string, srcRel: string, destRel: string) {
  try { execSync(`git mv -- "${srcRel}" "${destRel}"`, { cwd: root, stdio: "pipe" }); }
  catch { fs.renameSync(path.join(root, srcRel), path.join(root, destRel)); }
}
function gitRm(root: string, srcRel: string) {
  try { execSync(`git rm -q -- "${srcRel}"`, { cwd: root, stdio: "pipe" }); }
  catch { fs.rmSync(path.join(root, srcRel)); }
}

/** Set frontmatter `status:` (creating a minimal block if none) and prepend a banner. */
function patchStatusBanner(absPath: string, status: string, banner: string) {
  const text = fs.readFileSync(absPath, "utf8");
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  let out: string;
  if (m) {
    let fm = m[1];
    fm = /^status\s*:/m.test(fm) ? fm.replace(/^status\s*:.*$/m, `status: ${status}`) : `${fm}\nstatus: ${status}`;
    const body = text.slice(m[0].length).replace(/^\s+/, "");
    out = `---\n${fm}\n---\n\n${banner}\n\n${body}`;
  } else {
    out = `---\nstatus: ${status}\n${status === "archived" ? "archived_on" : "deprecated_on"}: ${today()}\n---\n\n${banner}\n\n${text.replace(/^\s+/, "")}`;
  }
  fs.writeFileSync(absPath, out);
}

/**
 * Rewrite ABSOLUTE (docs-relative & repo-relative) path references old→new in
 * tracked docs, in a single pass. Longest form first, and a negative lookbehind
 * excludes path-internal chars so `docs/<old>` isn't re-matched by the bare
 * `<old>` form and relative links (`./`, `../<old>`) are left for manual review.
 */
function rewriteAbsRefs(o: Opts, oldRel: string, newRel: string) {
  const docsOld = `${o.docs}/${oldRel}`, docsNew = `${o.docs}/${newRel}`;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?<![\\w/.\\-])(${esc(docsOld)}|${esc(oldRel)})`, "g");
  const map = new Map<string, string>([[docsOld, docsNew], [oldRel, newRel]]);
  let files: string[] = [];
  try {
    files = execSync(`git grep -l --fixed-strings -- "${oldRel}" "${o.docs}"`, { cwd: o.root, encoding: "utf8", stdio: "pipe" })
      .split("\n").map((l) => l.trim()).filter(Boolean);
  } catch { return; }
  for (const f of files) {
    if (normDoc(f.replace(new RegExp(`^${o.docs}/`), "")) === newRel) continue; // the moved file itself
    const abs = path.join(o.root, f);
    const txt = fs.readFileSync(abs, "utf8");
    const out = txt.replace(re, (m) => map.get(m) ?? m);
    if (out !== txt) fs.writeFileSync(abs, out);
  }
}

// ---------- reporting ----------

function writeReports(o: Opts, actions: Action[], results: Result[], todo: string[], linkWarnings: string[]) {
  const mode = o.apply ? "APPLIED" : "DRY-RUN (nothing modified)";
  const byStatus = (s: string) => results.filter((r) => r.status === s);
  const grp = new Map<string, Result[]>();
  for (const r of results) (grp.get(r.verdict) ?? grp.set(r.verdict, []).get(r.verdict)!).push(r);
  const promotedCount = actions.filter((a) => a.promoted).length;

  let md = `---
title: "Apply-actions report"
doc_type: reference
status: active
owner: "${docOwner()}"
updated: ${today()}
tags: [standards]
---

# Apply-actions Report — ${mode}

**Last Updated: ${today()}**

Source: \`${path.relative(o.root, o.actions)}\`${o.sourceBatch !== null ? ` · batch **${o.sourceBatch}** only` : ""}.
Aggressive pruning: **${o.aggressive ? "ON" : "off"}**${o.aggressive ? ` (${promotedCount} ARCHIVE→DELETE promotion${promotedCount === 1 ? "" : "s"})` : ""}.
Delete gate: **${o.confirmDelete ? "--confirm-delete set" : "locked (add --confirm-delete)"}**.

## Tally

| Outcome | Count |
|---------|------:|
| applied | ${byStatus("applied").length} |
| dry-run (planned) | ${byStatus("dry-run").length} |
| blocked | ${byStatus("blocked").length} |
| skipped | ${byStatus("skip").length} |
| todo (manual) | ${byStatus("todo").length} |

`;
  for (const [verdict, rs] of [...grp.entries()].sort()) {
    md += `## ${verdict} (${rs.length})\n\n`;
    md += rs.sort((a, b) => a.doc.localeCompare(b.doc))
      .map((r) => `- \`${r.doc}\` — **${r.status}**: ${r.detail}`).join("\n") + "\n\n";
  }
  if (linkWarnings.length) md += `## ⚠ Inbound links to reconcile\n\n${linkWarnings.map((w) => `- ${w}`).join("\n")}\n\n`;
  md += `## Next\n\n${o.apply
    ? "Verify links, confirm moved docs render, then commit this batch (Procedure B.5). Re-run per source batch to stage."
    : "Re-run with `--apply` to execute (add `--confirm-delete` for removals). Consider `--source-batch N` to stage one batch at a time."}\n`;

  fs.mkdirSync(path.dirname(o.out), { recursive: true });
  fs.writeFileSync(o.out, md);

  const todoPath = path.join(path.dirname(o.out), "apply-todo.md");
  if (todo.length) {
    fs.writeFileSync(todoPath, `---
title: "Apply-actions manual TODO"
doc_type: reference
status: active
owner: "${docOwner()}"
updated: ${today()}
tags: [standards]
---

# Manual follow-ups (MERGE / UPDATE)

These verdicts need content judgment and are **not** automated by \`apply-actions.ts\`.

${todo.join("\n")}
`);
  }
}

function printConsole(o: Opts, results: Result[]) {
  const c = (s: string) => results.filter((r) => r.status === s).length;
  console.log(`${o.apply ? "APPLIED" : "DRY-RUN"}: ${c("applied")} applied · ${c("dry-run")} planned · ${c("blocked")} blocked · ${c("skip")} skipped · ${c("todo")} manual`);
  for (const r of results.filter((r) => r.status === "blocked")) console.log(`  ⛔ ${r.verdict} ${r.doc} — ${r.detail}`);
  console.log(`Report: ${path.relative(o.root, o.out)}`);
  if (!o.apply) console.log(`(dry-run — nothing modified. Add --apply to execute${o.aggressive ? ", --confirm-delete for the promoted deletes" : ""}.)`);
}

main();
