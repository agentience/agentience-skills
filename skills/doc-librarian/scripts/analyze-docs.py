#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "scikit-learn>=1.3",
#     "numpy>=1.23",
#     "scipy>=1.9",
# ]
# ///
"""
analyze-docs.py — Advanced NLP analysis for documentation triage & tagging.

Uses scikit-learn to compute the signals that are awkward to hand-roll in
TypeScript, and emits a single machine-readable JSON that the companion TS
scripts (triage-docs.ts, suggest-tags.ts) consume when present:

  1. Near-duplicate detection — TF-IDF (word 1-2 grams, sublinear tf, L2) +
     cosine similarity + connected-components clustering. Finds superseded
     iterations and copy-paste forks that title matching misses.
  2. Tag salience — TF-IDF over titles/headings with a max-df ceiling so
     ubiquitous words don't dominate; ranked candidate vocabulary.
  3. Topic themes — NMF topic model; each topic's top terms become a theme
     grouping for the drafted controlled vocabulary.

Non-destructive: reads docs, writes one JSON artifact.

Dependencies are declared inline (PEP 723), so the preferred runner is uv, which
provisions them in an ephemeral environment automatically — no manual install:

  uv run analyze-docs.py [--out .doc-librarian/nlp-analysis.json] [--near-dup-threshold 0.82] ...

Also runs under plain Python if scikit-learn/numpy/scipy are already installed:

  python3 analyze-docs.py --out .doc-librarian/nlp-analysis.json
  # (to install for the plain-python path: pip install -r requirements.txt --break-system-packages)

Options: [--root PATH] [--docs docs] [--out .doc-librarian/nlp-analysis.json]
         [--near-dup-threshold 0.82] [--topics 12] [--min-df 2] [--max-df 0.4]
         [--top 100] [--include-generated]
"""
from __future__ import annotations
import argparse, json, os, re, subprocess, sys
from datetime import date

# Working dir for this skill's artifacts, relative to the repo root. Outside the
# audited tree on purpose -- see the note at the write site.
WORKDIR = ".doc-librarian"


try:
    import numpy as np
    import sklearn
    from sklearn.feature_extraction.text import TfidfVectorizer, ENGLISH_STOP_WORDS
    from sklearn.decomposition import NMF
    from sklearn.metrics.pairwise import linear_kernel
    from scipy.sparse.csgraph import connected_components
    from scipy.sparse import csr_matrix
except ImportError as e:  # pragma: no cover
    sys.stderr.write(f"Missing dependency: {e}\nInstall: pip install scikit-learn --break-system-packages\n")
    sys.exit(2)

# Doc-generic words that are never useful tags (augments sklearn's english list).
DOC_STOP = {
    "guide","guides","plan","plans","planning","note","notes","overview","summary",
    "intro","introduction","readme","index","doc","docs","documentation",
    "implementation","implementing","spec","specification","reference","tutorial",
    "example","examples","using","use","used","new","update","updates","updated",
    "fix","fixes","fixed","setup","getting","started","complete","completed","final",
    "draft","wip","todo","misc","general","part","section","phase","step","steps",
    "status","support","supported","add","adding","added","remove","create","creating",
    "creation","change","changes","changed","work","working","file","files","list",
    "table","design","approach","strategy","solution","issue","issues","problem",
    "process","system","page","pages","data","test","tests","testing","report",
    "reports","next","key","points","point","result","results","current","related",
    "required","background","context","goal","goals","purpose","prerequisites",
    "conclusion","benefits","details","description","cases","case","options","option",
    "requirements","tasks","task","items","item","before","after","need","needs",
    "want","make","making","way","ways","like","lot","set","sets","also","however",
}
STOP = sorted(ENGLISH_STOP_WORDS | DOC_STOP)


def sh(cmd, cwd=None):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, shell=False).stdout.strip()


def git_toplevel():
    try:
        return sh(["git", "rev-parse", "--show-toplevel"]) or os.getcwd()
    except Exception:
        return os.getcwd()


def walk_md(docs_abs, include_generated):
    out = []
    for cur, dirs, files in os.walk(docs_abs):
        dirs[:] = [d for d in dirs if d not in ("node_modules", ".git", ".agentics")]
        # skip top-level generated dir docs/api
        if not include_generated and os.path.dirname(os.path.join(cur, "x")) == docs_abs:
            dirs[:] = [d for d in dirs if d != "api"]
        for f in files:
            if f.lower().endswith(".md"):
                out.append(os.path.join(cur, f))
    return sorted(out)


