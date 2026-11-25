"""Train Sham Pro's OWN motion-token rows on real clips, so its video is the model's own motion (owner decision 2026-11-25; CPU only).

Sham v2's media stage trained its image and audio rows, never the 1024 motion rows of its tied embedding: with only a motion tokenizer, a video
request would sample motion codes from untrained rows. This trains ONLY those rows (the 2B body stays frozen, nothing else changes):

  * every clip (Kinetics-400, caption = its label) is laid out EXACTLY as sham_studio_media._video_result prompts and generates it:
      media_prompts("image", caption) + <VIDEO_START> <IMAGE_START> keyframe <IMAGE_END> <MOTION_START> flow tokens (7 x 64) ...
    with the keyframe from Sham's own image tokenizer and the flow tokens from the PUBLISHED motion tokenizer (the one serving loads);
  * the frozen body gives the final hidden state at every position that predicts a motion token; the rows are trained as the motion part of the
    (tied) output layer with cross-entropy over the motion range (guided sampling only ever samples inside that range); row norms are kept within
    the image rows' norm range because the same rows are the input embeddings;
  * round 2 re-reads the clips WITH the trained rows (the tied input side changed), then trains again;
  * gate (held-out clips never trained on): motion NLL must beat the untrained rows AND a context-free unigram of the training codes. Otherwise
    nothing is published.

Output: motion_rows.pt (sham_motion_rows.save: rows + fingerprints of the base checkpoint rows and of the motion tokenizer file) and
motion_rows_progress.json; --publish uploads both into novaai2026/sham-v2 (no other file is touched). serve.py applies it at load time.

    MODELSCOPE_TOKEN=... python scripts/transplant/train_sham_v2_motion_rows.py --clips 200 --minutes 240 --publish
    python scripts/transplant/train_sham_v2_motion_rows.py --selftest         # tiny random model, synthetic clips, no network
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
import sys
import time
from pathlib import Path

os.environ.setdefault("SHAM_TEXT_VOCAB", "151936")          # Sham v2's text range (the donor's vocabulary), set BEFORE any Sham module import
ROOT = Path(__file__).resolve().parents[2]
SHAM = ROOT / "ai-system" / "colab" / "sham_small"
sys.path.insert(0, str(SHAM))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import torch  # noqa: E402
import torch.nn.functional as F  # noqa: E402

MODEL_REPO = os.environ.get("SHAM_MS_MODEL", "novaai2026/sham-v2")
FRAMES = 8                                                    # 1 keyframe + 7 motion frames (sham_live.VIDEO_MOTION_FRAMES)


class _Stop(Exception):
    pass


def hidden_states(model, ids: list[int]) -> torch.Tensor:
    """Final (normed) hidden states (T, d) of the frozen body: captured at the output layer's input, the logits are never computed."""
    got = {}

    def pre(_m, args):
        got["h"] = args[0]
        raise _Stop

    h = model.lm_head.register_forward_pre_hook(pre)
    try:
        with torch.no_grad():
            model(torch.tensor([ids], dtype=torch.long))
    except _Stop:
        pass
    finally:
        h.remove()
    return got["h"][0]


def clip_sequence(caption_ids: list[int], key_ids: list[int], motion_ids: list[int], tokenizer=None) -> tuple[list[int], int]:
    """-> (ids, first) in the serving layout; ids[first:] are the motion tokens (position p-1 predicts ids[p])."""
    from model import SpecialTokens
    from sham_decoding import media_prompts
    cond, _ = media_prompts("image", caption_ids[:200], tokenizer, chat=True)
    head = cond + [SpecialTokens.VIDEO_START, SpecialTokens.IMAGE_START] + key_ids + [SpecialTokens.IMAGE_END, SpecialTokens.MOTION_START]
    return head + motion_ids, len(head)


