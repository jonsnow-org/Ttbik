#!/usr/bin/env python3
"""Fixed, hashed snapshots for Sham Pro's missing training stages (contract: SHAM2_DATA_REQUIREMENTS.md). Run once on a runner; the trainer reads the files offline.

  arabic  HuggingFaceFW/fineweb-2 (config arb_Arab, ODC-By): real Arabic web text, split per DOCUMENT before anything else (a document is either all train or all held-out);
          one record = a real span (prompt) and the NEXT span of the same document (target). No translation, no paraphrase, no authored text.
  tools   openbmb/UltraData-SFT-Agent-2609 (Apache-2.0): real agent trajectories whose tool outputs were really executed (Codex-style shell / read / patch tools).
          Only the SHELL decisions are kept, renamed to our tool `computer_run`; the executed result is kept as evidence. Split per TRACE.
          PROVENANCE WARNING recorded in the manifest: the assistant turns of that dataset were written by a commercial model (its system prompt says so); the owner decides whether it stays.
          The dataset has no approval field: `approval` is "not_recorded", never invented.

Every file is JSONL with the provenance fields the contract demands; manifest.json holds exact counts, the SHA-256 of each file, the immutable dataset revisions and the gaps.
    python sham2_snapshots.py arabic --out OUT [--train 12000 --heldout 1200]
    python sham2_snapshots.py tools  --out OUT [--train 6000 --heldout 600]
    python sham2_snapshots.py --selftest
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time

ARABIC = re.compile(r"[؀-ۿݐ-ݿࢠ-ࣿ]")
LETTER = re.compile(r"[^\W\d_]", re.UNICODE)
SENTENCE_END = re.compile(r"[.!?؟\n]")
SHELL_NAMES = {"shell", "bash", "execute_bash", "run_command", "execute_command", "terminal", "exec_command"}


def bucket(key: str, parts: int = 10) -> int:
    return int(hashlib.sha256(key.encode("utf-8")).hexdigest(), 16) % parts


def split_of(key: str) -> str:
    """One document / trace is entirely train or entirely held-out (decided by its id alone, before any span is cut)."""
    return "heldout" if bucket(key) == 0 else "train"


def arabic_ratio(text: str) -> float:
    letters = LETTER.findall(text)
    return (len(ARABIC.findall(text)) / len(letters)) if letters else 0.0


def cut_span(text: str, start: int, want: int = 400, hard: int = 700) -> tuple[str, int] | None:
    """The span [start, end) ending at a sentence boundary near `want` characters (never beyond `hard`). -> (span, end)."""
    if start >= len(text):
        return None
    window = text[start:start + hard]
    ends = [m.end() for m in SENTENCE_END.finditer(window) if m.end() >= min(want // 2, len(window))]
    end = start + (next((e for e in ends if e >= want), ends[-1] if ends else len(window)))
    span = text[start:end].strip()
    return (span, end) if len(span) >= 80 else None


def arabic_records(doc_id: str, text: str, revision: str, config: str = "arb_Arab"):
    """Adjacent spans of ONE document: (prompt, target), (target, next target) ... at most two records per document, never overlapping."""
    if not (600 <= len(text) <= 8000) or arabic_ratio(text) < 0.9:
        return []
    out, pos, prev = [], 0, None
    for _ in range(3):
        cut = cut_span(text, pos)
        if cut is None:
            break
        span, pos = cut
        if prev is not None:
            out.append({"prompt": prev, "target": span, "stage": "arabic", "source_dataset": "HuggingFaceFW/fineweb-2", "source_config": config,
                        "source_revision": revision, "source_record_id": doc_id, "split": split_of(doc_id), "language": "ar"})
        prev = span
    return out[:2]


def _command(arguments) -> str:
    if isinstance(arguments, str):
        try:
            arguments = json.loads(arguments)
        except ValueError:
            return arguments.strip()
    if isinstance(arguments, dict):
        c = arguments.get("command") or arguments.get("cmd") or arguments.get("script") or ""
        return " ".join(map(str, c)) if isinstance(c, list) else str(c)
    return ""


def _short(text, n: int) -> str:
    text = text if isinstance(text, str) else json.dumps(text, ensure_ascii=False)
    return text if len(text) <= n else text[:n] + " …[cut]"


def tools_records(row: dict, revision: str, config: str):
    """One record per SHELL decision of a trace. prompt = the task + the last turns (tool outputs shortened); target = the exact tool call; tool_result = what really ran."""
    messages = row.get("messages") or []
    trace_id = str(row.get("uuid") or "")
    if not trace_id:
        return []
    task = next((m.get("content") for m in messages if m.get("role") == "user" and isinstance(m.get("content"), str)), "")
    out = []
    for i, m in enumerate(messages):
        if m.get("role") != "assistant":
            continue
        for call in m.get("tool_calls") or []:
            fn = (call or {}).get("function") or {}
            if str(fn.get("name", "")).lower() not in SHELL_NAMES:
                continue
            cmd = _command(fn.get("arguments")).strip()
            if not cmd or len(cmd) > 600:
                continue
            result = next((x.get("content") for x in messages[i + 1:i + 4] if x.get("role") == "tool"), None)
            if result is None:
                continue
            recent = []
            for x in messages[max(0, i - 6):i]:
                if x.get("role") == "tool":
                    recent.append("نتيجة الأداة: " + _short(x.get("content"), 500))
                elif x.get("role") == "assistant" and x.get("tool_calls"):
                    c = _command(((x["tool_calls"][0] or {}).get("function") or {}).get("arguments"))
                    recent.append("computer_run: " + _short(c, 200))
            prompt = "المهمة:\n" + _short(task, 1500) + ("\n" + "\n".join(recent) if recent else "")
            out.append({"prompt": _short(prompt, 3000), "target": json.dumps({"name": "computer_run", "arguments": {"command": cmd}}, ensure_ascii=False),
                        "stage": "tools", "trace_id": trace_id, "tool_name": "computer_run", "tool_name_original": str(fn.get("name")),
                        "tool_arguments": {"command": cmd}, "tool_result": {"exit_code": None, "stdout": _short(result, 1500), "stderr": ""},
                        "approval": "not_recorded", "source": "openbmb/UltraData-SFT-Agent-2609:" + config, "source_revision": revision, "split": split_of(trace_id)})
    return out


def loop_rows(row: dict, max_cmd_bytes: int = 62):
    """Training views of the agent LOOP head (task + the tail of the terminal history -> the next command), one per shell decision whose command fits the loop writer (<= max_cmd_bytes).
    Lean records: {task, hist: [[cmd, result]...] (last 3, results shortened), cmd, trace_id, split}. The result of every earlier step was really executed by the source's runtime."""
    messages = row.get("messages") or []
    trace_id = str(row.get("uuid") or "")
    if not trace_id:
        return []
    task = next((m.get("content") for m in messages if m.get("role") == "user" and isinstance(m.get("content"), str)), "")
    task = " ".join(task.replace("<uploaded_files>", " ").replace("</uploaded_files>", " ").split())[:200]
    out, hist = [], []
    for i, m in enumerate(messages):
        if m.get("role") != "assistant":
            continue
        for call in m.get("tool_calls") or []:
            fn = (call or {}).get("function") or {}
            if str(fn.get("name", "")).lower() not in SHELL_NAMES:
                continue
            cmd = " ".join(_command(fn.get("arguments")).split())
            result = next((x.get("content") for x in messages[i + 1:i + 4] if x.get("role") == "tool"), None)
            if not cmd or result is None:
                continue
            if len(cmd.encode("utf-8")) <= max_cmd_bytes:
                out.append({"task": task, "hist": [list(h) for h in hist[-3:]], "cmd": cmd, "trace_id": trace_id, "split": split_of(trace_id)})
            res = " ".join(str(result).replace("Execution output of [shell]:", " ").split())
            hist.append([cmd[:120], res[:160]])
    return out


