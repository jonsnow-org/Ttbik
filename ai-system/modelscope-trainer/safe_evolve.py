"""Optional loop self-evolution for the Studio trainer: LoRA on verified failures, ALWAYS mixed with replay,
with a hold-out of previously-correct tasks. An adapter is kept only when held-out eval and the
previously-correct set do not regress.

The audit of lora_failed (2026-11-18): the self-evolution arm produced 0 verified pairs, and a LoRA
trained without replay dropped the previously-correct set from 1.0 to 0.182. This wrapper never
promotes a no-replay adapter.

Commercial path (not wired to live traffic yet): Sham 2 should learn from every user, so this step is
built to ingest verified execution results from all users' sessions. Records must be anonymized first
(no personal data: no user/session ids, emails, IPs, raw chat outside the task/result). Session pairs
are only an extra source; they still go through replay + the no-regress gate before any adapter is kept.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path


# Only these fields may enter training. Anything else (user_id, session_id, email, ip, name, raw chat, ...) is dropped.
VERIFIED_KEYS = ("task", "ref_reply", "ref_snap", "steps")


def _rate(block, *keys):
    if isinstance(block, (int, float)):
        return float(block)
    if not isinstance(block, dict):
        return None
    for k in keys:
        if isinstance(block.get(k), (int, float)):
            return float(block[k])
    return None


def no_regress(before: dict, after: dict) -> tuple[bool, str]:
    """True when held-out episode_success and previously-correct (C) rate are both >= the baseline."""
    b_hold = _rate(before.get("eval60_778") or before.get("heldout"), "episode_success", "same_effect")
    a_hold = _rate(after.get("eval60_778") or after.get("heldout"), "episode_success", "same_effect")
    b_c = _rate(before.get("C"), "rate")
    a_c = _rate(after.get("C"), "rate")
    if b_hold is None or a_hold is None or b_c is None or a_c is None:
        return False, "missing held-out or previously-correct score"
    if a_hold < b_hold:
        return False, f"held-out regress {b_hold} -> {a_hold}"
    if a_c < b_c:
        return False, f"previously-correct regress {b_c} -> {a_c}"
    return True, "held-out and previously-correct did not regress"


def anonymize_record(record: dict) -> dict | None:
    """Keep only the task and the verified execution. Reject unverified or incomplete rows.
    Future commercial session sources must pass through this; live user data is not wired yet."""
    if not isinstance(record, dict):
        return None
    if record.get("verified") is False:
        return None
    out = {k: record[k] for k in VERIFIED_KEYS if k in record}
    if "task" not in out:
        return None
    if "ref_reply" not in out and not out.get("steps"):
        return None
    return out


def load_session_pairs(path: Path | None = None) -> list[dict]:
    """Optional jsonl of already-verified session results (SHAM_TLDM_SESSION_PAIRS).
    Not connected to live traffic. Each line is anonymized; unverified or personal-only rows are skipped."""
    raw = path if path is not None else Path(os.environ.get("SHAM_TLDM_SESSION_PAIRS") or "")
    if not raw or not Path(raw).is_file():
        return []
    out: list[dict] = []
    for line in Path(raw).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        cleaned = anonymize_record(rec)
        if cleaned:
            out.append(cleaned)
    return out


def encode_session_pairs(records: list[dict], tok, cfg) -> list:
    """Turn anonymized session records into supervised (input, target) pairs. Only verified execution steps are used."""
    out = []
    block = cfg["block"]
    for rec in records:
        for step in rec.get("steps") or []:
            if not isinstance(step, (list, tuple)) or len(step) < 2:
                continue
            v, t = step[0], step[1]
            out.append((v, tok.encode(t, block) if isinstance(t, str) else t))
    return out


def run_safe_evolve(root: Path, work: Path, loop_ckpt: Path, seed: int, runner=None) -> dict:
    """Train a replay-mixed LoRA on verified failures (plus optional anonymized session pairs).
    Writes the adapter only when no_regress is True. When runner is set (self-test), no tldm imports."""
    out_json = work / "logs" / f"safe_evolve_seed{seed}.json"
    adapter = work / "checkpoints" / "loop" / f"safe_evolve_seed{seed}.pt"
    report = {"seed": int(seed), "ckpt": str(loop_ckpt), "kept": False, "reason": ""}
    if runner is not None:
        return runner(arm="safe_evolve", ckpt=loop_ckpt, seed=seed, work=work, report=out_json, adapter=adapter) or report

    sys.path.insert(0, str(root / "training"))
    sys.path.insert(0, str(root / "scripts"))
    sys.path.insert(0, str(root / "memory"))
    import torch
    from sham_tldm import from_state
    import trajectories as J
    from self_evolution import save_adapter
    from train_loop import evaluate
    from lora_failed import fresh_model, play, pools, score, train_lora

    ck = torch.load(loop_ckpt, map_location="cpu")
    cfg, tok = ck["cfg"], from_state(ck.get("tokenizer", {"kind": "byte"}))
    base = fresh_model(ck)
    pool = int(os.environ.get("SHAM_TLDM_LORA_POOL") or 300)
    tries = int(os.environ.get("SHAM_TLDM_LORA_TRIES") or 8)
    lora_steps = int(os.environ.get("SHAM_TLDM_LORA_STEPS") or 200)
    replay_n = int(os.environ.get("SHAM_TLDM_LORA_REPLAY") or 150)
    rank = int(os.environ.get("SHAM_TLDM_LORA_RANK") or 4)
    A, B, C = pools(base, cfg, tok, pool, seed=seed)
    before = {"A": score(base, cfg, tok, A), "B": score(base, cfg, tok, B), "C": score(base, cfg, tok, C),
              "eval60_778": evaluate(base, cfg, tok, 60, seed=778, new_names=True)}
    report["pool"] = {"A_failed": len(A), "B_failed": len(B), "C_right": len(C)}
    report["before"] = before
    print("safe_evolve before:", before, flush=True)

    pairs = []
    fixed = 0
    for e in A:
        for k in range(tries):
            torch.manual_seed(seed * 1000 + fixed * 10 + k)
            reply, snap, steps = play(base, cfg, tok, e["task"], temperature=0.8)
            if reply == e["ref_reply"] and snap == e["ref_snap"]:
                fixed += 1
                pairs += [(v, tok.encode(t, cfg["block"])) for v, t in steps]
                break
    session = load_session_pairs()
    session_pairs = encode_session_pairs(session, tok, cfg)
    pairs = pairs + session_pairs
    report["verified_pairs"] = len(pairs)
    report["verified_failures"] = fixed
    report["session_records"] = len(session)
    report["session_pairs"] = len(session_pairs)
    if not pairs:
        report["reason"] = "no verified successes among retries (nothing safe to learn); adapter not kept"
        out_json.parent.mkdir(parents=True, exist_ok=True)
        out_json.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
        print("safe_evolve:", report["reason"], flush=True)
        return report

    xs, ys = J.make_dataset(replay_n, 1, tok, cfg["in_len"], cfg["block"], delex=cfg.get("delex", False))
    replay = list(zip(xs, ys))
    # Always mix replay with the verified pairs (the no-replay arm is what dropped C 1.0 -> 0.182). Session
    # pairs are never trained alone: they join the same mix and still have to pass no_regress.
    data = pairs * max(1, len(replay) // max(1, len(pairs))) + replay
    model = fresh_model(ck)
    n_lora = train_lora(model, data, lora_steps, rank, seed)
    after = {"A": score(model, cfg, tok, A), "B": score(model, cfg, tok, B), "C": score(model, cfg, tok, C),
             "eval60_778": evaluate(model, cfg, tok, 60, seed=778, new_names=True)}
    report["after"] = after
    report["lora_params"] = n_lora
    report["training_pairs"] = len(data)
    report["replay"] = len(replay)
    ok, reason = no_regress(before, after)
    report["kept"] = ok
    report["reason"] = reason
    if ok:
        adapter.parent.mkdir(parents=True, exist_ok=True)
        save_adapter(model, str(adapter))
        report["adapter"] = str(adapter)
    print("safe_evolve after:", after, "kept=", ok, reason, flush=True)
    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    return report


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        before = {"C": {"rate": 1.0}, "eval60_778": {"episode_success": 0.8}}
        assert no_regress(before, {"C": {"rate": 1.0}, "eval60_778": {"episode_success": 0.8}})[0]
        assert not no_regress(before, {"C": {"rate": 0.182}, "eval60_778": {"episode_success": 0.8}})[0]
        assert not no_regress(before, {"C": {"rate": 1.0}, "eval60_778": {"episode_success": 0.7}})[0]
        cleaned = anonymize_record({"task": "t", "ref_reply": "ok", "ref_snap": "s", "steps": [[0, "ok"]],
                                    "user_id": "u1", "email": "a@b.c", "session_id": "s1", "ip": "1.2.3.4", "verified": True})
        assert cleaned == {"task": "t", "ref_reply": "ok", "ref_snap": "s", "steps": [[0, "ok"]]}
        assert anonymize_record({"task": "t", "user_id": "u1", "verified": False}) is None
        import tempfile
        sess = Path(tempfile.mkdtemp()) / "sessions.jsonl"
        sess.write_text(json.dumps({"task": "t", "ref_reply": "ok", "steps": [[0, "ok"]], "user_id": "u1", "verified": True}) + "\n", encoding="utf-8")
        loaded = load_session_pairs(sess)
        assert loaded == [{"task": "t", "ref_reply": "ok", "steps": [[0, "ok"]]}] and "user_id" not in loaded[0]
        print("safe_evolve self-test OK")
        raise SystemExit(0)
    raise SystemExit("safe_evolve.py is imported by the Studio trainer (pass --selftest)")
