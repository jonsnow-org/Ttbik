"""CPU self-test for sham_boost (tiny random config, ~10 s).

  python sham_boost/verify_boost.py

Checks
 1. gates at 0 → logits bit-identical to the plain model (all add-ons on)
 2. document-masked path with one document == plain causal path
 3. WSD schedule: shape, resume mid-session gives the same lr sequence
 4. packing: labels are -100 exactly at document starts
 5. stage A: Sham weights untouched, gates move, loss goes down
 6. fold_in → from_merged round-trip gives identical logits; plain
    load_checkpoint still reads the merged file; final_merged.pt is refused
 7. one_click_merge.run on a synthetic gate
"""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

import torch

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parent))

from model import ShamSmall, ShamSmallConfig  # noqa: E402
from checkpoint import save_checkpoint, load_checkpoint  # noqa: E402
from sham_boost.boosted import BoostedSham, BoostConfig  # noqa: E402
from sham_boost.sched import WSDConfig, WSDSchedule, wsd_factor, cosine_resume_lr  # noqa: E402
from sham_boost.data_stream import pack_documents, block_causal_mask, batches, AnnealMixer, OffsetStore, fresh_docs  # noqa: E402
from sham_boost.modules import ShortLongContext  # noqa: E402
from sham_boost import one_click_merge  # noqa: E402
from sham_boost.train_boost import build_optimizer, train_steps  # noqa: E402

V, T = 320, 96


def tiny():
    torch.manual_seed(0)
    cfg = ShamSmallConfig(vocab_size=V, d_model=64, n_layers=4, n_heads=4, n_kv_heads=2, mlp_hidden=128, max_seq_len=128)
    return ShamSmall(cfg).train(False)


def full_boost_cfg():
    return BoostConfig(qk_norm=True, embed_adapter_ids=list(range(250, 300)), embed_rank=16,
                       memory_layers=[1, 2], memory_probe=16, media_layers=[0, 3], media_d_enc=32, xattn_heads=2)


def media_batch(B):
    return {"image": torch.randn(B, 3, 32, 32), "audio": torch.randn(B, 80, 20), "video": torch.randn(B, 2, 3, 32, 32)}


def check_identity():
    base = tiny()
    m = BoostedSham(base, full_boost_cfg()).train(False)
    chunks = [torch.randint(0, 250, (48,)) for _ in range(10)]
    m.set_memory_bank(m.build_memory(chunks, segments=4))
    ids = torch.randint(0, V, (2, T))
    with torch.no_grad():
        a, _ = base(ids)
        b, _ = m(ids, media=media_batch(2))
    assert torch.equal(a, b), f"gate=0 logits differ: {(a - b).abs().max()}"
    # opening the gates must actually change something (wiring is live)
    with torch.no_grad():
        for n, p in m.named_parameters():
            if n.endswith("gate"):
                p.fill_(0.5)
        c, _ = m(ids, media=media_batch(2))
    assert (c - a).abs().max() > 1e-4, "gates open but logits unchanged — add-ons not wired"
    return float((a - b).abs().max())


def check_doc_mask():
    base = tiny()
    m = BoostedSham(base, BoostConfig(qk_norm=True)).train(False)
    ids = torch.randint(0, V, (2, T))
    mask = block_causal_mask(torch.zeros(2, T, dtype=torch.long))
    with torch.no_grad():
        a, _ = base(ids)
        b, _ = m(ids, doc_mask=mask)
    d = float((a - b).abs().max())
    assert d < 1e-4, d
    return d


def check_sched():
    c = WSDConfig(peak_lr=1e-3, warmup=10, floor_ratio=0.1, decay_frac=0.2)
    f = [wsd_factor(1000 + k, 1000, 100, c) for k in range(101)]
    assert abs(f[9] - 1.0) < 1e-9 and f[0] == 0.1 and all(x == 1.0 for x in f[10:80])
    assert abs(f[100] - 0.1) < 1e-9 and all(f[i] >= f[i + 1] for i in range(80, 100))
    p = torch.nn.Parameter(torch.zeros(1))
    o1 = torch.optim.SGD([p], lr=0.0)
    s1 = WSDSchedule(o1, c, 1000, 100)
    seq1 = []
    for _ in range(60):
        seq1.append(o1.param_groups[0]["lr"])
        s1.step()
    o2 = torch.optim.SGD([p], lr=0.0)
    s2 = WSDSchedule(o2, c, 1000, 100)
    for _ in range(37):
        s2.step()
    s3 = WSDSchedule.from_state(torch.optim.SGD([p], lr=0.0), s2.state_dict())
    seq3 = []
    for _ in range(23):
        seq3.append(s3.opt.param_groups[0]["lr"])
        s3.step()
    assert seq1[37:] == seq3, "resume changed the lr sequence"
    old = cosine_resume_lr(61555, 62000, 500, 3e-4, 0.1)
    new = 3e-4 * wsd_factor(61555 + 300, 61555, 1500, WSDConfig(warmup=100))
    return {"cosine_at_61555_of_62000": f"{old:.2e}", "wsd_mid_session": f"{new:.2e}"}


