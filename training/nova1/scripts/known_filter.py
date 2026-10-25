"""Leaves out of the training mix the rows the base model already knows, so training time goes to what it does not.

Each row is scored with the base model (Qwen/Qwen3.5-4B, fp16, one forward pass, no generation): the score is the mean negative
log-likelihood, in nats per token, of the row's last assistant turn given everything before it. A low score means the base model
already writes that answer nearly token for token; such a row teaches it little. Settings: `known_filter` in datasets.yaml.

Two steps, so the GPU part can run on both T4s of a Kaggle "T4 x2" machine and so that any failure leaves the mix usable:

    # one process per GPU; each scores every n-th row and writes its scores as it goes
    CUDA_VISIBLE_DEVICES=0 python scripts/known_filter.py score data/mix.jsonl --shard 0/2 --scores data/known.0.jsonl &
    CUDA_VISIBLE_DEVICES=1 python scripts/known_filter.py score data/mix.jsonl --shard 1/2 --scores data/known.1.jsonl &
    wait
    # CPU only: drops known rows (per-source cap), cuts the mix to target_tokens, prints and writes the per-source counts
    python scripts/known_filter.py select data/mix.jsonl --scores data/known.*.jsonl --out data/mix.filtered.jsonl --report known_report.json

Rows that were not scored (time cap reached, a row the chat template could not render, a scoring error) are kept. `select` with no
score files at all still applies the target_tokens cut, so the mix size stays what the training budget expects.
"""
import argparse
import glob
import json
import random
import sys
import time
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent.parent
DEFAULTS = {"enabled": True, "threshold": 0.30, "max_minutes": 45, "max_skip_share": 0.85, "exempt": ["identity"],
            "score_tokens": 2048, "batch_tokens": 12288, "target_tokens": 20_000_000}
ANSWER_MARK = "<|im_start|>assistant\n"
EMPTY_THINK = "<think>\n\n</think>\n\n"


def settings() -> dict:
    plan = yaml.safe_load((HERE / "datasets.yaml").read_text())
    return {**DEFAULTS, **(plan.get("known_filter") or {}), "base_model": plan["base_model"]["id"]}


def approx_tokens(row: dict) -> int:          # same estimate as build_mix.py (~4 characters per token)
    return sum(len(m.get("content") or "") for m in row["messages"]) // 4


# ------------------------------------------------------------------------------------------------------------- score
def render(tok, row: dict, max_tokens: int):
    """Token ids of the row and the index where its last assistant turn starts; None when the template cannot render it."""
    msgs = []
    for m in row["messages"]:
        if m.get("tool_calls"):         # the Qwen3.5 template wants arguments as a mapping; rows carry them as JSON text
            m = {**m, "tool_calls": [{**c, "function": {**c["function"], "arguments": json.loads(c["function"]["arguments"])
                                      if isinstance(c["function"].get("arguments"), str) else c["function"].get("arguments")}}
                                     for c in m["tool_calls"]]}
        msgs.append(m)
    text = tok.apply_chat_template(msgs, tools=row.get("tools"), tokenize=False)
    cut = text.rfind(ANSWER_MARK)
    if cut < 0:
        return None
    cut += len(ANSWER_MARK)
    if text.startswith(EMPTY_THINK, cut):      # the template's empty thinking block is not part of the answer
        cut += len(EMPTY_THINK)
    prompt = tok(text[:cut], add_special_tokens=False)["input_ids"]
    answer = tok(text[cut:], add_special_tokens=False)["input_ids"]
    if len(answer) < 2:
        return None
    answer = answer[: max_tokens - min(len(prompt), 512)]  # a long answer is scored on its first part (at least 512 prompt tokens stay)
    prompt = prompt[-(max_tokens - len(answer)):]          # the prompt is cut from the left
    return prompt + answer, len(prompt)