HEADING_RE = re.compile(r"^#{1,3}\s+(.+)$", re.M)
H1_RE = re.compile(r"^#\s+(.+)$", re.M)
CODE_FENCE_RE = re.compile(r"```.*?```", re.S)


def load_docs(files, docs_abs):
    rels, bodies, heads, titles = [], [], [], []
    for p in files:
        rel = os.path.relpath(p, docs_abs).replace(os.sep, "/")
        try:
            txt = open(p, encoding="utf-8", errors="ignore").read()
        except Exception:
            txt = ""
        body = CODE_FENCE_RE.sub(" ", txt)  # drop code blocks for topical signals
        h = " ".join(HEADING_RE.findall(txt))
        t = (H1_RE.search(txt).group(1) if H1_RE.search(txt) else os.path.basename(rel)[:-3])
        rels.append(rel); bodies.append(txt); heads.append((t + " ") * 2 + h); titles.append(t)
    return rels, bodies, heads, titles


def _components(sim, rels, threshold):
    """Connected-component clusters of docs with cosine >= threshold (size >= 2)."""
    adj = csr_matrix(sim >= threshold)
    _, labels = connected_components(adj, directed=False)
    from collections import defaultdict
    members = defaultdict(list)
    for i, lab in enumerate(labels):
        members[lab].append(i)
    groups, gid, doc_group = [], 0, {}
    for lab, idxs in members.items():
        if len(idxs) < 2:
            continue
        sub = sim[np.ix_(idxs, idxs)]
        m = float(sub[np.triu_indices(len(idxs), k=1)].mean()) if len(idxs) > 1 else 0.0
        groups.append({"id": gid, "size": len(idxs), "mean_sim": round(m, 3),
                       "docs": [rels[i] for i in idxs]})
        for i in idxs:
            doc_group[rels[i]] = gid
        gid += 1
    groups.sort(key=lambda c: (-c["size"], -c["mean_sim"]))
    return groups, doc_group


def near_duplicates(bodies, rels, threshold, related_threshold):
    vec = TfidfVectorizer(stop_words="english", ngram_range=(1, 2),
                          sublinear_tf=True, min_df=2, max_df=0.5, norm="l2")
    try:
        X = vec.fit_transform(bodies)
    except ValueError:
        return {"threshold": threshold, "clusters": [], "by_doc": {},
                "related_threshold": related_threshold, "related_groups": []}
    n = X.shape[0]
    sim = linear_kernel(X)  # cosine (L2-normalized)
    np.fill_diagonal(sim, 0.0)
    # adjacency for clustering
    adj = csr_matrix(sim >= threshold)
    ncomp, labels = connected_components(adj, directed=False)
    # nearest neighbor per doc
    nn_idx = sim.argmax(axis=1)
    nn_sim = sim.max(axis=1)
    # build clusters of size >= 2
    from collections import defaultdict
    members = defaultdict(list)
    for i, lab in enumerate(labels):
        members[lab].append(i)
    clusters = []
    cid = 0
    doc_cluster = {}
    for lab, idxs in members.items():
        if len(idxs) < 2:
            continue
        # mean pairwise sim within cluster
        sub = sim[np.ix_(idxs, idxs)]
        m = float(sub[np.triu_indices(len(idxs), k=1)].mean()) if len(idxs) > 1 else 0.0
        cl = {"id": cid, "size": len(idxs), "mean_sim": round(m, 3),
              "docs": [rels[i] for i in idxs]}
        for i in idxs:
            doc_cluster[rels[i]] = cid
        clusters.append(cl)
        cid += 1
    clusters.sort(key=lambda c: (-c["size"], -c["mean_sim"]))
    by_doc = {}
    for i, rel in enumerate(rels):
        by_doc[rel] = {
            "cluster": doc_cluster.get(rel),
            "nn": rels[int(nn_idx[i])] if n > 1 else None,
            "sim": round(float(nn_sim[i]), 3),
        }
    related_groups, _ = _components(sim, rels, related_threshold)
    return {"threshold": threshold, "n_clusters": len(clusters),
            "clusters": clusters, "by_doc": by_doc,
            "related_threshold": related_threshold,
            "n_related_groups": len(related_groups),
            "related_groups": related_groups}


