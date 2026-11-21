#!/usr/bin/env python3
"""Web learning that passes the no-regression gate (2026-11-18). Which TRAINING recipe lets web data in and improves the frozen held-out sets?

  TLDM_DONOR=<MiniLM dir> python eval/web_learning_benchmark.py --ckpt d_S.pt --train-seed S --json out.json [--webcache dir --offline]

Web set: tldr-pages EN/AR (CC-BY-4.0) + cheat/cheatsheets (CC0-1.0) + awesome-cheatsheets (MIT); Stack Exchange is fetched and rejected (CC BY-SA). Every pair:
permissive licence, injection screen, PII scrub, dedup, decontaminated against held-out 1+2, the full-task benchmark and the dev set, and RUN in the sandbox.
Arms (each: one adapter per task family, each family gated on its own; the gate = no net loss and <= 2% lost items on previously-correct training rows
and on the dev set, plus a gain on the family's web rows). The gate never sees the held-out sets; they are reported only."""
import argparse
import importlib.util
import json
import os
import random
import sys
import time
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, "..", "scripts"), os.path.join(HERE, "..", "evolution")]
from common import ROOT  # noqa: E402
import torch  # noqa: E402
from sham_tldm import from_state  # noqa: E402
import terminal_tasks as T  # noqa: E402
import rewordings as RW  # noqa: E402
import trajectories as J  # noqa: E402
import adapters as AD  # noqa: E402
import curriculum as CU  # noqa: E402
import engine as EN  # noqa: E402
import experience as EX  # noqa: E402
import web_learning as WL  # noqa: E402
import web_training as WT  # noqa: E402

_s = importlib.util.spec_from_file_location("train_03b", os.path.join(ROOT, "training", "train_0.3b.py"))
_m = importlib.util.module_from_spec(_s)
_s.loader.exec_module(_m)

