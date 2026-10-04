"""
Sham's move to a GENERAL text tokenizer ("المُرمِّز العام").

The first text tokenizer was trained on Arabic only. Sham is meant to be a general model
(many languages, code, mathematics, science), and with an Arabic-only vocabulary every
other language costs 2-4x more tokens, i.e. 2-4x less learning per GPU hour. The general
tokenizer (`sham_general_tokenizer.json`, same 32,000 size — so the image/audio/special
ranges and every other part of the model keep their ids) is trained on the general mixture.

So that no notebook cell has to change and no checkpoint is lost, this module installs a
small, symmetric shim (from sham_inputs, like sham_schedule / sham_vq):

  • ShamTextTokenizer.load(path): a production-size (32,000) tokenizer that is not the general
    one is answered with the general one;
  • load_checkpoint(path): a checkpoint that sits beside such an old tokenizer (and is not
    already marked) has its text rows moved to the general tokenizer: a piece both vocabularies
    share keeps its row, any other piece starts as the mean of the old rows that spelled it
    (embedding transfer); media and special rows are untouched; the optimizer is not restored
    (its moments belong to the old rows);
  • save_checkpoint(...): marks what it writes as general (extra["text_tokenizer"]), so a
    converted checkpoint is never converted twice, whatever tokenizer file travels with it;
  • train_text_tokenizer(...): a first-ever run gets the general tokenizer, not a new Arabic one;
  • raw(): the repair/merge stage keeps seeing the OLD tokenizers as they are (it remaps rows
    by token string itself).

Nothing is written for the model here: only the way its vocabulary is spelled changes.
"""

from __future__ import annotations

import contextlib
import sys
from pathlib import Path

import torch

GENERAL_PATH = Path(__file__).with_name("sham_general_tokenizer.json")
MARK = "general-v1"
_STATE = {"raw": 0, "orig": {}}
_CACHE: dict = {}


def general_available() -> bool:
    return GENERAL_PATH.exists()


@contextlib.contextmanager
def raw():
    _STATE["raw"] += 1
    try:
        yield
    finally:
        _STATE["raw"] -= 1


def _vocab(tok) -> dict:
    return tok._tokenizer.get_vocab()


def is_general(tok) -> bool:
    gen = _general()
    return _vocab(tok) == _vocab(gen)


def _general():
    if "general" not in _CACHE:
        _CACHE["general"] = _STATE["orig"]["tok_load"](str(GENERAL_PATH))
    return _CACHE["general"]


def transfer_rows(emb: torch.Tensor, old_tok, new_tok, text_size: int) -> tuple[torch.Tensor, int, int]:
    """New embedding matrix (same shape) whose text rows are re-spelled for new_tok.
    Returns (matrix, shared pieces copied, pieces built from old pieces)."""
    out = emb.clone()
    old_vocab, new_vocab = _vocab(old_tok), _vocab(new_tok)
    old_model = old_tok._tokenizer.model
    copied = built = 0
    for piece, nid in new_vocab.items():
        if nid >= text_size:
            continue
        oid = old_vocab.get(piece)
        if oid is not None and oid < text_size:
            out[nid] = emb[oid]
            copied += 1
            continue
        try:
            parts = [t.id for t in old_model.tokenize(piece)]
        except Exception:
            parts = []
        parts = [p for p in parts if p < text_size]
        if parts:
            out[nid] = emb[parts].mean(0)
            built += 1
    return out, copied, built


def convert_payload(payload: dict, old_tok, new_tok) -> dict:
    from model import TEXT_VOCAB_SIZE

    sd = payload["model_state_dict"]
    emb, copied, built = transfer_rows(sd["token_embedding.weight"], old_tok, new_tok, TEXT_VOCAB_SIZE)
    sd["token_embedding.weight"] = emb
    if "lm_head.weight" in sd:
        sd["lm_head.weight"] = emb
    payload.pop("optimizer_state_dict", None)
    payload.setdefault("extra", {})["text_tokenizer"] = MARK
    print(f"🔤 المُرمِّز العام: نُقلت صفوف النص إلى مفردات شام العامة ({copied:,} قطعة مشتركة، {built:,} مبنية من قطع قديمة)")
    try:
        from sham_selfdev import record
        record("المُرمِّز العام", f"{copied:,} صف منقول، {built:,} مبني")
    except Exception:
        pass
    return payload