def tags_and_topics(heads, rels, min_df, max_df, k_topics):
    vec = TfidfVectorizer(stop_words=STOP, ngram_range=(1, 2), sublinear_tf=True,
                          min_df=min_df, max_df=max_df, token_pattern=r"[A-Za-z][A-Za-z0-9-]{2,}")
    try:
        X = vec.fit_transform(heads)
    except ValueError:
        return {"candidates": []}, [], {}
    vocab = np.array(vec.get_feature_names_out())
    df = np.asarray((X > 0).sum(axis=0)).ravel()
    salience = np.asarray(X.sum(axis=0)).ravel()  # summed tf-idf weight

    # topic model (NMF) for theme grouping; map each term + each doc to a topic
    k = max(2, min(k_topics, X.shape[0] - 1, X.shape[1] - 1))
    topics = []
    term_topic = np.full(len(vocab), -1)
    doc_topics = {}
    topic_label = {}
    try:
        nmf = NMF(n_components=k, init="nndsvda", max_iter=500, random_state=42)
        W = nmf.fit_transform(X)          # docs x topics
        H = nmf.components_                # topics x terms
        term_topic = H.argmax(axis=0)
        for ti in range(k):
            top = np.argsort(H[ti])[::-1][:10]
            terms = [vocab[j].replace(" ", "-") for j in top]
            topics.append({"id": int(ti), "terms": terms,
                           "weight": round(float(W[:, ti].sum()), 2)})
            topic_label[int(ti)] = ", ".join(terms[:4])
        topics.sort(key=lambda t: -t["weight"])
        dom = W.argmax(axis=1)
        rowsum = W.sum(axis=1)
        for i, rel in enumerate(rels):
            t = int(dom[i]) if rowsum[i] > 0 else None
            doc_topics[rel] = {"topic": t, "label": topic_label.get(t) if t is not None else None}
    except Exception as e:  # pragma: no cover
        sys.stderr.write(f"NMF skipped: {e}\n")

    order = np.argsort(salience)[::-1]
    candidates = []
    for j in order:
        candidates.append({
            "term": vocab[j].replace(" ", "-"),
            "df": int(df[j]),
            "salience": round(float(salience[j]), 2),
            "topic": int(term_topic[j]) if term_topic[j] >= 0 else None,
        })
    return {"candidates": candidates}, topics, doc_topics


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=None)
    ap.add_argument("--docs", default="docs")
    ap.add_argument("--out", default=None)
    ap.add_argument("--near-dup-threshold", type=float, default=0.82)
    ap.add_argument("--related-threshold", type=float, default=0.5,
                    help="cosine cutoff for 'related' grouping used to batch deep-dive work")
    ap.add_argument("--topics", type=int, default=12)
    ap.add_argument("--min-df", type=int, default=2)
    ap.add_argument("--max-df", type=float, default=0.4)
    ap.add_argument("--top", type=int, default=100)
    ap.add_argument("--include-generated", action="store_true")
    a = ap.parse_args()

    root = os.path.abspath(a.root or git_toplevel())
    docs_abs = os.path.join(root, a.docs)
    if not os.path.isdir(docs_abs):
        sys.stderr.write(f"docs dir not found: {docs_abs}\n"); sys.exit(1)

    files = walk_md(docs_abs, a.include_generated)
    rels, bodies, heads, titles = load_docs(files, docs_abs)
    if not rels:
        sys.stderr.write("no markdown docs found\n"); sys.exit(1)

    nd = near_duplicates(bodies, rels, a.near_dup_threshold, a.related_threshold)
    tags, topics, doc_topics = tags_and_topics(heads, rels, a.min_df, a.max_df, a.topics)
    tags["candidates"] = tags["candidates"][: a.top]

    result = {
        "generated": date.today().isoformat(),
        "engine": "scikit-learn",
        "engine_version": sklearn.__version__,
        "docs_scanned": len(rels),
        "params": {"near_dup_threshold": a.near_dup_threshold,
                   "related_threshold": a.related_threshold, "topics": a.topics,
                   "min_df": a.min_df, "max_df": a.max_df},
        "near_duplicates": nd,
        "doc_topics": doc_topics,
        "tags": tags,
        "topics": topics,
    }
    # Default OUT of the audited tree: an artifact written into docs/ becomes
    # a document the next scan appraises. setup.sh gitignores this directory.
    out = a.out or os.path.join(root, WORKDIR, "nlp-analysis.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        json.dump(result, f, indent=1)
    print(f"Analyzed {len(rels)} docs with scikit-learn {sklearn.__version__}.")
    print(f"  near-duplicate clusters (>= {a.near_dup_threshold}): {nd.get('n_clusters', 0)}")
    print(f"  related groups (>= {a.related_threshold}): {nd.get('n_related_groups', 0)}")
    print(f"  tag candidates: {len(tags['candidates'])} | topics: {len(topics)}")
    print(f"  JSON: {out}")


if __name__ == "__main__":
    main()