ARMS = {   # an arm = stages; a stage = (which web rows, adapter prefix, mode, training recipe). "known" = rows whose command template (arguments as slots)
           # is one the model was trained on (new wordings for known commands); "new" = new commands/options (new knowledge). Chosen from TRAINING data only.
    "tiered": [("known", "kn_", "global", dict(ratio=3, lr=5e-4, steps=150)), ("new", "web_", "routed", dict(ratio=1, lr=1e-3, steps=300))],
    # tiered_l2 with BOTH tiers routed: the known-wording adapters "kn_<family>" are applied only to requests whose nearest examples are known-tier web
    # rows (never to a whole family), "web_<family>" only near new-tier web rows. Measured 2026-11-18: global kn_ adapters passed the gate yet cost held-out
    # items on 2 of 6 runs (the gate never sees held-out); routing them removes that.
    "tiered_l2_routed": {"mode": "routed_tiers", "stages": [("known", "kn_", "routed", dict(ratio=3, lr=5e-4, steps=150, l2=0.1)),
                                                             ("new", "web_", "routed", dict(ratio=1, lr=1e-3, steps=300))]},
    "tiered_l2": [("known", "kn_", "global", dict(ratio=3, lr=5e-4, steps=150, l2=0.1)), ("new", "web_", "routed", dict(ratio=1, lr=1e-3, steps=300))],
    "tiered_known_strong_l2": [("known", "kn_", "global", dict(ratio=2, lr=1e-3, steps=300, l2=0.1)), ("new", "web_", "routed", dict(ratio=1, lr=1e-3, steps=300))],
    "known_only_global": [("known", "kn_", "global", dict(ratio=3, lr=5e-4, steps=150))],
    "routed_strong_all": [("all", "web_", "routed", dict(ratio=1, lr=1e-3, steps=300))],
    "all_global_replay3_150": [("all", "kn_", "global", dict(ratio=3, lr=5e-4, steps=150))],
    "old_1to1_lr1e-3_120": dict(mode="global", ratio=1, lr=1e-3, steps=120),
    "replay3_lr5e-4_60": dict(mode="global", ratio=3, lr=5e-4, steps=60),
    "replay3_l2": dict(mode="global", ratio=3, lr=5e-4, steps=60, l2=1.0),
    "replay3_curriculum": dict(mode="global", ratio=3, lr=5e-4, steps=60, order="curriculum"),
    "replay3_merge0.5": dict(mode="global", ratio=3, lr=5e-4, steps=60, scale=0.5),
    "routed_web_family": dict(mode="routed", ratio=3, lr=5e-4, steps=60),
    "routed_l2_curriculum": dict(mode="routed", ratio=3, lr=5e-4, steps=60, l2=1.0, order="curriculum"),
    "routed_merge0.5": dict(mode="routed", ratio=3, lr=5e-4, steps=60, scale=0.5),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--train-seed", type=int, default=0)
    ap.add_argument("--arms", default=",".join(ARMS))
    ap.add_argument("--webcache", default=os.path.join(ROOT, "checkpoints", "webcache"))
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--json", default="")
    a = ap.parse_args()
    t0 = time.time()
    torch.manual_seed(a.train_seed)
    ck = torch.load(a.ckpt, map_location="cpu")
    cfg, tok = ck["cfg"], from_state(ck["tokenizer"])
    model = _m.build(cfg)
    model.load_state_dict(ck["model"], strict=False)
    model.eval()
    AD.wrap(model)
    P = CU.WriterPolicy(model, cfg, tok)
    ex = EN.CachedExecutor(T)
    held1, held2 = list(T.HELDOUT), list(RW.HELDOUT2)
    rng = random.Random(778)
    bench = [J.make_episode(rng, True)[0] for _ in range(60)]
    replay = [(t, c) for t, c in list(T.TRAIN) + RW.generate(seed=a.train_seed, per_command=int(cfg.get("rewordings_per_command", 24))) if P.fits(c)]
    rng = random.Random(999)                                         # the same dev set as eval/self_evolution_benchmark.py
    dev_rows = rng.sample(RW.generate(seed=999, per_command=40), 120)
    dev_rows += [(v, c) for t, c in rng.sample(dev_rows, 30) for v in CU.variants(t, rng, 1, RW.too_close)]
    replay150 = random.Random(a.train_seed).sample(replay, 150)

    # ---- the web set (the model's own gaps drive the queries)
    base_dev = P.commands([t for t, _ in dev_rows])
    fails = [(t, o, c) for (t, c), o in zip(dev_rows, base_dev) if not ex.same_effect(c, o)]
    gaps = WL.knowledge_gaps(fails, {c.split()[0] for _, c in T.TRAIN})
    fetcher = WL.WebFetcher(a.webcache, offline=a.offline)
    pages = fetcher.fetch_sources(list(dict.fromkeys(gaps + WL.SANDBOX_COMMANDS)), se_queries=3)     # failure-driven first, then every sandbox command
    cands = WL.extract(pages)
    kept, filt = WL.verify_and_filter(cands, [t for t, _ in held1 + held2] + bench + [t for t, _ in dev_rows], block_fits=P.fits)
    web = [(k["task"], k["command"], k["family"]) for k in kept]
    print(f"web set: {len(web)} pairs from {len(pages)} pages; filter {filt}", flush=True)

    import augment as AUG
    known_tpl = {AUG.delex(t, c)[1] for t, c in replay}
    tier = {(t, c): ("known" if AUG.delex(t, c)[1] in known_tpl else "new") for t, c, _ in web}
    print("web tiers:", {k: sum(1 for v in tier.values() if v == k) for k in ("known", "new")}, flush=True)
    fam_router = AD.Router(lambda texts: _embed(model, texts))
    fam_router.fit([t for t, _ in replay] + [t for t, _, _ in web], [EX.family(c) for _, c in replay] + [f for _, _, f in web])
    web_router = WT.WebRouter(lambda texts: _embed(model, texts))
    web_router.fit([t for t, _ in replay], [t for t, _, _ in web], [f for _, _, f in web])
    web_router_new = WT.WebRouter(lambda texts: _embed(model, texts))
    newrows = [w for w in web if tier[w[:2]] == "new"]
    web_router_new.fit([t for t, _ in replay] + [t for t, c, _ in web if tier[(t, c)] == "known"], [t for t, _, _ in newrows], [f for _, _, f in newrows])
    tier_router = WT.WebRouter(lambda texts: _embed(model, texts))
    tier_router.fit([t for t, _ in replay], [t for t, _, _ in web], [("kn_" if tier[(t, c)] == "known" else "web_") + f for t, c, f in web], prefix="")

    def outputs(tasks, accepted: set, mode: str):
        if not accepted:
            names = [None] * len(tasks)
        elif mode == "routed_tiers":
            names = [n if n in accepted else None for n in tier_router.route(tasks)]
        elif mode in ("global", "routed"):
            names = ["web_" + f for f, _ in fam_router.route(tasks)] if mode == "global" else web_router.route(tasks)
            names = [n if n in accepted else None for n in names]
        else:                                                       # "tiered": the routed new-knowledge adapter first, else the family adapter
            wr = web_router if mode == "tiered_all" else web_router_new
            r = wr.route(tasks) if any(n.startswith("web_") for n in accepted) else [None] * len(tasks)
            g = ["kn_" + f for f, _ in fam_router.route(tasks)] if any(n.startswith("kn_") for n in accepted) else [None] * len(tasks)
            names = [x if x in accepted else (y if y in accepted else None) for x, y in zip(r, g)]
        out, groups = [None] * len(tasks), defaultdict(list)
        for i, n in enumerate(names):
            groups[n].append(i)
        for n, idx in groups.items():
            AD.set_active(model, n)
            for i, c in zip(idx, P.commands([tasks[i] for i in idx])):
                out[i] = c
        AD.set_active(model, None)
        return out, sum(1 for n in names if n)

    def items(rows, accepted, mode):
        outs, _ = outputs([t for t, _ in rows], accepted, mode)
        return {i: ex.same_effect(c, o) for i, ((t, c), o) in enumerate(zip(rows, outs))}

    def report(accepted, mode):
        r = {}
        for name, rows in (("heldout", held1), ("heldout2", held2), ("train30", T.TRAIN), ("replay150", replay150), ("dev", dev_rows), ("web", [(t, c) for t, c, _ in web]),
                           ("web_known", [(t, c) for t, c, _ in web if tier[(t, c)] == "known"]), ("web_new", [(t, c) for t, c, _ in web if tier[(t, c)] == "new"])):
            if not rows:
                continue
            d = items(rows, accepted, mode)
            r[name] = round(sum(d.values()) / len(d), 3)
        r["heldout_routed_to_web"] = outputs([t for t, _ in held1 + held2], accepted, mode)[1]
        return r

    prev_items = items(replay150, set(), "global")
    prev_rows = [r for i, r in enumerate(replay150) if prev_items[i]]
    res = {"ckpt": os.path.basename(a.ckpt), "train_seed": a.train_seed, "web": {"pairs": len(web), "pages": len(pages), "filter": filt,
           "by_source": {s: sum(1 for k in kept if k["source"] == s) for s in sorted({k["source"] for k in kept})},
           "licences": sorted({k["license"] for k in kept}), "examples": [(k["task"], k["command"], k["source"]) for k in kept[:12]]},
           "base": report(set(), "global"), "arms": {}}
    print("base", res["base"], flush=True)
    fams = sorted({f for _, _, f in web}, key=lambda f: -sum(1 for w in web if w[2] == f))
    for arm in a.arms.split(","):
        spec = ARMS[arm]
        if isinstance(spec, dict) and "stages" in spec:
            stages, mode = spec["stages"], spec["mode"]
        else:
            stages = spec if isinstance(spec, list) else [("all", "web_", spec["mode"], {k: v for k, v in spec.items() if k != "mode"})]
            mode = ("tiered_all" if any(st[0] == "all" for st in stages) else "tiered") if isinstance(spec, list) else stages[0][2]
        accepted, log = set(), {}
        for n in list(AD.lora_modules(model)[0].A.keys()):
            AD.drop_adapter(model, n)
        for which, prefix, smode, conf in stages:
            rows_all = [w for w in web if which == "all" or tier[w[:2]] == which]
            for f in sorted({w[2] for w in rows_all}, key=lambda f: -sum(1 for w in rows_all if w[2] == f)):
                rows = [(t, c) for t, c, ff in rows_all if ff == f]
                name = prefix + f
                keep = {"prev": prev_rows, "dev": dev_rows, "target": rows}
                before = {k: items(v, accepted, mode) for k, v in keep.items()}
                WT.train_adapter(P, model, name, rows, replay, seed=a.train_seed, **conf)
                after = {k: items(v, accepted | {name}, mode) for k, v in keep.items()}
                ok, why = AD.gate(before, after, "target", ("prev", "dev"), 0.02)
                if ok:
                    accepted.add(name)
                else:
                    AD.drop_adapter(model, name)
                log[name] = {"pairs": len(rows), "accepted": ok, "why": why, "target": [sum(before["target"].values()), sum(after["target"].values())]}
        rep = report(accepted, mode)
        res["arms"][arm] = {"stages": [[w, p, m, c] for w, p, m, c in stages], "families": log, "accepted": sorted(accepted), "after": rep}
        print(arm, rep, {f: (v["accepted"], v["pairs"], v["target"]) for f, v in log.items()}, flush=True)
    res["secs"] = round(time.time() - t0)
    if a.json:
        json.dump(res, open(a.json, "w"), ensure_ascii=False, indent=1)


def _embed(model, texts):
    with torch.no_grad():
        h, pad = model._feats(list(texts))
        keep = (~pad).float()[..., None]
        return (h * keep).sum(1) / keep.sum(1).clamp(min=1)


if __name__ == "__main__":
    main()