def _sibling_tokenizer(path: Path):
    for p in sorted(path.parent.glob("*tokenizer*.json")):
        try:
            return _STATE["orig"]["tok_load"](str(p))
        except Exception:
            continue
    return None


def install() -> bool:
    if not general_available():
        return False
    import checkpoint as ck
    from model import ShamSmall, ShamSmallConfig, TEXT_VOCAB_SIZE
    from text_tokenizer import ShamTextTokenizer
    import text_tokenizer as tt

    if _STATE["orig"]:
        return True
    orig_load_cls = ShamTextTokenizer.__dict__["load"].__func__
    _STATE["orig"].update(tok_load=lambda p: orig_load_cls(ShamTextTokenizer, p), load_ck=ck.load_checkpoint,
                          save_ck=ck.save_checkpoint, train_tok=tt.train_text_tokenizer)

    def load_tok(cls, path):
        tok = orig_load_cls(cls, path)
        if _STATE["raw"] or tok.vocab_size != TEXT_VOCAB_SIZE or is_general(tok):
            return tok
        return _general()

    def load_checkpoint(path, map_location="cpu", load_optimizer_into=None):
        payload = torch.load(path, map_location=map_location, weights_only=False)
        extra = payload.get("extra") or {}
        old = None if (_STATE["raw"] or extra.get("text_tokenizer") == MARK) else _sibling_tokenizer(Path(path))
        converted = (old is not None and old.vocab_size == TEXT_VOCAB_SIZE and not is_general(old)
                     and payload["model_state_dict"]["token_embedding.weight"].shape[0] >= TEXT_VOCAB_SIZE)
        if not converted:
            return _STATE["orig"]["load_ck"](path, map_location, load_optimizer_into)
        payload = convert_payload(payload, old, _general())
        model = ShamSmall(ShamSmallConfig.from_dict(payload["config"]))
        model.load_state_dict(payload["model_state_dict"])
        model.to(map_location)
        return model, payload["step"], payload.get("extra", {})

    def save_checkpoint(path, model, step, optimizer=None, extra=None):
        extra = dict(extra or {})
        extra.setdefault("text_tokenizer", MARK)
        return _STATE["orig"]["save_ck"](path, model, step, optimizer=optimizer, extra=extra)

    def train_text_tokenizer(corpus_paths, vocab_size=TEXT_VOCAB_SIZE, min_frequency=2):
        if vocab_size == TEXT_VOCAB_SIZE:
            print("🔤 المُرمِّز العام الجاهز يُستخدم بدل تدريب مُرمِّز جديد.")
            return _general()
        return _STATE["orig"]["train_tok"](corpus_paths, vocab_size, min_frequency)

    ShamTextTokenizer.load = classmethod(load_tok)
    for mod_name, attr, fn in (("checkpoint", "load_checkpoint", load_checkpoint),
                               ("checkpoint", "save_checkpoint", save_checkpoint),
                               ("text_tokenizer", "train_text_tokenizer", train_text_tokenizer)):
        orig = _STATE["orig"]["load_ck" if attr == "load_checkpoint" else "save_ck" if attr == "save_checkpoint" else "train_tok"]
        for m in list(sys.modules.values()):  # modules that already imported the function by name
            if m is not None and getattr(m, attr, None) is orig:
                setattr(m, attr, fn)
        setattr(sys.modules[mod_name], attr, fn)
    # the repair/merge stage remaps old tokenizers itself, so it must see them as they are
    try:
        import sham_repair
        if not getattr(sham_repair.repair_candidate, "_sham_raw", False):
            inner = sham_repair.repair_candidate

            def repair_candidate(*a, **k):
                with raw():
                    return inner(*a, **k)

            repair_candidate._sham_raw = True
            for m in list(sys.modules.values()):
                if m is not None and getattr(m, "repair_candidate", None) is inner:
                    setattr(m, "repair_candidate", repair_candidate)
    except ImportError:
        pass
    return True


def uninstall() -> None:
    """For tests."""
    if not _STATE["orig"]:
        return
    import checkpoint as ck
    import text_tokenizer as tt
    from text_tokenizer import ShamTextTokenizer
    o = _STATE["orig"]
    ShamTextTokenizer.load = classmethod(lambda cls, p, _f=o["tok_load"]: _f(p))
    ck.load_checkpoint, ck.save_checkpoint, tt.train_text_tokenizer = o["load_ck"], o["save_ck"], o["train_tok"]
    _STATE["orig"].clear()
    _CACHE.clear()