def check_packing():
    docs = [[1, 2, 3], [4, 5, 6, 7, 8, 9], [10, 11, 12]]
    rows = list(pack_documents(docs, 4))
    ids = torch.cat([r[0] for r in rows]).tolist()
    labs = torch.cat([r[1] for r in rows]).tolist()
    assert ids == list(range(1, 13))
    assert labs[3] == -100 and labs[9] == -100 and labs[1] == 2 and labs[4] == 5, labs
    with tempfile.TemporaryDirectory() as d:
        st = OffsetStore(Path(d) / "o.json")
        a = list(fresh_docs("x", (f"doc{i}" * 50 for i in range(10)), st, limit=4))
        b = list(fresh_docs("x", (f"doc{i}" * 50 for i in range(10)), OffsetStore(Path(d) / "o.json"), limit=4))
        assert not set(a) & set(b), "second session re-read old documents"
    ctx = ShortLongContext(short=32, long=96, period=10, long_steps=2)
    assert [ctx.seq_len(s, 128) for s in (0, 7, 8, 9, 10)] == [32, 32, 96, 96, 32]


def _rows(n, seed=1):
    g = torch.Generator().manual_seed(seed)
    docs = []
    for _ in range(n):
        a = int(torch.randint(0, 200, (1,), generator=g))
        docs.append([(a + 3 * i) % 250 for i in range(int(torch.randint(20, 60, (1,), generator=g)))])
    return list(pack_documents(docs, 64))


def check_stage_a():
    base = tiny()
    m = BoostedSham(base, BoostConfig(qk_norm=True, embed_adapter_ids=list(range(0, 250, 7)), embed_rank=16))
    before = {k: v.clone() for k, v in base.state_dict().items()}
    opt = build_optimizer(m, 3e-3, unfreeze=False, base_lr_scale=0.1)
    sched = WSDSchedule(opt, WSDConfig(peak_lr=3e-3, warmup=5), 0, 60)
    rows = _rows(400)
    data = batches(AnnealMixer(iter(rows), rows[:20], sched.in_tail), 4)
    hist = train_steps(m, data, 60, sched, opt, log_every=0)
    for k, v in base.state_dict().items():
        assert torch.equal(v, before[k]), f"stage A changed base weight {k}"
    moved = {k: v for k, v in m.gates().items() if abs(v) > 0}
    assert moved, "no gate moved"
    first, last = sum(hist[:10]) / 10, sum(hist[-10:]) / 10
    assert last < first, (first, last)
    return m, first, last


def check_fold(m):
    with tempfile.TemporaryDirectory() as d:
        d = Path(d)
        src = d / "final_merged.pt"
        save_checkpoint(src, m.base, step=123)
        m.save_boost(d / "boost_state.pt")
        m2 = BoostedSham.from_checkpoint(src, d / "boost_state.pt").train(False)
        out = m2.fold_in(d / "final_boosted.pt", source=src)
        m3 = BoostedSham.from_merged(out).train(False)
        ids = torch.randint(0, V, (2, T))
        m.train(False)
        with torch.no_grad():
            a, _ = m(ids)
            b, _ = m3(ids)
        assert torch.equal(a, b), "fold_in round-trip changed logits"
        plain, step, extra = load_checkpoint(out)
        assert step == 123 and "boost" in extra
        try:
            m2.fold_in(d / "final_merged.pt")
            raise AssertionError("fold_in overwrote final_merged.pt")
        except ValueError:
            pass
        gate = {"text": [torch.stack([r[0] for r in _rows(40, seed=9)[i:i + 4]]) for i in range(0, 16, 4)]}
        r = one_click_merge.run(src, d / "boost_state.pt", gate, tolerance=0.005, apply=True,
                                out=d / "final_boosted2.pt", log=lambda *_: None)
        assert r["written"] is None or Path(r["written"]).exists()
        return r


def main() -> int:
    torch.set_num_threads(2)
    print("1. gate=0 identity, max |Δlogit| =", check_identity())
    print("2. doc-mask path vs causal, max |Δ| =", check_doc_mask())
    print("3. WSD schedule + resume OK", check_sched())
    check_packing()
    print("4. packing / fresh offsets / short-long OK")
    m, f, l = check_stage_a()
    print(f"5. stage A OK: base frozen, loss {f:.3f} → {l:.3f}, gates {({k: round(v, 3) for k, v in m.gates().items()})}")
    r = check_fold(m)
    print(f"6-7. fold_in round-trip OK; one-click: pass={r['pass']} base={r['base']} boost={r['boost']}")
    print("sham_boost verify: ALL PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
