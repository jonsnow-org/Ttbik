import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "data"))


def load_config(path: str) -> dict:
    cfg = {}
    for line in open(path, encoding="utf-8"):
        line = line.split("#", 1)[0].strip()
        if not line or ":" not in line:
            continue
        k, v = (x.strip() for x in line.split(":", 1))
        if v.lower() in ("true", "false"):
            cfg[k] = v.lower() == "true"
        else:
            try:
                cfg[k] = int(v)
            except ValueError:
                try:
                    cfg[k] = float(v)
                except ValueError:
                    cfg[k] = v                                       # a string (e.g. donor: ${TLDM_DONOR})
    return cfg


def make_tokenizer(cfg: dict, texts):
    from sham_tldm import BPETokenizer, ByteTokenizer
    n = int(cfg.get("bpe_merges", 0))
    return BPETokenizer.train(list(texts), n) if n > 0 else ByteTokenizer()