def encode_clip(frames: torch.Tensor, image_tok, motion_tok) -> tuple[list[int], list[int]]:
    from model import image_token_id_to_vocab_id, motion_token_id_to_vocab_id
    with torch.no_grad():
        key = image_tok.encode(frames[:1])
        flow = motion_tok.encode_pair(frames[:-1], frames[1:], None)
    return image_token_id_to_vocab_id(key.view(-1)).tolist(), motion_token_id_to_vocab_id(flow.reshape(-1)).tolist()


def read(model, seqs) -> tuple[torch.Tensor, torch.Tensor]:
    """Hidden states at every motion-predicting position + their target codes (0..1023), over all sequences."""
    from model import MOTION_VOCAB_BASE
    hs, ys = [], []
    for ids, first in seqs:
        h = hidden_states(model, ids)
        hs.append(h[first - 1:len(ids) - 1].to(torch.bfloat16))
        ys.append(torch.tensor(ids[first:]) - MOTION_VOCAB_BASE)
    return torch.cat(hs), torch.cat(ys)


def nll(rows: torch.Tensor, h: torch.Tensor, y: torch.Tensor, mult: float) -> float:
    with torch.no_grad():
        tot = 0.0
        for i in range(0, h.shape[0], 4096):
            lg = (h[i:i + 4096].float() @ rows.float().t()) * mult
            tot += F.cross_entropy(lg, y[i:i + 4096], reduction="sum").item()
    return tot / max(1, h.shape[0])


def unigram_nll(y_train: torch.Tensor, y_eval: torch.Tensor, n: int) -> float:
    c = torch.bincount(y_train, minlength=n).float() + 0.5
    lp = (c / c.sum()).log()
    return float(-lp[y_eval].mean())