if __name__ == "__main__":
    import tempfile

    from model import ShamSmall, ShamSmallConfig, TEXT_VOCAB_SIZE
    from text_tokenizer import ShamTextTokenizer, train_text_tokenizer as real_train

    assert general_available(), "run build_general_tokenizer.py first"
    from checkpoint import load_checkpoint as ck_load, save_checkpoint as ck_save
    with tempfile.TemporaryDirectory() as d:
        d = Path(d)
        # an "old Arabic-only" tokenizer of production size, trained on a small Arabic text
        text = ("بسم الله الرحمن الرحيم. العلم نور والجهل ظلام. " * 400) + "\n" + ("the quick brown fox jumps over the lazy dog. " * 400)
        (d / "t.txt").write_text(text, encoding="utf-8")
        old = real_train([str(d / "t.txt")], vocab_size=500)
        # make the "old" tokenizer production-sized in the shim's eyes by lowering the check size
        cfg = ShamSmallConfig(vocab_size=42256, d_model=32, n_layers=1, n_heads=2, n_kv_heads=1, mlp_hidden=64, max_seq_len=16)
        torch.manual_seed(0)
        model = ShamSmall(cfg)
        sub = d / "old"; sub.mkdir()
        # a 32k Arabic-ish old tokenizer: train on the repo's own mixture-free sample, size 32000 is slow, so use a 32000-vocab BPE on this tiny text via padding merges is impossible;
        # instead test the mechanics with the general tokenizer's own file as the "old" one but shuffled ids.
        import json
        g = json.loads(GENERAL_PATH.read_text(encoding="utf-8"))
        vocab = g["model"]["vocab"]
        ids = list(vocab.values()); perm = ids[1:] + ids[:1]  # a different spelling of the same pieces
        g["model"]["vocab"] = dict(zip(vocab.keys(), perm))
        (sub / "sham_small_tokenizer.json").write_text(json.dumps(g), encoding="utf-8")
        ck_save(sub / "final.pt", model, 7)
        before = {k: v.clone() for k, v in model.state_dict().items()}
        assert install()
        old_tok = ShamTextTokenizer.load(str(sub / "sham_small_tokenizer.json"))
        assert _vocab(old_tok) == _vocab(_general())  # any other production tokenizer is answered with the general one
        with raw():
            real_old = ShamTextTokenizer.load(str(sub / "sham_small_tokenizer.json"))
            assert _vocab(real_old) != _vocab(_general())
        # the checkpoint was saved by the ORIGINAL save above (unmarked) → converted on load
        import checkpoint as _ck
        m2, step, extra = _ck.load_checkpoint(sub / "final.pt")
        assert step == 7 and extra.get("text_tokenizer") == MARK
        e0, e1 = before["token_embedding.weight"], m2.state_dict()["token_embedding.weight"]
        gv, ov = _vocab(_general()), {k: v for k, v in zip(vocab.keys(), perm)}
        sample = [t for t in list(gv)[:200]]
        for t in sample:  # each piece's row followed the piece to its new id
            assert torch.equal(e1[gv[t]], e0[ov[t]]), t
        assert torch.equal(e1[TEXT_VOCAB_SIZE:], e0[TEXT_VOCAB_SIZE:])  # media/special rows untouched
        # saving through the shim marks the file → a second load does not convert again
        _ck.save_checkpoint(sub / "again.pt", m2, 8)
        m3, _, ex = _ck.load_checkpoint(sub / "again.pt")
        assert ex.get("text_tokenizer") == MARK and torch.equal(m3.state_dict()["token_embedding.weight"], e1)
        # a first-ever run gets the general tokenizer
        import text_tokenizer as tt
        assert _vocab(tt.train_text_tokenizer([str(d / "t.txt")], vocab_size=TEXT_VOCAB_SIZE)) == _vocab(_general())
        small = tt.train_text_tokenizer([str(d / "t.txt")], vocab_size=300)
        assert small.vocab_size <= 300  # tests with small vocabularies are untouched
        uninstall()
    print("sham_general_text self-test OK")