def score(a) -> int:
    import torch
    import torch.nn.functional as F
    from transformers import AutoModelForCausalLM, AutoTokenizer

    S = settings()
    t0 = time.time()
    k, n = (int(x) for x in a.shard.split("/"))
    exempt = set(S["exempt"])
    rows = []
    with open(a.mix) as f:
        for i, line in enumerate(f):
            if i % n != k:
                continue
            r = json.loads(line)
            if r.get("source") not in exempt:
                rows.append((i, r))
    random.Random(3407 + k).shuffle(rows)       # a time cap then cuts every source by about the same share
    if a.max_rows:
        rows = rows[: a.max_rows]
    tok = AutoTokenizer.from_pretrained(S["base_model"])     # the base model's chat template, also when --model is a small test model
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    model = AutoModelForCausalLM.from_pretrained(a.model or S["base_model"], dtype=torch.float16 if dev == "cuda" else torch.float32).to(dev)
    model.eval()
    head = model.get_output_embeddings()
    pad = tok.pad_token_id if tok.pad_token_id is not None else 0
    print(f"[shard {k}/{n}] {len(rows)} rows to score; model loaded in {time.time() - t0:.0f}s", flush=True)
    out = open(a.scores, "a")
    deadline = t0 + 60 * float(S["max_minutes"])
    use_hidden = None        # whether the last hidden state times the output head reproduces the model's logits (checked once)
    done = failed = 0
    for c0 in range(0, len(rows), 2000):
        chunk = []
        for i, r in rows[c0:c0 + 2000]:
            try:
                x = render(tok, r, int(S["score_tokens"]))
            except Exception:
                x = None
            if x is None:
                failed += 1
            else:
                chunk.append((i, *x))
        chunk.sort(key=lambda t: len(t[1]))
        b = 0
        while b < len(chunk):
            if time.time() > deadline:
                print(f"[shard {k}/{n}] time cap reached: {done} scored, {len(rows) - done - failed} left unscored (kept)", flush=True)
                out.close()
                return 0
            budget = int(S["batch_tokens"]) if use_hidden is not False else max(1024, int(S["batch_tokens"]) // 6)
            e = b + 1
            while e < len(chunk) and len(chunk[e][1]) * (e + 1 - b) <= budget:
                e += 1
            batch = chunk[b:e]
            b = e
            L = len(batch[-1][1])
            ids = torch.full((len(batch), L), pad, dtype=torch.long)
            att = torch.zeros((len(batch), L), dtype=torch.long)
            for j, (_, seq, _) in enumerate(batch):
                ids[j, : len(seq)] = torch.tensor(seq)
                att[j, : len(seq)] = 1
            ids, att = ids.to(dev), att.to(dev)
            try:
                with torch.no_grad():
                    if use_hidden is not False:
                        o = model(input_ids=ids, attention_mask=att, output_hidden_states=True, logits_to_keep=1)
                        hid = o.hidden_states[-1]
                        if use_hidden is None:
                            ref = o.logits[-1, -1].float()
                            mine = head(hid[-1, -1:]).float()[0]
                            use_hidden = bool(torch.allclose(ref, mine, atol=0.05 * float(ref.abs().max()) + 1e-3))
                            print(f"[shard {k}/{n}] scoring from hidden states: {use_hidden}", flush=True)
                            if not use_hidden:
                                b -= len(batch)
                                continue
                    else:
                        hid = None
                        logits = model(input_ids=ids, attention_mask=att).logits
                    for j, (i, seq, start) in enumerate(batch):
                        tgt = ids[j, start:len(seq)]
                        if hid is not None:
                            lg = torch.cat([head(h).float() for h in hid[j, start - 1:len(seq) - 1].split(512)])
                        else:
                            lg = logits[j, start - 1:len(seq) - 1].float()
                        nll = F.cross_entropy(lg, tgt).item()
                        out.write(json.dumps({"i": i, "nll": round(nll, 4), "n": int(len(seq) - start)}) + "\n")
                        done += 1
                out.flush()
            except torch.cuda.OutOfMemoryError:
                torch.cuda.empty_cache()
                S["batch_tokens"] = max(2048, int(S["batch_tokens"]) // 2)
                print(f"[shard {k}/{n}] out of memory; batch_tokens -> {S['batch_tokens']}", flush=True)
                b -= len(batch)
                if S["batch_tokens"] == 2048 and len(batch) == 1:
                    b += 1          # one row alone does not fit: left unscored (kept)
            except Exception as ex:   # anything else: these rows stay unscored (kept)
                failed += len(batch)
                print(f"[shard {k}/{n}] batch skipped: {type(ex).__name__}: {str(ex)[:160]}", flush=True)
        if done and (c0 // 2000) % 5 == 0:
            print(f"[shard {k}/{n}] {done} scored, {(time.time() - t0) / 60:.1f} min", flush=True)
    out.close()
    print(f"[shard {k}/{n}] finished: {done} scored, {failed} not scorable (kept), {(time.time() - t0) / 60:.1f} min", flush=True)
    return 0


# ------------------------------------------------------------------------------------------------------------ select
def select(a) -> int:
    S = settings()
    exempt = set(S["exempt"])
    scores = {}
    for pattern in a.scores:
        for p in glob.glob(pattern):
            with open(p) as f:
                for line in f:
                    try:
                        d = json.loads(line)
                        scores[int(d["i"])] = float(d["nll"])
                    except (ValueError, KeyError):
                        continue        # a last line cut short
    rows, src, size = [], [], []
    with open(a.mix) as f:
        for line in f:
            r = json.loads(line)
            rows.append(line)
            src.append(r.get("source", "?"))
            size.append(approx_tokens(r))
    keep = [True] * len(rows)
    why = [""] * len(rows)
    stats = {}
    for i, s in enumerate(src):
        st = stats.setdefault(s, {"rows": 0, "scored": 0, "skipped_known": 0, "trimmed": 0, "kept": 0, "kept_tokens": 0, "nll": []})
        st["rows"] += 1
        if i in scores:
            st["scored"] += 1
            st["nll"].append(scores[i])
    # 1) rows the base model already knows, lowest loss first, at most max_skip_share of each source
    thr = float(S["threshold"])
    for s, st in stats.items():
        if s in exempt:
            continue
        known = sorted((scores[i], i) for i in range(len(rows)) if src[i] == s and i in scores and scores[i] < thr)
        for _, i in known[: int(float(S["max_skip_share"]) * st["rows"])]:
            keep[i], why[i] = False, "known"
            st["skipped_known"] += 1
    # 2) the token target: lowest-loss scored rows go next, then unscored rows at random (exempt sources untouched)
    total = sum(size[i] for i in range(len(rows)) if keep[i])
    target = int(a.target_tokens or S["target_tokens"])
    if total > target:
        order = sorted((scores[i], i) for i in range(len(rows)) if keep[i] and i in scores and src[i] not in exempt)
        rest = [i for i in range(len(rows)) if keep[i] and i not in scores and src[i] not in exempt]
        random.Random(3407).shuffle(rest)
        for i in [i for _, i in order] + rest:
            if total <= target:
                break
            keep[i], why[i] = False, "trimmed"
            stats[src[i]]["trimmed"] += 1
            total -= size[i]
    with open(a.out, "w") as f:
        for i, line in enumerate(rows):
            if keep[i]:
                f.write(line)
                stats[src[i]]["kept"] += 1
                stats[src[i]]["kept_tokens"] += size[i]
    report = {"threshold": thr, "target_tokens": target, "scored_rows": len(scores), "rows_in": len(rows),
              "rows_out": sum(keep), "tokens_out": total, "sources": {}}
    print(f"{'source':18s} {'rows':>8s} {'scored':>8s} {'known':>8s} {'trimmed':>8s} {'kept':>8s} {'kept_tok':>12s} {'median_nll':>10s}")
    for s, st in stats.items():
        nll = sorted(st.pop("nll"))
        st["median_nll"] = round(nll[len(nll) // 2], 3) if nll else None
        report["sources"][s] = st
        print(f"{s:18s} {st['rows']:>8,} {st['scored']:>8,} {st['skipped_known']:>8,} {st['trimmed']:>8,} {st['kept']:>8,} "
              f"{st['kept_tokens']:>12,} {str(st['median_nll']):>10s}")
    print(f"total: {len(rows):,} rows in, {sum(keep):,} out, ~{total:,} tokens")
    if a.report:
        Path(a.report).write_text(json.dumps(report, indent=1))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("score")
    p.add_argument("mix")
    p.add_argument("--scores", required=True)
    p.add_argument("--shard", default="0/1")
    p.add_argument("--model", default="", help="score with another model (default: base_model in datasets.yaml)")
    p.add_argument("--max-rows", type=int, default=0, help="score at most this many rows (smoke tests)")
    p = sub.add_parser("select")
    p.add_argument("mix")
    p.add_argument("--scores", nargs="*", default=[])
    p.add_argument("--out", required=True)
    p.add_argument("--report", default="")
    p.add_argument("--target-tokens", type=int, default=0)
    a = ap.parse_args()
    return score(a) if a.cmd == "score" else select(a)


if __name__ == "__main__":
    sys.exit(main())