def fit(rows: torch.Tensor, h: torch.Tensor, y: torch.Tensor, mult: float, max_norm: float, epochs: int, lr: float, log=print) -> torch.Tensor:
    rows = rows.detach().float().clone().requires_grad_(True)
    opt = torch.optim.Adam([rows], lr=lr)
    n = h.shape[0]
    for ep in range(epochs):
        perm = torch.randperm(n)
        tot = 0.0
        for i in range(0, n, 512):
            idx = perm[i:i + 512]
            loss = F.cross_entropy((h[idx].float() @ rows.t()) * mult, y[idx])
            opt.zero_grad()
            loss.backward()
            opt.step()
            with torch.no_grad():                               # the same rows are the input embeddings: keep them in the image rows' norm range
                nrm = rows.norm(dim=1, keepdim=True)
                rows.mul_(torch.clamp(max_norm / nrm.clamp_min(1e-6), max=1.0))
            tot += loss.item() * idx.numel()
        if ep % max(1, epochs // 5) == 0 or ep == epochs - 1:
            log(f"  epoch {ep + 1}/{epochs}: train motion NLL {tot / n:.4f}")
    return rows.detach()


def train_rows(model, seqs_tr, seqs_ho, rounds: int = 2, epochs: int = 30, lr: float = 1e-2, log=print) -> tuple[torch.Tensor, dict]:
    import sham_motion_rows as R
    from model import IMAGE_VOCAB_BASE, IMAGE_VOCAB_SIZE, MOTION_VOCAB_BASE, MOTION_VOCAB_SIZE
    W = R.embedding(model)
    base_fp = R.rows_fingerprint(model)
    untrained = W[MOTION_VOCAB_BASE:MOTION_VOCAB_BASE + MOTION_VOCAB_SIZE].detach().float().clone()
    max_norm = float(W[IMAGE_VOCAB_BASE:IMAGE_VOCAB_BASE + IMAGE_VOCAB_SIZE].float().norm(dim=1).max())
    mult = float(getattr(model.cfg, "output_mult", 1.0) or 1.0)
    h_ho, y_ho = read(model, seqs_ho)
    rep = {"heldout_positions": int(y_ho.numel()), "untrained_nll": round(nll(untrained, h_ho, y_ho, mult), 4)}
    rows = untrained
    y_tr = None
    for r in range(rounds):
        t0 = time.time()
        h_tr, y_tr = read(model, seqs_tr)
        log(f"round {r + 1}: read {len(seqs_tr)} clips ({y_tr.numel()} motion positions) in {time.time() - t0:.0f}s")
        rows = fit(rows, h_tr, y_tr, mult, max_norm, epochs, lr, log)
        with torch.no_grad():
            W[MOTION_VOCAB_BASE:MOTION_VOCAB_BASE + MOTION_VOCAB_SIZE] = rows.to(W.dtype)
        h_ho, y_ho = read(model, seqs_ho)                          # the serving state: held-out re-read with the trained (tied) rows
        rep[f"round{r + 1}_heldout_nll"] = round(nll(rows, h_ho, y_ho, mult), 4)
        log(f"round {r + 1}: held-out motion NLL {rep[f'round{r + 1}_heldout_nll']} (untrained {rep['untrained_nll']})")
    rep["trained_nll"] = rep[f"round{rounds}_heldout_nll"]
    rep["unigram_nll"] = round(unigram_nll(y_tr, y_ho, MOTION_VOCAB_SIZE), 4)
    rep["uniform_nll"] = round(math.log(MOTION_VOCAB_SIZE), 4)
    rep["passes"] = bool(rep["trained_nll"] < rep["untrained_nll"] and rep["trained_nll"] < rep["unigram_nll"] - 0.02)
    with torch.no_grad():                                         # leave the model as it was: the published file is the only output
        W[MOTION_VOCAB_BASE:MOTION_VOCAB_BASE + MOTION_VOCAB_SIZE] = untrained.to(W.dtype)
    rep["base_rows_fp"] = base_fp
    return rows, rep


def fetch(dest: Path) -> Path:
    from modelscope import snapshot_download
    from modelscope.hub.api import HubApi
    HubApi().login(os.environ["MODELSCOPE_TOKEN"])
    p = snapshot_download(MODEL_REPO, cache_dir=str(dest),
                          allow_patterns=["final_merged.pt", "sham_small_tokenizer.json", "*image_tokenizer*.pt", "motion_tokenizer.pt", "**/image_tokenizer*.pt"])
    return Path(p)


def publish(folder: Path) -> None:
    from modelscope.hub.api import HubApi
    api = HubApi()
    api.login(os.environ["MODELSCOPE_TOKEN"])
    for name in ("motion_rows.pt", "motion_rows_progress.json"):
        api.upload_file(path_or_fileobj=str(folder / name), path_in_repo=name, repo_id=MODEL_REPO, repo_type="model",
                        commit_message=f"Sham Pro: trained motion rows ({name})")
        print(f"uploaded {name} -> {MODEL_REPO}", flush=True)


def build(clips, captions, image_tok, motion_tok, tokenizer, log=print):
    seqs = []
    t0 = time.time()
    for fr, cap in zip(clips, captions):
        key, mot = encode_clip(torch.stack(fr), image_tok, motion_tok)
        seqs.append(clip_sequence(tokenizer.encode(cap), key, mot, tokenizer))
    log(f"encoded {len(seqs)} clips (keyframe + {len(seqs[0][0]) - seqs[0][1] if seqs else 0} motion tokens each) in {time.time() - t0:.0f}s")
    return seqs


def selftest() -> int:
    import tempfile
    import sham_motion_rows as R
    from model import ShamSmall, ShamSmallConfig, TOTAL_VOCAB_SIZE, MOTION_VOCAB_BASE
    from motion_tokenizer import MotionTokenizer, MotionTokenizerConfig, warp_with_flow
    from image_tokenizer import ImageTokenizer, ImageTokenizerConfig
    from model import IMAGE_VOCAB_BASE, IMAGE_VOCAB_SIZE, MOTION_VOCAB_SIZE
    torch.manual_seed(0)
    model = ShamSmall(ShamSmallConfig(vocab_size=TOTAL_VOCAB_SIZE, d_model=48, n_layers=2, n_heads=4, n_kv_heads=2, mlp_hidden=96, max_seq_len=2048)).eval()
    with torch.no_grad():                                      # trained image rows have real norms (a random init's ~0.14 would cap every logit)
        W0 = R.embedding(model)
        W0[IMAGE_VOCAB_BASE:IMAGE_VOCAB_BASE + IMAGE_VOCAB_SIZE] *= 40
    itok = ImageTokenizer(ImageTokenizerConfig(image_size=64, base_channels=8, channel_multipliers=(1, 2, 2, 2), code_dim=8, num_codes=IMAGE_VOCAB_SIZE)).eval()
    mtok = MotionTokenizer(MotionTokenizerConfig(num_codes=MOTION_VOCAB_SIZE)).eval()
    with torch.no_grad():                                      # a codebook of real flows so different motions get different codes
        g = torch.linspace(-1, 1, 32)
        mtok.quantizer.codebook.weight[:1024] = torch.stack(torch.meshgrid(g, g, indexing="ij"), -1).reshape(-1, 2)
    clips, caps = [], []
    for i in range(24):                                         # two kinds of motion, named by their caption: the rows must learn which goes with which
        base = torch.rand(1, 3, 64, 64) * 2 - 1
        base = F.avg_pool2d(base, 5, 1, 2)
        d = 0.25 if i % 2 else -0.25
        fl = torch.zeros(1, 2, 8, 8)
        fl[:, 1] = d
        fr = [base[0]]
        for _ in range(FRAMES - 1):
            fr.append(warp_with_flow(fr[-1][None], fl)[0].clamp(-1, 1))
        clips.append(fr)
        caps.append("left" if i % 2 else "right")
    enc = {"left": [10, 11], "right": [12, 13]}

    class Tok:
        def encode(self, t):
            return enc.get(t, [20 + (ord(c) % 50) for c in t][:3])
    seqs = build(clips, caps, itok, mtok, Tok(), log=lambda m: None)
    assert all(len(s) - f == 7 * 64 for s, f in seqs) and all(min(s[f:]) >= MOTION_VOCAB_BASE for s, f in seqs)
    fp0 = R.rows_fingerprint(model)
    rows, rep = train_rows(model, seqs[:20], seqs[20:], rounds=2, epochs=20, log=lambda m: None)
    assert R.rows_fingerprint(model) == fp0, "training must leave the model unchanged"
    # a random 2-layer body carries little context, so end to end only the mechanics are checked here: it learned, and left the model unchanged
    assert rep["trained_nll"] < rep["untrained_nll"] - 1.0 and set(rep) >= {"unigram_nll", "passes", "base_rows_fp"}, rep
    # the fit itself must use context: codes that depend on the hidden state beat the context-free unigram
    hh = torch.randn(4000, 48) * 4                              # real final hidden states are large (normed x gain over d_model)
    yy = (hh[:, 0] > 0).long() * 5 + (hh[:, 1] > 0).long()
    r0 = torch.zeros(MOTION_VOCAB_SIZE, 48)
    fitted = fit(r0, hh[:3000], yy[:3000], 1.0, 20.0, 60, 1e-2, log=lambda m: None)
    got, uni = nll(fitted, hh[3000:], yy[3000:], 1.0), unigram_nll(yy[:3000], yy[3000:], MOTION_VOCAB_SIZE)
    assert got < uni - 0.5, (got, uni)
    d = Path(tempfile.mkdtemp())
    (d / "motion_tokenizer.pt").write_bytes(b"m")
    R.save(d / R.FILE, rows, rep["base_rows_fp"], R.file_sha(d / "motion_tokenizer.pt"), rep)
    assert R.apply(model, d, d / "motion_tokenizer.pt")["motion_rows"] == "trained"
    print("train_sham_v2_motion_rows self-test OK", json.dumps({**{k: rep[k] for k in ("untrained_nll", "trained_nll", "unigram_nll")}, "fit_context_nll": round(got, 3), "fit_unigram_nll": round(uni, 3)}))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--clips", type=int, default=200)
    ap.add_argument("--rounds", type=int, default=2)
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--out", default="/tmp/sham_v2_motion_rows")
    ap.add_argument("--manifest", default="", help="an existing video manifest.jsonl (skip collecting)")
    ap.add_argument("--model_dir", default="", help="a local copy of the model repo (skip the download)")
    ap.add_argument("--publish", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    torch.set_num_threads(os.cpu_count() or 2)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    md = Path(a.model_dir) if a.model_dir else fetch(out / "hub")
    ck = next(iter(sorted(md.rglob("final_merged.pt"))))
    tk = next(iter(sorted(md.rglob("sham_small_tokenizer.json"))))
    mt = next(iter(sorted(md.rglob("motion_tokenizer.pt"))), None)
    if mt is None:
        print("no published motion tokenizer in the model repo: the rows must be trained for the tokenizer serving loads", flush=True)
        return 4
    from checkpoint import load_checkpoint
    from motion_tokenizer import load_motion_tokenizer
    from text_tokenizer import ShamTextTokenizer
    from tokenizer_select import select_pretrained_tokenizer
    t0 = time.time()
    model, step, _ = load_checkpoint(str(ck))
    model = model.float().eval()
    for p in model.parameters():
        p.requires_grad_(False)
    print(f"loaded {ck.name} (step {step}) in {time.time() - t0:.0f}s; d_model={model.cfg.d_model}", flush=True)
    itok = select_pretrained_tokenizer("image", md)[0].to("cpu").eval()
    mtok = load_motion_tokenizer(mt).to("cpu").eval()
    tok = ShamTextTokenizer.load(str(tk))
    size = int(itok.cfg.image_size)
    from train_sham_v2_motion import load_clips
    manifest = Path(a.manifest) if a.manifest else None
    if manifest is None:
        from sham_data_sources import Ledger, collect
        m, st = collect("video", out / "clips", a.clips, Ledger("video"), image_size=size, num_frames=FRAMES)
        manifest = Path(m)
        print(f"collected {st.written} real clips", flush=True)
    recs = [json.loads(x) for x in manifest.read_text(encoding="utf-8").splitlines()]
    clips = load_clips(manifest, size, a.clips)
    caps = [str(r.get("caption") or "video") for r in recs if len(r.get("frames") or []) >= 2][:len(clips)]
    clips = [c[:FRAMES] for c in clips if len(c) >= FRAMES]
    caps = caps[:len(clips)]
    rng = random.Random(7)
    order = list(range(len(clips)))
    rng.shuffle(order)
    n_ho = max(4, len(order) // 8)
    ho, tr = order[:n_ho], order[n_ho:]
    seqs = build(clips, caps, itok, mtok, tok, log=lambda m: print(m, flush=True))
    del clips
    rows, rep = train_rows(model, [seqs[i] for i in tr], [seqs[i] for i in ho], rounds=a.rounds, epochs=a.epochs, log=lambda m: print(m, flush=True))
    import sham_motion_rows as R
    rep.update(train_clips=len(tr), heldout_clips=len(ho), motion_tokenizer_sha=R.file_sha(mt), checkpoint_step=int(step),
               trained_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), data="Kinetics-400 clips (sham_data_sources), caption = label, 8 frames")
    R.save(out / R.FILE, rows, rep["base_rows_fp"], rep["motion_tokenizer_sha"], rep)
    (out / "motion_rows_progress.json").write_text(json.dumps(rep, indent=1), encoding="utf-8")
    print("RESULT " + json.dumps(rep), flush=True)
    if not rep["passes"]:
        print("not published: on held-out clips the trained rows do not beat the untrained rows and the unigram of motion codes", flush=True)
        return 3
    if a.publish:
        publish(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