def _write(path: str, rows: list) -> dict:
    import gzip
    opener = gzip.open if path.endswith(".gz") else open
    with opener(path, "wt", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    h = hashlib.sha256(open(path, "rb").read()).hexdigest()
    return {"file": os.path.basename(path), "rows": len(rows), "sha256": h}


def _revision(repo: str) -> str:
    from huggingface_hub import HfApi
    return HfApi().dataset_info(repo).sha


def build_arabic(out: str, train: int, heldout: int, limit_docs: int = 0) -> dict:
    from datasets import load_dataset
    repo, config = "HuggingFaceFW/fineweb-2", "arb_Arab"
    rev = _revision(repo)
    ds = load_dataset(repo, config, split="train", streaming=True, revision=rev)
    seen, rows = set(), {"train": [], "heldout": []}
    want = {"train": train, "heldout": heldout}
    scanned = 0
    for r in ds:
        scanned += 1
        text = r.get("text") or ""
        doc_id = str(r.get("id") or "")
        h = hashlib.sha1(text.encode("utf-8")).hexdigest()
        if not doc_id or h in seen:
            continue
        seen.add(h)
        for rec in arabic_records(doc_id, text, rev, config):
            if len(rows[rec["split"]]) < want[rec["split"]]:
                rows[rec["split"]].append(rec)
        if all(len(rows[k]) >= want[k] for k in want) or (limit_docs and scanned >= limit_docs):
            break
    return {"stage": "arabic", "revision": rev, "license": "odc-by", "scanned_documents": scanned,
            "files": [_write(os.path.join(out, "arabic_train.jsonl"), rows["train"]), _write(os.path.join(out, "arabic_heldout.jsonl"), rows["heldout"])]}


def build_tools(out: str, train: int, heldout: int, limit_rows: int = 0) -> dict:
    from datasets import load_dataset
    repo = "openbmb/UltraData-SFT-Agent-2609"
    rev = _revision(repo)
    rows = {"train": [], "heldout": []}
    want = {"train": train, "heldout": heldout}
    scanned = 0
    for config in ("Code-Agent", "General-Agent"):
        ds = load_dataset(repo, config, split="train", streaming=True, revision=rev)
        for r in ds:
            scanned += 1
            for rec in tools_records(r, rev, config):
                if len(rows[rec["split"]]) < want[rec["split"]]:
                    rows[rec["split"]].append(rec)
            if all(len(rows[k]) >= want[k] for k in want) or (limit_rows and scanned >= limit_rows):
                break
        if all(len(rows[k]) >= want[k] for k in want):
            break
    traces = {k: len({r["trace_id"] for r in rows[k]}) for k in rows}
    assert not ({r["trace_id"] for r in rows["train"]} & {r["trace_id"] for r in rows["heldout"]}), "a trace must not be in both splits"
    return {"stage": "tools", "revision": rev, "license": "apache-2.0", "scanned_traces": scanned, "traces": traces,
            "files": [_write(os.path.join(out, "tools_train.jsonl"), rows["train"]), _write(os.path.join(out, "tools_heldout.jsonl"), rows["heldout"])],
            "contract_gaps": ["approval outcome is not recorded by the source (written as not_recorded)", "exit_code is not recorded by the source (null)",
                              "the assistant turns were produced by a commercial model: provenance decision belongs to the owner"]}


V1_TOOL_MAP = {"shell": ("computer_run", lambda a: {"command": _command(a)}), "bash": ("computer_run", lambda a: {"command": _command(a)}),
               "read_file": ("computer_read", lambda a: {"path": str(a.get("file_path") or a.get("path") or "")} if isinstance(a, dict) else None),
               "rg": ("computer_search", lambda a: ({"pattern": str(a["pattern"]), **({"path": str(a["path"])} if a.get("path") else {})} if isinstance(a, dict) and a.get("pattern") else None))}


def v1_tool_rows(row: dict, max_steps: int = 3):
    """Sham v1 tool examples from one real trace: {user, steps: [[tool, arguments, result]...], answer}. Tools are renamed to v1's own computer tools (computer_run / computer_read /
    computer_search); the result is what the source's runtime really returned. The first `max_steps` mapped steps; the answer is the trace's final assistant text only when the
    trace ends within those steps (otherwise none: the example ends after the last result)."""
    messages = row.get("messages") or []
    trace_id = str(row.get("uuid") or "")
    user = next((m.get("content") for m in messages if m.get("role") == "user" and isinstance(m.get("content"), str)), "")
    user = " ".join(user.replace("<uploaded_files>", " ").replace("</uploaded_files>", " ").split())
    if not trace_id or not user:
        return []
    steps, total = [], 0
    for i, m in enumerate(messages):
        if m.get("role") != "assistant":
            continue
        for call in m.get("tool_calls") or []:
            total += 1
            fn = (call or {}).get("function") or {}
            mapped = V1_TOOL_MAP.get(str(fn.get("name", "")).lower())
            args = fn.get("arguments")
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except ValueError:
                    args = None
            result = next((x.get("content") for x in messages[i + 1:i + 4] if x.get("role") == "tool"), None)
            if mapped is None or args is None or result is None or len(steps) >= max_steps:
                continue
            a2 = mapped[1](args)
            if not a2 or not any(a2.values()):
                continue
            res = str(result).replace("Execution output of [%s]:" % fn.get("name"), "").replace("[INFO] Command may mutate the environment.", "").strip()
            steps.append([mapped[0], a2, res[:1200]])
    if not steps:
        return []
    final = next((m.get("content") for m in reversed(messages) if m.get("role") == "assistant" and not m.get("tool_calls") and len(str(m.get("content", "")).strip()) >= 20), "")
    answer = str(final).strip()[:600] if (final and total <= max_steps) else ""
    return [{"user": user[:700], "steps": steps, "answer": answer, "trace_id": trace_id, "split": split_of(trace_id)}]


def build_v1tools(out: str, train: int, limit_rows: int = 0) -> dict:
    from datasets import load_dataset
    repo = "openbmb/UltraData-SFT-Agent-2609"
    rev = _revision(repo)
    rows, scanned = [], 0
    for config in ("Code-Agent", "General-Agent", "Tool-Use"):
        try:
            ds = load_dataset(repo, config, split="train", streaming=True, revision=rev)
            for r in ds:
                scanned += 1
                rows += [x for x in v1_tool_rows(r) if x["split"] == "train"]
                if len(rows) >= train or (limit_rows and scanned >= limit_rows):
                    break
        except Exception as exc:                                   # a config that cannot be read must not lose the others
            print(f"config {config} skipped: {type(exc).__name__}: {str(exc)[:120]}", flush=True)
        if len(rows) >= train:
            break
    return {"stage": "v1tools", "revision": rev, "scanned_traces": scanned, "files": [_write(os.path.join(out, "agent_traces_v1.jsonl.gz"), rows[:train])]}

def build_loop(out: str, train: int, heldout: int, limit_rows: int = 0) -> dict:
    from datasets import load_dataset
    repo = "openbmb/UltraData-SFT-Agent-2609"
    rev = _revision(repo)
    rows = {"train": [], "heldout": []}
    want = {"train": train, "heldout": heldout}
    scanned = 0
    for config in ("Code-Agent", "General-Agent"):
        ds = load_dataset(repo, config, split="train", streaming=True, revision=rev)
        for r in ds:
            scanned += 1
            for rec in loop_rows(r):
                if len(rows[rec["split"]]) < want[rec["split"]]:
                    rows[rec["split"]].append(rec)
            if all(len(rows[k]) >= want[k] for k in want) or (limit_rows and scanned >= limit_rows):
                break
        if all(len(rows[k]) >= want[k] for k in want):
            break
    assert not ({r["trace_id"] for r in rows["train"]} & {r["trace_id"] for r in rows["heldout"]}), "a trace must not be in both splits"
    return {"stage": "loop", "revision": rev, "license": "apache-2.0 (dataset); assistant turns written by a commercial model (owner accepted 2026-11-21)", "scanned_traces": scanned,
            "files": [_write(os.path.join(out, "ultradata_loop_train.jsonl.gz"), rows["train"]), _write(os.path.join(out, "ultradata_loop_heldout.jsonl.gz"), rows["heldout"])]}


def _selftest() -> None:
    ar = " ".join(f"هذه الجملة رقم {i} تصف حال المدينة في الصباح الباكر." for i in range(60))
    recs = arabic_records("doc-1", ar, "rev", "arb_Arab")
    assert 1 <= len(recs) <= 2 and all(r["split"] == split_of("doc-1") and r["language"] == "ar" for r in recs)
    assert recs[0]["target"] and recs[0]["prompt"] != recs[0]["target"]
    assert arabic_records("d", "english only text " * 60, "rev") == []                   # not Arabic: dropped
    assert arabic_records("d", ar[:100], "rev") == []                                      # too short: dropped
    assert len({split_of(f"d{i}") for i in range(200)}) == 2 and 5 < sum(split_of(f"d{i}") == "heldout" for i in range(500)) < 120
    row = {"uuid": "T1", "messages": [{"role": "system", "content": "s"}, {"role": "user", "content": "fix the bug in /app"},
           {"role": "assistant", "content": "", "tool_calls": [{"type": "function", "function": {"name": "shell", "arguments": {"command": ["ls", "-la"]}}}]},
           {"role": "tool", "content": "Execution output of [shell]:\n[STDOUT]\nfile.py"},
           {"role": "assistant", "content": "", "tool_calls": [{"type": "function", "function": {"name": "read_file", "arguments": {"file_path": "/app/f.py"}}}]},
           {"role": "tool", "content": "x"},
           {"role": "assistant", "content": "", "tool_calls": [{"type": "function", "function": {"name": "shell", "arguments": "{\"command\": \"python3 f.py\"}"}}]},
           {"role": "tool", "content": "Execution output of [shell]:\n[STDOUT]\nok"}]}
    t = tools_records(row, "rev", "Code-Agent")
    assert [json.loads(r["target"])["arguments"]["command"] for r in t] == ["ls -la", "python3 f.py"], t
    assert all(r["tool_name"] == "computer_run" and r["approval"] == "not_recorded" and "ok" in t[1]["tool_result"]["stdout"] for r in t[1:]) and "file.py" in t[0]["tool_result"]["stdout"]
    assert t[1]["prompt"].startswith("المهمة:") and "computer_run: ls -la" in t[1]["prompt"]
    assert tools_records({"uuid": "", "messages": row["messages"]}, "r", "c") == []
    lr = loop_rows(row)
    assert [r["cmd"] for r in lr] == ["ls -la", "python3 f.py"] and lr[0]["hist"] == [] and lr[1]["hist"][0][0] == "ls -la" and "file.py" in lr[1]["hist"][0][1], lr
    assert lr[1]["task"].startswith("fix the bug") and loop_rows({"uuid": "x", "messages": [{"role": "user", "content": "t"}, {"role": "assistant", "tool_calls": [{"function": {"name": "shell", "arguments": {"command": "x" * 200}}}]}, {"role": "tool", "content": "r"}]}) == []
    print("sham2_snapshots self-test OK")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("stage", nargs="?", choices=["arabic", "tools", "loop", "v1tools"])
    ap.add_argument("--out", default="sham2_snapshot")
    ap.add_argument("--train", type=int, default=0)
    ap.add_argument("--heldout", type=int, default=0)
    ap.add_argument("--limit", type=int, default=0, help="stop after this many source rows (smoke runs)")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest or not a.stage:
        _selftest()
        return 0
    os.makedirs(a.out, exist_ok=True)
    t0 = time.time()
    if a.stage == "arabic":
        part = build_arabic(a.out, a.train or 12000, a.heldout or 1200, a.limit)
    elif a.stage == "v1tools":
        part = build_v1tools(a.out, a.train or 3000, a.limit)

    elif a.stage == "loop":
        part = build_loop(a.out, a.train or 4000, a.heldout or 400, a.limit)
    else:
        part = build_tools(a.out, a.train or 6000, a.heldout or 600, a.limit)
    part["seconds"] = round(time.time() - t0, 1)
    mp = os.path.join(a.out, f"manifest_{a.stage}.json")
    json.dump(part, open(mp, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(json.dumps({k: v for k, v in part.items() if k != "contract_gaps"}, ensure_ascii=False), flush=True)
    os._exit(0)             # the streaming reader's background threads can keep the interpreter alive after the files are written


if __name__ == "__main__":
    sys.exit(main())
